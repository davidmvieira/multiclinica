import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

interface RuleInput {
  day_of_week: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  is_active: boolean;
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  return null;
}

export async function PUT(req: NextRequest) {
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
  const rawRules = Array.isArray(body.rules) ? body.rules : [];

  if (!scheduleId || rawRules.length === 0) {
    return NextResponse.json(
      { error: 'Informe a agenda e as regras de disponibilidade.' },
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

  const perms = context.permissionsBySchedule[scheduleId];
  if (!perms || !perms.can_manage_availability) {
    return NextResponse.json(
      {
        error:
          'Você não possui permissão para alterar a disponibilidade desta agenda.',
      },
      { status: 403 }
    );
  }

  const validatedRules: RuleInput[] = [];
  for (const item of rawRules) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const day = Number(rec.day_of_week);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return NextResponse.json(
        { error: 'Dia da semana inválido nas regras de disponibilidade.' },
        { status: 400 }
      );
    }

    const startTime = normalizeTime(rec.start_time) ?? '08:00:00';
    const endTime = normalizeTime(rec.end_time) ?? '18:00:00';
    const breakStart = rec.break_start ? normalizeTime(rec.break_start) : null;
    const breakEnd = rec.break_end ? normalizeTime(rec.break_end) : null;
    const isActive = Boolean(rec.is_active);

    if (isActive && endTime <= startTime) {
      return NextResponse.json(
        { error: 'O horário de término deve ser posterior ao início.' },
        { status: 400 }
      );
    }

    if (
      isActive &&
      ((breakStart && !breakEnd) ||
        (!breakStart && breakEnd) ||
        (breakStart &&
          breakEnd &&
          (breakEnd <= breakStart ||
            breakStart < startTime ||
            breakEnd > endTime)))
    ) {
      return NextResponse.json(
        {
          error:
            'O intervalo deve possuir início e fim válidos dentro da jornada.',
        },
        { status: 400 }
      );
    }

    validatedRules.push({
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
      break_start: breakStart,
      break_end: breakEnd,
      is_active: isActive,
    });
  }

  const upsertPayload = validatedRules.map((rule) => ({
    organization_id: context.organization.id,
    schedule_id: scheduleId,
    day_of_week: rule.day_of_week,
    start_time: rule.start_time,
    end_time: rule.end_time,
    break_start: rule.break_start,
    break_end: rule.break_end,
    is_active: rule.is_active,
  }));

  const { data: savedRules, error } = await supabase
    .from('availability_rules')
    .upsert(upsertPayload, { onConflict: 'schedule_id,day_of_week' })
    .select(
      'id, organization_id, schedule_id, day_of_week, start_time, end_time, break_start, break_end, is_active'
    );

  if (error) {
    return NextResponse.json(
      { error: 'Não foi possível atualizar a disponibilidade.' },
      { status: 502 }
    );
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    schedule_id: scheduleId,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'update_availability',
    new_values: {
      active_days: validatedRules
        .filter((r) => r.is_active)
        .map((r) => r.day_of_week),
    },
  });

  const response = NextResponse.json({ rules: savedRules ?? [] });
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
