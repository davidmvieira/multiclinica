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
  ensureOrgEvaluationTemplates,
  extractSourceIp,
  minimizeEvaluationForViewer,
  recordEvaluationAuditEvent,
  sanitizeAnswersObject,
  syncFinalizedEvaluationToMedicalRecord,
} from '@/lib/evaluations/server';
import { validateEvaluationForConclusion } from '@/lib/evaluations/templates-catalog';
import { canUserAuthorClinicalRecord } from '@/lib/patients/server';
import { getPlanBySlug, isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  EvaluationAuditEvent,
  EvaluationPatientOption,
  EvaluationRecord,
  EvaluationTemplateVersionRecord,
} from '@/types/evaluations';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveOrgPlanLimits(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  userId: string,
  fallbackSlug: string | null | undefined
) {
  let planSlug = isValidPlanSlug(fallbackSlug) ? fallbackSlug : 'free';
  const { data: subRow } = await supabase
    .from('subscriptions')
    .select('plan_slug')
    .eq('user_id', userId)
    .maybeSingle();

  if (subRow && isValidPlanSlug(subRow.plan_slug)) {
    planSlug = subRow.plan_slug;
  }

  const planDef = getPlanBySlug(planSlug);
  return {
    planSlug: planDef.slug,
    planName: planDef.name,
    maxProfessionals: planDef.max_professionals,
    maxPatients: planDef.max_patients,
  };
}

export async function GET(req: NextRequest) {
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

  const supabase = createSupabaseServerClient(session.accessToken);
  const planLimits = await resolveOrgPlanLimits(
    supabase,
    session.user.id,
    session.user.plan_slug
  );

  try {
    const { context, migrationPending: contextMigrationPending } =
      await resolveAgendaAccessContext(
        supabase,
        session.user.id,
        session.user.email,
        session.activeOrganizationId
      );

    if (contextMigrationPending) {
      return NextResponse.json(
        {
          error: 'As tabelas da clínica ainda não foram criadas no Supabase.',
          code: 'TABLE_NOT_FOUND',
          planLimits,
        },
        { status: 404 }
      );
    }

    if (!context) {
      return NextResponse.json({
        organization: null,
        organizations: [],
        role: 'admin',
        isAdmin: true,
        canAuthorClinical: true,
        currentUserId: session.user.id,
        currentUserName: session.user.name || session.user.email || 'Profissional',
        currentUserCouncilNumber: null,
        currentProfessionalId: null,
        templates: [],
        versions: [],
        evaluations: [],
        patients: [],
        auditEvents: [],
        migrationPending: false,
        needsBootstrap: true,
        planLimits,
      });
    }

    const isOwner = context.organization.owner_user_id === session.user.id;
    const canAuthorClinical = await canUserAuthorClinicalRecord(
      supabase,
      context.organization.id,
      session.user.id,
      context.role,
      isOwner
    );

    const [profRes, patientsRes] = await Promise.all([
      supabase
        .from('professionals')
        .select('id, display_name, council_number')
        .eq('organization_id', context.organization.id)
        .eq('user_id', session.user.id)
        .maybeSingle(),
      supabase
        .from('patients')
        .select('id, name, cpf, status')
        .eq('organization_id', context.organization.id)
        .order('name', { ascending: true }),
    ]);

    const currentUserName =
      profRes.data?.display_name ||
      session.user.name ||
      session.user.email ||
      'Profissional';
    const currentUserCouncilNumber =
      (profRes.data?.council_number as string | null) ?? null;
    const currentProfessionalId = (profRes.data?.id as string | null) ?? null;

    const patients = (patientsRes.data ?? []) as EvaluationPatientOption[];
    const patientMap = new Map(patients.map((p) => [p.id, p]));

    let templates = [] as Awaited<
      ReturnType<typeof ensureOrgEvaluationTemplates>
    >['templates'];
    let versions: EvaluationTemplateVersionRecord[] = [];
    let evaluations: EvaluationRecord[] = [];
    let auditEvents: EvaluationAuditEvent[] = [];
    let migrationPending = false;

    try {
      const seeded = await ensureOrgEvaluationTemplates(
        supabase,
        context.organization.id,
        session.user.id,
        currentUserName
      );
      templates = seeded.templates;
      versions = seeded.versions;

      const [evalRes, auditRes] = await Promise.all([
        supabase
          .from('evaluations')
          .select('*')
          .eq('organization_id', context.organization.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('evaluation_audit_events')
          .select('*')
          .eq('organization_id', context.organization.id)
          .order('timestamp_utc', { ascending: false })
          .limit(120),
      ]);

      if (evalRes.error) {
        if (isMissingAgendaTableError(evalRes.error)) {
          migrationPending = true;
        } else {
          throw new Error(evalRes.error.message);
        }
      } else {
        const versionMap = new Map(versions.map((v) => [v.id, v]));
        const rawEvaluations = (evalRes.data ?? []) as EvaluationRecord[];
        evaluations = rawEvaluations
          .filter(
            (ev) =>
              ev.status === 'finalized' ||
              ev.author_user_id === session.user.id
          )
          .map((ev) => {
            const ver = versionMap.get(ev.template_version_id);
            const minimized = minimizeEvaluationForViewer(
              ev,
              ver?.schema_json ?? null,
              session.user.id
            );
            const patient = patientMap.get(ev.patient_id);
            return {
              ...minimized,
              patient_name: patient?.name ?? 'Paciente',
              patient_cpf: patient?.cpf ?? null,
            };
          });
      }

      if (auditRes.error) {
        if (isMissingAgendaTableError(auditRes.error)) {
          migrationPending = true;
        }
      } else {
        auditEvents = (auditRes.data ?? []) as EvaluationAuditEvent[];
      }
    } catch (err) {
      const candidate = err as { code?: string; message?: string };
      if (isMissingAgendaTableError(candidate)) {
        migrationPending = true;
      } else {
        throw err;
      }
    }

    const response = NextResponse.json({
      organization: context.organization,
      organizations: context.organizations,
      role: context.role,
      isAdmin: context.isAdmin,
      canAuthorClinical,
      currentUserId: session.user.id,
      currentUserName,
      currentUserCouncilNumber,
      currentProfessionalId,
      templates,
      versions,
      evaluations,
      patients,
      auditEvents,
      migrationPending,
      needsBootstrap: false,
      planLimits,
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
  } catch (err) {
    const detail = err instanceof Error ? err.message : '';
    return NextResponse.json(
      {
        error: detail
          ? `Não foi possível carregar as avaliações (${detail}).`
          : 'Não foi possível carregar as avaliações.',
      },
      { status: 502 }
    );
  }
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

  const patientId =
    typeof body.patientId === 'string' ? body.patientId.trim() : '';
  const templateId =
    typeof body.templateId === 'string' ? body.templateId.trim() : '';
  const requestedVersionId =
    typeof body.templateVersionId === 'string'
      ? body.templateVersionId.trim()
      : '';
  const finalize = Boolean(body.finalize);

  if (!UUID_REGEX.test(patientId) || !UUID_REGEX.test(templateId)) {
    return NextResponse.json(
      { error: 'Paciente ou modelo de avaliação inválido.' },
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
          'Seu perfil atual não possui permissão para registrar avaliações clínicas.',
      },
      { status: 403 }
    );
  }

  const [patientRes, templateRes, profRes] = await Promise.all([
    supabase
      .from('patients')
      .select('id, name, cpf')
      .eq('id', patientId)
      .eq('organization_id', context.organization.id)
      .maybeSingle(),
    supabase
      .from('evaluation_templates')
      .select('*')
      .eq('id', templateId)
      .eq('organization_id', context.organization.id)
      .maybeSingle(),
    supabase
      .from('professionals')
      .select('id, display_name, council_number')
      .eq('organization_id', context.organization.id)
      .eq('user_id', session.user.id)
      .maybeSingle(),
  ]);

  if (patientRes.error || !patientRes.data) {
    return NextResponse.json(
      { error: 'Paciente não encontrado nesta organização.' },
      { status: 404 }
    );
  }

  if (templateRes.error) {
    if (isMissingAgendaTableError(templateRes.error)) {
      return NextResponse.json(
        {
          error:
            'Execute a Seção 8 do arquivo sql.md no Supabase para habilitar avaliações clínicas.',
          code: 'MIGRATION_REQUIRED',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível localizar o modelo de avaliação.' },
      { status: 502 }
    );
  }

  if (!templateRes.data) {
    return NextResponse.json(
      { error: 'Modelo de avaliação não encontrado nesta clínica.' },
      { status: 404 }
    );
  }

  const versionIdToUse =
    UUID_REGEX.test(requestedVersionId)
      ? requestedVersionId
      : (templateRes.data.current_version_id as string | null);

  if (!versionIdToUse) {
    return NextResponse.json(
      { error: 'Versão estrutural do modelo não encontrada.' },
      { status: 400 }
    );
  }

  const { data: versionRow, error: verErr } = await supabase
    .from('evaluation_template_versions')
    .select('*')
    .eq('id', versionIdToUse)
    .eq('template_id', templateId)
    .eq('organization_id', context.organization.id)
    .maybeSingle();

  if (verErr || !versionRow) {
    return NextResponse.json(
      { error: 'Versão do modelo não pertence à organização ativa.' },
      { status: 404 }
    );
  }

  const answers = sanitizeAnswersObject(body.answers);
  const sharedSummary = cleanOptionalText(body.sharedSummary, 4000);
  const functionalDiagnosis = cleanOptionalText(body.functionalDiagnosis, 2000);
  const cbdfCode = cleanOptionalText(body.cbdfCode, 40);
  const cbdfDescription = cleanOptionalText(body.cbdfDescription, 600);
  const procedureCode = cleanOptionalText(body.procedureCode, 40);
  const procedureDescription = cleanOptionalText(body.procedureDescription, 300);

  const authorName =
    (profRes.data?.display_name as string | null) ||
    session.user.name ||
    session.user.email ||
    'Fisioterapeuta';
  const authorCouncilNumber =
    cleanOptionalText(body.authorCouncilNumber, 60) ||
    cleanOptionalText(profRes.data?.council_number, 60);

  const typedVersion = versionRow as EvaluationTemplateVersionRecord;

  if (finalize) {
    const conclusionCheck = validateEvaluationForConclusion(
      typedVersion.schema_json,
      answers,
      {
        functionalDiagnosis,
        cbdfCode,
        cbdfDescription,
        authorCouncilNumber,
      }
    );
    if (!conclusionCheck.ok) {
      return NextResponse.json(
        {
          error: conclusionCheck.error,
          missingFields: conclusionCheck.missingFields,
        },
        { status: 400 }
      );
    }
  }

  const finalizedAtUtc = finalize ? new Date().toISOString() : null;

  const { data: inserted, error: insertError } = await supabase
    .from('evaluations')
    .insert({
      organization_id: context.organization.id,
      patient_id: patientId,
      professional_id: (profRes.data?.id as string | null) ?? null,
      template_id: templateId,
      template_version_id: typedVersion.id,
      template_version_number: typedVersion.version_number,
      template_name: templateRes.data.name,
      status: finalize ? 'finalized' : 'draft',
      answers,
      shared_summary: sharedSummary,
      functional_diagnosis: functionalDiagnosis,
      cbdf_code: cbdfCode,
      cbdf_description: cbdfDescription,
      procedure_code: procedureCode,
      procedure_description: procedureDescription,
      author_user_id: session.user.id,
      author_name: authorName,
      author_council_number: authorCouncilNumber,
      finalized_at_utc: finalizedAtUtc,
    })
    .select('*')
    .single();

  if (insertError || !inserted) {
    if (isMissingAgendaTableError(insertError)) {
      return NextResponse.json(
        {
          error:
            'Execute a Seção 8 do arquivo sql.md no Supabase para salvar avaliações.',
          code: 'MIGRATION_REQUIRED',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível salvar a avaliação clínica.' },
      { status: 502 }
    );
  }

  const evaluation = inserted as EvaluationRecord;
  const sourceIp = extractSourceIp(req);

  await recordEvaluationAuditEvent(supabase, {
    organizationId: context.organization.id,
    evaluationId: evaluation.id,
    patientId,
    userId: session.user.id,
    userName: authorName,
    userEmail: session.user.email,
    action: finalize ? 'FINALIZE_EVALUATION' : 'OPEN_DRAFT',
    sourceIp,
    details: {
      template_name: evaluation.template_name,
      template_version_number: evaluation.template_version_number,
      cbdf_code: evaluation.cbdf_code,
    },
  });

  if (finalize && finalizedAtUtc) {
    await syncFinalizedEvaluationToMedicalRecord(supabase, {
      organizationId: context.organization.id,
      patientId,
      evaluationId: evaluation.id,
      templateName: evaluation.template_name,
      versionNumber: evaluation.template_version_number,
      functionalDiagnosis: functionalDiagnosis ?? '',
      cbdfCode: cbdfCode ?? '',
      cbdfDescription: cbdfDescription ?? '',
      sharedSummary,
      authorUserId: session.user.id,
      authorName,
      authorEmail: session.user.email,
      authorCouncilNumber: authorCouncilNumber ?? '',
      finalizedAtUtc,
    });
  }

  const response = NextResponse.json(
    {
      evaluation: {
        ...evaluation,
        patient_name: patientRes.data.name,
        patient_cpf: patientRes.data.cpf,
        viewerIsAuthor: true,
        restrictedSectionIds: [],
      },
      templateVersion: typedVersion,
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
