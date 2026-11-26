import type { AgendaOrganization, MemberRole } from '@/types/agenda';

export type PatientOperationalStatus =
  | 'em_avaliacao'
  | 'em_tratamento'
  | 'em_acompanhamento'
  | 'alta'
  | 'inativo'
  | 'desistencia';

export type MedicalRecordCategory = 'clinical' | 'administrative' | 'document';

export interface PatientRecord {
  id: string;
  organization_id: string;
  name: string;
  social_name: string | null;
  cpf: string | null;
  cpf_digits: string | null;
  has_no_cpf: boolean;
  alt_identifier_type: string | null;
  alt_identifier_value: string | null;
  birth_date: string | null;
  gender: string | null;
  phone: string | null;
  secondary_phone: string | null;
  email: string | null;
  address_zip: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  legal_guardian_name: string | null;
  legal_guardian_relationship: string | null;
  legal_guardian_phone: string | null;
  legal_guardian_cpf: string | null;
  emergency_contact_name: string | null;
  emergency_contact_relationship: string | null;
  emergency_contact_phone: string | null;
  status: PatientOperationalStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientAuditFieldChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
}

export interface PatientAuditLog {
  id: string;
  organization_id: string;
  patient_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  action: 'created' | 'updated' | 'status_changed';
  changed_fields: PatientAuditFieldChange[];
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export interface MedicalRecordAddendum {
  id: string;
  organization_id: string;
  record_id: string;
  patient_id: string;
  author_user_id: string | null;
  author_name: string;
  author_email: string | null;
  justification: string;
  content: string;
  created_at: string;
}

export interface MedicalRecordEntry {
  id: string;
  organization_id: string;
  patient_id: string;
  appointment_id: string | null;
  professional_id: string | null;
  category: MedicalRecordCategory;
  record_type: string;
  title: string;
  content: string;
  occurred_at: string;
  is_finalized: boolean;
  finalized_at: string | null;
  finalized_by: string | null;
  author_user_id: string | null;
  author_name: string;
  author_email: string | null;
  document_url: string | null;
  document_name: string | null;
  document_mime: string | null;
  document_size_bytes: number | null;
  document_data_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  addenda: MedicalRecordAddendum[];
}

export interface PatientAppointmentSummary {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  professional_name: string;
  specialty_name: string | null;
  notes_admin: string | null;
}

export interface PatientWorkspacePayload {
  organization: AgendaOrganization | null;
  organizations: AgendaOrganization[];
  role: MemberRole;
  isAdmin: boolean;
  canAuthorClinical: boolean;
  patients: PatientRecord[];
  countsByStatus: Record<PatientOperationalStatus, number>;
  migrationPending: boolean;
  needsBootstrap: boolean;
  planLimits: {
    planSlug: string;
    planName: string;
    maxProfessionals: number | null;
    maxPatients: number | null;
  };
}

export interface PatientDetailPayload {
  organization: AgendaOrganization;
  role: MemberRole;
  isAdmin: boolean;
  canAuthorClinical: boolean;
  currentUserId: string;
  patient: PatientRecord;
  records: MedicalRecordEntry[];
  auditLogs: PatientAuditLog[];
  appointments: PatientAppointmentSummary[];
  professionals: { id: string; name: string }[];
  migrationPending: boolean;
}
