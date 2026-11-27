import type { AgendaOrganization, MemberRole } from '@/types/agenda';

export type EvaluationFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'scale_eva'
  | 'scale_mrc'
  | 'date';

export interface EvaluationFieldDefinition {
  id: string;
  label: string;
  type: EvaluationFieldType;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface EvaluationSectionDefinition {
  id: string;
  order: number;
  title: string;
  description?: string;
  is_restricted_to_author: boolean;
  fields: EvaluationFieldDefinition[];
}

export interface EvaluationTemplateSchema {
  sections: EvaluationSectionDefinition[];
  homologationNote: string;
}

export interface EvaluationTemplateRecord {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  category_label: string;
  description: string | null;
  current_version_number: number;
  current_version_id: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvaluationTemplateVersionRecord {
  id: string;
  organization_id: string;
  template_id: string;
  version_number: number;
  changelog: string | null;
  schema_json: EvaluationTemplateSchema;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
}

export type EvaluationStatus = 'draft' | 'finalized';

export type EvaluationAnswerValue = string | number | boolean | string[] | null;

export interface EvaluationRecord {
  id: string;
  organization_id: string;
  patient_id: string;
  patient_name?: string;
  patient_cpf?: string | null;
  professional_id: string | null;
  template_id: string;
  template_version_id: string;
  template_version_number: number;
  template_name: string;
  status: EvaluationStatus;
  answers: Record<string, EvaluationAnswerValue>;
  shared_summary: string | null;
  functional_diagnosis: string | null;
  cbdf_code: string | null;
  cbdf_description: string | null;
  procedure_code: string | null;
  procedure_description: string | null;
  author_user_id: string;
  author_name: string;
  author_council_number: string | null;
  finalized_at_utc: string | null;
  created_at: string;
  updated_at: string;
  viewerIsAuthor?: boolean;
  restrictedSectionIds?: string[];
}

export type EvaluationAuditAction =
  | 'OPEN_DRAFT'
  | 'VIEW_EVALUATION'
  | 'FINALIZE_EVALUATION'
  | 'EXPORT_PDF'
  | 'SHARE_SUMMARY'
  | 'DENIED_RESTRICTED_ACCESS';

export interface EvaluationAuditEvent {
  id: string;
  organization_id: string;
  evaluation_id: string;
  patient_id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  action_executed: EvaluationAuditAction;
  source_ip: string;
  timestamp_utc: string;
  details: Record<string, unknown>;
}

export interface EvaluationPatientOption {
  id: string;
  name: string;
  cpf: string | null;
  status: string;
}

export interface CbdfCatalogItem {
  code: string;
  chapter: string;
  description: string;
}

export interface ProcedureCodeOption {
  code: string;
  table: string;
  description: string;
}

export interface EvaluationsWorkspacePayload {
  organization: AgendaOrganization | null;
  organizations: AgendaOrganization[];
  role: MemberRole;
  isAdmin: boolean;
  canAuthorClinical: boolean;
  currentUserId: string;
  currentUserName: string;
  currentUserCouncilNumber: string | null;
  currentProfessionalId: string | null;
  templates: EvaluationTemplateRecord[];
  versions: EvaluationTemplateVersionRecord[];
  evaluations: EvaluationRecord[];
  patients: EvaluationPatientOption[];
  auditEvents: EvaluationAuditEvent[];
  migrationPending: boolean;
  needsBootstrap: boolean;
  planLimits: {
    planSlug: string;
    planName: string;
    maxProfessionals: number | null;
    maxPatients: number | null;
  };
}
