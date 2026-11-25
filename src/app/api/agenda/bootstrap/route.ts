import { NextRequest, NextResponse } from 'next/server';

import {
  DEFAULT_SPECIALTIES,
  buildZonedIso,
  getZonedParts,
} from '@/lib/agenda/constants';
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

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }

  const clinicName =
    typeof body.clinicName === 'string' && body.clinicName.trim()
      ? body.clinicName.trim().slice(0, 120)
      : session.user.name || 'Minha Clínica';
  const seedStarterTeam = Boolean(body.seedStarterTeam);

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
          error: 'As tabelas da agenda ainda não foram criadas no Supabase.',
          code: 'TABLE_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    let org = context?.organization ?? null;

    if (!org) {
      const { data: createdOrg, error: orgError } = await supabase
        .from('organizations')
        .insert({
          owner_user_id: session.user.id,
          name: clinicName,
          timezone: 'America/Sao_Paulo',
        })
        .select('id, owner_user_id, name, timezone')
        .single();

      if (orgError || !createdOrg) {
        if (isMissingAgendaTableError(orgError)) {
          return NextResponse.json(
            {
              error: 'As tabelas da agenda ainda não existem no Supabase.',
              code: 'TABLE_NOT_FOUND',
            },
            { status: 404 }
          );
        }
        return NextResponse.json(
          { error: 'Não foi possível criar a organização clínica.' },
          { status: 502 }
        );
      }

      org = createdOrg;

      await supabase.from('organization_members').insert({
        organization_id: org.id,
        user_id: session.user.id,
        role: 'admin',
        display_name: session.user.name || 'Administrador',
        email: session.user.email,
      });
    }

    // Ensure at least 1 unit exists
    const { data: existingUnits } = await supabase
      .from('units')
      .select('id, name')
      .eq('organization_id', org.id);

    let defaultUnitId = existingUnits?.[0]?.id as string | undefined;
    if (!defaultUnitId) {
      const { data: createdUnit } = await supabase
        .from('units')
        .insert({
          organization_id: org.id,
          name: 'Unidade Matriz',
          timezone: org.timezone,
        })
        .select('id')
        .single();
      defaultUnitId = createdUnit?.id;
    }

    // Ensure default specialties and services exist
    const { data: existingSpecs } = await supabase
      .from('specialties')
      .select('id, name, color')
      .eq('organization_id', org.id);

    let specs = existingSpecs ?? [];
    if (specs.length === 0) {
      const { data: insertedSpecs } = await supabase
        .from('specialties')
        .insert(
          DEFAULT_SPECIALTIES.map((s) => ({
            organization_id: org!.id,
            name: s.name,
            color: s.color,
          }))
        )
        .select('id, name, color');

      specs = insertedSpecs ?? [];

      if (specs.length > 0) {
        await supabase.from('services').insert(
          DEFAULT_SPECIALTIES.map((def) => {
            const spec = specs.find((sp) => sp.name === def.name);
            return {
              organization_id: org!.id,
              specialty_id: spec?.id ?? null,
              name: def.service,
              duration_minutes: def.duration,
            };
          })
        );
      }
    }

    if (seedStarterTeam) {
      // Respect user plan limits
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

      const { data: existingProfs } = await supabase
        .from('professionals')
        .select('id')
        .eq('organization_id', org.id);

      const currentProfCount = existingProfs?.length ?? 0;
      const maxProfs = planDef.max_professionals ?? 4;
      const allowedNewProfs = Math.max(0, Math.min(4, maxProfs) - currentProfCount);

      if (allowedNewProfs > 0) {
        const starterProfs = [
          {
            name: session.user.name || 'Dra. Camila Mendes',
            email: session.user.email,
            specialty: 'Fisioterapia',
            color: '#059669',
            userId: session.user.id,
          },
          {
            name: 'Dr. Bruno Cardoso',
            email: 'bruno.nutri@clinica.local',
            specialty: 'Nutrição',
            color: '#0284C7',
            userId: null,
          },
          {
            name: 'Dra. Letícia Souza',
            email: 'leticia.estetica@clinica.local',
            specialty: 'Estética',
            color: '#D97706',
            userId: null,
          },
          {
            name: 'Dr. Thiago Barbosa',
            email: 'thiago.psico@clinica.local',
            specialty: 'Psicologia',
            color: '#7C3AED',
            userId: null,
          },
        ].slice(0, allowedNewProfs);

        const createdSchedules: { scheduleId: string; profId: string; specName: string }[] = [];

        for (const prof of starterProfs) {
          const { data: createdProf } = await supabase
            .from('professionals')
            .insert({
              organization_id: org.id,
              unit_id: defaultUnitId ?? null,
              user_id: prof.userId,
              name: prof.name,
              email: prof.email,
              color: prof.color,
            })
            .select('id')
            .single();

          if (!createdProf) continue;

          const matchedSpec = specs.find((s) => s.name === prof.specialty);
          if (matchedSpec) {
            await supabase.from('professional_specialties').insert({
              professional_id: createdProf.id,
              specialty_id: matchedSpec.id,
            });
          }

          const { data: createdSchedule } = await supabase
            .from('schedules')
            .insert({
              organization_id: org.id,
              unit_id: defaultUnitId ?? null,
              professional_id: createdProf.id,
              name: `Agenda — ${prof.name}`,
              slot_duration_minutes: 60,
            })
            .select('id')
            .single();

          if (createdSchedule) {
            createdSchedules.push({
              scheduleId: createdSchedule.id,
              profId: createdProf.id,
              specName: prof.specialty,
            });

            // Mon-Fri 08:00-18:00 with lunch 12:00-13:00
            const rules = [1, 2, 3, 4, 5].map((day) => ({
              organization_id: org!.id,
              schedule_id: createdSchedule.id,
              day_of_week: day,
              start_time: '08:00:00',
              end_time: '18:00:00',
              break_start: '12:00:00',
              break_end: '13:00:00',
              is_active: true,
            }));
            await supabase.from('availability_rules').insert(rules);
          }
        }

        // Seed patients respecting max_patients
        const { data: existingPatients } = await supabase
          .from('patients')
          .select('id')
          .eq('organization_id', org.id);
        const currentPatientCount = existingPatients?.length ?? 0;
        const maxPatients = planDef.max_patients ?? 5;
        const allowedPatients = Math.max(0, Math.min(5, maxPatients) - currentPatientCount);

        let seededPatients: { id: string }[] = existingPatients ?? [];
        if (allowedPatients > 0) {
          const samplePatients = [
            { name: 'Sofia Lima', phone: '(11) 99123-4501' },
            { name: 'Ricardo Moreira', phone: '(11) 99234-5602' },
            { name: 'Maria Santos', phone: '(11) 99345-6703' },
            { name: 'Pedro Ferreira', phone: '(11) 99456-7804' },
            { name: 'Beatriz Campos', phone: '(11) 99567-8905' },
          ].slice(0, allowedPatients);

          const { data: insertedPatients } = await supabase
            .from('patients')
            .insert(
              samplePatients.map((p) => ({
                organization_id: org!.id,
                name: p.name,
                phone: p.phone,
              }))
            )
            .select('id');

          seededPatients = [...seededPatients, ...(insertedPatients ?? [])];
        }

        // Seed lunch block ("Clínica fechada" 12:00-13:00) and initial appointments for today/this week
        const todayZoned = getZonedParts(new Date(), org.timezone);
        const { data: servicesList } = await supabase
          .from('services')
          .select('id, specialty_id')
          .eq('organization_id', org.id);

        if (defaultUnitId) {
          await supabase.from('schedule_blocks').insert({
            organization_id: org.id,
            unit_id: defaultUnitId,
            schedule_id: null,
            title: 'Clínica fechada',
            reason: 'Intervalo de almoço',
            starts_at: buildZonedIso(todayZoned.dateStr, '12:00', org.timezone),
            ends_at: buildZonedIso(todayZoned.dateStr, '13:00', org.timezone),
            is_recurring: true,
            created_by: session.user.id,
          });
        }

        if (createdSchedules.length > 0 && seededPatients.length > 0) {
          const slots = [
            { start: '09:00', end: '10:00', status: 'confirmed' },
            { start: '10:00', end: '11:00', status: 'pending' },
            { start: '14:00', end: '15:00', status: 'awaiting_confirmation' },
            { start: '16:00', end: '17:00', status: 'confirmed' },
          ];

          const appointmentsToInsert = createdSchedules.flatMap((cs, idx) => {
            const spec = specs.find((s) => s.name === cs.specName);
            const svc = (servicesList ?? []).find(
              (sv) => sv.specialty_id === spec?.id
            );
            const slot = slots[idx % slots.length];
            const patient = seededPatients[idx % seededPatients.length];

            return [
              {
                organization_id: org!.id,
                unit_id: defaultUnitId ?? null,
                schedule_id: cs.scheduleId,
                professional_id: cs.profId,
                patient_id: patient.id,
                service_id: svc?.id ?? null,
                specialty_id: spec?.id ?? null,
                starts_at: buildZonedIso(
                  todayZoned.dateStr,
                  slot.start,
                  org!.timezone
                ),
                ends_at: buildZonedIso(
                  todayZoned.dateStr,
                  slot.end,
                  org!.timezone
                ),
                status: slot.status,
                created_by: session.user.id,
                updated_by: session.user.id,
              },
            ];
          });

          await supabase.from('appointments').insert(appointmentsToInsert);
        }
      }
    }

    const response = NextResponse.json({ ok: true, organizationId: org.id });
    if (session.refreshed) {
      setSessionCookies(
        response,
        req,
        session.accessToken,
        session.refreshToken
      );
    }
    return response;
  } catch {
    return NextResponse.json(
      { error: 'Erro ao inicializar a estrutura da clínica no Supabase.' },
      { status: 502 }
    );
  }
}
