import type {
  AgendaOrganization,
  AgendaProfessional,
  AgendaSchedule,
  AgendaSpecialty,
  AgendaUnit,
  MemberRole,
} from '@/types/agenda';

export type OrganizationInviteStatus = 'active' | 'pending' | 'inactive';

export interface SettingsMember {
  id: string;
  organization_id: string;
  user_id: string | null;
  unit_id: string | null;
  role: MemberRole;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  invite_status: OrganizationInviteStatus;
  created_at: string;
  is_owner: boolean;
}

export interface SettingsProfessional extends AgendaProfessional {
  phone?: string | null;
  council_number?: string | null;
  schedule?: Pick<
    AgendaSchedule,
    'id' | 'slot_duration_minutes' | 'is_active' | 'allow_overbooking'
  > | null;
}

export interface SettingsUnit extends AgendaUnit {
  phone?: string | null;
  created_at?: string;
}

export interface SettingsPayload {
  organization: AgendaOrganization | null;
  currentUserId: string;
  role: MemberRole;
  isAdmin: boolean;
  isOwner: boolean;
  hasServiceRole: boolean;
  needsBootstrap: boolean;
  settingsMigrationPending: boolean;
  members: SettingsMember[];
  units: SettingsUnit[];
  professionals: SettingsProfessional[];
  specialties: AgendaSpecialty[];
  patientCount: number;
  planLimits: {
    planSlug: string;
    planName: string;
    maxProfessionals: number | null;
    maxPatients: number | null;
  };
}
