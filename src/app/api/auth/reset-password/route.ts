import { NextRequest, NextResponse } from 'next/server';

import { verifySameOrigin } from '@/lib/auth/session';
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

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Informe um endereço de e-mail válido.' },
      { status: 400 }
    );
  }

  const host = (
    req.headers.get('x-forwarded-host') ??
    req.headers.get('host') ??
    ''
  )
    .split(',')[0]
    .trim();
  const proto =
    req.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https'
      ? 'https'
      : 'http';

  const redirectTo = host ? `${proto}://${host}/login` : undefined;

  try {
    const supabase = createSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(
      email,
      redirectTo ? { redirectTo } : undefined
    );

    // Always return generic success to avoid email enumeration
    return NextResponse.json({
      message:
        'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir sua senha.',
    });
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível solicitar a recuperação de senha.' },
      { status: 502 }
    );
  }
}
