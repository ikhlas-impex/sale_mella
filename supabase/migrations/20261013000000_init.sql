-- Elkitch Mega Sale – Delivery Challan schema
-- Run in Supabase SQL editor or with `supabase db push`.

-- ---------------------------------------------------------------------------
-- Profiles & roles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  role        text not null default 'user' check (role in ('admin', 'user')),
  created_at  timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Create a profile automatically for every new auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when new.raw_app_meta_data ->> 'role' = 'admin' then 'admin' else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Master data: products
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  unit         text not null default 'pcs',
  price_basis  text not null default 'quantity' check (price_basis in ('quantity', 'weight')),
  price        numeric(12, 2) not null check (price >= 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Delivery challans
-- ---------------------------------------------------------------------------
create sequence if not exists public.dc_no_seq start 1;

create table if not exists public.challans (
  id             uuid primary key default gen_random_uuid(),
  dc_no          text not null,
  dc_date        date not null default current_date,
  customer_name  text not null,
  sub_total      numeric(12, 2) not null default 0,
  discount       numeric(12, 2) not null default 0 check (discount >= 0),
  final_amount   numeric(12, 2) not null default 0,
  payment_mode   text not null check (payment_mode in ('cash', 'bank')),
  is_split       boolean not null default false,
  cash_amount    numeric(12, 2) not null default 0,
  bank_amount    numeric(12, 2) not null default 0,
  created_by     uuid not null default auth.uid() references public.profiles (id),
  updated_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- DC numbers are unique ignoring case / surrounding spaces
create unique index if not exists challans_dc_no_key on public.challans (upper(trim(dc_no)));
create index if not exists challans_dc_date_idx on public.challans (dc_date);

create table if not exists public.challan_items (
  id            uuid primary key default gen_random_uuid(),
  challan_id    uuid not null references public.challans (id) on delete cascade,
  sl_no         int not null,
  product_id    uuid not null references public.products (id),
  product_name  text not null,
  weight        numeric(12, 3),
  quantity      numeric(12, 3) not null default 0,
  price         numeric(12, 2) not null,
  amount        numeric(12, 2) not null
);

create index if not exists challan_items_challan_idx on public.challan_items (challan_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.products      enable row level security;
alter table public.challans      enable row level security;
alter table public.challan_items enable row level security;

-- profiles: everyone signed in can read names (to show "entered by"); only admins edit
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- products: read for all signed-in users, write for admins only
drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select to authenticated using (true);

drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- challans: all signed-in users read/create/edit; only admins delete.
-- Inserts/updates go through save_challan(), which stamps created_by/updated_by.
drop policy if exists challans_select on public.challans;
create policy challans_select on public.challans
  for select to authenticated using (true);

drop policy if exists challans_insert on public.challans;
create policy challans_insert on public.challans
  for insert to authenticated with check (created_by = auth.uid());

drop policy if exists challans_update on public.challans;
create policy challans_update on public.challans
  for update to authenticated using (true) with check (updated_by = auth.uid());

drop policy if exists challans_admin_delete on public.challans;
create policy challans_admin_delete on public.challans
  for delete to authenticated using (public.is_admin());

drop policy if exists items_select on public.challan_items;
create policy items_select on public.challan_items
  for select to authenticated using (true);

drop policy if exists items_write on public.challan_items;
create policy items_write on public.challan_items
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- RPC: next DC number (reserved from a sequence, so concurrent users never clash)
-- ---------------------------------------------------------------------------
create or replace function public.next_dc_no()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'DC-' || lpad(nextval('public.dc_no_seq')::text, 5, '0');
$$;

-- ---------------------------------------------------------------------------
-- RPC: duplicate DC check
-- ---------------------------------------------------------------------------
create or replace function public.dc_exists(p_dc_no text, p_exclude_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.challans
    where upper(trim(dc_no)) = upper(trim(p_dc_no))
      and (p_exclude_id is null or id <> p_exclude_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- RPC: save challan + items atomically.
-- Prices come from master data; amounts are recomputed here.
-- payload = {
--   id?, dc_no, dc_date, customer_name, discount, payment_mode, is_split,
--   cash_amount, bank_amount,
--   items: [{ product_id, weight, quantity }]
-- }
-- ---------------------------------------------------------------------------
create or replace function public.save_challan(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id        uuid := nullif(payload ->> 'id', '')::uuid;
  v_dc_no     text := trim(payload ->> 'dc_no');
  v_discount  numeric := coalesce((payload ->> 'discount')::numeric, 0);
  v_is_split  boolean := coalesce((payload ->> 'is_split')::boolean, false);
  v_mode      text := payload ->> 'payment_mode';
  v_cash      numeric := coalesce((payload ->> 'cash_amount')::numeric, 0);
  v_bank      numeric := coalesce((payload ->> 'bank_amount')::numeric, 0);
  v_sub_total numeric := 0;
  v_final     numeric;
  v_item      jsonb;
  v_product   public.products%rowtype;
  v_qty       numeric;
  v_weight    numeric;
  v_amount    numeric;
  v_sl        int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if v_dc_no is null or v_dc_no = '' then
    raise exception 'DC No. is required';
  end if;
  if coalesce(trim(payload ->> 'customer_name'), '') = '' then
    raise exception 'Name is required';
  end if;
  if jsonb_array_length(coalesce(payload -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item';
  end if;
  if public.dc_exists(v_dc_no, v_id) then
    raise exception 'Duplicate DC No.: % already exists', v_dc_no using errcode = '23505';
  end if;

  -- header
  if v_id is null then
    insert into public.challans (dc_no, dc_date, customer_name, payment_mode, is_split, created_by, updated_by)
    values (v_dc_no, (payload ->> 'dc_date')::date, trim(payload ->> 'customer_name'),
            coalesce(v_mode, 'cash'), v_is_split, auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.challans
       set dc_no = v_dc_no,
           dc_date = (payload ->> 'dc_date')::date,
           customer_name = trim(payload ->> 'customer_name'),
           updated_by = auth.uid(),
           updated_at = now()
     where id = v_id;
    if not found then
      raise exception 'Challan not found';
    end if;
    delete from public.challan_items where challan_id = v_id;
  end if;

  -- items
  for v_item in select * from jsonb_array_elements(payload -> 'items') loop
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid;
    if not found then
      raise exception 'Unknown product';
    end if;
    v_qty    := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 0);
    v_weight := nullif(v_item ->> 'weight', '')::numeric;
    v_amount := round(v_product.price *
                 case when v_product.price_basis = 'weight' then coalesce(v_weight, 0) else v_qty end, 2);
    v_sl := v_sl + 1;
    v_sub_total := v_sub_total + v_amount;

    insert into public.challan_items (challan_id, sl_no, product_id, product_name, weight, quantity, price, amount)
    values (v_id, v_sl, v_product.id, v_product.name, v_weight, v_qty, v_product.price, v_amount);
  end loop;

  -- totals & payment
  if v_discount < 0 or v_discount > v_sub_total then
    raise exception 'Discount must be between 0 and the sub total (%)', v_sub_total;
  end if;
  v_final := v_sub_total - v_discount;

  if v_is_split then
    if round(v_cash + v_bank, 2) <> round(v_final, 2) then
      raise exception 'Split payment (cash % + bank %) must equal final amount %', v_cash, v_bank, v_final;
    end if;
    v_mode := case when v_cash >= v_bank then 'cash' else 'bank' end;
  else
    if v_mode not in ('cash', 'bank') then
      raise exception 'Choose a payment mode';
    end if;
    v_cash := case when v_mode = 'cash' then v_final else 0 end;
    v_bank := case when v_mode = 'bank' then v_final else 0 end;
  end if;

  update public.challans
     set sub_total = v_sub_total,
         discount = v_discount,
         final_amount = v_final,
         payment_mode = v_mode,
         is_split = v_is_split,
         cash_amount = v_cash,
         bank_amount = v_bank
   where id = v_id;

  return v_id;
end;
$$;

grant execute on function public.next_dc_no() to authenticated;
grant execute on function public.dc_exists(text, uuid) to authenticated;
grant execute on function public.save_challan(jsonb) to authenticated;
grant execute on function public.is_admin() to authenticated;

