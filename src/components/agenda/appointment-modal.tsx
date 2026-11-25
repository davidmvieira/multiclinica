'use client';

import {
  Calendar,
  CheckCircle2,
  Clock,
  History,
  Plus,
  Repeat,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  APPOINTMENT_STATUS_LIST,
  APPOINTMENT_STATUS_META,
  buildZonedIso,
  getZonedParts,
} from '@/lib/agenda/constants';
import type {
  AgendaAppointment,
  AgendaAuditLog,
  AgendaPatient,
  AgendaProfessional,
  AgendaSchedule,
  AgendaService,
  AgendaSpecialty,
  AppointmentStatus,
  SchedulePermissionFlags,
} from '@/types/agenda';

interface AppointmentModalProps {
  timeZone: string;
  appointment: AgendaAppointment | null;
  initialScheduleId?: string;
  initialDateStr?: string;
  initialStartTime?: string;
  initialEndTime?: string;
  professionals: AgendaProfessional[];
  schedules: AgendaSchedule[];
  specialties: AgendaSpecialty[];
  services: AgendaService[];
  patients: AgendaPatient[];
  auditLogs: AgendaAuditLog[];
  permissionsBySchedule: Record<string, SchedulePermissionFlags>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const ACTION_LABELS: Record<string, string> = {
  create_appointment: 'Agendamento criado',
  create_recurring_appointment: 'Série recorrente criada',
  reschedule_appointment: 'Horário ou profissional alterado',
  change_status: 'Situação alterada',
  cancel_appointment: 'Agendamento cancelado',
  update_appointment: 'Dados atualizados',
};

function addMinutesToTime(hhmm: string, minutesToAdd: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(23 * 60 + 55, Math.max(0, h * 60 + m + minutesToAdd));
  const nextH = Math.floor(total / 60);
  const nextM = total % 60;
  return `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`;
}

export default function AppointmentModal({
  timeZone,
  appointment,
  initialScheduleId,
  initialDateStr,
  initialStartTime,
  initialEndTime,
  professionals,
  schedules,
  specialties,
  services,
  patients,
  auditLogs,
  permissionsBySchedule,
  onClose,
  onSaved,
}: AppointmentModalProps) {
  const isEditing = Boolean(appointment);

  const initialZonedStart = appointment
    ? getZonedParts(appointment.starts_at, timeZone)
    : null;
  const initialZonedEnd = appointment
    ? getZonedParts(appointment.ends_at, timeZone)
    : null;

  const manageableSchedules = useMemo(
    () =>
      schedules.filter(
        (s) => permissionsBySchedule[s.id]?.can_manage_appointments
      ),
    [schedules, permissionsBySchedule]
  );

  const defaultScheduleId =
    appointment?.schedule_id ??
    (initialScheduleId &&
    permissionsBySchedule[initialScheduleId]?.can_manage_appointments
      ? initialScheduleId
      : manageableSchedules[0]?.id ?? schedules[0]?.id ?? '');

  const [scheduleId, setScheduleId] = useState(defaultScheduleId);
  const [patientId, setPatientId] = useState(
    appointment?.patient_id ?? patients[0]?.id ?? ''
  );
  const [serviceId, setServiceId] = useState(appointment?.service_id ?? '');
  const [specialtyId, setSpecialtyId] = useState(
    appointment?.specialty_id ?? ''
  );
  const [dateStr, setDateStr] = useState(
    initialZonedStart?.dateStr ??
      initialDateStr ??
      getZonedParts(new Date(), timeZone).dateStr
  );
  const [startTime, setStartTime] = useState(
    initialZonedStart?.timeStr ?? initialStartTime ?? '09:00'
  );
  const [endTime, setEndTime] = useState(
    initialZonedEnd?.timeStr ?? initialEndTime ?? '10:00'
  );
  const [status, setStatus] = useState<AppointmentStatus>(
    appointment?.status ?? 'confirmed'
  );
  const [isFitIn, setIsFitIn] = useState(appointment?.is_fit_in ?? false);
  const [notesAdmin, setNotesAdmin] = useState(appointment?.notes_admin ?? '');
  const [recurrenceWeeks, setRecurrenceWeeks] = useState(1);

  const [localPatients, setLocalPatients] = useState<AgendaPatient[]>(patients);
  const [showQuickPatient, setShowQuickPatient] = useState(
    patients.length === 0
  );
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  const [creatingPatient, setCreatingPatient] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManageCurrent = Boolean(
    scheduleId && permissionsBySchedule[scheduleId]?.can_manage_appointments
  );

  const appointmentAudit = useMemo(() => {
    if (!appointment) return [];
    return auditLogs.filter((l) => l.appointment_id === appointment.id);
  }, [appointment, auditLogs]);

  const recurrencePreviewDates = useMemo(() => {
    if (isEditing || recurrenceWeeks <= 1 || !dateStr) return [];
    const [y, m, d] = dateStr.split('-').map(Number);
    const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const dates: string[] = [];
    for (let i = 0; i < recurrenceWeeks; i++) {
      const occ = new Date(base.getTime() + i * 7 * 24 * 60 * 60 * 1000);
      dates.push(
        new Intl.DateTimeFormat('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(occ)
      );
    }
    return dates;
  }, [dateStr, isEditing, recurrenceWeeks]);

  function handleServiceChange(nextServiceId: string) {
    setServiceId(nextServiceId);
    const svc = services.find((s) => s.id === nextServiceId);
    if (svc) {
      setEndTime(addMinutesToTime(startTime, svc.duration_minutes));
      if (svc.specialty_id) {
        setSpecialtyId(svc.specialty_id);
      }
    }
  }

  function handleStartTimeChange(nextStart: string) {
    setStartTime(nextStart);
    const svc = services.find((s) => s.id === serviceId);
    const sched = schedules.find((s) => s.id === scheduleId);
    const duration = svc?.duration_minutes ?? sched?.slot_duration_minutes ?? 60;
    setEndTime(addMinutesToTime(nextStart, duration));
  }

  async function handleCreateQuickPatient() {
    setError(null);
    if (!newPatientName.trim()) {
      setError('Informe o nome do paciente.');
      return;
    }
    setCreatingPatient(true);
    try {
      const res = await fetch('/api/agenda/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newPatientName.trim(),
          phone: newPatientPhone.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.patient) {
        setError(data.error ?? 'Não foi possível cadastrar o paciente.');
        return;
      }
      const created = data.patient as AgendaPatient;
      setLocalPatients((prev) => [...prev, created]);
      setPatientId(created.id);
      setNewPatientName('');
      setNewPatientPhone('');
      setShowQuickPatient(false);
    } catch {
      setError('Erro de conexão ao cadastrar paciente.');
    } finally {
      setCreatingPatient(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageCurrent) return;
    setError(null);

    if (!scheduleId || !patientId || !dateStr || !startTime || !endTime) {
      setError('Preencha profissional, paciente, data e horários.');
      return;
    }

    const startsAt = buildZonedIso(dateStr, startTime, timeZone);
    const endsAt = buildZonedIso(dateStr, endTime, timeZone);

    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      setError('O horário de término deve ser posterior ao início.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/agenda/appointments', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: appointment?.id,
          scheduleId,
          patientId,
          serviceId: serviceId || null,
          specialtyId: specialtyId || null,
          startsAt,
          endsAt,
          status,
          isFitIn,
          notesAdmin: notesAdmin.trim() || null,
          recurrenceWeeks: isEditing ? 1 : recurrenceWeeks,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível salvar o agendamento.');
        return;
      }

      await onSaved();
      onClose();
    } catch {
      setError('Falha de conexão ao salvar agendamento.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleQuickStatus(nextStatus: AppointmentStatus) {
    if (!appointment || !canManageCurrent) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/agenda/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: appointment.id,
          status: nextStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível alterar a situação.');
        return;
      }
      setStatus(nextStatus);
      await onSaved();
      onClose();
    } catch {
      setError('Falha de conexão ao atualizar situação.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appt-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Calendar className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <h2
              id="appt-modal-title"
              className="text-lg font-bold text-slate-900"
            >
              {isEditing ? 'Detalhes do agendamento' : 'Novo agendamento'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela"
            className="cursor-pointer rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          {!canManageCurrent && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
              Você possui acesso apenas de visualização para esta agenda.
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          {isEditing && canManageCurrent && (
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Atualização rápida de situação
              </span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {APPOINTMENT_STATUS_LIST.map((st) => {
                  const meta = APPOINTMENT_STATUS_META[st];
                  const active = status === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      disabled={submitting}
                      onClick={() => handleQuickStatus(st)}
                      className={`cursor-pointer rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                        active
                          ? `${meta.bgClass} ${meta.borderClass} ${meta.textClass} ring-1 ring-slate-400`
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {meta.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="appt-schedule"
                className="block text-sm font-medium text-slate-700"
              >
                Profissional / Agenda
              </label>
              <select
                id="appt-schedule"
                value={scheduleId}
                disabled={!canManageCurrent}
                onChange={(e) => setScheduleId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 disabled:bg-slate-50"
              >
                {schedules.map((sched) => {
                  const prof = professionals.find(
                    (p) => p.id === sched.professional_id
                  );
                  const canEditSched =
                    permissionsBySchedule[sched.id]?.can_manage_appointments;
                  return (
                    <option
                      key={sched.id}
                      value={sched.id}
                      disabled={!canEditSched}
                    >
                      {prof?.name ?? sched.name}
                      {!canEditSched ? ' (somente leitura)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="appt-patient"
                  className="block text-sm font-medium text-slate-700"
                >
                  Paciente
                </label>
                {canManageCurrent && (
                  <button
                    type="button"
                    onClick={() => setShowQuickPatient((prev) => !prev)}
                    className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                  >
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    {showQuickPatient ? 'Cancelar novo' : 'Novo paciente'}
                  </button>
                )}
              </div>
              <select
                id="appt-patient"
                value={patientId}
                disabled={!canManageCurrent}
                onChange={(e) => setPatientId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 disabled:bg-slate-50"
              >
                <option value="">Selecione um paciente...</option>
                {localPatients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.phone ? ` · ${p.phone}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {showQuickPatient && canManageCurrent && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3.5">
              <p className="text-xs font-semibold text-emerald-900">
                Cadastro rápido de paciente
              </p>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
                <input
                  type="text"
                  value={newPatientName}
                  onChange={(e) => setNewPatientName(e.target.value)}
                  placeholder="Nome completo"
                  className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
                <input
                  type="text"
                  value={newPatientPhone}
                  onChange={(e) => setNewPatientPhone(e.target.value)}
                  placeholder="Telefone / WhatsApp"
                  className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                />
                <button
                  type="button"
                  onClick={handleCreateQuickPatient}
                  disabled={creatingPatient}
                  className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {creatingPatient ? 'Salvando...' : 'Adicionar paciente'}
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="appt-service"
                className="block text-sm font-medium text-slate-700"
              >
                Serviço / Procedimento
              </label>
              <select
                id="appt-service"
                value={serviceId}
                disabled={!canManageCurrent}
                onChange={(e) => handleServiceChange(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 disabled:bg-slate-50"
              >
                <option value="">Atendimento padrão</option>
                {services.map((svc) => (
                  <option key={svc.id} value={svc.id}>
                    {svc.name} ({svc.duration_minutes} min)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="appt-specialty"
                className="block text-sm font-medium text-slate-700"
              >
                Especialidade
              </label>
              <select
                id="appt-specialty"
                value={specialtyId}
                disabled={!canManageCurrent}
                onChange={(e) => setSpecialtyId(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 disabled:bg-slate-50"
              >
                <option value="">Sem vínculo específico</option>
                {specialties.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="appt-date"
                className="block text-sm font-medium text-slate-700"
              >
                Data
              </label>
              <input
                id="appt-date"
                type="date"
                value={dateStr}
                disabled={!canManageCurrent}
                onChange={(e) => setDateStr(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums outline-none focus:border-emerald-600 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label
                htmlFor="appt-start"
                className="block text-sm font-medium text-slate-700"
              >
                Início
              </label>
              <input
                id="appt-start"
                type="time"
                value={startTime}
                disabled={!canManageCurrent}
                onChange={(e) => handleStartTimeChange(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums outline-none focus:border-emerald-600 disabled:bg-slate-50"
              />
            </div>
            <div>
              <label
                htmlFor="appt-end"
                className="block text-sm font-medium text-slate-700"
              >
                Término
              </label>
              <input
                id="appt-end"
                type="time"
                value={endTime}
                disabled={!canManageCurrent}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 tabular-nums outline-none focus:border-emerald-600 disabled:bg-slate-50"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="appt-status"
                className="block text-sm font-medium text-slate-700"
              >
                Situação
              </label>
              <select
                id="appt-status"
                value={status}
                disabled={!canManageCurrent}
                onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 disabled:bg-slate-50"
              >
                {APPOINTMENT_STATUS_LIST.map((st) => (
                  <option key={st} value={st}>
                    {APPOINTMENT_STATUS_META[st].label}
                  </option>
                ))}
              </select>
            </div>

            {!isEditing && (
              <div>
                <label
                  htmlFor="appt-recurrence"
                  className="flex items-center gap-1.5 text-sm font-medium text-slate-700"
                >
                  <Repeat className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                  Recorrência semanal
                </label>
                <select
                  id="appt-recurrence"
                  value={recurrenceWeeks}
                  disabled={!canManageCurrent}
                  onChange={(e) => setRecurrenceWeeks(Number(e.target.value))}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600"
                >
                  <option value={1}>Sessão única (sem recorrência)</option>
                  {[2, 4, 6, 8, 10, 12].map((n) => (
                    <option key={n} value={n}>
                      Repetir semanalmente ({n} sessões)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {recurrencePreviewDates.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">
                Ocorrências a validar e criar ({recurrencePreviewDates.length}):
              </p>
              <p className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
                {recurrencePreviewDates.join(' · ')}
              </p>
            </div>
          )}

          <div className="flex items-start gap-2.5">
            <input
              id="appt-fit-in"
              type="checkbox"
              checked={isFitIn}
              disabled={!canManageCurrent}
              onChange={(e) => setIsFitIn(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
            />
            <label htmlFor="appt-fit-in" className="text-sm text-slate-700">
              <span className="font-medium">Autorizar como encaixe</span>
              <span className="block text-xs text-slate-500">
                Permite agendar fora da jornada ou sobre outro horário existente
                (bloqueios continuam impedindo o agendamento).
              </span>
            </label>
          </div>

          <div>
            <label
              htmlFor="appt-notes"
              className="block text-sm font-medium text-slate-700"
            >
              Observação administrativa (não inserir dados clínicos sensíveis)
            </label>
            <textarea
              id="appt-notes"
              rows={2}
              value={notesAdmin}
              disabled={!canManageCurrent}
              onChange={(e) => setNotesAdmin(e.target.value)}
              maxLength={500}
              placeholder="Ex.: Primeira visita, confirmar convênio na recepção..."
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-600 disabled:bg-slate-50"
            />
          </div>

          {isEditing && appointmentAudit.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                Histórico de alterações
              </h3>
              <ul className="mt-2.5 space-y-2">
                {appointmentAudit.map((log) => (
                  <li
                    key={log.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-800">
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                      <span className="text-slate-500">
                        {' '}
                        · {log.actor_email ?? 'Sistema'}
                      </span>
                    </div>
                    <span className="font-mono text-slate-500 tabular-nums">
                      {new Intl.DateTimeFormat('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone,
                      }).format(new Date(log.created_at))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <div>
              {isEditing &&
                canManageCurrent &&
                appointment?.status !== 'canceled' && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleQuickStatus('canceled')}
                    className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                  >
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    Cancelar agendamento
                  </button>
                )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Fechar
              </button>
              {canManageCurrent && (
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Clock className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {isEditing ? 'Salvar alterações' : 'Confirmar agendamento'}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
