import { NextRequest, NextResponse } from 'next/server';

import { resolveAgendaAccessContext } from '@/lib/agenda/permissions';
import {
  getAuthenticatedSession,
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

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const color =
    typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)
      ? body.color
      : '#059669';

  if (!name || name.length < 2 || name.length > 80) {
    return NextResponse.json(
      { error: 'Informe o nome da especialidade (2 a 80 caracteres).' },
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
      { error: 'Apenas administradores podem cadastrar especialidades.' },
      { status: 403 }
    );
  }

  const { data: specialty, error } = await supabase
    .from('specialties')
    .insert({
      organization_id: context.organization.id,
      name,
      color,
    })
    .select('id, organization_id, name, color')
    .single();

  if (error || !specialty) {
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'Já existe uma especialidade com este nome.' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: 'Não foi possível cadastrar a especialidade.' },
      { status: 502 }
    );
  }

  // Create default service so agenda booking immediately works with this specialty
  await supabase.from('services').insert({
    organization_id: context.organization.id,
    specialty_id: specialty.id,
    name: `Atendimento — ${name}`,
    duration_minutes: 60,
    is_active: true,
  });

  const response = NextResponse.json({ specialty }, { status: 201 });
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
