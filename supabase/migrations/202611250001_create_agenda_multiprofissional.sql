-- Migration: Agenda Multiprofissional (multi-tenant, permissões, disponibilidade, bloqueios, agendamentos e auditoria)
-- Executar no SQL Editor do Supabase ou via Supabase CLI

create extension if not exists pgcrypto;

-- 1. Organizações / Clínicas
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

-- 2. Unidades da clínica
create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  name text not null,
  address text,
  timezone text not null default 'America/Sao_Paulo',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3. Membros e papéis organizacionais
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  unit_id uuid references public.units(id) on delete set null,
  role text not null check (role in ('admin', 'unit_manager', 'reception', 'professional', 'delegated_manager')),
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- 4. Especialidades
create table if not exists public.specialties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  name text not null,
  color text not null default '#059669',
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

-- 5. Profissionais
create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  unit_id uuid references public.units(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  color text not null default '#059669',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 6. Vínculo Profissional <-> Especialidade (1 ou mais especialidades)
create table if not exists public.professional_specialties (
  professional_id uuid references public.professionals(id) on delete cascade not null,
  specialty_id uuid references public.specialties(id) on delete cascade not null,
  primary key (professional_id, specialty_id)
);

-- 7. Agendas independentes por profissional
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

-- 8. Gestão compartilhada e permissões por agenda
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

-- 9. Regras de disponibilidade / jornada semanal por agenda
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

-- 10. Bloqueios / ausências / clínica fechada
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

-- 11. Pacientes (dados administrativos sem exposição clínica na grade)
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  name text not null,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

-- 12. Serviços / procedimentos
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  specialty_id uuid references public.specialties(id) on delete set null,
  name text not null,
  duration_minutes integer not null default 60 check (duration_minutes between 10 and 240),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 13. Agendamentos
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  unit_id uuid references public.units(id) on delete set null,
  schedule_id uuid references public.schedules(id) on delete cascade not null,
  professional_id uuid references public.professionals(id) on delete cascade not null,
  patient_id uuid references public.patients(id) on delete restrict not null,
  service_id uuid references public.services(id) on delete set null,
  specialty_id uuid references public.specialties(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
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
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- 14. Histórico / auditoria de agendamentos
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

create index if not exists idx_appointments_org_starts
  on public.appointments (organization_id, starts_at);
create index if not exists idx_appointments_schedule_starts
  on public.appointments (schedule_id, starts_at);
create index if not exists idx_schedule_blocks_org_starts
  on public.schedule_blocks (organization_id, starts_at);
create index if not exists idx_audit_logs_org_created
  on public.appointment_audit_logs (organization_id, created_at desc);

-- Funções auxiliares de autorização multi-tenant (RLS)
create or replace function public.is_org_member(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = target_org_id
      and o.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = target_org_id
      and o.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.organization_members m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and m.role in ('admin', 'unit_manager')
  );
$$;

create or replace function public.can_operate_schedule(target_schedule_id uuid, permission_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.schedules s
    join public.organizations o on o.id = s.organization_id
    where s.id = target_schedule_id
      and o.owner_user_id = auth.uid()
  )
  or exists (
    select 1
    from public.schedules s
    join public.organization_members m on m.organization_id = s.organization_id
    where s.id = target_schedule_id
      and m.user_id = auth.uid()
      and (
        m.role = 'admin'
        or (m.role = 'unit_manager' and (m.unit_id is null or m.unit_id = s.unit_id))
      )
  )
  or exists (
    select 1
    from public.schedules s
    join public.professionals p on p.id = s.professional_id
    where s.id = target_schedule_id
      and p.user_id = auth.uid()
      and permission_type in ('view', 'appointments', 'availability', 'blocks')
  )
  or exists (
    select 1
    from public.schedule_managers sm
    where sm.schedule_id = target_schedule_id
      and (
        sm.user_id = auth.uid()
        or lower(sm.manager_email) = lower(coalesce(auth.jwt()->>'email', ''))
      )
      and (
        (permission_type = 'view' and sm.can_view)
        or (permission_type = 'appointments' and sm.can_manage_appointments)
        or (permission_type = 'availability' and sm.can_manage_availability)
        or (permission_type = 'blocks' and sm.can_manage_blocks)
      )
  );
$$;

-- Habilitar RLS em todas as tabelas
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

-- Políticas Organizations
drop policy if exists "Org members can select organization" on public.organizations;
create policy "Org members can select organization"
  on public.organizations for select
  using (public.is_org_member(id));

drop policy if exists "Users can create own organization" on public.organizations;
create policy "Users can create own organization"
  on public.organizations for insert
  with check (auth.uid() = owner_user_id);

drop policy if exists "Org owner can update organization" on public.organizations;
create policy "Org owner can update organization"
  on public.organizations for update
  using (auth.uid() = owner_user_id);

-- Políticas Organization Members
drop policy if exists "Org members can select members" on public.organization_members;
create policy "Org members can select members"
  on public.organization_members for select
  using (public.is_org_member(organization_id));

drop policy if exists "Org admins can manage members" on public.organization_members;
create policy "Org admins can manage members"
  on public.organization_members for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- Políticas Units, Specialties, Services, Patients, Professionals, Professional Specialties
drop policy if exists "Org members can view units" on public.units;
create policy "Org members can view units"
  on public.units for select using (public.is_org_member(organization_id));
drop policy if exists "Org admins can manage units" on public.units;
create policy "Org admins can manage units"
  on public.units for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists "Org members can view specialties" on public.specialties;
create policy "Org members can view specialties"
  on public.specialties for select using (public.is_org_member(organization_id));
drop policy if exists "Org admins can manage specialties" on public.specialties;
create policy "Org admins can manage specialties"
  on public.specialties for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists "Org members can view services" on public.services;
create policy "Org members can view services"
  on public.services for select using (public.is_org_member(organization_id));
drop policy if exists "Org admins can manage services" on public.services;
create policy "Org admins can manage services"
  on public.services for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists "Org members can view patients" on public.patients;
create policy "Org members can view patients"
  on public.patients for select using (public.is_org_member(organization_id));
drop policy if exists "Org members can manage patients" on public.patients;
create policy "Org members can manage patients"
  on public.patients for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

drop policy if exists "Org members can view professionals" on public.professionals;
create policy "Org members can view professionals"
  on public.professionals for select using (public.is_org_member(organization_id));
drop policy if exists "Org admins can manage professionals" on public.professionals;
create policy "Org admins can manage professionals"
  on public.professionals for all using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

drop policy if exists "Org members can view professional specialties" on public.professional_specialties;
create policy "Org members can view professional specialties"
  on public.professional_specialties for select
  using (exists (select 1 from public.professionals p where p.id = professional_id and public.is_org_member(p.organization_id)));
drop policy if exists "Org admins can manage professional specialties" on public.professional_specialties;
create policy "Org admins can manage professional specialties"
  on public.professional_specialties for all
  using (exists (select 1 from public.professionals p where p.id = professional_id and public.is_org_admin(p.organization_id)))
  with check (exists (select 1 from public.professionals p where p.id = professional_id and public.is_org_admin(p.organization_id)));

-- Políticas Schedules
drop policy if exists "Authorized users can view schedules" on public.schedules;
create policy "Authorized users can view schedules"
  on public.schedules for select
  using (public.can_operate_schedule(id, 'view'));

drop policy if exists "Org admins can manage schedules" on public.schedules;
create policy "Org admins can manage schedules"
  on public.schedules for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- Políticas Schedule Managers
drop policy if exists "Authorized users can view schedule managers" on public.schedule_managers;
create policy "Authorized users can view schedule managers"
  on public.schedule_managers for select
  using (public.can_operate_schedule(schedule_id, 'view'));

drop policy if exists "Org admins can manage schedule managers" on public.schedule_managers;
create policy "Org admins can manage schedule managers"
  on public.schedule_managers for all
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- Políticas Availability Rules
drop policy if exists "Authorized users can view availability" on public.availability_rules;
create policy "Authorized users can view availability"
  on public.availability_rules for select
  using (public.can_operate_schedule(schedule_id, 'view'));

drop policy if exists "Authorized users can manage availability" on public.availability_rules;
create policy "Authorized users can manage availability"
  on public.availability_rules for all
  using (public.can_operate_schedule(schedule_id, 'availability'))
  with check (public.can_operate_schedule(schedule_id, 'availability'));

-- Políticas Schedule Blocks
drop policy if exists "Org members can view blocks" on public.schedule_blocks;
create policy "Org members can view blocks"
  on public.schedule_blocks for select
  using (
    (schedule_id is null and public.is_org_member(organization_id))
    or (schedule_id is not null and public.can_operate_schedule(schedule_id, 'view'))
  );

drop policy if exists "Authorized users can manage blocks" on public.schedule_blocks;
create policy "Authorized users can manage blocks"
  on public.schedule_blocks for all
  using (
    (schedule_id is null and public.is_org_admin(organization_id))
    or (schedule_id is not null and public.can_operate_schedule(schedule_id, 'blocks'))
  )
  with check (
    (schedule_id is null and public.is_org_admin(organization_id))
    or (schedule_id is not null and public.can_operate_schedule(schedule_id, 'blocks'))
  );

-- Políticas Appointments
drop policy if exists "Authorized users can view appointments" on public.appointments;
create policy "Authorized users can view appointments"
  on public.appointments for select
  using (public.can_operate_schedule(schedule_id, 'view'));

drop policy if exists "Authorized users can insert appointments" on public.appointments;
create policy "Authorized users can insert appointments"
  on public.appointments for insert
  with check (public.can_operate_schedule(schedule_id, 'appointments'));

drop policy if exists "Authorized users can update appointments" on public.appointments;
create policy "Authorized users can update appointments"
  on public.appointments for update
  using (public.can_operate_schedule(schedule_id, 'appointments'))
  with check (public.can_operate_schedule(schedule_id, 'appointments'));

-- Políticas Audit Logs
drop policy if exists "Authorized users can view audit logs" on public.appointment_audit_logs;
create policy "Authorized users can view audit logs"
  on public.appointment_audit_logs for select
  using (
    public.is_org_admin(organization_id)
    or (schedule_id is not null and public.can_operate_schedule(schedule_id, 'view'))
  );

drop policy if exists "Org members can insert audit logs" on public.appointment_audit_logs;
create policy "Org members can insert audit logs"
  on public.appointment_audit_logs for insert
  with check (public.is_org_member(organization_id));
