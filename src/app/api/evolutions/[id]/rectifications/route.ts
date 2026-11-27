import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import {
  cleanOptionalText,
  extractSourceIp,
  recordClinicalEvolutionAuditEvent,
} from '@/lib/evolutions/server';
import { canUserAuthorClinicalRecord } from '@/lib/patients/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const { id: evolutionId } = await contextParams.params;
  if (!UUID_REGEX.test(evolutionId)) {
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

  const rectifiedContent = cleanOptionalText(body.rectifiedContent, 6000);
  const justification = cleanOptionalText(body.justification, 1000);

  if (!rectifiedContent || rectifiedContent.length < 5) {
    return NextResponse.json(
      { error: 'Informe o texto da Nota de Retificação (mínimo 5 caracteres).' },
      { status: 400 }
    );
  }
  if (!justification || justification.length < 5) {
    return NextResponse.json(
      {
        error:
          'Informe a justificativa técnica da retificação (mínimo 5 caracteres).',
      },
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
      { error: 'Sem permissão clínica para registrar notas de retificação.' },
      { status: 403 }
    );
  }

  const [evolRes, profRes] = await Promise.all([
    supabase
      .from('clinical_evolutions')
      .select('id, patient_id, appointment_id, status')
      .eq('id', evolutionId)
      .eq('organization_id', context.organization.id)
      .maybeSingle(),
    supabase
      .from('professionals')
      .select('name, council_number')
      .eq('organization_id', context.organization.id)
      .eq('user_id', session.user.id)
      .maybeSingle(),
  ]);

  if (evolRes.error || !evolRes.data) {
    return NextResponse.json(
      { error: 'Evolução clínica não encontrada nesta organização.' },
      { status: 404 }
    );
  }

  if (evolRes.data.status !== 'finalized') {
    return NextResponse.json(
      {
        error:
          'Notas de retificação aplicam-se somente a evoluções já concluídas e imutáveis.',
      },
      { status: 400 }
    );
  }

  const authorName =
    (profRes.data?.name as string | null) ||
    session.user.name ||
    session.user.email ||
    'Profissional';
  const authorCouncilNumber =
    cleanOptionalText(body.authorCouncilNumber, 60) ||
    cleanOptionalText(profRes.data?.council_number, 60);

  if (!authorCouncilNumber || authorCouncilNumber.length < 3) {
    return NextResponse.json(
      {
        error:
          'Informe o registro no conselho profissional (ex.: CREFITO) para assinar a Nota de Retificação.',
      },
      { status: 400 }
    );
  }

  const sourceIp = extractSourceIp(req);
  const createdAtUtc = new Date().toISOString();

  const { data: rectification, error: insertErr } = await supabase
    .from('evolution_rectifications')
    .insert({
      organization_id: context.organization.id,
      evolution_id: evolutionId,
      patient_id: evolRes.data.patient_id,
      rectified_content: rectifiedContent,
      justification,
      author_user_id: session.user.id,
      author_name: authorName,
      author_council_number: authorCouncilNumber,
      source_ip: sourceIp,
      created_at_utc: createdAtUtc,
    })
    .select('*')
    .single();

  if (insertErr || !rectification) {
    return NextResponse.json(
      { error: 'Não foi possível salvar a Nota de Retificação.' },
      { status: 502 }
    );
  }

  await recordClinicalEvolutionAuditEvent(supabase, {
    organizationId: context.organization.id,
    evolutionId,
    patientId: evolRes.data.patient_id,
    appointmentId: evolRes.data.appointment_id,
    userId: session.user.id,
    userName: authorName,
    userEmail: session.user.email,
    action: 'ADD_RECTIFICATION',
    sourceIp,
    details: {
      rectification_id: rectification.id,
      justification,
      council_number: authorCouncilNumber,
    },
  });

  // Non-blocking mirror into medical_records timeline
  try {
    await supabase.from('medical_records').insert({
      organization_id: context.organization.id,
      patient_id: evolRes.data.patient_id,
      category: 'clinical',
      record_type: 'retificacao_evolucao',
      title: `Nota de Retificação de Evolução · ${authorName}`,
      content: `Justificativa: ${justification}\n\nRetificação: ${rectifiedContent}`,
      occurred_at: createdAtUtc,
      is_finalized: true,
      finalized_at: createdAtUtc,
      finalized_by: session.user.id,
      author_user_id: session.user.id,
      author_name: `${authorName} (${authorCouncilNumber})`,
      author_email: session.user.email,
    });
  } catch {
    // Non-blocking if medical_records is absent
  }

  const response = NextResponse.json({ rectification }, { status: 201 });
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
