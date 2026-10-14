-- Admins can remove users (via the admin-delete-user Edge Function).
-- Users with no challans are deleted outright. Users who entered or edited
-- challans are "disabled" instead: login is banned and access revoked, but the
-- profile row stays so "Entered by" on old challans keeps their name.
-- Safe to run on a database that already has data: it only adds a column.

alter table public.profiles add column if not exists disabled boolean not null default false;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and not disabled and (approved or role = 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and not disabled
  );
$$;
