# Scripts SQL do Projeto (Supabase / PostgreSQL)

Execute os scripts abaixo no **SQL Editor** do painel do Supabase (ou via Supabase CLI usando os arquivos em `supabase/migrations/`).

---

## 1. Planos e Assinaturas (`public.plans` e `public.subscriptions`)

Cria a tabela de planos (`Free`, `Inicial`, `Pro` e `On Demand`) com as capacidades de profissionais e pacientes, a tabela de vínculo da assinatura por usuário (`subscriptions`), as políticas de Row Level Security (RLS) e o gatilho automático no cadastro (`auth.users`).

```sql
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
```

---

## 2. Tarefas iniciais da clínica (`public.todos`)

Tabela utilizada na primeira integração do painel `/dashboard`.

```sql
create table if not exists public.todos (
  id bigint generated by default as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null default auth.uid(),
  title text not null check (char_length(title) > 0),
  is_complete boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.todos enable row level security;

drop policy if exists "Users can view their own todos" on public.todos;
create policy "Users can view their own todos"
  on public.todos for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own todos" on public.todos;
create policy "Users can insert their own todos"
  on public.todos for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own todos" on public.todos;
create policy "Users can update their own todos"
  on public.todos for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their own todos" on public.todos;
create policy "Users can delete their own todos"
  on public.todos for delete
  using (auth.uid() = user_id);
```

---

## 3. Agenda Multiprofissional (`organizations`, `units`, `professionals`, `schedules`, `appointments` e auditoria)

Estrutura multi-tenant completa para o módulo de agenda em `/agenda`, contemplando agendas independentes por profissional, múltiplas especialidades, gestão delegada com permissões granulares, regras de disponibilidade, bloqueios, agendamentos e trilha de auditoria.

> Também disponível em `supabase/migrations/202611250001_create_agenda_multiprofissional.sql`.

```sql
create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete cascade,
  name text not null default 'Minha Clínica',
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

alter table public.organizations add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
alter table public.organizations add column if not exists name text default 'Minha Clínica';
alter table public.organizations add column if not exists timezone text not null default 'America/Sao_Paulo';
alter table public.organizations add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'owner_id'
  ) then
    execute 'update public.organizations set owner_user_id = owner_id where owner_user_id is null';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'user_id'
  ) then
    execute 'update public.organizations set owner_user_id = user_id where owner_user_id is null';
  end if;
end $$;

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null default 'Unidade Matriz',
  address text,
  timezone text not null default 'America/Sao_Paulo',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.units add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.units add column if not exists name text default 'Unidade Matriz';
alter table public.units add column if not exists address text;
alter table public.units add column if not exists timezone text not null default 'America/Sao_Paulo';
alter table public.units add column if not exists is_active boolean not null default true;
alter table public.units add column if not exists created_at timestamptz not null default now();

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  unit_id uuid references public.units(id) on delete set null,
  role text not null default 'admin' check (role in ('admin', 'unit_manager', 'reception', 'professional', 'delegated_manager')),
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

alter table public.organization_members add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.organization_members add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.organization_members add column if not exists unit_id uuid references public.units(id) on delete set null;
alter table public.organization_members add column if not exists role text not null default 'admin';
alter table public.organization_members add column if not exists display_name text;
alter table public.organization_members add column if not exists email text;
alter table public.organization_members add column if not exists created_at timestamptz not null default now();

create table if not exists public.specialties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  name text not null,
  color text not null default '#059669',
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

alter table public.specialties add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.specialties add column if not exists name text;
alter table public.specialties add column if not exists color text not null default '#059669';
alter table public.specialties add column if not exists created_at timestamptz not null default now();

create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  name text not null default 'Profissional',
  email text,
  color text not null default '#059669',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.professionals add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.professionals add column if not exists unit_id uuid references public.units(id) on delete set null;
alter table public.professionals add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.professionals add column if not exists name text default 'Profissional';
alter table public.professionals add column if not exists email text;
alter table public.professionals add column if not exists color text not null default '#059669';
alter table public.professionals add column if not exists is_active boolean not null default true;
alter table public.professionals add column if not exists created_at timestamptz not null default now();

create table if not exists public.professional_specialties (
  professional_id uuid references public.professionals(id) on delete cascade not null,
  specialty_id uuid references public.specialties(id) on delete cascade not null,
  primary key (professional_id, specialty_id)
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  unit_id uuid references public.units(id) on delete set null,
  professional_id uuid references public.professionals(id) on delete cascade not null unique,
  name text not null,
  slot_duration_minutes integer not null default 60 check (slot_duration_minutes between 10 and 240),
  min_advance_minutes integer not null default 0 check (min_advance_minutes >= 0),
  allow_overbooking boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.schedules add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.schedules add column if not exists unit_id uuid references public.units(id) on delete set null;
alter table public.schedules add column if not exists professional_id uuid references public.professionals(id) on delete cascade;
alter table public.schedules add column if not exists name text;
alter table public.schedules add column if not exists slot_duration_minutes integer not null default 60;
alter table public.schedules add column if not exists min_advance_minutes integer not null default 0;
alter table public.schedules add column if not exists allow_overbooking boolean not null default false;
alter table public.schedules add column if not exists is_active boolean not null default true;
alter table public.schedules add column if not exists created_at timestamptz not null default now();

create table if not exists public.schedule_managers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  schedule_id uuid references public.schedules(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade,
  manager_name text not null,
  manager_email text not null,
  role text not null default 'delegated_manager' check (role in ('admin', 'unit_manager', 'reception', 'professional', 'delegated_manager')),
  can_view boolean not null default true,
  can_manage_appointments boolean not null default true,
  can_manage_availability boolean not null default false,
  can_manage_blocks boolean not null default false,
  created_at timestamptz not null default now(),
  unique (schedule_id, manager_email)
);

alter table public.schedule_managers add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.schedule_managers add column if not exists schedule_id uuid references public.schedules(id) on delete cascade;
alter table public.schedule_managers add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.schedule_managers add column if not exists manager_name text;
alter table public.schedule_managers add column if not exists manager_email text;
alter table public.schedule_managers add column if not exists role text not null default 'delegated_manager';
alter table public.schedule_managers add column if not exists can_view boolean not null default true;
alter table public.schedule_managers add column if not exists can_manage_appointments boolean not null default true;
alter table public.schedule_managers add column if not exists can_manage_availability boolean not null default false;
alter table public.schedule_managers add column if not exists can_manage_blocks boolean not null default false;
alter table public.schedule_managers add column if not exists created_at timestamptz not null default now();
create unique index if not exists uq_schedule_managers_schedule_email on public.schedule_managers (schedule_id, manager_email);

create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  schedule_id uuid references public.schedules(id) on delete cascade not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  break_start time,
  break_end time,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (schedule_id, day_of_week)
);

alter table public.availability_rules add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.availability_rules add column if not exists schedule_id uuid references public.schedules(id) on delete cascade;
alter table public.availability_rules add column if not exists day_of_week smallint;
alter table public.availability_rules add column if not exists start_time time;
alter table public.availability_rules add column if not exists end_time time;
alter table public.availability_rules add column if not exists break_start time;
alter table public.availability_rules add column if not exists break_end time;
alter table public.availability_rules add column if not exists is_active boolean not null default true;
alter table public.availability_rules add column if not exists created_at timestamptz not null default now();
create unique index if not exists uq_availability_rules_schedule_day on public.availability_rules (schedule_id, day_of_week);

create table if not exists public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  unit_id uuid references public.units(id) on delete set null,
  schedule_id uuid references public.schedules(id) on delete cascade,
  title text not null,
  reason text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_recurring boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table public.schedule_blocks add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.schedule_blocks add column if not exists unit_id uuid references public.units(id) on delete set null;
alter table public.schedule_blocks add column if not exists schedule_id uuid references public.schedules(id) on delete cascade;
alter table public.schedule_blocks add column if not exists title text;
alter table public.schedule_blocks add column if not exists reason text;
alter table public.schedule_blocks add column if not exists starts_at timestamptz;
alter table public.schedule_blocks add column if not exists ends_at timestamptz;
alter table public.schedule_blocks add column if not exists is_recurring boolean not null default false;
alter table public.schedule_blocks add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.schedule_blocks add column if not exists created_at timestamptz not null default now();

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null default 'Paciente',
  phone text,
  email text,
  created_at timestamptz not null default now()
);

alter table public.patients add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.patients add column if not exists name text default 'Paciente';
alter table public.patients add column if not exists phone text;
alter table public.patients add column if not exists email text;
alter table public.patients add column if not exists created_at timestamptz not null default now();

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  specialty_id uuid references public.specialties(id) on delete set null,
  name text not null,
  duration_minutes integer not null default 60 check (duration_minutes between 10 and 240),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.services add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.services add column if not exists specialty_id uuid references public.specialties(id) on delete set null;
alter table public.services add column if not exists name text;
alter table public.services add column if not exists duration_minutes integer not null default 60;
alter table public.services add column if not exists is_active boolean not null default true;
alter table public.services add column if not exists created_at timestamptz not null default now();

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  schedule_id uuid references public.schedules(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete restrict,
  service_id uuid references public.services(id) on delete set null,
  specialty_id uuid references public.specialties(id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'pending' check (
    status in (
      'pending',
      'awaiting_confirmation',
      'confirmed',
      'awaiting_service',
      'in_service',
      'completed',
      'canceled',
      'no_show'
    )
  ),
  is_fit_in boolean not null default false,
  recurrence_group_id uuid,
  notes_admin text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.appointments add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.appointments add column if not exists unit_id uuid references public.units(id) on delete set null;
alter table public.appointments add column if not exists schedule_id uuid references public.schedules(id) on delete cascade;
alter table public.appointments add column if not exists professional_id uuid references public.professionals(id) on delete cascade;
alter table public.appointments add column if not exists patient_id uuid references public.patients(id) on delete restrict;
alter table public.appointments add column if not exists service_id uuid references public.services(id) on delete set null;
alter table public.appointments add column if not exists specialty_id uuid references public.specialties(id) on delete set null;
alter table public.appointments add column if not exists starts_at timestamptz;
alter table public.appointments add column if not exists ends_at timestamptz;
alter table public.appointments add column if not exists status text not null default 'pending';
alter table public.appointments add column if not exists is_fit_in boolean not null default false;
alter table public.appointments add column if not exists recurrence_group_id uuid;
alter table public.appointments add column if not exists notes_admin text;
alter table public.appointments add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.appointments add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.appointments add column if not exists created_at timestamptz not null default now();
alter table public.appointments add column if not exists updated_at timestamptz not null default now();

create table if not exists public.appointment_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  appointment_id uuid references public.appointments(id) on delete set null,
  schedule_id uuid references public.schedules(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  previous_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

alter table public.appointment_audit_logs add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.appointment_audit_logs add column if not exists appointment_id uuid references public.appointments(id) on delete set null;
alter table public.appointment_audit_logs add column if not exists schedule_id uuid references public.schedules(id) on delete set null;
alter table public.appointment_audit_logs add column if not exists actor_user_id uuid references auth.users(id) on delete set null;
alter table public.appointment_audit_logs add column if not exists actor_email text;
alter table public.appointment_audit_logs add column if not exists action text;
alter table public.appointment_audit_logs add column if not exists previous_values jsonb;
alter table public.appointment_audit_logs add column if not exists new_values jsonb;
alter table public.appointment_audit_logs add column if not exists created_at timestamptz not null default now();

create index if not exists idx_appointments_org_starts on public.appointments (organization_id, starts_at);
create index if not exists idx_appointments_schedule_starts on public.appointments (schedule_id, starts_at);
create index if not exists idx_schedule_blocks_org_starts on public.schedule_blocks (organization_id, starts_at);
create index if not exists idx_audit_logs_org_created on public.appointment_audit_logs (organization_id, created_at desc);

create or replace function public.is_org_member(target_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organizations o where o.id = target_org_id and o.owner_user_id = auth.uid())
  or exists (select 1 from public.organization_members m where m.organization_id = target_org_id and m.user_id = auth.uid());
$$;

create or replace function public.is_org_admin(target_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.organizations o where o.id = target_org_id and o.owner_user_id = auth.uid())
  or exists (select 1 from public.organization_members m where m.organization_id = target_org_id and m.user_id = auth.uid() and m.role in ('admin', 'unit_manager'));
$$;

create or replace function public.can_operate_schedule(target_schedule_id uuid, permission_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.schedules s join public.organizations o on o.id = s.organization_id
    where s.id = target_schedule_id and o.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.schedules s join public.organization_members m on m.organization_id = s.organization_id
    where s.id = target_schedule_id and m.user_id = auth.uid()
      and (m.role = 'admin' or (m.role = 'unit_manager' and (m.unit_id is null or m.unit_id = s.unit_id)))
  )
  or exists (
    select 1 from public.schedules s join public.professionals p on p.id = s.professional_id
    where s.id = target_schedule_id and p.user_id = auth.uid()
      and permission_type in ('view', 'appointments', 'availability', 'blocks')
  )
  or exists (
    select 1 from public.schedule_managers sm
    where sm.schedule_id = target_schedule_id
      and (sm.user_id = auth.uid() or lower(sm.manager_email) = lower(coalesce(auth.jwt()->>'email', '')))
      and (
        (permission_type = 'view' and sm.can_view)
        or (permission_type = 'appointments' and sm.can_manage_appointments)
        or (permission_type = 'availability' and sm.can_manage_availability)
        or (permission_type = 'blocks' and sm.can_manage_blocks)
      )
  );
$$;

alter table public.organizations enable row level security;
alter table public.units enable row level security;
alter table public.organization_members enable row level security;
alter table public.specialties enable row level security;
alter table public.professionals enable row level security;
alter table public.professional_specialties enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_managers enable row level security;
alter table public.availability_rules enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.patients enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_audit_logs enable row level security;

drop policy if exists "Org members can select organization" on public.organizations;
create policy "Org members can select organization" on public.organizations for select using (public.is_org_member(id));
drop policy if exists "Users can create own organization" on public.organizations;
create policy "Users can create own organization" on public.organizations for insert with check (auth.uid() = owner_user_id);
drop policy if exists "Org owner can update organization" on public.organizations;
create policy "Org owner can update organization" on public.organizations for update using (auth.uid() = owner_user_id);

drop policy if exists "Org members can select members" on public.organization_members;
create policy "Org members can select members" on public.organization_members for select using (public.is_org_member(organization_id));
drop policy if exists "Org admins can manage members" on public.organization_members;
create policy "Org admins can manage members" on public.organization_members for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists "Org members can view units" on public.units;
create policy "Org members can view units" on public.units for select using (public.is_org_member(organization_id));
drop policy if exists "Org admins can manage units" on public.units;
create policy "Org admins can manage units" on public.units for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists "Org members can view specialties" on public.specialties;
create policy "Org members can view specialties" on public.specialties for select using (public.is_org_member(organization_id));
drop policy if exists "Org admins can manage specialties" on public.specialties;
create policy "Org admins can manage specialties" on public.specialties for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists "Org members can view services" on public.services;
create policy "Org members can view services" on public.services for select using (public.is_org_member(organization_id));
drop policy if exists "Org admins can manage services" on public.services;
create policy "Org admins can manage services" on public.services for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists "Org members can view patients" on public.patients;
create policy "Org members can view patients" on public.patients for select using (public.is_org_member(organization_id));
drop policy if exists "Org members can manage patients" on public.patients;
create policy "Org members can manage patients" on public.patients for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "Org members can view professionals" on public.professionals;
create policy "Org members can view professionals" on public.professionals for select using (public.is_org_member(organization_id));
drop policy if exists "Org admins can manage professionals" on public.professionals;
create policy "Org admins can manage professionals" on public.professionals for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists "Org members can view professional specialties" on public.professional_specialties;
create policy "Org members can view professional specialties" on public.professional_specialties for select using (exists (select 1 from public.professionals p where p.id = professional_id and public.is_org_member(p.organization_id)));
drop policy if exists "Org admins can manage professional specialties" on public.professional_specialties;
create policy "Org admins can manage professional specialties" on public.professional_specialties for all using (exists (select 1 from public.professionals p where p.id = professional_id and public.is_org_admin(p.organization_id))) with check (exists (select 1 from public.professionals p where p.id = professional_id and public.is_org_admin(p.organization_id)));

drop policy if exists "Authorized users can view schedules" on public.schedules;
create policy "Authorized users can view schedules" on public.schedules for select using (public.can_operate_schedule(id, 'view'));
drop policy if exists "Org admins can manage schedules" on public.schedules;
create policy "Org admins can manage schedules" on public.schedules for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists "Authorized users can view schedule managers" on public.schedule_managers;
create policy "Authorized users can view schedule managers" on public.schedule_managers for select using (public.can_operate_schedule(schedule_id, 'view'));
drop policy if exists "Org admins can manage schedule managers" on public.schedule_managers;
create policy "Org admins can manage schedule managers" on public.schedule_managers for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists "Authorized users can view availability" on public.availability_rules;
create policy "Authorized users can view availability" on public.availability_rules for select using (public.can_operate_schedule(schedule_id, 'view'));
drop policy if exists "Authorized users can manage availability" on public.availability_rules;
create policy "Authorized users can manage availability" on public.availability_rules for all using (public.can_operate_schedule(schedule_id, 'availability')) with check (public.can_operate_schedule(schedule_id, 'availability'));

drop policy if exists "Org members can view blocks" on public.schedule_blocks;
create policy "Org members can view blocks" on public.schedule_blocks for select using ((schedule_id is null and public.is_org_member(organization_id)) or (schedule_id is not null and public.can_operate_schedule(schedule_id, 'view')));
drop policy if exists "Authorized users can manage blocks" on public.schedule_blocks;
create policy "Authorized users can manage blocks" on public.schedule_blocks for all using ((schedule_id is null and public.is_org_admin(organization_id)) or (schedule_id is not null and public.can_operate_schedule(schedule_id, 'blocks'))) with check ((schedule_id is null and public.is_org_admin(organization_id)) or (schedule_id is not null and public.can_operate_schedule(schedule_id, 'blocks')));

drop policy if exists "Authorized users can view appointments" on public.appointments;
create policy "Authorized users can view appointments" on public.appointments for select using (public.can_operate_schedule(schedule_id, 'view'));
drop policy if exists "Authorized users can insert appointments" on public.appointments;
create policy "Authorized users can insert appointments" on public.appointments for insert with check (public.can_operate_schedule(schedule_id, 'appointments'));
drop policy if exists "Authorized users can update appointments" on public.appointments;
create policy "Authorized users can update appointments" on public.appointments for update using (public.can_operate_schedule(schedule_id, 'appointments')) with check (public.can_operate_schedule(schedule_id, 'appointments'));

drop policy if exists "Authorized users can view audit logs" on public.appointment_audit_logs;
create policy "Authorized users can view audit logs" on public.appointment_audit_logs for select using (public.is_org_admin(organization_id) or (schedule_id is not null and public.can_operate_schedule(schedule_id, 'view')));
drop policy if exists "Org members can insert audit logs" on public.appointment_audit_logs;
create policy "Org members can insert audit logs" on public.appointment_audit_logs for insert with check (public.is_org_member(organization_id));
```

