-- Migration: Épico 2 (EP02) - Gestão Única de Pacientes, Prevenção de Duplicidades e Prontuário Longitudinal Imutável
-- Executar no SQL Editor do Supabase (Seção 7 do sql.md)

create extension if not exists pgcrypto;

-- 1. Evolução da tabela public.patients (dados pessoais, contatos, emergência, responsável legal e situação operacional)
alter table public.patients add column if not exists social_name text;
alter table public.patients add column if not exists cpf text;
alter table public.patients add column if not exists cpf_digits text;
alter table public.patients add column if not exists has_no_cpf boolean not null default false;
alter table public.patients add column if not exists alt_identifier_type text;
alter table public.patients add column if not exists alt_identifier_value text;
alter table public.patients add column if not exists birth_date date;
alter table public.patients add column if not exists gender text;
alter table public.patients add column if not exists secondary_phone text;
alter table public.patients add column if not exists address_zip text;
alter table public.patients add column if not exists address_street text;
alter table public.patients add column if not exists address_number text;
alter table public.patients add column if not exists address_complement text;
alter table public.patients add column if not exists address_neighborhood text;
alter table public.patients add column if not exists address_city text;
alter table public.patients add column if not exists address_state text;
alter table public.patients add column if not exists legal_guardian_name text;
alter table public.patients add column if not exists legal_guardian_relationship text;
alter table public.patients add column if not exists legal_guardian_phone text;
alter table public.patients add column if not exists legal_guardian_cpf text;
alter table public.patients add column if not exists emergency_contact_name text;
alter table public.patients add column if not exists emergency_contact_relationship text;
alter table public.patients add column if not exists emergency_contact_phone text;
alter table public.patients add column if not exists status text not null default 'em_avaliacao';
alter table public.patients add column if not exists notes text;
alter table public.patients add column if not exists updated_at timestamptz not null default now();
alter table public.patients add column if not exists updated_by uuid references auth.users(id) on delete set null;

-- Normaliza cpf_digits e status legados na tabela patients
update public.patients
set cpf_digits = nullif(regexp_replace(coalesce(cpf, ''), '\D', '', 'g'), '')
where cpf is not null
  and (cpf_digits is null or cpf_digits = '');

update public.patients
set status = 'em_avaliacao'
where status is null
   or status not in (
     'em_avaliacao',
     'em_tratamento',
     'em_acompanhamento',
     'alta',
     'inativo',
     'desistencia'
   );

-- Remove check constraint legado de status caso exista e aplica o conjunto oficial de situações
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.patients'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.patients drop constraint if exists %I', c.conname);
  end loop;

  alter table public.patients
    add constraint patients_status_check
    check (status in (
      'em_avaliacao',
      'em_tratamento',
      'em_acompanhamento',
      'alta',
      'inativo',
      'desistencia'
    ));
end $$;

-- Índice único por organização + CPF normalizado (quando houver CPF)
do $$
begin
  if not exists (
    select 1
    from public.patients
    where cpf_digits is not null and cpf_digits <> ''
    group by organization_id, cpf_digits
    having count(*) > 1
  ) then
    execute 'create unique index if not exists uq_patients_org_cpf_digits on public.patients (organization_id, cpf_digits) where cpf_digits is not null and cpf_digits <> ''''';
  end if;
end $$;

create index if not exists idx_patients_org_status on public.patients (organization_id, status);
create index if not exists idx_patients_org_name on public.patients (organization_id, name);

-- Sincroniza cpf_digits automaticamente no insert/update de pacientes
create or replace function public.sync_patients_cpf_and_updated()
returns trigger
language plpgsql
as $$
begin
  if new.cpf is not null and trim(new.cpf) <> '' then
    new.cpf_digits := nullif(regexp_replace(new.cpf, '\D', '', 'g'), '');
  else
    new.cpf := null;
    new.cpf_digits := null;
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_patients_cpf_and_updated on public.patients;
create trigger trg_sync_patients_cpf_and_updated
  before insert or update on public.patients
  for each row execute function public.sync_patients_cpf_and_updated();

-- 2. Auditoria de alterações cadastrais de pacientes
create table if not exists public.patient_audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  patient_id uuid references public.patients(id) on delete cascade not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  actor_email text,
  action text not null check (action in ('created', 'updated', 'status_changed')),
  changed_fields jsonb not null default '[]'::jsonb,
  previous_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_patient_audit_logs_patient
  on public.patient_audit_logs (organization_id, patient_id, created_at desc);

-- Imutabilidade de logs de auditoria cadastral
create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Registros de auditoria são somente leitura e não podem ser modificados ou excluídos.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_immutable_patient_audit_logs on public.patient_audit_logs;
create trigger trg_immutable_patient_audit_logs
  before update or delete on public.patient_audit_logs
  for each row execute function public.prevent_audit_mutation();

-- 3. Prontuário Longitudinal Categorizado (Registros Clínicos, Administrativos e Documentos Anexados)
create table if not exists public.medical_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  patient_id uuid references public.patients(id) on delete cascade not null,
  appointment_id uuid references public.appointments(id) on delete set null,
  professional_id uuid references public.professionals(id) on delete set null,
  category text not null check (category in ('clinical', 'administrative', 'document')),
  record_type text not null default 'evolucao',
  title text not null,
  content text not null,
  occurred_at timestamptz not null default now(),
  is_finalized boolean not null default true,
  finalized_at timestamptz,
  finalized_by uuid references auth.users(id) on delete set null,
  author_user_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  author_email text,
  document_url text,
  document_name text,
  document_mime text,
  document_size_bytes integer,
  document_data_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_medical_records_patient_occurred
  on public.medical_records (organization_id, patient_id, occurred_at desc, created_at desc);

-- Trigger de imutabilidade no banco: registros concluídos não podem ser alterados nem excluídos
create or replace function public.enforce_medical_record_immutability()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_finalized or old.category = 'clinical' then
      raise exception 'Registros clínicos e registros concluídos do prontuário são imutáveis e não podem ser excluídos.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.is_finalized then
      raise exception 'Registros concluídos do prontuário não podem ser alterados diretamente. Utilize uma nota corretiva.'
        using errcode = '42501';
    end if;
    new.updated_at := now();
    if new.is_finalized and not old.is_finalized then
      new.finalized_at := coalesce(new.finalized_at, now());
      new.finalized_by := coalesce(new.finalized_by, auth.uid());
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_medical_record_immutability on public.medical_records;
create trigger trg_enforce_medical_record_immutability
  before update or delete on public.medical_records
  for each row execute function public.enforce_medical_record_immutability();

-- 4. Notas Corretivas (Adendos Rastreáveis e Imutáveis)
create table if not exists public.medical_record_addenda (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  record_id uuid references public.medical_records(id) on delete restrict not null,
  patient_id uuid references public.patients(id) on delete cascade not null,
  author_user_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  author_email text,
  justification text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_medical_record_addenda_record
  on public.medical_record_addenda (record_id, created_at asc);

drop trigger if exists trg_immutable_medical_record_addenda on public.medical_record_addenda;
create trigger trg_immutable_medical_record_addenda
  before update or delete on public.medical_record_addenda
  for each row execute function public.prevent_audit_mutation();

-- 5. Função auxiliar de autoria clínica + RLS
create or replace function public.can_author_clinical_record(target_org_id uuid)
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
      and coalesce(m.is_active, true) = true
      and m.role in ('admin', 'unit_manager', 'professional')
  )
  or exists (
    select 1
    from public.professionals p
    where p.organization_id = target_org_id
      and p.user_id = auth.uid()
      and p.is_active = true
  );
$$;

alter table public.patient_audit_logs enable row level security;
alter table public.medical_records enable row level security;
alter table public.medical_record_addenda enable row level security;

-- Políticas patient_audit_logs (append-only)
drop policy if exists "Org members can view patient audit logs" on public.patient_audit_logs;
create policy "Org members can view patient audit logs"
  on public.patient_audit_logs for select
  using (public.is_org_member(organization_id));

drop policy if exists "Org members can insert patient audit logs" on public.patient_audit_logs;
create policy "Org members can insert patient audit logs"
  on public.patient_audit_logs for insert
  with check (public.is_org_member(organization_id));

-- Políticas medical_records (imutabilidade reforçada via RLS + trigger)
drop policy if exists "Org members can view medical records" on public.medical_records;
create policy "Org members can view medical records"
  on public.medical_records for select
  using (public.is_org_member(organization_id));

drop policy if exists "Authorized users can insert medical records" on public.medical_records;
create policy "Authorized users can insert medical records"
  on public.medical_records for insert
  with check (
    public.is_org_member(organization_id)
    and (
      category <> 'clinical'
      or public.can_author_clinical_record(organization_id)
    )
  );

drop policy if exists "Author or admin can update unfinalized draft records" on public.medical_records;
create policy "Author or admin can update unfinalized draft records"
  on public.medical_records for update
  using (
    not is_finalized
    and public.is_org_member(organization_id)
    and (
      author_user_id = auth.uid()
      or public.is_org_admin(organization_id)
    )
  )
  with check (
    public.is_org_member(organization_id)
    and (
      category <> 'clinical'
      or public.can_author_clinical_record(organization_id)
    )
  );

drop policy if exists "Author or admin can delete non-clinical drafts only" on public.medical_records;
create policy "Author or admin can delete non-clinical drafts only"
  on public.medical_records for delete
  using (
    not is_finalized
    and category <> 'clinical'
    and (
      author_user_id = auth.uid()
      or public.is_org_admin(organization_id)
    )
  );

-- Políticas medical_record_addenda (notas corretivas append-only)
drop policy if exists "Org members can view medical record addenda" on public.medical_record_addenda;
create policy "Org members can view medical record addenda"
  on public.medical_record_addenda for select
  using (public.is_org_member(organization_id));

drop policy if exists "Clinical users can insert medical record addenda" on public.medical_record_addenda;
create policy "Clinical users can insert medical record addenda"
  on public.medical_record_addenda for insert
  with check (public.can_author_clinical_record(organization_id));

notify pgrst, 'reload schema';
