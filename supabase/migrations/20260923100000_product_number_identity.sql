-- =============================================================
-- 商品管理番号の正本を options.code から分離する。
--
-- options.id         : DB内部の正本（UUID）
-- options.product_no : 人が扱う商品管理番号（PRD-000001）
-- options.code       : 既存Preset / Catalog Import互換の技術キー
--
-- このmigrationでは options.code の意味・参照関係は変更しない。
-- =============================================================

create sequence if not exists public.product_no_seq
  as bigint
  increment by 1
  minvalue 1
  maxvalue 999999
  start with 1
  no cycle;

alter table public.options
  add column if not exists product_no text;

-- 採番はSECURITY DEFINER trigger経由だけで行う。
revoke all on sequence public.product_no_seq from public, anon, authenticated, service_role;

-- 部分適用等で不正な既存値が入っている場合は、黙って書き換えず停止する。
do $$
begin
  if exists (
    select 1
      from public.options
     where product_no is not null
       and (
         product_no !~ '^PRD-[0-9]{6}$'
         or product_no = 'PRD-000000'
       )
  ) then
    raise exception 'VALIDATION: options.product_no に不正な既存値があります'
      using errcode = 'P0001';
  end if;
end;
$$;

-- 既存行の最大番号とsequence高水位の大きい方を採番開始点にする。
-- migration再実行・部分適用でもsequenceを後退させない。
do $$
declare
  v_existing_max bigint;
  v_sequence_high_water bigint;
  v_start bigint;
  v_missing bigint;
begin
  select coalesce(max(substring(product_no from 5)::bigint), 0)
    into v_existing_max
    from public.options
   where product_no is not null;

  select case when is_called then last_value else 0 end
    into v_sequence_high_water
    from public.product_no_seq;

  v_start := greatest(v_existing_max, v_sequence_high_water);

  select count(*)
    into v_missing
    from public.options
   where product_no is null;

  if v_start + v_missing > 999999 then
    raise exception 'VALIDATION: 商品管理番号の6桁上限を超えるため採番できません'
      using errcode = 'P0001';
  end if;

  with numbered as (
    select o.id,
           v_start + row_number() over (order by o.created_at, o.id) as next_no
      from public.options o
     where o.product_no is null
  )
  update public.options o
     set product_no = 'PRD-' || lpad(numbered.next_no::text, 6, '0')
    from numbered
   where o.id = numbered.id;

  if v_start + v_missing = 0 then
    perform setval('public.product_no_seq'::regclass, 1, false);
  else
    perform setval(
      'public.product_no_seq'::regclass,
      greatest(v_sequence_high_water, v_start + v_missing),
      true
    );
  end if;
end;
$$;

create or replace function public.assign_option_product_no()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_existing text;
  v_no bigint;
begin
  if tg_op = 'INSERT' then
    -- PostgRESTの既存ID upsertではBEFORE INSERT triggerが先に走る。
    -- 既存行があれば現在の商品管理番号を再利用し、不要なsequence消費と番号変更を防ぐ。
    select o.product_no
      into v_existing
      from public.options o
     where o.id = new.id;

    if v_existing is not null then
      new.product_no := v_existing;
    else
      v_no := nextval('public.product_no_seq'::regclass);
      new.product_no := 'PRD-' || lpad(v_no::text, 6, '0');
    end if;

    return new;
  end if;

  if new.product_no is distinct from old.product_no then
    raise exception 'LOCKED: 商品管理番号は変更できません'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.assign_option_product_no()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_options_product_no on public.options;
create trigger trg_options_product_no
before insert or update of product_no on public.options
for each row execute function public.assign_option_product_no();

alter table public.options
  alter column product_no set not null;

create unique index if not exists options_product_no_unique_idx
  on public.options(product_no);

alter table public.options
  drop constraint if exists options_product_no_format_chk;

alter table public.options
  add constraint options_product_no_format_chk
  check (
    product_no ~ '^PRD-[0-9]{6}$'
    and product_no <> 'PRD-000000'
  );

comment on column public.options.product_no is
  '人が扱う商品管理番号。PRD-000001形式でDBが自動採番し、作成後は変更不可。options.codeとは役割を分離する。';
