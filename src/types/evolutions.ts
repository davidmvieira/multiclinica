import type { AgendaOrganization, MemberRole } from '@/types/agenda';
import type {
  EvaluationRecord,
  EvaluationTemplateVersionRecord,
} from '@/types/evaluations';
import type {
  MedicalRecordEntry,
  PatientRecord,
} from '@/types/patients';

export type ClinicalEvolutionStatus = 'draft' | 'finalized';
export type ClinicalEvolutionAdherence = 'total' | 'parcial' | 'baixa';
export type EvolutionPendencyStatus = 'pending' | 'resolved' | 'canceled';

export interface EvolutionRectificationRecord {
  id: string;
  organization_id: string;
  evolution_id: string;
  patient_id: string;
  rectified_content: string;
  justification: string;
  author_user_id: string;
  author_name: string;
  author_council_number: string | null;
  source_ip: string;
  created_at_utc: string;
}

export interface ClinicalEvolutionRecord {
  id: string;
  organization_id: string;
  patient_id: string;
  appointment_id: string;
  professional_id: string | null;
  unit_id: string | null;
  status: ClinicalEvolutionStatus;
  shared_clinical_note: string;
  procedures_performed: string | null;
  patient_response: string | null;
  eva_before: number | null;
  eva_after: number | null;
  adherence_level: ClinicalEvolutionAdherence | null;
  next_session_plan: string | null;
  restricted_clinical_record: string | null;
  restricted_category: string | null;
  author_user_id: string;
  author_name: string;
  author_council_number: string | null;
  source_ip: string;
  finalized_at_utc: string | null;
  created_at: string;
  updated_at: string;
  viewerIsAuthor?: boolean;
  restrictedRecordHidden?: boolean;
  patient_name?: string;
  patient_cpf?: string | null;
  appointment_starts_at?: string | null;
  appointment_ends_at?: string | null;
  service_name?: string | null;
  unit_name?: string | null;
  rectifications?: EvolutionRectificationRecord[];
}

export interface EvolutionPendencyRecord {
  id: string;
  organization_id: string;
  appointment_id: string;
  patient_id: string;
  professional_id: string;
  schedule_id: string | null;
  unit_id: string | null;
  session_starts_at: string;
  session_ends_at: string;
  status: EvolutionPendencyStatus;
  evolution_id: string | null;
  resolved_at_utc: string | null;
  created_at: string;
  updated_at: string;
  patient_name: string;
  patient_cpf: string | null;
  professional_name: string;
  professional_user_id: string | null;
  unit_name: string | null;
  service_name: string | null;
  specialty_name: string | null;
  draft_evolution_id: string | null;
}

export type ClinicalEvolutionAuditAction =
  | 'CREATE_DRAFT'
  | 'VIEW_EVOLUTION'
  | 'FINALIZE_EVOLUTION'
  | 'ADD_RECTIFICATION'
  | 'EXPORT_PDF'
  | 'SHARE_SUMMARY'
  | 'EXPORT_OFFICIAL_RECORD'
  | 'DENIED_RESTRICTED_ACCESS';

export interface ClinicalEvolutionAuditEvent {
  id: string;
  organization_id: string;
  evolution_id: string | null;
  patient_id: string;
  appointment_id: string | null;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  action_executed: ClinicalEvolutionAuditAction;
  source_ip: string;
  timestamp_utc: string;
  details: Record<string, unknown>;
}

export interface EvolutionProfessionalOption {
  id: string;
  user_id: string | null;
  name: string;
  council_number: string | null;
}

export interface EvolutionPatientOption {
  id: string;
  name: string;
  cpf: string | null;
  status: string;
}

export interface EvolutionsWorkspacePayload {
  organization: AgendaOrganization | null;
  organizations: AgendaOrganization[];
  role: MemberRole;
  isAdmin: boolean;
  canAuthorClinical: boolean;
  currentUserId: string;
  currentUserName: string;
  currentUserCouncilNumber: string | null;
  currentProfessionalId: string | null;
  professionals: EvolutionProfessionalOption[];
  patients: EvolutionPatientOption[];
  pendencies: EvolutionPendencyRecord[];
  evolutions: ClinicalEvolutionRecord[];
  auditEvents: ClinicalEvolutionAuditEvent[];
  migrationPending: boolean;
  needsBootstrap: boolean;
  planLimits: {
    planSlug: string;
    planName: string;
    maxProfessionals: number | null;
    maxPatients: number | null;
  };
}

export interface OfficialDossierAppointmentItem {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  professional_name: string;
  professional_council: string | null;
  unit_name: string | null;
  service_name: string | null;
  specialty_name: string | null;
  notes_admin: string | null;
  has_finalized_evolution: boolean;
}

export interface OfficialDossierEvaluationItem {
  evaluation: EvaluationRecord;
  templateVersion: EvaluationTemplateVersionRecord | null;
}

export interface OfficialClinicalDossierPayload {
  issuedAtUtc: string;
  verificationCode: string;
  normativeBasis: string[];
  issuedBy: {
    userId: string;
    name: string;
    email: string;
    councilNumber: string | null;
    sourceIp: string;
  };
  organization: AgendaOrganization;
  patient: PatientRecord;
  appointments: OfficialDossierAppointmentItem[];
  evaluations: OfficialDossierEvaluationItem[];
  evolutions: ClinicalEvolutionRecord[];
  medicalRecords: MedicalRecordEntry[];
  lgpdNotice: string;
}
