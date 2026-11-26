import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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
    typeof body.scheduleId === 'string' && body.scheduleId.trim()
      ? body.scheduleId.trim()
      : null;
  const unitId =
    typeof body.unitId === 'string' && body.unitId.trim()
      ? body.unitId.trim()
      : null;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const reason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 250)
      : null;
  const startsAt =
    typeof body.startsAt === 'string' ? body.startsAt.trim() : '';
  const endsAt = typeof body.endsAt === 'string' ? body.endsAt.trim() : '';
  const isRecurring = Boolean(body.isRecurring);

  if (!title || title.length > 100) {
    return NextResponse.json(
      { error: 'Informe um título para o bloqueio (até 100 caracteres).' },
      { status: 400 }
    );
  }

  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return NextResponse.json(
      { error: 'O término do bloqueio deve ser posterior ao início.' },
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

  if (scheduleId === null) {
    if (!context.isAdmin) {
      return NextResponse.json(
        {
          error:
            'Apenas administradores podem criar bloqueios globais da clínica ou unidade.',
        },
        { status: 403 }
      );
    }
  } else {
    const perms = context.permissionsBySchedule[scheduleId];
    if (!perms || !perms.can_manage_blocks) {
      return NextResponse.json(
        { error: 'Você não possui permissão para bloquear esta agenda.' },
        { status: 403 }
      );
    }
  }

  const { data: block, error } = await supabase
    .from('schedule_blocks')
    .insert({
      organization_id: context.organization.id,
      unit_id: unitId,
      schedule_id: scheduleId,
      title,
      reason,
      starts_at: new Date(startMs).toISOString(),
      ends_at: new Date(endMs).toISOString(),
      is_recurring: isRecurring,
      created_by: session.user.id,
    })
    .select(
      'id, organization_id, unit_id, schedule_id, title, reason, starts_at, ends_at, is_recurring'
    )
    .single();

  if (error || !block) {
    return NextResponse.json(
      { error: 'Não foi possível criar o bloqueio.' },
      { status: 502 }
    );
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    schedule_id: scheduleId,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'create_block',
    new_values: {
      title: block.title,
      starts_at: block.starts_at,
      ends_at: block.ends_at,
      scope: scheduleId ? 'schedule' : 'organization',
    },
  });

  const response = NextResponse.json({ block }, { status: 201 });
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

export async function DELETE(req: NextRequest) {
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

  const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
  if (!id) {
    return NextResponse.json(
      { error: 'Identificador do bloqueio ausente.' },
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

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('id, organization_id, schedule_id, title, starts_at, ends_at')
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .maybeSingle();

  if (!block) {
    return NextResponse.json(
      { error: 'Bloqueio não encontrado.' },
      { status: 404 }
    );
  }

  if (block.schedule_id === null) {
    if (!context.isAdmin) {
      return NextResponse.json(
        {
          error:
            'Apenas administradores podem remover bloqueios globais da clínica.',
        },
        { status: 403 }
      );
    }
  } else {
    const perms = context.permissionsBySchedule[block.schedule_id];
    if (!perms || !perms.can_manage_blocks) {
      return NextResponse.json(
        {
          error:
            'Você não possui permissão para remover bloqueios desta agenda.',
        },
        { status: 403 }
      );
    }
  }

  const { error } = await supabase
    .from('schedule_blocks')
    .delete()
    .eq('organization_id', context.organization.id)
    .eq('id', block.id);

  if (error) {
    return NextResponse.json(
      { error: 'Não foi possível remover o bloqueio.' },
      { status: 502 }
    );
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    schedule_id: block.schedule_id,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'delete_block',
    previous_values: {
      title: block.title,
      starts_at: block.starts_at,
      ends_at: block.ends_at,
    },
  });

  const response = NextResponse.json({ ok: true });
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
