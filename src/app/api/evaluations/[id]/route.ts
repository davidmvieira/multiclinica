import { NextRequest, NextResponse } from 'next/server';

import {
  isMissingAgendaTableError,
  resolveAgendaAccessContext,
} from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import {
  cleanOptionalText,
  extractSourceIp,
  minimizeEvaluationForViewer,
  recordEvaluationAuditEvent,
  sanitizeAnswersObject,
  syncFinalizedEvaluationToMedicalRecord,
} from '@/lib/evaluations/server';
import { validateEvaluationForConclusion } from '@/lib/evaluations/templates-catalog';
import { canUserAuthorClinicalRecord } from '@/lib/patients/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  EvaluationAuditEvent,
  EvaluationRecord,
  EvaluationTemplateVersionRecord,
} from '@/types/evaluations';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  contextParams: { params: Promise<{ id: string }> }
) {
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

  const { id } = await contextParams.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json(
      { error: 'Identificador de avaliação inválido.' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServerClient(session.accessToken);
  const { context, migrationPending } = await resolveAgendaAccessContext(
    supabase,
    session.user.id,
    session.user.email,
    session.activeOrganizationId
  );

  if (migrationPending || !context) {
    return NextResponse.json(
      { error: 'Organização clínica não encontrada.' },
      { status: 404 }
    );
  }

  const { data: evalRow, error: evalErr } = await supabase
    .from('evaluations')
    .select('*')
    .eq('id', id)
    .eq('organization_id', context.organization.id)
    .maybeSingle();

  if (evalErr) {
    if (isMissingAgendaTableError(evalErr)) {
      return NextResponse.json(
        { error: 'Execute a Seção 8 do sql.md no Supabase.', code: 'MIGRATION_REQUIRED' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível consultar a avaliação.' },
      { status: 502 }
    );
  }

  if (!evalRow) {
    return NextResponse.json(
      { error: 'Avaliação não encontrada ou em rascunho restrito ao autor.' },
      { status: 404 }
    );
  }

  const evaluation = evalRow as EvaluationRecord;
  const sourceIp = extractSourceIp(req);
  const viewerName = session.user.name || session.user.email || 'Profissional';

  if (
    evaluation.status === 'draft' &&
    evaluation.author_user_id !== session.user.id
  ) {
    await recordEvaluationAuditEvent(supabase, {
      organizationId: context.organization.id,
      evaluationId: evaluation.id,
      patientId: evaluation.patient_id,
      userId: session.user.id,
      userName: viewerName,
      userEmail: session.user.email,
      action: 'DENIED_RESTRICTED_ACCESS',
      sourceIp,
      details: { reason: 'Tentativa de acesso a rascunho de outro autor' },
    });

    return NextResponse.json(
      { error: 'Rascunhos clínicos são restritos ao autor responsável.' },
      { status: 403 }
    );
  }

  const [verRes, patientRes] = await Promise.all([
    supabase
      .from('evaluation_template_versions')
      .select('*')
      .eq('id', evaluation.template_version_id)
      .eq('organization_id', context.organization.id)
      .maybeSingle(),
    supabase
      .from('patients')
      .select('id, name, cpf')
      .eq('id', evaluation.patient_id)
      .eq('organization_id', context.organization.id)
      .maybeSingle(),
  ]);

  const templateVersion = (verRes.data ??
    null) as EvaluationTemplateVersionRecord | null;

  await recordEvaluationAuditEvent(supabase, {
    organizationId: context.organization.id,
    evaluationId: evaluation.id,
    patientId: evaluation.patient_id,
    userId: session.user.id,
    userName: viewerName,
    userEmail: session.user.email,
    action: evaluation.status === 'finalized' ? 'VIEW_EVALUATION' : 'OPEN_DRAFT',
    sourceIp,
    details: {
      template_version_number: evaluation.template_version_number,
      viewer_is_author: evaluation.author_user_id === session.user.id,
    },
  });

  const { data: auditRows } = await supabase
    .from('evaluation_audit_events')
    .select('*')
    .eq('organization_id', context.organization.id)
    .eq('evaluation_id', evaluation.id)
    .order('timestamp_utc', { ascending: false })
    .limit(50);

  const minimized = minimizeEvaluationForViewer(
    evaluation,
    templateVersion?.schema_json ?? null,
    session.user.id
  );

  const response = NextResponse.json({
    evaluation: {
      ...minimized,
      patient_name: patientRes.data?.name ?? 'Paciente',
      patient_cpf: patientRes.data?.cpf ?? null,
    },
    templateVersion,
    auditEvents: (auditRows ?? []) as EvaluationAuditEvent[],
  });

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

export async function PATCH(
  req: NextRequest,
  contextParams: { params: Promise<{ id: string }> }
) {
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

  const { id } = await contextParams.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json(
      { error: 'Identificador de avaliação inválido.' },
      { status: 400 }
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

  const supabase = createSupabaseServerClient(session.accessToken);
  const { context, migrationPending } = await resolveAgendaAccessContext(
    supabase,
    session.user.id,
    session.user.email,
    session.activeOrganizationId
  );

  if (migrationPending || !context) {
    return NextResponse.json(
      { error: 'Organização clínica não encontrada.' },
      { status: 404 }
    );
  }

  const isOwner = context.organization.owner_user_id === session.user.id;
  const canAuthor = await canUserAuthorClinicalRecord(
    supabase,
    context.organization.id,
    session.user.id,
    context.role,
    isOwner
  );

  if (!canAuthor) {
    return NextResponse.json(
      { error: 'Sem permissão clínica para alterar avaliações.' },
      { status: 403 }
    );
  }

  const { data: existingRow, error: existingErr } = await supabase
    .from('evaluations')
    .select('*')
    .eq('id', id)
    .eq('organization_id', context.organization.id)
    .maybeSingle();

  if (existingErr || !existingRow) {
    return NextResponse.json(
      { error: 'Avaliação não encontrada nesta clínica.' },
      { status: 404 }
    );
  }

  const existing = existingRow as EvaluationRecord;

  if (existing.status === 'finalized') {
    return NextResponse.json(
      {
        error:
          'Esta avaliação já foi concluída e é imutável no banco de dados.',
        code: 'IMMUTABLE_EVALUATION',
      },
      { status: 403 }
    );
  }

  if (existing.author_user_id !== session.user.id) {
    return NextResponse.json(
      {
        error:
          'Apenas o fisioterapeuta autor pode editar ou concluir este rascunho.',
      },
      { status: 403 }
    );
  }

  const { data: verRow } = await supabase
    .from('evaluation_template_versions')
    .select('*')
    .eq('id', existing.template_version_id)
    .eq('organization_id', context.organization.id)
    .maybeSingle();

  const templateVersion = (verRow ??
    null) as EvaluationTemplateVersionRecord | null;

  if (!templateVersion) {
    return NextResponse.json(
      { error: 'Versão estrutural original da avaliação não encontrada.' },
      { status: 404 }
    );
  }

  const answers =
    body.answers !== undefined
      ? sanitizeAnswersObject(body.answers)
      : existing.answers;
  const sharedSummary =
    body.sharedSummary !== undefined
      ? cleanOptionalText(body.sharedSummary, 4000)
      : existing.shared_summary;
  const functionalDiagnosis =
    body.functionalDiagnosis !== undefined
      ? cleanOptionalText(body.functionalDiagnosis, 2000)
      : existing.functional_diagnosis;
  const cbdfCode =
    body.cbdfCode !== undefined
      ? cleanOptionalText(body.cbdfCode, 40)
      : existing.cbdf_code;
  const cbdfDescription =
    body.cbdfDescription !== undefined
      ? cleanOptionalText(body.cbdfDescription, 600)
      : existing.cbdf_description;
  const procedureCode =
    body.procedureCode !== undefined
      ? cleanOptionalText(body.procedureCode, 40)
      : existing.procedure_code;
  const procedureDescription =
    body.procedureDescription !== undefined
      ? cleanOptionalText(body.procedureDescription, 300)
      : existing.procedure_description;
  const authorCouncilNumber =
    body.authorCouncilNumber !== undefined
      ? cleanOptionalText(body.authorCouncilNumber, 60)
      : existing.author_council_number;

  const finalize = Boolean(body.finalize);

  if (finalize) {
    const check = validateEvaluationForConclusion(
      templateVersion.schema_json,
      answers,
      {
        functionalDiagnosis,
        cbdfCode,
        cbdfDescription,
        authorCouncilNumber,
      }
    );
    if (!check.ok) {
      return NextResponse.json(
        {
          error: check.error,
          missingFields: check.missingFields,
        },
        { status: 400 }
      );
    }
  }

  const finalizedAtUtc = finalize ? new Date().toISOString() : null;

  const { data: updated, error: updateErr } = await supabase
    .from('evaluations')
    .update({
      answers,
      shared_summary: sharedSummary,
      functional_diagnosis: functionalDiagnosis,
      cbdf_code: cbdfCode,
      cbdf_description: cbdfDescription,
      procedure_code: procedureCode,
      procedure_description: procedureDescription,
      author_council_number: authorCouncilNumber,
      status: finalize ? 'finalized' : 'draft',
      finalized_at_utc: finalizedAtUtc,
    })
    .eq('id', existing.id)
    .eq('organization_id', context.organization.id)
    .select('*')
    .single();

  if (updateErr || !updated) {
    const message =
      updateErr?.code === '42501'
        ? 'Avaliações concluídas são imutáveis e não podem ser alteradas.'
        : 'Não foi possível atualizar a avaliação clínica.';
    return NextResponse.json(
      { error: message },
      { status: updateErr?.code === '42501' ? 403 : 502 }
    );
  }

  const saved = updated as EvaluationRecord;
  const sourceIp = extractSourceIp(req);
  const actorName = existing.author_name;

  if (finalize && finalizedAtUtc) {
    await recordEvaluationAuditEvent(supabase, {
      organizationId: context.organization.id,
      evaluationId: saved.id,
      patientId: saved.patient_id,
      userId: session.user.id,
      userName: actorName,
      userEmail: session.user.email,
      action: 'FINALIZE_EVALUATION',
      sourceIp,
      details: {
        template_version_number: saved.template_version_number,
        cbdf_code: saved.cbdf_code,
        council_number: saved.author_council_number,
      },
    });

    await syncFinalizedEvaluationToMedicalRecord(supabase, {
      organizationId: context.organization.id,
      patientId: saved.patient_id,
      evaluationId: saved.id,
      templateName: saved.template_name,
      versionNumber: saved.template_version_number,
      functionalDiagnosis: functionalDiagnosis ?? '',
      cbdfCode: cbdfCode ?? '',
      cbdfDescription: cbdfDescription ?? '',
      sharedSummary,
      authorUserId: session.user.id,
      authorName: actorName,
      authorEmail: session.user.email,
      authorCouncilNumber: authorCouncilNumber ?? '',
      finalizedAtUtc,
    });
  }

  const response = NextResponse.json({
    evaluation: {
      ...saved,
      viewerIsAuthor: true,
      restrictedSectionIds: [],
    },
    templateVersion,
  });

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

export async function DELETE(
  req: NextRequest,
  contextParams: { params: Promise<{ id: string }> }
) {
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

  const { id } = await contextParams.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json(
      { error: 'Identificador de avaliação inválido.' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServerClient(session.accessToken);
  const { context } = await resolveAgendaAccessContext(
    supabase,
    session.user.id,
    session.user.email,
    session.activeOrganizationId
  );

  if (!context) {
    return NextResponse.json(
      { error: 'Organização clínica não encontrada.' },
      { status: 404 }
    );
  }

  const { data: existingRow } = await supabase
    .from('evaluations')
    .select('id, status, author_user_id')
    .eq('id', id)
    .eq('organization_id', context.organization.id)
    .maybeSingle();

  if (!existingRow) {
    return NextResponse.json(
      { error: 'Avaliação não encontrada.' },
      { status: 404 }
    );
  }

  if (existingRow.status === 'finalized') {
    return NextResponse.json(
      {
        error:
          'Avaliações concluídas são imutáveis e não podem ser excluídas.',
        code: 'IMMUTABLE_EVALUATION',
      },
      { status: 403 }
    );
  }

  if (existingRow.author_user_id !== session.user.id) {
    return NextResponse.json(
      { error: 'Somente o autor pode excluir este rascunho.' },
      { status: 403 }
    );
  }

  const { error: deleteErr } = await supabase
    .from('evaluations')
    .delete()
    .eq('id', id)
    .eq('organization_id', context.organization.id);

  if (deleteErr) {
    return NextResponse.json(
      { error: 'Não foi possível excluir o rascunho.' },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
