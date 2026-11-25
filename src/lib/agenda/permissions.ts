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
    error.code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  );
}

export async function resolveAgendaAccessContext(
  supabase: SupabaseClient,
  userId: string,
  userEmail: string
): Promise<{
  context: AgendaAccessContext | null;
  migrationPending: boolean;
}> {
  const { data: ownedOrgs, error: orgError } = await supabase
    .from('organizations')
    .select('id, owner_user_id, name, timezone')
    .limit(1);

  if (orgError) {
    if (isMissingAgendaTableError(orgError)) {
      return { context: null, migrationPending: true };
    }
    throw orgError;
  }

  const organization = (ownedOrgs?.[0] ?? null) as AgendaOrganization | null;
  if (!organization) {
    return { context: null, migrationPending: false };
  }

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
          m.manager_email.toLowerCase() === userEmail.toLowerCase())
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
      role,
      isAdmin,
      unitId,
      permissionsBySchedule,
      visibleSchedules,
    },
    migrationPending: false,
  };
}
