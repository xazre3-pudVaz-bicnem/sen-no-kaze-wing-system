-- PR B：本体分類表の選択 / × を、PR A の本体仕様マトリクス（DB）から判定する。
--
-- 20261013120000〜20261013123000（#389 を移植）は、可否を 2 つの関数に直書きしている。
--   * customer_business_item_for_category(category_code) … カテゴリー → 業務項目
--   * customer_category_selectable(model_slug, spec_code, category_code) … 機種 × 仕様 × カテゴリーの選択 / ×
-- 同じ署名・同じ意味のまま、マトリクスの表を読む実装へ置き換える。呼び出し側（トリガー・必須判定・
-- 標準見積の基準金額・商品の technical alias）は #389 のまま変えない。
-- 4 本とこの migration は同じ適用でまとめて入るため、直書きの版が本番で動く期間はない。
--
-- 判定（#389 と同じ意味）
--   * Category → Item の対応が無いカテゴリー（防火・断熱・別途工事・自由商品など）はマトリクスで制限しない
--   * 仕様が未設定の旧データは制限しない
--   * それ以外は、機種 × 仕様の有効な行のセルが選択可のときだけ選べる
--     行・セル・項目が無い、または行・仕様・サイズ・項目が retired なら選べない（fail closed）
--   * Configuration はサイズを持たないため、機種 × 仕様の有効な行がちょうど 1 つのときだけ判定に使う
--     （同じ機種・仕様に複数サイズの行ができた場合は、Configuration にサイズを持たせるまで選べない側に倒す）
-- 互換（#389 から移植。マトリクスの行ではない）
--   * BOX の hotel-single（旧データの仕様）は、BOX ホテル仕様の行で判定する
--   * 本体のみ（base）は、屋根・外壁／玄関ドア／サッシだけを選べる
-- 確定 6 行に無い仕様（room / storage / BOX の residence・office）は行が無いため、マトリクス対象のカテゴリーを選べない。
--
-- Category → Item の対応は #389 の確定対応（24 カテゴリー → 15 項目）を登録する。
-- 商品が無い DB（CI の空 DB）では省略する。既存の Quote / Snapshot / Configuration の保存値は変更しない。

begin;

-- ---------- preflight ----------

do $$
begin
  if to_regprocedure('public.customer_business_item_for_category(text)') is null
     or to_regprocedure('public.customer_category_selectable(text, text, text)') is null
     or to_regclass('public.option_category_matrix_items') is null then
    raise exception 'PRECONDITION: matrix foundation (PR A) and the customer-spec correctives must be applied first';
  end if;
  if exists (select 1 from public.option_category_matrix_items) then
    raise exception 'PRECONDITION: category -> item mapping already exists; review before seeding';
  end if;
end;
$$;

-- ---------- Category → Item（#389 の確定対応） ----------

do $seed_mapping$
declare
  v_missing text;
begin
  -- 空の DB の判定は #389 の corrective と同じく「商品が 1 件も無い」こと（保留中の migration が一部のカテゴリーだけを作るため）
  if not exists (select 1 from public.options) then
    raise notice 'MATRIX_MAPPING: options is empty; category -> item mapping is not seeded (empty database)';
    return;
  end if;

  with mapping(category_code, item_code) as (
    values
      ('roof', 'roof-exterior'), ('exterior-wall', 'roof-exterior'),
      ('floor', 'interior'), ('wall-ceiling', 'interior'), ('carpentry', 'interior'),
      ('entrance-door', 'entrance-door'),
      ('sash', 'sash'), ('service-door', 'sash'),
      ('ub', 'bath'), ('kitchen', 'kitchen'), ('washbasin', 'washbasin'), ('toilet', 'toilet'), ('boiler', 'boiler'),
      ('entrance-storage', 'entrance-storage'), ('interior-door', 'interior-door'), ('closet', 'closet'), ('bed', 'bed'),
      ('furniture', 'furnishings'), ('appliances', 'furnishings'), ('office-supplies', 'furnishings'),
      ('aircon', 'other'), ('lighting', 'other'), ('smartlock', 'other'), ('exterior-parts', 'other')
  )
  select string_agg(m.category_code, ', ' order by m.category_code) into v_missing
    from mapping m
   where not exists (select 1 from public.option_categories c where c.code = m.category_code);
  if v_missing is not null then
    raise exception 'MATRIX_MAPPING: categories % are missing; the customer-spec correctives must create them first', v_missing
      using errcode = 'P0001';
  end if;

  insert into public.option_category_matrix_items (category_id, matrix_item_code)
  select c.id, m.item_code
    from (values
      ('roof', 'roof-exterior'), ('exterior-wall', 'roof-exterior'),
      ('floor', 'interior'), ('wall-ceiling', 'interior'), ('carpentry', 'interior'),
      ('entrance-door', 'entrance-door'),
      ('sash', 'sash'), ('service-door', 'sash'),
      ('ub', 'bath'), ('kitchen', 'kitchen'), ('washbasin', 'washbasin'), ('toilet', 'toilet'), ('boiler', 'boiler'),
      ('entrance-storage', 'entrance-storage'), ('interior-door', 'interior-door'), ('closet', 'closet'), ('bed', 'bed'),
      ('furniture', 'furnishings'), ('appliances', 'furnishings'), ('office-supplies', 'furnishings'),
      ('aircon', 'other'), ('lighting', 'other'), ('smartlock', 'other'), ('exterior-parts', 'other')
    ) as m(category_code, item_code)
    join public.option_categories c on c.code = m.category_code;
end;
$seed_mapping$;

-- ---------- 判定関数（同じ署名・同じ意味で、表を読む実装へ） ----------

create or replace function public.customer_business_item_for_category(p_category_code text)
returns text
language sql
stable
set search_path = ''
as $$
  select ci.matrix_item_code
    from public.option_categories c
    join public.option_category_matrix_items ci on ci.category_id = c.id
   where c.code = p_category_code;
$$;

create or replace function public.customer_category_selectable(
  p_model_slug text,
  p_spec_code text,
  p_category_code text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  with target as (
    select public.customer_business_item_for_category(p_category_code) as item_code,
           -- 互換：BOX の hotel-single は BOX ホテル仕様の行で判定する
           case when p_model_slug = 'box' and p_spec_code = 'hotel-single' then 'hotel' else p_spec_code end as spec_code
  ),
  matrix_row as (
    select r.id
      from public.matrix_rows r
      join public.base_models m on m.id = r.base_model_id
      join public.matrix_specs s on s.code = r.spec_code and s.status = 'active'
      join public.matrix_sizes z on z.code = r.size_code and z.status = 'active'
      join target t on t.spec_code = r.spec_code
     where m.slug = p_model_slug
       and r.status = 'active'
  )
  select case
    when (select item_code from target) is null then true
    when p_spec_code is null then true
    -- 互換：本体のみ（base）は屋根・外壁／玄関ドア／サッシだけ
    when p_spec_code = 'base' then (select item_code from target) in ('roof-exterior', 'entrance-door', 'sash')
    -- 同じ機種・仕様の有効な行がちょうど 1 つのときだけ判定に使う（無い・複数なら選べない）
    when (select count(*) from matrix_row) <> 1 then false
    else coalesce((
      select c.selectable
        from public.matrix_cells c
        join public.matrix_items i on i.code = c.matrix_item_code and i.status = 'active'
       where c.matrix_row_id = (select id from matrix_row)
         and c.matrix_item_code = (select item_code from target)
    ), false)
  end;
$$;

alter function public.customer_business_item_for_category(text) owner to postgres;
alter function public.customer_category_selectable(text, text, text) owner to postgres;
revoke all on function public.customer_business_item_for_category(text) from public, anon, authenticated, service_role;
revoke all on function public.customer_category_selectable(text, text, text) from public, anon, authenticated, service_role;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_code text;
begin
  if exists (
    select 1 from pg_catalog.pg_proc p
     where p.oid in ('public.customer_business_item_for_category(text)'::regprocedure,
                     'public.customer_category_selectable(text, text, text)'::regprocedure)
       and (pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
            or not ('search_path=""' = any(p.proconfig))
            or has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('authenticated', p.oid, 'EXECUTE')
            or has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ) then
    raise exception 'POSTCONDITION: matrix helpers must be postgres-owned, empty search_path, and not executable by API roles';
  end if;

  -- 対象外カテゴリーは制限しない・仕様未設定は制限しない
  if not public.customer_category_selectable('wing-01', 'hotel', 'insulation')
     or not public.customer_category_selectable('wing-01', null, 'kitchen') then
    raise exception 'POSTCONDITION: categories outside the matrix / legacy rows without spec must stay unrestricted';
  end if;

  -- 対応と行がそろっている DB では、確定 seed どおりに判定できること（#389 の検算と同じ観点）
  if exists (select 1 from public.option_category_matrix_items)
     and exists (select 1 from public.matrix_rows) then
    if public.customer_category_selectable('wing-01', 'hotel', 'kitchen')
       or not public.customer_category_selectable('wing-01', 'residence', 'kitchen')
       or public.customer_category_selectable('box', 'hotel', 'kitchen')
       or public.customer_category_selectable('box', 'hotel-single', 'kitchen')
       or not public.customer_category_selectable('box', 'water-kit', 'kitchen')
       or not public.customer_category_selectable('flat', 'office', 'sash')
       or public.customer_category_selectable('flat', 'office', 'ub')
       or public.customer_category_selectable('wing-01', 'room', 'bed')
       or public.customer_category_selectable('wing-01', 'base', 'kitchen')
       or not public.customer_category_selectable('wing-01', 'base', 'exterior-wall') then
      raise exception 'POSTCONDITION: matrix-driven category selectability differs from the confirmed seed';
    end if;

    -- BOX hotel-single は BOX ホテル仕様と全カテゴリーで一致する
    foreach v_code in array array[
      'roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash','service-door',
      'ub','kitchen','washbasin','toilet','boiler','entrance-storage','interior-door','closet','bed',
      'furniture','appliances','office-supplies','aircon','lighting','smartlock','exterior-parts'
    ]::text[]
    loop
      if public.customer_category_selectable('box', 'hotel-single', v_code)
         is distinct from public.customer_category_selectable('box', 'hotel', v_code) then
        raise exception 'POSTCONDITION: BOX hotel-single differs from BOX hotel for category %', v_code;
      end if;
    end loop;

    if (select count(*) from public.option_category_matrix_items) <> 24 then
      raise exception 'POSTCONDITION: category -> item mapping must be the confirmed 24 categories';
    end if;
  end if;
end;
$postcondition$;

commit;
