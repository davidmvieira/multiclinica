import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
  setActiveOrganizationCookie,
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

  const organizationId =
    typeof body.organizationId === 'string' ? body.organizationId.trim() : '';

  if (!organizationId) {
    return NextResponse.json(
      { error: 'Informe a clínica selecionada.' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServerClient(session.accessToken);
  const { context } = await resolveAgendaAccessContext(
    supabase,
    session.user.id,
    session.user.email,
    organizationId
  );

  if (!context) {
    return NextResponse.json(
      { error: 'Nenhuma clínica vinculada à sua conta.' },
      { status: 404 }
    );
  }

  const matched = context.organizations.find((o) => o.id === organizationId);
  if (!matched) {
    return NextResponse.json(
      { error: 'Você não possui acesso à clínica selecionada.' },
      { status: 403 }
    );
  }

  const response = NextResponse.json({
    ok: true,
    organization: matched,
    role: context.role,
  });

  setActiveOrganizationCookie(response, req, matched.id);
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
