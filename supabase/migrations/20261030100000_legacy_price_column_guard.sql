-- v2.5 PR-C1b：旧価格の列（本部商品の原価）を、DB でも本部だけが読める・変えられるようにする。
--
-- 2026-10-29 の先方の回答：C1 で旧価格の経路を切り替えるまでに、旧価格の列（＝本部商品の原価）も DB/RPC で本部だけが
-- 読める・変えられるようにし、公開の経路に原価が出ないようにする（docs/assumptions.md「切り替えの前に確かめること 1」）。
--
-- 旧価格の列：商品価格（options.price）・選択肢の追加金額（option_variant_choices.extra_price）・本体価格（base_models.base_price）・
-- 本体内訳の単価と金額・旧テンプレート（Excel の標準見積）の金額。v2.5 では原価（率を掛ける元の数字）として扱う。
--
-- 読み取り：anon・authenticated（ログインした利用者。本部の管理者も含む）は、この列を API（PostgREST）から直接読めない。
--   ほかの列は今までどおり読める（行の見え方は RLS のまま）。読める列は適用の時点の列から決める。
--   アプリは金額の列以外を列名で指定して読み、金額が要るときはサーバーが service_role で読む
--   （スイッチが切れている間は旧シミュレーターの売価として今までどおり使い、入った後は本部の画面だけで使う）。
-- 書き込み：本部商品の金額は、本部（can_manage_option_hq_standard_cost）だけが変えられる。
--   商品台帳の編集者（総代理店）は RLS・RPC で商品・本体・本体内訳・旧テンプレートを書けるため、金額だけトリガーで止める。
--   本部商品の外（旧フリー商品）は今までどおり。service_role とサーバーの保守（JWT なし）は止めない。
--   SECURITY DEFINER の RPC（商品の一括登録・旧テンプレートの取込など）の中でも、呼んだ利用者で判定する。
--
-- データは変えない。既存の migration は編集しない。スイッチは入れない。

begin;

set local lock_timeout = '5s';

-- 金額の列（ここに無い列は anon・authenticated が今までどおり読める）
create temp table _legacy_price_columns (tbl text not null, col text not null) on commit drop;
insert into _legacy_price_columns (tbl, col) values
  ('options', 'price'),
  ('option_variant_choices', 'extra_price'),
  ('base_models', 'base_price'),
  ('base_breakdown_items', 'unit_price'),
  ('base_breakdown_items', 'amount'),
  ('estimate_templates', 'subtotal_raw'),
  ('estimate_templates', 'adjustment'),
  ('estimate_templates', 'subtotal'),
  ('estimate_templates', 'tax'),
  ('estimate_templates', 'total'),
  ('estimate_template_sections', 'line_subtotal'),
  ('estimate_template_sections', 'expense_amount'),
  ('estimate_template_sections', 'total'),
  ('estimate_template_lines', 'unit_price'),
  ('estimate_template_lines', 'amount');

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.can_manage_option_hq_standard_cost()') is null
     or to_regprocedure('public.simulator_standard_pricing_enabled()') is null then
    raise exception 'PRECONDITION: v2.5 cost versions (20261016200000) and simulator pricing (20261029100000) must be applied first';
  end if;
  if exists (
    select 1 from _legacy_price_columns c
     where not exists (
       select 1 from pg_catalog.pg_attribute a
        where a.attrelid = to_regclass('public.' || c.tbl) and a.attname = c.col and a.attnum > 0 and not a.attisdropped
     )
  ) then
    raise exception 'PRECONDITION: every legacy price column must exist';
  end if;
end;
$preflight$;

-- ---------- 読み取り：金額の列を anon・authenticated から外す ----------

do $column_grants$
declare
  r record;
  v_cols text;
begin
  for r in select tbl, array_agg(col) as hidden from _legacy_price_columns group by tbl order by tbl loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
      into v_cols
      from pg_catalog.pg_attribute a
     where a.attrelid = ('public.' || r.tbl)::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.attname <> all (r.hidden);
    execute format('revoke select on table public.%I from anon, authenticated', r.tbl);
    execute format('grant select (%s) on table public.%I to anon, authenticated', v_cols, r.tbl);
  end loop;
end;
$column_grants$;

-- ---------- 書き込み：本部商品の金額は本部だけ ----------

-- 金額を変えてよい呼び出し元か：本部（管理者・本部の組織の管理者）、service_role、JWT の無いサーバーの保守
create function public.legacy_price_write_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.role(), '') in ('', 'service_role')
      or public.can_manage_option_hq_standard_cost();
$$;

-- 本部商品のカテゴリーか（旧フリー商品の外。カテゴリーが分からないときは本部商品として扱う＝止める側）
create function public.option_category_is_hq_cost(p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.code is distinct from 'free-product' from public.option_categories c where c.id = p_category_id), true);
$$;

create function public.options_legacy_price_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_hq boolean;
  v_old_hq boolean;
begin
  if public.legacy_price_write_allowed() then
    return new;
  end if;
  v_new_hq := public.option_category_is_hq_cost(new.category_id);
  if tg_op = 'INSERT' then
    -- 一括登録・upsert は INSERT ... ON CONFLICT DO UPDATE。同じ商品が同じ金額で登録済みなら、金額は変わらない
    if v_new_hq and coalesce(new.price, 0) <> 0
       and not exists (select 1 from public.options o where (o.code = new.code or o.id = new.id) and o.price = new.price) then
      raise exception using errcode = '42501',
        message = 'FORBIDDEN: 本部商品の商品標準原価（商品価格）は本部だけが登録できます';
    end if;
    return new;
  end if;
  v_old_hq := public.option_category_is_hq_cost(old.category_id);
  if (v_new_hq or v_old_hq) and new.price is distinct from old.price then
    raise exception using errcode = '42501',
      message = 'FORBIDDEN: 本部商品の商品標準原価（商品価格）は本部だけが変更できます';
  end if;
  if v_new_hq and not v_old_hq and coalesce(new.price, 0) <> 0 then
    raise exception using errcode = '42501',
      message = 'FORBIDDEN: 金額のある商品を本部商品のカテゴリーへ移せるのは本部だけです';
  end if;
  return new;
end;
$$;

create trigger options_legacy_price_guard
before insert or update of price, category_id on public.options
for each row execute function public.options_legacy_price_guard();

create function public.option_variant_choices_legacy_price_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hq boolean;
begin
  if public.legacy_price_write_allowed() then
    return new;
  end if;
  select public.option_category_is_hq_cost(o.category_id)
    into v_hq
    from public.option_variant_groups g
    join public.options o on o.id = g.option_id
   where g.id = new.group_id;
  if not coalesce(v_hq, true) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(new.extra_price, 0) <> 0
       and not exists (
         select 1 from public.option_variant_choices c
          where c.id = new.id and c.group_id = new.group_id and c.extra_price = new.extra_price
       ) then
      raise exception using errcode = '42501',
        message = 'FORBIDDEN: 本部商品の選択肢の原価差額（追加金額）は本部だけが登録できます';
    end if;
  elsif new.extra_price is distinct from old.extra_price or new.group_id is distinct from old.group_id then
    raise exception using errcode = '42501',
      message = 'FORBIDDEN: 本部商品の選択肢の原価差額（追加金額）は本部だけが変更できます';
  end if;
  return new;
end;
$$;

create trigger option_variant_choices_legacy_price_guard
before insert or update of extra_price, group_id on public.option_variant_choices
for each row execute function public.option_variant_choices_legacy_price_guard();

create function public.base_models_legacy_price_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.legacy_price_write_allowed() then
    return new;
  end if;
  if (tg_op = 'INSERT' and coalesce(new.base_price, 0) <> 0
      and not exists (select 1 from public.base_models m where m.id = new.id and m.base_price = new.base_price))
     or (tg_op = 'UPDATE' and new.base_price is distinct from old.base_price) then
    raise exception using errcode = '42501',
      message = 'FORBIDDEN: 本体価格は本部だけが登録・変更できます';
  end if;
  return new;
end;
$$;

create trigger base_models_legacy_price_guard
before insert or update of base_price on public.base_models
for each row execute function public.base_models_legacy_price_guard();

-- 本体内訳・旧テンプレートは金額の帳票なので、金額のある行の追加・変更・削除を本部だけにする
create function public.legacy_price_rows_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_col text;
  v_touches boolean := false;
begin
  if public.legacy_price_write_allowed() then
    return coalesce(new, old);
  end if;
  foreach v_col in array tg_argv loop
    if (tg_op = 'INSERT' and coalesce((v_new ->> v_col)::numeric, 0) <> 0)
       or (tg_op = 'DELETE' and coalesce((v_old ->> v_col)::numeric, 0) <> 0)
       or (tg_op = 'UPDATE' and (v_new -> v_col) is distinct from (v_old -> v_col)) then
      v_touches := true;
    end if;
  end loop;
  if v_touches then
    raise exception using errcode = '42501',
      message = format('FORBIDDEN: %s の金額は本部だけが登録・変更・削除できます',
        case tg_table_name
          when 'base_breakdown_items' then '本体内訳'
          else '旧テンプレート（Excel の標準見積）'
        end);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger base_breakdown_items_legacy_price_guard
before insert or update or delete on public.base_breakdown_items
for each row execute function public.legacy_price_rows_guard('unit_price', 'amount');

create trigger estimate_templates_legacy_price_guard
before insert or update or delete on public.estimate_templates
for each row execute function public.legacy_price_rows_guard('subtotal_raw', 'adjustment', 'subtotal', 'tax', 'total');

create trigger estimate_template_sections_legacy_price_guard
before insert or update or delete on public.estimate_template_sections
for each row execute function public.legacy_price_rows_guard('line_subtotal', 'expense_amount', 'total');

create trigger estimate_template_lines_legacy_price_guard
before insert or update or delete on public.estimate_template_lines
for each row execute function public.legacy_price_rows_guard('unit_price', 'amount');

-- 内部の判定・トリガー関数は API のロールから実行させない
alter function public.legacy_price_write_allowed() owner to postgres;
alter function public.option_category_is_hq_cost(uuid) owner to postgres;
alter function public.options_legacy_price_guard() owner to postgres;
alter function public.option_variant_choices_legacy_price_guard() owner to postgres;
alter function public.base_models_legacy_price_guard() owner to postgres;
alter function public.legacy_price_rows_guard() owner to postgres;
revoke all on function public.legacy_price_write_allowed() from public, anon, authenticated, service_role;
revoke all on function public.option_category_is_hq_cost(uuid) from public, anon, authenticated, service_role;
revoke all on function public.options_legacy_price_guard() from public, anon, authenticated, service_role;
revoke all on function public.option_variant_choices_legacy_price_guard() from public, anon, authenticated, service_role;
revoke all on function public.base_models_legacy_price_guard() from public, anon, authenticated, service_role;
revoke all on function public.legacy_price_rows_guard() from public, anon, authenticated, service_role;

-- ---------- postconditions ----------

do $postconditions$
declare
  r record;
begin
  -- 金額の列は anon・authenticated から読めず、service_role は読める
  for r in select tbl, col from _legacy_price_columns loop
    if has_column_privilege('anon', ('public.' || r.tbl)::regclass, r.col, 'SELECT')
       or has_column_privilege('authenticated', ('public.' || r.tbl)::regclass, r.col, 'SELECT') then
      raise exception 'POSTCONDITION: %.% must not be readable by anon / authenticated', r.tbl, r.col;
    end if;
    if not has_column_privilege('service_role', ('public.' || r.tbl)::regclass, r.col, 'SELECT') then
      raise exception 'POSTCONDITION: %.% must stay readable by service_role', r.tbl, r.col;
    end if;
  end loop;
  -- ほかの列は今までどおり読める
  for r in
    select c.relname as tbl, a.attname as col
      from pg_catalog.pg_class c
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where c.relnamespace = 'public'::regnamespace
       and c.relname in (select distinct tbl from _legacy_price_columns)
       and not exists (select 1 from _legacy_price_columns p where p.tbl = c.relname and p.col = a.attname)
  loop
    if not has_column_privilege('anon', ('public.' || r.tbl)::regclass, r.col, 'SELECT')
       or not has_column_privilege('authenticated', ('public.' || r.tbl)::regclass, r.col, 'SELECT') then
      raise exception 'POSTCONDITION: %.% must stay readable by anon / authenticated', r.tbl, r.col;
    end if;
  end loop;
end;
$postconditions$;

commit;
