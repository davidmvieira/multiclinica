-- Migration: Admin Settings (usuários da organização, gestão de profissionais e unidades)

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
