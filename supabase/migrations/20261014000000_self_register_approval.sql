-- Self-registration from the login page, with admin approval.
-- New sign-ups get role 'user' and approved = false; they can't read or write
-- any data until an admin approves them on the Users page.

alter table public.profiles add column if not exists approved boolean not null default false;

-- Everyone who existed before this migration was created by an admin
update public.profiles set approved = true where approved = false;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and (approved or role = 'admin')
  );
$$;

grant execute on function public.is_approved() to authenticated;

-- Users created by an admin (Edge Function sets app_metadata.approved) are approved
-- immediately; self-registered users are not. Role can never be self-assigned.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, approved)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    case when new.raw_app_meta_data ->> 'role' = 'admin' then 'admin' else 'user' end,
    coalesce((new.raw_app_meta_data ->> 'approved')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Policies: data access requires an approved account
-- ---------------------------------------------------------------------------
drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select to authenticated using (public.is_approved());

drop policy if exists challans_select on public.challans;
create policy challans_select on public.challans
  for select to authenticated using (public.is_approved());

drop policy if exists challans_insert on public.challans;
create policy challans_insert on public.challans
  for insert to authenticated with check (public.is_approved() and created_by = auth.uid());

drop policy if exists challans_update on public.challans;
create policy challans_update on public.challans
  for update to authenticated using (public.is_approved()) with check (updated_by = auth.uid());

drop policy if exists items_select on public.challan_items;
create policy items_select on public.challan_items
  for select to authenticated using (public.is_approved());

drop policy if exists items_write on public.challan_items;
create policy items_write on public.challan_items
  for all to authenticated using (public.is_approved()) with check (public.is_approved());

-- Profiles stay readable (a pending user must read their own row to see the
-- "waiting for approval" screen), but only approved users see everyone else.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_approved());

-- ---------------------------------------------------------------------------
-- RPCs: block pending users
-- ---------------------------------------------------------------------------
create or replace function public.next_dc_no()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Your account is waiting for admin approval';
  end if;
  return 'DC-' || lpad(nextval('public.dc_no_seq')::text, 5, '0');
end;
$$;

create or replace function public.dc_exists(p_dc_no text, p_exclude_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_approved() and exists (
    select 1 from public.challans
    where upper(trim(dc_no)) = upper(trim(p_dc_no))
      and (p_exclude_id is null or id <> p_exclude_id)
  );
$$;
