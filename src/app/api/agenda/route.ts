import { NextRequest, NextResponse } from 'next/server';

import {
  isMissingAgendaTableError,
  resolveAgendaAccessContext,
} from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setSessionCookies,
} from '@/lib/auth/session';
import { getPlanBySlug, isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        error: 'Supabase não configurado.',
        code: 'SUPABASE_NOT_CONFIGURED',
      },
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
          error: 'As tabelas da agenda ainda não existem no Supabase.',
          code: 'TABLE_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    // Resolve user plan limits
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
        needsBootstrap: true,
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
    const visibleScheduleIds = context.visibleSchedules.map((s) => s.id);

    const [
      unitsRes,
      specialtiesRes,
      professionalsRes,
      profSpecRes,
      managersRes,
      availabilityRes,
      blocksRes,
      patientsRes,
      servicesRes,
      appointmentsRes,
      auditRes,
    ] = await Promise.all([
      supabase
        .from('units')
        .select('id, organization_id, name, address, timezone, is_active')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true }),
      supabase
        .from('specialties')
        .select('id, organization_id, name, color')
        .eq('organization_id', orgId)
        .order('name', { ascending: true }),
      supabase
        .from('professionals')
        .select('id, organization_id, unit_id, user_id, name, email, color, is_active')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: true }),
      supabase
        .from('professional_specialties')
        .select('professional_id, specialty_id'),
      visibleScheduleIds.length > 0
        ? supabase
            .from('schedule_managers')
            .select(
              'id, organization_id, schedule_id, user_id, manager_name, manager_email, role, can_view, can_manage_appointments, can_manage_availability, can_manage_blocks'
            )
            .eq('organization_id', orgId)
            .in('schedule_id', visibleScheduleIds)
        : Promise.resolve({ data: [], error: null }),
      visibleScheduleIds.length > 0
        ? supabase
            .from('availability_rules')
            .select(
              'id, organization_id, schedule_id, day_of_week, start_time, end_time, break_start, break_end, is_active'
            )
            .eq('organization_id', orgId)
            .in('schedule_id', visibleScheduleIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('schedule_blocks')
        .select(
          'id, organization_id, unit_id, schedule_id, title, reason, starts_at, ends_at, is_recurring'
        )
        .eq('organization_id', orgId)
        .order('starts_at', { ascending: true }),
      supabase
        .from('patients')
        .select('id, organization_id, name, phone, email')
        .eq('organization_id', orgId)
        .order('name', { ascending: true }),
      supabase
        .from('services')
        .select('id, organization_id, specialty_id, name, duration_minutes, is_active')
        .eq('organization_id', orgId)
        .order('name', { ascending: true }),
      visibleScheduleIds.length > 0
        ? supabase
            .from('appointments')
            .select(
              'id, organization_id, unit_id, schedule_id, professional_id, patient_id, service_id, specialty_id, starts_at, ends_at, status, is_fit_in, recurrence_group_id, notes_admin, created_at, updated_at'
            )
            .eq('organization_id', orgId)
            .in('schedule_id', visibleScheduleIds)
            .order('starts_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('appointment_audit_logs')
        .select(
          'id, organization_id, appointment_id, schedule_id, actor_user_id, actor_email, action, previous_values, new_values, created_at'
        )
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(80),
    ]);

    const queryResults = [
      unitsRes,
      specialtiesRes,
      professionalsRes,
      profSpecRes,
      managersRes,
      availabilityRes,
      blocksRes,
      patientsRes,
      servicesRes,
      appointmentsRes,
      auditRes,
    ];
    const firstTableMissing = queryResults.find(
      (r) => r.error && isMissingAgendaTableError(r.error)
    );
    if (firstTableMissing) {
      return NextResponse.json(
        {
          error: 'As tabelas da agenda ainda não existem no Supabase.',
          code: 'TABLE_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    const firstQueryErr = queryResults.find((r) => r.error)?.error;
    if (firstQueryErr) {
      throw new Error(
        `[agenda_data:${firstQueryErr.code ?? 'ERR'}] ${firstQueryErr.message ?? 'Erro ao carregar registros'}`
      );
    }

    const specLinks = (profSpecRes.data ?? []) as {
      professional_id: string;
      specialty_id: string;
    }[];
    const specsByProf = new Map<string, string[]>();
    for (const link of specLinks) {
      const list = specsByProf.get(link.professional_id) ?? [];
      list.push(link.specialty_id);
      specsByProf.set(link.professional_id, list);
    }

    const visibleProfIds = new Set(
      context.visibleSchedules.map((s) => s.professional_id)
    );
    const professionals = (professionalsRes.data ?? [])
      .filter((p) => context.isAdmin || visibleProfIds.has(p.id))
      .map((p) => ({
        ...p,
        specialty_ids: specsByProf.get(p.id) ?? [],
      }));

    const blocks = (blocksRes.data ?? []).filter(
      (b) => b.schedule_id === null || visibleScheduleIds.includes(b.schedule_id)
    );

    const response = NextResponse.json({
      organization: context.organization,
      role: context.role,
      isAdmin: context.isAdmin,
      permissionsBySchedule: context.permissionsBySchedule,
      units: unitsRes.data ?? [],
      specialties: specialtiesRes.data ?? [],
      professionals,
      schedules: context.visibleSchedules,
      managers: managersRes.data ?? [],
      availabilityRules: availabilityRes.data ?? [],
      blocks,
      patients: patientsRes.data ?? [],
      services: servicesRes.data ?? [],
      appointments: appointmentsRes.data ?? [],
      auditLogs: auditRes.data ?? [],
      planLimits,
      needsBootstrap: false,
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
    console.error('[GET /api/agenda] failed:', err);
    const detail =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : '';
    return NextResponse.json(
      {
        error: detail
          ? `Não foi possível carregar os dados da agenda (${detail}).`
          : 'Não foi possível carregar os dados da agenda.',
        code: 'AGENDA_LOAD_FAILED',
      },
      { status: 502 }
    );
  }
}
