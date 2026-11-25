import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import { getPlanBySlug, isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  if (!verifySameOrigin(req)) {
    return NextResponse.json(
      { error: 'Origem da requisição não autorizada.' },
      { status: 403 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase não configurado.', code: 'SUPABASE_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  const session = await getAuthenticatedSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Autenticação necessária.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Formato de requisição inválido.' },
      { status: 400 }
    );
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const color =
    typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : '#059669';
  const unitId = typeof body.unitId === 'string' && body.unitId ? body.unitId : null;
  const specialtyIds = Array.isArray(body.specialtyIds)
    ? body.specialtyIds.filter((s): s is string => typeof s === 'string')
    : [];
  const slotDuration =
    typeof body.slotDurationMinutes === 'number' &&
    body.slotDurationMinutes >= 10 &&
    body.slotDurationMinutes <= 240
      ? Math.round(body.slotDurationMinutes)
      : 60;

  if (!name || name.length > 120) {
    return NextResponse.json(
      { error: 'Informe o nome do profissional (até 120 caracteres).' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServerClient(session.accessToken);
  const { context } = await resolveAgendaAccessContext(
    supabase,
    session.user.id,
    session.user.email
  );

  if (!context || !context.isAdmin) {
    return NextResponse.json(
      {
        error:
          'Apenas administradores ou gestores autorizados podem cadastrar profissionais e agendas.',
      },
      { status: 403 }
    );
  }

  // Enforce plan professional limit
  let planSlug = isValidPlanSlug(session.user.plan_slug)
    ? session.user.plan_slug
    : 'free';
  const { data: subRow } = await supabase
    .from('subscriptions')
    .select('plan_slug')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (subRow && isValidPlanSlug(subRow.plan_slug)) {
    planSlug = subRow.plan_slug;
  }
  const planDef = getPlanBySlug(planSlug);

  if (planDef.max_professionals !== null) {
    const { count } = await supabase
      .from('professionals')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', context.organization.id)
      .eq('is_active', true);

    if ((count ?? 0) >= planDef.max_professionals) {
      return NextResponse.json(
        {
          error: `Seu plano ${planDef.name} permite gerenciar até ${planDef.max_professionals} ${
            planDef.max_professionals === 1 ? 'profissional' : 'profissionais'
          }. Atualize o plano em Configurações para adicionar mais agendas.`,
          code: 'PLAN_LIMIT_REACHED',
        },
        { status: 403 }
      );
    }
  }

  const { data: prof, error: profError } = await supabase
    .from('professionals')
    .insert({
      organization_id: context.organization.id,
      unit_id: unitId,
      name,
      email: email || null,
      color,
      is_active: true,
    })
    .select('id, organization_id, unit_id, user_id, name, email, color, is_active')
    .single();

  if (profError || !prof) {
    return NextResponse.json(
      { error: 'Não foi possível cadastrar o profissional.' },
      { status: 502 }
    );
  }

  if (specialtyIds.length > 0) {
    await supabase.from('professional_specialties').insert(
      specialtyIds.map((specialty_id) => ({
        professional_id: prof.id,
        specialty_id,
      }))
    );
  }

  const { data: schedule, error: schedError } = await supabase
    .from('schedules')
    .insert({
      organization_id: context.organization.id,
      unit_id: unitId,
      professional_id: prof.id,
      name: `Agenda — ${name}`,
      slot_duration_minutes: slotDuration,
      is_active: true,
    })
    .select('*')
    .single();

  if (schedError || !schedule) {
    return NextResponse.json(
      { error: 'Profissional criado, mas houve erro ao criar a agenda.' },
      { status: 502 }
    );
  }

  // Create default Mon-Fri availability (08:00-18:00, break 12:00-13:00)
  await supabase.from('availability_rules').insert(
    [1, 2, 3, 4, 5].map((day_of_week) => ({
      organization_id: context.organization.id,
      schedule_id: schedule.id,
      day_of_week,
      start_time: '08:00:00',
      end_time: '18:00:00',
      break_start: '12:00:00',
      break_end: '13:00:00',
      is_active: true,
    }))
  );

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    schedule_id: schedule.id,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'create_professional_schedule',
    new_values: { professional_name: name, schedule_id: schedule.id },
  });

  const response = NextResponse.json(
    {
      professional: { ...prof, specialty_ids: specialtyIds },
      schedule,
    },
    { status: 201 }
  );

  if (session.refreshed) {
    setSessionCookies(
      response,
      req,
      session.accessToken,
      session.refreshToken
    );
  }
  return response;
}

export async function PATCH(req: NextRequest) {
  if (!verifySameOrigin(req)) {
    return NextResponse.json(
      { error: 'Origem da requisição não autorizada.' },
      { status: 403 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase não configurado.', code: 'SUPABASE_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  const session = await getAuthenticatedSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Autenticação necessária.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Formato de requisição inválido.' },
      { status: 400 }
    );
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    return NextResponse.json(
      { error: 'Identificador do profissional ausente.' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServerClient(session.accessToken);
  const { context } = await resolveAgendaAccessContext(
    supabase,
    session.user.id,
    session.user.email
  );

  if (!context || !context.isAdmin) {
    return NextResponse.json(
      { error: 'Apenas administradores podem atualizar profissionais.' },
      { status: 403 }
    );
  }

  const { data: existing } = await supabase
    .from('professionals')
    .select('id, organization_id, unit_id, name, email, color, is_active')
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: 'Profissional não encontrado.' },
      { status: 404 }
    );
  }

  const nextName =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : existing.name;
  const nextColor =
    typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : existing.color;
  const nextUnitId =
    body.unitId === null
      ? null
      : typeof body.unitId === 'string'
        ? body.unitId.trim() || null
        : existing.unit_id;
  const nextActive =
    typeof body.isActive === 'boolean' ? body.isActive : existing.is_active;

  const { data: updated, error } = await supabase
    .from('professionals')
    .update({
      name: nextName,
      color: nextColor,
      unit_id: nextUnitId,
      is_active: nextActive,
    })
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .select('id, organization_id, unit_id, user_id, name, email, color, is_active')
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: 'Não foi possível atualizar o profissional.' },
      { status: 502 }
    );
  }

  if (Array.isArray(body.specialtyIds)) {
    const specIds = body.specialtyIds.filter(
      (s): s is string => typeof s === 'string'
    );
    await supabase
      .from('professional_specialties')
      .delete()
      .eq('professional_id', id);

    if (specIds.length > 0) {
      await supabase.from('professional_specialties').insert(
        specIds.map((specialty_id) => ({
          professional_id: id,
          specialty_id,
        }))
      );
    }
  }

  const response = NextResponse.json({ professional: updated });
  if (session.refreshed) {
    setSessionCookies(
      response,
      req,
      session.accessToken,
      session.refreshToken
    );
  }
  return response;
}
