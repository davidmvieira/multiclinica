import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AgendaOrganization,
  AgendaProfessional,
  AgendaSchedule,
  AgendaScheduleManager,
  MemberRole,
  SchedulePermissionFlags,
} from '@/types/agenda';

export interface AgendaAccessContext {
  organization: AgendaOrganization;
  organizations: AgendaOrganization[];
  role: MemberRole;
  isAdmin: boolean;
  unitId: string | null;
  permissionsBySchedule: Record<string, SchedulePermissionFlags>;
  visibleSchedules: AgendaSchedule[];
}

export function isMissingAgendaTableError(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    error.code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    msg.includes('could not find the') ||
    msg.includes('does not exist')
  );
}

export async function resolveAgendaAccessContext(
  supabase: SupabaseClient,
  userId: string,
  userEmail: string,
  preferredOrgId?: string | null
): Promise<{
  context: AgendaAccessContext | null;
  migrationPending: boolean;
}> {
  let { data: visibleOrgs, error: orgError } = await supabase
    .from('organizations')
    .select('id, owner_user_id, name, timezone')
    .order('created_at', { ascending: true });

  const needsClaimAttempt =
    !orgError &&
    (!visibleOrgs ||
      visibleOrgs.length === 0 ||
      (preferredOrgId && !visibleOrgs.some((o) => o.id === preferredOrgId)));

  if (needsClaimAttempt) {
    // Attempt to claim any pre-registered membership or professional matching the authenticated email
    const { error: claimErr } = await supabase.rpc('claim_pending_org_memberships');
    if (!claimErr) {
      const retry = await supabase
        .from('organizations')
        .select('id, owner_user_id, name, timezone')
        .order('created_at', { ascending: true });
      visibleOrgs = retry.data;
      orgError = retry.error;
    }
  }

  if (orgError) {
    if (isMissingAgendaTableError(orgError)) {
      return { context: null, migrationPending: true };
    }
    throw new Error(
      `[organizations:${orgError.code ?? 'ERR'}] ${orgError.message ?? 'Erro ao consultar organizations'}`
    );
  }

  const organizations = (visibleOrgs ?? []) as AgendaOrganization[];
  if (organizations.length === 0) {
    return { context: null, migrationPending: false };
  }

  const organization =
    (preferredOrgId
      ? organizations.find((o) => o.id === preferredOrgId)
      : undefined) ??
    organizations.find((o) => o.owner_user_id === userId) ??
    organizations[0];

  const isOwner = organization.owner_user_id === userId;

  const [membersRes, schedulesRes, professionalsRes, managersRes] =
    await Promise.all([
      supabase
        .from('organization_members')
        .select('role, unit_id')
        .eq('organization_id', organization.id)
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('schedules')
        .select(
          'id, organization_id, unit_id, professional_id, name, slot_duration_minutes, min_advance_minutes, allow_overbooking, is_active'
        )
        .eq('organization_id', organization.id),
      supabase
        .from('professionals')
        .select('id, user_id')
        .eq('organization_id', organization.id),
      supabase
        .from('schedule_managers')
        .select(
          'id, organization_id, schedule_id, user_id, manager_name, manager_email, role, can_view, can_manage_appointments, can_manage_availability, can_manage_blocks'
        )
        .eq('organization_id', organization.id),
    ]);

  const firstQueryError =
    membersRes.error ||
    schedulesRes.error ||
    professionalsRes.error ||
    managersRes.error;

  if (firstQueryError) {
    if (isMissingAgendaTableError(firstQueryError)) {
      return { context: null, migrationPending: true };
    }
    throw new Error(
      `[agenda_context:${firstQueryError.code ?? 'ERR'}] ${firstQueryError.message ?? 'Erro ao carregar contexto'}`
    );
  }

  const memberRow = membersRes.data as {
    role: MemberRole;
    unit_id: string | null;
  } | null;

  const role: MemberRole = isOwner
    ? 'admin'
    : memberRow?.role ?? 'delegated_manager';
  const isAdmin = isOwner || role === 'admin' || role === 'unit_manager';
  const unitId = memberRow?.unit_id ?? null;

  const allSchedules = (schedulesRes.data ?? []) as AgendaSchedule[];
  const allProfessionals = (professionalsRes.data ?? []) as Pick<
    AgendaProfessional,
    'id' | 'user_id'
  >[];
  const allManagers = (managersRes.data ?? []) as AgendaScheduleManager[];

  const ownProfIds = new Set(
    allProfessionals.filter((p) => p.user_id === userId).map((p) => p.id)
  );

  const permissionsBySchedule: Record<string, SchedulePermissionFlags> = {};
  const visibleSchedules: AgendaSchedule[] = [];
  const normalizedUserEmail = (userEmail ?? '').toLowerCase();

  for (const schedule of allSchedules) {
    if (isOwner || role === 'admin') {
      permissionsBySchedule[schedule.id] = {
        can_view: true,
        can_manage_appointments: true,
        can_manage_availability: true,
        can_manage_blocks: true,
      };
      visibleSchedules.push(schedule);
      continue;
    }

    if (role === 'unit_manager' && (!unitId || unitId === schedule.unit_id)) {
      permissionsBySchedule[schedule.id] = {
        can_view: true,
        can_manage_appointments: true,
        can_manage_availability: true,
        can_manage_blocks: true,
      };
      visibleSchedules.push(schedule);
      continue;
    }

    if (ownProfIds.has(schedule.professional_id)) {
      permissionsBySchedule[schedule.id] = {
        can_view: true,
        can_manage_appointments: true,
        can_manage_availability: true,
        can_manage_blocks: true,
      };
      visibleSchedules.push(schedule);
      continue;
    }

    const delegated = allManagers.find(
      (m) =>
        m.schedule_id === schedule.id &&
        (m.user_id === userId ||
          (m.manager_email ?? '').toLowerCase() === normalizedUserEmail)
    );

    if (delegated && delegated.can_view) {
      permissionsBySchedule[schedule.id] = {
        can_view: delegated.can_view,
        can_manage_appointments: delegated.can_manage_appointments,
        can_manage_availability: delegated.can_manage_availability,
        can_manage_blocks: delegated.can_manage_blocks,
      };
      visibleSchedules.push(schedule);
    }
  }

  return {
    context: {
      organization,
      organizations,
      role,
      isAdmin,
      unitId,
      permissionsBySchedule,
      visibleSchedules,
    },
    migrationPending: false,
  };
}
