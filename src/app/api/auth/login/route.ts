import { NextRequest, NextResponse } from 'next/server';

import { setSessionCookies, verifySameOrigin } from '@/lib/auth/session';
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

  const email =
    typeof (body as Record<string, unknown>)?.email === 'string'
      ? (body as Record<string, string>).email.trim().toLowerCase()
      : '';
  const password =
    typeof (body as Record<string, unknown>)?.password === 'string'
      ? (body as Record<string, string>).password
      : '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Informe um endereço de e-mail válido.' },
      { status: 400 }
    );
  }

  if (!password || password.length < 6) {
    return NextResponse.json(
      { error: 'A senha deve ter pelo menos 6 caracteres.' },
      { status: 400 }
    );
  }

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session || !data.user) {
      const code = (error as { code?: string } | null)?.code ?? '';
      const rawMsg = (error?.message ?? '').toLowerCase();

      if (
        code === 'email_not_confirmed' ||
        rawMsg.includes('email not confirmed')
      ) {
        return NextResponse.json(
          {
            error:
              'Esta conta ainda aguarda confirmação de e-mail no Supabase. Como o envio de e-mail não está ativo, use "Esqueci minha senha" abaixo para confirmar e definir sua senha diretamente.',
            code: 'EMAIL_NOT_CONFIRMED',
          },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: 'E-mail ou senha incorretos.' },
        { status: 401 }
      );
    }

    // Reivindica vínculos pendentes em organization_members, professionals e schedule_managers
    try {
      const authedSupabase = createSupabaseServerClient(
        data.session.access_token
      );
      await authedSupabase.rpc('claim_pending_org_memberships');
    } catch {
      // Non-blocking if migration SQL has not been applied yet
    }

    const metadataName =
      typeof data.user.user_metadata?.full_name === 'string'
        ? data.user.user_metadata.full_name
        : null;

    const response = NextResponse.json({
      user: {
        id: data.user.id,
        email: data.user.email ?? email,
        name: metadataName,
      },
    });

    setSessionCookies(
      response,
      req,
      data.session.access_token,
      data.session.refresh_token
    );

    return response;
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível conectar ao serviço de autenticação.' },
      { status: 502 }
    );
  }
}
