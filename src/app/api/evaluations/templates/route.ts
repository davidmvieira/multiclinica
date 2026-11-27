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
import { cleanOptionalText } from '@/lib/evaluations/server';
import { canUserAuthorClinicalRecord } from '@/lib/patients/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  EvaluationFieldDefinition,
  EvaluationFieldType,
  EvaluationSectionDefinition,
  EvaluationTemplateSchema,
} from '@/types/evaluations';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_FIELD_TYPES: EvaluationFieldType[] = [
  'text',
  'textarea',
  'number',
  'select',
  'multiselect',
  'boolean',
  'scale_eva',
  'scale_mrc',
  'date',
];

function sanitizeSchemaPayload(rawSchema: unknown): EvaluationTemplateSchema | null {
  if (!rawSchema || typeof rawSchema !== 'object') return null;
  const candidate = rawSchema as {
    sections?: unknown;
    homologationNote?: unknown;
  };
  if (!Array.isArray(candidate.sections) || candidate.sections.length === 0) {
    return null;
  }

  const sections: EvaluationSectionDefinition[] = [];
  const usedFieldIds = new Set<string>();

  for (let sIdx = 0; sIdx < candidate.sections.length; sIdx++) {
    const rawSec = candidate.sections[sIdx] as Record<string, unknown>;
    const title = cleanOptionalText(rawSec.title, 160);
    const id =
      cleanOptionalText(rawSec.id, 80)?.replace(/[^a-zA-Z0-9_-]/g, '_') ||
      `secao_${sIdx + 1}`;
    if (!title) continue;

    const rawFields = Array.isArray(rawSec.fields) ? rawSec.fields : [];
    const fields: EvaluationFieldDefinition[] = [];

    for (let fIdx = 0; fIdx < rawFields.length; fIdx++) {
      const rawField = rawFields[fIdx] as Record<string, unknown>;
      const label = cleanOptionalText(rawField.label, 200);
      const type = rawField.type as EvaluationFieldType;
      if (!label || !VALID_FIELD_TYPES.includes(type)) continue;

      let fieldId =
        cleanOptionalText(rawField.id, 80)?.replace(/[^a-zA-Z0-9_-]/g, '_') ||
        `campo_${sIdx + 1}_${fIdx + 1}`;
      if (usedFieldIds.has(fieldId)) {
        fieldId = `${fieldId}_${fIdx + 1}`;
      }
      usedFieldIds.add(fieldId);

      const options = Array.isArray(rawField.options)
        ? rawField.options
            .filter((opt): opt is string => typeof opt === 'string')
            .map((opt) => opt.trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 30)
        : undefined;

      fields.push({
        id: fieldId,
        label,
        type,
        required: Boolean(rawField.required),
        placeholder: cleanOptionalText(rawField.placeholder, 200) ?? undefined,
        helpText: cleanOptionalText(rawField.helpText, 240) ?? undefined,
        unit: cleanOptionalText(rawField.unit, 24) ?? undefined,
        min: typeof rawField.min === 'number' ? rawField.min : undefined,
        max: typeof rawField.max === 'number' ? rawField.max : undefined,
        step: typeof rawField.step === 'number' ? rawField.step : undefined,
        options:
          type === 'select' || type === 'multiselect'
            ? options && options.length > 0
              ? options
              : ['Opção 1', 'Opção 2']
            : undefined,
      });
    }

    if (fields.length === 0) continue;

    sections.push({
      id,
      order: sIdx + 1,
      title,
      description: cleanOptionalText(rawSec.description, 320) ?? undefined,
      is_restricted_to_author: Boolean(rawSec.is_restricted_to_author),
      fields,
    });
  }

  if (sections.length === 0) return null;

  return {
    homologationNote:
      cleanOptionalText(candidate.homologationNote, 300) ||
      'Nova versão estrutural publicada pela equipe técnica.',
    sections,
  };
}

export async function POST(req: NextRequest) {
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Formato de requisição inválido.' },
      { status: 400 }
    );
  }

  const templateId =
    typeof body.templateId === 'string' ? body.templateId.trim() : '';
  if (!UUID_REGEX.test(templateId)) {
    return NextResponse.json(
      { error: 'Modelo de avaliação inválido.' },
      { status: 400 }
    );
  }

  const schema = sanitizeSchemaPayload(body.schema);
  if (!schema) {
    return NextResponse.json(
      {
        error:
          'Estrutura do modelo inválida: informe ao menos uma seção com campos válidos.',
      },
      { status: 400 }
    );
  }

  const changelog = cleanOptionalText(body.changelog, 400);
  if (!changelog || changelog.length < 4) {
    return NextResponse.json(
      {
        error:
          'Informe a justificativa/descrição da nova versão do modelo (mínimo 4 caracteres).',
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
      {
        error:
          'Sem permissão para publicar novas versões de modelos clínicos.',
      },
      { status: 403 }
    );
  }

  const [tplRes, profRes] = await Promise.all([
    supabase
      .from('evaluation_templates')
      .select('*')
      .eq('id', templateId)
      .eq('organization_id', context.organization.id)
      .maybeSingle(),
    supabase
      .from('professionals')
      .select('display_name')
      .eq('organization_id', context.organization.id)
      .eq('user_id', session.user.id)
      .maybeSingle(),
  ]);

  if (tplRes.error) {
    if (isMissingAgendaTableError(tplRes.error)) {
      return NextResponse.json(
        { error: 'Execute a Seção 8 do sql.md no Supabase.', code: 'MIGRATION_REQUIRED' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Erro ao consultar modelo.' },
      { status: 502 }
    );
  }

  if (!tplRes.data) {
    return NextResponse.json(
      { error: 'Modelo não encontrado nesta organização.' },
      { status: 404 }
    );
  }

  const nextVersionNumber = Number(tplRes.data.current_version_number ?? 1) + 1;
  const creatorName =
    (profRes.data?.display_name as string | null) ||
    session.user.name ||
    session.user.email ||
    'Responsável Técnico';

  // Insert a strictly new immutable version row without altering prior versions
  const { data: newVersion, error: verInsertErr } = await supabase
    .from('evaluation_template_versions')
    .insert({
      organization_id: context.organization.id,
      template_id: templateId,
      version_number: nextVersionNumber,
      changelog,
      schema_json: schema,
      created_by: session.user.id,
      created_by_name: creatorName,
    })
    .select('*')
    .single();

  if (verInsertErr || !newVersion) {
    return NextResponse.json(
      { error: 'Não foi possível publicar a nova versão do modelo.' },
      { status: 502 }
    );
  }

  const { data: updatedTemplate, error: tplUpdateErr } = await supabase
    .from('evaluation_templates')
    .update({
      current_version_number: nextVersionNumber,
      current_version_id: newVersion.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId)
    .eq('organization_id', context.organization.id)
    .select('*')
    .single();

  if (tplUpdateErr) {
    return NextResponse.json(
      { error: 'Versão criada, mas não foi possível atualizar o ponteiro do modelo.' },
      { status: 502 }
    );
  }

  const response = NextResponse.json(
    {
      template: updatedTemplate,
      version: newVersion,
    },
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
