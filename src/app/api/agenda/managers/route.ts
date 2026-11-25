import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { MemberRole } from '@/types/agenda';

const VALID_ROLES: MemberRole[] = [
  'admin',
  'unit_manager',
  'reception',
  'professional',
  'delegated_manager',
];

function isValidRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && VALID_ROLES.includes(value as MemberRole);
}

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

  const scheduleId =
    typeof body.scheduleId === 'string' ? body.scheduleId.trim() : '';
  const managerName =
    typeof body.managerName === 'string' ? body.managerName.trim() : '';
  const managerEmail =
    typeof body.managerEmail === 'string'
      ? body.managerEmail.trim().toLowerCase()
      : '';
  const role: MemberRole = isValidRole(body.role)
    ? body.role
    : 'delegated_manager';
  const canView = body.canView !== false;
  const canManageAppointments = Boolean(body.canManageAppointments);
  const canManageAvailability = Boolean(body.canManageAvailability);
  const canManageBlocks = Boolean(body.canManageBlocks);

  if (!scheduleId || !managerName || !managerEmail.includes('@')) {
    return NextResponse.json(
      { error: 'Informe a agenda, o nome e o e-mail válido do gestor.' },
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
          'Apenas administradores ou gestores autorizados podem delegar permissões de agenda.',
      },
      { status: 403 }
    );
  }

  const scheduleExists = context.visibleSchedules.some(
    (s) => s.id === scheduleId
  );
  if (!scheduleExists) {
    return NextResponse.json(
      { error: 'Agenda não encontrada nesta clínica.' },
      { status: 404 }
    );
  }

  const { data: manager, error } = await supabase
    .from('schedule_managers')
    .upsert(
      {
        organization_id: context.organization.id,
        schedule_id: scheduleId,
        manager_name: managerName.slice(0, 120),
        manager_email: managerEmail.slice(0, 180),
        role,
        can_view: canView,
        can_manage_appointments: canManageAppointments,
        can_manage_availability: canManageAvailability,
        can_manage_blocks: canManageBlocks,
      },
      { onConflict: 'schedule_id,manager_email' }
    )
    .select(
      'id, organization_id, schedule_id, user_id, manager_name, manager_email, role, can_view, can_manage_appointments, can_manage_availability, can_manage_blocks'
    )
    .single();

  if (error || !manager) {
    return NextResponse.json(
      { error: 'Não foi possível vincular o gestor à agenda.' },
      { status: 502 }
    );
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    schedule_id: scheduleId,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'assign_schedule_manager',
    new_values: {
      manager_name: manager.manager_name,
      manager_email: manager.manager_email,
      role: manager.role,
      can_view: manager.can_view,
      can_manage_appointments: manager.can_manage_appointments,
      can_manage_availability: manager.can_manage_availability,
      can_manage_blocks: manager.can_manage_blocks,
    },
  });

  const response = NextResponse.json({ manager }, { status: 201 });
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
      { error: 'Identificador do vínculo ausente.' },
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
      { error: 'Apenas administradores podem editar permissões.' },
      { status: 403 }
    );
  }

  const { data: existing } = await supabase
    .from('schedule_managers')
    .select(
      'id, organization_id, schedule_id, manager_name, manager_email, role, can_view, can_manage_appointments, can_manage_availability, can_manage_blocks'
    )
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: 'Gestor delegado não encontrado.' },
      { status: 404 }
    );
  }

  const updates = {
    role: isValidRole(body.role) ? body.role : existing.role,
    can_view:
      typeof body.canView === 'boolean' ? body.canView : existing.can_view,
    can_manage_appointments:
      typeof body.canManageAppointments === 'boolean'
        ? body.canManageAppointments
        : existing.can_manage_appointments,
    can_manage_availability:
      typeof body.canManageAvailability === 'boolean'
        ? body.canManageAvailability
        : existing.can_manage_availability,
    can_manage_blocks:
      typeof body.canManageBlocks === 'boolean'
        ? body.canManageBlocks
        : existing.can_manage_blocks,
  };

  const { data: updated, error } = await supabase
    .from('schedule_managers')
    .update(updates)
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .select(
      'id, organization_id, schedule_id, user_id, manager_name, manager_email, role, can_view, can_manage_appointments, can_manage_availability, can_manage_blocks'
    )
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: 'Não foi possível atualizar as permissões.' },
      { status: 502 }
    );
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    schedule_id: updated.schedule_id,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'update_schedule_manager',
    previous_values: {
      role: existing.role,
      can_view: existing.can_view,
      can_manage_appointments: existing.can_manage_appointments,
      can_manage_availability: existing.can_manage_availability,
      can_manage_blocks: existing.can_manage_blocks,
    },
    new_values: updates,
  });

  const response = NextResponse.json({ manager: updated });
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

export async function DELETE(req: NextRequest) {
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

  const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
  if (!id) {
    return NextResponse.json(
      { error: 'Identificador do gestor ausente.' },
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
      { error: 'Apenas administradores podem remover gestores da agenda.' },
      { status: 403 }
    );
  }

  const { data: existing } = await supabase
    .from('schedule_managers')
    .select('id, schedule_id, manager_name, manager_email')
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: 'Gestor não encontrado.' },
      { status: 404 }
    );
  }

  // Delete ONLY the delegation record — never the schedule or appointments
  const { error } = await supabase
    .from('schedule_managers')
    .delete()
    .eq('organization_id', context.organization.id)
    .eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Não foi possível remover o gestor.' },
      { status: 502 }
    );
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    schedule_id: existing.schedule_id,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'remove_schedule_manager',
    previous_values: {
      manager_name: existing.manager_name,
      manager_email: existing.manager_email,
    },
  });

  const response = NextResponse.json({ ok: true });
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
