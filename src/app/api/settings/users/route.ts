import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import { getPlanBySlug, isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from '@/lib/supabase/server';
import type { MemberRole } from '@/types/agenda';

const VALID_ROLES: readonly MemberRole[] = [
  'admin',
  'unit_manager',
  'reception',
  'professional',
  'delegated_manager',
] as const;

function isValidRole(value: unknown): value is MemberRole {
  return (
    typeof value === 'string' &&
    (VALID_ROLES as readonly string[]).includes(value)
  );
}

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

  const displayName =
    typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const phone =
    typeof body.phone === 'string' ? body.phone.trim().slice(0, 40) : '';
  const role: MemberRole = isValidRole(body.role) ? body.role : 'reception';
  const unitId =
    typeof body.unitId === 'string' && body.unitId.trim()
      ? body.unitId.trim()
      : null;

  const createProfessional = Boolean(body.createProfessional);
  const color =
    typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : '#059669';
  const specialtyIds = Array.isArray(body.specialtyIds)
    ? body.specialtyIds.filter((s): s is string => typeof s === 'string')
    : [];
  const slotDuration =
    typeof body.slotDurationMinutes === 'number' &&
    body.slotDurationMinutes >= 10 &&
    body.slotDurationMinutes <= 240
      ? Math.round(body.slotDurationMinutes)
      : 60;

  if (!displayName || displayName.length < 2 || displayName.length > 120) {
    return NextResponse.json(
      { error: 'Informe o nome completo do usuário (2 a 120 caracteres).' },
      { status: 400 }
    );
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Informe um endereço de e-mail válido.' },
      { status: 400 }
    );
  }

  if (password && (password.length < 6 || password.length > 128)) {
    return NextResponse.json(
      { error: 'A senha inicial deve ter entre 6 e 128 caracteres.' },
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
      { error: 'Apenas administradores podem cadastrar novos usuários.' },
      { status: 403 }
    );
  }

  const isOrgTopAdmin =
    context.organization.owner_user_id === session.user.id ||
    context.role === 'admin';

  if (!isOrgTopAdmin && role === 'admin') {
    return NextResponse.json(
      {
        error:
          'Apenas o administrador principal pode conceder o perfil Administrador da clínica.',
      },
      { status: 403 }
    );
  }

  if (!isOrgTopAdmin && context.unitId && unitId && unitId !== context.unitId) {
    return NextResponse.json(
      {
        error:
          'Gestores de unidade só podem cadastrar usuários na própria unidade.',
      },
      { status: 403 }
    );
  }

  const effectiveUnitId = !isOrgTopAdmin && context.unitId ? context.unitId : unitId;

  if (effectiveUnitId) {
    const { data: unitRow } = await supabase
      .from('units')
      .select('id')
      .eq('organization_id', context.organization.id)
      .eq('id', effectiveUnitId)
      .maybeSingle();

    if (!unitRow) {
      return NextResponse.json(
        { error: 'Unidade selecionada não encontrada nesta clínica.' },
        { status: 400 }
      );
    }
  }

  // Check duplicate email inside organization_members
  const { data: existingMembers } = await supabase
    .from('organization_members')
    .select('id, email')
    .eq('organization_id', context.organization.id);

  if (
    (existingMembers ?? []).some(
      (m) => (m.email ?? '').trim().toLowerCase() === email
    )
  ) {
    return NextResponse.json(
      { error: 'Já existe um usuário cadastrado com este e-mail na clínica.' },
      { status: 409 }
    );
  }

  // Check plan limit upfront if createProfessional is requested
  if (createProfessional) {
    let planSlug = isValidPlanSlug(session.user.plan_slug)
      ? session.user.plan_slug
      : 'free';
    const { data: subRow } = await supabase
      .from('subscriptions')
      .select('plan_slug')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (subRow && isValidPlanSlug(subRow.plan_slug)) {
      planSlug = subRow.plan_slug;
    }
    const planDef = getPlanBySlug(planSlug);

    if (planDef.max_professionals !== null) {
      const { count } = await supabase
        .from('professionals')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', context.organization.id)
        .eq('is_active', true);

      if ((count ?? 0) >= planDef.max_professionals) {
        return NextResponse.json(
          {
            error: `Seu plano ${planDef.name} permite até ${planDef.max_professionals} ${
              planDef.max_professionals === 1 ? 'profissional' : 'profissionais'
            }. Desmarque "Criar agenda profissional" ou atualize o plano.`,
            code: 'PLAN_LIMIT_REACHED',
          },
          { status: 403 }
        );
      }
    }
  }

  // Step 1: Create or resolve Supabase Auth user
  let resolvedUserId: string | null = null;
  let authCreated = false;
  let requiresEmailConfirmation = false;

  const adminClient = createSupabaseAdminClient();
  if (adminClient) {
    if (password) {
      const { data: createdAuth, error: adminErr } =
        await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: displayName,
            organization_id: context.organization.id,
            role,
          },
        });

      if (!adminErr && createdAuth.user) {
        resolvedUserId = createdAuth.user.id;
        authCreated = true;
      } else {
        const msg = (adminErr?.message ?? '').toLowerCase();
        if (msg.includes('already') || msg.includes('exists')) {
          const { data: listData } = await adminClient.auth.admin.listUsers({
            page: 1,
            perPage: 1000,
          });
          const matched = listData?.users?.find(
            (u) => (u.email ?? '').toLowerCase() === email
          );
          if (matched) {
            resolvedUserId = matched.id;
          }
        } else if (adminErr) {
          return NextResponse.json(
            {
              error:
                adminErr.message ||
                'Não foi possível criar a conta de acesso no Supabase Auth.',
            },
            { status: 400 }
          );
        }
      }
    } else {
      const { data: listData } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      const matched = listData?.users?.find(
        (u) => (u.email ?? '').toLowerCase() === email
      );
      if (matched) {
        resolvedUserId = matched.id;
      }
    }
  } else if (password) {
    // Isolated server client (persistSession: false) so admin cookies stay untouched
    const anonClient = createSupabaseServerClient();
    const { data: signUpData, error: signUpErr } = await anonClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: displayName,
          organization_id: context.organization.id,
          role,
        },
      },
    });

    if (!signUpErr && signUpData.user) {
      // Supabase returns empty identities array when email already exists with obfuscation enabled
      if (
        Array.isArray(signUpData.user.identities) &&
        signUpData.user.identities.length > 0
      ) {
        resolvedUserId = signUpData.user.id;
        authCreated = true;
        requiresEmailConfirmation = !signUpData.session;
      }
    } else if (signUpErr) {
      const code = (signUpErr as { code?: string }).code ?? '';
      const rawMsg = (signUpErr.message ?? '').toLowerCase();
      if (code === 'over_email_send_rate_limit' || rawMsg.includes('rate limit')) {
        return NextResponse.json(
          {
            error:
              'Limite de envio de e-mails do Supabase Auth atingido. Cadastre sem senha (pré-cadastro) ou configure SUPABASE_SERVICE_ROLE_KEY no servidor.',
          },
          { status: 429 }
        );
      }
      if (
        code !== 'user_already_exists' &&
        !rawMsg.includes('already registered') &&
        !rawMsg.includes('already exists')
      ) {
        return NextResponse.json(
          { error: signUpErr.message || 'Erro ao criar login para o usuário.' },
          { status: 400 }
        );
      }
    }
  }

  // Step 2: Insert organization_members row
  const baseMemberInsert = {
    organization_id: context.organization.id,
    user_id: resolvedUserId,
    unit_id: effectiveUnitId,
    role,
    display_name: displayName,
    email,
  };

  const extendedMemberInsert = {
    ...baseMemberInsert,
    ...(phone ? { phone } : {}),
    is_active: true,
    invite_status: resolvedUserId ? 'active' : 'pending',
  };

  let { data: member, error: memberError } = await supabase
    .from('organization_members')
    .insert(extendedMemberInsert)
    .select(
      'id, organization_id, user_id, unit_id, role, display_name, email, phone, is_active, invite_status, created_at'
    )
    .single();

  if (memberError && memberError.code === '42703') {
    const fallback = await supabase
      .from('organization_members')
      .insert(baseMemberInsert)
      .select(
        'id, organization_id, user_id, unit_id, role, display_name, email, created_at'
      )
      .single();

    member = fallback.data
      ? {
          ...fallback.data,
          phone: null,
          is_active: true,
          invite_status: resolvedUserId ? 'active' : 'pending',
        }
      : null;
    memberError = fallback.error;
  }

  if (memberError) {
    if (memberError.code === '23502' && !resolvedUserId) {
      return NextResponse.json(
        {
          error:
            'Este e-mail já existe ou aguarda conta, e a tabela organization_members exige user_id. Execute a Seção 5 do sql.md ou informe uma senha para um novo e-mail.',
          code: 'SETTINGS_MIGRATION_REQUIRED',
        },
        { status: 409 }
      );
    }
    if (memberError.code === '23505') {
      return NextResponse.json(
        { error: 'Este usuário já está vinculado a esta clínica.' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error: `Não foi possível cadastrar o usuário (${memberError.message ?? memberError.code}).`,
      },
      { status: 502 }
    );
  }

  // Step 3: Resolve link and confirm e-mail without SMTP when created via signUp
  if (!resolvedUserId || requiresEmailConfirmation) {
    try {
      const { data: confirmed } = await supabase.rpc(
        'confirm_org_member_auth_user',
        {
          target_org_id: context.organization.id,
          member_email: email,
        }
      );
      if (confirmed === true) {
        requiresEmailConfirmation = false;
      } else if (!resolvedUserId) {
        await supabase.rpc('link_auth_user_to_org_member', {
          target_org_id: context.organization.id,
          member_email: email,
        });
      }

      if (member) {
        const { data: refreshedMember } = await supabase
          .from('organization_members')
          .select(
            'id, organization_id, user_id, unit_id, role, display_name, email, phone, is_active, invite_status, created_at'
          )
          .eq('id', member.id)
          .maybeSingle();
        if (refreshedMember) {
          member = refreshedMember;
          resolvedUserId = refreshedMember.user_id;
        }
      }
    } catch {
      // Non-blocking if Section 5/6 SQL is not yet applied
    }
  }

  // Step 4: Optionally create professional profile + independent schedule
  let createdProfessionalId: string | null = null;
  if (createProfessional) {
    const { data: prof } = await supabase
      .from('professionals')
      .insert({
        organization_id: context.organization.id,
        unit_id: effectiveUnitId,
        user_id: resolvedUserId,
        name: displayName,
        email,
        color,
        is_active: true,
      })
      .select('id')
      .single();

    if (prof) {
      createdProfessionalId = prof.id;
      if (effectiveUnitId) {
        try {
          await supabase.from('professional_units').insert({
            professional_id: prof.id,
            unit_id: effectiveUnitId,
          });
        } catch {
          // Non-blocking if professional_units table does not exist yet
        }
      }
      if (specialtyIds.length > 0) {
        await supabase.from('professional_specialties').insert(
          specialtyIds.map((specialty_id) => ({
            professional_id: prof.id,
            specialty_id,
          }))
        );
      }

      const { data: sched } = await supabase
        .from('schedules')
        .insert({
          organization_id: context.organization.id,
          unit_id: effectiveUnitId,
          professional_id: prof.id,
          name: `Agenda — ${displayName}`,
          slot_duration_minutes: slotDuration,
          is_active: true,
        })
        .select('id')
        .single();

      if (sched) {
        await supabase.from('availability_rules').insert(
          [1, 2, 3, 4, 5].map((day_of_week) => ({
            organization_id: context.organization.id,
            schedule_id: sched.id,
            day_of_week,
            start_time: '08:00:00',
            end_time: '18:00:00',
            break_start: '12:00:00',
            break_end: '13:00:00',
            is_active: true,
          }))
        );
      }
    }
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'create_org_member',
    new_values: {
      member_email: email,
      role,
      unit_id: effectiveUnitId,
      created_professional_id: createdProfessionalId,
    },
  });

  let notice = `${displayName} foi adicionado à clínica.`;
  if (authCreated && !requiresEmailConfirmation) {
    notice = `${displayName} foi cadastrado com conta de acesso ativa.`;
  } else if (authCreated && requiresEmailConfirmation) {
    notice = `${displayName} foi cadastrado. O usuário deve confirmar o e-mail enviado pelo Supabase para acessar.`;
  } else if (!resolvedUserId) {
    notice = `${displayName} foi pré-cadastrado na equipe. Quando criar conta ou entrar com ${email}, o vínculo será ativado automaticamente.`;
  }

  const response = NextResponse.json(
    {
      member,
      notice,
      createdProfessionalId,
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
      { error: 'Identificador do usuário ausente.' },
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
      { error: 'Apenas administradores podem editar usuários.' },
      { status: 403 }
    );
  }

  const { data: existing } = await supabase
    .from('organization_members')
    .select('id, organization_id, user_id, unit_id, role, display_name, email')
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: 'Usuário não encontrado na clínica.' },
      { status: 404 }
    );
  }

  const isTopAdmin =
    context.organization.owner_user_id === session.user.id ||
    context.role === 'admin';
  const targetIsOwner =
    Boolean(existing.user_id) &&
    existing.user_id === context.organization.owner_user_id;

  if (!isTopAdmin && existing.role === 'admin') {
    return NextResponse.json(
      { error: 'Apenas o administrador principal pode alterar outro administrador.' },
      { status: 403 }
    );
  }

  const nextRole = isValidRole(body.role) ? body.role : (existing.role as MemberRole);
  if (targetIsOwner && nextRole !== 'admin') {
    return NextResponse.json(
      { error: 'O proprietário da clínica deve manter o perfil Administrador.' },
      { status: 400 }
    );
  }

  if (!isTopAdmin && nextRole === 'admin') {
    return NextResponse.json(
      { error: 'Apenas o administrador principal pode atribuir o perfil Administrador.' },
      { status: 403 }
    );
  }

  if (
    typeof body.isActive === 'boolean' &&
    !body.isActive &&
    (targetIsOwner || existing.user_id === session.user.id)
  ) {
    return NextResponse.json(
      { error: 'Não é possível desativar o proprietário ou sua própria conta ativa.' },
      { status: 400 }
    );
  }

  const nextDisplayName =
    typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim().slice(0, 120)
      : existing.display_name;
  const nextUnitId =
    body.unitId === null
      ? null
      : typeof body.unitId === 'string'
        ? body.unitId.trim() || null
        : existing.unit_id;

  if (nextUnitId) {
    const { data: unitRow } = await supabase
      .from('units')
      .select('id')
      .eq('organization_id', context.organization.id)
      .eq('id', nextUnitId)
      .maybeSingle();

    if (!unitRow) {
      return NextResponse.json(
        { error: 'A unidade selecionada não pertence a esta clínica.' },
        { status: 400 }
      );
    }
  }

  const baseUpdate = {
    display_name: nextDisplayName,
    role: nextRole,
    unit_id: nextUnitId,
  };

  const extendedUpdate: Record<string, unknown> = {
    ...baseUpdate,
    ...(typeof body.phone === 'string'
      ? { phone: body.phone.trim().slice(0, 40) || null }
      : {}),
    ...(typeof body.isActive === 'boolean'
      ? {
          is_active: body.isActive,
          invite_status: body.isActive
            ? existing.user_id
              ? 'active'
              : 'pending'
            : 'inactive',
        }
      : {}),
  };

  let { data: updated, error } = await supabase
    .from('organization_members')
    .update(extendedUpdate)
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .select(
      'id, organization_id, user_id, unit_id, role, display_name, email, phone, is_active, invite_status, created_at'
    )
    .single();

  if (error && error.code === '42703') {
    const fallback = await supabase
      .from('organization_members')
      .update(baseUpdate)
      .eq('organization_id', context.organization.id)
      .eq('id', id)
      .select(
        'id, organization_id, user_id, unit_id, role, display_name, email, created_at'
      )
      .single();
    updated = fallback.data
      ? {
          ...fallback.data,
          phone: null,
          is_active: true,
          invite_status: existing.user_id ? 'active' : 'pending',
        }
      : null;
    error = fallback.error;
  }

  if (error || !updated) {
    return NextResponse.json(
      { error: 'Não foi possível atualizar os dados do usuário.' },
      { status: 502 }
    );
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'update_org_member',
    previous_values: { role: existing.role, unit_id: existing.unit_id },
    new_values: { role: nextRole, unit_id: nextUnitId },
  });

  const response = NextResponse.json({ member: updated });
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
      { error: 'Identificador do usuário ausente.' },
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
      { error: 'Apenas administradores podem remover usuários.' },
      { status: 403 }
    );
  }

  const { data: existing } = await supabase
    .from('organization_members')
    .select('id, user_id, email, role')
    .eq('organization_id', context.organization.id)
    .eq('id', id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: 'Usuário não encontrado.' },
      { status: 404 }
    );
  }

  if (existing.user_id === context.organization.owner_user_id) {
    return NextResponse.json(
      { error: 'O proprietário da clínica não pode ser removido.' },
      { status: 400 }
    );
  }

  if (existing.user_id === session.user.id) {
    return NextResponse.json(
      { error: 'Você não pode remover seu próprio acesso.' },
      { status: 400 }
    );
  }

  const isTopAdmin =
    context.organization.owner_user_id === session.user.id ||
    context.role === 'admin';
  if (!isTopAdmin && existing.role === 'admin') {
    return NextResponse.json(
      { error: 'Apenas o administrador principal pode remover outro administrador.' },
      { status: 403 }
    );
  }

  const { error } = await supabase
    .from('organization_members')
    .delete()
    .eq('organization_id', context.organization.id)
    .eq('id', id);

  if (error) {
    return NextResponse.json(
      { error: 'Não foi possível remover o usuário.' },
      { status: 502 }
    );
  }

  await supabase.from('appointment_audit_logs').insert({
    organization_id: context.organization.id,
    actor_user_id: session.user.id,
    actor_email: session.user.email,
    action: 'remove_org_member',
    previous_values: { email: existing.email, role: existing.role },
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
