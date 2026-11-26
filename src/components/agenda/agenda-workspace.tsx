'use client';

import {
  AlertCircle,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  HelpCircle,
  Lock,
  Palette,
  PlayCircle,
  Plus,
  Repeat,
  Search,
  UserCheck,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import AgendaSqlSetup from '@/components/agenda/agenda-sql-setup';
import AppointmentModal from '@/components/agenda/appointment-modal';
import BlockModal from '@/components/agenda/block-modal';
import ProfessionalModal from '@/components/agenda/professional-modal';
import ScheduleManagementPanel from '@/components/agenda/schedule-management-panel';
import {
  APPOINTMENT_STATUS_LIST,
  APPOINTMENT_STATUS_META,
  ROLE_LABELS,
  buildZonedIso,
  getColorTheme,
  getZonedParts,
} from '@/lib/agenda/constants';
import type {
  AgendaAppointment,
  AgendaBlock,
  AgendaProfessional,
  AgendaWorkspacePayload,
  AppointmentStatus,
} from '@/types/agenda';

type ViewMode = 'day' | 'week' | 'month' | 'list' | 'programacao';
type ScopeMode = 'general' | 'individual';
type WeekLayoutMode = 'by_day' | 'by_professional';
type ColorMode = 'professional' | 'specialty' | 'status';

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 07:00 .. 19:00

const HATCHED_BG_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(-45deg, #f1f5f9, #f1f5f9 8px, #e2e8f0 8px, #e2e8f0 16px)',
} as const;

function StatusIcon({
  status,
  className = 'h-3.5 w-3.5 shrink-0',
}: {
  status: AppointmentStatus;
  className?: string;
}) {
  switch (status) {
    case 'confirmed':
    case 'completed':
      return <Check className={className} aria-hidden="true" />;
    case 'awaiting_service':
      return <UserCheck className={className} aria-hidden="true" />;
    case 'in_service':
      return <PlayCircle className={className} aria-hidden="true" />;
    case 'canceled':
      return <XCircle className={className} aria-hidden="true" />;
    case 'no_show':
      return <UserX className={className} aria-hidden="true" />;
    case 'awaiting_confirmation':
    case 'pending':
    default:
      return <Clock className={className} aria-hidden="true" />;
  }
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

function getMondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysToDateStr(dateStr, diff);
}

function formatDayHeader(dateStr: string): { weekday: string; dayNum: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const weekday = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    timeZone: 'UTC',
  })
    .format(dt)
    .replace('-feira', '');
  return { weekday, dayNum: String(d).padStart(2, '0') };
}

function formatPeriodTitle(
  view: ViewMode,
  anchorDateStr: string,
  weekDates: string[]
): string {
  if (view === 'day') {
    const [y, m, d] = anchorDateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      timeZone: 'UTC',
    }).format(dt);
  }
  if (view === 'month') {
    const [y, m] = anchorDateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
    return new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(dt);
  }
  const first = weekDates[0];
  const last = weekDates[weekDates.length - 1];
  const [y1, m1, d1] = first.split('-').map(Number);
  const [y2, m2, d2] = last.split('-').map(Number);
  const monthName = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y2, m2 - 1, d2, 12, 0, 0)));

  if (m1 === m2 && y1 === y2) {
    return `${String(d1).padStart(2, '0')}–${String(d2).padStart(2, '0')} de ${monthName}`;
  }
  return `${String(d1).padStart(2, '0')}/${String(m1).padStart(2, '0')} – ${String(d2).padStart(2, '0')}/${String(m2).padStart(2, '0')}`;
}

export default function AgendaWorkspace() {
  const [loading, setLoading] = useState(true);
  const [tableNotFound, setTableNotFound] = useState(false);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<AgendaWorkspacePayload | null>(
    null
  );
  const [planLimits, setPlanLimits] = useState<{
    planSlug: string;
    planName: string;
    maxProfessionals: number | null;
    maxPatients: number | null;
  }>({
    planSlug: 'free',
    planName: 'Free',
    maxProfessionals: 1,
    maxPatients: 5,
  });

  // View & Navigation State
  const [view, setView] = useState<ViewMode>('week');
  const [scope, setScope] = useState<ScopeMode>('general');
  const [weekLayout, setWeekLayout] = useState<WeekLayoutMode>('by_day');
  const [colorMode, setColorMode] = useState<ColorMode>('professional');
  const [showSaturday, setShowSaturday] = useState(false);
  const [anchorDateStr, setAnchorDateStr] = useState(() =>
    getZonedParts(new Date(), 'America/Sao_Paulo').dateStr
  );

  // Filters
  const [filterUnitId, setFilterUnitId] = useState('');
  const [filterSpecialtyId, setFilterSpecialtyId] = useState('');
  const [filterProfessionalId, setFilterProfessionalId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPatientQuery, setFilterPatientQuery] = useState('');

  // Mobile focused professional (prevents cramped horizontal squeeze on small screens)
  const [mobileProfId, setMobileProfId] = useState('');

  // Popovers & Modals
  const [showHelp, setShowHelp] = useState(false);
  const [appointmentModalState, setAppointmentModalState] = useState<{
    open: boolean;
    appointment: AgendaAppointment | null;
    initialScheduleId?: string;
    initialDateStr?: string;
    initialStartTime?: string;
    initialEndTime?: string;
  }>({ open: false, appointment: null });
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [profModalState, setProfModalState] = useState<{
    open: boolean;
    professional: AgendaProfessional | null;
  }>({ open: false, professional: null });

  // Drag-and-drop reschedule confirmation state
  const [draggingApptId, setDraggingApptId] = useState<string | null>(null);
  const [pendingReschedule, setPendingReschedule] = useState<{
    appointment: AgendaAppointment;
    targetDateStr: string;
    targetHour: number;
    targetScheduleId: string;
  } | null>(null);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/agenda', { cache: 'no-store' });
      const data = await res.json();

      if (res.status === 401) {
        setUnauthenticated(true);
        setLoading(false);
        return;
      }

      if (res.status === 404 && data.code === 'TABLE_NOT_FOUND') {
        setTableNotFound(true);
        setNeedsBootstrap(false);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setLoadError(data.error ?? 'Erro ao carregar dados da agenda.');
        setLoading(false);
        return;
      }

      if (data.planLimits) {
        setPlanLimits(data.planLimits);
      }

      if (data.needsBootstrap || !data.organization) {
        setTableNotFound(false);
        setNeedsBootstrap(true);
        setWorkspace(null);
        setLoading(false);
        return;
      }

      setTableNotFound(false);
      setNeedsBootstrap(false);
      setUnauthenticated(false);
      setWorkspace(data as AgendaWorkspacePayload);
    } catch {
      setLoadError('Falha de conexão ao carregar a agenda.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  const timeZone = workspace?.organization?.timezone ?? 'America/Sao_Paulo';
  const todayStr = useMemo(
    () => getZonedParts(new Date(), timeZone).dateStr,
    [timeZone]
  );

  // If user is a single non-admin professional with 1 visible schedule, default smoothly
  useEffect(() => {
    if (!workspace) return;
    if (
      workspace.role === 'professional' &&
      !workspace.isAdmin &&
      workspace.professionals.length === 1
    ) {
      setScope('individual');
      setFilterProfessionalId(workspace.professionals[0].id);
    }
    if (!mobileProfId && workspace.professionals.length > 0) {
      setMobileProfId(workspace.professionals[0].id);
    }
  }, [workspace, mobileProfId]);

  const weekDates = useMemo(() => {
    const monday = getMondayOfWeek(anchorDateStr);
    const count = showSaturday ? 6 : 5;
    return Array.from({ length: count }, (_, i) => addDaysToDateStr(monday, i));
  }, [anchorDateStr, showSaturday]);

  const filteredProfessionals = useMemo(() => {
    if (!workspace) return [];
    let list = workspace.professionals.filter((p) => p.is_active);
    if (filterUnitId) {
      list = list.filter((p) => p.unit_id === filterUnitId);
    }
    if (filterSpecialtyId) {
      list = list.filter((p) => p.specialty_ids.includes(filterSpecialtyId));
    }
    if (scope === 'individual') {
      const targetId = filterProfessionalId || workspace.professionals[0]?.id;
      if (targetId) {
        list = list.filter((p) => p.id === targetId);
      }
    } else if (filterProfessionalId) {
      list = list.filter((p) => p.id === filterProfessionalId);
    }
    return list;
  }, [
    workspace,
    filterUnitId,
    filterSpecialtyId,
    filterProfessionalId,
    scope,
  ]);

  const filteredProfIds = useMemo(
    () => new Set(filteredProfessionals.map((p) => p.id)),
    [filteredProfessionals]
  );

  const filteredAppointments = useMemo(() => {
    if (!workspace) return [];
    const q = filterPatientQuery.trim().toLowerCase();
    return workspace.appointments.filter((appt) => {
      if (!filteredProfIds.has(appt.professional_id)) return false;
      if (filterUnitId && appt.unit_id !== filterUnitId) return false;
      if (filterSpecialtyId && appt.specialty_id !== filterSpecialtyId) {
        // Also allow if professional has the specialty when appointment has null specialty_id
        const prof = workspace.professionals.find(
          (p) => p.id === appt.professional_id
        );
        if (!prof?.specialty_ids.includes(filterSpecialtyId)) return false;
      }
      if (filterStatus && appt.status !== filterStatus) return false;
      if (q) {
        const patient = workspace.patients.find(
          (pt) => pt.id === appt.patient_id
        );
        if (!patient || !patient.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [
    workspace,
    filteredProfIds,
    filterUnitId,
    filterSpecialtyId,
    filterStatus,
    filterPatientQuery,
  ]);

  const monthGridDates = useMemo(() => {
    const [y, m] = anchorDateStr.split('-').map(Number);
    const firstOfMonth = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
    const startWeekday = firstOfMonth.getUTCDay(); // 0=Sun
    const offset = startWeekday === 0 ? -6 : 1 - startWeekday;
    const gridStart = addDaysToDateStr(
      `${y}-${String(m).padStart(2, '0')}-01`,
      offset
    );
    return Array.from({ length: 42 }, (_, i) => addDaysToDateStr(gridStart, i));
  }, [anchorDateStr]);

  function navigatePeriod(direction: -1 | 1) {
    if (view === 'day' || (view === 'week' && weekLayout === 'by_professional')) {
      setAnchorDateStr((prev) => addDaysToDateStr(prev, direction));
    } else if (view === 'month') {
      const [y, m] = anchorDateStr.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1 + direction, 1, 12, 0, 0));
      setAnchorDateStr(dt.toISOString().slice(0, 10));
    } else {
      setAnchorDateStr((prev) => addDaysToDateStr(prev, direction * 7));
    }
  }

  function getCardStyles(appt: AgendaAppointment) {
    if (!workspace) {
      return {
        wrapper: 'border-slate-200 bg-slate-50 text-slate-900',
        dot: 'bg-slate-600',
      };
    }
    if (colorMode === 'status') {
      const meta = APPOINTMENT_STATUS_META[appt.status];
      return {
        wrapper: `${meta.borderClass} ${meta.bgClass} ${meta.textClass}`,
        dot: 'bg-slate-700',
      };
    }
    if (colorMode === 'specialty') {
      const spec = workspace.specialties.find((s) => s.id === appt.specialty_id);
      const theme = getColorTheme(spec?.color ?? '#059669');
      return {
        wrapper: `${theme.border} ${theme.bg} ${theme.text}`,
        dot: theme.accent,
      };
    }
    const prof = workspace.professionals.find(
      (p) => p.id === appt.professional_id
    );
    const theme = getColorTheme(prof?.color ?? '#059669');
    return {
      wrapper: `${theme.border} ${theme.bg} ${theme.text}`,
      dot: theme.accent,
    };
  }

  function getBlocksForCell(
    dateStr: string,
    hour: number,
    scheduleId?: string
  ): AgendaBlock[] {
    if (!workspace) return [];
    const slotStartMs = Date.parse(
      buildZonedIso(dateStr, `${String(hour).padStart(2, '0')}:00`, timeZone)
    );
    const slotEndMs = slotStartMs + 60 * 60 * 1000;

    return workspace.blocks.filter((b) => {
      if (scheduleId && b.schedule_id && b.schedule_id !== scheduleId) {
        return false;
      }
      if (b.is_recurring) {
        const bStart = getZonedParts(b.starts_at, timeZone);
        const bEnd = getZonedParts(b.ends_at, timeZone);
        const bStartMin = bStart.hour * 60 + bStart.minute;
        const bEndMin = bEnd.hour * 60 + bEnd.minute;
        const slotMinStart = hour * 60;
        const slotMinEnd = (hour + 1) * 60;
        return slotMinStart < bEndMin && slotMinEnd > bStartMin;
      }
      const bStartMs = Date.parse(b.starts_at);
      const bEndMs = Date.parse(b.ends_at);
      return slotStartMs < bEndMs && slotEndMs > bStartMs;
    });
  }

  function isOutsideAvailability(
    dateStr: string,
    hour: number,
    scheduleId?: string
  ): boolean {
    if (!workspace || !scheduleId) return false;
    const [y, m, d] = dateStr.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
    const rule = workspace.availabilityRules.find(
      (r) => r.schedule_id === scheduleId && r.day_of_week === dayOfWeek
    );
    if (!rule || !rule.is_active) return true;
    const startH = Number(rule.start_time.slice(0, 2));
    const endH = Number(rule.end_time.slice(0, 2));
    if (hour < startH || hour >= endH) return true;
    if (rule.break_start && rule.break_end) {
      const bStartH = Number(rule.break_start.slice(0, 2));
      const bEndH = Number(rule.break_end.slice(0, 2));
      if (hour >= bStartH && hour < bEndH) return true;
    }
    return false;
  }

  function openCreateFromSlot(
    dateStr: string,
    hour: number,
    scheduleId?: string
  ) {
    const startTime = `${String(hour).padStart(2, '0')}:00`;
    const endTime = `${String(hour + 1).padStart(2, '0')}:00`;
    setAppointmentModalState({
      open: true,
      appointment: null,
      initialScheduleId: scheduleId,
      initialDateStr: dateStr,
      initialStartTime: startTime,
      initialEndTime: endTime,
    });
  }

  function handleDropOnSlot(
    e: React.DragEvent,
    targetDateStr: string,
    targetHour: number,
    explicitScheduleId?: string
  ) {
    e.preventDefault();
    const apptId = e.dataTransfer.getData('text/plain') || draggingApptId;
    setDraggingApptId(null);
    if (!apptId || !workspace) return;

    const appt = workspace.appointments.find((a) => a.id === apptId);
    if (!appt) return;

    const targetScheduleId = explicitScheduleId || appt.schedule_id;
    const currentStart = getZonedParts(appt.starts_at, timeZone);

    if (
      currentStart.dateStr === targetDateStr &&
      currentStart.hour === targetHour &&
      appt.schedule_id === targetScheduleId
    ) {
      return;
    }

    setRescheduleError(null);
    setPendingReschedule({
      appointment: appt,
      targetDateStr,
      targetHour,
      targetScheduleId,
    });
  }

  async function confirmReschedule() {
    if (!pendingReschedule) return;
    setRescheduleError(null);
    setRescheduling(true);

    const { appointment, targetDateStr, targetHour, targetScheduleId } =
      pendingReschedule;
    const durationMs =
      Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at);
    const currentStart = getZonedParts(appointment.starts_at, timeZone);
    const startIso = buildZonedIso(
      targetDateStr,
      `${String(targetHour).padStart(2, '0')}:${String(currentStart.minute).padStart(2, '0')}`,
      timeZone
    );
    const endIso = new Date(Date.parse(startIso) + durationMs).toISOString();

    try {
      const res = await fetch('/api/agenda/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: appointment.id,
          scheduleId: targetScheduleId,
          startsAt: startIso,
          endsAt: endIso,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRescheduleError(
          data.error ?? 'Não foi possível reagendar para este horário.'
        );
        return;
      }
      setPendingReschedule(null);
      await loadWorkspace();
    } catch {
      setRescheduleError('Falha de conexão ao reagendar.');
    } finally {
      setRescheduling(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 w-64 rounded-lg bg-slate-100" />
        <div className="h-[520px] rounded-xl border border-slate-200 bg-slate-50" />
      </div>
    );
  }

  if (unauthenticated) {
    return (
      <section className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-8 text-center">
        <CalendarIcon
          className="mx-auto h-10 w-10 text-emerald-600"
          aria-hidden="true"
        />
        <h1 className="mt-4 text-xl font-bold text-slate-900">
          Faça login para acessar a Agenda Multiprofissional
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          As agendas independentes e a visão consolidada da clínica exigem uma
          sessão autenticada no Supabase.
        </p>
        <a
          href="/login"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700"
        >
          Entrar na minha conta
        </a>
      </section>
    );
  }

  if (tableNotFound) {
    return (
      <AgendaSqlSetup
        mode="table_not_found"
        planLimits={planLimits}
        onReload={loadWorkspace}
      />
    );
  }

  if (needsBootstrap || !workspace) {
    if (loadError) {
      return (
        <div
          role="alert"
          className="mx-auto max-w-2xl space-y-4 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900"
        >
          <p className="font-medium">{loadError}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                loadWorkspace();
              }}
              className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-red-700 px-3.5 text-xs font-semibold text-white transition hover:bg-red-800"
            >
              Tentar novamente
            </button>
            <button
              type="button"
              onClick={() => {
                setLoadError(null);
                setTableNotFound(true);
              }}
              className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-red-300 bg-white px-3.5 text-xs font-semibold text-red-800 transition hover:bg-red-100"
            >
              Ver script SQL de configuração
            </button>
          </div>
        </div>
      );
    }
    return (
      <AgendaSqlSetup
        mode="needs_bootstrap"
        planLimits={planLimits}
        onReload={loadWorkspace}
      />
    );
  }

  const canCreateAnyAppointment = workspace.schedules.some(
    (s) => workspace.permissionsBySchedule[s.id]?.can_manage_appointments
  );
  const canCreateAnyBlock =
    workspace.isAdmin ||
    workspace.schedules.some(
      (s) => workspace.permissionsBySchedule[s.id]?.can_manage_blocks
    );

  // Determine which columns are shown in "Por Profissional" mode (used in Dia and Semana->Por Profissional)
  const activeColumnsProfs = filteredProfessionals;

  return (
    <div className="space-y-4">
      {/* 1. Cabeçalho superior (inspirado na Imagem A) */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-800">
            <CalendarIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Agenda
            </h1>
            <p className="text-sm text-slate-600">
              {workspace.organization?.name} · {ROLE_LABELS[workspace.role]} ·{' '}
              <span className="font-mono text-xs tabular-nums">
                {filteredProfessionals.length}{' '}
                {filteredProfessionals.length === 1
                  ? 'agenda visível'
                  : 'agendas visíveis'}
              </span>
            </p>
          </div>
        </div>

        <div className="relative flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowHelp((prev) => !prev)}
            aria-label="Legenda e regras da agenda"
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
          </button>

          {showHelp && (
            <div className="absolute right-0 top-12 z-40 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Legenda & Interações
                </span>
                <button
                  type="button"
                  onClick={() => setShowHelp(false)}
                  className="cursor-pointer text-slate-400 hover:text-slate-700"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <ul className="mt-2.5 space-y-2 text-xs text-slate-600">
                <li>
                  • Clique em qualquer horário livre para criar um agendamento
                  com data e profissional preenchidos.
                </li>
                <li>
                  • Arraste um cartão de agendamento para reagendar (com
                  validação de conflitos e bloqueios).
                </li>
                <li>
                  • Faixas hachuradas representam bloqueios (ex.: Clínica
                  fechada / almoço).
                </li>
                <li>
                  • Visão Geral consolida agendas individuais sem duplicar
                  registros.
                </li>
              </ul>
            </div>
          )}

          {canCreateAnyBlock && (
            <button
              type="button"
              onClick={() => setShowBlockModal(true)}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              <Lock className="h-4 w-4 text-slate-600" aria-hidden="true" />
              Bloquear
            </button>
          )}

          {canCreateAnyAppointment && (
            <button
              type="button"
              onClick={() =>
                setAppointmentModalState({
                  open: true,
                  appointment: null,
                  initialDateStr: anchorDateStr,
                })
              }
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Novo agendamento
            </button>
          )}
        </div>
      </div>

      {/* 2. Barra de visualização e navegação de período */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-200 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Seletor principal: Dia | Semana | Mês | Lista | Programação */}
          <div
            role="tablist"
            aria-label="Modo de visualização"
            className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1"
          >
            {(
              [
                { id: 'day', label: 'Dia' },
                { id: 'week', label: 'Semana' },
                { id: 'month', label: 'Mês' },
                { id: 'list', label: 'Lista' },
                { id: 'programacao', label: 'Programação' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={view === tab.id}
                onClick={() => setView(tab.id)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  view === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {view !== 'programacao' && (
            <>
              {/* Geral vs Individual */}
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setScope('general');
                    setFilterProfessionalId('');
                  }}
                  className={`cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                    scope === 'general'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Visão Geral
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScope('individual');
                    if (
                      !filterProfessionalId &&
                      workspace.professionals.length > 0
                    ) {
                      setFilterProfessionalId(workspace.professionals[0].id);
                    }
                  }}
                  className={`cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                    scope === 'individual'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Individual
                </button>
              </div>

              {view === 'week' && scope === 'general' && (
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setWeekLayout('by_day')}
                    className={`cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                      weekLayout === 'by_day'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Por Dia
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekLayout('by_professional')}
                    className={`cursor-pointer rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                      weekLayout === 'by_professional'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Por Profissional
                  </button>
                </div>
              )}

              {/* Seletor de Cores */}
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                <Palette
                  className="h-3.5 w-3.5 text-slate-500"
                  aria-hidden="true"
                />
                <select
                  aria-label="Critério de cores dos cartões"
                  value={colorMode}
                  onChange={(e) => setColorMode(e.target.value as ColorMode)}
                  className="cursor-pointer bg-transparent text-xs font-semibold text-slate-700 outline-none"
                >
                  <option value="professional">Cores: Profissional</option>
                  <option value="specialty">Cores: Especialidade</option>
                  <option value="status">Cores: Situação</option>
                </select>
              </div>
            </>
          )}
        </div>

        {view !== 'programacao' && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm font-semibold capitalize text-slate-800 tabular-nums">
              {formatPeriodTitle(view, anchorDateStr, weekDates)}
            </span>

            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => navigatePeriod(-1)}
                aria-label="Período anterior"
                className="cursor-pointer border-r border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setAnchorDateStr(todayStr)}
                className="cursor-pointer px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => navigatePeriod(1)}
                aria-label="Próximo período"
                className="cursor-pointer border-l border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Barra de filtros (Situação, Profissional, Especialidade, Unidade, Paciente) */}
      {view !== 'programacao' && (
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filtrar por situação"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 outline-none focus:border-emerald-600"
            >
              <option value="">Situação: Todas</option>
              {APPOINTMENT_STATUS_LIST.map((st) => (
                <option key={st} value={st}>
                  {APPOINTMENT_STATUS_META[st].label}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por profissional"
              value={filterProfessionalId}
              onChange={(e) => setFilterProfessionalId(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 outline-none focus:border-emerald-600"
            >
              {scope === 'general' && (
                <option value="">Profissional: Todos</option>
              )}
              {workspace.professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por especialidade"
              value={filterSpecialtyId}
              onChange={(e) => setFilterSpecialtyId(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 outline-none focus:border-emerald-600"
            >
              <option value="">Especialidade: Todas</option>
              {workspace.specialties.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>

            {workspace.units.length > 1 && (
              <select
                aria-label="Filtrar por unidade"
                value={filterUnitId}
                onChange={(e) => setFilterUnitId(e.target.value)}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 outline-none focus:border-emerald-600"
              >
                <option value="">Unidade: Todas</option>
                {workspace.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                aria-label="Buscar paciente"
                value={filterPatientQuery}
                onChange={(e) => setFilterPatientQuery(e.target.value)}
                placeholder="Buscar paciente..."
                className="h-9 w-44 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            {view === 'week' && weekLayout === 'by_day' && (
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showSaturday}
                  onChange={(e) => setShowSaturday(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
                />
                Incluir sábado
              </label>
            )}

            {/* Legenda discreta de cores */}
            <div className="hidden items-center gap-3 sm:flex">
              {colorMode === 'professional' &&
                filteredProfessionals.slice(0, 4).map((p) => {
                  const theme = getColorTheme(p.color);
                  return (
                    <span
                      key={p.id}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span
                        className={`h-2.5 w-2.5 rounded-xs ${theme.accent}`}
                        aria-hidden="true"
                      />
                      <span className="max-w-[110px] truncate">{p.name}</span>
                    </span>
                  );
                })}
              {colorMode === 'specialty' &&
                workspace.specialties.slice(0, 4).map((sp) => {
                  const theme = getColorTheme(sp.color);
                  return (
                    <span
                      key={sp.id}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span
                        className={`h-2.5 w-2.5 rounded-xs ${theme.accent}`}
                        aria-hidden="true"
                      />
                      <span>{sp.name}</span>
                    </span>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* 4. Área Principal */}
      {view === 'programacao' && (
        <ScheduleManagementPanel
          timeZone={timeZone}
          isAdmin={workspace.isAdmin}
          professionals={workspace.professionals}
          schedules={workspace.schedules}
          specialties={workspace.specialties}
          units={workspace.units}
          availabilityRules={workspace.availabilityRules}
          managers={workspace.managers}
          auditLogs={workspace.auditLogs}
          permissionsBySchedule={workspace.permissionsBySchedule}
          planLimits={planLimits}
          onAddProfessional={() =>
            setProfModalState({ open: true, professional: null })
          }
          onEditProfessional={(prof) =>
            setProfModalState({ open: true, professional: prof })
          }
          onSaved={loadWorkspace}
        />
      )}

      {/* Visão Semanal: Por Dia (Imagem A) */}
      {view === 'week' && (scope === 'individual' || weekLayout === 'by_day') && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="max-h-[680px] overflow-auto">
            <table className="w-full min-w-[820px] border-collapse table-fixed">
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="border-b border-slate-200">
                  <th className="sticky left-0 z-30 w-16 border-r border-slate-200 bg-white py-3 text-center font-mono text-[11px] font-medium text-slate-400">
                    Horário
                  </th>
                  {weekDates.map((dStr) => {
                    const { weekday, dayNum } = formatDayHeader(dStr);
                    const isToday = dStr === todayStr;
                    return (
                      <th
                        key={dStr}
                        className={`border-r border-slate-200 px-2 py-2.5 text-center last:border-r-0 ${
                          isToday ? 'bg-emerald-50/50' : 'bg-white'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setAnchorDateStr(dStr);
                            setView('day');
                          }}
                          className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold capitalize text-slate-700 hover:text-emerald-700"
                        >
                          <span>{weekday}</span>
                          <span
                            className={`font-mono tabular-nums ${
                              isToday
                                ? 'rounded-md bg-emerald-600 px-1.5 py-0.5 text-white'
                                : 'text-slate-900'
                            }`}
                          >
                            {dayNum}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {HOURS.map((hour) => {
                  const hourLabel = `${String(hour).padStart(2, '0')}:00`;
                  return (
                    <tr
                      key={hour}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="sticky left-0 z-10 w-16 border-r border-slate-200 bg-white px-2 py-2 text-right align-top font-mono text-xs font-medium text-slate-500 tabular-nums">
                        {hourLabel}
                      </td>

                      {weekDates.map((dStr) => {
                        const cellBlocks = getBlocksForCell(dStr, hour);
                        const cellAppointments = filteredAppointments.filter(
                          (appt) => {
                            const start = getZonedParts(
                              appt.starts_at,
                              timeZone
                            );
                            return (
                              start.dateStr === dStr && start.hour === hour
                            );
                          }
                        );

                        return (
                          <td
                            key={dStr}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => handleDropOnSlot(e, dStr, hour)}
                            onClick={() => {
                              if (
                                cellBlocks.length === 0 &&
                                canCreateAnyAppointment
                              ) {
                                const defaultSched =
                                  filteredProfessionals.length === 1
                                    ? workspace.schedules.find(
                                        (s) =>
                                          s.professional_id ===
                                          filteredProfessionals[0].id
                                      )?.id
                                    : undefined;
                                openCreateFromSlot(dStr, hour, defaultSched);
                              }
                            }}
                            style={
                              cellBlocks.length > 0
                                ? HATCHED_BG_STYLE
                                : undefined
                            }
                            className={`h-[74px] border-r border-slate-200 p-1 align-top transition last:border-r-0 ${
                              cellBlocks.length > 0
                                ? 'cursor-not-allowed'
                                : canCreateAnyAppointment
                                  ? 'cursor-pointer hover:bg-emerald-50/25'
                                  : ''
                            }`}
                          >
                            {cellBlocks.length > 0 && (
                              <div className="flex h-full flex-col justify-center rounded-md px-2 py-1 text-slate-700">
                                <span className="flex items-center gap-1 text-xs font-semibold">
                                  <Lock
                                    className="h-3 w-3 shrink-0"
                                    aria-hidden="true"
                                  />
                                  <span className="truncate">
                                    {cellBlocks[0].title}
                                  </span>
                                  {cellBlocks[0].is_recurring && (
                                    <Repeat
                                      className="h-3 w-3 shrink-0 text-slate-500"
                                      aria-hidden="true"
                                    />
                                  )}
                                </span>
                                <span className="font-mono text-[10px] text-slate-600 tabular-nums">
                                  {hourLabel}–
                                  {String(hour + 1).padStart(2, '0')}:00
                                </span>
                              </div>
                            )}

                            {cellBlocks.length === 0 &&
                              cellAppointments.length > 0 && (
                                <div className="flex h-full gap-1">
                                  {cellAppointments.map((appt) => {
                                    const patient = workspace.patients.find(
                                      (pt) => pt.id === appt.patient_id
                                    );
                                    const prof = workspace.professionals.find(
                                      (pr) => pr.id === appt.professional_id
                                    );
                                    const start = getZonedParts(
                                      appt.starts_at,
                                      timeZone
                                    );
                                    const end = getZonedParts(
                                      appt.ends_at,
                                      timeZone
                                    );
                                    const styles = getCardStyles(appt);
                                    const canDrag =
                                      workspace.permissionsBySchedule[
                                        appt.schedule_id
                                      ]?.can_manage_appointments;

                                    return (
                                      <button
                                        key={appt.id}
                                        type="button"
                                        draggable={Boolean(canDrag)}
                                        onDragStart={(e) => {
                                          setDraggingApptId(appt.id);
                                          e.dataTransfer.setData(
                                            'text/plain',
                                            appt.id
                                          );
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setAppointmentModalState({
                                            open: true,
                                            appointment: appt,
                                          });
                                        }}
                                        className={`flex min-w-0 flex-1 cursor-pointer flex-col justify-between rounded-md border px-2 py-1 text-left transition hover:shadow-xs ${styles.wrapper} ${
                                          appt.status === 'canceled'
                                            ? 'opacity-55 line-through'
                                            : ''
                                        }`}
                                      >
                                        <div className="flex items-center gap-1 min-w-0">
                                          <StatusIcon
                                            status={appt.status}
                                            className="h-3 w-3 shrink-0"
                                          />
                                          <span className="truncate text-xs font-semibold">
                                            {patient?.name ?? 'Paciente'}
                                          </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-1 font-mono text-[10px] opacity-85 tabular-nums">
                                          <span>
                                            {start.timeStr}–{end.timeStr}
                                          </span>
                                          {appt.is_fit_in && (
                                            <span className="font-sans font-semibold">
                                              Encaixe
                                            </span>
                                          )}
                                        </div>
                                        {scope === 'general' && prof && (
                                          <span className="truncate text-[10px] opacity-75">
                                            {prof.name}
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Visão por Colunas de Profissionais (Dia OU Semana -> Por Profissional) */}
      {(view === 'day' ||
        (view === 'week' &&
          scope === 'general' &&
          weekLayout === 'by_professional')) && (
        <div className="space-y-3">
          {view === 'week' && (
            <div className="flex flex-wrap items-center gap-1.5">
              {weekDates.map((dStr) => {
                const { weekday, dayNum } = formatDayHeader(dStr);
                const selected = dStr === anchorDateStr;
                return (
                  <button
                    key={dStr}
                    type="button"
                    onClick={() => setAnchorDateStr(dStr)}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition ${
                      selected
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {weekday}{' '}
                    <span className="font-mono tabular-nums">{dayNum}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Seletor responsivo em telas menores (< md) para não comprimir colunas */}
          {activeColumnsProfs.length > 1 && (
            <div className="flex items-center gap-2 md:hidden">
              <label
                htmlFor="mobile-prof-select"
                className="text-xs font-semibold text-slate-600"
              >
                Agenda:
              </label>
              <select
                id="mobile-prof-select"
                value={mobileProfId}
                onChange={(e) => setMobileProfId(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800"
              >
                {activeColumnsProfs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeColumnsProfs.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              Nenhum profissional corresponde aos filtros selecionados.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="max-h-[680px] overflow-auto">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-20 bg-white">
                    <tr className="border-b border-slate-200">
                      <th className="sticky left-0 z-30 w-16 min-w-[64px] border-r border-slate-200 bg-white py-3 text-center font-mono text-[11px] font-medium text-slate-400">
                        Horário
                      </th>
                      {activeColumnsProfs.map((prof) => {
                        const profSpecs = workspace.specialties
                          .filter((s) => prof.specialty_ids.includes(s.id))
                          .map((s) => s.name);
                        const theme = getColorTheme(prof.color);
                        const hiddenOnMobile =
                          activeColumnsProfs.length > 1 &&
                          mobileProfId &&
                          prof.id !== mobileProfId;

                        return (
                          <th
                            key={prof.id}
                            className={`min-w-[200px] border-r border-slate-200 bg-white px-3 py-2.5 text-left last:border-r-0 ${
                              hiddenOnMobile ? 'hidden md:table-cell' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-3 w-3 shrink-0 rounded-xs ${theme.accent}`}
                                aria-hidden="true"
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-900">
                                  {prof.name}
                                </p>
                                <p className="truncate text-[11px] font-normal text-slate-500">
                                  {profSpecs.length > 0
                                    ? profSpecs.join(' · ')
                                    : 'Agenda independente'}
                                </p>
                              </div>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody>
                    {HOURS.map((hour) => {
                      const hourLabel = `${String(hour).padStart(2, '0')}:00`;
                      return (
                        <tr
                          key={hour}
                          className="border-b border-slate-100 last:border-b-0"
                        >
                          <td className="sticky left-0 z-10 w-16 border-r border-slate-200 bg-white px-2 py-2 text-right align-top font-mono text-xs font-medium text-slate-500 tabular-nums">
                            {hourLabel}
                          </td>

                          {activeColumnsProfs.map((prof) => {
                            const schedule = workspace.schedules.find(
                              (s) => s.professional_id === prof.id
                            );
                            const scheduleId = schedule?.id;
                            const canManage = scheduleId
                              ? workspace.permissionsBySchedule[scheduleId]
                                  ?.can_manage_appointments
                              : false;

                            const cellBlocks = getBlocksForCell(
                              anchorDateStr,
                              hour,
                              scheduleId
                            );
                            const closedByRule = isOutsideAvailability(
                              anchorDateStr,
                              hour,
                              scheduleId
                            );
                            const cellAppointments =
                              filteredAppointments.filter((appt) => {
                                if (appt.professional_id !== prof.id)
                                  return false;
                                const start = getZonedParts(
                                  appt.starts_at,
                                  timeZone
                                );
                                return (
                                  start.dateStr === anchorDateStr &&
                                  start.hour === hour
                                );
                              });

                            const hiddenOnMobile =
                              activeColumnsProfs.length > 1 &&
                              mobileProfId &&
                              prof.id !== mobileProfId;

                            return (
                              <td
                                key={prof.id}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) =>
                                  handleDropOnSlot(
                                    e,
                                    anchorDateStr,
                                    hour,
                                    scheduleId
                                  )
                                }
                                onClick={() => {
                                  if (
                                    cellBlocks.length === 0 &&
                                    canManage &&
                                    scheduleId
                                  ) {
                                    openCreateFromSlot(
                                      anchorDateStr,
                                      hour,
                                      scheduleId
                                    );
                                  }
                                }}
                                style={
                                  cellBlocks.length > 0
                                    ? HATCHED_BG_STYLE
                                    : undefined
                                }
                                className={`h-[78px] border-r border-slate-200 p-1.5 align-top transition last:border-r-0 ${
                                  hiddenOnMobile ? 'hidden md:table-cell' : ''
                                } ${
                                  cellBlocks.length > 0
                                    ? 'cursor-not-allowed'
                                    : closedByRule
                                      ? 'bg-slate-50/80 hover:bg-slate-100/80'
                                      : canManage
                                        ? 'cursor-pointer bg-white hover:bg-emerald-50/30'
                                        : 'bg-white'
                                }`}
                              >
                                {cellBlocks.length > 0 ? (
                                  <div className="flex h-full flex-col justify-center rounded-md px-2 py-1 text-slate-700">
                                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                                      <Lock
                                        className="h-3 w-3 shrink-0"
                                        aria-hidden="true"
                                      />
                                      <span className="truncate">
                                        {cellBlocks[0].title}
                                      </span>
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-600 tabular-nums">
                                      {hourLabel}–
                                      {String(hour + 1).padStart(2, '0')}:00
                                    </span>
                                  </div>
                                ) : cellAppointments.length > 0 ? (
                                  <div className="space-y-1">
                                    {cellAppointments.map((appt) => {
                                      const patient = workspace.patients.find(
                                        (pt) => pt.id === appt.patient_id
                                      );
                                      const service = workspace.services.find(
                                        (sv) => sv.id === appt.service_id
                                      );
                                      const start = getZonedParts(
                                        appt.starts_at,
                                        timeZone
                                      );
                                      const end = getZonedParts(
                                        appt.ends_at,
                                        timeZone
                                      );
                                      const styles = getCardStyles(appt);
                                      const meta =
                                        APPOINTMENT_STATUS_META[appt.status];

                                      return (
                                        <button
                                          key={appt.id}
                                          type="button"
                                          draggable={Boolean(canManage)}
                                          onDragStart={(e) => {
                                            setDraggingApptId(appt.id);
                                            e.dataTransfer.setData(
                                              'text/plain',
                                              appt.id
                                            );
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setAppointmentModalState({
                                              open: true,
                                              appointment: appt,
                                            });
                                          }}
                                          className={`flex w-full cursor-pointer flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition hover:shadow-xs ${styles.wrapper} ${
                                            appt.status === 'canceled'
                                              ? 'opacity-55 line-through'
                                              : ''
                                          }`}
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="flex items-center gap-1 truncate text-xs font-semibold">
                                              <StatusIcon
                                                status={appt.status}
                                                className="h-3.5 w-3.5 shrink-0"
                                              />
                                              <span className="truncate">
                                                {patient?.name ?? 'Paciente'}
                                              </span>
                                            </span>
                                            {appt.is_fit_in && (
                                              <span className="shrink-0 text-[10px] font-semibold">
                                                Encaixe
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center justify-between gap-2 text-[11px] opacity-85">
                                            <span className="truncate">
                                              {service?.name ?? meta.shortLabel}
                                            </span>
                                            <span className="shrink-0 font-mono text-[10px] tabular-nums">
                                              {start.timeStr}–{end.timeStr}
                                            </span>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                ) : closedByRule ? (
                                  <span className="text-[11px] text-slate-400">
                                    Indisponível
                                  </span>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Visão Mensal */}
      {view === 'month' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-600">
            {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => (
              <div
                key={d}
                className="border-r border-slate-200 py-2.5 last:border-r-0"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthGridDates.map((dStr) => {
              const inCurrentMonth =
                dStr.slice(0, 7) === anchorDateStr.slice(0, 7);
              const dayAppts = filteredAppointments.filter(
                (a) =>
                  getZonedParts(a.starts_at, timeZone).dateStr === dStr &&
                  a.status !== 'canceled'
              );
              const isToday = dStr === todayStr;

              return (
                <button
                  key={dStr}
                  type="button"
                  onClick={() => {
                    setAnchorDateStr(dStr);
                    setView('day');
                  }}
                  className={`min-h-[104px] cursor-pointer border-b border-r border-slate-200 p-2 text-left align-top transition hover:bg-slate-50 ${
                    inCurrentMonth ? 'bg-white' : 'bg-slate-50/50 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-mono text-xs font-semibold tabular-nums ${
                        isToday
                          ? 'rounded-md bg-emerald-600 px-1.5 py-0.5 text-white'
                          : ''
                      }`}
                    >
                      {Number(dStr.slice(8, 10))}
                    </span>
                    {dayAppts.length > 0 && (
                      <span className="font-mono text-[11px] font-medium text-emerald-700 tabular-nums">
                        {dayAppts.length}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {dayAppts.slice(0, 2).map((appt) => {
                      const pt = workspace.patients.find(
                        (p) => p.id === appt.patient_id
                      );
                      const start = getZonedParts(appt.starts_at, timeZone);
                      const styles = getCardStyles(appt);
                      return (
                        <div
                          key={appt.id}
                          className={`truncate rounded border px-1.5 py-0.5 text-[10px] font-medium ${styles.wrapper}`}
                        >
                          <span className="font-mono tabular-nums">
                            {start.timeStr}
                          </span>{' '}
                          {pt?.name ?? 'Paciente'}
                        </div>
                      );
                    })}
                    {dayAppts.length > 2 && (
                      <p className="text-[10px] font-medium text-slate-500">
                        +{dayAppts.length - 2} atendimentos
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Visão em Lista Cronológica */}
      {view === 'list' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {filteredAppointments.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Nenhum agendamento encontrado para os filtros aplicados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Data e horário</th>
                    <th className="px-4 py-3">Paciente</th>
                    <th className="px-4 py-3">Profissional</th>
                    <th className="px-4 py-3">Serviço</th>
                    <th className="px-4 py-3">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAppointments.map((appt) => {
                    const start = getZonedParts(appt.starts_at, timeZone);
                    const end = getZonedParts(appt.ends_at, timeZone);
                    const patient = workspace.patients.find(
                      (p) => p.id === appt.patient_id
                    );
                    const prof = workspace.professionals.find(
                      (p) => p.id === appt.professional_id
                    );
                    const service = workspace.services.find(
                      (s) => s.id === appt.service_id
                    );
                    const meta = APPOINTMENT_STATUS_META[appt.status];

                    return (
                      <tr
                        key={appt.id}
                        onClick={() =>
                          setAppointmentModalState({
                            open: true,
                            appointment: appt,
                          })
                        }
                        className="cursor-pointer transition hover:bg-slate-50"
                      >
                        <td className="px-4 py-3 font-mono text-xs text-slate-800 tabular-nums">
                          {start.dateStr.split('-').reverse().join('/')} ·{' '}
                          {start.timeStr}–{end.timeStr}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {patient?.name ?? 'Paciente'}
                          {appt.is_fit_in && (
                            <span className="ml-2 text-xs font-medium text-amber-700">
                              · Encaixe
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {prof?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {service?.name ?? 'Atendimento padrão'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${meta.bgClass} ${meta.borderClass} ${meta.textClass}`}
                          >
                            <StatusIcon status={appt.status} />
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Confirmação de Reagendamento por Drag-and-Drop */}
      {pendingReschedule && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">
              Confirmar reagendamento
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Deseja mover o atendimento de{' '}
              <span className="font-semibold text-slate-900">
                {workspace.patients.find(
                  (p) => p.id === pendingReschedule.appointment.patient_id
                )?.name ?? 'Paciente'}
              </span>{' '}
              para{' '}
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {pendingReschedule.targetDateStr.split('-').reverse().join('/')}{' '}
                às {String(pendingReschedule.targetHour).padStart(2, '0')}:00
              </span>
              ?
            </p>

            {rescheduleError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{rescheduleError}</span>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setPendingReschedule(null);
                  setRescheduleError(null);
                }}
                className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={rescheduling}
                onClick={confirmReschedule}
                className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {rescheduling ? 'Validando...' : 'Confirmar reagendamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modais */}
      {appointmentModalState.open && (
        <AppointmentModal
          timeZone={timeZone}
          appointment={appointmentModalState.appointment}
          initialScheduleId={appointmentModalState.initialScheduleId}
          initialDateStr={appointmentModalState.initialDateStr}
          initialStartTime={appointmentModalState.initialStartTime}
          initialEndTime={appointmentModalState.initialEndTime}
          professionals={workspace.professionals}
          schedules={workspace.schedules}
          specialties={workspace.specialties}
          services={workspace.services}
          patients={workspace.patients}
          auditLogs={workspace.auditLogs}
          permissionsBySchedule={workspace.permissionsBySchedule}
          onClose={() =>
            setAppointmentModalState({ open: false, appointment: null })
          }
          onSaved={loadWorkspace}
        />
      )}

      {showBlockModal && (
        <BlockModal
          timeZone={timeZone}
          isAdmin={workspace.isAdmin}
          initialDateStr={anchorDateStr}
          professionals={workspace.professionals}
          schedules={workspace.schedules}
          blocks={workspace.blocks}
          permissionsBySchedule={workspace.permissionsBySchedule}
          onClose={() => setShowBlockModal(false)}
          onSaved={loadWorkspace}
        />
      )}

      {profModalState.open && (
        <ProfessionalModal
          professional={profModalState.professional}
          units={workspace.units}
          specialties={workspace.specialties}
          onClose={() =>
            setProfModalState({ open: false, professional: null })
          }
          onSaved={loadWorkspace}
        />
      )}
    </div>
  );
}
