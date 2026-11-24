'use client';

import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { PLANS, formatPlanCapacity } from '@/lib/plans';
import type { PlanDefinition, PlanSlug, UserSubscription } from '@/types/supabase';

const PLANS_MIGRATION_SQL = `create extension if not exists pgcrypto;

create table if not exists public.plans (
  slug text primary key,
  name text not null,
  description text not null,
  max_professionals integer,
  max_patients integer,
  is_on_demand boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.plans (
  slug, name, description, max_professionals, max_patients, is_on_demand, sort_order, is_active
)
values
  ('free', 'Free', 'Para começar no consultório individual com gestão essencial.', 1, 5, false, 1, true),
  ('inicial', 'Inicial', 'Para pequenas clínicas em crescimento com equipe reduzida.', 3, 15, false, 2, true),
  ('pro', 'Pro', 'Para clínicas estruturadas com maior volume de atendimentos.', 5, 50, false, 3, true),
  ('on_demand', 'On Demand', 'Capacidade sob medida acima de 5 profissionais e 50 pacientes.', null, null, true, 4, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  max_professionals = excluded.max_professionals,
  max_patients = excluded.max_patients,
  is_on_demand = excluded.is_on_demand,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  plan_slug text references public.plans(slug) not null default 'free',
  account_name text,
  status text not null default 'active' check (status in ('active', 'pending_contact', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Anyone can view active plans" on public.plans;
create policy "Anyone can view active plans" on public.plans for select using (is_active = true);

drop policy if exists "Users can view their own subscription" on public.subscriptions;
create policy "Users can view their own subscription" on public.subscriptions for select using (auth.uid() = user_id);

drop policy if exists "Users can create their own subscription" on public.subscriptions;
create policy "Users can create their own subscription" on public.subscriptions for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own subscription" on public.subscriptions;
create policy "Users can update their own subscription" on public.subscriptions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);`;

export default function PlanSettingsPanel() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [plans, setPlans] = useState<readonly PlanDefinition[]>(PLANS);
  const [subscription, setSubscription] = useState<UserSubscription | null>(
    null
  );
  const [savingSlug, setSavingSlug] = useState<PlanSlug | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [sessionRes, plansRes] = await Promise.all([
        fetch('/api/auth/session', { cache: 'no-store' }),
        fetch('/api/plans', { cache: 'no-store' }),
      ]);

      const sessionData = await sessionRes.json();
      const plansData = await plansRes.json();

      if (Array.isArray(plansData.plans) && plansData.plans.length > 0) {
        setPlans(plansData.plans);
      }

      setConfigured(Boolean(sessionData.configured));

      if (!sessionData.configured) {
        setSubscription(null);
        return;
      }

      if (!sessionData.authenticated) {
        router.replace('/login');
        return;
      }

      const subRes = await fetch('/api/account/plan', { cache: 'no-store' });
      const subData = await subRes.json();
      if (subRes.ok && subData.subscription) {
        setSubscription(subData.subscription);
      }
    } catch {
      setError('Não foi possível carregar as configurações de plano.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSelectPlan(slug: PlanSlug) {
    if (!configured || savingSlug || subscription?.plan_slug === slug) return;

    setSavingSlug(slug);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch('/api/account/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug: slug }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível alterar o plano.');
        return;
      }

      setSubscription(data.subscription);
      setNotice(`Plano atualizado para ${data.subscription.plan.name}.`);
    } catch {
      setError('Falha ao atualizar o plano.');
    } finally {
      setSavingSlug(null);
    }
  }

  async function handleCopySql() {
    try {
      await navigator.clipboard.writeText(PLANS_MIGRATION_SQL);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">
            Assinatura e capacidade
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Planos da Clínica
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Gerencie o plano selecionado na criação de conta e confira o SQL de
            migração em <code className="font-mono text-xs text-slate-800">sql.md</code>.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Atualizar
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          <CheckCircle2
            className="h-4 w-4 shrink-0 text-emerald-700"
            aria-hidden="true"
          />
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
            />
          ))}
        </div>
      ) : (
        <>
          {subscription && (
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    Plano atual da conta
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-900">
                      {subscription.plan.name}
                    </h2>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-sm text-slate-600 tabular-nums">
                      {formatPlanCapacity(subscription.plan)}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  {subscription.source === 'database'
                    ? 'Sincronizado com public.subscriptions'
                    : 'Salvo nos metadados do usuário'}
                </div>
              </div>
            </section>
          )}

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const isCurrent = subscription?.plan_slug === plan.slug;
              const isSaving = savingSlug === plan.slug;
              return (
                <article
                  key={plan.slug}
                  className={`flex flex-col justify-between rounded-xl border bg-white p-5 ${
                    isCurrent
                      ? 'border-emerald-600 ring-1 ring-emerald-600'
                      : 'border-slate-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-bold text-slate-900">
                        {plan.name}
                      </h3>
                      {isCurrent && (
                        <span className="text-xs font-semibold text-emerald-700">
                          Atual
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">
                      {plan.description}
                    </p>
                    <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-4 text-xs text-slate-700 tabular-nums">
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Profissionais</dt>
                        <dd className="font-semibold text-slate-900">
                          {plan.max_professionals ?? 'Sob medida'}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Pacientes</dt>
                        <dd className="font-semibold text-slate-900">
                          {plan.max_patients ?? 'Sob medida'}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <button
                    type="button"
                    disabled={!configured || isCurrent || isSaving}
                    onClick={() => void handleSelectPlan(plan.slug)}
                    className={`mt-5 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                      isCurrent
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-slate-900 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50'
                    }`}
                  >
                    {isSaving ? (
                      <>
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden="true"
                        />
                        Salvando...
                      </>
                    ) : isCurrent ? (
                      'Plano selecionado'
                    ) : (
                      `Selecionar ${plan.name}`
                    )}
                  </button>
                </article>
              );
            })}
          </section>

          {(!configured || subscription?.migration_pending) && (
            <section className="rounded-xl border border-amber-200 bg-white p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-slate-900">
                    Migration SQL de planos e assinaturas (<code className="font-mono text-xs">sql.md</code>)
                  </h2>
                  <p className="text-sm text-slate-600">
                    Execute o script abaixo no SQL Editor do Supabase para criar as
                    tabelas <code className="font-mono text-xs">public.plans</code> e{' '}
                    <code className="font-mono text-xs">public.subscriptions</code>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopySql()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  {copiedSql ? (
                    <>
                      <Check
                        className="h-3.5 w-3.5 text-emerald-600"
                        aria-hidden="true"
                      />
                      SQL copiado
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      Copiar migration SQL
                    </>
                  )}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
