-- Per-user DC numbering: the next DC No. is the signed-in user's most recently
-- created DC No. + 1, keeping its prefix and zero padding
-- (EK-2806 -> EK-2807, AB/0099 -> AB/0100). Numbers already used by anyone are skipped.
-- A user with no challans yet gets the shared DC-00001 series.
-- Safe to run on a database with data: only replaces a function.

create or replace function public.next_dc_no()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_last   text;
  v_prefix text;
  v_digits text;
  v_num    numeric;
  v_next   text;
  i        int := 0;
begin
  if not public.is_approved() then
    raise exception 'Your account is waiting for admin approval';
  end if;

  select trim(dc_no) into v_last
  from public.challans
  where created_by = auth.uid()
  order by created_at desc
  limit 1;

  if v_last is null or v_last = '' then
    return 'DC-' || lpad(nextval('public.dc_no_seq')::text, 5, '0');
  end if;

  v_prefix := substring(v_last from '^(.*?)[0-9]+$');
  v_digits := substring(v_last from '([0-9]+)$');

  if v_digits is null then
    -- Last DC No. has no trailing number (e.g. "EK"): start a series on it
    v_prefix := v_last || '-';
    v_digits := '0';
  end if;

  v_num := v_digits::numeric;
  loop
    v_num := v_num + 1;
    v_next := v_prefix || lpad(v_num::text, greatest(length(v_digits), length(v_num::text)), '0');
    exit when not exists (select 1 from public.challans where upper(trim(dc_no)) = upper(v_next));
    i := i + 1;
    exit when i > 10000;
  end loop;

  return v_next;
end;
$$;

grant execute on function public.next_dc_no() to authenticated;
