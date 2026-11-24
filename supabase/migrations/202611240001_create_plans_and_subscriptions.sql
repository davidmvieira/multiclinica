-- Migration: Criação das tabelas de planos e assinaturas de conta
-- Executar no SQL Editor do Supabase ou via Supabase CLI

create extension if not exists pgcrypto;

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
  slug,
  name,
  description,
  max_professionals,
  max_patients,
  is_on_demand,
  sort_order,
  is_active
)
values
  (
    'free',
    'Free',
    'Para começar no consultório individual com gestão essencial.',
    1,
    5,
    false,
    1,
    true
  ),
  (
    'inicial',
    'Inicial',
    'Para pequenas clínicas em crescimento com equipe reduzida.',
    3,
    15,
    false,
    2,
    true
  ),
  (
    'pro',
    'Pro',
    'Para clínicas estruturadas com maior volume de atendimentos.',
    5,
    50,
    false,
    3,
    true
  ),
  (
    'on_demand',
    'On Demand',
    'Capacidade sob medida acima de 5 profissionais e 50 pacientes.',
    null,
    null,
    true,
    4,
    true
  )
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
create policy "Anyone can view active plans"
  on public.plans for select
  using (is_active = true);

drop policy if exists "Users can view their own subscription" on public.subscriptions;
create policy "Users can view their own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own subscription" on public.subscriptions;
create policy "Users can create their own subscription"
  on public.subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own subscription" on public.subscriptions;
create policy "Users can update their own subscription"
  on public.subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_subscription_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row
  execute function public.set_subscription_updated_at();

create or replace function public.handle_new_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_slug text;
  resolved_slug text;
  resolved_status text;
  resolved_name text;
begin
  requested_slug := coalesce(new.raw_user_meta_data->>'plan_slug', 'free');
  resolved_name := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');

  select slug into resolved_slug
  from public.plans
  where slug = requested_slug and is_active = true
  limit 1;

  if resolved_slug is null then
    resolved_slug := 'free';
  end if;

  resolved_status := case
    when resolved_slug = 'on_demand' then 'pending_contact'
    else 'active'
  end;

  insert into public.subscriptions (user_id, plan_slug, account_name, status)
  values (new.id, resolved_slug, resolved_name, resolved_status)
  on conflict (user_id) do nothing;

  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_subscription on auth.users;
create trigger on_auth_user_created_subscription
  after insert on auth.users
  for each row
  execute function public.handle_new_user_subscription();
