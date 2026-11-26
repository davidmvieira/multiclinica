import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import { getPlanBySlug, isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from '@/lib/supabase/server';
import type { MemberRole } from '@/types/agenda';

const ALLOWED_PROF_ROLES: readonly MemberRole[] = [
  'professional',
  'admin',
  'unit_manager',
] as const;

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
  const password = typeof body.password === 'string' ? body.password : '';
  const color =
    typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : '#059669';

  const rawUnitIds = Array.isArray(body.unitIds)
    ? body.unitIds.filter((u): u is string => typeof u === 'string' && u.trim() !== '')
    : [];
  const fallbackUnitId =
    typeof body.unitId === 'string' && body.unitId.trim()
      ? body.unitId.trim()
      : null;
  const unitIds = Array.from(
    new Set(
      rawUnitIds.length > 0
        ? rawUnitIds
        : fallbackUnitId
          ? [fallbackUnitId]
          : []
    )
  );
  const primaryUnitId = unitIds[0] ?? null;

  const userId =
    typeof body.userId === 'string' && body.userId.trim()
      ? body.userId.trim()
      : null;
  const phone =
    typeof body.phone === 'string' ? body.phone.trim().slice(0, 40) : '';
  const councilNumber =
    typeof body.councilNumber === 'string'
      ? body.councilNumber.trim().slice(0, 40)
      : '';
  const specialtyIds = Array.isArray(body.specialtyIds)
    ? body.specialtyIds.filter((s): s is string => typeof s === 'string')
    : [];
  const slotDuration =
    typeof body.slotDurationMinutes === 'number' &&
    body.slotDurationMinutes >= 10 &&
    body.slotDurationMinutes <= 240
      ? Math.round(body.slotDurationMinutes)
      : 60;
  const requestedRole: MemberRole =
    typeof body.memberRole === 'string' &&
    (ALLOWED_PROF_ROLES as readonly string[]).includes(body.memberRole)
      ? (body.memberRole as MemberRole)
      : 'professional';

  if (!name || name.length > 120) {
    return NextResponse.json(
      { error: 'Informe o nome do profissional (até 120 caracteres).' },
      { status: 400 }
    );
  }

  if (password && (password.length < 6 || password.length > 128)) {
    return NextResponse.json(
      { error: 'A senha de acesso deve ter entre 6 e 128 caracteres.' },
      { status: 400 }
    );
  }

  if (password && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return NextResponse.json(
      { error: 'Informe um e-mail válido para criar a conta de acesso.' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServerClient(session.accessToken);
  const { context } = await resolveAgendaAccessContext(
    supabase,
    session.user.id,
    session.user.email,
    session.activeOrganizationId
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

  const isTopAdmin =
    context.organization.owner_user_id === session.user.id ||
    context.role === 'admin';
  const effectiveMemberRole: MemberRole =
    requestedRole === 'admin' && !isTopAdmin ? 'professional' : requestedRole;

  if (unitIds.length > 0) {
    const { data: unitRows } = await supabase
      .from('units')
      .select('id')
      .eq('organization_id', context.organization.id)
      .in('id', unitIds);

    if (!unitRows || unitRows.length !== unitIds.length) {
      return NextResponse.json(
        { error: 'Uma ou mais unidades selecionadas não pertencem a esta clínica.' },
        { status: 400 }
      );
    }
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

  // Resolve or create Auth user + organization_members entry when e-mail is informed
  let resolvedUserId = userId;
  let authCreated = false;
  let authConfirmed = false;

  if (!resolvedUserId && email) {
    const adminClient = createSupabaseAdminClient();
    if (adminClient) {
      if (password) {
        const { data: createdAuth, error: adminErr } =
          await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
              full_name: name,
              organization_id: context.organization.id,
              role: effectiveMemberRole,
            },
          });

        if (!adminErr && createdAuth.user) {
          resolvedUserId = createdAuth.user.id;
          authCreated = true;
          authConfirmed = true;
        } else {
          const msg = (adminErr?.message ?? '').toLowerCase();
          if (msg.includes('already') || msg.includes('exists')) {
            const { data: listData } = await adminClient.auth.admin.listUsers({
              page: 1,
              perPage: 1000,
            });
            const matched = listData?.users?.find(
              (u) => (u.email ?? '').toLowerCase() === email
            );
            if (matched) {
              resolvedUserId = matched.id;
              authConfirmed = true;
            }
          }
        }
      } else {
        const { data: listData } = await adminClient.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        const matched = listData?.users?.find(
          (u) => (u.email ?? '').toLowerCase() === email
        );
        if (matched) {
          resolvedUserId = matched.id;
          authConfirmed = true;
        }
      }
    } else if (password) {
      const anonClient = createSupabaseServerClient();
      const { data: signUpData, error: signUpErr } = await anonClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            organization_id: context.organization.id,
            role: effectiveMemberRole,
          },
        },
      });

      if (!signUpErr && signUpData.user) {
        if (
          Array.isArray(signUpData.user.identities) &&
          signUpData.user.identities.length > 0
        ) {
          resolvedUserId = signUpData.user.id;
          authCreated = true;
          authConfirmed = Boolean(signUpData.session);
        }
      } else if (signUpErr) {
        const code = (signUpErr as { code?: string }).code ?? '';
        const rawMsg = (signUpErr.message ?? '').toLowerCase();
        if (
          code !== 'user_already_exists' &&
          !rawMsg.includes('already registered') &&
          !rawMsg.includes('already exists')
        ) {
          return NextResponse.json(
            {
              error:
                signUpErr.message ||
                'Não foi possível criar a conta de acesso do profissional.',
            },
            { status: 400 }
          );
        }
      }
    }
  }

  const baseInsert = {
    organization_id: context.organization.id,
    unit_id: primaryUnitId,
    user_id: resolvedUserId,
    name,
    email: email || null,
    color,
    is_active: true,
  };

  let { data: prof, error: profError } = await supabase
    .from('professionals')
    .insert({
      ...baseInsert,
      ...(phone ? { phone } : {}),
      ...(councilNumber ? { council_number: councilNumber } : {}),
    })
    .select('id, organization_id, unit_id, user_id, name, email, color, is_active')
    .single();

  if (profError && profError.code === '42703') {
    const fallback = await supabase
      .from('professionals')
      .insert(baseInsert)
      .select('id, organization_id, unit_id, user_id, name, email, color, is_active')
      .single();
    prof = fallback.data;
    profError = fallback.error;
  }

  if (profError || !prof) {
    return NextResponse.json(
      { error: 'Não foi possível cadastrar o profissional.' },
      { status: 502 }
    );
  }

  // Ensure organization_members link exists when email is provided
  if (email) {
    const { data: existingMemberByEmail } = await supabase
      .from('organization_members')
      .select('id, user_id')
      .eq('organization_id', context.organization.id)
      .ilike('email', email)
      .maybeSingle();

    if (!existingMemberByEmail) {
      const baseMember = {
        organization_id: context.organization.id,
        user_id: resolvedUserId,
        unit_id: primaryUnitId,
        role: effectiveMemberRole,
        display_name: name,
        email,
      };

      const { error: memberInsertErr } = await supabase
        .from('organization_members')
        .insert({
          ...baseMember,
          ...(phone ? { phone } : {}),
          is_active: true,
          invite_status: resolvedUserId ? 'active' : 'pending',
        });

      if (memberInsertErr && memberInsertErr.code === '42703') {
        await supabase.from('organization_members').insert(baseMember);
      }
    }

    // Confirma e vincula no banco (caso já exista em auth.users ou tenha sido criado via signUp sem SMTP)
    try {
      const { data: confirmed } = await supabase.rpc(
        'confirm_org_member_auth_user',
        {
          target_org_id: context.organization.id,
          member_email: email,
        }
      );
      if (confirmed === true) {
        authConfirmed = true;
      } else {
        await supabase.rpc('link_auth_user_to_org_member', {
          target_org_id: context.organization.id,
          member_email: email,
        });
      }

      const { data: refreshedProf } = await supabase
        .from('professionals')
        .select('id, organization_id, unit_id, user_id, name, email, color, is_active')
        .eq('id', prof.id)
        .maybeSingle();
      if (refreshedProf) {
        prof = refreshedProf;
        if (refreshedProf.user_id) {
          resolvedUserId = refreshedProf.user_id;
        }
      }
    } catch {
      // Non-blocking if SQL migration 5/6 has not been applied yet
    }
  }

  if (unitIds.length > 0) {
    try {
      await supabase.from('professional_units').insert(
        unitIds.map((unit_id) => ({
          professional_id: prof!.id,
          unit_id,
        }))
      );
    } catch {
      // Non-blocking if professional_units table not created yet
    }
  }

  if (specialtyIds.length > 0) {
    await supabase.from('professional_specialties').insert(
      specialtyIds.map((specialty_id) => ({
        professional_id: prof!.id,
        specialty_id,
      }))
    );
  }

  const { data: schedule, error: schedError } = await supabase
    .from('schedules')
    .insert({
      organization_id: context.organization.id,
      unit_id: primaryUnitId,
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
    new_values: {
      professional_name: name,
      schedule_id: schedule.id,
      unit_ids: unitIds,
      linked_user_id: resolvedUserId,
    },
  });

  let notice = `${name} e sua agenda independente foram criados.`;
  if (email && authCreated && authConfirmed) {
    notice = `${name} foi cadastrado com conta de acesso ativa para entrar em /login.`;
  } else if (email && authCreated && !authConfirmed) {
    notice = `${name} foi cadastrado. Caso o Supabase exija confirmação, use "Esqueci minha senha" no login ou aplique a Seção 6 do sql.md.`;
  } else if (email && resolvedUserId) {
    notice = `${name} foi vinculado à conta existente (${email}) e já pode alternar entre clínicas.`;
  } else if (email) {
    notice = `${name} foi pré-cadastrado com ${email}. Ao criar conta em /login, o vínculo com a clínica será automático.`;
  }

  const response = NextResponse.json(
    {
      professional: {
        ...prof,
        unit_ids: unitIds,
        specialty_ids: specialtyIds,
      },
      schedule,
      notice,
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
    session.user.email,
    session.activeOrganizationId
  );

  if (!context || !context.isAdmin) {
    return NextResponse.json(
      { error: 'Apenas administradores podem atualizar profissionais.' },
      { status: 403 }
    );
  }

  const { data: existing } = await supabase
    .from('professionals')
    .select('id, organization_id, unit_id, user_id, name, email, color, is_active')
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
  const nextEmail =
    body.email === null
      ? null
      : typeof body.email === 'string'
        ? body.email.trim().toLowerCase() || null
        : existing.email;
  const nextUserId =
    body.userId === null || body.userId === ''
      ? body.userId === undefined
        ? existing.user_id
        : null
      : typeof body.userId === 'string'
        ? body.userId.trim()
        : existing.user_id;
  const nextColor =
    typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : existing.color;

  const hasUnitIdsArray = Array.isArray(body.unitIds);
  const parsedUnitIds = hasUnitIdsArray
    ? Array.from(
        new Set(
          (body.unitIds as unknown[]).filter(
            (u): u is string => typeof u === 'string' && u.trim() !== ''
          )
        )
      )
    : null;

  const nextUnitId = parsedUnitIds
    ? parsedUnitIds[0] ?? null
    : body.unitId === null
      ? null
      : typeof body.unitId === 'string'
        ? body.unitId.trim() || null
        : existing.unit_id;

  const nextActive =
    typeof body.isActive === 'boolean' ? body.isActive : existing.is_active;

  const unitsToValidate = parsedUnitIds ?? (nextUnitId ? [nextUnitId] : []);
  if (unitsToValidate.length > 0) {
    const { data: unitRows } = await supabase
      .from('units')
      .select('id')
      .eq('organization_id', context.organization.id)
      .in('id', unitsToValidate);

    if (!unitRows || unitRows.length !== unitsToValidate.length) {
      return NextResponse.json(
        { error: 'Uma ou mais unidades selecionadas não pertencem a esta clínica.' },
        { status: 400 }
      );
    }
  }

  if (!existing.is_active && nextActive) {
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
            error: `Seu plano ${planDef.name} permite até ${planDef.max_professionals} ${
              planDef.max_professionals === 1
                ? 'profissional ativo'
                : 'profissionais ativos'
            }.`,
            code: 'PLAN_LIMIT_REACHED',
          },
          { status: 403 }
        );
      }
    }
  }

  const baseUpdate = {
    name: nextName,
    email: nextEmail,
    user_id: nextUserId,
    color: nextColor,
    unit_id: nextUnitId,
    is_active: nextActive,
  };

  const extraUpdate: Record<string, unknown> = { ...baseUpdate };
  if (typeof body.phone === 'string') {
    extraUpdate.phone = body.phone.trim().slice(0, 40) || null;
  }
  if (typeof body.councilNumber === 'string') {
    extraUpdate.council_number = body.councilNumber.trim().slice(0, 40) || null;
  }

  let { data: updated, error } = await supabase
    .from('professionals')
    .update(extraUpdate)
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .select('id, organization_id, unit_id, user_id, name, email, color, is_active')
    .single();

  if (error && error.code === '42703') {
    const fallback = await supabase
      .from('professionals')
      .update(baseUpdate)
      .eq('organization_id', context.organization.id)
      .eq('id', id)
      .select('id, organization_id, unit_id, user_id, name, email, color, is_active')
      .single();
    updated = fallback.data;
    error = fallback.error;
  }

  if (error || !updated) {
    return NextResponse.json(
      { error: 'Não foi possível atualizar o profissional.' },
      { status: 502 }
    );
  }

  const scheduleUpdate: Record<string, unknown> = {
    name: `Agenda — ${nextName}`,
    unit_id: nextUnitId,
    is_active: nextActive,
  };
  if (
    typeof body.slotDurationMinutes === 'number' &&
    body.slotDurationMinutes >= 10 &&
    body.slotDurationMinutes <= 240
  ) {
    scheduleUpdate.slot_duration_minutes = Math.round(body.slotDurationMinutes);
  }

  await supabase
    .from('schedules')
    .update(scheduleUpdate)
    .eq('organization_id', context.organization.id)
    .eq('professional_id', id);

  if (parsedUnitIds !== null) {
    try {
      await supabase
        .from('professional_units')
        .delete()
        .eq('professional_id', id);

      if (parsedUnitIds.length > 0) {
        await supabase.from('professional_units').insert(
          parsedUnitIds.map((unit_id) => ({
            professional_id: id,
            unit_id,
          }))
        );
      }
    } catch {
      // Non-blocking if professional_units table does not exist yet
    }
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

  const response = NextResponse.json({
    professional: {
      ...updated,
      ...(parsedUnitIds !== null ? { unit_ids: parsedUnitIds } : {}),
    },
  });
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
