import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import {
  isMissingAgendaTableError,
  resolveAgendaAccessContext,
} from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
} from '@/lib/auth/session';
import {
  extractSourceIp,
  minimizeEvaluationForViewer,
} from '@/lib/evaluations/server';
import {
  minimizeClinicalEvolutionForViewer,
  recordClinicalEvolutionAuditEvent,
} from '@/lib/evolutions/server';
import {
  PATIENT_SELECT_FIELDS,
  normalizeLegacyPatientRow,
} from '@/lib/patients/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  EvaluationRecord,
  EvaluationTemplateVersionRecord,
} from '@/types/evaluations';
import type {
  ClinicalEvolutionRecord,
  EvolutionRectificationRecord,
  OfficialClinicalDossierPayload,
  OfficialDossierAppointmentItem,
} from '@/types/evolutions';
import type { MedicalRecordEntry } from '@/types/patients';

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

  const { id: patientId } = await contextParams.params;
  if (!UUID_REGEX.test(patientId)) {
    return NextResponse.json(
      { error: 'Identificador de paciente inválido.' },
      { status: 400 }
    );
  }

  const format =
    req.nextUrl.searchParams.get('format')?.trim() || 'preview_pdf';

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

  let patientRow: Record<string, unknown> | null = null;
  const fullPatientRes = await supabase
    .from('patients')
    .select(PATIENT_SELECT_FIELDS)
    .eq('organization_id', context.organization.id)
    .eq('id', patientId)
    .maybeSingle();

  if (fullPatientRes.error && isMissingAgendaTableError(fullPatientRes.error)) {
    const basicRes = await supabase
      .from('patients')
      .select('id, organization_id, name, phone, email, created_at')
      .eq('organization_id', context.organization.id)
      .eq('id', patientId)
      .maybeSingle();
    patientRow = basicRes.data as Record<string, unknown> | null;
  } else {
    patientRow = fullPatientRes.data as unknown as Record<string, unknown> | null;
  }

  if (!patientRow) {
    return NextResponse.json(
      { error: 'Paciente não encontrado nesta organização.' },
      { status: 404 }
    );
  }

  const patient = normalizeLegacyPatientRow(patientRow);

  const [
    profsRes,
    unitsRes,
    servicesRes,
    specialtiesRes,
    apptsRes,
    evalsRes,
    evalVersionsRes,
    evolsRes,
    rectsRes,
    medRecordsRes,
  ] = await Promise.all([
    supabase
      .from('professionals')
      .select('id, user_id, name, council_number')
      .eq('organization_id', context.organization.id),
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
    supabase
      .from('appointments')
      .select(
        'id, starts_at, ends_at, status, professional_id, unit_id, service_id, specialty_id, notes_admin'
      )
      .eq('organization_id', context.organization.id)
      .eq('patient_id', patientId)
      .order('starts_at', { ascending: false }),
    supabase
      .from('evaluations')
      .select('*')
      .eq('organization_id', context.organization.id)
      .eq('patient_id', patientId)
      .eq('status', 'finalized')
      .order('finalized_at_utc', { ascending: false }),
    supabase
      .from('evaluation_template_versions')
      .select('*')
      .eq('organization_id', context.organization.id),
    supabase
      .from('clinical_evolutions')
      .select('*')
      .eq('organization_id', context.organization.id)
      .eq('patient_id', patientId)
      .eq('status', 'finalized')
      .order('finalized_at_utc', { ascending: false }),
    supabase
      .from('evolution_rectifications')
      .select('*')
      .eq('organization_id', context.organization.id)
      .eq('patient_id', patientId)
      .order('created_at_utc', { ascending: true }),
    supabase
      .from('medical_records')
      .select('*')
      .eq('organization_id', context.organization.id)
      .eq('patient_id', patientId)
      .eq('is_finalized', true)
      .order('occurred_at', { ascending: false }),
  ]);

  const profList = profsRes.data ?? [];
  const profMap = new Map(profList.map((p) => [String(p.id), p]));
  const unitMap = new Map(
    (unitsRes.data ?? []).map((u) => [String(u.id), String(u.name)])
  );
  const serviceMap = new Map(
    (servicesRes.data ?? []).map((s) => [String(s.id), String(s.name)])
  );
  const specialtyMap = new Map(
    (specialtiesRes.data ?? []).map((s) => [String(s.id), String(s.name)])
  );

  const actorProf = profList.find((p) => p.user_id === session.user.id);
  let viewerSpecialties: string[] = [];
  if (actorProf?.id) {
    const { data: profSpecRows } = await supabase
      .from('professional_specialties')
      .select('specialty_id')
      .eq('professional_id', actorProf.id);
    viewerSpecialties = (profSpecRows ?? [])
      .map((r) => specialtyMap.get(String(r.specialty_id)) ?? '')
      .filter(Boolean);
  }

  const rawEvolutions = !evolsRes.error
    ? ((evolsRes.data ?? []) as ClinicalEvolutionRecord[])
    : [];
  const finalizedEvolutionAppts = new Set(
    rawEvolutions.map((e) => e.appointment_id)
  );

  const appointments: OfficialDossierAppointmentItem[] = (
    apptsRes.data ?? []
  ).map((a) => {
    const prof = profMap.get(String(a.professional_id));
    return {
      id: String(a.id),
      starts_at: String(a.starts_at),
      ends_at: String(a.ends_at),
      status: String(a.status),
      professional_name: (prof?.name as string | undefined) ?? 'Profissional',
      professional_council: (prof?.council_number as string | null) ?? null,
      unit_name: a.unit_id ? (unitMap.get(String(a.unit_id)) ?? null) : null,
      service_name: a.service_id
        ? (serviceMap.get(String(a.service_id)) ?? null)
        : null,
      specialty_name: a.specialty_id
        ? (specialtyMap.get(String(a.specialty_id)) ?? null)
        : null,
      notes_admin: (a.notes_admin as string | null) ?? null,
      has_finalized_evolution: finalizedEvolutionAppts.has(String(a.id)),
    };
  });

  const versionMap = new Map<string, EvaluationTemplateVersionRecord>();
  if (!evalVersionsRes.error) {
    for (const ver of (evalVersionsRes.data ??
      []) as EvaluationTemplateVersionRecord[]) {
      versionMap.set(ver.id, ver);
    }
  }

  const evaluations = !evalsRes.error
    ? ((evalsRes.data ?? []) as EvaluationRecord[]).map((ev) => {
        const ver = versionMap.get(ev.template_version_id) ?? null;
        return {
          evaluation: minimizeEvaluationForViewer(
            ev,
            ver?.schema_json ?? null,
            session.user.id
          ),
          templateVersion: ver,
        };
      })
    : [];

  const rectsByEvol = new Map<string, EvolutionRectificationRecord[]>();
  if (!rectsRes.error) {
    for (const r of (rectsRes.data ?? []) as EvolutionRectificationRecord[]) {
      const list = rectsByEvol.get(r.evolution_id) ?? [];
      list.push(r);
      rectsByEvol.set(r.evolution_id, list);
    }
  }

  const apptById = new Map(appointments.map((a) => [a.id, a]));
  const evolutions: ClinicalEvolutionRecord[] = rawEvolutions.map((ev) => {
    const minimized = minimizeClinicalEvolutionForViewer(
      ev,
      session.user.id,
      viewerSpecialties
    );
    const appt = apptById.get(ev.appointment_id);
    return {
      ...minimized,
      patient_name: patient.name,
      patient_cpf: patient.cpf,
      appointment_starts_at: appt?.starts_at ?? null,
      appointment_ends_at: appt?.ends_at ?? null,
      service_name: appt?.service_name ?? null,
      unit_name: appt?.unit_name ?? null,
      rectifications: rectsByEvol.get(ev.id) ?? [],
    };
  });

  const medicalRecords = !medRecordsRes.error
    ? ((medRecordsRes.data ?? []) as MedicalRecordEntry[])
    : [];

  const issuedAtUtc = new Date().toISOString();
  const sourceIp = extractSourceIp(req);
  const issuerName =
    (actorProf?.name as string | null) ||
    session.user.name ||
    session.user.email ||
    'Profissional';
  const issuerCouncil = (actorProf?.council_number as string | null) ?? null;

  const verificationCode = createHash('sha256')
    .update(
      `${context.organization.id}:${patient.id}:${issuedAtUtc}:${session.user.id}`
    )
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();

  // Log mandatory LGPD audit event for Official Dossier export
  await recordClinicalEvolutionAuditEvent(supabase, {
    organizationId: context.organization.id,
    patientId: patient.id,
    userId: session.user.id,
    userName: issuerName,
    userEmail: session.user.email,
    action: 'EXPORT_OFFICIAL_RECORD',
    sourceIp,
    details: {
      format,
      verification_code: verificationCode,
      appointments_count: appointments.length,
      evaluations_count: evaluations.length,
      evolutions_count: evolutions.length,
    },
  });

  try {
    await supabase.from('patient_audit_logs').insert({
      organization_id: context.organization.id,
      patient_id: patient.id,
      actor_user_id: session.user.id,
      actor_name: issuerName,
      actor_email: session.user.email,
      action: 'exported_official_dossier',
      changed_fields: ['official_export'],
      previous_values: null,
      new_values: {
        format,
        verification_code: verificationCode,
        source_ip: sourceIp,
        issued_at_utc: issuedAtUtc,
      },
      reason: `Emissão oficial de prontuário normatizado (${format})`,
    });
  } catch {
    // Non-blocking if patient_audit_logs isn't present
  }

  const dossier: OfficialClinicalDossierPayload = {
    issuedAtUtc,
    verificationCode,
    normativeBasis: [
      'Resolução COFFITO nº 414/2012 — Obrigatoriedade e requisitos do Prontuário Fisioterapêutico',
      'Resolução COFFITO nº 555/2022 — Classificação Brasileira de Diagnósticos Fisioterapêuticos (CBDF)',
      'Lei nº 13.709/2018 (LGPD) — Minimização de exposição, compartimentalização de sigilo e portabilidade',
    ],
    issuedBy: {
      userId: session.user.id,
      name: issuerName,
      email: session.user.email,
      councilNumber: issuerCouncil,
      sourceIp,
    },
    organization: context.organization,
    patient,
    appointments,
    evaluations,
    evolutions,
    medicalRecords,
    lgpdNotice:
      'Documento emitido com compartimentalização de sigilo (LGPD Art. 11). Registros estritamente confidenciais permanecem acessíveis apenas ao autor responsável ou categoria profissional habilitada.',
  };

  const response = NextResponse.json({ dossier });
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
