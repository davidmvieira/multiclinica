import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

import { HOMOLOGATED_TEMPLATES } from '@/lib/evaluations/templates-catalog';
import type {
  EvaluationAnswerValue,
  EvaluationAuditAction,
  EvaluationRecord,
  EvaluationTemplateRecord,
  EvaluationTemplateSchema,
  EvaluationTemplateVersionRecord,
} from '@/types/evaluations';

export function extractSourceIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp =
    req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip');
  if (realIp && realIp.trim()) {
    return realIp.trim().slice(0, 64);
  }
  return '0.0.0.0';
}

export function cleanOptionalText(
  value: unknown,
  maxLength = 1000
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function sanitizeAnswersObject(
  raw: unknown
): Record<string, EvaluationAnswerValue> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, EvaluationAnswerValue> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || key.length > 100) continue;
    if (
      val === null ||
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean'
    ) {
      result[key] =
        typeof val === 'string' ? val.slice(0, 8000) : val;
    } else if (Array.isArray(val)) {
      result[key] = val
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.slice(0, 200))
        .slice(0, 50);
    }
  }
  return result;
}

export function minimizeEvaluationForViewer(
  evaluation: EvaluationRecord,
  schema: EvaluationTemplateSchema | null | undefined,
  viewerUserId: string
): EvaluationRecord {
  const viewerIsAuthor = evaluation.author_user_id === viewerUserId;
  if (viewerIsAuthor || !schema) {
    return {
      ...evaluation,
      viewerIsAuthor,
      restrictedSectionIds: [],
    };
  }

  const restrictedSectionIds: string[] = [];
  const restrictedFieldIds = new Set<string>();

  for (const section of schema.sections) {
    if (section.is_restricted_to_author) {
      restrictedSectionIds.push(section.id);
      for (const field of section.fields) {
        restrictedFieldIds.add(field.id);
      }
    }
  }

  const sanitizedAnswers: Record<string, EvaluationAnswerValue> = {};
  for (const [fieldId, value] of Object.entries(evaluation.answers ?? {})) {
    if (!restrictedFieldIds.has(fieldId)) {
      sanitizedAnswers[fieldId] = value;
    }
  }

  return {
    ...evaluation,
    answers: sanitizedAnswers,
    viewerIsAuthor: false,
    restrictedSectionIds,
  };
}

export function buildShareableSummaryText(
  evaluation: EvaluationRecord,
  schema: EvaluationTemplateSchema,
  organizationName: string,
  patientName: string
): string {
  const lines: string[] = [
    `RESUMO CLÍNICO MULTIPROFISSIONAL (LGPD — EXPOSIÇÃO MINIMIZADA)`,
    `Clínica: ${organizationName}`,
    `Paciente: ${patientName}`,
    `Modelo: ${evaluation.template_name} (v${evaluation.template_version_number})`,
    `Profissional Responsável: ${evaluation.author_name}${
      evaluation.author_council_number
        ? ` · Registro: ${evaluation.author_council_number}`
        : ''
    }`,
    `Conclusão (UTC): ${evaluation.finalized_at_utc ?? evaluation.created_at}`,
    '',
    `DIAGNÓSTICO FISIOTERAPÊUTICO: ${evaluation.functional_diagnosis ?? 'Não informado'}`,
    `CBDF: ${evaluation.cbdf_code ?? '—'}${
      evaluation.cbdf_description ? ` — ${evaluation.cbdf_description}` : ''
    }`,
  ];

  if (evaluation.shared_summary) {
    lines.push('', `SÍNTESE COMPARTILHADA:`, evaluation.shared_summary);
  }

  const orderedSections = [...schema.sections].sort(
    (a, b) => a.order - b.order
  );
  for (const section of orderedSections) {
    if (section.is_restricted_to_author) {
      continue;
    }
    const sectionLines: string[] = [];
    for (const field of section.fields) {
      const val = evaluation.answers?.[field.id];
      if (val === undefined || val === null || val === '') continue;
      const formatted = Array.isArray(val)
        ? val.join(', ')
        : typeof val === 'boolean'
          ? val
            ? 'Sim'
            : 'Não'
          : `${val}${field.unit ? ` ${field.unit}` : ''}`;
      sectionLines.push(`- ${field.label}: ${formatted}`);
    }
    if (sectionLines.length > 0) {
      lines.push('', section.title, ...sectionLines);
    }
  }

  return lines.join('\n');
}

export async function ensureOrgEvaluationTemplates(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  userName: string
): Promise<{
  templates: EvaluationTemplateRecord[];
  versions: EvaluationTemplateVersionRecord[];
}> {
  const [tplRes, verRes] = await Promise.all([
    supabase
      .from('evaluation_templates')
      .select('*')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true }),
    supabase
      .from('evaluation_template_versions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('version_number', { ascending: false }),
  ]);

  if (tplRes.error) throw tplRes.error;
  if (verRes.error) throw verRes.error;

  const existingTemplates = (tplRes.data ?? []) as EvaluationTemplateRecord[];
  const existingVersions = (verRes.data ??
    []) as EvaluationTemplateVersionRecord[];

  const existingSlugs = new Set(existingTemplates.map((t) => t.slug));
  const missingSeeds = HOMOLOGATED_TEMPLATES.filter(
    (seed) => !existingSlugs.has(seed.slug)
  );

  if (missingSeeds.length === 0) {
    return { templates: existingTemplates, versions: existingVersions };
  }

  for (const seed of missingSeeds) {
    const { data: insertedTpl, error: tplInsertErr } = await supabase
      .from('evaluation_templates')
      .upsert(
        {
          organization_id: organizationId,
          slug: seed.slug,
          name: seed.name,
          category_label: seed.category_label,
          description: seed.description,
          current_version_number: 1,
          is_active: true,
          created_by: userId,
        },
        { onConflict: 'organization_id,slug' }
      )
      .select('*')
      .single();

    if (tplInsertErr || !insertedTpl) continue;

    const { data: existingV1 } = await supabase
      .from('evaluation_template_versions')
      .select('id')
      .eq('template_id', insertedTpl.id)
      .eq('version_number', 1)
      .maybeSingle();

    let versionId = existingV1?.id ?? null;

    if (!versionId) {
      const { data: insertedVer } = await supabase
        .from('evaluation_template_versions')
        .insert({
          organization_id: organizationId,
          template_id: insertedTpl.id,
          version_number: 1,
          changelog: seed.changelog,
          schema_json: seed.schema,
          created_by: userId,
          created_by_name: userName,
        })
        .select('id')
        .single();
      versionId = insertedVer?.id ?? null;
    }

    if (versionId && !insertedTpl.current_version_id) {
      await supabase
        .from('evaluation_templates')
        .update({ current_version_id: versionId })
        .eq('id', insertedTpl.id);
    }
  }

  const [finalTplRes, finalVerRes] = await Promise.all([
    supabase
      .from('evaluation_templates')
      .select('*')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true }),
    supabase
      .from('evaluation_template_versions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('version_number', { ascending: false }),
  ]);

  return {
    templates: (finalTplRes.data ?? existingTemplates) as EvaluationTemplateRecord[],
    versions: (finalVerRes.data ??
      existingVersions) as EvaluationTemplateVersionRecord[],
  };
}

export async function recordEvaluationAuditEvent(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    evaluationId: string;
    patientId: string;
    userId: string;
    userName: string;
    userEmail: string;
    action: EvaluationAuditAction;
    sourceIp: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabase.from('evaluation_audit_events').insert({
      organization_id: input.organizationId,
      evaluation_id: input.evaluationId,
      patient_id: input.patientId,
      user_id: input.userId,
      user_name: input.userName,
      user_email: input.userEmail,
      action_executed: input.action,
      source_ip: input.sourceIp || '0.0.0.0',
      timestamp_utc: new Date().toISOString(),
      details: input.details ?? {},
    });
  } catch {
    // Audit insert never crashes read response if table is migrating
  }
}

export async function syncFinalizedEvaluationToMedicalRecord(
  supabase: SupabaseClient,
  input: {
    organizationId: string;
    patientId: string;
    evaluationId: string;
    templateName: string;
    versionNumber: number;
    functionalDiagnosis: string;
    cbdfCode: string;
    cbdfDescription: string;
    sharedSummary: string | null;
    authorUserId: string;
    authorName: string;
    authorEmail: string;
    authorCouncilNumber: string;
    finalizedAtUtc: string;
  }
): Promise<void> {
  try {
    const contentParts = [
      `Avaliação clínica concluída com modelo homologado "${input.templateName}" (v${input.versionNumber}).`,
      `Autor: ${input.authorName} · Registro: ${input.authorCouncilNumber}`,
      `Diagnóstico Fisioterapêutico: ${input.functionalDiagnosis}`,
      `CBDF: ${input.cbdfCode} — ${input.cbdfDescription}`,
    ];
    if (input.sharedSummary) {
      contentParts.push(`Resumo Multiprofissional: ${input.sharedSummary}`);
    }

    await supabase.from('medical_records').insert({
      organization_id: input.organizationId,
      patient_id: input.patientId,
      category: 'clinical',
      record_type: 'avaliacao_estruturada',
      title: `${input.templateName} (v${input.versionNumber}) · ${input.cbdfCode}`,
      content: contentParts.join('\n'),
      occurred_at: input.finalizedAtUtc,
      is_finalized: true,
      finalized_at: input.finalizedAtUtc,
      finalized_by: input.authorUserId,
      author_user_id: input.authorUserId,
      author_name: `${input.authorName} (${input.authorCouncilNumber})`,
      author_email: input.authorEmail,
    });
  } catch {
    // Non-blocking if Epic 2 medical_records hasn't been executed yet
  }
}
