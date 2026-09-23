-- Product number identity foundation
-- 人が扱う商品管理番号を options.code から分離する。
-- options.code は既存Preset / Import互換の技術キーとして、このmigrationでは意味を変更しない。

create sequence if not exists public.product_no_seq
  as bigint
  increment by 1
  minvalue 1
  maxvalue 999999
  start with 1
  no cycle;

alter table public.options
  add column if not exists product_no text;

-- 既存商品へ決定的な順序で採番する。
-- 部分適用から再実行しても既存番号を保持し、未採番分だけ末尾へ追加する。
with current_max as (
  select coalesce(max(substring(product_no from 5)::bigint), 0) as max_no
    from public.options
   where product_no ~ '^PRD-[0-9]{6}$'
),
numbered as (
  select o.id,
         current_max.max_no + row_number() over (order by o.created_at, o.id) as next_no
    from public.options o
    cross join current_max
   where o.product_no is null
)
update public.options o
   set product_no = 'PRD-' || lpad(numbered.next_no::text, 6, '0')
  from numbered
 where o.id = numbered.id;

do $$
declare
  v_max bigint;
begin
  select coalesce(max(substring(product_no from 5)::bigint), 0)
    into v_max
    from public.options
   where product_no ~ '^PRD-[0-9]{6}$';

  if v_max = 0 then
    perform setval('public.product_no_seq', 1, false);
  else
    perform setval('public.product_no_seq', v_max, true);
  end if;
end;
$$;

create or replace function public.assign_option_product_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
  v_no bigint;
begin
  if tg_op = 'INSERT' then
    -- PostgREST upsert が既存IDへ INSERT ... ON CONFLICT を使う場合は、
    -- 既存番号を再利用して不要な採番を発生させない。
    select o.product_no
      into v_existing
      from public.options o
     where o.id = new.id;

    if v_existing is not null then
      new.product_no := v_existing;
    else
      v_no := nextval('public.product_no_seq');
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

revoke all on function public.assign_option_product_no() from public;

drop trigger if exists trg_options_product_no on public.options;
create trigger trg_options_product_no
before insert or update of product_no on public.options
for each row execute function public.assign_option_product_no();

alter table public.options
  alter column product_no set not null;

create unique index if not exists options_product_no_unique_idx
  on public.options(product_no);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.options'::regclass
       and conname = 'options_product_no_format_chk'
  ) then
    alter table public.options
      add constraint options_product_no_format_chk
      check (product_no ~ '^PRD-[0-9]{6}$');
  end if;
end;
$$;

comment on column public.options.product_no is
  '人が扱う商品管理番号。PRD-000001形式でDBが自動採番し、作成後は変更不可。options.codeとは役割を分離する。';
