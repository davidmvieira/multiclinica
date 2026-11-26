import { NextRequest, NextResponse } from 'next/server';

import { verifySameOrigin } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from '@/lib/supabase/server';

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
  const email =
    typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
  const password = typeof record.password === 'string' ? record.password : '';
  const confirmPassword =
    typeof record.confirmPassword === 'string' ? record.confirmPassword : '';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Informe um endereço de e-mail válido.' },
      { status: 400 }
    );
  }

  if (!password || password.length < 6 || password.length > 128) {
    return NextResponse.json(
      { error: 'A nova senha deve ter entre 6 e 128 caracteres.' },
      { status: 400 }
    );
  }

  if (password !== confirmPassword) {
    return NextResponse.json(
      { error: 'A confirmação da senha não confere com a nova senha.' },
      { status: 400 }
    );
  }

  try {
    const adminClient = createSupabaseAdminClient();
    if (adminClient) {
      let targetUserId: string | null = null;
      let page = 1;

      while (!targetUserId && page <= 10) {
        const { data: listData, error: listError } =
          await adminClient.auth.admin.listUsers({
            page,
            perPage: 500,
          });
        if (listError || !listData?.users?.length) break;

        const matched = listData.users.find(
          (u) => (u.email ?? '').toLowerCase() === email
        );
        if (matched) {
          targetUserId = matched.id;
          break;
        }
        if (listData.users.length < 500) break;
        page += 1;
      }

      if (!targetUserId) {
        return NextResponse.json(
          { error: 'Nenhuma conta cadastrada foi encontrada com este e-mail.' },
          { status: 404 }
        );
      }

      const { error: updateErr } = await adminClient.auth.admin.updateUserById(
        targetUserId,
        {
          password,
          email_confirm: true,
        }
      );

      if (updateErr) {
        return NextResponse.json(
          {
            error:
              updateErr.message ||
              'Não foi possível atualizar a senha no Supabase Auth.',
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        ok: true,
        message:
          'Senha atualizada com sucesso. Você já pode entrar com sua nova senha.',
      });
    }

    // Sem SUPABASE_SERVICE_ROLE_KEY: usa RPC segura no banco (Seção 6 do sql.md)
    const supabase = createSupabaseServerClient();
    const { data: updated, error: rpcErr } = await supabase.rpc(
      'direct_reset_password_by_email',
      {
        target_email: email,
        new_password: password,
      }
    );

    if (rpcErr) {
      const code = rpcErr.code ?? '';
      const msg = (rpcErr.message ?? '').toLowerCase();
      if (
        code === '42883' ||
        code === 'PGRST202' ||
        msg.includes('could not find the function') ||
        msg.includes('does not exist')
      ) {
        return NextResponse.json(
          {
            error:
              'Função SQL de atualização direta de senha não encontrada no banco. Execute a Seção 6 do arquivo sql.md no SQL Editor do Supabase.',
            code: 'RESET_SQL_MIGRATION_REQUIRED',
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          error:
            rpcErr.message || 'Não foi possível atualizar a senha no banco.',
        },
        { status: 502 }
      );
    }

    if (updated !== true) {
      return NextResponse.json(
        { error: 'Nenhuma conta cadastrada foi encontrada com este e-mail.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      message:
        'Senha atualizada com sucesso no banco. Você já pode entrar com sua nova senha.',
    });
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível atualizar a senha no servidor.' },
      { status: 502 }
    );
  }
}
