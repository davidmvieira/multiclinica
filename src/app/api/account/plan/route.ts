import { NextRequest, NextResponse } from 'next/server';

import {
  getAuthenticatedSession,
  setSessionCookies,
  verifySameOrigin,
} from '@/lib/auth/session';
import { getPlanBySlug, isValidPlanSlug } from '@/lib/plans';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { UserSubscription } from '@/types/supabase';

function isMissingRelationError(error: { code?: string; message?: string }): boolean {
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

  const supabase = createSupabaseServerClient(session.accessToken);
  const { data, error } = await supabase
    .from('subscriptions')
    .select('plan_slug, status, account_name')
    .eq('user_id', session.user.id)
    .maybeSingle();

  const fallbackSlug = isValidPlanSlug(session.user.plan_slug)
    ? session.user.plan_slug
    : 'free';

  let subscription: UserSubscription;

  if (error) {
    const migrationPending = isMissingRelationError(error);
    subscription = {
      plan_slug: fallbackSlug,
      status: fallbackSlug === 'on_demand' ? 'pending_contact' : 'active',
      account_name: session.user.name,
      plan: getPlanBySlug(fallbackSlug),
      source: 'metadata',
      migration_pending: migrationPending,
    };
  } else if (!data) {
    // Attempt auto-provisioning the subscription row if user signed up before migration ran
    const { data: created, error: insertError } = await supabase
      .from('subscriptions')
      .upsert(
        {
          user_id: session.user.id,
          plan_slug: fallbackSlug,
          account_name: session.user.name,
          status: fallbackSlug === 'on_demand' ? 'pending_contact' : 'active',
        },
        { onConflict: 'user_id' }
      )
      .select('plan_slug, status, account_name')
      .single();

    if (insertError || !created) {
      subscription = {
        plan_slug: fallbackSlug,
        status: fallbackSlug === 'on_demand' ? 'pending_contact' : 'active',
        account_name: session.user.name,
        plan: getPlanBySlug(fallbackSlug),
        source: 'metadata',
        migration_pending: Boolean(insertError && isMissingRelationError(insertError)),
      };
    } else {
      const resolvedSlug = isValidPlanSlug(created.plan_slug)
        ? created.plan_slug
        : fallbackSlug;
      subscription = {
        plan_slug: resolvedSlug,
        status:
          created.status === 'pending_contact' || created.status === 'canceled'
            ? created.status
            : 'active',
        account_name: created.account_name ?? session.user.name,
        plan: getPlanBySlug(resolvedSlug),
        source: 'database',
        migration_pending: false,
      };
    }
  } else {
    const resolvedSlug = isValidPlanSlug(data.plan_slug)
      ? data.plan_slug
      : fallbackSlug;
    subscription = {
      plan_slug: resolvedSlug,
      status:
        data.status === 'pending_contact' || data.status === 'canceled'
          ? data.status
          : 'active',
      account_name: data.account_name ?? session.user.name,
      plan: getPlanBySlug(resolvedSlug),
      source: 'database',
      migration_pending: false,
    };
  }

  const response = NextResponse.json({ subscription });
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

  const rawPlanSlug =
    (body as Record<string, unknown>)?.planSlug ??
    (body as Record<string, unknown>)?.plan_slug;

  if (!isValidPlanSlug(rawPlanSlug)) {
    return NextResponse.json(
      { error: 'Plano selecionado inválido.' },
      { status: 400 }
    );
  }

  const nextPlan = getPlanBySlug(rawPlanSlug);
  const nextStatus =
    nextPlan.slug === 'on_demand' ? 'pending_contact' : 'active';

  const supabase = createSupabaseServerClient(session.accessToken);
  const { data, error } = await supabase
    .from('subscriptions')
    .upsert(
      {
        user_id: session.user.id,
        plan_slug: nextPlan.slug,
        account_name: session.user.name,
        status: nextStatus,
      },
      { onConflict: 'user_id' }
    )
    .select('plan_slug, status, account_name')
    .single();

  if (error) {
    if (isMissingRelationError(error)) {
      return NextResponse.json(
        {
          error:
            'As tabelas plans/subscriptions ainda não existem no Supabase. Execute a migration de sql.md.',
          code: 'TABLE_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Não foi possível atualizar o plano da conta.' },
      { status: 502 }
    );
  }

  await supabase.auth.updateUser({
    data: { plan_slug: nextPlan.slug },
  });

  const subscription: UserSubscription = {
    plan_slug: nextPlan.slug,
    status:
      data?.status === 'pending_contact' || data?.status === 'canceled'
        ? data.status
        : nextStatus,
    account_name: data?.account_name ?? session.user.name,
    plan: nextPlan,
    source: 'database',
    migration_pending: false,
  };

  const response = NextResponse.json({ subscription });
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
