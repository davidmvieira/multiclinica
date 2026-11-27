import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import {
  buildClinicalEvolutionShareText,
  extractSourceIp,
  minimizeClinicalEvolutionForViewer,
  recordClinicalEvolutionAuditEvent,
} from '@/lib/evolutions/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  ClinicalEvolutionAuditAction,
  ClinicalEvolutionRecord,
} from '@/types/evolutions';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_ACTIONS: ClinicalEvolutionAuditAction[] = [
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

  const action = body.action as ClinicalEvolutionAuditAction;
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

  const { data: evolRow } = await supabase
    .from('clinical_evolutions')
    .select('*')
    .eq('id', id)
    .eq('organization_id', context.organization.id)
    .maybeSingle();

  if (!evolRow) {
    return NextResponse.json(
      { error: 'Evolução clínica não encontrada.' },
      { status: 404 }
    );
  }

  const evolution = evolRow as ClinicalEvolutionRecord;
  if (evolution.status !== 'finalized') {
    return NextResponse.json(
      {
        error:
          'Somente evoluções concluídas podem ser exportadas ou compartilhadas.',
      },
      { status: 400 }
    );
  }

  const [patientRes, profRes] = await Promise.all([
    supabase
      .from('patients')
      .select('id, name')
      .eq('id', evolution.patient_id)
      .eq('organization_id', context.organization.id)
      .maybeSingle(),
    supabase
      .from('professionals')
      .select('name')
      .eq('organization_id', context.organization.id)
      .eq('user_id', session.user.id)
      .maybeSingle(),
  ]);

  const actorName =
    (profRes.data?.name as string | null) ||
    session.user.name ||
    session.user.email ||
    'Profissional';
  const sourceIp = extractSourceIp(req);
  const patientName = (patientRes.data?.name as string | null) ?? 'Paciente';

  await recordClinicalEvolutionAuditEvent(supabase, {
    organizationId: context.organization.id,
    evolutionId: evolution.id,
    patientId: evolution.patient_id,
    appointmentId: evolution.appointment_id,
    userId: session.user.id,
    userName: actorName,
    userEmail: session.user.email,
    action,
    sourceIp,
    details: {
      minimized_for_lgpd: true,
    },
  });

  // Always strip RestrictedClinicalRecord when sharing SharedClinicalNote
  const minimized = minimizeClinicalEvolutionForViewer(
    evolution,
    '__lgpd_share__',
    []
  );
  const shareText = buildClinicalEvolutionShareText(
    minimized,
    context.organization.name,
    patientName
  );

  const { data: auditRows } = await supabase
    .from('clinical_evolution_audit_events')
    .select('*')
    .eq('organization_id', context.organization.id)
    .eq('evolution_id', evolution.id)
    .order('timestamp_utc', { ascending: false })
    .limit(50);

  const response = NextResponse.json({
    ok: true,
    shareText,
    auditEvents: auditRows ?? [],
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
