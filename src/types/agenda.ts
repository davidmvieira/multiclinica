export type AppointmentStatus =
  | 'pending'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'awaiting_service'
  | 'in_service'
  | 'completed'
  | 'canceled'
  | 'no_show';

export type MemberRole =
  | 'admin'
  | 'unit_manager'
  | 'reception'
  | 'professional'
  | 'delegated_manager';

export interface AgendaOrganization {
  id: string;
  owner_user_id: string;
  name: string;
  timezone: string;
}

export interface AgendaUnit {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  timezone: string;
  is_active: boolean;
}

export interface AgendaSpecialty {
  id: string;
  organization_id: string;
  name: string;
  color: string;
}

export interface AgendaProfessional {
  id: string;
  organization_id: string;
  unit_id: string | null;
  unit_ids?: string[];
  user_id: string | null;
  name: string;
  email: string | null;
  color: string;
  is_active: boolean;
  specialty_ids: string[];
}

export interface AgendaSchedule {
  id: string;
  organization_id: string;
  unit_id: string | null;
  professional_id: string;
  name: string;
  slot_duration_minutes: number;
  min_advance_minutes: number;
  allow_overbooking: boolean;
  is_active: boolean;
}

export interface AgendaScheduleManager {
  id: string;
  organization_id: string;
  schedule_id: string;
  user_id: string | null;
  manager_name: string;
  manager_email: string;
  role: MemberRole;
  can_view: boolean;
  can_manage_appointments: boolean;
  can_manage_availability: boolean;
  can_manage_blocks: boolean;
}

export interface AgendaAvailabilityRule {
  id: string;
  organization_id: string;
  schedule_id: string;
  day_of_week: number; // 0 = Domingo .. 6 = Sábado
  start_time: string; // HH:MM:SS
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  is_active: boolean;
}

export interface AgendaBlock {
  id: string;
  organization_id: string;
  unit_id: string | null;
  schedule_id: string | null;
  title: string;
  reason: string | null;
  starts_at: string;
  ends_at: string;
  is_recurring: boolean;
}

export interface AgendaPatient {
  id: string;
  organization_id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface AgendaService {
  id: string;
  organization_id: string;
  specialty_id: string | null;
  name: string;
  duration_minutes: number;
  is_active: boolean;
}

export interface AgendaAppointment {
  id: string;
  organization_id: string;
  unit_id: string | null;
  schedule_id: string;
  professional_id: string;
  patient_id: string;
  service_id: string | null;
  specialty_id: string | null;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  is_fit_in: boolean;
  recurrence_group_id: string | null;
  notes_admin: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgendaAuditLog {
  id: string;
  organization_id: string;
  appointment_id: string | null;
  schedule_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
}

export interface SchedulePermissionFlags {
  can_view: boolean;
  can_manage_appointments: boolean;
  can_manage_availability: boolean;
  can_manage_blocks: boolean;
}

export interface AgendaWorkspacePayload {
  organization: AgendaOrganization | null;
  organizations?: AgendaOrganization[];
  role: MemberRole;
  isAdmin: boolean;
  permissionsBySchedule: Record<string, SchedulePermissionFlags>;
  units: AgendaUnit[];
  specialties: AgendaSpecialty[];
  professionals: AgendaProfessional[];
  schedules: AgendaSchedule[];
  managers: AgendaScheduleManager[];
  availabilityRules: AgendaAvailabilityRule[];
  blocks: AgendaBlock[];
  patients: AgendaPatient[];
  services: AgendaService[];
  appointments: AgendaAppointment[];
  auditLogs: AgendaAuditLog[];
  planLimits: {
    planSlug: string;
    planName: string;
    maxProfessionals: number | null;
    maxPatients: number | null;
  };
}
