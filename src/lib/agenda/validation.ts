import { getZonedParts } from '@/lib/agenda/constants';
import type {
  AgendaAppointment,
  AgendaAvailabilityRule,
  AgendaBlock,
  AgendaSchedule,
} from '@/types/agenda';

export interface AppointmentValidationResult {
  valid: boolean;
  error?: string;
  code?: 'INVALID_RANGE' | 'BLOCKED' | 'OUTSIDE_AVAILABILITY' | 'CONFLICT';
}

function toMinutes(hhmmss: string): number {
  const [h, m] = hhmmss.split(':').map(Number);
  return h * 60 + m;
}

export function validateAppointmentWindow(params: {
  startsAtIso: string;
  endsAtIso: string;
  schedule: AgendaSchedule;
  availabilityRules: AgendaAvailabilityRule[];
  blocks: AgendaBlock[];
  existingAppointments: AgendaAppointment[];
  excludeAppointmentId?: string;
  isFitIn?: boolean;
  timeZone?: string;
}): AppointmentValidationResult {
  const {
    startsAtIso,
    endsAtIso,
    schedule,
    availabilityRules,
    blocks,
    existingAppointments,
    excludeAppointmentId,
    isFitIn = false,
    timeZone = 'America/Sao_Paulo',
  } = params;

  const startMs = Date.parse(startsAtIso);
  const endMs = Date.parse(endsAtIso);

  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return {
      valid: false,
      code: 'INVALID_RANGE',
      error: 'O horário de término deve ser posterior ao horário de início.',
    };
  }

  // 1. Verificar bloqueios da agenda ou bloqueios globais da clínica/unidade
  for (const block of blocks) {
    const appliesToSchedule =
      block.schedule_id === null
        ? block.unit_id === null || block.unit_id === schedule.unit_id
        : block.schedule_id === schedule.id;

    if (!appliesToSchedule) continue;

    const bStart = Date.parse(block.starts_at);
    const bEnd = Date.parse(block.ends_at);
    if (startMs < bEnd && endMs > bStart) {
      return {
        valid: false,
        code: 'BLOCKED',
        error: `Horário indisponível devido ao bloqueio "${block.title}".`,
      };
    }
  }

  // 2. Verificar regra de disponibilidade do profissional para o dia da semana
  const zonedStart = getZonedParts(new Date(startMs), timeZone);
  const zonedEnd = getZonedParts(new Date(endMs), timeZone);

  if (!isFitIn && availabilityRules.length > 0) {
    const rule = availabilityRules.find(
      (r) => r.schedule_id === schedule.id && r.day_of_week === zonedStart.dayOfWeek
    );

    if (!rule || !rule.is_active) {
      return {
        valid: false,
        code: 'OUTSIDE_AVAILABILITY',
        error:
          'O profissional não possui disponibilidade configurada para este dia da semana. Use "Encaixe" caso tenha autorização.',
      };
    }

    if (zonedStart.dateStr !== zonedEnd.dateStr) {
      return {
        valid: false,
        code: 'OUTSIDE_AVAILABILITY',
        error: 'O agendamento deve iniciar e terminar no mesmo dia.',
      };
    }

    const startMin = zonedStart.hour * 60 + zonedStart.minute;
    const endMin = zonedEnd.hour * 60 + zonedEnd.minute;
    const ruleStart = toMinutes(rule.start_time);
    const ruleEnd = toMinutes(rule.end_time);

    if (startMin < ruleStart || endMin > ruleEnd) {
      return {
        valid: false,
        code: 'OUTSIDE_AVAILABILITY',
        error: `Fora da jornada configurada (${rule.start_time.slice(0, 5)}–${rule.end_time.slice(0, 5)}). Marque como encaixe se permitido.`,
      };
    }

    if (rule.break_start && rule.break_end) {
      const breakStart = toMinutes(rule.break_start);
      const breakEnd = toMinutes(rule.break_end);
      if (startMin < breakEnd && endMin > breakStart) {
        return {
          valid: false,
          code: 'OUTSIDE_AVAILABILITY',
          error: `Horário coincide com o intervalo (${rule.break_start.slice(0, 5)}–${rule.break_end.slice(0, 5)}).`,
        };
      }
    }
  }

  // 3. Verificar conflito de horário com outros agendamentos ativos do profissional
  if (!schedule.allow_overbooking && !isFitIn) {
    for (const appt of existingAppointments) {
      if (excludeAppointmentId && appt.id === excludeAppointmentId) continue;
      if (appt.schedule_id !== schedule.id) continue;
      if (appt.status === 'canceled' || appt.status === 'no_show') continue;

      const aStart = Date.parse(appt.starts_at);
      const aEnd = Date.parse(appt.ends_at);
      if (startMs < aEnd && endMs > aStart) {
        return {
          valid: false,
          code: 'CONFLICT',
          error:
            'Já existe outro agendamento neste intervalo para este profissional.',
        };
      }
    }
  }

  return { valid: true };
}
