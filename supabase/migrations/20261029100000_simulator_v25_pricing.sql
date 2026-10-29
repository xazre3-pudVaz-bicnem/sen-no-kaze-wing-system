-- v2.5 PR-C1：シミュレーター・保存した仕様・見積依頼を、公開中の v2.5 の標準見積の売価で計算する。
--
-- 2026-10-27・10-29 の先方方針：
-- * 売価は v2.5 のルール（商品標準原価・原価差額 × 販売費率 × 掛率、区分の経費、調整額、税）で決める
-- * 今の商品価格・追加金額の列（options.price・extra_price）は商品標準原価・原価差額（原価）なので、切り替えた後は売価として使わない
-- * 本番の価格の切り替え（スイッチ）は先方の指示の後に本部が行う。この migration はスイッチを入れない
--
-- 決まり（スイッチ simulator_standard_pricing が入っている間だけ。切れている間はこれまでの計算のまま）
-- * 使う標準見積：機種・用途（BOX hotel-single は hotel）・防火で、公開中の v2.5 の版がちょうど 1 件に決まるもの
--   （防火仕様を選んでいて防火の版が無ければ非防火の版。v2.5 以前の版は使わない）
-- * 区分の明細小計 = 公開した版の区分の明細小計（金額確定分）＋（選んだ商品の売価の合計 − 版の選択枠の売価の合計）
--   選んだ商品の売価単価（standard_estimate_v25_selection_unit）：
--     - 版の選択枠と同じ「商品＋選択肢」なら、公開した版の売価（auto は固定した原価からの売価、manual は入力した売価、por は未確定）
--     - それ以外は、今の商品標準原価・原価差額の Version とこの版の率で v2.5 の auto の式（trunc(trunc((原価＋差額) × 販売費率) × 掛率)）
--     - 未確定：別途見積の商品、自動計算の対象外の区分（別途工事）、原価の Version が無い商品・選択肢
--   外壁は 4 面がそろっていれば面ごと（1 面ずつ）。防火の版を使うときは、防火仕様の行は版に含まれるので数えない
-- * 区分の経費 = trunc(区分の明細小計 × 経費率)（版で経費の対象の区分だけ）。本体は版のまま
-- * 税抜 = 区分の合計 ＋ 版の調整額、税 = trunc(税抜 × 税率)
-- * 未確定の商品は 0 円として合計し、見積の明細は「価格未確定（別途お見積り）」と明記する（これまでと同じ）
-- * 公開中の v2.5 の版が無い仕様は、これまでの計算（商品価格の列＝原価）を使わず、金額を未確定（0 円）にし、見積は別途お見積りの 1 行にする
-- * シミュレーターには売価だけを返す（get_simulator_v25_sale_views。原価・率・原価の Version は返さない。service_role だけ）。
--   商品ごとの売価は、選択肢の組み合わせごとの表にして渡す（v2.5 の式は選択肢の差額を足してから率を掛けるので、差額の売価は足し算にならない）。
--   組み合わせが多い商品（本番では玄関ドア・UB など）は、標準と 1 か所だけ変えた組み合わせを表に入れ、それ以外は選んだときに
--   get_simulator_v25_units で計算する（売価だけ。service_role だけ）
-- * スイッチを入れられるのは、有効なすべての標準見積の公開中の版が v2.5 のときだけ（set_simulator_standard_pricing）
--
-- 既存 migration は編集しない。発行済みの見積・保存済みの仕様の金額は、この migration では変えない（次に保存・見積依頼したときに計算する）。

begin;

set local lock_timeout = '5s';

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.preview_standard_estimate_v25_revision(uuid)') is null
     or to_regclass('public.standard_estimate_revision_v25_lines') is null then
    raise exception 'PRECONDITION: standard estimate v2.5 revisions (20261019100000) must be applied first';
  end if;
  if to_regprocedure('public.apply_standard_estimate_to_configuration(uuid)') is null
     or to_regprocedure('public.write_standard_estimate_quote_items(uuid, uuid)') is null
     or to_regprocedure('public.standard_estimate_sale_view_for_configuration(uuid)') is null
     or to_regprocedure('public.simulator_standard_pricing_enabled()') is null
     or to_regprocedure('public.set_simulator_standard_pricing(boolean)') is null
     or to_regprocedure('public.estimate_section_for_option(text, boolean)') is null then
    raise exception 'PRECONDITION: simulator standard estimate pricing (20261013200000・20261013210000) must be applied first';
  end if;
  if to_regprocedure('public.get_simulator_v25_sale_views(uuid)') is not null
     or to_regprocedure('public.get_simulator_v25_units(uuid, jsonb)') is not null then
    raise exception 'PRECONDITION: simulator v2.5 pricing functions already exist';
  end if;
end;
$preflight$;

-- ---------- 商品の売価単価（内部の部品） ----------

-- 「商品＋選択肢」1 つの売価単価（税別・経費別）。null は価格未確定。
create function public.standard_estimate_v25_selection_unit(p_revision_id uuid, p_option_id uuid, p_choice_ids uuid[])
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  rev record;
  o record;
  b record;
  v_choices uuid[];
  v_auto_sections text[];
  v_cost bigint;
  v_adjustment bigint := 0;
  v_one bigint;
  v_choice uuid;
begin
  select r.id, r.sales_fee_rate, r.markup_rate, r.calc_rule_version_id
    into rev
    from public.standard_estimate_revisions r
   where r.id = p_revision_id and r.pricing_model = 'v2.5';
  if not found then
    return null;
  end if;
  v_choices := array(select distinct z from unnest(coalesce(p_choice_ids, '{}'::uuid[])) z order by z);

  -- 版の選択枠と同じ「商品＋選択肢」は、公開した版の売価（auto は固定した原価から、manual は入力した売価、por は未確定）
  select bi.price_mode, bi.sale_unit_price, bi.manual_unit_price
    into b
    from public.standard_estimate_revision_baseline_items bi
   where bi.revision_id = rev.id
     and bi.option_id = p_option_id
     and array(select bv.variant_choice_id from public.standard_estimate_revision_baseline_variants bv
                where bv.baseline_item_id = bi.id order by bv.variant_choice_id) = v_choices
   limit 1;
  if found then
    return case b.price_mode when 'auto' then b.sale_unit_price when 'manual' then b.manual_unit_price else null end;
  end if;

  -- それ以外は、今の原価 Version とこの版の率で v2.5 の auto の式
  select x.id, x.price_on_request, x.is_installation, c.code as category_code
    into o
    from public.options x
    join public.option_categories c on c.id = x.category_id
   where x.id = p_option_id and x.status = 'published';
  if not found or o.price_on_request then
    return null;
  end if;
  select rv.auto_price_sections into v_auto_sections
    from public.pricing_calculation_rule_versions rv where rv.id = rev.calc_rule_version_id;
  if not (public.estimate_section_for_option(o.category_code, o.is_installation) = any(coalesce(v_auto_sections, '{}'::text[]))) then
    return null;
  end if;
  select v.standard_cost into v_cost
    from public.option_standard_cost_versions v
   where v.option_id = o.id and v.superseded_at is null;
  if v_cost is null then
    return null;
  end if;
  foreach v_choice in array v_choices loop
    v_one := null;
    select cv.cost_adjustment into v_one
      from public.option_variant_cost_versions cv
      join public.option_variant_choices vc on vc.id = cv.variant_choice_id and vc.status = 'published'
      join public.option_variant_groups vg on vg.id = vc.group_id and vg.status = 'published'
     where cv.variant_choice_id = v_choice
       and cv.superseded_at is null
       and vg.option_id = o.id;
    if v_one is null then
      return null;
    end if;
    v_adjustment := v_adjustment + v_one;
  end loop;
  if v_cost + v_adjustment < 0 then
    return null;
  end if;
  return trunc(trunc((v_cost + v_adjustment) * rev.sales_fee_rate) * rev.markup_rate)::integer;
end;
$$;

comment on function public.standard_estimate_v25_selection_unit(uuid, uuid, uuid[]) is
  'v2.5 の標準見積の版での「商品＋選択肢」の売価単価（税別・経費別）。版の選択枠と同じなら公開した版の売価、それ以外は今の原価 Version と版の率。null は価格未確定。内部の部品。';

-- 商品の選択肢の組み合わせごとの売価単価の表（シミュレーターに渡す。原価は含まない）
-- { "groups": [[選択肢 ID…], …], "units": { "0.-": 123000, … } }。キーは選択項目の順に選んだ選択肢の位置（無しは -）を . でつないだもの。
-- 価格未確定の組み合わせは null。商品全体が未確定（別途見積・別途工事・原価未設定）なら { "por": true }。
-- 組み合わせ（選ばないを含む）が 64 を超える商品は、標準の組み合わせ（default_key）と、そこから 1 つの選択項目だけを変えた組み合わせだけを入れる
-- （"partial": true）。それ以外の組み合わせは、選んだときに get_simulator_v25_units で計算する（ページを重くしないため）。
-- 標準の選択肢は、選択項目ごとに種類が標準・固定の最初の選択肢、無ければ先頭（シミュレーターの defaultVariantIdsFor と同じ）
create function public.standard_estimate_v25_price_table(p_revision_id uuid, p_option_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  rev record;
  o record;
  v_auto_sections text[];
  v_group_lists jsonb := '[]'::jsonb;
  v_sizes integer[] := '{}';
  v_base integer[] := '{}';
  v_total numeric := 1;
  v_partial boolean;
  v_swap_pos integer[] := '{}';
  v_swap_val integer[] := '{}';
  v_count integer;
  v_index integer;
  v_rest integer;
  v_pos integer;
  v_val integer;
  v_vals integer[];
  v_parts text[];
  v_choices uuid[];
  v_key text;
  v_default_key text;
  v_units jsonb := '{}'::jsonb;
  v_unit integer;
  v_any boolean := false;
  g record;
  v_list uuid[];
  v_default integer;
begin
  select r.id, r.calc_rule_version_id into rev
    from public.standard_estimate_revisions r where r.id = p_revision_id and r.pricing_model = 'v2.5';
  if not found then
    return pg_catalog.jsonb_build_object('por', true);
  end if;
  -- 版の選択枠と同じ組み合わせ以外がすべて未確定になる商品は、表を作らない（選択枠の売価はシミュレーターが先に見る）
  select x.price_on_request, x.is_installation, c.code as category_code
    into o
    from public.options x
    join public.option_categories c on c.id = x.category_id
   where x.id = p_option_id and x.status = 'published';
  if not found then
    return pg_catalog.jsonb_build_object('por', true);
  end if;
  select rv.auto_price_sections into v_auto_sections
    from public.pricing_calculation_rule_versions rv where rv.id = rev.calc_rule_version_id;
  if o.price_on_request
     or not (public.estimate_section_for_option(o.category_code, o.is_installation) = any(coalesce(v_auto_sections, '{}'::text[])))
     or not exists (select 1 from public.option_standard_cost_versions v where v.option_id = p_option_id and v.superseded_at is null) then
    return pg_catalog.jsonb_build_object('por', true);
  end if;

  for g in
    select vg.id
      from public.option_variant_groups vg
     where vg.option_id = p_option_id and vg.status = 'published'
     order by vg.sort_order, vg.id
  loop
    v_list := array(select vc.id from public.option_variant_choices vc
                     where vc.group_id = g.id and vc.status = 'published'
                     order by vc.sort_order, vc.id);
    -- 標準の選択肢の位置（1 始まり。0 は選ばない）
    select coalesce(min(x.ord), case when coalesce(array_length(v_list, 1), 0) > 0 then 1 else 0 end)::integer
      into v_default
      from unnest(v_list) with ordinality as x(id, ord)
      join public.option_variant_choices vc on vc.id = x.id
     where vc.kind in ('standard', 'fixed');
    v_group_lists := v_group_lists || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(v_list));
    v_sizes := v_sizes || (coalesce(array_length(v_list, 1), 0) + 1);
    v_base := v_base || v_default;
    v_total := v_total * (coalesce(array_length(v_list, 1), 0) + 1);
  end loop;

  v_partial := v_total > 64;
  if v_partial then
    -- 標準の組み合わせから 1 つの選択項目だけを変えた組み合わせ
    for v_pos in 1 .. coalesce(array_length(v_sizes, 1), 0) loop
      for v_val in 0 .. v_sizes[v_pos] - 1 loop
        if v_val <> v_base[v_pos] then
          v_swap_pos := v_swap_pos || v_pos;
          v_swap_val := v_swap_val || v_val;
        end if;
      end loop;
    end loop;
    v_count := coalesce(array_length(v_swap_pos, 1), 0) + 1;
  else
    v_count := v_total::integer;
  end if;

  for v_index in 0 .. v_count - 1 loop
    -- 選択項目ごとの値（0 は選ばない、k は k 番目の選択肢）
    if v_partial then
      v_vals := v_base;
      if v_index > 0 then
        v_vals[v_swap_pos[v_index]] := v_swap_val[v_index];
      end if;
    else
      v_rest := v_index;
      v_vals := '{}';
      for v_pos in 1 .. coalesce(array_length(v_sizes, 1), 0) loop
        v_vals := v_vals || (v_rest % v_sizes[v_pos]);
        v_rest := v_rest / v_sizes[v_pos];
      end loop;
    end if;
    v_parts := '{}';
    v_choices := '{}';
    for v_pos in 1 .. coalesce(array_length(v_sizes, 1), 0) loop
      if v_vals[v_pos] = 0 then
        v_parts := v_parts || '-'::text;
      else
        v_parts := v_parts || (v_vals[v_pos] - 1)::text;
        v_choices := v_choices || ((v_group_lists -> (v_pos - 1)) ->> (v_vals[v_pos] - 1))::uuid;
      end if;
    end loop;
    v_key := array_to_string(v_parts, '.');
    if v_index = 0 and v_partial then
      v_default_key := v_key;
    end if;
    v_unit := public.standard_estimate_v25_selection_unit(p_revision_id, p_option_id, v_choices);
    v_any := v_any or v_unit is not null;
    v_units := v_units || pg_catalog.jsonb_build_object(v_key, v_unit);
  end loop;

  if not v_any and not v_partial then
    return pg_catalog.jsonb_build_object('por', true);
  end if;
  if v_partial then
    return pg_catalog.jsonb_build_object('groups', v_group_lists, 'units', v_units, 'partial', true, 'default_key', v_default_key);
  end if;
  return pg_catalog.jsonb_build_object('groups', v_group_lists, 'units', v_units);
end;
$$;

comment on function public.standard_estimate_v25_price_table(uuid, uuid) is
  'シミュレーターに渡す、商品の選択肢の組み合わせごとの売価単価（原価は含まない）。組み合わせが 64 を超える商品は標準と 1 か所だけ変えた組み合わせだけ。内部の部品。';

-- ---------- 売価だけの形の v2.5 の標準見積（シミュレーター・保存・見積依頼で共通） ----------

create function public.standard_estimate_v25_sale_view(p_revision_id uuid, p_with_prices boolean)
returns jsonb
language sql
stable
set search_path = ''
as $sale_view$
  select pg_catalog.jsonb_build_object(
           'pricing_model', 'v2.5',
           'revision_id', r.id,
           'version', r.version,
           'base_model_id', m.base_model_id,
           'spec_code', m.spec_code,
           'size_code', mr.size_code,
           'fire_spec_code', bm.fire_spec_code,
           'tax_rate', r.tax_rate,
           'expense_rate', r.expense_rate,
           'subtotal_raw', r.subtotal_raw,
           'adjustment', r.standard_adjustment_amount,
           'subtotal', r.subtotal,
           'tax', r.tax,
           'total', r.total,
           'has_por', r.has_por,
           'sections', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'code', s.section_code,
                      'expense_method', s.expense_method,
                      'line_subtotal', s.line_subtotal,
                      'expense_amount', s.expense_amount,
                      'total', s.total,
                      'has_por', s.has_por
                    ) order by case s.section_code when 'base' then 0 when 'interior_exterior' then 1 when 'option' then 2 else 3 end)
               from public.standard_estimate_revision_sections s
              where s.revision_id = r.id
           ), '[]'::jsonb),
           'base_lines', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'section', l.section,
                      'name', l.name,
                      'quantity', l.quantity,
                      'unit', l.unit,
                      'unit_price', trunc(trunc(l.unit_price * r.sales_fee_rate) * r.markup_rate)::integer,
                      'amount', trunc(l.quantity * trunc(trunc(l.unit_price * r.sales_fee_rate) * r.markup_rate))::integer
                    ) order by l.sort_order, l.id)
               from public.base_master_revision_lines l
              where l.revision_id = r.base_master_revision_id
           ), '[]'::jsonb),
           -- 見積書の明細：商品の選択枠（売価）と、工事費などの明細。価格未確定は is_por
           'lines', coalesce((
             select pg_catalog.jsonb_agg(x.line order by x.sort_key)
               from (
                 select pg_catalog.jsonb_build_object(
                          'section_code', bi.section_code,
                          'group_label', bi.category_name_snapshot,
                          'name', bi.option_name_snapshot || coalesce((
                            select ' ／ ' || string_agg(bv.variant_choice_name_snapshot, '・' order by bv.sort_order)
                              from public.standard_estimate_revision_baseline_variants bv where bv.baseline_item_id = bi.id), ''),
                          'quantity', bi.quantity,
                          'unit', '式',
                          'unit_price', bi.sale_unit_price,
                          'amount', bi.amount,
                          'is_por', bi.amount is null
                        ) as line,
                        pg_catalog.lpad(bi.sort_order::text, 6, '0') || '-a' as sort_key
                   from public.standard_estimate_revision_baseline_items bi
                  where bi.revision_id = r.id
                 union all
                 select pg_catalog.jsonb_build_object(
                          'section_code', l.section_code,
                          'group_label', l.group_label,
                          'name', l.name,
                          'quantity', l.quantity,
                          'unit', l.unit,
                          'unit_price', l.unit_price,
                          'amount', l.amount,
                          'is_por', l.price_mode = 'por' or l.amount is null
                        ),
                        pg_catalog.lpad((100000 + l.sort_order)::text, 6, '0') || '-b'
                   from public.standard_estimate_revision_v25_lines l
                  where l.revision_id = r.id
               ) x
           ), '[]'::jsonb),
           -- 差額の基準（版の選択枠）。unit_price は公開した版の売価（未確定は 0・price_on_request）
           'baseline', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'option_id', bi.option_id,
                      'section_code', bi.section_code,
                      'selection_target_code', bi.selection_target_code,
                      'quantity', bi.quantity,
                      'unit_price', coalesce(bi.sale_unit_price, 0),
                      'price_on_request', bi.amount is null,
                      'variant_choice_ids', coalesce((
                        select pg_catalog.jsonb_agg(bv.variant_choice_id order by bv.variant_choice_id)
                          from public.standard_estimate_revision_baseline_variants bv where bv.baseline_item_id = bi.id), '[]'::jsonb),
                      'variant_extra', 0,
                      'amount', bi.amount
                    ) order by bi.sort_order, bi.id)
               from public.standard_estimate_revision_baseline_items bi
              where bi.revision_id = r.id
           ), '[]'::jsonb),
           'prices', case when p_with_prices then coalesce((
             select pg_catalog.jsonb_object_agg(o.id::text, public.standard_estimate_v25_price_table(r.id, o.id))
               from public.options o
              where o.status = 'published'
                and (o.base_model_id is null or o.base_model_id = m.base_model_id)
           ), '{}'::jsonb) else null end
         )
    from public.standard_estimate_revisions r
    join public.standard_estimate_masters m on m.id = r.standard_estimate_master_id
    join public.base_masters bm on bm.id = m.base_master_id
    join public.matrix_rows mr on mr.id = bm.matrix_row_id
   where r.id = p_revision_id
     and r.pricing_model = 'v2.5';
$sale_view$;

comment on function public.standard_estimate_v25_sale_view(uuid, boolean) is
  'v2.5 の標準見積の版を売価だけの形にする（原価・率・原価の Version は含まない）。p_with_prices でシミュレーターの売価の表をつける。内部の部品。';

-- シミュレーター用（サーバーが service_role で呼ぶ。お客様へ渡すかは、スイッチと本部のプレビューでページが決める）
create function public.get_simulator_v25_sale_views(p_base_model_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $views$
  select coalesce(pg_catalog.jsonb_agg(public.standard_estimate_v25_sale_view(r.id, true)
                                       order by m.spec_code, mr.size_code, bm.fire_spec_code), '[]'::jsonb)
    from public.standard_estimate_masters m
    join public.standard_estimate_revisions r on r.id = m.current_published_revision_id and r.status = 'published' and r.pricing_model = 'v2.5'
    join public.base_masters bm on bm.id = m.base_master_id
    join public.matrix_rows mr on mr.id = bm.matrix_row_id
    join public.base_models model on model.id = m.base_model_id and model.status = 'published'
   where m.base_model_id = p_base_model_id
     and m.status = 'active';
$views$;

comment on function public.get_simulator_v25_sale_views(uuid) is
  '公開中の v2.5 の標準見積を、売価だけの形（選択肢の組み合わせごとの売価の表つき）で返す。シミュレーターのページのサーバー側（service_role）だけが呼ぶ。';

-- シミュレーター用：表に無い「商品＋選択肢」の売価単価（組み合わせが多い商品で、2 つ以上の選択項目を変えたとき）。
-- サーバーが service_role で呼ぶ（スイッチが入っている間か、本部のプレビューのときだけ。判断はサーバー側）。売価だけを返す
--   p_items：[{ option_id, choice_ids: [選択肢 ID…] }, …]（200 件まで）。結果は同じ順の売価単価の配列（未確定は null）
create function public.get_simulator_v25_units(p_revision_id uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $units$
declare
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  -- 公開中（いまの版）の v2.5 の標準見積だけ。下書き・過去の版の売価は返さない
  if not exists (
    select 1
      from public.standard_estimate_masters m
      join public.standard_estimate_revisions r on r.id = m.current_published_revision_id and r.status = 'published' and r.pricing_model = 'v2.5'
     where r.id = p_revision_id and m.status = 'active'
  ) then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 公開中の v2.5 の標準見積が見つかりません';
  end if;
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array' or pg_catalog.jsonb_array_length(p_items) > 200 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 商品の指定が正しくありません（200 件まで）';
  end if;
  for v_item in select e.value from pg_catalog.jsonb_array_elements(p_items) as e(value) loop
    if pg_catalog.jsonb_typeof(v_item -> 'choice_ids') is distinct from 'array' or pg_catalog.jsonb_array_length(v_item -> 'choice_ids') > 30 then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 選択肢の指定が正しくありません（30 件まで）';
    end if;
    v_out := v_out || pg_catalog.jsonb_build_array(public.standard_estimate_v25_selection_unit(
      p_revision_id,
      (v_item ->> 'option_id')::uuid,
      array(select c.value::uuid from pg_catalog.jsonb_array_elements_text(v_item -> 'choice_ids') as c(value))));
  end loop;
  return v_out;
end;
$units$;

comment on function public.get_simulator_v25_units(uuid, jsonb) is
  '公開中の v2.5 の標準見積で、表に無い「商品＋選択肢」の売価単価を返す（原価・率は返さない）。シミュレーターのサーバー側（service_role）だけが呼ぶ。';

-- ---------- 保存した仕様に使う v2.5 の版（内部の部品） ----------

create function public.standard_estimate_v25_revision_for_configuration(p_configuration_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  cfg public.configurations;
  v_slug text;
  v_spec text;
  v_fire boolean;
  v_count integer;
  v_pick uuid;
begin
  select * into cfg from public.configurations where id = p_configuration_id;
  if not found then
    return null;
  end if;
  select m.slug into v_slug from public.base_models m where m.id = cfg.base_model_id;
  -- 互換：BOX の hotel-single は BOX ホテル仕様の標準見積で計算する
  v_spec := case when v_slug = 'box' and cfg.spec_code = 'hotel-single' then 'hotel' else cfg.spec_code end;
  if v_spec is null then
    return null;
  end if;
  v_fire := exists (
    select 1 from public.configuration_items ci join public.options o on o.id = ci.option_id
     where ci.configuration_id = cfg.id and o.code = 'fire-proof'
  );
  if v_fire then
    select count(*), (array_agg(r.id))[1] into v_count, v_pick
      from public.standard_estimate_masters m
      join public.standard_estimate_revisions r on r.id = m.current_published_revision_id and r.status = 'published' and r.pricing_model = 'v2.5'
      join public.base_masters bm on bm.id = m.base_master_id
     where m.base_model_id = cfg.base_model_id and m.spec_code = v_spec and m.status = 'active' and bm.fire_spec_code = 'fire';
    if v_count = 1 then
      return v_pick;
    end if;
  end if;
  select count(*), (array_agg(r.id))[1] into v_count, v_pick
    from public.standard_estimate_masters m
    join public.standard_estimate_revisions r on r.id = m.current_published_revision_id and r.status = 'published' and r.pricing_model = 'v2.5'
    join public.base_masters bm on bm.id = m.base_master_id
   where m.base_model_id = cfg.base_model_id and m.spec_code = v_spec and m.status = 'active' and bm.fire_spec_code = 'non_fire';
  return case when v_count = 1 then v_pick else null end;
end;
$$;

-- ---------- 保存した仕様の金額（v2.5・内部の部品） ----------

create function public.standard_estimate_v25_configuration_money(p_configuration_id uuid, p_revision_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cfg public.configurations;
  rev public.standard_estimate_revisions%rowtype;
  v_fire_revision boolean;
  v_has_faces boolean;
  v_code text;
  s record;
  item record;
  face record;
  v_unit integer;
  v_item_por boolean := false;
  v_current bigint;
  v_baseline bigint;
  v_delta bigint;
  v_line bigint;
  v_expense bigint;
  v_raw bigint := 0;
  v_subtotal bigint;
  v_tax bigint;
  v_sections jsonb := '{}'::jsonb;
begin
  select * into cfg from public.configurations where id = p_configuration_id;
  select * into rev from public.standard_estimate_revisions r where r.id = p_revision_id and r.pricing_model = 'v2.5';
  if cfg.id is null or rev.id is null then
    return null;
  end if;
  select bm.fire_spec_code = 'fire' into v_fire_revision
    from public.standard_estimate_masters m join public.base_masters bm on bm.id = m.base_master_id
   where m.id = rev.standard_estimate_master_id;
  v_has_faces := pg_catalog.jsonb_typeof(cfg.exterior_faces) = 'array' and pg_catalog.jsonb_array_length(cfg.exterior_faces) = 4;

  foreach v_code in array array['base', 'interior_exterior', 'option', 'sitework'] loop
    select x.expense_method, x.line_subtotal, x.expense_amount into s
      from public.standard_estimate_revision_sections x where x.revision_id = rev.id and x.section_code = v_code;
    if v_code = 'base' then
      v_delta := 0;
      v_line := coalesce(s.line_subtotal, 0);
      v_expense := coalesce(s.expense_amount, 0);
    else
      v_current := 0;
      for item in
        select ci.option_id, ci.quantity, coalesce(ci.variant_choice_ids, '{}'::uuid[]) as choice_ids
          from public.configuration_items ci
          join public.options o on o.id = ci.option_id and o.status = 'published'
          join public.option_categories cat on cat.id = o.category_id
         where ci.configuration_id = cfg.id
           and public.estimate_section_for_option(cat.code, o.is_installation) = v_code
           and not (v_has_faces and cat.code = 'exterior-wall')
           -- 防火の版を使うときは、防火仕様の行は版に含まれるので数えない
           and not (coalesce(v_fire_revision, false) and cat.code = 'fireproof')
      loop
        v_unit := public.standard_estimate_v25_selection_unit(rev.id, item.option_id, item.choice_ids);
        if v_unit is null then
          v_item_por := true;
        else
          v_current := v_current + v_unit::bigint * item.quantity;
        end if;
      end loop;
      if v_code = 'interior_exterior' and v_has_faces then
        for face in
          select (f.value ->> 'option_id')::uuid as option_id,
                 coalesce(array(select pg_catalog.jsonb_array_elements_text(coalesce(f.value -> 'variant_choice_ids', '[]'::jsonb))::uuid), '{}'::uuid[]) as choice_ids
            from pg_catalog.jsonb_array_elements(cfg.exterior_faces) as f(value)
            join public.options o on o.id = (f.value ->> 'option_id')::uuid and o.status = 'published'
            join public.option_categories cat on cat.id = o.category_id and cat.code = 'exterior-wall'
        loop
          v_unit := public.standard_estimate_v25_selection_unit(rev.id, face.option_id, face.choice_ids);
          if v_unit is null then
            v_item_por := true;
          else
            v_current := v_current + v_unit;
          end if;
        end loop;
      end if;
      select coalesce(sum(bi.amount), 0) into v_baseline
        from public.standard_estimate_revision_baseline_items bi
       where bi.revision_id = rev.id and bi.section_code = v_code and bi.amount is not null;
      v_delta := v_current - v_baseline;
      v_line := coalesce(s.line_subtotal, 0) + v_delta;
      v_expense := case when s.expense_method = 'rate' then trunc(v_line * rev.expense_rate)::bigint else 0 end;
    end if;
    v_sections := v_sections || pg_catalog.jsonb_build_object(v_code, pg_catalog.jsonb_build_object(
      'line_subtotal', v_line,
      'expense_amount', v_expense,
      'total', v_line + v_expense,
      'delta_line', v_delta,
      'expense_method', coalesce(s.expense_method, 'none')
    ));
    v_raw := v_raw + v_line + v_expense;
  end loop;

  v_subtotal := v_raw + rev.standard_adjustment_amount;
  v_tax := trunc(v_subtotal * rev.tax_rate)::bigint;
  return pg_catalog.jsonb_build_object(
    'sections', v_sections,
    'subtotal_raw', v_raw,
    'adjustment', rev.standard_adjustment_amount,
    'subtotal', v_subtotal,
    'tax', v_tax,
    'total', v_subtotal + v_tax,
    'tax_rate', rev.tax_rate,
    'expense_rate', rev.expense_rate,
    'has_por', coalesce(rev.has_por, false) or v_item_por
  );
end;
$$;

-- ---------- DB 側の計算の入口：スイッチが入っている間は v2.5 の版だけを使う ----------

-- 保存済みの仕様に使う標準見積（売価だけの形）。スイッチが切れている間・v2.5 の版が無い仕様は NULL
-- （見積依頼の税率・備考もこの関数を見る）。v2.5 以前の版（商品価格の列で差額を出す）は使わない
create or replace function public.standard_estimate_sale_view_for_configuration(p_configuration_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $view_for_configuration$
declare
  v_revision uuid;
begin
  /* サイトの新価格へ切り替えるまでは、これまでの計算のまま（2026-10-13 先方回答） */
  if not public.simulator_standard_pricing_enabled() then
    return null;
  end if;
  v_revision := public.standard_estimate_v25_revision_for_configuration(p_configuration_id);
  if v_revision is null then
    return null;
  end if;
  return public.standard_estimate_v25_sale_view(v_revision, false);
end;
$view_for_configuration$;

-- 保存済みの仕様の金額。スイッチが切れている間は false（これまでの計算）。
-- スイッチが入っている間：v2.5 の版で計算する。v2.5 の版が無い仕様は、商品価格の列（原価）で計算せず、金額を未確定（0 円）にする
create or replace function public.apply_standard_estimate_to_configuration(p_configuration_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $apply_to_configuration$
declare
  v_revision uuid;
  v_money jsonb;
  v_sections jsonb;
begin
  if not public.simulator_standard_pricing_enabled() then
    return false;
  end if;
  v_revision := public.standard_estimate_v25_revision_for_configuration(p_configuration_id);
  if v_revision is null then
    update public.configurations
       set base_price = 0, base_expense = 0, option_subtotal = 0, option_expense = 0, installation_subtotal = 0,
           adjustment = 0, subtotal = 0, tax = 0, total = 0
     where id = p_configuration_id;
    return true;
  end if;
  v_money := public.standard_estimate_v25_configuration_money(p_configuration_id, v_revision);
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

-- 見積依頼の明細。スイッチが切れている間は false（これまでの明細）。
-- スイッチが入っている間：v2.5 の版の明細（売価）と変更差額・経費。v2.5 の版が無い仕様は「別途お見積り」の 1 行（0 円）
create or replace function public.write_standard_estimate_quote_items(p_configuration_id uuid, p_quote_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $write_quote_items$
declare
  cfg public.configurations;
  v_revision uuid;
  v_view jsonb;
  v_money jsonb;
  v_sections jsonb;
  v_rate_label text;
  v_code text;
  v_kind text;
  v_base_sort integer;
  v_amount integer;
begin
  if not public.simulator_standard_pricing_enabled() then
    return false;
  end if;
  select * into cfg from public.configurations where id = p_configuration_id;
  if not found then
    return false;
  end if;
  v_revision := public.standard_estimate_v25_revision_for_configuration(p_configuration_id);
  if v_revision is null then
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order)
    values (p_quote_id, 'base', '本体・選択した商品一式', '標準見積の準備中の仕様のため、価格は担当者がお見積りします', '式',
            '価格未確定（別途お見積り）', 0, 1, 0, 1);
    return true;
  end if;
  v_view := public.standard_estimate_v25_sale_view(v_revision, false);
  v_money := public.standard_estimate_v25_configuration_money(p_configuration_id, v_revision);
  v_sections := v_money -> 'sections';
  v_rate_label := trim(trailing '.' from to_char((v_view ->> 'expense_rate')::numeric * 100, 'FM990.99'));

  -- 本体：固定した本体 Revision の明細（売価）
  insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
  select p_quote_id, 'base', l.value ->> 'name', l.value ->> 'section', l.value ->> 'unit',
         (l.value ->> 'unit_price')::integer, (l.value ->> 'quantity')::numeric, (l.value ->> 'amount')::integer, l.ordinality::integer
    from pg_catalog.jsonb_array_elements(v_view -> 'base_lines') with ordinality as l(value, ordinality);

  v_amount := (v_sections #>> '{base,expense_amount}')::numeric::integer;
  if v_amount <> 0 then
    insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
    values (p_quote_id, 'base_expense', '本体諸費用', '交通費、労災、安全管理費等（' || v_rate_label || '%）', '式', v_amount, 1, v_amount, 900);
  end if;

  foreach v_code in array array['interior_exterior', 'option', 'sitework'] loop
    v_kind := case v_code when 'interior_exterior' then 'interior_exterior' when 'option' then 'option' else 'installation' end;
    v_base_sort := case v_code when 'interior_exterior' then 1000 when 'option' then 2000 else 3000 end;

    -- 標準見積の明細（売価）。価格未確定の行は 0 円で「別途お見積り」と明記する
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order)
    select p_quote_id, v_kind, l.value ->> 'name', l.value ->> 'group_label', coalesce(l.value ->> 'unit', ''),
           case when (l.value ->> 'is_por')::boolean then '価格未確定（別途お見積り）' end,
           case when (l.value ->> 'is_por')::boolean then 0 else (l.value ->> 'unit_price')::integer end,
           coalesce((l.value ->> 'quantity')::numeric, 1),
           case when (l.value ->> 'is_por')::boolean then 0 else (l.value ->> 'amount')::integer end,
           v_base_sort + l.ordinality::integer
      from pg_catalog.jsonb_array_elements(v_view -> 'lines') with ordinality as l(value, ordinality)
     where l.value ->> 'section_code' = v_code;

    v_amount := (v_sections #>> array[v_code, 'delta_line'])::numeric::integer;
    if v_amount <> 0 then
      insert into public.quote_items (quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order)
      values (p_quote_id, v_kind, '選択商品の変更差額', '標準状態の商品との差額', '式', v_amount, 1, v_amount, v_base_sort + 900);
    end if;

    -- 外壁の面別の仕様は 0 円のスナップショットとして残す（価格は変更差額に反映済み）
    if v_code = 'interior_exterior' and pg_catalog.jsonb_typeof(cfg.exterior_faces) = 'array' and pg_catalog.jsonb_array_length(cfg.exterior_faces) = 4 then
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
            from pg_catalog.jsonb_array_elements(cfg.exterior_faces) as x(value)
        ) f
        join public.options o on o.id = f.option_id
        left join lateral (
          select string_agg(vg.name || '：' || vc.name, '／' order by vg.sort_order, vc.sort_order) as label
            from pg_catalog.jsonb_array_elements_text(f.variant_choice_ids) as j(choice_id)
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

  -- 選んだ商品に価格未確定（別途見積・原価未設定など）があれば、合計に含めていないことを明記する
  if (v_money ->> 'has_por')::boolean then
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order)
    values (p_quote_id, 'option', '価格未確定の商品', '選んだ商品のうち価格が未確定のもの（合計に含めていません）', '式',
            '価格未確定（別途お見積り）', 0, 1, 0, 2899);
  end if;

  return true;
end;
$write_quote_items$;

-- スイッチを入れられるのは、有効なすべての標準見積の公開中の版が v2.5 のときだけ（v2.5 以前の版は商品価格の列＝原価で差額を出すため）
create or replace function public.set_simulator_standard_pricing(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_before boolean;
  v_legacy text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  -- 権限は状態の判定より前に確認する（本部だけ）
  if coalesce(public.current_role_rank(), 0) < 3 then
    raise exception 'FORBIDDEN: シミュレーターの価格を切り替えられるのは本部だけです' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'VALIDATION: 切り替えの指定がありません' using errcode = 'P0001';
  end if;

  if p_enabled then
    select string_agg(m.name, '、' order by m.name) into v_legacy
      from public.standard_estimate_masters m
      left join public.standard_estimate_revisions r on r.id = m.current_published_revision_id and r.status = 'published'
     where m.status = 'active'
       and coalesce(r.pricing_model, 'legacy') <> 'v2.5';
    if v_legacy is not null then
      raise exception using errcode = 'P0001',
        message = 'VALIDATION: 公開中の版が v2.5 でない標準見積があるため切り替えられません（' || v_legacy || '）。v2.5 の版を公開してから切り替えてください';
    end if;
  end if;

  select coalesce((s.value ->> 'enabled')::boolean, false) into v_before
    from public.app_settings s where s.key = 'simulator_standard_pricing' for update;

  insert into public.app_settings (key, value, updated_by, updated_at)
  values ('simulator_standard_pricing', pg_catalog.jsonb_build_object('enabled', p_enabled), v_uid, now())
  on conflict (key) do update
    set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  if v_before is distinct from p_enabled then
    perform public.write_audit(
      'status', 'app_settings', null,
      case when p_enabled then 'シミュレーターの価格を新しい標準見積に切り替えました'
           else 'シミュレーターの価格をこれまでの計算に戻しました' end,
      pg_catalog.jsonb_build_object('simulator_standard_pricing', coalesce(v_before, false)),
      pg_catalog.jsonb_build_object('simulator_standard_pricing', p_enabled)
    );
  end if;
  return p_enabled;
end;
$$;

-- ---------- owner / EXECUTE ----------

alter function public.standard_estimate_v25_selection_unit(uuid, uuid, uuid[]) owner to postgres;
alter function public.standard_estimate_v25_price_table(uuid, uuid) owner to postgres;
alter function public.standard_estimate_v25_sale_view(uuid, boolean) owner to postgres;
alter function public.get_simulator_v25_sale_views(uuid) owner to postgres;
alter function public.get_simulator_v25_units(uuid, jsonb) owner to postgres;
alter function public.standard_estimate_v25_revision_for_configuration(uuid) owner to postgres;
alter function public.standard_estimate_v25_configuration_money(uuid, uuid) owner to postgres;

revoke all on function public.standard_estimate_v25_selection_unit(uuid, uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_price_table(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_sale_view(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.get_simulator_v25_sale_views(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_simulator_v25_units(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_revision_for_configuration(uuid) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_configuration_money(uuid, uuid) from public, anon, authenticated, service_role;

-- シミュレーターのページ（サーバー側）だけが売価を読む
grant execute on function public.get_simulator_v25_sale_views(uuid) to service_role;
grant execute on function public.get_simulator_v25_units(uuid, jsonb) to service_role;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn record;
  v_name text;
begin
  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_catalog.pg_get_userbyid(p.proowner) as owner_name, p.proconfig
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('standard_estimate_v25_selection_unit', 'standard_estimate_v25_price_table', 'standard_estimate_v25_sale_view',
                         'get_simulator_v25_sale_views', 'get_simulator_v25_units', 'standard_estimate_v25_revision_for_configuration',
                         'standard_estimate_v25_configuration_money', 'standard_estimate_sale_view_for_configuration',
                         'apply_standard_estimate_to_configuration', 'write_standard_estimate_quote_items', 'set_simulator_standard_pricing')
  loop
    if v_fn.owner_name <> 'postgres' or not coalesce(v_fn.proconfig, '{}'::text[]) @> array['search_path=""']::text[] then
      raise exception 'POSTCONDITION: % must be owned by postgres with an empty search_path', v_fn.proname;
    end if;
    if has_function_privilege('anon', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by anon', v_fn.proname;
    end if;
  end loop;
  foreach v_name in array array['public.standard_estimate_v25_selection_unit(uuid, uuid, uuid[])', 'public.standard_estimate_v25_price_table(uuid, uuid)',
                                'public.standard_estimate_v25_sale_view(uuid, boolean)', 'public.standard_estimate_v25_revision_for_configuration(uuid)',
                                'public.standard_estimate_v25_configuration_money(uuid, uuid)'] loop
    if has_function_privilege('authenticated', v_name, 'EXECUTE') or has_function_privilege('service_role', v_name, 'EXECUTE') then
      raise exception 'POSTCONDITION: internal function % must not be executable by API roles', v_name;
    end if;
  end loop;
  foreach v_name in array array['public.get_simulator_v25_sale_views(uuid)', 'public.get_simulator_v25_units(uuid, jsonb)'] loop
    if has_function_privilege('authenticated', v_name, 'EXECUTE') or not has_function_privilege('service_role', v_name, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must be executable by service_role only', v_name;
    end if;
    if not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_name::regprocedure and p.prosecdef) then
      raise exception 'POSTCONDITION: % must be SECURITY DEFINER', v_name;
    end if;
  end loop;
  -- この migration はスイッチを入れない
  if public.simulator_standard_pricing_enabled() then
    raise exception 'POSTCONDITION: the simulator pricing switch must stay off';
  end if;
end;
$postcondition$;

commit;
