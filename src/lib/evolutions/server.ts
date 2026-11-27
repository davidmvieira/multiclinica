import type { SupabaseClient } from '@supabase/supabase-js';

import {
  cleanOptionalText,
  extractSourceIp,
} from '@/lib/evaluations/server';
import type {
  ClinicalEvolutionAdherence,
  ClinicalEvolutionAuditAction,
  ClinicalEvolutionRecord,
} from '@/types/evolutions';

export const CLINICAL_EVOLUTION_AUDIT_LABELS: Record<
  ClinicalEvolutionAuditAction,
  string
> = {
  CREATE_DRAFT: 'Criação / edição de rascunho de evolução',
  VIEW_EVOLUTION: 'Visualização de evolução concluída',
  FINALIZE_EVOLUTION: 'Conclusão e assinatura da evolução',
  ADD_RECTIFICATION: 'Registro de Nota de Retificação',
  EXPORT_PDF: 'Exportação em PDF / impressão',
  SHARE_SUMMARY: 'Compartilhamento de resumo LGPD',
  EXPORT_OFFICIAL_RECORD: 'Exportação de Prontuário Oficial Normatizado',
  DENIED_RESTRICTED_ACCESS: 'Tentativa bloqueada a registro restrito',
};

export const ADHERENCE_LABELS: Record<ClinicalEvolutionAdherence, string> = {
  total: 'Adesão total',
  parcial: 'Adesão parcial',
  baixa: 'Baixa adesão',
};

export function sanitizeEvaScore(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 10) return null;
  return num;
}

export function sanitizeAdherence(
  value: unknown
): ClinicalEvolutionAdherence | null {
  if (value === 'total' || value === 'parcial' || value === 'baixa') {
    return value;
  }
  return null;
}

export function minimizeClinicalEvolutionForViewer(
  evolution: ClinicalEvolutionRecord,
  viewerUserId: string,
  viewerSpecialties: string[] = []
): ClinicalEvolutionRecord {
  const viewerIsAuthor = evolution.author_user_id === viewerUserId;
  const hasRestrictedText = Boolean(
    evolution.restricted_clinical_record &&
      evolution.restricted_clinical_record.trim().length > 0
  );

  // RestrictedClinicalRecord: strictly visible to the author, or authorized same-specialty only if explicitly tagged
  const canViewRestricted =
    viewerIsAuthor ||
    (Boolean(evolution.restricted_category) &&
      viewerSpecialties.some(
        (spec) =>
          spec.toLowerCase() ===
          (evolution.restricted_category ?? '').toLowerCase()
      ));

  if (canViewRestricted) {
    return {
      ...evolution,
      viewerIsAuthor,
      restrictedRecordHidden: false,
    };
  }

  return {
    ...evolution,
    restricted_clinical_record: null,
    viewerIsAuthor,
    restrictedRecordHidden: hasRestrictedText,
  };
}

export function buildClinicalEvolutionShareText(
  evolution: ClinicalEvolutionRecord,
  organizationName: string,
  patientName: string
): string {
  const lines = [
    `EVOLUÇÃO CLÍNICA COMPARTILHADA (LGPD — SharedClinicalNote)`,
    `Clínica: ${organizationName}`,
    `Paciente: ${patientName}`,
    `Atendimento: ${evolution.appointment_starts_at ?? evolution.created_at}`,
    `Profissional Responsável: ${evolution.author_name}${
      evolution.author_council_number
        ? ` · ${evolution.author_council_number}`
        : ''
    }`,
    `Conclusão (UTC): ${evolution.finalized_at_utc ?? evolution.created_at}`,
    '',
    `QUADRO CLÍNICO E EVOLUÇÃO:`,
    evolution.shared_clinical_note,
  ];

  if (evolution.procedures_performed) {
    lines.push('', `CONDUTAS / PROCEDIMENTOS:`, evolution.procedures_performed);
  }
  if (evolution.patient_response) {
    lines.push('', `RESPOSTA DO PACIENTE:`, evolution.patient_response);
  }
  if (evolution.eva_before !== null || evolution.eva_after !== null) {
    lines.push(
      '',
      `ESCALA EVA: Pré ${evolution.eva_before ?? '—'}/10 · Pós ${evolution.eva_after ?? '—'}/10`
    );
  }
  if (evolution.next_session_plan) {
    lines.push('', `PLANO PARA PRÓXIMA SESSÃO:`, evolution.next_session_plan);
  }

  return lines.join('\n');
}

export async function recordClinicalEvolutionAuditEvent(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    evolutionId?: string | null;
    patientId: string;
    appointmentId?: string | null;
    userId: string;
    userName: string;
    userEmail: string;
    action: ClinicalEvolutionAuditAction;
    sourceIp: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabase.from('clinical_evolution_audit_events').insert({
      organization_id: input.organizationId,
      evolution_id: input.evolutionId ?? null,
      patient_id: input.patientId,
      appointment_id: input.appointmentId ?? null,
      user_id: input.userId,
      user_name: input.userName,
      user_email: input.userEmail,
      action_executed: input.action,
      source_ip: input.sourceIp || '0.0.0.0',
      timestamp_utc: new Date().toISOString(),
      details: input.details ?? {},
    });
  } catch {
    // Audit logging never crashes read flow while migration is pending
  }
}

export async function syncFinalizedEvolutionToMedicalRecord(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    patientId: string;
    sessionStartsAt: string;
    sharedClinicalNote: string;
    proceduresPerformed: string | null;
    evaBefore: number | null;
    evaAfter: number | null;
    authorUserId: string;
    authorName: string;
    authorEmail: string;
    authorCouncilNumber: string;
    finalizedAtUtc: string;
  }
): Promise<void> {
  try {
    const parts = [
      `Evolução clínica concluída referente ao atendimento de ${input.sessionStartsAt}.`,
      `Autor: ${input.authorName} (${input.authorCouncilNumber})`,
      input.sharedClinicalNote,
    ];
    if (input.proceduresPerformed) {
      parts.push(`Condutas realizadas: ${input.proceduresPerformed}`);
    }
    if (input.evaBefore !== null || input.evaAfter !== null) {
      parts.push(
        `EVA: Pré ${input.evaBefore ?? '—'}/10 · Pós ${input.evaAfter ?? '—'}/10`
      );
    }

    await supabase.from('medical_records').insert({
      organization_id: input.organizationId,
      patient_id: input.patientId,
      category: 'clinical',
      record_type: 'evolucao',
      title: `Evolução Clínica · ${input.authorName}`,
      content: parts.join('\n'),
      occurred_at: input.sessionStartsAt,
      is_finalized: true,
      finalized_at: input.finalizedAtUtc,
      finalized_by: input.authorUserId,
      author_user_id: input.authorUserId,
      author_name: `${input.authorName} (${input.authorCouncilNumber})`,
      author_email: input.authorEmail,
    });
  } catch {
    // Non-blocking if medical_records table is not present
  }
}

export { cleanOptionalText, extractSourceIp };
