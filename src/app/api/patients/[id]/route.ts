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
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  MedicalRecordAddendum,
  MedicalRecordEntry,
  PatientAppointmentSummary,
  PatientAuditLog,
} from '@/types/patients';

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

  const supabase = createSupabaseServerClient(session.accessToken);
  const { context, migrationPending: contextMigrationPending } =
    await resolveAgendaAccessContext(
      supabase,
      session.user.id,
      session.user.email,
      session.activeOrganizationId
    );

  if (contextMigrationPending || !context) {
    return NextResponse.json(
      { error: 'Organização clínica não encontrada.' },
      { status: 404 }
    );
  }

  let migrationPending = false;
  let patientRow: Record<string, unknown> | null = null;

  const fullPatientRes = await supabase
    .from('patients')
    .select(PATIENT_SELECT_FIELDS)
    .eq('organization_id', context.organization.id)
    .eq('id', patientId)
    .maybeSingle();

  if (fullPatientRes.error) {
    if (isMissingAgendaTableError(fullPatientRes.error)) {
      migrationPending = true;
      const basicRes = await supabase
        .from('patients')
        .select('id, organization_id, name, phone, email, created_at')
        .eq('organization_id', context.organization.id)
        .eq('id', patientId)
        .maybeSingle();
      patientRow = basicRes.data as Record<string, unknown> | null;
    } else {
      return NextResponse.json(
        { error: 'Não foi possível carregar o cadastro do paciente.' },
        { status: 502 }
      );
    }
  } else {
    patientRow = fullPatientRes.data as unknown as Record<string, unknown> | null;
  }

  if (!patientRow) {
    return NextResponse.json(
      { error: 'Paciente não encontrado nesta clínica.' },
      { status: 404 }
    );
  }

  const patient = normalizeLegacyPatientRow(patientRow);
  const isOwner = context.organization.owner_user_id === session.user.id;
  const canAuthorClinical = await canUserAuthorClinicalRecord(
    supabase,
    context.organization.id,
    session.user.id,
    context.role,
    isOwner
  );

  const [recordsRes, addendaRes, auditRes, appointmentsRes, professionalsRes] =
    await Promise.all([
      supabase
        .from('medical_records')
        .select('*')
        .eq('organization_id', context.organization.id)
        .eq('patient_id', patientId)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('medical_record_addenda')
        .select('*')
        .eq('organization_id', context.organization.id)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: true }),
      supabase
        .from('patient_audit_logs')
        .select('*')
        .eq('organization_id', context.organization.id)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false }),
      supabase
        .from('appointments')
        .select('id, starts_at, ends_at, status, professional_id, specialty_id, notes_admin')
        .eq('organization_id', context.organization.id)
        .eq('patient_id', patientId)
        .order('starts_at', { ascending: false })
        .limit(50),
      supabase
        .from('professionals')
        .select('id, name')
        .eq('organization_id', context.organization.id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
    ]);

  if (
    isMissingAgendaTableError(recordsRes.error) ||
    isMissingAgendaTableError(addendaRes.error) ||
    isMissingAgendaTableError(auditRes.error)
  ) {
    migrationPending = true;
  }

  const profNameById = new Map<string, string>();
  for (const p of (professionalsRes.data ?? []) as { id: string; name: string }[]) {
    profNameById.set(p.id, p.name);
  }

  const { data: specsData } = await supabase
    .from('specialties')
    .select('id, name')
    .eq('organization_id', context.organization.id);
  const specNameById = new Map<string, string>();
  for (const s of (specsData ?? []) as { id: string; name: string }[]) {
    specNameById.set(s.id, s.name);
  }

  const addendaByRecordId = new Map<string, MedicalRecordAddendum[]>();
  if (!addendaRes.error && addendaRes.data) {
    for (const item of addendaRes.data as MedicalRecordAddendum[]) {
      const list = addendaByRecordId.get(item.record_id) ?? [];
      list.push(item);
      addendaByRecordId.set(item.record_id, list);
    }
  }

  const records: MedicalRecordEntry[] =
    !recordsRes.error && recordsRes.data
      ? (recordsRes.data as Omit<MedicalRecordEntry, 'addenda'>[]).map((r) => ({
          ...r,
          addenda: addendaByRecordId.get(r.id) ?? [],
        }))
      : [];

  const auditLogs: PatientAuditLog[] =
    !auditRes.error && auditRes.data
      ? (auditRes.data as PatientAuditLog[])
      : [];

  const appointments: PatientAppointmentSummary[] = (
    (appointmentsRes.data ?? []) as {
      id: string;
      starts_at: string;
      ends_at: string;
      status: string;
      professional_id: string;
      specialty_id: string | null;
      notes_admin: string | null;
    }[]
  ).map((a) => ({
    id: a.id,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    status: a.status,
    professional_name: profNameById.get(a.professional_id) ?? 'Profissional',
    specialty_name: a.specialty_id ? specNameById.get(a.specialty_id) ?? null : null,
    notes_admin: a.notes_admin,
  }));

  const response = NextResponse.json({
    organization: context.organization,
    role: context.role,
    isAdmin: context.isAdmin,
    canAuthorClinical,
    currentUserId: session.user.id,
    patient,
    records,
    auditLogs,
    appointments,
    professionals: (professionalsRes.data ?? []) as { id: string; name: string }[],
    migrationPending,
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

  const { data: existingRow, error: fetchError } = await supabase
    .from('patients')
    .select(PATIENT_SELECT_FIELDS)
    .eq('organization_id', context.organization.id)
    .eq('id', patientId)
    .maybeSingle();

  if (fetchError) {
    if (isMissingAgendaTableError(fetchError)) {
      return NextResponse.json(
        {
          error:
            'Execute a Seção 7 do arquivo sql.md no Supabase antes de editar dados cadastrais completos.',
          code: 'MIGRATION_REQUIRED',
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível localizar o paciente.' },
      { status: 502 }
    );
  }

  if (!existingRow) {
    return NextResponse.json(
      { error: 'Paciente não encontrado nesta clínica.' },
      { status: 404 }
    );
  }

  const existing = normalizeLegacyPatientRow(
    existingRow as unknown as Record<string, unknown>
  );

  const validation = validatePatientPayload(body, existing.status);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const data = validation.data;

  if (data.cpf_digits) {
    const duplicate = await findDuplicatePatientByCpf(
      supabase,
      context.organization.id,
      data.cpf_digits,
      patientId
    );
    if (duplicate) {
      return NextResponse.json(
        {
          error: `Já existe outro paciente cadastrado com este CPF nesta clínica (${duplicate.name}).`,
          code: 'DUPLICATE_CPF',
          existingPatient: duplicate,
        },
        { status: 409 }
      );
    }
  }

  const { data: updatedRow, error: updateError } = await supabase
    .from('patients')
    .update({
      ...data,
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', context.organization.id)
    .eq('id', patientId)
    .select(PATIENT_SELECT_FIELDS)
    .single();

  if (updateError) {
    if (updateError.code === '23505') {
      const existingDup = data.cpf_digits
        ? await findDuplicatePatientByCpf(
            supabase,
            context.organization.id,
            data.cpf_digits,
            patientId
          )
        : null;
      return NextResponse.json(
        {
          error: existingDup
            ? `Já existe outro paciente cadastrado com este CPF nesta clínica (${existingDup.name}).`
            : 'Já existe outro paciente cadastrado com este CPF nesta clínica.',
          code: 'DUPLICATE_CPF',
          existingPatient: existingDup,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível atualizar os dados do paciente.' },
      { status: 502 }
    );
  }

  const updated = normalizeLegacyPatientRow(
    updatedRow as unknown as Record<string, unknown>
  );
  const changedFields = computePatientAuditDiff(existing, updated);

  if (changedFields.length > 0) {
    const statusChanged = existing.status !== updated.status;
    const onlyStatusChanged =
      statusChanged && changedFields.length === 1 && changedFields[0].field === 'status';
    const actorName = session.user.name || session.user.email || 'Equipe';

    const summaryLines = changedFields
      .map(
        (c) =>
          `${c.label}: ${c.before ?? 'Não informado'} → ${c.after ?? 'Não informado'}`
      )
      .join('\n');

    await Promise.all([
      supabase.from('patient_audit_logs').insert({
        organization_id: context.organization.id,
        patient_id: patientId,
        actor_user_id: session.user.id,
        actor_name: actorName,
        actor_email: session.user.email,
        action: statusChanged && onlyStatusChanged ? 'status_changed' : 'updated',
        changed_fields: changedFields,
        previous_values: existing,
        new_values: updated,
        reason: validation.reason,
      }),
      supabase.from('medical_records').insert({
        organization_id: context.organization.id,
        patient_id: patientId,
        category: 'administrative',
        record_type: onlyStatusChanged ? 'alteracao_status' : 'alteracao_cadastral',
        title: onlyStatusChanged
          ? `Situação alterada para ${PATIENT_STATUS_META[updated.status].label}`
          : 'Atualização de dados cadastrais',
        content: `${summaryLines}${
          validation.reason ? `\n\nMotivo: ${validation.reason}` : ''
        }`,
        is_finalized: true,
        finalized_at: new Date().toISOString(),
        finalized_by: session.user.id,
        author_user_id: session.user.id,
        author_name: actorName,
        author_email: session.user.email,
      }),
    ]);
  }

  const response = NextResponse.json({
    patient: updated,
    changedFieldsCount: changedFields.length,
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
