import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const VALID_TIMEZONES = new Set([
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Cuiaba',
  'America/Rio_Branco',
  'America/Noronha',
]);

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

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const address =
    typeof body.address === 'string' ? body.address.trim().slice(0, 240) : '';
  const phone =
    typeof body.phone === 'string' ? body.phone.trim().slice(0, 40) : '';
  const timezone =
    typeof body.timezone === 'string' && VALID_TIMEZONES.has(body.timezone)
      ? body.timezone
      : 'America/Sao_Paulo';
  const isActive = typeof body.isActive === 'boolean' ? body.isActive : true;

  if (!name || name.length < 2 || name.length > 120) {
    return NextResponse.json(
      { error: 'Informe o nome da unidade (2 a 120 caracteres).' },
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

  if (!context || !context.isAdmin) {
    return NextResponse.json(
      { error: 'Apenas administradores podem cadastrar unidades.' },
      { status: 403 }
    );
  }

  const isTopAdmin =
    context.organization.owner_user_id === session.user.id ||
    context.role === 'admin';
  if (!isTopAdmin) {
    return NextResponse.json(
      { error: 'Apenas o administrador da clínica pode criar novas unidades.' },
      { status: 403 }
    );
  }

  const baseInsert = {
    organization_id: context.organization.id,
    name,
    address: address || null,
    timezone,
    is_active: isActive,
  };

  let { data: unit, error } = await supabase
    .from('units')
    .insert({
      ...baseInsert,
      ...(phone ? { phone } : {}),
    })
    .select(
      'id, organization_id, name, address, phone, timezone, is_active, created_at'
    )
    .single();

  if (error && error.code === '42703') {
    const fallback = await supabase
      .from('units')
      .insert(baseInsert)
      .select('id, organization_id, name, address, timezone, is_active, created_at')
      .single();
    unit = fallback.data ? { ...fallback.data, phone: null } : null;
    error = fallback.error;
  }

  if (error || !unit) {
    return NextResponse.json(
      { error: 'Não foi possível cadastrar a unidade.' },
      { status: 502 }
    );
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'create_unit',
    new_values: { unit_id: unit.id, name },
  });

  const response = NextResponse.json({ unit }, { status: 201 });
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
      { error: 'Identificador da unidade ausente.' },
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

  if (!context || !context.isAdmin) {
    return NextResponse.json(
      { error: 'Apenas administradores podem editar unidades.' },
      { status: 403 }
    );
  }

  const isTopAdmin =
    context.organization.owner_user_id === session.user.id ||
    context.role === 'admin';
  if (!isTopAdmin && context.unitId && context.unitId !== id) {
    return NextResponse.json(
      { error: 'Você só pode editar a unidade atribuída ao seu perfil.' },
      { status: 403 }
    );
  }

  const { data: existing } = await supabase
    .from('units')
    .select('id, organization_id, name, address, timezone, is_active')
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: 'Unidade não encontrada.' },
      { status: 404 }
    );
  }

  const nextName =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : existing.name;
  const nextAddress =
    body.address === null
      ? null
      : typeof body.address === 'string'
        ? body.address.trim().slice(0, 240) || null
        : existing.address;
  const nextTimezone =
    typeof body.timezone === 'string' && VALID_TIMEZONES.has(body.timezone)
      ? body.timezone
      : existing.timezone;
  const nextActive =
    typeof body.isActive === 'boolean' ? body.isActive : existing.is_active;

  const baseUpdate = {
    name: nextName,
    address: nextAddress,
    timezone: nextTimezone,
    is_active: nextActive,
  };

  const extendedUpdate: Record<string, unknown> = {
    ...baseUpdate,
    ...(typeof body.phone === 'string'
      ? { phone: body.phone.trim().slice(0, 40) || null }
      : {}),
  };

  let { data: updated, error } = await supabase
    .from('units')
    .update(extendedUpdate)
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .select(
      'id, organization_id, name, address, phone, timezone, is_active, created_at'
    )
    .single();

  if (error && error.code === '42703') {
    const fallback = await supabase
      .from('units')
      .update(baseUpdate)
      .eq('organization_id', context.organization.id)
      .eq('id', id)
      .select('id, organization_id, name, address, timezone, is_active, created_at')
      .single();
    updated = fallback.data ? { ...fallback.data, phone: null } : null;
    error = fallback.error;
  }

  if (error || !updated) {
    return NextResponse.json(
      { error: 'Não foi possível atualizar a unidade.' },
      { status: 502 }
    );
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'update_unit',
    previous_values: { name: existing.name, is_active: existing.is_active },
    new_values: { name: nextName, is_active: nextActive },
  });

  const response = NextResponse.json({ unit: updated });
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
      { error: 'Identificador da unidade ausente.' },
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

  if (!context || !context.isAdmin) {
    return NextResponse.json(
      { error: 'Apenas administradores podem excluir unidades.' },
      { status: 403 }
    );
  }

  const isTopAdmin =
    context.organization.owner_user_id === session.user.id ||
    context.role === 'admin';
  if (!isTopAdmin) {
    return NextResponse.json(
      { error: 'Apenas o administrador da clínica pode excluir unidades.' },
      { status: 403 }
    );
  }

  const { count: totalUnits } = await supabase
    .from('units')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', context.organization.id);

  if ((totalUnits ?? 0) <= 1) {
    return NextResponse.json(
      {
        error:
          'A clínica precisa manter pelo menos uma unidade cadastrada. Edite ou desative se necessário.',
      },
      { status: 400 }
    );
  }

  const [{ count: profCount }, { count: apptCount }] = await Promise.all([
    supabase
      .from('professionals')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', context.organization.id)
      .eq('unit_id', id),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', context.organization.id)
      .eq('unit_id', id),
  ]);

  if ((profCount ?? 0) > 0 || (apptCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          'Esta unidade possui profissionais ou agendamentos vinculados. Desative a unidade em vez de excluí-la.',
      },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from('units')
    .delete()
    .eq('organization_id', context.organization.id)
    .eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Não foi possível excluir a unidade.' },
      { status: 502 }
    );
  }

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
