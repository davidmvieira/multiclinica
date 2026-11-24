import { NextRequest, NextResponse } from 'next/server';

import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { TodoItem } from '@/types/supabase';

function normalizeTodoRow(row: Record<string, unknown>): TodoItem {
  const rawTitle = row.title ?? row.task ?? row.name ?? '';
  const rawComplete = row.is_complete ?? row.completed ?? row.done ?? false;
  const rawCreatedAt = row.created_at ?? row.inserted_at ?? null;

  return {
    id:
      typeof row.id === 'number' || typeof row.id === 'string'
        ? row.id
        : String(row.id ?? ''),
    title: typeof rawTitle === 'string' ? rawTitle : String(rawTitle ?? ''),
    is_complete: Boolean(rawComplete),
    created_at: typeof rawCreatedAt === 'string' ? rawCreatedAt : null,
  };
}

function isMissingTableError(error: { code?: string; message?: string }): boolean {
  const msg = (error.message ?? '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    msg.includes('could not find the table') ||
    msg.includes('does not exist')
  );
}

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        error:
          'Variáveis SUPABASE_URL e SUPABASE_ANON_KEY não configuradas no ambiente.',
        code: 'SUPABASE_NOT_CONFIGURED',
      },
      { status: 503 }
    );
  }

  const session = await getAuthenticatedSession(req);
  if (!session) {
    return NextResponse.json(
      {
        error: 'Autenticação necessária para consultar a tabela todos.',
        code: 'UNAUTHORIZED',
      },
      { status: 401 }
    );
  }

  const supabase = createSupabaseServerClient(session.accessToken);

  let result = await supabase
    .from('todos')
    .select('*')
    .order('created_at', { ascending: false });

  if (
    result.error &&
    (result.error.code === '42703' ||
      (result.error.message ?? '').toLowerCase().includes('created_at'))
  ) {
    result = await supabase.from('todos').select('*');
  }

  if (result.error) {
    if (isMissingTableError(result.error)) {
      return NextResponse.json(
        {
          error: 'A tabela "todos" ainda não existe no projeto Supabase.',
          code: 'TABLE_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error: 'Não foi possível consultar os registros no Supabase.',
        code: 'SUPABASE_QUERY_ERROR',
      },
      { status: 502 }
    );
  }

  const todos = (result.data ?? []).map((row) =>
    normalizeTodoRow(row as Record<string, unknown>)
  );

  const response = NextResponse.json({ todos });
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
        error: 'Variáveis SUPABASE_URL e SUPABASE_ANON_KEY não configuradas.',
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Formato de requisição inválido.' },
      { status: 400 }
    );
  }

  const rawTitle = (body as Record<string, unknown>)?.title;
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';

  if (!title || title.length > 200) {
    return NextResponse.json(
      { error: 'Informe um título válido com até 200 caracteres.' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServerClient(session.accessToken);
  const { data, error } = await supabase
    .from('todos')
    .insert({
      title,
      is_complete: false,
      user_id: session.user.id,
    })
    .select('*')
    .single();

  if (error || !data) {
    if (error && isMissingTableError(error)) {
      return NextResponse.json(
        {
          error: 'A tabela "todos" ainda não existe no projeto Supabase.',
          code: 'TABLE_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error:
          'Não foi possível salvar a tarefa no Supabase. Verifique as colunas e políticas RLS da tabela todos.',
        code: 'SUPABASE_INSERT_ERROR',
      },
      { status: 502 }
    );
  }

  const response = NextResponse.json(
    { todo: normalizeTodoRow(data as Record<string, unknown>) },
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
  const id = record.id;
  if (typeof id !== 'string' && typeof id !== 'number') {
    return NextResponse.json(
      { error: 'Identificador da tarefa inválido.' },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (typeof record.is_complete === 'boolean') {
    updates.is_complete = record.is_complete;
  }
  if (typeof record.title === 'string') {
    const trimmed = record.title.trim();
    if (!trimmed || trimmed.length > 200) {
      return NextResponse.json(
        { error: 'O título deve ter entre 1 e 200 caracteres.' },
        { status: 400 }
      );
    }
    updates.title = trimmed;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Nenhum campo válido informado para atualização.' },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServerClient(session.accessToken);
  const { data, error } = await supabase
    .from('todos')
    .update(updates)
    .eq('id', id)
    .eq('user_id', session.user.id)
    .select('*')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: 'Não foi possível atualizar a tarefa.' },
      { status: 404 }
    );
  }

  const response = NextResponse.json({
    todo: normalizeTodoRow(data as Record<string, unknown>),
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

  const idParam = req.nextUrl.searchParams.get('id');
  if (!idParam || idParam.length > 64) {
    return NextResponse.json(
      { error: 'Informe o ID da tarefa para exclusão.' },
      { status: 400 }
    );
  }

  const parsedId = /^\d+$/.test(idParam) ? Number(idParam) : idParam;

  const supabase = createSupabaseServerClient(session.accessToken);
  const { error } = await supabase
    .from('todos')
    .delete()
    .eq('id', parsedId)
    .eq('user_id', session.user.id);

  if (error) {
    return NextResponse.json(
      { error: 'Não foi possível excluir a tarefa.' },
      { status: 502 }
    );
  }

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
