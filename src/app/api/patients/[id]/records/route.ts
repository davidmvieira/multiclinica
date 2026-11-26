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
  MEDICAL_RECORD_CATEGORIES,
  isAllowedDocumentDataUrl,
  isSafeHttpUrl,
} from '@/lib/patients/constants';
import { canUserAuthorClinicalRecord } from '@/lib/patients/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { MedicalRecordCategory } from '@/types/patients';

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

  const { id: patientId } = await contextParams.params;
  if (!UUID_REGEX.test(patientId)) {
    return NextResponse.json(
      { error: 'Identificador de paciente inválido.' },
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

  const category = body.category as MedicalRecordCategory;
  if (!MEDICAL_RECORD_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: 'Categoria do registro inválida.' },
      { status: 400 }
    );
  }

  const recordType =
    typeof body.recordType === 'string' && body.recordType.trim()
      ? body.recordType.trim().slice(0, 60)
      : category === 'clinical'
        ? 'evolucao'
        : category === 'document'
          ? 'laudo'
          : 'contato';

  const title =
    typeof body.title === 'string' ? body.title.trim().slice(0, 160) : '';
  const content =
    typeof body.content === 'string' ? body.content.trim().slice(0, 12000) : '';

  if (!title || title.length < 2) {
    return NextResponse.json(
      { error: 'Informe um título para o registro (mínimo 2 caracteres).' },
      { status: 400 }
    );
  }

  if (category !== 'document' && (!content || content.length < 3)) {
    return NextResponse.json(
      { error: 'Informe o conteúdo do registro (mínimo 3 caracteres).' },
      { status: 400 }
    );
  }

  let occurredAt = new Date().toISOString();
  if (typeof body.occurredAt === 'string' && body.occurredAt.trim()) {
    const parsed = Date.parse(body.occurredAt);
    if (Number.isNaN(parsed)) {
      return NextResponse.json(
        { error: 'Data/hora da ocorrência inválida.' },
        { status: 400 }
      );
    }
    occurredAt = new Date(parsed).toISOString();
  }

  let documentUrl: string | null = null;
  let documentName: string | null = null;
  let documentMime: string | null = null;
  let documentSizeBytes: number | null = null;
  let documentDataUrl: string | null = null;

  if (category === 'document') {
    const rawUrl =
      typeof body.documentUrl === 'string' ? body.documentUrl.trim() : '';
    const rawDataUrl =
      typeof body.documentDataUrl === 'string'
        ? body.documentDataUrl.trim()
        : '';

    if (rawUrl) {
      if (!isSafeHttpUrl(rawUrl)) {
        return NextResponse.json(
          { error: 'URL do documento inválida. Use apenas links http(s).' },
          { status: 400 }
        );
      }
      documentUrl = rawUrl.slice(0, 1000);
    }

    if (rawDataUrl) {
      const check = isAllowedDocumentDataUrl(rawDataUrl);
      if (!check.valid) {
        return NextResponse.json(
          {
            error:
              'Arquivo anexo inválido ou acima de 2 MB. Envie PDF, PNG, JPG, WEBP ou TXT.',
          },
          { status: 400 }
        );
      }
      documentDataUrl = rawDataUrl;
      documentMime = check.mime ?? null;
    }

    if (!documentUrl && !documentDataUrl && !content) {
      return NextResponse.json(
        {
          error:
            'Anexe um arquivo, informe o link do documento ou descreva o documento.',
        },
        { status: 400 }
      );
    }

    documentName =
      typeof body.documentName === 'string' && body.documentName.trim()
        ? body.documentName.trim().slice(0, 180)
        : null;
    if (typeof body.documentMime === 'string' && !documentMime) {
      documentMime = body.documentMime.trim().slice(0, 80) || null;
    }
    if (
      typeof body.documentSizeBytes === 'number' &&
      Number.isFinite(body.documentSizeBytes) &&
      body.documentSizeBytes > 0
    ) {
      documentSizeBytes = Math.round(body.documentSizeBytes);
    }
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
  if (category === 'clinical') {
    const canAuthorClinical = await canUserAuthorClinicalRecord(
      supabase,
      context.organization.id,
      session.user.id,
      context.role,
      isOwner
    );
    if (!canAuthorClinical) {
      return NextResponse.json(
        {
          error:
            'Apenas profissionais de saúde ou gestores clínicos autorizados podem registrar evoluções e avaliações clínicas.',
          code: 'FORBIDDEN_CLINICAL_AUTHOR',
        },
        { status: 403 }
      );
    }
  }

  const { data: patientCheck } = await supabase
    .from('patients')
    .select('id')
    .eq('organization_id', context.organization.id)
    .eq('id', patientId)
    .maybeSingle();

  if (!patientCheck) {
    return NextResponse.json(
      { error: 'Paciente não encontrado nesta clínica.' },
      { status: 404 }
    );
  }

  const isFinalized =
    category === 'clinical' ? body.isFinalized !== false : true;
  const nowIso = new Date().toISOString();
  const professionalId =
    typeof body.professionalId === 'string' &&
    UUID_REGEX.test(body.professionalId)
      ? body.professionalId
      : null;

  const { data: created, error: insertError } = await supabase
    .from('medical_records')
    .insert({
      organization_id: context.organization.id,
      patient_id: patientId,
      professional_id: professionalId,
      category,
      record_type: recordType,
      title,
      content: content || (documentName ? `Documento anexado: ${documentName}` : title),
      occurred_at: occurredAt,
      is_finalized: isFinalized,
      finalized_at: isFinalized ? nowIso : null,
      finalized_by: isFinalized ? session.user.id : null,
      author_user_id: session.user.id,
      author_name: session.user.name || session.user.email || 'Equipe',
      author_email: session.user.email,
      document_url: documentUrl,
      document_name: documentName,
      document_mime: documentMime,
      document_size_bytes: documentSizeBytes,
      document_data_url: documentDataUrl,
    })
    .select('*')
    .single();

  if (insertError) {
    if (isMissingAgendaTableError(insertError)) {
      return NextResponse.json(
        {
          error:
            'Execute a Seção 7 do arquivo sql.md no Supabase para habilitar o prontuário longitudinal.',
          code: 'MIGRATION_REQUIRED',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível salvar o registro no prontuário.' },
      { status: 502 }
    );
  }

  const response = NextResponse.json(
    { record: { ...created, addenda: [] } },
    { status: 201 }
  );
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

  const session = await getAuthenticatedSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Autenticação necessária.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const { id: patientId } = await contextParams.params;
  if (!UUID_REGEX.test(patientId)) {
    return NextResponse.json(
      { error: 'Identificador de paciente inválido.' },
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

  const recordId = typeof body.recordId === 'string' ? body.recordId : '';
  if (!UUID_REGEX.test(recordId)) {
    return NextResponse.json(
      { error: 'Identificador do registro inválido.' },
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

  const { data: existing, error: fetchError } = await supabase
    .from('medical_records')
    .select('*')
    .eq('organization_id', context.organization.id)
    .eq('patient_id', patientId)
    .eq('id', recordId)
    .maybeSingle();

  if (fetchError || !existing) {
    return NextResponse.json(
      { error: 'Registro do prontuário não encontrado.' },
      { status: 404 }
    );
  }

  if (existing.is_finalized) {
    return NextResponse.json(
      {
        error:
          'Registros clínicos concluídos são imutáveis e não podem ser alterados diretamente. Adicione uma nota corretiva.',
        code: 'IMMUTABLE_RECORD',
      },
      { status: 403 }
    );
  }

  if (
    existing.author_user_id !== session.user.id &&
    !context.isAdmin
  ) {
    return NextResponse.json(
      { error: 'Apenas o autor ou administrador pode editar este rascunho.' },
      { status: 403 }
    );
  }

  const nextTitle =
    typeof body.title === 'string' && body.title.trim().length >= 2
      ? body.title.trim().slice(0, 160)
      : existing.title;
  const nextContent =
    typeof body.content === 'string' && body.content.trim().length >= 3
      ? body.content.trim().slice(0, 12000)
      : existing.content;
  const finalizeNow = body.finalize === true;

  const { data: updated, error: updateError } = await supabase
    .from('medical_records')
    .update({
      title: nextTitle,
      content: nextContent,
      is_finalized: finalizeNow ? true : false,
      finalized_at: finalizeNow ? new Date().toISOString() : null,
      finalized_by: finalizeNow ? session.user.id : null,
    })
    .eq('organization_id', context.organization.id)
    .eq('id', recordId)
    .select('*')
    .single();

  if (updateError) {
    if (updateError.code === '42501') {
      return NextResponse.json(
        {
          error:
            'Registros concluídos do prontuário não podem ser alterados diretamente.',
          code: 'IMMUTABLE_RECORD',
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível atualizar o rascunho.' },
      { status: 502 }
    );
  }

  const response = NextResponse.json({ record: { ...updated, addenda: [] } });
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

  const session = await getAuthenticatedSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'Autenticação necessária.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const { id: patientId } = await contextParams.params;
  const recordId = req.nextUrl.searchParams.get('recordId') ?? '';
  if (!UUID_REGEX.test(patientId) || !UUID_REGEX.test(recordId)) {
    return NextResponse.json(
      { error: 'Identificador inválido.' },
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
    .from('medical_records')
    .select('id, category, is_finalized, author_user_id')
    .eq('organization_id', context.organization.id)
    .eq('patient_id', patientId)
    .eq('id', recordId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: 'Registro não encontrado.' },
      { status: 404 }
    );
  }

  if (existing.is_finalized || existing.category === 'clinical') {
    return NextResponse.json(
      {
        error:
          'Registros clínicos e registros concluídos são imutáveis e não podem ser excluídos.',
        code: 'IMMUTABLE_RECORD',
      },
      { status: 403 }
    );
  }

  const { error: delError } = await supabase
    .from('medical_records')
    .delete()
    .eq('organization_id', context.organization.id)
    .eq('id', recordId);

  if (delError) {
    return NextResponse.json(
      {
        error:
          delError.code === '42501'
            ? 'Este registro é imutável e não pode ser excluído.'
            : 'Não foi possível excluir o rascunho.',
      },
      { status: delError.code === '42501' ? 403 : 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
