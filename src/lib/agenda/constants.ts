import type { AppointmentStatus, MemberRole } from '@/types/agenda';

export const APPOINTMENT_STATUS_LIST: readonly AppointmentStatus[] = [
  'pending',
  'awaiting_confirmation',
  'confirmed',
  'awaiting_service',
  'in_service',
  'completed',
  'canceled',
  'no_show',
] as const;

export const APPOINTMENT_STATUS_META: Record<
  AppointmentStatus,
  {
    label: string;
    shortLabel: string;
    bgClass: string;
    borderClass: string;
    textClass: string;
  }
> = {
  pending: {
    label: 'Pendente',
    shortLabel: 'Pendente',
    bgClass: 'bg-slate-50',
    borderClass: 'border-slate-300',
    textClass: 'text-slate-700',
  },
  awaiting_confirmation: {
    label: 'Aguardando confirmação',
    shortLabel: 'Aguard. conf.',
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-200',
    textClass: 'text-amber-900',
  },
  confirmed: {
    label: 'Confirmado',
    shortLabel: 'Confirmado',
    bgClass: 'bg-emerald-50',
    borderClass: 'border-emerald-200',
    textClass: 'text-emerald-900',
  },
  awaiting_service: {
    label: 'Aguardando atendimento',
    shortLabel: 'Na recepção',
    bgClass: 'bg-sky-50',
    borderClass: 'border-sky-200',
    textClass: 'text-sky-900',
  },
  in_service: {
    label: 'Em atendimento',
    shortLabel: 'Atendendo',
    bgClass: 'bg-indigo-50',
    borderClass: 'border-indigo-200',
    textClass: 'text-indigo-900',
  },
  completed: {
    label: 'Realizado',
    shortLabel: 'Realizado',
    bgClass: 'bg-emerald-50/70',
    borderClass: 'border-emerald-300',
    textClass: 'text-emerald-950',
  },
  canceled: {
    label: 'Cancelado',
    shortLabel: 'Cancelado',
    bgClass: 'bg-red-50/70',
    borderClass: 'border-red-200',
    textClass: 'text-red-800',
  },
  no_show: {
    label: 'Não compareceu',
    shortLabel: 'Falta',
    bgClass: 'bg-rose-50/80',
    borderClass: 'border-rose-200',
    textClass: 'text-rose-900',
  },
};

export const ROLE_LABELS: Record<MemberRole, string> = {
  admin: 'Administrador da clínica',
  unit_manager: 'Gestor da unidade',
  reception: 'Recepção',
  professional: 'Profissional',
  delegated_manager: 'Gestor delegado',
};

export const PROFESSIONAL_COLORS = [
  { hex: '#059669', name: 'Esmeralda', bg: 'bg-emerald-50', border: 'border-emerald-200', accent: 'bg-emerald-600', text: 'text-emerald-950' },
  { hex: '#0284C7', name: 'Azul clínico', bg: 'bg-sky-50', border: 'border-sky-200', accent: 'bg-sky-600', text: 'text-sky-950' },
  { hex: '#7C3AED', name: 'Violeta', bg: 'bg-violet-50', border: 'border-violet-200', accent: 'bg-violet-600', text: 'text-violet-950' },
  { hex: '#D97706', name: 'Âmbar', bg: 'bg-amber-50', border: 'border-amber-200', accent: 'bg-amber-600', text: 'text-amber-950' },
  { hex: '#0D9488', name: 'Teal', bg: 'bg-teal-50', border: 'border-teal-200', accent: 'bg-teal-600', text: 'text-teal-950' },
  { hex: '#E11D48', name: 'Carmim', bg: 'bg-rose-50', border: 'border-rose-200', accent: 'bg-rose-600', text: 'text-rose-950' },
] as const;

export const DAY_NAMES_PT = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

export const DEFAULT_SPECIALTIES = [
  { name: 'Fisioterapia', color: '#059669', service: 'Sessão de Fisioterapia', duration: 60 },
  { name: 'Nutrição', color: '#0284C7', service: 'Consulta Nutricional', duration: 60 },
  { name: 'Estética', color: '#D97706', service: 'Procedimento Estético', duration: 60 },
  { name: 'Psicologia', color: '#7C3AED', service: 'Sessão de Psicoterapia', duration: 50 },
] as const;

export function getColorTheme(hex: string) {
  return (
    PROFESSIONAL_COLORS.find(
      (c) => c.hex.toLowerCase() === hex.toLowerCase()
    ) ?? PROFESSIONAL_COLORS[0]
  );
}

export function isValidAppointmentStatus(
  value: unknown
): value is AppointmentStatus {
  return (
    typeof value === 'string' &&
    (APPOINTMENT_STATUS_LIST as readonly string[]).includes(value)
  );
}

export function getZonedParts(
  dateInput: Date | string,
  timeZone = 'America/Sao_Paulo'
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
  dateStr: string;
  timeStr: string;
} {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour === '24' ? '0' : map.hour);
  const minute = Number(map.minute);

  return {
    year,
    month,
    day,
    hour,
    minute,
    dayOfWeek: weekdayMap[map.weekday] ?? date.getDay(),
    dateStr: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timeStr: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

export function buildZonedIso(
  dateStr: string,
  timeStr: string,
  timeZone = 'America/Sao_Paulo'
): string {
  // Construct a reference UTC timestamp and adjust by timezone offset
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const utcGuess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));

  const zoned = getZonedParts(utcGuess, timeZone);
  const zonedAsUtc = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    0
  );
  const diffMs = zonedAsUtc - utcGuess.getTime();
  return new Date(utcGuess.getTime() - diffMs).toISOString();
}
