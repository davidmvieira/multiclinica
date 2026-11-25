import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
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
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!name || name.length > 120) {
    return NextResponse.json(
      { error: 'Informe o nome do paciente (até 120 caracteres).' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServerClient(session.accessToken);
  const { context } = await resolveAgendaAccessContext(
    supabase,
    session.user.id,
    session.user.email
  );

  if (!context) {
    return NextResponse.json(
      { error: 'Organização clínica não encontrada.' },
      { status: 404 }
    );
  }

  // Enforce plan patient limit
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

  if (planDef.max_patients !== null) {
    const { count } = await supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', context.organization.id);

    if ((count ?? 0) >= planDef.max_patients) {
      return NextResponse.json(
        {
          error: `Seu plano ${planDef.name} permite até ${planDef.max_patients} pacientes cadastrados. Atualize o plano em Configurações para cadastrar mais pacientes.`,
          code: 'PLAN_LIMIT_REACHED',
        },
        { status: 403 }
      );
    }
  }

  const { data: patient, error } = await supabase
    .from('patients')
    .insert({
      organization_id: context.organization.id,
      name,
      phone: phone || null,
      email: email || null,
    })
    .select('id, organization_id, name, phone, email')
    .single();

  if (error || !patient) {
    return NextResponse.json(
      { error: 'Não foi possível cadastrar o paciente.' },
      { status: 502 }
    );
  }

  const response = NextResponse.json({ patient }, { status: 201 });
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
