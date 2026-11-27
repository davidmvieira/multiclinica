-- Migration: Épico 3 (EP03) - Digitalização Fiel de Avaliações, Versionamento de Modelos, CBDF e Governança LGPD
-- Executar no SQL Editor do Supabase (Seção 8 do sql.md)

create extension if not exists pgcrypto;

-- 1. Catálogo de Modelos de Avaliação por Organização
create table if not exists public.evaluation_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  slug text not null,
  name text not null,
  category_label text not null,
  description text,
  current_version_number integer not null default 1,
  current_version_id uuid,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create index if not exists idx_evaluation_templates_org
  on public.evaluation_templates (organization_id, name);

-- 2. Versões Estruturais Imutáveis dos Modelos (US03.2)
create table if not exists public.evaluation_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  template_id uuid references public.evaluation_templates(id) on delete cascade not null,
  version_number integer not null check (version_number >= 1),
  changelog text,
  schema_json jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  unique (template_id, version_number)
);

create index if not exists idx_eval_template_versions_template
  on public.evaluation_template_versions (template_id, version_number desc);

-- Garante que versões já publicadas de modelos nunca sejam sobrescritas ou excluídas
create or replace function public.prevent_template_version_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Versões publicadas de modelos de avaliação são imutáveis. Crie uma nova versão incrementada.'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_immutable_evaluation_template_versions on public.evaluation_template_versions;
create trigger trg_immutable_evaluation_template_versions
  before update or delete on public.evaluation_template_versions
  for each row execute function public.prevent_template_version_mutation();

-- 3. Avaliações Clínicas Preenchidas (US03.1 & US03.3)
create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  patient_id uuid references public.patients(id) on delete cascade not null,
  professional_id uuid references public.professionals(id) on delete set null,
  template_id uuid references public.evaluation_templates(id) on delete restrict not null,
  template_version_id uuid references public.evaluation_template_versions(id) on delete restrict not null,
  template_version_number integer not null,
  template_name text not null,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  answers jsonb not null default '{}'::jsonb,
  shared_summary text,
  functional_diagnosis text,
  cbdf_code text,
  cbdf_description text,
  procedure_code text,
  procedure_description text,
  author_user_id uuid references auth.users(id) on delete set null not null,
  author_name text not null,
  author_council_number text,
  finalized_at_utc timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_evaluations_org_patient
  on public.evaluations (organization_id, patient_id, created_at desc);

create index if not exists idx_evaluations_org_status
  on public.evaluations (organization_id, status, created_at desc);

-- Trigger de imutabilidade no banco: avaliações concluídas nunca podem ser alteradas ou excluídas
create or replace function public.enforce_evaluation_immutability()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'finalized' then
      raise exception 'Avaliações clínicas concluídas são imutáveis e não podem ser excluídas.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'finalized' then
      raise exception 'Avaliações clínicas concluídas são imutáveis e não podem ser editadas após a conclusão.'
        using errcode = '42501';
    end if;

    new.updated_at := now();
    if new.status = 'finalized' and old.status <> 'finalized' then
      new.finalized_at_utc := coalesce(new.finalized_at_utc, timezone('utc', now()));
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_evaluation_immutability on public.evaluations;
create trigger trg_enforce_evaluation_immutability
  before update or delete on public.evaluations
  for each row execute function public.enforce_evaluation_immutability();

-- 4. Auditoria de Acesso e Compartilhamento LGPD (AuditEvent - US03.3)
create table if not exists public.evaluation_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade not null,
  evaluation_id uuid references public.evaluations(id) on delete cascade not null,
  patient_id uuid references public.patients(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete set null not null,
  user_name text,
  user_email text,
  action_executed text not null check (
    action_executed in (
      'OPEN_DRAFT',
      'VIEW_EVALUATION',
      'FINALIZE_EVALUATION',
      'EXPORT_PDF',
      'SHARE_SUMMARY',
      'DENIED_RESTRICTED_ACCESS'
    )
  ),
  source_ip text not null default '0.0.0.0',
  timestamp_utc timestamptz not null default timezone('utc', now()),
  details jsonb not null default '{}'::jsonb
);

create index if not exists idx_eval_audit_events_org_time
  on public.evaluation_audit_events (organization_id, timestamp_utc desc);

create index if not exists idx_eval_audit_events_eval
  on public.evaluation_audit_events (evaluation_id, timestamp_utc desc);

drop trigger if exists trg_immutable_evaluation_audit_events on public.evaluation_audit_events;
create trigger trg_immutable_evaluation_audit_events
  before update or delete on public.evaluation_audit_events
  for each row execute function public.prevent_audit_mutation();

-- 5. Políticas RLS multi-tenant e proteção estrita de rascunhos
alter table public.evaluation_templates enable row level security;
alter table public.evaluation_template_versions enable row level security;
alter table public.evaluations enable row level security;
alter table public.evaluation_audit_events enable row level security;

-- Templates
drop policy if exists "Org members can view evaluation templates" on public.evaluation_templates;
create policy "Org members can view evaluation templates"
  on public.evaluation_templates for select
  using (public.is_org_member(organization_id));

drop policy if exists "Clinical authors can manage evaluation templates" on public.evaluation_templates;
create policy "Clinical authors can manage evaluation templates"
  on public.evaluation_templates for all
  using (public.can_author_clinical_record(organization_id))
  with check (public.can_author_clinical_record(organization_id));

-- Template Versions (append-only)
drop policy if exists "Org members can view evaluation template versions" on public.evaluation_template_versions;
create policy "Org members can view evaluation template versions"
  on public.evaluation_template_versions for select
  using (public.is_org_member(organization_id));

drop policy if exists "Clinical authors can insert evaluation template versions" on public.evaluation_template_versions;
create policy "Clinical authors can insert evaluation template versions"
  on public.evaluation_template_versions for insert
  with check (public.can_author_clinical_record(organization_id));

-- Evaluations: rascunhos visíveis/editáveis SOMENTE pelo autor; concluídas visíveis pela equipe da organização
drop policy if exists "Org members can view finalized or own draft evaluations" on public.evaluations;
create policy "Org members can view finalized or own draft evaluations"
  on public.evaluations for select
  using (
    public.is_org_member(organization_id)
    and (
      status = 'finalized'
      or author_user_id = auth.uid()
    )
  );

drop policy if exists "Clinical authors can insert own evaluations" on public.evaluations;
create policy "Clinical authors can insert own evaluations"
  on public.evaluations for insert
  with check (
    public.can_author_clinical_record(organization_id)
    and author_user_id = auth.uid()
  );

drop policy if exists "Only author can update draft evaluations" on public.evaluations;
create policy "Only author can update draft evaluations"
  on public.evaluations for update
  using (
    status = 'draft'
    and author_user_id = auth.uid()
    and public.can_author_clinical_record(organization_id)
  )
  with check (
    author_user_id = auth.uid()
    and public.can_author_clinical_record(organization_id)
  );

drop policy if exists "Only author can delete draft evaluations" on public.evaluations;
create policy "Only author can delete draft evaluations"
  on public.evaluations for delete
  using (
    status = 'draft'
    and author_user_id = auth.uid()
  );

-- AuditEvents (append-only)
drop policy if exists "Admins or authors can view evaluation audit events" on public.evaluation_audit_events;
create policy "Admins or authors can view evaluation audit events"
  on public.evaluation_audit_events for select
  using (
    public.is_org_admin(organization_id)
    or user_id = auth.uid()
  );

drop policy if exists "Org members can insert own evaluation audit events" on public.evaluation_audit_events;
create policy "Org members can insert own evaluation audit events"
  on public.evaluation_audit_events for insert
  with check (
    public.is_org_member(organization_id)
    and user_id = auth.uid()
  );

notify pgrst, 'reload schema';
