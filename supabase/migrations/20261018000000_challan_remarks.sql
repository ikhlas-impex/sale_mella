-- Optional remarks on each challan.
-- Safe to run on a database with data: adds a nullable column and replaces save_challan.

alter table public.challans add column if not exists remarks text;

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
    insert into public.challans (dc_no, dc_date, customer_name, remarks, payment_mode, is_split, created_by, updated_by)
    values (v_dc_no, (payload ->> 'dc_date')::date, trim(payload ->> 'customer_name'),
            nullif(trim(coalesce(payload ->> 'remarks', '')), ''),
            coalesce(v_mode, 'cash'), v_is_split, auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.challans
       set dc_no = v_dc_no,
           dc_date = (payload ->> 'dc_date')::date,
           customer_name = trim(payload ->> 'customer_name'),
           remarks = nullif(trim(coalesce(payload ->> 'remarks', '')), ''),
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
  -- A negative discount is an extra charge added to the total
  if v_discount > v_sub_total then
    raise exception 'Discount cannot be more than the sub total (%)', v_sub_total;
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
