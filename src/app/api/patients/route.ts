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
  PATIENT_STATUS_LIST,
  PATIENT_STATUS_META,
  computePatientAuditDiff,
} from '@/lib/patients/constants';
import {
  PATIENT_SELECT_FIELDS,
  canUserAuthorClinicalRecord,
  findDuplicatePatientByCpf,
  normalizeLegacyPatientRow,
  validatePatientPayload,
} from '@/lib/patients/server';
import { getPlanBySlug, isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { PatientOperationalStatus, PatientRecord } from '@/types/patients';

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
        patients: [],
        countsByStatus: {
          em_avaliacao: 0,
          em_tratamento: 0,
          em_acompanhamento: 0,
          alta: 0,
          inativo: 0,
          desistencia: 0,
        },
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

    let migrationPending = false;
    let patients: PatientRecord[] = [];

    const fullRes = await supabase
      .from('patients')
      .select(PATIENT_SELECT_FIELDS)
      .eq('organization_id', context.organization.id)
      .order('name', { ascending: true });

    if (fullRes.error) {
      if (isMissingAgendaTableError(fullRes.error)) {
        migrationPending = true;
        const basicRes = await supabase
          .from('patients')
          .select('id, organization_id, name, phone, email, created_at')
          .eq('organization_id', context.organization.id)
          .order('name', { ascending: true });

        if (!basicRes.error && basicRes.data) {
          patients = (basicRes.data as Record<string, unknown>[]).map(
            normalizeLegacyPatientRow
          );
        }
      } else {
        throw new Error(fullRes.error.message);
      }
    } else {
      patients = (
        (fullRes.data ?? []) as unknown as Record<string, unknown>[]
      ).map(normalizeLegacyPatientRow);

      // Probe medical_records & patient_audit_logs so the UI can remind admin if Section 7 is missing
      const [recordsProbe, auditProbe] = await Promise.all([
        supabase.from('medical_records').select('id').limit(1),
        supabase.from('patient_audit_logs').select('id').limit(1),
      ]);
      if (
        isMissingAgendaTableError(recordsProbe.error) ||
        isMissingAgendaTableError(auditProbe.error)
      ) {
        migrationPending = true;
      }
    }

    const countsByStatus = PATIENT_STATUS_LIST.reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as Record<PatientOperationalStatus, number>
    );

    for (const p of patients) {
      countsByStatus[p.status] = (countsByStatus[p.status] ?? 0) + 1;
    }

    const response = NextResponse.json({
      organization: context.organization,
      organizations: context.organizations,
      role: context.role,
      isAdmin: context.isAdmin,
      canAuthorClinical,
      patients,
      countsByStatus,
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
          ? `Não foi possível carregar os pacientes (${detail}).`
          : 'Não foi possível carregar os pacientes.',
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

  const validation = validatePatientPayload(body, 'em_avaliacao');
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
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

  // Check plan limit
  const planLimits = await resolveOrgPlanLimits(
    supabase,
    session.user.id,
    session.user.plan_slug
  );
  if (planLimits.maxPatients !== null) {
    const { count } = await supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', context.organization.id);

    if ((count ?? 0) >= planLimits.maxPatients) {
      return NextResponse.json(
        {
          error: `Seu plano ${planLimits.planName} permite até ${planLimits.maxPatients} pacientes cadastrados. Atualize o plano em Configurações para ampliar o limite.`,
          code: 'PLAN_LIMIT_REACHED',
        },
        { status: 403 }
      );
    }
  }

  const data = validation.data;

  // Duplicate CPF check inside the same organization
  if (data.cpf_digits) {
    const duplicate = await findDuplicatePatientByCpf(
      supabase,
      context.organization.id,
      data.cpf_digits
    );

    if (duplicate) {
      return NextResponse.json(
        {
          error: `Já existe um paciente cadastrado com este CPF nesta clínica (${duplicate.name}).`,
          code: 'DUPLICATE_CPF',
          existingPatient: duplicate,
        },
        { status: 409 }
      );
    }
  }

  const insertPayload = {
    organization_id: context.organization.id,
    ...data,
    updated_by: session.user.id,
  };

  let { data: inserted, error: insertError } = await supabase
    .from('patients')
    .insert(insertPayload)
    .select(PATIENT_SELECT_FIELDS)
    .single();

  if (
    insertError &&
    insertError.code === '23502' &&
    insertError.message?.toLowerCase().includes('full_name')
  ) {
    const retry = await supabase
      .from('patients')
      .insert({ ...insertPayload, full_name: data.name })
      .select(PATIENT_SELECT_FIELDS)
      .single();
    inserted = retry.data;
    insertError = retry.error;
  }

  if (insertError) {
    if (insertError.code === '23505') {
      const existing = data.cpf_digits
        ? await findDuplicatePatientByCpf(
            supabase,
            context.organization.id,
            data.cpf_digits
          )
        : null;
      return NextResponse.json(
        {
          error: existing
            ? `Já existe um paciente cadastrado com este CPF nesta clínica (${existing.name}).`
            : 'Já existe um paciente cadastrado com este CPF nesta clínica.',
          code: 'DUPLICATE_CPF',
          existingPatient: existing,
        },
        { status: 409 }
      );
    }
    if (isMissingAgendaTableError(insertError)) {
      return NextResponse.json(
        {
          error:
            'Execute a Seção 7 do arquivo sql.md no Supabase para habilitar os novos campos de cadastro e prontuário.',
          code: 'MIGRATION_REQUIRED',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível cadastrar o paciente.' },
      { status: 502 }
    );
  }

  const patient = normalizeLegacyPatientRow(
    inserted as unknown as Record<string, unknown>
  );
  const actorName = session.user.name || session.user.email || 'Equipe';
  const changedFields = computePatientAuditDiff({}, patient);

  await Promise.all([
    supabase.from('patient_audit_logs').insert({
      organization_id: context.organization.id,
      patient_id: patient.id,
      actor_user_id: session.user.id,
      actor_name: actorName,
      actor_email: session.user.email,
      action: 'created',
      changed_fields: changedFields,
      previous_values: null,
      new_values: patient,
      reason: validation.reason || 'Cadastro inicial do paciente',
    }),
    supabase.from('medical_records').insert({
      organization_id: context.organization.id,
      patient_id: patient.id,
      category: 'administrative',
      record_type: 'admissao',
      title: 'Cadastro inicial do paciente',
      content: `Paciente cadastrado com situação "${PATIENT_STATUS_META[patient.status].label}".${
        patient.has_no_cpf
          ? patient.alt_identifier_value
            ? ` Identificador alternativo: ${patient.alt_identifier_type || 'Documento'} ${patient.alt_identifier_value}.`
            : patient.legal_guardian_name
              ? ` Responsável legal: ${patient.legal_guardian_name}.`
              : ' Cadastro registrado sem CPF.'
          : ''
      }`,
      is_finalized: true,
      finalized_at: new Date().toISOString(),
      finalized_by: session.user.id,
      author_user_id: session.user.id,
      author_name: actorName,
      author_email: session.user.email,
    }),
  ]);

  const response = NextResponse.json({ patient }, { status: 201 });
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
