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
import { canUserAuthorClinicalRecord } from '@/lib/patients/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  contextParams: { params: Promise<{ id: string; recordId: string }> }
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

  const { id: patientId, recordId } = await contextParams.params;
  if (!UUID_REGEX.test(patientId) || !UUID_REGEX.test(recordId)) {
    return NextResponse.json(
      { error: 'Identificador inválido.' },
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

  const justification =
    typeof body.justification === 'string'
      ? body.justification.trim().slice(0, 500)
      : '';
  const content =
    typeof body.content === 'string' ? body.content.trim().slice(0, 6000) : '';

  if (justification.length < 5) {
    return NextResponse.json(
      {
        error:
          'Informe a justificativa da nota corretiva (mínimo 5 caracteres).',
      },
      { status: 400 }
    );
  }

  if (content.length < 3) {
    return NextResponse.json(
      {
        error: 'Informe o texto da nota corretiva (mínimo 3 caracteres).',
      },
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
      {
        error:
          'Apenas profissionais ou gestores clínicos autorizados podem registrar notas corretivas.',
      },
      { status: 403 }
    );
  }

  const { data: targetRecord, error: recordError } = await supabase
    .from('medical_records')
    .select('id, patient_id, is_finalized')
    .eq('organization_id', context.organization.id)
    .eq('patient_id', patientId)
    .eq('id', recordId)
    .maybeSingle();

  if (recordError) {
    if (isMissingAgendaTableError(recordError)) {
      return NextResponse.json(
        {
          error: 'Execute a Seção 7 do sql.md no Supabase.',
          code: 'MIGRATION_REQUIRED',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível localizar o registro original.' },
      { status: 502 }
    );
  }

  if (!targetRecord) {
    return NextResponse.json(
      { error: 'Registro do prontuário não encontrado.' },
      { status: 404 }
    );
  }

  const { data: addendum, error: insertError } = await supabase
    .from('medical_record_addenda')
    .insert({
      organization_id: context.organization.id,
      record_id: recordId,
      patient_id: patientId,
      author_user_id: session.user.id,
      author_name: session.user.name || session.user.email || 'Profissional',
      author_email: session.user.email,
      justification,
      content,
    })
    .select('*')
    .single();

  if (insertError) {
    if (isMissingAgendaTableError(insertError)) {
      return NextResponse.json(
        {
          error:
            'Execute a Seção 7 do sql.md no Supabase para habilitar notas corretivas.',
          code: 'MIGRATION_REQUIRED',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível registrar a nota corretiva.' },
      { status: 502 }
    );
  }

  const response = NextResponse.json({ addendum }, { status: 201 });
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
