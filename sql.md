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

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patients' and column_name = 'full_name'
  ) then
    execute 'update public.patients set name = full_name where (name is null or name = ''Paciente'') and full_name is not null';
    execute $fn$
      create or replace function public.sync_patients_name_fields()
      returns trigger
      language plpgsql
      as $trg$
      begin
        new.name := coalesce(nullif(trim(new.name), ''), new.full_name, 'Paciente');
        new.full_name := coalesce(nullif(trim(new.full_name), ''), new.name);
        return new;
      end;
      $trg$;
    $fn$;
    execute 'drop trigger if exists trg_sync_patients_name on public.patients';
    execute 'create trigger trg_sync_patients_name before insert or update on public.patients for each row execute function public.sync_patients_name_fields()';
  end if;
end $$;

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

do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'organizations',
        'units',
        'organization_members',
        'specialties',
        'professionals',
        'professional_specialties',
        'schedules',
        'schedule_managers',
        'availability_rules',
        'schedule_blocks',
        'patients',
        'services',
        'appointments',
        'appointment_audit_logs'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

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

notify pgrst, 'reload schema';
```

---

## 4. Massa completa de dados para teste (`/dashboard` e `/agenda`)

Cria um cadastro completo vinculado ao usuário autenticado em `auth.users` (plano `pro`, clínica, 2 unidades, 4 especialidades, 4 serviços, 4 profissionais com agendas independentes, jornada semanal seg–sex, gestor delegado, 6 pacientes, bloqueio recorrente `Clínica fechada` 12:00–13:00, bloqueio pontual e agendamentos distribuídos na semana atual).

> Execute após rodar as seções **1, 2 e 3**. Caso utilize outro e-mail de login, altere `v_target_email` na primeira linha do bloco `do $$`.

```sql
do $$
declare
  v_target_email text := 'manguera.david@gmail.com';
  v_user_id uuid;
  v_user_email text;
  v_org_id uuid;
  v_unit_matriz uuid;
  v_unit_jardins uuid;

  v_spec_fisio uuid;
  v_spec_nutri uuid;
  v_spec_estetica uuid;
  v_spec_psico uuid;

  v_svc_fisio uuid;
  v_svc_nutri uuid;
  v_svc_estetica uuid;
  v_svc_psico uuid;

  v_prof_camila uuid;
  v_prof_bruno uuid;
  v_prof_leticia uuid;
  v_prof_thiago uuid;

  v_sched_camila uuid;
  v_sched_bruno uuid;
  v_sched_leticia uuid;
  v_sched_thiago uuid;

  v_pat_sofia uuid;
  v_pat_ricardo uuid;
  v_pat_maria uuid;
  v_pat_pedro uuid;
  v_pat_beatriz uuid;
  v_pat_gabriel uuid;

  v_appt_id uuid;
  v_monday date;
  v_day integer;
begin
  -- 1. Localizar usuário em auth.users
  select id, email
    into v_user_id, v_user_email
  from auth.users
  where lower(email) = lower(v_target_email)
  limit 1;

  if v_user_id is null then
    select id, email
      into v_user_id, v_user_email
    from auth.users
    order by created_at asc
    limit 1;
  end if;

  if v_user_id is null then
    raise exception 'Nenhum usuário encontrado em auth.users. Crie uma conta em /login antes de executar o seed.';
  end if;

  -- Compatibilidade com tabela public.patients legada que possua full_name NOT NULL
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patients' and column_name = 'full_name'
  ) then
    execute 'update public.patients set name = full_name where (name is null or name = ''Paciente'') and full_name is not null';
    execute $fn$
      create or replace function public.sync_patients_name_fields()
      returns trigger
      language plpgsql
      as $trg$
      begin
        new.name := coalesce(nullif(trim(new.name), ''), new.full_name, 'Paciente');
        new.full_name := coalesce(nullif(trim(new.full_name), ''), new.name);
        return new;
      end;
      $trg$;
    $fn$;
    execute 'drop trigger if exists trg_sync_patients_name on public.patients';
    execute 'create trigger trg_sync_patients_name before insert or update on public.patients for each row execute function public.sync_patients_name_fields()';
  end if;

  -- 2. Garantir assinatura no plano Pro (até 5 profissionais e 50 pacientes) para testar múltiplas agendas
  if exists (select 1 from public.plans where slug = 'pro') then
    insert into public.subscriptions (user_id, plan_slug, account_name, status)
    values (v_user_id, 'pro', 'Clínica Iatris Multiprofissional', 'active')
    on conflict (user_id) do update
      set plan_slug = 'pro',
          status = 'active',
          updated_at = now();
  end if;

  -- 3. Criar ou reutilizar organização do usuário
  select id into v_org_id
  from public.organizations
  where owner_user_id = v_user_id
  order by created_at asc
  limit 1;

  if v_org_id is null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'organizations' and column_name = 'slug'
    ) then
      execute 'insert into public.organizations (owner_user_id, name, slug, timezone) values ($1, $2, $3, $4) returning id'
        into v_org_id
        using v_user_id, 'Clínica Iatris Multiprofissional', 'clinica-iatris-' || left(v_user_id::text, 8), 'America/Sao_Paulo';
    else
      insert into public.organizations (owner_user_id, name, timezone)
      values (v_user_id, 'Clínica Iatris Multiprofissional', 'America/Sao_Paulo')
      returning id into v_org_id;
    end if;
  end if;

  -- 4. Unidades
  select id into v_unit_matriz
  from public.units
  where organization_id = v_org_id and name = 'Unidade Matriz'
  limit 1;

  if v_unit_matriz is null then
    insert into public.units (organization_id, name, address, timezone, is_active)
    values (v_org_id, 'Unidade Matriz', 'Av. Paulista, 1200 — Bela Vista', 'America/Sao_Paulo', true)
    returning id into v_unit_matriz;
  end if;

  select id into v_unit_jardins
  from public.units
  where organization_id = v_org_id and name = 'Unidade Jardins'
  limit 1;

  if v_unit_jardins is null then
    insert into public.units (organization_id, name, address, timezone, is_active)
    values (v_org_id, 'Unidade Jardins', 'Rua Oscar Freire, 450 — Jardins', 'America/Sao_Paulo', true)
    returning id into v_unit_jardins;
  end if;

  -- 5. Vincular usuário como administrador da organização
  insert into public.organization_members (organization_id, user_id, unit_id, role, display_name, email)
  values (v_org_id, v_user_id, v_unit_matriz, 'admin', 'Administrador da Clínica', v_user_email)
  on conflict (organization_id, user_id) do update
    set role = 'admin',
        unit_id = excluded.unit_id,
        email = excluded.email;

  -- 6. Especialidades
  insert into public.specialties (organization_id, name, color)
  values (v_org_id, 'Fisioterapia', '#059669')
  on conflict (organization_id, name) do update set color = excluded.color
  returning id into v_spec_fisio;

  insert into public.specialties (organization_id, name, color)
  values (v_org_id, 'Nutrição', '#0284C7')
  on conflict (organization_id, name) do update set color = excluded.color
  returning id into v_spec_nutri;

  insert into public.specialties (organization_id, name, color)
  values (v_org_id, 'Estética', '#D97706')
  on conflict (organization_id, name) do update set color = excluded.color
  returning id into v_spec_estetica;

  insert into public.specialties (organization_id, name, color)
  values (v_org_id, 'Psicologia', '#7C3AED')
  on conflict (organization_id, name) do update set color = excluded.color
  returning id into v_spec_psico;

  -- 7. Serviços / Procedimentos
  if not exists (select 1 from public.services where organization_id = v_org_id) then
    insert into public.services (organization_id, specialty_id, name, duration_minutes, is_active)
    values (v_org_id, v_spec_fisio, 'Sessão de Fisioterapia', 60, true)
    returning id into v_svc_fisio;

    insert into public.services (organization_id, specialty_id, name, duration_minutes, is_active)
    values (v_org_id, v_spec_nutri, 'Consulta Nutricional', 60, true)
    returning id into v_svc_nutri;

    insert into public.services (organization_id, specialty_id, name, duration_minutes, is_active)
    values (v_org_id, v_spec_estetica, 'Procedimento Estético', 60, true)
    returning id into v_svc_estetica;

    insert into public.services (organization_id, specialty_id, name, duration_minutes, is_active)
    values (v_org_id, v_spec_psico, 'Sessão de Psicoterapia', 50, true)
    returning id into v_svc_psico;
  else
    select id into v_svc_fisio from public.services where organization_id = v_org_id and specialty_id = v_spec_fisio limit 1;
    select id into v_svc_nutri from public.services where organization_id = v_org_id and specialty_id = v_spec_nutri limit 1;
    select id into v_svc_estetica from public.services where organization_id = v_org_id and specialty_id = v_spec_estetica limit 1;
    select id into v_svc_psico from public.services where organization_id = v_org_id and specialty_id = v_spec_psico limit 1;
  end if;

  -- 8. Profissionais + Agendas Independentes + Disponibilidade + Gestor Delegado (se ainda não existirem)
  if not exists (select 1 from public.professionals where organization_id = v_org_id) then
    insert into public.professionals (organization_id, unit_id, user_id, name, email, color, is_active)
    values (v_org_id, v_unit_matriz, v_user_id, 'Dra. Camila Mendes', v_user_email, '#059669', true)
    returning id into v_prof_camila;

    insert into public.professionals (organization_id, unit_id, user_id, name, email, color, is_active)
    values (v_org_id, v_unit_matriz, null, 'Dr. Bruno Cardoso', 'bruno.nutri@clinica.local', '#0284C7', true)
    returning id into v_prof_bruno;

    insert into public.professionals (organization_id, unit_id, user_id, name, email, color, is_active)
    values (v_org_id, v_unit_jardins, null, 'Dra. Letícia Souza', 'leticia.estetica@clinica.local', '#D97706', true)
    returning id into v_prof_leticia;

    insert into public.professionals (organization_id, unit_id, user_id, name, email, color, is_active)
    values (v_org_id, v_unit_matriz, null, 'Dr. Thiago Barbosa', 'thiago.psico@clinica.local', '#7C3AED', true)
    returning id into v_prof_thiago;

    -- Vínculo profissional <-> especialidades (Dra. Camila atua em 2 especialidades)
    insert into public.professional_specialties (professional_id, specialty_id)
    values
      (v_prof_camila, v_spec_fisio),
      (v_prof_camila, v_spec_estetica),
      (v_prof_bruno, v_spec_nutri),
      (v_prof_leticia, v_spec_estetica),
      (v_prof_thiago, v_spec_psico)
    on conflict do nothing;

    -- Agendas independentes
    insert into public.schedules (organization_id, unit_id, professional_id, name, slot_duration_minutes, is_active)
    values (v_org_id, v_unit_matriz, v_prof_camila, 'Agenda — Dra. Camila Mendes', 60, true)
    returning id into v_sched_camila;

    insert into public.schedules (organization_id, unit_id, professional_id, name, slot_duration_minutes, is_active)
    values (v_org_id, v_unit_matriz, v_prof_bruno, 'Agenda — Dr. Bruno Cardoso', 60, true)
    returning id into v_sched_bruno;

    insert into public.schedules (organization_id, unit_id, professional_id, name, slot_duration_minutes, is_active)
    values (v_org_id, v_unit_jardins, v_prof_leticia, 'Agenda — Dra. Letícia Souza', 60, true)
    returning id into v_sched_leticia;

    insert into public.schedules (organization_id, unit_id, professional_id, name, slot_duration_minutes, is_active)
    values (v_org_id, v_unit_matriz, v_prof_thiago, 'Agenda — Dr. Thiago Barbosa', 50, true)
    returning id into v_sched_thiago;

    -- Disponibilidade semanal (segunda a sexta 08:00-18:00 com intervalo 12:00-13:00)
    for v_day in 1..5 loop
      insert into public.availability_rules (organization_id, schedule_id, day_of_week, start_time, end_time, break_start, break_end, is_active)
      values
        (v_org_id, v_sched_camila,  v_day, '08:00', '18:00', '12:00', '13:00', true),
        (v_org_id, v_sched_bruno,   v_day, '08:00', '18:00', '12:00', '13:00', true),
        (v_org_id, v_sched_leticia, v_day, '09:00', '18:00', '12:00', '13:00', true),
        (v_org_id, v_sched_thiago,  v_day, '08:00', '17:00', '12:00', '13:00', true)
      on conflict (schedule_id, day_of_week) do nothing;
    end loop;

    -- Gestão compartilhada (Recepção com permissão de visualizar e agendar)
    insert into public.schedule_managers (
      organization_id, schedule_id, manager_name, manager_email, role,
      can_view, can_manage_appointments, can_manage_availability, can_manage_blocks
    )
    values
      (v_org_id, v_sched_camila, 'Recepção Central', 'recepcao@clinica.local', 'reception', true, true, false, false),
      (v_org_id, v_sched_bruno,  'Recepção Central', 'recepcao@clinica.local', 'reception', true, true, false, false),
      (v_org_id, v_sched_leticia,'Recepção Central', 'recepcao@clinica.local', 'reception', true, true, false, false)
    on conflict (schedule_id, manager_email) do nothing;

    -- 9. Pacientes de teste
    insert into public.patients (organization_id, name, phone, email)
    values (v_org_id, 'Sofia Lima', '(11) 99123-4501', 'sofia.lima@teste.local')
    returning id into v_pat_sofia;

    insert into public.patients (organization_id, name, phone, email)
    values (v_org_id, 'Ricardo Moreira', '(11) 99234-5602', 'ricardo.moreira@teste.local')
    returning id into v_pat_ricardo;

    insert into public.patients (organization_id, name, phone, email)
    values (v_org_id, 'Maria Santos', '(11) 99345-6703', 'maria.santos@teste.local')
    returning id into v_pat_maria;

    insert into public.patients (organization_id, name, phone, email)
    values (v_org_id, 'Pedro Ferreira', '(11) 99456-7804', 'pedro.ferreira@teste.local')
    returning id into v_pat_pedro;

    insert into public.patients (organization_id, name, phone, email)
    values (v_org_id, 'Beatriz Campos', '(11) 99567-8905', 'beatriz.campos@teste.local')
    returning id into v_pat_beatriz;

    insert into public.patients (organization_id, name, phone, email)
    values (v_org_id, 'Gabriel Oliveira', '(11) 99678-9006', 'gabriel.oliveira@teste.local')
    returning id into v_pat_gabriel;

    -- 10. Bloqueios (Clínica fechada recorrente 12:00-13:00 + Reunião clínica na quarta)
    v_monday := date_trunc('week', (now() at time zone 'America/Sao_Paulo'))::date;

    insert into public.schedule_blocks (
      organization_id, unit_id, schedule_id, title, reason, starts_at, ends_at, is_recurring, created_by
    )
    values (
      v_org_id,
      v_unit_matriz,
      null,
      'Clínica fechada',
      'Intervalo de almoço',
      ((v_monday + time '12:00') at time zone 'America/Sao_Paulo'),
      ((v_monday + time '13:00') at time zone 'America/Sao_Paulo'),
      true,
      v_user_id
    );

    insert into public.schedule_blocks (
      organization_id, unit_id, schedule_id, title, reason, starts_at, ends_at, is_recurring, created_by
    )
    values (
      v_org_id,
      v_unit_matriz,
      v_sched_bruno,
      'Reunião clínica',
      'Alinhamento multidisciplinar',
      (((v_monday + 2) + time '11:00') at time zone 'America/Sao_Paulo'),
      (((v_monday + 2) + time '12:00') at time zone 'America/Sao_Paulo'),
      false,
      v_user_id
    );

    -- 11. Agendamentos distribuídos na semana atual (segunda a sexta)
    insert into public.appointments (
      organization_id, unit_id, schedule_id, professional_id, patient_id, service_id, specialty_id,
      starts_at, ends_at, status, is_fit_in, notes_admin, created_by, updated_by
    )
    values
      -- Segunda-feira
      (v_org_id, v_unit_matriz,  v_sched_camila,  v_prof_camila,  v_pat_sofia,   v_svc_fisio,    v_spec_fisio,
       ((v_monday + time '08:00') at time zone 'America/Sao_Paulo'),
       ((v_monday + time '09:00') at time zone 'America/Sao_Paulo'),
       'confirmed', false, 'Primeira sessão da semana', v_user_id, v_user_id),
      (v_org_id, v_unit_matriz,  v_sched_bruno,   v_prof_bruno,   v_pat_ricardo, v_svc_nutri,    v_spec_nutri,
       ((v_monday + time '08:00') at time zone 'America/Sao_Paulo'),
       ((v_monday + time '09:00') at time zone 'America/Sao_Paulo'),
       'awaiting_confirmation', false, null, v_user_id, v_user_id),
      (v_org_id, v_unit_jardins, v_sched_leticia, v_prof_leticia, v_pat_maria,   v_svc_estetica, v_spec_estetica,
       ((v_monday + time '10:00') at time zone 'America/Sao_Paulo'),
       ((v_monday + time '11:00') at time zone 'America/Sao_Paulo'),
       'confirmed', false, null, v_user_id, v_user_id),
      (v_org_id, v_unit_matriz,  v_sched_thiago,  v_prof_thiago,  v_pat_pedro,   v_svc_psico,    v_spec_psico,
       ((v_monday + time '14:00') at time zone 'America/Sao_Paulo'),
       ((v_monday + time '14:50') at time zone 'America/Sao_Paulo'),
       'pending', false, 'Confirmar recepção 15 min antes', v_user_id, v_user_id),

      -- Terça-feira
      (v_org_id, v_unit_matriz,  v_sched_camila,  v_prof_camila,  v_pat_beatriz, v_svc_fisio,    v_spec_fisio,
       (((v_monday + 1) + time '09:00') at time zone 'America/Sao_Paulo'),
       (((v_monday + 1) + time '10:00') at time zone 'America/Sao_Paulo'),
       'completed', false, null, v_user_id, v_user_id),
      (v_org_id, v_unit_matriz,  v_sched_bruno,   v_prof_bruno,   v_pat_gabriel, v_svc_nutri,    v_spec_nutri,
       (((v_monday + 1) + time '09:00') at time zone 'America/Sao_Paulo'),
       (((v_monday + 1) + time '10:00') at time zone 'America/Sao_Paulo'),
       'in_service', false, null, v_user_id, v_user_id),
      (v_org_id, v_unit_matriz,  v_sched_thiago,  v_prof_thiago,  v_pat_sofia,   v_svc_psico,    v_spec_psico,
       (((v_monday + 1) + time '15:00') at time zone 'America/Sao_Paulo'),
       (((v_monday + 1) + time '15:50') at time zone 'America/Sao_Paulo'),
       'awaiting_service', false, null, v_user_id, v_user_id),

      -- Quarta-feira
      (v_org_id, v_unit_matriz,  v_sched_camila,  v_prof_camila,  v_pat_maria,   v_svc_fisio,    v_spec_fisio,
       (((v_monday + 2) + time '10:00') at time zone 'America/Sao_Paulo'),
       (((v_monday + 2) + time '11:00') at time zone 'America/Sao_Paulo'),
       'confirmed', false, null, v_user_id, v_user_id),
      (v_org_id, v_unit_jardins, v_sched_leticia, v_prof_leticia, v_pat_beatriz, v_svc_estetica, v_spec_estetica,
       (((v_monday + 2) + time '14:00') at time zone 'America/Sao_Paulo'),
       (((v_monday + 2) + time '15:00') at time zone 'America/Sao_Paulo'),
       'confirmed', true, 'Encaixe autorizado pela coordenação', v_user_id, v_user_id),

      -- Quinta-feira
      (v_org_id, v_unit_matriz,  v_sched_bruno,   v_prof_bruno,   v_pat_pedro,   v_svc_nutri,    v_spec_nutri,
       (((v_monday + 3) + time '08:00') at time zone 'America/Sao_Paulo'),
       (((v_monday + 3) + time '09:00') at time zone 'America/Sao_Paulo'),
       'confirmed', false, null, v_user_id, v_user_id),
      (v_org_id, v_unit_matriz,  v_sched_camila,  v_prof_camila,  v_pat_ricardo, v_svc_fisio,    v_spec_fisio,
       (((v_monday + 3) + time '16:00') at time zone 'America/Sao_Paulo'),
       (((v_monday + 3) + time '17:00') at time zone 'America/Sao_Paulo'),
       'awaiting_confirmation', false, null, v_user_id, v_user_id),

      -- Sexta-feira
      (v_org_id, v_unit_jardins, v_sched_leticia, v_prof_leticia, v_pat_sofia,   v_svc_estetica, v_spec_estetica,
       (((v_monday + 4) + time '11:00') at time zone 'America/Sao_Paulo'),
       (((v_monday + 4) + time '12:00') at time zone 'America/Sao_Paulo'),
       'confirmed', false, null, v_user_id, v_user_id),
      (v_org_id, v_unit_matriz,  v_sched_thiago,  v_prof_thiago,  v_pat_gabriel, v_svc_psico,    v_spec_psico,
       (((v_monday + 4) + time '14:00') at time zone 'America/Sao_Paulo'),
       (((v_monday + 4) + time '14:50') at time zone 'America/Sao_Paulo'),
       'canceled', false, 'Cancelado com aviso prévio', v_user_id, v_user_id);

    -- 12. Registro inicial de auditoria
    select id into v_appt_id
    from public.appointments
    where organization_id = v_org_id
    order by starts_at asc
    limit 1;

    insert into public.appointment_audit_logs (
      organization_id, appointment_id, schedule_id, actor_user_id, actor_email, action, new_values
    )
    values (
      v_org_id,
      v_appt_id,
      v_sched_camila,
      v_user_id,
      v_user_email,
      'create_appointment',
      jsonb_build_object('source', 'seed_teste', 'status', 'confirmed')
    );
  end if;

  -- 13. Tarefas iniciais de exemplo para o /dashboard
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'todos') then
    if not exists (select 1 from public.todos where user_id = v_user_id) then
      insert into public.todos (user_id, title, is_complete)
      values
        (v_user_id, 'Confirmar retornos de Fisioterapia da semana', false),
        (v_user_id, 'Revisar disponibilidade da Unidade Jardins', false),
        (v_user_id, 'Validar permissões da recepção na agenda', true);
    end if;
  end if;
end $$;
```

---

## 5. Configurações Administrativas (Cadastro de usuários, vínculo automático e campos extras de unidades e profissionais)

Atualiza `organization_members`, `units` e `professionals` para suportar gestão completa em `/configuracoes`, incluindo pré-cadastro/vínculo automático de usuários por e-mail e controle de status ativo/inativo.

> Também disponível em `supabase/migrations/202611250002_admin_settings_users_units.sql`.

```sql
alter table public.organization_members alter column user_id drop not null;
alter table public.organization_members add column if not exists phone text;
alter table public.organization_members add column if not exists is_active boolean not null default true;
alter table public.organization_members add column if not exists invite_status text not null default 'active';
alter table public.organization_members add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uq_org_members_org_email
  on public.organization_members (organization_id, lower(email))
  where email is not null;

alter table public.units add column if not exists phone text;
alter table public.professionals add column if not exists phone text;
alter table public.professionals add column if not exists council_number text;

create or replace function public.is_org_member(target_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organizations o
    where o.id = target_org_id and o.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and m.is_active is distinct from false
  );
$$;

create or replace function public.is_org_admin(target_org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organizations o
    where o.id = target_org_id and o.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and m.is_active is distinct from false
      and m.role in ('admin', 'unit_manager')
  );
$$;

drop policy if exists "Org owner can update organization" on public.organizations;
create policy "Org owner can update organization"
  on public.organizations for update
  using (auth.uid() = owner_user_id or public.is_org_admin(id))
  with check (auth.uid() = owner_user_id or public.is_org_admin(id));

create or replace function public.link_auth_user_to_org_member(
  target_org_id uuid,
  member_email text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid;
  v_clean_email text;
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'Permissão negada para vincular membros nesta clínica.';
  end if;

  v_clean_email := lower(trim(coalesce(member_email, '')));
  if v_clean_email = '' then
    return false;
  end if;

  select id into v_uid
  from auth.users
  where lower(email) = v_clean_email
  limit 1;

  if v_uid is null then
    return false;
  end if;

  update public.organization_members
  set user_id = v_uid,
      invite_status = 'active',
      updated_at = now()
  where organization_id = target_org_id
    and lower(email) = v_clean_email
    and user_id is null;

  update public.professionals
  set user_id = v_uid
  where organization_id = target_org_id
    and lower(email) = v_clean_email
    and user_id is null;

  update public.schedule_managers
  set user_id = v_uid
  where organization_id = target_org_id
    and lower(manager_email) = v_clean_email
    and user_id is null;

  return true;
end;
$$;

create or replace function public.claim_pending_org_memberships()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_count integer := 0;
begin
  v_uid := auth.uid();
  v_email := lower(trim(coalesce(auth.jwt()->>'email', '')));

  if v_uid is null or v_email = '' then
    return 0;
  end if;

  update public.organization_members
  set user_id = v_uid,
      invite_status = 'active',
      updated_at = now()
  where lower(email) = v_email
    and user_id is null;

  get diagnostics v_count = row_count;

  update public.professionals
  set user_id = v_uid
  where lower(email) = v_email
    and user_id is null;

  update public.schedule_managers
  set user_id = v_uid
  where lower(manager_email) = v_email
    and user_id is null;

  return v_count;
end;
$$;

create or replace function public.handle_link_org_member_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  v_email := lower(trim(coalesce(new.email, '')));
  if v_email = '' then
    return new;
  end if;

  update public.organization_members
  set user_id = new.id,
      invite_status = 'active',
      updated_at = now()
  where lower(email) = v_email
    and user_id is null;

  update public.professionals
  set user_id = new.id
  where lower(email) = v_email
    and user_id is null;

  update public.schedule_managers
  set user_id = new.id
  where lower(manager_email) = v_email
    and user_id is null;

  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists on_auth_user_created_link_members on auth.users;
create trigger on_auth_user_created_link_members
  after insert on auth.users
  for each row
  execute function public.handle_link_org_member_on_signup();

notify pgrst, 'reload schema';
```

---

## 6. Multi-clínica, múltiplas unidades por profissional e atualização direta de senha (sem envio de e-mail)

Permite associar o mesmo profissional a múltiplas clínicas e múltiplas unidades (`professional_units`), confirma contas criadas por administradores sem depender de SMTP e adiciona a função `direct_reset_password_by_email` para atualização direta de senha na tela de login enquanto o envio de e-mail não estiver configurado.

> Também disponível em `supabase/migrations/202611250003_multiclinic_direct_reset.sql`.

```sql
create extension if not exists pgcrypto;

create table if not exists public.professional_units (
  professional_id uuid references public.professionals(id) on delete cascade not null,
  unit_id uuid references public.units(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  primary key (professional_id, unit_id)
);

insert into public.professional_units (professional_id, unit_id)
select p.id, p.unit_id
from public.professionals p
where p.unit_id is not null
on conflict (professional_id, unit_id) do nothing;

alter table public.professional_units enable row level security;

drop policy if exists "Org members can view professional units" on public.professional_units;
create policy "Org members can view professional units"
  on public.professional_units for select
  using (
    exists (
      select 1 from public.professionals p
      where p.id = professional_id and public.is_org_member(p.organization_id)
    )
  );

drop policy if exists "Org admins can manage professional units" on public.professional_units;
create policy "Org admins can manage professional units"
  on public.professional_units for all
  using (
    exists (
      select 1 from public.professionals p
      where p.id = professional_id and public.is_org_admin(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.professionals p
      where p.id = professional_id and public.is_org_admin(p.organization_id)
    )
  );

create or replace function public.claim_pending_org_memberships()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_email text;
  v_count integer := 0;
  v_prof record;
begin
  v_uid := auth.uid();
  v_email := lower(trim(coalesce(auth.jwt()->>'email', '')));

  if v_uid is null or v_email = '' then
    return 0;
  end if;

  update public.organization_members
  set user_id = v_uid,
      invite_status = 'active',
      updated_at = now()
  where lower(email) = v_email
    and user_id is null;

  get diagnostics v_count = row_count;

  for v_prof in
    select distinct on (p.organization_id)
      p.organization_id,
      p.unit_id,
      p.name
    from public.professionals p
    where lower(p.email) = v_email
      and not exists (
        select 1 from public.organization_members m
        where m.organization_id = p.organization_id
          and (m.user_id = v_uid or lower(m.email) = v_email)
      )
  loop
    insert into public.organization_members (
      organization_id, user_id, unit_id, role, display_name, email, is_active, invite_status
    )
    values (
      v_prof.organization_id, v_uid, v_prof.unit_id, 'professional', v_prof.name, v_email, true, 'active'
    )
    on conflict (organization_id, user_id) do nothing;
    v_count := v_count + 1;
  end loop;

  update public.professionals
  set user_id = v_uid
  where lower(email) = v_email
    and user_id is null;

  update public.schedule_managers
  set user_id = v_uid
  where lower(manager_email) = v_email
    and user_id is null;

  return v_count;
end;
$$;

create or replace function public.handle_link_org_member_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_prof record;
begin
  v_email := lower(trim(coalesce(new.email, '')));
  if v_email = '' then
    return new;
  end if;

  update public.organization_members
  set user_id = new.id,
      invite_status = 'active',
      updated_at = now()
  where lower(email) = v_email
    and user_id is null;

  for v_prof in
    select distinct on (p.organization_id)
      p.organization_id,
      p.unit_id,
      p.name
    from public.professionals p
    where lower(p.email) = v_email
      and not exists (
        select 1 from public.organization_members m
        where m.organization_id = p.organization_id
          and (m.user_id = new.id or lower(m.email) = v_email)
      )
  loop
    insert into public.organization_members (
      organization_id, user_id, unit_id, role, display_name, email, is_active, invite_status
    )
    values (
      v_prof.organization_id, new.id, v_prof.unit_id, 'professional', v_prof.name, v_email, true, 'active'
    )
    on conflict (organization_id, user_id) do nothing;
  end loop;

  update public.professionals
  set user_id = new.id
  where lower(email) = v_email
    and user_id is null;

  update public.schedule_managers
  set user_id = new.id
  where lower(manager_email) = v_email
    and user_id is null;

  return new;
exception
  when others then
    return new;
end;
$$;

create or replace function public.confirm_org_member_auth_user(
  target_org_id uuid,
  member_email text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_clean_email text;
  v_uid uuid;
begin
  if not public.is_org_admin(target_org_id) then
    raise exception 'Permissão negada.';
  end if;

  v_clean_email := lower(trim(coalesce(member_email, '')));
  if v_clean_email = '' then
    return false;
  end if;

  select id into v_uid
  from auth.users
  where lower(email) = v_clean_email
  limit 1;

  if v_uid is null then
    return false;
  end if;

  update auth.users
  set email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
  where id = v_uid;

  perform public.link_auth_user_to_org_member(target_org_id, v_clean_email);
  return true;
end;
$$;

create or replace function public.direct_reset_password_by_email(
  target_email text,
  new_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_clean_email text;
  v_uid uuid;
  v_prof record;
begin
  v_clean_email := lower(trim(coalesce(target_email, '')));
  if v_clean_email = '' or char_length(coalesce(new_password, '')) < 6 then
    return false;
  end if;

  select id into v_uid
  from auth.users
  where lower(email) = v_clean_email
  limit 1;

  if v_uid is null then
    return false;
  end if;

  update auth.users
  set encrypted_password = crypt(new_password, gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
  where id = v_uid;

  update public.organization_members
  set user_id = v_uid,
      invite_status = 'active',
      updated_at = now()
  where lower(email) = v_clean_email
    and user_id is null;

  for v_prof in
    select distinct on (p.organization_id)
      p.organization_id,
      p.unit_id,
      p.name
    from public.professionals p
    where lower(p.email) = v_clean_email
      and not exists (
        select 1 from public.organization_members m
        where m.organization_id = p.organization_id
          and (m.user_id = v_uid or lower(m.email) = v_clean_email)
      )
  loop
    insert into public.organization_members (
      organization_id, user_id, unit_id, role, display_name, email, is_active, invite_status
    )
    values (
      v_prof.organization_id, v_uid, v_prof.unit_id, 'professional', v_prof.name, v_clean_email, true, 'active'
    )
    on conflict (organization_id, user_id) do nothing;
  end loop;

  update public.professionals
  set user_id = v_uid
  where lower(email) = v_clean_email
    and user_id is null;

  update public.schedule_managers
  set user_id = v_uid
  where lower(manager_email) = v_clean_email
    and user_id is null;

  return true;
end;
$$;

grant execute on function public.claim_pending_org_memberships() to authenticated;
grant execute on function public.confirm_org_member_auth_user(uuid, text) to authenticated;
grant execute on function public.direct_reset_password_by_email(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
```




