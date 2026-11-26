import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { isValidAppointmentStatus } from '@/lib/agenda/constants';
import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import { validateAppointmentWindow } from '@/lib/agenda/validation';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  AgendaAppointment,
  AgendaAvailabilityRule,
  AgendaBlock,
} from '@/types/agenda';

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

  const scheduleId =
    typeof body.scheduleId === 'string' ? body.scheduleId.trim() : '';
  const patientId =
    typeof body.patientId === 'string' ? body.patientId.trim() : '';
  const serviceId =
    typeof body.serviceId === 'string' && body.serviceId.trim()
      ? body.serviceId.trim()
      : null;
  const specialtyId =
    typeof body.specialtyId === 'string' && body.specialtyId.trim()
      ? body.specialtyId.trim()
      : null;
  const startsAt =
    typeof body.startsAt === 'string' ? body.startsAt.trim() : '';
  const endsAt = typeof body.endsAt === 'string' ? body.endsAt.trim() : '';
  const status = isValidAppointmentStatus(body.status)
    ? body.status
    : 'confirmed';
  const isFitIn = Boolean(body.isFitIn);
  const notesAdmin =
    typeof body.notesAdmin === 'string' && body.notesAdmin.trim()
      ? body.notesAdmin.trim().slice(0, 500)
      : null;
  const recurrenceWeeksRaw =
    typeof body.recurrenceWeeks === 'number' ? body.recurrenceWeeks : 1;
  const recurrenceWeeks = Math.min(
    12,
    Math.max(1, Math.round(recurrenceWeeksRaw))
  );

  if (!scheduleId || !patientId || !startsAt || !endsAt) {
    return NextResponse.json(
      {
        error:
          'Informe agenda/profissional, paciente, horário de início e término.',
      },
      { status: 400 }
    );
  }

  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return NextResponse.json(
      { error: 'Intervalo de horário inválido.' },
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

  const schedule = context.visibleSchedules.find((s) => s.id === scheduleId);
  const perms = context.permissionsBySchedule[scheduleId];

  if (!schedule || !perms || !perms.can_manage_appointments) {
    return NextResponse.json(
      {
        error:
          'Você não possui permissão para criar agendamentos nesta agenda.',
      },
      { status: 403 }
    );
  }

  // Verify patient belongs to same organization
  const { data: patientRow } = await supabase
    .from('patients')
    .select('id, name')
    .eq('organization_id', context.organization.id)
    .eq('id', patientId)
    .maybeSingle();

  if (!patientRow) {
    return NextResponse.json(
      { error: 'Paciente não encontrado nesta organização.' },
      { status: 404 }
    );
  }

  // Load rules, blocks, and existing appointments for validation
  const [rulesRes, blocksRes, apptsRes] = await Promise.all([
    supabase
      .from('availability_rules')
      .select(
        'id, organization_id, schedule_id, day_of_week, start_time, end_time, break_start, break_end, is_active'
      )
      .eq('organization_id', context.organization.id)
      .eq('schedule_id', schedule.id),
    supabase
      .from('schedule_blocks')
      .select(
        'id, organization_id, unit_id, schedule_id, title, reason, starts_at, ends_at, is_recurring'
      )
      .eq('organization_id', context.organization.id),
    supabase
      .from('appointments')
      .select(
        'id, organization_id, unit_id, schedule_id, professional_id, patient_id, service_id, specialty_id, starts_at, ends_at, status, is_fit_in, recurrence_group_id, notes_admin, created_at, updated_at'
      )
      .eq('organization_id', context.organization.id)
      .eq('schedule_id', schedule.id)
      .not('status', 'in', '("canceled","no_show")'),
  ]);

  const availabilityRules = (rulesRes.data ?? []) as AgendaAvailabilityRule[];
  const blocks = (blocksRes.data ?? []) as AgendaBlock[];
  const existingAppointments = (apptsRes.data ?? []) as AgendaAppointment[];

  const durationMs = endMs - startMs;
  const recurrenceGroupId = recurrenceWeeks > 1 ? randomUUID() : null;
  const rowsToInsert: Record<string, unknown>[] = [];

  for (let i = 0; i < recurrenceWeeks; i++) {
    const occStartMs = startMs + i * 7 * 24 * 60 * 60 * 1000;
    const occEndMs = occStartMs + durationMs;
    const occStartIso = new Date(occStartMs).toISOString();
    const occEndIso = new Date(occEndMs).toISOString();

    const check = validateAppointmentWindow({
      startsAtIso: occStartIso,
      endsAtIso: occEndIso,
      schedule,
      availabilityRules,
      blocks,
      existingAppointments,
      isFitIn,
      timeZone: context.organization.timezone,
    });

    if (!check.valid) {
      const label =
        recurrenceWeeks > 1 ? ` (ocorrência ${i + 1} da recorrência)` : '';
      return NextResponse.json(
        { error: `${check.error}${label}`, code: check.code ?? 'VALIDATION' },
        { status: 409 }
      );
    }

    rowsToInsert.push({
      organization_id: context.organization.id,
      unit_id: schedule.unit_id,
      schedule_id: schedule.id,
      professional_id: schedule.professional_id,
      patient_id: patientId,
      service_id: serviceId,
      specialty_id: specialtyId,
      starts_at: occStartIso,
      ends_at: occEndIso,
      status,
      is_fit_in: isFitIn,
      recurrence_group_id: recurrenceGroupId,
      notes_admin: notesAdmin,
      created_by: session.user.id,
      updated_by: session.user.id,
    });
  }

  const { data: createdAppointments, error: insertError } = await supabase
    .from('appointments')
    .insert(rowsToInsert)
    .select(
      'id, organization_id, unit_id, schedule_id, professional_id, patient_id, service_id, specialty_id, starts_at, ends_at, status, is_fit_in, recurrence_group_id, notes_admin, created_at, updated_at'
    );

  if (insertError || !createdAppointments || createdAppointments.length === 0) {
    return NextResponse.json(
      { error: 'Não foi possível salvar o agendamento.' },
      { status: 502 }
    );
  }

  await supabase.from('appointment_audit_logs').insert(
    createdAppointments.map((appt) => ({
      organization_id: context.organization.id,
      appointment_id: appt.id,
      schedule_id: appt.schedule_id,
      actor_user_id: session.user.id,
      actor_email: session.user.email,
      action:
        recurrenceWeeks > 1
          ? 'create_recurring_appointment'
          : 'create_appointment',
      new_values: {
        patient_name: patientRow.name,
        starts_at: appt.starts_at,
        ends_at: appt.ends_at,
        status: appt.status,
        is_fit_in: appt.is_fit_in,
      },
    }))
  );

  const response = NextResponse.json(
    {
      appointment: createdAppointments[0],
      appointments: createdAppointments,
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

export async function PATCH(req: NextRequest) {
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

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    return NextResponse.json(
      { error: 'Identificador do agendamento ausente.' },
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

  const { data: existingRow } = await supabase
    .from('appointments')
    .select(
      'id, organization_id, unit_id, schedule_id, professional_id, patient_id, service_id, specialty_id, starts_at, ends_at, status, is_fit_in, recurrence_group_id, notes_admin, created_at, updated_at'
    )
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .maybeSingle();

  const existing = existingRow as AgendaAppointment | null;
  if (!existing) {
    return NextResponse.json(
      { error: 'Agendamento não encontrado.' },
      { status: 404 }
    );
  }

  const currentPerms = context.permissionsBySchedule[existing.schedule_id];
  if (!currentPerms || !currentPerms.can_manage_appointments) {
    return NextResponse.json(
      {
        error:
          'Você não possui permissão para alterar agendamentos desta agenda.',
      },
      { status: 403 }
    );
  }

  const targetScheduleId =
    typeof body.scheduleId === 'string' && body.scheduleId.trim()
      ? body.scheduleId.trim()
      : existing.schedule_id;

  const targetSchedule = context.visibleSchedules.find(
    (s) => s.id === targetScheduleId
  );
  const targetPerms = context.permissionsBySchedule[targetScheduleId];

  if (!targetSchedule || !targetPerms || !targetPerms.can_manage_appointments) {
    return NextResponse.json(
      {
        error:
          'Você não possui permissão para mover este agendamento para a agenda de destino.',
      },
      { status: 403 }
    );
  }

  const nextPatientId =
    typeof body.patientId === 'string' && body.patientId.trim()
      ? body.patientId.trim()
      : existing.patient_id;
  const nextServiceId =
    body.serviceId === null
      ? null
      : typeof body.serviceId === 'string'
        ? body.serviceId.trim() || null
        : existing.service_id;
  const nextSpecialtyId =
    body.specialtyId === null
      ? null
      : typeof body.specialtyId === 'string'
        ? body.specialtyId.trim() || null
        : existing.specialty_id;
  const nextStartsAt =
    typeof body.startsAt === 'string' && body.startsAt.trim()
      ? body.startsAt.trim()
      : existing.starts_at;
  const nextEndsAt =
    typeof body.endsAt === 'string' && body.endsAt.trim()
      ? body.endsAt.trim()
      : existing.ends_at;
  const nextStatus =
    body.status !== undefined
      ? isValidAppointmentStatus(body.status)
        ? body.status
        : null
      : existing.status;

  if (!nextStatus) {
    return NextResponse.json(
      { error: 'Situação do agendamento inválida.' },
      { status: 400 }
    );
  }

  const nextIsFitIn =
    typeof body.isFitIn === 'boolean' ? body.isFitIn : existing.is_fit_in;
  const nextNotesAdmin =
    body.notesAdmin === null
      ? null
      : typeof body.notesAdmin === 'string'
        ? body.notesAdmin.trim().slice(0, 500) || null
        : existing.notes_admin;

  const timeOrScheduleChanged =
    targetScheduleId !== existing.schedule_id ||
    Date.parse(nextStartsAt) !== Date.parse(existing.starts_at) ||
    Date.parse(nextEndsAt) !== Date.parse(existing.ends_at) ||
    nextIsFitIn !== existing.is_fit_in;

  if (
    timeOrScheduleChanged &&
    nextStatus !== 'canceled' &&
    nextStatus !== 'no_show'
  ) {
    const [rulesRes, blocksRes, apptsRes] = await Promise.all([
      supabase
        .from('availability_rules')
        .select(
          'id, organization_id, schedule_id, day_of_week, start_time, end_time, break_start, break_end, is_active'
        )
        .eq('organization_id', context.organization.id)
        .eq('schedule_id', targetSchedule.id),
      supabase
        .from('schedule_blocks')
        .select(
          'id, organization_id, unit_id, schedule_id, title, reason, starts_at, ends_at, is_recurring'
        )
        .eq('organization_id', context.organization.id),
      supabase
        .from('appointments')
        .select(
          'id, organization_id, unit_id, schedule_id, professional_id, patient_id, service_id, specialty_id, starts_at, ends_at, status, is_fit_in, recurrence_group_id, notes_admin, created_at, updated_at'
        )
        .eq('organization_id', context.organization.id)
        .eq('schedule_id', targetSchedule.id)
        .not('status', 'in', '("canceled","no_show")'),
    ]);

    const check = validateAppointmentWindow({
      startsAtIso: nextStartsAt,
      endsAtIso: nextEndsAt,
      schedule: targetSchedule,
      availabilityRules: (rulesRes.data ?? []) as AgendaAvailabilityRule[],
      blocks: (blocksRes.data ?? []) as AgendaBlock[],
      existingAppointments: (apptsRes.data ?? []) as AgendaAppointment[],
      excludeAppointmentId: existing.id,
      isFitIn: nextIsFitIn,
      timeZone: context.organization.timezone,
    });

    if (!check.valid) {
      return NextResponse.json(
        { error: check.error, code: check.code ?? 'VALIDATION' },
        { status: 409 }
      );
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('appointments')
    .update({
      unit_id: targetSchedule.unit_id,
      schedule_id: targetSchedule.id,
      professional_id: targetSchedule.professional_id,
      patient_id: nextPatientId,
      service_id: nextServiceId,
      specialty_id: nextSpecialtyId,
      starts_at: nextStartsAt,
      ends_at: nextEndsAt,
      status: nextStatus,
      is_fit_in: nextIsFitIn,
      notes_admin: nextNotesAdmin,
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', context.organization.id)
    .eq('id', existing.id)
    .select(
      'id, organization_id, unit_id, schedule_id, professional_id, patient_id, service_id, specialty_id, starts_at, ends_at, status, is_fit_in, recurrence_group_id, notes_admin, created_at, updated_at'
    )
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: 'Não foi possível atualizar o agendamento.' },
      { status: 502 }
    );
  }

  let action = 'update_appointment';
  if (nextStatus === 'canceled' && existing.status !== 'canceled') {
    action = 'cancel_appointment';
  } else if (
    targetSchedule.id !== existing.schedule_id ||
    Date.parse(nextStartsAt) !== Date.parse(existing.starts_at) ||
    Date.parse(nextEndsAt) !== Date.parse(existing.ends_at)
  ) {
    action = 'reschedule_appointment';
  } else if (nextStatus !== existing.status) {
    action = 'change_status';
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    appointment_id: updated.id,
    schedule_id: updated.schedule_id,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action,
    previous_values: {
      schedule_id: existing.schedule_id,
      professional_id: existing.professional_id,
      starts_at: existing.starts_at,
      ends_at: existing.ends_at,
      status: existing.status,
      is_fit_in: existing.is_fit_in,
    },
    new_values: {
      schedule_id: updated.schedule_id,
      professional_id: updated.professional_id,
      starts_at: updated.starts_at,
      ends_at: updated.ends_at,
      status: updated.status,
      is_fit_in: updated.is_fit_in,
    },
  });

  const response = NextResponse.json({ appointment: updated });
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
