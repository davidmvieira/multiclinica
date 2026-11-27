-- Migration: Épico 4 (EP04) - Atendimentos, Evolução Clínica, Fila de Pendências, Retificação Rastreável e Exportação Oficial
-- Executar no SQL Editor do Supabase (Seção 9 do sql.md)

create extension if not exists pgcrypto;

-- Garante funções auxiliares idempotentes caso Seções 7/8 não tenham sido aplicadas isoladamente
create or replace function public.can_author_clinical_record(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = target_org_id and o.owner_user_id = auth.uid()
  )
  or exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org_id
      and m.user_id = auth.uid()
      and m.is_active is distinct from false
      and m.role in ('admin', 'unit_manager', 'professional')
  )
  or exists (
    select 1 from public.professionals p
    where p.organization_id = target_org_id
      and p.user_id = auth.uid()
      and p.is_active is distinct from false
  );
$$;

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Registros de auditoria e retificações clínicas são imutáveis.'
    using errcode = '42501';
end;
$$;

-- 1. Evoluções Clínicas vinculadas obrigatoriamente ao Atendimento (Encounter)
create table if not exists public.clinical_evolutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  patient_id uuid references public.patients(id) on delete cascade not null,
  appointment_id uuid references public.appointments(id) on delete restrict not null,
  professional_id uuid references public.professionals(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  shared_clinical_note text not null default '',
  procedures_performed text,
  patient_response text,
  eva_before integer check (eva_before between 0 and 10),
  eva_after integer check (eva_after between 0 and 10),
  adherence_level text check (adherence_level in ('total', 'parcial', 'baixa')),
  next_session_plan text,
  restricted_clinical_record text,
  restricted_category text,
  author_user_id uuid references auth.users(id) on delete set null not null,
  author_name text not null,
  author_council_number text,
  source_ip text not null default '0.0.0.0',
  finalized_at_utc timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_clinical_evolutions_finalized_appt
  on public.clinical_evolutions (appointment_id)
  where status = 'finalized';

create unique index if not exists uq_clinical_evolutions_author_appt
  on public.clinical_evolutions (appointment_id, author_user_id);

create index if not exists idx_clinical_evolutions_org_patient
  on public.clinical_evolutions (organization_id, patient_id, created_at desc);

create index if not exists idx_clinical_evolutions_org_author
  on public.clinical_evolutions (organization_id, author_user_id, status);

-- Garante vínculo com atendimento realizado e imutabilidade pós-conclusão
create or replace function public.enforce_clinical_evolution_immutability()
returns trigger
language plpgsql
as $$
declare
  v_appt_status text;
  v_appt_org uuid;
  v_appt_patient uuid;
begin
  if tg_op = 'DELETE' then
    if old.status = 'finalized' then
      raise exception 'Evoluções clínicas concluídas são imutáveis e não podem ser excluídas.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'finalized' then
      raise exception 'Evoluções clínicas concluídas são imutáveis. Utilize uma Nota de Retificação rastreável.'
        using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;

  select a.status, a.organization_id, a.patient_id
  into v_appt_status, v_appt_org, v_appt_patient
  from public.appointments a
  where a.id = new.appointment_id;

  if v_appt_org is null or v_appt_org <> new.organization_id or v_appt_patient <> new.patient_id then
    raise exception 'Atendimento vinculado inválido para esta organização ou paciente.'
      using errcode = '23514';
  end if;

  if v_appt_status <> 'completed' then
    raise exception 'A evolução clínica só pode ser vinculada a um atendimento com status Realizado.'
      using errcode = '23514';
  end if;

  if new.status = 'finalized' then
    if char_length(trim(coalesce(new.shared_clinical_note, ''))) < 5 then
      raise exception 'Informe o texto da evolução clínica compartilhada antes de concluir.'
        using errcode = '23514';
    end if;
    if char_length(trim(coalesce(new.author_council_number, ''))) < 3 then
      raise exception 'Informe o registro no conselho profissional (ex.: CREFITO) para concluir.'
        using errcode = '23514';
    end if;
    new.finalized_at_utc := coalesce(new.finalized_at_utc, timezone('utc', now()));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_clinical_evolution_immutability on public.clinical_evolutions;
create trigger trg_enforce_clinical_evolution_immutability
  before insert or update or delete on public.clinical_evolutions
  for each row execute function public.enforce_clinical_evolution_immutability();

-- 2. Notas de Retificação Rastreáveis e Imutáveis (US04.3)
create table if not exists public.evolution_rectifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  evolution_id uuid references public.clinical_evolutions(id) on delete cascade not null,
  patient_id uuid references public.patients(id) on delete cascade not null,
  rectified_content text not null,
  justification text not null,
  author_user_id uuid references auth.users(id) on delete set null not null,
  author_name text not null,
  author_council_number text,
  source_ip text not null default '0.0.0.0',
  created_at_utc timestamptz not null default timezone('utc', now())
);

create index if not exists idx_evolution_rectifications_eval
  on public.evolution_rectifications (evolution_id, created_at_utc asc);

drop trigger if exists trg_immutable_evolution_rectifications on public.evolution_rectifications;
create trigger trg_immutable_evolution_rectifications
  before update or delete on public.evolution_rectifications
  for each row execute function public.prevent_audit_mutation();

-- 3. Fila de Evoluções Pendentes (US04.2) gerada automaticamente ao marcar atendimento como Realizado
create table if not exists public.evolution_pendencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  appointment_id uuid references public.appointments(id) on delete cascade not null unique,
  patient_id uuid references public.patients(id) on delete cascade not null,
  professional_id uuid references public.professionals(id) on delete cascade not null,
  schedule_id uuid references public.schedules(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  session_starts_at timestamptz not null,
  session_ends_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'canceled')),
  evolution_id uuid references public.clinical_evolutions(id) on delete set null,
  resolved_at_utc timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_evolution_pendencies_org_prof_status
  on public.evolution_pendencies (organization_id, status, professional_id, session_starts_at desc);

create or replace function public.sync_evolution_pendency_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_finalized_eval_id uuid;
  v_finalized_at timestamptz;
begin
  if new.status = 'completed' then
    select ce.id, ce.finalized_at_utc
    into v_finalized_eval_id, v_finalized_at
    from public.clinical_evolutions ce
    where ce.appointment_id = new.id
      and ce.status = 'finalized'
    limit 1;

    insert into public.evolution_pendencies (
      organization_id, appointment_id, patient_id, professional_id,
      schedule_id, unit_id, session_starts_at, session_ends_at,
      status, evolution_id, resolved_at_utc
    )
    values (
      new.organization_id, new.id, new.patient_id, new.professional_id,
      new.schedule_id, new.unit_id, new.starts_at, new.ends_at,
      case when v_finalized_eval_id is not null then 'resolved' else 'pending' end,
      v_finalized_eval_id,
      v_finalized_at
    )
    on conflict (appointment_id) do update
      set patient_id = excluded.patient_id,
          professional_id = excluded.professional_id,
          schedule_id = excluded.schedule_id,
          unit_id = excluded.unit_id,
          session_starts_at = excluded.session_starts_at,
          session_ends_at = excluded.session_ends_at,
          status = case
            when public.evolution_pendencies.status = 'resolved' or v_finalized_eval_id is not null then 'resolved'
            else 'pending'
          end,
          evolution_id = coalesce(public.evolution_pendencies.evolution_id, v_finalized_eval_id),
          resolved_at_utc = coalesce(public.evolution_pendencies.resolved_at_utc, v_finalized_at),
          updated_at = now();
  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
    update public.evolution_pendencies
    set status = 'canceled',
        updated_at = now()
    where appointment_id = new.id
      and status = 'pending';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_evolution_pendency_from_appointment on public.appointments;
create trigger trg_sync_evolution_pendency_from_appointment
  after insert or update of status, professional_id, patient_id, starts_at, ends_at
  on public.appointments
  for each row execute function public.sync_evolution_pendency_from_appointment();

create or replace function public.resolve_evolution_pendency_on_finalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'finalized' then
    update public.evolution_pendencies
    set status = 'resolved',
        evolution_id = new.id,
        resolved_at_utc = coalesce(new.finalized_at_utc, timezone('utc', now())),
        updated_at = now()
    where appointment_id = new.appointment_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_resolve_evolution_pendency_on_finalize on public.clinical_evolutions;
create trigger trg_resolve_evolution_pendency_on_finalize
  after insert or update of status on public.clinical_evolutions
  for each row execute function public.resolve_evolution_pendency_on_finalize();

-- Backfill automático para sessões já marcadas como Realizado (completed)
insert into public.evolution_pendencies (
  organization_id, appointment_id, patient_id, professional_id,
  schedule_id, unit_id, session_starts_at, session_ends_at, status
)
select
  a.organization_id, a.id, a.patient_id, a.professional_id,
  a.schedule_id, a.unit_id, a.starts_at, a.ends_at, 'pending'
from public.appointments a
where a.status = 'completed'
  and not exists (
    select 1 from public.evolution_pendencies ep where ep.appointment_id = a.id
  )
on conflict (appointment_id) do nothing;

-- 4. Auditoria Contínua de Evoluções e Exportação Oficial (AuditEvent - US04.3)
create table if not exists public.clinical_evolution_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  evolution_id uuid references public.clinical_evolutions(id) on delete set null,
  patient_id uuid references public.patients(id) on delete cascade not null,
  appointment_id uuid references public.appointments(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null not null,
  user_name text,
  user_email text,
  action_executed text not null check (
    action_executed in (
      'CREATE_DRAFT',
      'VIEW_EVOLUTION',
      'FINALIZE_EVOLUTION',
      'ADD_RECTIFICATION',
      'EXPORT_PDF',
      'SHARE_SUMMARY',
      'EXPORT_OFFICIAL_RECORD',
      'DENIED_RESTRICTED_ACCESS'
    )
  ),
  source_ip text not null default '0.0.0.0',
  timestamp_utc timestamptz not null default timezone('utc', now()),
  details jsonb not null default '{}'::jsonb
);

create index if not exists idx_clin_evol_audit_org_time
  on public.clinical_evolution_audit_events (organization_id, timestamp_utc desc);

create index if not exists idx_clin_evol_audit_patient
  on public.clinical_evolution_audit_events (patient_id, timestamp_utc desc);

drop trigger if exists trg_immutable_clin_evol_audit_events on public.clinical_evolution_audit_events;
create trigger trg_immutable_clin_evol_audit_events
  before update or delete on public.clinical_evolution_audit_events
  for each row execute function public.prevent_audit_mutation();

-- 5. Políticas RLS Multi-Tenant e Proteção de Autoria
alter table public.clinical_evolutions enable row level security;
alter table public.evolution_rectifications enable row level security;
alter table public.evolution_pendencies enable row level security;
alter table public.clinical_evolution_audit_events enable row level security;

drop policy if exists "Org members can view finalized or own draft evolutions" on public.clinical_evolutions;
create policy "Org members can view finalized or own draft evolutions"
  on public.clinical_evolutions for select
  using (
    public.is_org_member(organization_id)
    and (
      status = 'finalized'
      or author_user_id = auth.uid()
    )
  );

drop policy if exists "Clinical authors can insert own evolutions" on public.clinical_evolutions;
create policy "Clinical authors can insert own evolutions"
  on public.clinical_evolutions for insert
  with check (
    public.can_author_clinical_record(organization_id)
    and author_user_id = auth.uid()
  );

drop policy if exists "Only author can update own draft evolutions" on public.clinical_evolutions;
create policy "Only author can update own draft evolutions"
  on public.clinical_evolutions for update
  using (
    status = 'draft'
    and author_user_id = auth.uid()
    and public.can_author_clinical_record(organization_id)
  )
  with check (
    author_user_id = auth.uid()
    and public.can_author_clinical_record(organization_id)
  );

drop policy if exists "Only author can delete own draft evolutions" on public.clinical_evolutions;
create policy "Only author can delete own draft evolutions"
  on public.clinical_evolutions for delete
  using (
    status = 'draft'
    and author_user_id = auth.uid()
  );

drop policy if exists "Org members can view evolution rectifications" on public.evolution_rectifications;
create policy "Org members can view evolution rectifications"
  on public.evolution_rectifications for select
  using (public.is_org_member(organization_id));

drop policy if exists "Clinical authors can insert own rectifications" on public.evolution_rectifications;
create policy "Clinical authors can insert own rectifications"
  on public.evolution_rectifications for insert
  with check (
    public.can_author_clinical_record(organization_id)
    and author_user_id = auth.uid()
  );

drop policy if exists "Org members can view evolution pendencies" on public.evolution_pendencies;
create policy "Org members can view evolution pendencies"
  on public.evolution_pendencies for select
  using (public.is_org_member(organization_id));

drop policy if exists "Admins or actors can view clinical evolution audit events" on public.clinical_evolution_audit_events;
create policy "Admins or actors can view clinical evolution audit events"
  on public.clinical_evolution_audit_events for select
  using (
    public.is_org_admin(organization_id)
    or user_id = auth.uid()
  );

drop policy if exists "Org members can insert own clinical evolution audit events" on public.clinical_evolution_audit_events;
create policy "Org members can insert own clinical evolution audit events"
  on public.clinical_evolution_audit_events for insert
  with check (
    public.is_org_member(organization_id)
    and user_id = auth.uid()
  );

notify pgrst, 'reload schema';
