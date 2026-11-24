import { NextRequest, NextResponse } from 'next/server';

import { setSessionCookies, verifySameOrigin } from '@/lib/auth/session';
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
      {
        error:
          'Integração Supabase não configurada. Defina SUPABASE_URL e SUPABASE_ANON_KEY nas variáveis de ambiente.',
        code: 'SUPABASE_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Formato de requisição inválido.' },
      { status: 400 }
    );
  }

  const record = (body ?? {}) as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const email =
    typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  const password = typeof record.password === 'string' ? record.password : '';
  const rawPlanSlug = record.planSlug ?? record.plan_slug ?? 'free';

  if (!isValidPlanSlug(rawPlanSlug)) {
    return NextResponse.json(
      { error: 'Plano selecionado inválido. Escolha Free, Inicial, Pro ou On Demand.' },
      { status: 400 }
    );
  }

  if (name.length > 120) {
    return NextResponse.json(
      { error: 'O nome deve ter no máximo 120 caracteres.' },
      { status: 400 }
    );
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Informe um endereço de e-mail válido.' },
      { status: 400 }
    );
  }

  if (!password || password.length < 6 || password.length > 128) {
    return NextResponse.json(
      { error: 'A senha deve ter entre 6 e 128 caracteres.' },
      { status: 400 }
    );
  }

  const selectedPlan = getPlanBySlug(rawPlanSlug);

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          ...(name ? { full_name: name } : {}),
          plan_slug: selectedPlan.slug,
        },
      },
    });

    if (error || !data.user) {
      const code = (error as { code?: string } | null)?.code ?? '';
      const rawMsg = (error?.message ?? '').toLowerCase();

      let message =
        'Não foi possível concluir o cadastro. Verifique os dados informados.';
      let status = 400;

      if (
        code === 'user_already_exists' ||
        rawMsg.includes('already registered') ||
        rawMsg.includes('already exists')
      ) {
        message = 'Já existe uma conta cadastrada com este e-mail.';
      } else if (
        code === 'over_email_send_rate_limit' ||
        rawMsg.includes('rate limit')
      ) {
        message =
          'Limite temporário de envios de e-mail atingido no Supabase. Aguarde alguns minutos ou desative a confirmação de e-mail em Authentication → Providers → Email no Supabase.';
        status = 429;
      } else if (
        code === 'email_address_invalid' ||
        rawMsg.includes('is invalid')
      ) {
        message =
          'O endereço de e-mail informado não é aceito pelo Supabase. Use um e-mail real.';
      } else if (code === 'weak_password' || rawMsg.includes('password')) {
        message =
          'A senha não atende aos requisitos mínimos de segurança do projeto Supabase.';
      } else if (
        code === 'signup_disabled' ||
        rawMsg.includes('signups not allowed')
      ) {
        message =
          'O cadastro de novos usuários está desabilitado nas configurações de Authentication do Supabase.';
        status = 403;
      }

      return NextResponse.json({ error: message }, { status });
    }

    let subscriptionPersisted = false;

    if (data.session) {
      const authedSupabase = createSupabaseServerClient(data.session.access_token);
      const { error: subError } = await authedSupabase
        .from('subscriptions')
        .upsert(
          {
            user_id: data.user.id,
            plan_slug: selectedPlan.slug,
            account_name: name || null,
            status:
              selectedPlan.slug === 'on_demand' ? 'pending_contact' : 'active',
          },
          { onConflict: 'user_id' }
        );

      subscriptionPersisted = !subError;
    }

    const response = NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email ?? email,
        name: name || null,
        plan_slug: selectedPlan.slug,
      },
      plan: selectedPlan,
      subscriptionPersisted,
      requiresEmailConfirmation: !data.session,
    });

    if (data.session) {
      setSessionCookies(
        response,
        req,
        data.session.access_token,
        data.session.refresh_token
      );
    }

    return response;
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível conectar ao serviço de autenticação.' },
      { status: 502 }
    );
  }
}
