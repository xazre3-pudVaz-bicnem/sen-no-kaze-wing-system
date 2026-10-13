-- PR C2：シミュレーターと見積依頼を、新しい標準見積で計算する（統合版依頼書 §17）。
--
-- 使うのは、標準状態の商品（PR C1）が登録された公開中の標準見積が、機種・用途・防火でちょうど 1 件に決まるときだけ。
-- それ以外（初期登録前の本番・標準状態の商品が未登録・サイズ違いが複数）は、これまでの計算のまま。
--
--   区分の明細小計 = 標準見積の明細小計 ＋（選んだ商品の価格の合計 − 標準状態の商品の価格の合計）
--     選んだ商品：商品台帳の現在の価格（バリエーション・外壁 4 面を含む。configuration_master_section_total と同じ）
--     標準状態の商品：公開時に確定した価格 × 数量（外壁は 4 面分）。すべて trunc
--   区分の経費 = trunc(区分の明細小計 × 経費率)（経費の方法が「率」の区分だけ。本体は標準見積のまま）
--   税抜 = 区分の合計 ＋ 標準見積の調整額、税 = trunc(税抜 × 税率)。旧来の 1,000 円未満切り捨ては持ち込まない
--   防火：防火仕様（fire-proof）を選んでいて防火の標準見積があれば防火の標準見積、無ければ非防火の標準見積（防火は別途見積のまま）
--
-- 式は lib/domain/standard-estimate-sale-view.ts（シミュレーターの表示）と同じ。正本はこの DB の計算。
-- 既存の関数（recalculate_configuration・create_quote_from_configuration）は、適用済みの定義を検査してから置き換える
-- （目印はちょうど 1 箇所、owner・SECURITY DEFINER・search_path・EXECUTE は不変）。既存 migration・発行済みの見積は変えない。

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.get_standard_estimate_sale_views(uuid)') is null then
    raise exception 'PRECONDITION: standard estimate sale views (20261013190000) must be applied first';
  end if;
  if to_regprocedure('public.recalculate_configuration(uuid)') is null
     or to_regprocedure('public.create_quote_from_configuration(uuid, jsonb, text, integer)') is null
     or to_regprocedure('public.configuration_master_section_total(uuid, text)') is null then
    raise exception 'PRECONDITION: configuration pricing functions are missing; review migration order';
  end if;
  if to_regprocedure('public.apply_standard_estimate_to_configuration(uuid)') is not null then
    raise exception 'PRECONDITION: apply_standard_estimate_to_configuration already exists; review before applying';
  end if;
end;
$preflight$;

-- ---------- 内部の関数（API からは実行させない） ----------

-- 保存済みの仕様に使う標準見積（売価だけの形）を 1 件に決める。決まらなければ NULL（これまでの計算）
create function public.standard_estimate_sale_view_for_configuration(p_configuration_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $view_for_configuration$
declare
  cfg public.configurations;
  v_slug text;
  v_spec text;
  v_fire boolean;
  v_views jsonb;
  v_count integer;
  v_pick jsonb;
begin
  select * into cfg from public.configurations where id = p_configuration_id;
  if not found then
    return null;
  end if;
  select m.slug into v_slug from public.base_models m where m.id = cfg.base_model_id;
  /* 互換：BOX の hotel-single は BOX ホテル仕様の標準見積で計算する */
  v_spec := case when v_slug = 'box' and cfg.spec_code = 'hotel-single' then 'hotel' else cfg.spec_code end;
  if v_spec is null then
    return null;
  end if;
  v_fire := exists (
    select 1
      from public.configuration_items ci
      join public.options o on o.id = ci.option_id
     where ci.configuration_id = cfg.id
       and o.code = 'fire-proof'
  );
  v_views := public.get_standard_estimate_sale_views(cfg.base_model_id);

  if v_fire then
    select count(*), (array_agg(e.value))[1]
      into v_count, v_pick
      from jsonb_array_elements(v_views) as e(value)
     where e.value ->> 'spec_code' = v_spec
       and e.value ->> 'fire_spec_code' = 'fire'
       and jsonb_array_length(e.value -> 'baseline') > 0;
    if v_count = 1 then
      return v_pick;
    end if;
  end if;

  select count(*), (array_agg(e.value))[1]
    into v_count, v_pick
    from jsonb_array_elements(v_views) as e(value)
   where e.value ->> 'spec_code' = v_spec
     and e.value ->> 'fire_spec_code' = 'non_fire'
     and jsonb_array_length(e.value -> 'baseline') > 0;
  return case when v_count = 1 then v_pick else null end;
end;
$view_for_configuration$;

-- 標準見積と選択商品の差額から、区分ごとの金額と合計を求める（シミュレーターの computeSaleViewPricing と同じ式）
create function public.standard_estimate_configuration_money(p_configuration_id uuid, p_view jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $configuration_money$
declare
  v_expense_rate numeric := (p_view ->> 'expense_rate')::numeric;
  v_tax_rate numeric := (p_view ->> 'tax_rate')::numeric;
  v_adjustment numeric := coalesce((p_view ->> 'adjustment')::numeric, 0);
  v_sections jsonb := '{}'::jsonb;
  v_code text;
  s jsonb;
  v_line numeric;
  v_expense numeric;
  v_current numeric;
  v_baseline numeric;
  v_delta numeric;
  v_new_line numeric;
  v_new_expense numeric;
  v_raw numeric := 0;
  v_subtotal numeric;
  v_tax numeric;
begin
  foreach v_code in array array['base', 'interior_exterior', 'option', 'sitework'] loop
    select e.value into s from jsonb_array_elements(p_view -> 'sections') as e(value) where e.value ->> 'code' = v_code;
    v_line := coalesce((s ->> 'line_subtotal')::numeric, 0);
    v_expense := coalesce((s ->> 'expense_amount')::numeric, 0);
    if v_code = 'base' then
      v_delta := 0;
      v_new_line := v_line;
      v_new_expense := v_expense;
    else
      v_current := public.configuration_master_section_total(p_configuration_id, v_code);
      select coalesce(sum(
               trunc((b.value ->> 'quantity')::numeric
                     * ((case when (b.value ->> 'price_on_request')::boolean then 0 else (b.value ->> 'unit_price')::numeric end)
                        + coalesce((b.value ->> 'variant_extra')::numeric, 0)))
               * case when b.value ->> 'selection_target_code' = 'exterior-wall' then 4 else 1 end
             ), 0)
        into v_baseline
        from jsonb_array_elements(p_view -> 'baseline') as b(value)
       where b.value ->> 'section_code' = v_code;
      v_delta := v_current - v_baseline;
      v_new_line := v_line + v_delta;
      v_new_expense := case s ->> 'expense_method'
                         when 'rate' then trunc(v_new_line * v_expense_rate)
                         when 'fixed' then v_expense
                         else 0
                       end;
    end if;
    v_sections := v_sections || jsonb_build_object(v_code, jsonb_build_object(
      'line_subtotal', v_new_line,
      'expense_amount', v_new_expense,
      'total', v_new_line + v_new_expense,
      'delta_line', v_delta,
      'expense_method', s ->> 'expense_method'
    ));
    v_raw := v_raw + v_new_line + v_new_expense;
  end loop;

  v_subtotal := v_raw + v_adjustment;
  v_tax := trunc(v_subtotal * v_tax_rate);
  return jsonb_build_object(
    'sections', v_sections,
    'subtotal_raw', v_raw,
    'adjustment', v_adjustment,
    'subtotal', v_subtotal,
    'tax', v_tax,
    'total', v_subtotal + v_tax,
    'tax_rate', v_tax_rate,
    'expense_rate', v_expense_rate
  );
end;
$configuration_money$;

-- 保存済みの仕様の金額を標準見積で計算して保存する。使える標準見積が無ければ何もせず false（これまでの計算へ）
create function public.apply_standard_estimate_to_configuration(p_configuration_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $apply_to_configuration$
declare
  v_view jsonb;
  v_money jsonb;
  v_sections jsonb;
begin
  v_view := public.standard_estimate_sale_view_for_configuration(p_configuration_id);
  if v_view is null then
    return false;
  end if;
  v_money := public.standard_estimate_configuration_money(p_configuration_id, v_view);
  v_sections := v_money -> 'sections';
  update public.configurations
     set base_price = (v_sections #>> '{base,line_subtotal}')::numeric::integer,
         base_expense = (v_sections #>> '{base,expense_amount}')::numeric::integer,
         option_subtotal = ((v_sections #>> '{interior_exterior,line_subtotal}')::numeric + (v_sections #>> '{option,line_subtotal}')::numeric)::integer,
         option_expense = ((v_sections #>> '{interior_exterior,expense_amount}')::numeric + (v_sections #>> '{option,expense_amount}')::numeric)::integer,
         installation_subtotal = (v_sections #>> '{sitework,total}')::numeric::integer,
         adjustment = (v_money ->> 'adjustment')::numeric::integer,
         subtotal = (v_money ->> 'subtotal')::numeric::integer,
         tax = (v_money ->> 'tax')::numeric::integer,
         total = (v_money ->> 'total')::numeric::integer
   where id = p_configuration_id;
  return true;
end;
$apply_to_configuration$;

-- 見積依頼の明細を標準見積から作る。使える標準見積が無ければ何もせず false（これまでの明細へ）。
-- 明細の合計は、見積の税抜（調整前）と一致する（本体・区分の明細・変更差額・経費）
create function public.write_standard_estimate_quote_items(p_configuration_id uuid, p_quote_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $write_quote_items$
declare
  cfg public.configurations;
  v_view jsonb;
  v_money jsonb;
  v_sections jsonb;
  v_rate_label text;
  v_code text;
  v_kind text;
  v_base_sort integer;
  v_amount integer;
begin
  select * into cfg from public.configurations where id = p_configuration_id;
  if not found then
    return false;
  end if;
  v_view := public.standard_estimate_sale_view_for_configuration(p_configuration_id);
  if v_view is null then
    return false;
  end if;
  v_money := public.standard_estimate_configuration_money(p_configuration_id, v_view);
  v_sections := v_money -> 'sections';
  v_rate_label := trim(trailing '.' from to_char((v_view ->> 'expense_rate')::numeric * 100, 'FM990.99'));

  -- 本体：固定した本体 Revision の明細（売価）
  insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
  select p_quote_id, 'base', l.value ->> 'name', l.value ->> 'section', l.value ->> 'unit',
         (l.value ->> 'unit_price')::integer, (l.value ->> 'quantity')::numeric, (l.value ->> 'amount')::integer, l.ordinality::integer
    from jsonb_array_elements(v_view -> 'base_lines') with ordinality as l(value, ordinality);

  v_amount := (v_sections #>> '{base,expense_amount}')::numeric::integer;
  if v_amount <> 0 then
    insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
    values (p_quote_id, 'base_expense', '本体諸費用', '交通費、労災、安全管理費等（' || v_rate_label || '%）', '式', v_amount, 1, v_amount, 900);
  end if;

  foreach v_code in array array['interior_exterior', 'option', 'sitework'] loop
    v_kind := case v_code when 'interior_exterior' then 'interior_exterior' when 'option' then 'option' else 'installation' end;
    v_base_sort := case v_code when 'interior_exterior' then 1000 when 'option' then 2000 else 3000 end;

    -- 標準見積の明細（売価）。価格未確定（POR）の行は 0 円で「別途お見積り」と明記する
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order)
    select p_quote_id, v_kind, l.value ->> 'name', l.value ->> 'group_label', coalesce(l.value ->> 'unit', ''),
           case when (l.value ->> 'is_por')::boolean then '価格未確定（別途お見積り）' end,
           case when (l.value ->> 'is_por')::boolean then 0 else (l.value ->> 'unit_price')::integer end,
           coalesce((l.value ->> 'quantity')::numeric, 1),
           case when (l.value ->> 'is_por')::boolean then 0 else (l.value ->> 'amount')::integer end,
           v_base_sort + l.ordinality::integer
      from jsonb_array_elements(v_view -> 'lines') with ordinality as l(value, ordinality)
     where l.value ->> 'section_code' = v_code;

    v_amount := (v_sections #>> array[v_code, 'delta_line'])::numeric::integer;
    if v_amount <> 0 then
      insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
      values (p_quote_id, v_kind, '選択商品の変更差額', '標準状態の商品との差額', '式', v_amount, 1, v_amount, v_base_sort + 900);
    end if;

    -- 外壁の面別の仕様は 0 円のスナップショットとして残す（価格は変更差額に反映済み）
    if v_code = 'interior_exterior' and jsonb_typeof(cfg.exterior_faces) = 'array' and jsonb_array_length(cfg.exterior_faces) = 4 then
      insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, unit, amount, image_url, remark, sort_order)
      select p_quote_id, 'interior_exterior',
             '外壁仕様（' || case f.face_code when 'front' then '正面' when 'right' then '右側面' when 'back' then '背面' when 'left' then '左側面' else f.face_code end || '）',
             o.name || case when coalesce(v.label, '') = '' then '' else ' ／ ' || v.label end,
             0, 1, '面', 0, o.image_url,
             '価格は選択商品の変更差額に反映・見積発行時点の面別外壁仕様',
             1800 + case f.face_code when 'front' then 1 when 'right' then 2 when 'back' then 3 when 'left' then 4 else 9 end
        from (
          select x.value ->> 'face_code' as face_code,
                 (x.value ->> 'option_id')::uuid as option_id,
                 coalesce(x.value -> 'variant_choice_ids', '[]'::jsonb) as variant_choice_ids
            from jsonb_array_elements(cfg.exterior_faces) as x(value)
        ) f
        join public.options o on o.id = f.option_id
        left join lateral (
          select string_agg(vg.name || '：' || vc.name, '／' order by vg.sort_order, vc.sort_order) as label
            from jsonb_array_elements_text(f.variant_choice_ids) as j(choice_id)
            join public.option_variant_choices vc on vc.id = j.choice_id::uuid
            join public.option_variant_groups vg on vg.id = vc.group_id and vg.option_id = o.id
        ) v on true;
    end if;

    v_amount := (v_sections #>> array[v_code, 'expense_amount'])::numeric::integer;
    if v_amount <> 0 then
      insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
      values (
        p_quote_id,
        case v_code when 'interior_exterior' then 'interior_exterior_expense' when 'option' then 'option_expense' else 'installation' end,
        case v_code when 'interior_exterior' then '内外装工事経費' when 'option' then 'オプション諸費用' else '別途工事経費' end,
        '交通費、労災、安全管理費等（' || v_rate_label || '%）', '式', v_amount, 1, v_amount, v_base_sort + 950
      );
    end if;
  end loop;

  return true;
end;
$write_quote_items$;

-- ---------- 既存の処理への差し込み（適用済みの定義を検査してから置き換える） ----------

-- recalculate_configuration：使える標準見積があれば、旧来の Excel テンプレートより先に標準見積で計算する
do $patch_recalculate$
declare
  v_signature constant text := 'public.recalculate_configuration(uuid)';
  v_from text[];
  v_to text[];
  v_oid oid;
  v_definition text;
  v_expected text;
  v_before record;
  v_after record;
  v_index integer;
begin
  v_from := array[
    E'  select * into v_template\n'
    || E'    from public.estimate_templates\n'
    || E'   where base_model_id = cfg.base_model_id\n'
    || E'     and spec_code = coalesce(cfg.spec_code, '''')\n'
    || E'   limit 1;\n'
  ];
  v_to := array[
    E'  /* 新しい標準見積（標準状態の商品が登録された公開中のもの）が 1 件に決まれば、それと選択商品の差額で計算する（PR C2） */\n'
    || E'  if public.apply_standard_estimate_to_configuration(cfg.id) then\n'
    || E'    select * into cfg from public.configurations where id = cfg.id;\n'
    || E'    return cfg;\n'
    || E'  end if;\n'
    || E'\n'
    || v_from[1]
  ];

  v_oid := to_regprocedure(v_signature);
  if v_oid is null then
    raise exception 'SIMULATOR_STANDARD_ESTIMATE: function % is missing', v_signature using errcode = 'P0001';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before from pg_catalog.pg_proc p where p.oid = v_oid;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_expected := v_definition;
  for v_index in 1 .. array_length(v_from, 1) loop
    if (length(v_expected) - length(replace(v_expected, v_from[v_index], ''))) / length(v_from[v_index]) <> 1 then
      raise exception 'SIMULATOR_STANDARD_ESTIMATE: % differs from the reviewed definition (anchor % is not unique)', v_signature, v_index
        using errcode = 'P0001';
    end if;
    v_expected := replace(v_expected, v_from[v_index], v_to[v_index]);
  end loop;

  execute v_expected;

  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after from pg_catalog.pg_proc p where p.oid = v_oid;
  if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
    raise exception 'SIMULATOR_STANDARD_ESTIMATE: % was not replaced as expected', v_signature using errcode = 'P0001';
  end if;
  if v_after.proowner is distinct from v_before.proowner
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.acl is distinct from v_before.acl then
    raise exception 'SIMULATOR_STANDARD_ESTIMATE: % owner / security definer / search_path / EXECUTE changed', v_signature using errcode = 'P0001';
  end if;
end;
$patch_recalculate$;

-- create_quote_from_configuration：使える標準見積があれば、標準見積の明細で見積を作る（備考・税率も標準見積に合わせる）
do $patch_quote_request$
declare
  v_signature constant text := 'public.create_quote_from_configuration(uuid, jsonb, text, integer)';
  v_from text[];
  v_to text[];
  v_oid oid;
  v_definition text;
  v_expected text;
  v_before record;
  v_after record;
  v_index integer;
begin
  v_from := array[
    E'coalesce(v_template.tax_rate, 0.10)',
    E'    case when v_template.id is not null\n'
    || E'      then ''本見積書はExcel標準見積を基準に、選択商品の変更差額を反映した概算です。''\n',
    E'  if v_template.id is null then\n'
  ];
  v_to := array[
    E'coalesce((public.standard_estimate_sale_view_for_configuration(cfg.id) ->> ''tax_rate'')::numeric, v_template.tax_rate, 0.10)',
    E'    case when public.standard_estimate_sale_view_for_configuration(cfg.id) is not null\n'
    || E'      then ''本見積書は標準見積を基準に、選択商品の変更差額を反映した概算です。''\n'
    || E'      when v_template.id is not null\n'
    || E'      then ''本見積書はExcel標準見積を基準に、選択商品の変更差額を反映した概算です。''\n',
    E'  /* 新しい標準見積が 1 件に決まれば、その明細で見積を作る（PR C2） */\n'
    || E'  if public.write_standard_estimate_quote_items(cfg.id, v_quote) then\n'
    || E'    null;\n'
    || E'  elsif v_template.id is null then\n'
  ];

  v_oid := to_regprocedure(v_signature);
  if v_oid is null then
    raise exception 'SIMULATOR_STANDARD_ESTIMATE: function % is missing', v_signature using errcode = 'P0001';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before from pg_catalog.pg_proc p where p.oid = v_oid;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_expected := v_definition;
  for v_index in 1 .. array_length(v_from, 1) loop
    if (length(v_expected) - length(replace(v_expected, v_from[v_index], ''))) / length(v_from[v_index]) <> 1 then
      raise exception 'SIMULATOR_STANDARD_ESTIMATE: % differs from the reviewed definition (anchor % is not unique)', v_signature, v_index
        using errcode = 'P0001';
    end if;
    v_expected := replace(v_expected, v_from[v_index], v_to[v_index]);
  end loop;

  execute v_expected;

  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after from pg_catalog.pg_proc p where p.oid = v_oid;
  if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
    raise exception 'SIMULATOR_STANDARD_ESTIMATE: % was not replaced as expected', v_signature using errcode = 'P0001';
  end if;
  if v_after.proowner is distinct from v_before.proowner
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.acl is distinct from v_before.acl then
    raise exception 'SIMULATOR_STANDARD_ESTIMATE: % owner / security definer / search_path / EXECUTE changed', v_signature using errcode = 'P0001';
  end if;
end;
$patch_quote_request$;

-- ---------- owner / EXECUTE ----------

alter function public.standard_estimate_sale_view_for_configuration(uuid) owner to postgres;
alter function public.standard_estimate_configuration_money(uuid, jsonb) owner to postgres;
alter function public.apply_standard_estimate_to_configuration(uuid) owner to postgres;
alter function public.write_standard_estimate_quote_items(uuid, uuid) owner to postgres;

revoke all on function public.standard_estimate_sale_view_for_configuration(uuid) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_configuration_money(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.apply_standard_estimate_to_configuration(uuid) from public, anon, authenticated, service_role;
revoke all on function public.write_standard_estimate_quote_items(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.standard_estimate_sale_view_for_configuration(uuid)'::regprocedure,
    'public.standard_estimate_configuration_money(uuid, jsonb)'::regprocedure,
    'public.apply_standard_estimate_to_configuration(uuid)'::regprocedure,
    'public.write_standard_estimate_quote_items(uuid, uuid)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by API roles', v_fn;
    end if;
  end loop;
end;
$postcondition$;

commit;
