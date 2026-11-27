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
import { getPlanBySlug, isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  ClinicalEvolutionAuditEvent,
  ClinicalEvolutionRecord,
  EvolutionPatientOption,
  EvolutionPendencyRecord,
  EvolutionProfessionalOption,
  EvolutionRectificationRecord,
} from '@/types/evolutions';

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
        professionals: [],
        patients: [],
        pendencies: [],
        evolutions: [],
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

    const [profsRes, patientsRes, unitsRes, servicesRes, specialtiesRes] =
      await Promise.all([
        supabase
          .from('professionals')
          .select('id, user_id, name, council_number')
          .eq('organization_id', context.organization.id)
          .order('name', { ascending: true }),
        supabase
          .from('patients')
          .select('id, name, cpf, status')
          .eq('organization_id', context.organization.id)
          .order('name', { ascending: true }),
        supabase
          .from('units')
          .select('id, name')
          .eq('organization_id', context.organization.id),
        supabase
          .from('services')
          .select('id, name')
          .eq('organization_id', context.organization.id),
        supabase
          .from('specialties')
          .select('id, name')
          .eq('organization_id', context.organization.id),
      ]);

    const professionals = (profsRes.data ?? []) as EvolutionProfessionalOption[];
    const ownProf = professionals.find((p) => p.user_id === session.user.id);
    const patients = (patientsRes.data ?? []) as EvolutionPatientOption[];

    const profMap = new Map(professionals.map((p) => [p.id, p]));
    const patientMap = new Map(patients.map((p) => [p.id, p]));
    const unitMap = new Map(
      (unitsRes.data ?? []).map((u) => [String(u.id), String(u.name)])
    );
    const serviceMap = new Map(
      (servicesRes.data ?? []).map((s) => [String(s.id), String(s.name)])
    );
    const specialtyMap = new Map(
      (specialtiesRes.data ?? []).map((s) => [String(s.id), String(s.name)])
    );

    const currentUserName =
      ownProf?.name || session.user.name || session.user.email || 'Profissional';
    const currentUserCouncilNumber = ownProf?.council_number ?? null;
    const currentProfessionalId = ownProf?.id ?? null;

    let viewerSpecialties: string[] = [];
    if (ownProf?.id) {
      const { data: profSpecRows } = await supabase
        .from('professional_specialties')
        .select('specialty_id')
        .eq('professional_id', ownProf.id);
      viewerSpecialties = (profSpecRows ?? [])
        .map((r) => specialtyMap.get(String(r.specialty_id)) ?? '')
        .filter(Boolean);
    }

    let migrationPending = false;
    let pendencies: EvolutionPendencyRecord[] = [];
    let evolutions: ClinicalEvolutionRecord[] = [];
    let auditEvents: ClinicalEvolutionAuditEvent[] = [];

    const [pendRes, evolRes, rectRes, auditRes, completedApptsRes] =
      await Promise.all([
        supabase
          .from('evolution_pendencies')
          .select('*')
          .eq('organization_id', context.organization.id)
          .order('session_starts_at', { ascending: false }),
        supabase
          .from('clinical_evolutions')
          .select('*')
          .eq('organization_id', context.organization.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('evolution_rectifications')
          .select('*')
          .eq('organization_id', context.organization.id)
          .order('created_at_utc', { ascending: true }),
        supabase
          .from('clinical_evolution_audit_events')
          .select('*')
          .eq('organization_id', context.organization.id)
          .order('timestamp_utc', { ascending: false })
          .limit(120),
        supabase
          .from('appointments')
          .select(
            'id, patient_id, professional_id, unit_id, service_id, specialty_id, starts_at, ends_at, status'
          )
          .eq('organization_id', context.organization.id)
          .eq('status', 'completed')
          .order('starts_at', { ascending: false })
          .limit(300),
      ]);

    if (
      isMissingAgendaTableError(pendRes.error) ||
      isMissingAgendaTableError(evolRes.error) ||
      isMissingAgendaTableError(rectRes.error) ||
      isMissingAgendaTableError(auditRes.error)
    ) {
      migrationPending = true;
    } else {
      const apptMap = new Map(
        (completedApptsRes.data ?? []).map((a) => [String(a.id), a])
      );

      const rectsByEvolution = new Map<string, EvolutionRectificationRecord[]>();
      for (const rect of (rectRes.data ?? []) as EvolutionRectificationRecord[]) {
        const list = rectsByEvolution.get(rect.evolution_id) ?? [];
        list.push(rect);
        rectsByEvolution.set(rect.evolution_id, list);
      }

      const rawEvolutions = (evolRes.data ?? []) as ClinicalEvolutionRecord[];
      const ownDraftByAppt = new Map<string, string>();
      for (const ev of rawEvolutions) {
        if (ev.status === 'draft' && ev.author_user_id === session.user.id) {
          ownDraftByAppt.set(ev.appointment_id, ev.id);
        }
      }

      evolutions = rawEvolutions
        .filter(
          (ev) =>
            ev.status === 'finalized' || ev.author_user_id === session.user.id
        )
        .map((ev) => {
          const minimized = minimizeClinicalEvolutionForViewer(
            ev,
            session.user.id,
            viewerSpecialties
          );
          const patient = patientMap.get(ev.patient_id);
          const appt = apptMap.get(ev.appointment_id);
          return {
            ...minimized,
            patient_name: patient?.name ?? 'Paciente',
            patient_cpf: patient?.cpf ?? null,
            appointment_starts_at: appt ? String(appt.starts_at) : null,
            appointment_ends_at: appt ? String(appt.ends_at) : null,
            service_name: appt?.service_id
              ? (serviceMap.get(String(appt.service_id)) ?? null)
              : null,
            unit_name: ev.unit_id
              ? (unitMap.get(ev.unit_id) ?? null)
              : appt?.unit_id
                ? (unitMap.get(String(appt.unit_id)) ?? null)
                : null,
            rectifications: rectsByEvolution.get(ev.id) ?? [],
          };
        });

      pendencies = (pendRes.data ?? []).map((p) => {
        const patient = patientMap.get(String(p.patient_id));
        const prof = profMap.get(String(p.professional_id));
        const appt = apptMap.get(String(p.appointment_id));
        return {
          id: String(p.id),
          organization_id: String(p.organization_id),
          appointment_id: String(p.appointment_id),
          patient_id: String(p.patient_id),
          professional_id: String(p.professional_id),
          schedule_id: (p.schedule_id as string | null) ?? null,
          unit_id: (p.unit_id as string | null) ?? null,
          session_starts_at: String(p.session_starts_at),
          session_ends_at: String(p.session_ends_at),
          status: p.status as EvolutionPendencyRecord['status'],
          evolution_id: (p.evolution_id as string | null) ?? null,
          resolved_at_utc: (p.resolved_at_utc as string | null) ?? null,
          created_at: String(p.created_at),
          updated_at: String(p.updated_at),
          patient_name: patient?.name ?? 'Paciente',
          patient_cpf: patient?.cpf ?? null,
          professional_name: prof?.name ?? 'Profissional',
          professional_user_id: prof?.user_id ?? null,
          unit_name: p.unit_id ? (unitMap.get(String(p.unit_id)) ?? null) : null,
          service_name: appt?.service_id
            ? (serviceMap.get(String(appt.service_id)) ?? null)
            : null,
          specialty_name: appt?.specialty_id
            ? (specialtyMap.get(String(appt.specialty_id)) ?? null)
            : null,
          draft_evolution_id: ownDraftByAppt.get(String(p.appointment_id)) ?? null,
        };
      });

      auditEvents = (auditRes.data ?? []) as ClinicalEvolutionAuditEvent[];
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
      professionals,
      patients,
      pendencies,
      evolutions,
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
          ? `Não foi possível carregar as evoluções (${detail}).`
          : 'Não foi possível carregar as evoluções.',
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

  const appointmentId =
    typeof body.appointmentId === 'string' ? body.appointmentId.trim() : '';
  const finalize = Boolean(body.finalize);

  if (!UUID_REGEX.test(appointmentId)) {
    return NextResponse.json(
      { error: 'Selecione um atendimento realizado válido (Encounter).' },
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
          'Seu perfil atual não possui permissão para registrar evoluções clínicas.',
      },
      { status: 403 }
    );
  }

  // Note: Billing/financial pendency never blocks clinical evolution registration (US04.3)
  const { data: apptRow, error: apptErr } = await supabase
    .from('appointments')
    .select(
      'id, organization_id, patient_id, professional_id, unit_id, starts_at, ends_at, status'
    )
    .eq('id', appointmentId)
    .eq('organization_id', context.organization.id)
    .maybeSingle();

  if (apptErr || !apptRow) {
    return NextResponse.json(
      { error: 'Atendimento não encontrado nesta organização.' },
      { status: 404 }
    );
  }

  if (apptRow.status !== 'completed') {
    return NextResponse.json(
      {
        error:
          'A evolução clínica exige vínculo com um atendimento marcado como "Realizado" na agenda.',
      },
      { status: 400 }
    );
  }

  const [apptProfRes, actorProfRes, existingFinalRes, patientRes] =
    await Promise.all([
      supabase
        .from('professionals')
        .select('id, user_id, name')
        .eq('id', apptRow.professional_id)
        .eq('organization_id', context.organization.id)
        .maybeSingle(),
      supabase
        .from('professionals')
        .select('id, name, council_number')
        .eq('organization_id', context.organization.id)
        .eq('user_id', session.user.id)
        .maybeSingle(),
      supabase
        .from('clinical_evolutions')
        .select('id, author_name')
        .eq('appointment_id', appointmentId)
        .eq('status', 'finalized')
        .maybeSingle(),
      supabase
        .from('patients')
        .select('id, name, cpf')
        .eq('id', apptRow.patient_id)
        .eq('organization_id', context.organization.id)
        .maybeSingle(),
    ]);

  if (existingFinalRes.error && isMissingAgendaTableError(existingFinalRes.error)) {
    return NextResponse.json(
      {
        error:
          'Execute a Seção 9 do arquivo sql.md no Supabase para habilitar evoluções clínicas.',
        code: 'MIGRATION_REQUIRED',
      },
      { status: 409 }
    );
  }

  if (existingFinalRes.data) {
    return NextResponse.json(
      {
        error: `Este atendimento já possui evolução concluída por ${existingFinalRes.data.author_name}. Utilize Nota de Retificação caso necessário.`,
      },
      { status: 409 }
    );
  }

  // Enforce US04.1: Proibição de delegação indevida quando o atendimento pertence a profissional com usuário vinculado
  if (
    apptProfRes.data?.user_id &&
    apptProfRes.data.user_id !== session.user.id
  ) {
    return NextResponse.json(
      {
        error: `Atendimento atribuído a ${apptProfRes.data.name}. Somente o profissional responsável pode registrar e assinar esta evolução.`,
      },
      { status: 403 }
    );
  }

  const sharedClinicalNote =
    cleanOptionalText(body.sharedClinicalNote, 8000) ?? '';
  const proceduresPerformed = cleanOptionalText(body.proceduresPerformed, 4000);
  const patientResponse = cleanOptionalText(body.patientResponse, 3000);
  const evaBefore = sanitizeEvaScore(body.evaBefore);
  const evaAfter = sanitizeEvaScore(body.evaAfter);
  const adherenceLevel = sanitizeAdherence(body.adherenceLevel);
  const nextSessionPlan = cleanOptionalText(body.nextSessionPlan, 3000);
  const restrictedClinicalRecord = cleanOptionalText(
    body.restrictedClinicalRecord,
    6000
  );
  const restrictedCategory = restrictedClinicalRecord
    ? cleanOptionalText(body.restrictedCategory, 80) ||
      'Autor (Sigilo Exclusivo)'
    : null;

  const authorName =
    (actorProfRes.data?.name as string | null) ||
    session.user.name ||
    session.user.email ||
    'Profissional';
  const authorCouncilNumber =
    cleanOptionalText(body.authorCouncilNumber, 60) ||
    cleanOptionalText(actorProfRes.data?.council_number, 60);

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
            'Informe seu registro no conselho profissional (ex.: CREFITO) para assinar e concluir.',
        },
        { status: 400 }
      );
    }
  }

  const sourceIp = extractSourceIp(req);
  const finalizedAtUtc = finalize ? new Date().toISOString() : null;

  const { data: inserted, error: insertErr } = await supabase
    .from('clinical_evolutions')
    .insert({
      organization_id: context.organization.id,
      patient_id: apptRow.patient_id,
      appointment_id: appointmentId,
      professional_id:
        (actorProfRes.data?.id as string | null) ?? apptRow.professional_id,
      unit_id: apptRow.unit_id,
      status: finalize ? 'finalized' : 'draft',
      shared_clinical_note: sharedClinicalNote,
      procedures_performed: proceduresPerformed,
      patient_response: patientResponse,
      eva_before: evaBefore,
      eva_after: evaAfter,
      adherence_level: adherenceLevel,
      next_session_plan: nextSessionPlan,
      restricted_clinical_record: restrictedClinicalRecord,
      restricted_category: restrictedCategory,
      author_user_id: session.user.id,
      author_name: authorName,
      author_council_number: authorCouncilNumber,
      source_ip: sourceIp,
      finalized_at_utc: finalizedAtUtc,
    })
    .select('*')
    .single();

  if (insertErr || !inserted) {
    if (isMissingAgendaTableError(insertErr)) {
      return NextResponse.json(
        {
          error:
            'Execute a Seção 9 do arquivo sql.md no Supabase para salvar evoluções.',
          code: 'MIGRATION_REQUIRED',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error:
          insertErr?.code === '23505'
            ? 'Já existe um rascunho ou evolução sua para este atendimento.'
            : 'Não foi possível salvar a evolução clínica.',
      },
      { status: insertErr?.code === '23505' ? 409 : 502 }
    );
  }

  const evolution = inserted as ClinicalEvolutionRecord;

  await recordClinicalEvolutionAuditEvent(supabase, {
    organizationId: context.organization.id,
    evolutionId: evolution.id,
    patientId: evolution.patient_id,
    appointmentId,
    userId: session.user.id,
    userName: authorName,
    userEmail: session.user.email,
    action: finalize ? 'FINALIZE_EVOLUTION' : 'CREATE_DRAFT',
    sourceIp,
    details: {
      has_restricted_record: Boolean(restrictedClinicalRecord),
      council_number: authorCouncilNumber,
    },
  });

  if (finalize && finalizedAtUtc) {
    await syncFinalizedEvolutionToMedicalRecord(supabase, {
      organizationId: context.organization.id,
      patientId: evolution.patient_id,
      sessionStartsAt: apptRow.starts_at,
      sharedClinicalNote,
      proceduresPerformed,
      evaBefore,
      evaAfter,
      authorUserId: session.user.id,
      authorName,
      authorEmail: session.user.email,
      authorCouncilNumber: authorCouncilNumber ?? '',
      finalizedAtUtc,
    });
  }

  const response = NextResponse.json(
    {
      evolution: {
        ...evolution,
        patient_name: patientRes.data?.name ?? 'Paciente',
        patient_cpf: patientRes.data?.cpf ?? null,
        appointment_starts_at: apptRow.starts_at,
        appointment_ends_at: apptRow.ends_at,
        viewerIsAuthor: true,
        restrictedRecordHidden: false,
        rectifications: [],
      },
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
