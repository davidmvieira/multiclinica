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
import { getPlanBySlug, isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import {
  createSupabaseServerClient,
  hasSupabaseServiceRoleKey,
} from '@/lib/supabase/server';
import type {
  AgendaSchedule,
  AgendaSpecialty,
  MemberRole,
} from '@/types/agenda';
import type {
  OrganizationInviteStatus,
  SettingsMember,
  SettingsProfessional,
  SettingsUnit,
} from '@/types/settings';

const VALID_TIMEZONES = new Set([
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Cuiaba',
  'America/Rio_Branco',
  'America/Noronha',
]);

export async function GET(req: NextRequest) {
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

  const supabase = createSupabaseServerClient(session.accessToken);

  try {
    const { context, migrationPending } = await resolveAgendaAccessContext(
      supabase,
      session.user.id,
      session.user.email
    );

    if (migrationPending) {
      return NextResponse.json(
        {
          error: 'As tabelas da clínica ainda não existem no Supabase.',
          code: 'TABLE_NOT_FOUND',
        },
        { status: 404 }
      );
    }

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
    const planLimits = {
      planSlug: planDef.slug,
      planName: planDef.name,
      maxProfessionals: planDef.max_professionals,
      maxPatients: planDef.max_patients,
    };

    if (!context) {
      const response = NextResponse.json({
        organization: null,
        currentUserId: session.user.id,
        role: 'admin' as MemberRole,
        isAdmin: true,
        isOwner: true,
        hasServiceRole: hasSupabaseServiceRoleKey(),
        needsBootstrap: true,
        settingsMigrationPending: false,
        members: [],
        units: [],
        professionals: [],
        specialties: [],
        patientCount: 0,
        planLimits,
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

    const orgId = context.organization.id;
    const isOwner = context.organization.owner_user_id === session.user.id;

    if (!context.isAdmin) {
      const response = NextResponse.json({
        organization: context.organization,
        currentUserId: session.user.id,
        role: context.role,
        isAdmin: false,
        isOwner: false,
        hasServiceRole: false,
        needsBootstrap: false,
        settingsMigrationPending: false,
        members: [],
        units: [],
        professionals: [],
        specialties: [],
        patientCount: 0,
        planLimits,
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

    let settingsMigrationPending = false;

    const membersRes = await supabase
      .from('organization_members')
      .select(
        'id, organization_id, user_id, unit_id, role, display_name, email, phone, is_active, invite_status, created_at'
      )
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });

    let membersRows: Record<string, unknown>[] = (membersRes.data ?? []) as Record<
      string,
      unknown
    >[];
    let membersError = membersRes.error;

    if (membersError && membersError.code === '42703') {
      settingsMigrationPending = true;
      const fallback = await supabase
        .from('organization_members')
        .select(
          'id, organization_id, user_id, unit_id, role, display_name, email, created_at'
        )
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true });

      membersError = fallback.error;
      membersRows = (fallback.data ?? []).map((row) => ({
        ...row,
        phone: null,
        is_active: true,
        invite_status: 'active',
      }));
    }

    const unitsRes = await supabase
      .from('units')
      .select(
        'id, organization_id, name, address, phone, timezone, is_active, created_at'
      )
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });

    let unitsRows: Record<string, unknown>[] = (unitsRes.data ?? []) as Record<
      string,
      unknown
    >[];
    let unitsError = unitsRes.error;

    if (unitsError && unitsError.code === '42703') {
      settingsMigrationPending = true;
      const fallback = await supabase
        .from('units')
        .select('id, organization_id, name, address, timezone, is_active, created_at')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true });
      unitsError = fallback.error;
      unitsRows = (fallback.data ?? []).map((row) => ({ ...row, phone: null }));
    }

    const profsRes = await supabase
      .from('professionals')
      .select(
        'id, organization_id, unit_id, user_id, name, email, phone, council_number, color, is_active'
      )
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true });

    let profsRows: Record<string, unknown>[] = (profsRes.data ?? []) as Record<
      string,
      unknown
    >[];
    let profsError = profsRes.error;

    if (profsError && profsError.code === '42703') {
      settingsMigrationPending = true;
      const fallback = await supabase
        .from('professionals')
        .select('id, organization_id, unit_id, user_id, name, email, color, is_active')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true });
      profsError = fallback.error;
      profsRows = (fallback.data ?? []).map((row) => ({
        ...row,
        phone: null,
        council_number: null,
      }));
    }

    const [specsRes, profSpecsRes, schedulesRes, patientsCountRes] =
      await Promise.all([
        supabase
          .from('specialties')
          .select('id, organization_id, name, color')
          .eq('organization_id', orgId)
          .order('name', { ascending: true }),
        supabase
          .from('professional_specialties')
          .select('professional_id, specialty_id'),
        supabase
          .from('schedules')
          .select(
            'id, organization_id, unit_id, professional_id, name, slot_duration_minutes, min_advance_minutes, allow_overbooking, is_active'
          )
          .eq('organization_id', orgId),
        supabase
          .from('patients')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId),
      ]);

    const firstErr =
      membersError ||
      unitsError ||
      profsError ||
      specsRes.error ||
      profSpecsRes.error ||
      schedulesRes.error;

    if (firstErr) {
      if (isMissingAgendaTableError(firstErr)) {
        return NextResponse.json(
          {
            error: 'As tabelas da clínica ainda não existem no Supabase.',
            code: 'TABLE_NOT_FOUND',
          },
          { status: 404 }
        );
      }
      throw new Error(
        `[settings:${firstErr.code ?? 'ERR'}] ${firstErr.message ?? 'Erro ao carregar configurações'}`
      );
    }

    const specsByProf = new Map<string, string[]>();
    for (const link of (profSpecsRes.data ?? []) as {
      professional_id: string;
      specialty_id: string;
    }[]) {
      const list = specsByProf.get(link.professional_id) ?? [];
      list.push(link.specialty_id);
      specsByProf.set(link.professional_id, list);
    }

    const scheduleByProf = new Map<string, AgendaSchedule>();
    for (const sched of (schedulesRes.data ?? []) as AgendaSchedule[]) {
      scheduleByProf.set(sched.professional_id, sched);
    }

    const professionals: SettingsProfessional[] = profsRows.map((prof) => {
      const profId = String(prof.id);
      const sched = scheduleByProf.get(profId);
      return {
        id: profId,
        organization_id: String(prof.organization_id),
        unit_id: (prof.unit_id as string | null) ?? null,
        user_id: (prof.user_id as string | null) ?? null,
        name: String(prof.name ?? ''),
        email: (prof.email as string | null) ?? null,
        phone: (prof.phone as string | null) ?? null,
        council_number: (prof.council_number as string | null) ?? null,
        color: String(prof.color ?? '#059669'),
        is_active: prof.is_active !== false,
        specialty_ids: specsByProf.get(profId) ?? [],
        schedule: sched
          ? {
              id: sched.id,
              slot_duration_minutes: sched.slot_duration_minutes,
              is_active: sched.is_active,
              allow_overbooking: sched.allow_overbooking,
            }
          : null,
      };
    });

    const members: SettingsMember[] = membersRows.map((m) => {
      const userId = (m.user_id as string | null) ?? null;
      const inviteRaw = m.invite_status;
      return {
        id: String(m.id),
        organization_id: String(m.organization_id),
        user_id: userId,
        unit_id: (m.unit_id as string | null) ?? null,
        role: m.role as MemberRole,
        display_name: (m.display_name as string | null) ?? null,
        email: (m.email as string | null) ?? null,
        phone: (m.phone as string | null) ?? null,
        is_active: m.is_active !== false,
        invite_status: (inviteRaw === 'pending' || inviteRaw === 'inactive'
          ? inviteRaw
          : userId
            ? 'active'
            : 'pending') as OrganizationInviteStatus,
        created_at: String(m.created_at ?? ''),
        is_owner:
          Boolean(userId) && userId === context.organization.owner_user_id,
      };
    });

    const response = NextResponse.json({
      organization: context.organization,
      currentUserId: session.user.id,
      role: context.role,
      isAdmin: true,
      isOwner,
      hasServiceRole: hasSupabaseServiceRoleKey(),
      needsBootstrap: false,
      settingsMigrationPending,
      members,
      units: unitsRows as unknown as SettingsUnit[],
      professionals,
      specialties: (specsRes.data ?? []) as AgendaSpecialty[],
      patientCount: patientsCountRes.count ?? 0,
      planLimits,
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
  } catch (err) {
    console.error('[GET /api/settings] failed:', err);
    const detail = err instanceof Error ? err.message : '';
    return NextResponse.json(
      {
        error: detail
          ? `Não foi possível carregar as configurações (${detail}).`
          : 'Não foi possível carregar as configurações.',
      },
      { status: 502 }
    );
  }
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

  const supabase = createSupabaseServerClient(session.accessToken);
  const { context } = await resolveAgendaAccessContext(
    supabase,
    session.user.id,
    session.user.email
  );

  if (!context || !context.isAdmin) {
    return NextResponse.json(
      { error: 'Apenas administradores podem atualizar os dados da clínica.' },
      { status: 403 }
    );
  }

  if (
    context.organization.owner_user_id !== session.user.id &&
    context.role !== 'admin'
  ) {
    return NextResponse.json(
      {
        error:
          'Apenas o administrador principal da clínica pode alterar nome e fuso horário.',
      },
      { status: 403 }
    );
  }

  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : context.organization.name;
  const timezone =
    typeof body.timezone === 'string' && VALID_TIMEZONES.has(body.timezone)
      ? body.timezone
      : context.organization.timezone;

  if (name.length < 2) {
    return NextResponse.json(
      { error: 'Informe um nome válido para a clínica.' },
      { status: 400 }
    );
  }

  const { data: updated, error } = await supabase
    .from('organizations')
    .update({ name, timezone })
    .eq('id', context.organization.id)
    .select('id, owner_user_id, name, timezone')
    .single();

  if (error || !updated) {
    return NextResponse.json(
      {
        error:
          'Não foi possível atualizar os dados da clínica. Verifique se você possui permissão de proprietário.',
      },
      { status: 502 }
    );
  }

  const response = NextResponse.json({ organization: updated });
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
