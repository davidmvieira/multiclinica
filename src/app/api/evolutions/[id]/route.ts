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
  minimizeClinicalEvolutionForViewer,
  recordClinicalEvolutionAuditEvent,
  sanitizeAdherence,
  sanitizeEvaScore,
  syncFinalizedEvolutionToMedicalRecord,
} from '@/lib/evolutions/server';
import { canUserAuthorClinicalRecord } from '@/lib/patients/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  ClinicalEvolutionAuditEvent,
  ClinicalEvolutionRecord,
  EvolutionRectificationRecord,
} from '@/types/evolutions';

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
      { error: 'Identificador de evolução inválido.' },
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

  const { data: evolRow, error: evolErr } = await supabase
    .from('clinical_evolutions')
    .select('*')
    .eq('id', id)
    .eq('organization_id', context.organization.id)
    .maybeSingle();

  if (evolErr) {
    if (isMissingAgendaTableError(evolErr)) {
      return NextResponse.json(
        { error: 'Execute a Seção 9 do sql.md no Supabase.', code: 'MIGRATION_REQUIRED' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível consultar a evolução clínica.' },
      { status: 502 }
    );
  }

  if (!evolRow) {
    return NextResponse.json(
      { error: 'Evolução não encontrada ou em rascunho exclusivo do autor.' },
      { status: 404 }
    );
  }

  const evolution = evolRow as ClinicalEvolutionRecord;
  const sourceIp = extractSourceIp(req);
  const viewerName = session.user.name || session.user.email || 'Profissional';

  if (
    evolution.status === 'draft' &&
    evolution.author_user_id !== session.user.id
  ) {
    await recordClinicalEvolutionAuditEvent(supabase, {
      organizationId: context.organization.id,
      evolutionId: evolution.id,
      patientId: evolution.patient_id,
      appointmentId: evolution.appointment_id,
      userId: session.user.id,
      userName: viewerName,
      userEmail: session.user.email,
      action: 'DENIED_RESTRICTED_ACCESS',
      sourceIp,
      details: { reason: 'Tentativa de acesso a rascunho de evolução de outro autor' },
    });
    return NextResponse.json(
      { error: 'Rascunhos clínicos pertencem exclusivamente ao autor.' },
      { status: 403 }
    );
  }

  const [patientRes, apptRes, rectsRes, actorProfRes] = await Promise.all([
    supabase
      .from('patients')
      .select('id, name, cpf')
      .eq('id', evolution.patient_id)
      .eq('organization_id', context.organization.id)
      .maybeSingle(),
    supabase
      .from('appointments')
      .select('id, starts_at, ends_at, service_id, unit_id')
      .eq('id', evolution.appointment_id)
      .maybeSingle(),
    supabase
      .from('evolution_rectifications')
      .select('*')
      .eq('evolution_id', evolution.id)
      .eq('organization_id', context.organization.id)
      .order('created_at_utc', { ascending: true }),
    supabase
      .from('professionals')
      .select('id')
      .eq('organization_id', context.organization.id)
      .eq('user_id', session.user.id)
      .maybeSingle(),
  ]);

  let viewerSpecialties: string[] = [];
  if (actorProfRes.data?.id) {
    const { data: profSpecRows } = await supabase
      .from('professional_specialties')
      .select('specialty_id')
      .eq('professional_id', actorProfRes.data.id);
    const specIds = (profSpecRows ?? []).map((r) => String(r.specialty_id));
    if (specIds.length > 0) {
      const { data: specs } = await supabase
        .from('specialties')
        .select('name')
        .in('id', specIds);
      viewerSpecialties = (specs ?? []).map((s) => String(s.name));
    }
  }

  const minimized = minimizeClinicalEvolutionForViewer(
    evolution,
    session.user.id,
    viewerSpecialties
  );

  await recordClinicalEvolutionAuditEvent(supabase, {
    organizationId: context.organization.id,
    evolutionId: evolution.id,
    patientId: evolution.patient_id,
    appointmentId: evolution.appointment_id,
    userId: session.user.id,
    userName: viewerName,
    userEmail: session.user.email,
    action: evolution.status === 'finalized' ? 'VIEW_EVOLUTION' : 'CREATE_DRAFT',
    sourceIp,
    details: {
      viewer_is_author: minimized.viewerIsAuthor,
      restricted_hidden: minimized.restrictedRecordHidden,
    },
  });

  const { data: auditRows } = await supabase
    .from('clinical_evolution_audit_events')
    .select('*')
    .eq('organization_id', context.organization.id)
    .eq('evolution_id', evolution.id)
    .order('timestamp_utc', { ascending: false })
    .limit(50);

  const response = NextResponse.json({
    evolution: {
      ...minimized,
      patient_name: patientRes.data?.name ?? 'Paciente',
      patient_cpf: patientRes.data?.cpf ?? null,
      appointment_starts_at: apptRes.data?.starts_at ?? null,
      appointment_ends_at: apptRes.data?.ends_at ?? null,
      rectifications: (rectsRes.data ?? []) as EvolutionRectificationRecord[],
    },
    auditEvents: (auditRows ?? []) as ClinicalEvolutionAuditEvent[],
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
      { error: 'Identificador de evolução inválido.' },
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
      { error: 'Sem permissão clínica para alterar evoluções.' },
      { status: 403 }
    );
  }

  const { data: existingRow } = await supabase
    .from('clinical_evolutions')
    .select('*')
    .eq('id', id)
    .eq('organization_id', context.organization.id)
    .maybeSingle();

  if (!existingRow) {
    return NextResponse.json(
      { error: 'Evolução não encontrada.' },
      { status: 404 }
    );
  }

  const existing = existingRow as ClinicalEvolutionRecord;
  if (existing.status === 'finalized') {
    return NextResponse.json(
      {
        error:
          'Evoluções concluídas são imutáveis. Adicione uma Nota de Retificação rastreável.',
        code: 'IMMUTABLE_EVOLUTION',
      },
      { status: 403 }
    );
  }

  if (existing.author_user_id !== session.user.id) {
    return NextResponse.json(
      {
        error:
          'É proibido alterar ou assinar evoluções criadas por outro profissional.',
      },
      { status: 403 }
    );
  }

  const sharedClinicalNote =
    body.sharedClinicalNote !== undefined
      ? (cleanOptionalText(body.sharedClinicalNote, 8000) ?? '')
      : existing.shared_clinical_note;
  const proceduresPerformed =
    body.proceduresPerformed !== undefined
      ? cleanOptionalText(body.proceduresPerformed, 4000)
      : existing.procedures_performed;
  const patientResponse =
    body.patientResponse !== undefined
      ? cleanOptionalText(body.patientResponse, 3000)
      : existing.patient_response;
  const evaBefore =
    body.evaBefore !== undefined
      ? sanitizeEvaScore(body.evaBefore)
      : existing.eva_before;
  const evaAfter =
    body.evaAfter !== undefined
      ? sanitizeEvaScore(body.evaAfter)
      : existing.eva_after;
  const adherenceLevel =
    body.adherenceLevel !== undefined
      ? sanitizeAdherence(body.adherenceLevel)
      : existing.adherence_level;
  const nextSessionPlan =
    body.nextSessionPlan !== undefined
      ? cleanOptionalText(body.nextSessionPlan, 3000)
      : existing.next_session_plan;
  const restrictedClinicalRecord =
    body.restrictedClinicalRecord !== undefined
      ? cleanOptionalText(body.restrictedClinicalRecord, 6000)
      : existing.restricted_clinical_record;
  const restrictedCategory = restrictedClinicalRecord
    ? cleanOptionalText(body.restrictedCategory, 80) ||
      existing.restricted_category ||
      'Autor (Sigilo Exclusivo)'
    : null;
  const authorCouncilNumber =
    body.authorCouncilNumber !== undefined
      ? cleanOptionalText(body.authorCouncilNumber, 60)
      : existing.author_council_number;

  const finalize = Boolean(body.finalize);

  if (finalize) {
    if (sharedClinicalNote.trim().length < 5) {
      return NextResponse.json(
        {
          error:
            'Descreva o quadro e a evolução clínica compartilhada (mínimo 5 caracteres) antes de concluir.',
        },
        { status: 400 }
      );
    }
    if (!authorCouncilNumber || authorCouncilNumber.trim().length < 3) {
      return NextResponse.json(
        {
          error:
            'Informe seu registro no conselho profissional (ex.: CREFITO) para concluir.',
        },
        { status: 400 }
      );
    }
  }

  const sourceIp = extractSourceIp(req);
  const finalizedAtUtc = finalize ? new Date().toISOString() : null;

  const { data: updated, error: updateErr } = await supabase
    .from('clinical_evolutions')
    .update({
      shared_clinical_note: sharedClinicalNote,
      procedures_performed: proceduresPerformed,
      patient_response: patientResponse,
      eva_before: evaBefore,
      eva_after: evaAfter,
      adherence_level: adherenceLevel,
      next_session_plan: nextSessionPlan,
      restricted_clinical_record: restrictedClinicalRecord,
      restricted_category: restrictedCategory,
      author_council_number: authorCouncilNumber,
      source_ip: sourceIp,
      status: finalize ? 'finalized' : 'draft',
      finalized_at_utc: finalizedAtUtc,
    })
    .eq('id', existing.id)
    .eq('organization_id', context.organization.id)
    .select('*')
    .single();

  if (updateErr || !updated) {
    return NextResponse.json(
      {
        error:
          updateErr?.code === '42501'
            ? 'Evoluções concluídas são imutáveis.'
            : 'Não foi possível atualizar a evolução clínica.',
      },
      { status: updateErr?.code === '42501' ? 403 : 502 }
    );
  }

  const saved = updated as ClinicalEvolutionRecord;

  if (finalize && finalizedAtUtc) {
    const { data: appt } = await supabase
      .from('appointments')
      .select('starts_at')
      .eq('id', saved.appointment_id)
      .maybeSingle();

    await recordClinicalEvolutionAuditEvent(supabase, {
      organizationId: context.organization.id,
      evolutionId: saved.id,
      patientId: saved.patient_id,
      appointmentId: saved.appointment_id,
      userId: session.user.id,
      userName: saved.author_name,
      userEmail: session.user.email,
      action: 'FINALIZE_EVOLUTION',
      sourceIp,
      details: {
        council_number: saved.author_council_number,
        has_restricted_record: Boolean(restrictedClinicalRecord),
      },
    });

    await syncFinalizedEvolutionToMedicalRecord(supabase, {
      organizationId: context.organization.id,
      patientId: saved.patient_id,
      sessionStartsAt: appt?.starts_at ?? saved.created_at,
      sharedClinicalNote,
      proceduresPerformed,
      evaBefore,
      evaAfter,
      authorUserId: session.user.id,
      authorName: saved.author_name,
      authorEmail: session.user.email,
      authorCouncilNumber: authorCouncilNumber ?? '',
      finalizedAtUtc,
    });
  }

  const response = NextResponse.json({
    evolution: {
      ...saved,
      viewerIsAuthor: true,
      restrictedRecordHidden: false,
    },
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
      { error: 'Identificador de evolução inválido.' },
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

  const { data: existing } = await supabase
    .from('clinical_evolutions')
    .select('id, status, author_user_id')
    .eq('id', id)
    .eq('organization_id', context.organization.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: 'Evolução não encontrada.' },
      { status: 404 }
    );
  }

  if (existing.status === 'finalized') {
    return NextResponse.json(
      {
        error: 'Evoluções concluídas são imutáveis e não podem ser excluídas.',
        code: 'IMMUTABLE_EVOLUTION',
      },
      { status: 403 }
    );
  }

  if (existing.author_user_id !== session.user.id) {
    return NextResponse.json(
      { error: 'Somente o autor pode excluir este rascunho.' },
      { status: 403 }
    );
  }

  const { error: delErr } = await supabase
    .from('clinical_evolutions')
    .delete()
    .eq('id', id)
    .eq('organization_id', context.organization.id);

  if (delErr) {
    return NextResponse.json(
      { error: 'Não foi possível excluir o rascunho.' },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
