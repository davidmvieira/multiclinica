-- Migration: Multi-clínica, múltiplas unidades por profissional, vínculo automático completo e atualização direta de senha sem SMTP

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

  -- Caso o profissional tenha sido cadastrado em public.professionals antes de existir em organization_members
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

-- Atualização direta de senha no banco (para uso enquanto o envio de e-mail/SMTP não estiver configurado)
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
