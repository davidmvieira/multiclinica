import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import {
  buildShareableSummaryText,
  extractSourceIp,
  minimizeEvaluationForViewer,
  recordEvaluationAuditEvent,
} from '@/lib/evaluations/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  EvaluationAuditAction,
  EvaluationRecord,
  EvaluationTemplateVersionRecord,
} from '@/types/evaluations';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_ACTIONS: EvaluationAuditAction[] = [
  'EXPORT_PDF',
  'SHARE_SUMMARY',
];

export async function POST(
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

  const action = body.action as EvaluationAuditAction;
  if (!ALLOWED_ACTIONS.includes(action)) {
    return NextResponse.json(
      { error: 'Ação de auditoria inválida.' },
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

  const { data: evalRow, error: evalErr } = await supabase
    .from('evaluations')
    .select('*')
    .eq('id', id)
    .eq('organization_id', context.organization.id)
    .maybeSingle();

  if (evalErr || !evalRow) {
    return NextResponse.json(
      { error: 'Avaliação não encontrada nesta clínica.' },
      { status: 404 }
    );
  }

  const evaluation = evalRow as EvaluationRecord;

  if (evaluation.status !== 'finalized') {
    return NextResponse.json(
      {
        error:
          'Somente avaliações concluídas podem ser exportadas ou compartilhadas.',
      },
      { status: 400 }
    );
  }

  const [verRes, patientRes, profRes] = await Promise.all([
    supabase
      .from('evaluation_template_versions')
      .select('*')
      .eq('id', evaluation.template_version_id)
      .eq('organization_id', context.organization.id)
      .maybeSingle(),
    supabase
      .from('patients')
      .select('id, name')
      .eq('id', evaluation.patient_id)
      .eq('organization_id', context.organization.id)
      .maybeSingle(),
    supabase
      .from('professionals')
      .select('name')
      .eq('organization_id', context.organization.id)
      .eq('user_id', session.user.id)
      .maybeSingle(),
  ]);

  const templateVersion = (verRes.data ??
    null) as EvaluationTemplateVersionRecord | null;
  const actorName =
    (profRes.data?.name as string | null) ||
    session.user.name ||
    session.user.email ||
    'Profissional';
  const sourceIp = extractSourceIp(req);
  const patientName = (patientRes.data?.name as string | null) ?? 'Paciente';

  const recipientChannel =
    typeof body.channel === 'string'
      ? body.channel.trim().slice(0, 80)
      : action === 'EXPORT_PDF'
        ? 'pdf_print'
        : 'equipe_multiprofissional';

  await recordEvaluationAuditEvent(supabase, {
    organizationId: context.organization.id,
    evaluationId: evaluation.id,
    patientId: evaluation.patient_id,
    userId: session.user.id,
    userName: actorName,
    userEmail: session.user.email,
    action,
    sourceIp,
    details: {
      channel: recipientChannel,
      minimized_for_lgpd:
        action === 'SHARE_SUMMARY' ||
        evaluation.author_user_id !== session.user.id,
      template_version_number: evaluation.template_version_number,
    },
  });

  // SHARE_SUMMARY always enforces LGPD exposure minimization (strips restricted sections)
  const minimizedForShare = minimizeEvaluationForViewer(
    evaluation,
    templateVersion?.schema_json ?? null,
    action === 'SHARE_SUMMARY' ? '__lgpd_share__' : session.user.id
  );

  const shareText = templateVersion
    ? buildShareableSummaryText(
        minimizedForShare,
        templateVersion.schema_json,
        context.organization.name,
        patientName
      )
    : null;

  const { data: latestAudit } = await supabase
    .from('evaluation_audit_events')
    .select('*')
    .eq('organization_id', context.organization.id)
    .eq('evaluation_id', evaluation.id)
    .order('timestamp_utc', { ascending: false })
    .limit(50);

  const response = NextResponse.json({
    ok: true,
    shareText,
    minimizedEvaluation: minimizedForShare,
    auditEvents: latestAudit ?? [],
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
