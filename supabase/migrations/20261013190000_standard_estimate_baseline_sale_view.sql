-- PR C1：標準見積の「標準状態の商品」と、売価だけの取得経路（統合版依頼書 §9 の sale-only 取得経路・§17 の Simulator 連携の前提）。
--
-- 1. 標準状態の商品（baseline）
--    標準見積の Revision ごとに、シミュレーターで「標準の選択」とみなす商品（商品台帳）を本部が登録する。
--    お客様が商品を変えたときは「選んだ商品の価格 − 標準状態の商品の公開時点の価格」を差額にする（シミュレーターの切り替えで使う）。
--    表は 20260915012500 の standard_estimate_revision_baseline_items / _variants（既存・未使用）。
--    - 登録・変更は下書きの Revision だけ（本部）。lock_version で同時編集を検知する
--    - その仕様でお客様が選べるカテゴリーの、公開中の商品だけ（customer_category_selectable）
--    - 区分（内外装・オプション・別途工事）はシミュレーターと同じ分け方で DB が決める
--    - 次の Revision へ引き継ぎ、公開時に商品台帳の現在の価格・名称で snapshot を取り直す（公開後は変えない）
-- 2. 売価だけの取得経路（get_standard_estimate_sale_views）
--    公開中の標準見積を、原価・販売費率・掛率・社内メモ（備考）を除いた売価だけの形で返す。
--    シミュレーターのページ（サーバー側）がサービスロールで呼ぶ。未ログインの利用者・お客様が API から直接は呼べない
--    （anon へ開放できる SECURITY DEFINER 関数は RLS の判定関数だけ、というリハーサルの決まりに合わせる）。
--
-- 既存の関数（start_next_standard_estimate_revision・publish_standard_estimate_revision）は、
-- 適用済みの定義を検査してから置き換える（目印はちょうど 1 箇所、owner・SECURITY DEFINER・search_path・EXECUTE は不変）。
-- 既存 migration は編集しない。公開済みの標準見積のデータは変更しない。

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regclass('public.standard_estimate_revision_baseline_items') is null
     or to_regclass('public.standard_estimate_revision_baseline_variants') is null then
    raise exception 'PRECONDITION: standard estimate baseline tables (20260915012500) are missing';
  end if;
  if to_regprocedure('public.publish_standard_estimate_revision(uuid, integer)') is null
     or to_regprocedure('public.start_next_standard_estimate_revision(uuid, uuid)') is null then
    raise exception 'PRECONDITION: standard estimate money contract (20261013170000) must be applied first';
  end if;
  if to_regprocedure('public.customer_category_selectable(text, text, text)') is null then
    raise exception 'PRECONDITION: matrix-driven customer categories (20261013130000) must be applied first';
  end if;
  if to_regprocedure('public.estimate_section_for_option(text, boolean)') is null then
    raise exception 'PRECONDITION: estimate section classifier (20260911050000) is missing';
  end if;
  if to_regprocedure('public.set_standard_estimate_baseline(uuid, jsonb, integer)') is not null then
    raise exception 'PRECONDITION: set_standard_estimate_baseline already exists; review before applying';
  end if;
end;
$preflight$;

-- ---------- 内部の関数（API からは実行させない） ----------
-- 商品の区分は、シミュレーター・旧来の見積依頼と同じ public.estimate_section_for_option（20260911050000）で決める。

-- 標準状態の商品を別の Revision へ写す（次の Revision の作成で使う）
create function public.copy_standard_estimate_baseline(p_from_revision_id uuid, p_to_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $copy_baseline$
declare
  b public.standard_estimate_revision_baseline_items;
  v_new_id uuid;
begin
  for b in
    select * from public.standard_estimate_revision_baseline_items
     where revision_id = p_from_revision_id
     order by sort_order, id
  loop
    insert into public.standard_estimate_revision_baseline_items (
      revision_id, baseline_key, option_id, option_category_id, section_code, selection_target_code, quantity,
      option_code_snapshot, option_name_snapshot, category_code_snapshot, category_name_snapshot,
      unit_price_snapshot, price_on_request_snapshot, sort_order
    )
    values (
      p_to_revision_id, b.baseline_key, b.option_id, b.option_category_id, b.section_code, b.selection_target_code, b.quantity,
      b.option_code_snapshot, b.option_name_snapshot, b.category_code_snapshot, b.category_name_snapshot,
      b.unit_price_snapshot, b.price_on_request_snapshot, b.sort_order
    )
    returning id into v_new_id;

    insert into public.standard_estimate_revision_baseline_variants (
      baseline_item_id, variant_group_id, variant_choice_id,
      variant_group_code_snapshot, variant_group_name_snapshot, variant_choice_code_snapshot, variant_choice_name_snapshot,
      extra_price_snapshot, price_on_request_snapshot, sort_order
    )
    select v_new_id, v.variant_group_id, v.variant_choice_id,
           v.variant_group_code_snapshot, v.variant_group_name_snapshot, v.variant_choice_code_snapshot, v.variant_choice_name_snapshot,
           v.extra_price_snapshot, v.price_on_request_snapshot, v.sort_order
      from public.standard_estimate_revision_baseline_variants v
     where v.baseline_item_id = b.id;
  end loop;
end;
$copy_baseline$;

-- 公開時：公開中で、その仕様で選べる商品だけであることを確かめ、商品台帳の現在の価格・名称で snapshot を取り直す
create function public.refresh_standard_estimate_baseline(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $refresh_baseline$
begin
  if exists (
    select 1
      from public.standard_estimate_revision_baseline_items b
      join public.standard_estimate_revisions r on r.id = b.revision_id
      join public.standard_estimate_masters m on m.id = r.standard_estimate_master_id
      join public.base_models bm on bm.id = m.base_model_id
      left join public.options o on o.id = b.option_id
      left join public.option_categories c on c.id = o.category_id
     where b.revision_id = p_revision_id
       and (
         o.id is null
         or o.status <> 'published'
         or (o.base_model_id is not null and o.base_model_id <> m.base_model_id)
         or not coalesce(public.customer_category_selectable(bm.slug, m.spec_code, c.code), false)
       )
  ) or exists (
    select 1
      from public.standard_estimate_revision_baseline_variants v
      join public.standard_estimate_revision_baseline_items b on b.id = v.baseline_item_id
      left join public.option_variant_choices ch on ch.id = v.variant_choice_id
      left join public.option_variant_groups g on g.id = ch.group_id
     where b.revision_id = p_revision_id
       and (ch.id is null or ch.status <> 'published' or g.status <> 'published' or g.option_id <> b.option_id)
  ) then
    raise exception 'LOCKED: 標準状態の商品に、公開されていない・この仕様で選べない商品（または選択肢）があります。標準状態を見直してください'
      using errcode = 'P0001';
  end if;

  update public.standard_estimate_revision_baseline_items b
     set option_code_snapshot = o.code,
         option_name_snapshot = o.name,
         category_code_snapshot = c.code,
         category_name_snapshot = c.name,
         unit_price_snapshot = case when o.price_on_request then 0 else o.price end,
         price_on_request_snapshot = o.price_on_request,
         section_code = public.estimate_section_for_option(c.code, o.is_installation),
         selection_target_code = c.code
    from public.options o
    join public.option_categories c on c.id = o.category_id
   where b.revision_id = p_revision_id
     and o.id = b.option_id;

  update public.standard_estimate_revision_baseline_variants v
     set variant_group_code_snapshot = g.code,
         variant_group_name_snapshot = g.name,
         variant_choice_code_snapshot = ch.code,
         variant_choice_name_snapshot = ch.name,
         extra_price_snapshot = case when ch.price_on_request then 0 else ch.extra_price end,
         price_on_request_snapshot = ch.price_on_request
    from public.option_variant_choices ch
    join public.option_variant_groups g on g.id = ch.group_id
   where ch.id = v.variant_choice_id
     and v.baseline_item_id in (select b.id from public.standard_estimate_revision_baseline_items b where b.revision_id = p_revision_id);
end;
$refresh_baseline$;

-- ---------- RPC ----------

-- 下書きの Revision の標準状態の商品を置き換える（本部だけ）。新しい lock_version の Revision を返す
create function public.set_standard_estimate_baseline(p_revision_id uuid, p_items jsonb, p_expected_lock_version integer)
returns public.standard_estimate_revisions
language plpgsql
security definer
set search_path = ''
as $set_baseline$
declare
  v_uid uuid := auth.uid();
  rev public.standard_estimate_revisions;
  m public.standard_estimate_masters;
  v_model public.base_models;
  item jsonb;
  v_index integer := 0;
  v_option_id uuid;
  v_qty numeric;
  v_choice_ids uuid[];
  v_choice_id uuid;
  v_seen uuid[] := '{}'::uuid[];
  v_groups uuid[];
  o public.options;
  c public.option_categories;
  g public.option_variant_groups;
  ch public.option_variant_choices;
  v_item_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  select * into rev from public.standard_estimate_revisions where id = p_revision_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- 権限は状態の判定より前に確認する
  if not coalesce(public.can_edit_standard_estimate_master(rev.standard_estimate_master_id), false) then
    raise exception 'FORBIDDEN: この標準見積を編集できません' using errcode = '42501';
  end if;
  if rev.status <> 'draft' then
    raise exception 'LOCKED: 公開済みの Revision の標準状態は変更できません。次の Revision を作成してください' using errcode = 'P0001';
  end if;
  if rev.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でこの標準見積が更新されています。再読み込みして内容を確認してください' using errcode = 'P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'VALIDATION: 標準状態の商品の形式が不正です（200 件以内）' using errcode = 'P0001';
  end if;

  select * into m from public.standard_estimate_masters where id = rev.standard_estimate_master_id;
  select * into v_model from public.base_models where id = m.base_model_id;

  delete from public.standard_estimate_revision_baseline_items where revision_id = rev.id;

  for item in select value from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    if jsonb_typeof(item) <> 'object' then
      raise exception 'VALIDATION: %件目の形式が不正です', v_index using errcode = 'P0001';
    end if;
    begin
      v_option_id := (item ->> 'option_id')::uuid;
      v_qty := coalesce((item ->> 'quantity')::numeric, 1);
      v_choice_ids := coalesce(array(
        select x.value::uuid from jsonb_array_elements_text(coalesce(item -> 'variant_choice_ids', '[]'::jsonb)) as x(value)
      ), '{}'::uuid[]);
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
      raise exception 'VALIDATION: %件目の商品・数量・選択肢の形式が不正です', v_index using errcode = 'P0001';
    end;
    if v_option_id is null then
      raise exception 'VALIDATION: %件目の商品を選んでください', v_index using errcode = 'P0001';
    end if;
    if v_option_id = any(v_seen) then
      raise exception 'VALIDATION: %件目：同じ商品が重複しています', v_index using errcode = 'P0001';
    end if;
    v_seen := array_append(v_seen, v_option_id);
    if v_qty::text in ('NaN', 'Infinity', '-Infinity') or v_qty <= 0 or v_qty > 99999 or v_qty <> round(v_qty, 4) then
      raise exception 'VALIDATION: %件目の数量は 0 より大きく 99999 以下・小数 4 桁以内で入力してください', v_index using errcode = 'P0001';
    end if;

    select * into o from public.options where id = v_option_id;
    if not found or o.status <> 'published' or (o.base_model_id is not null and o.base_model_id <> m.base_model_id) then
      raise exception 'VALIDATION: %件目：この商品モデルで使える公開中の商品を選んでください', v_index using errcode = 'P0001';
    end if;
    select * into c from public.option_categories where id = o.category_id;
    if not coalesce(public.customer_category_selectable(v_model.slug, m.spec_code, c.code), false) then
      raise exception 'VALIDATION: %件目：この仕様ではお客様が選べないカテゴリーの商品です（%）', v_index, c.name using errcode = 'P0001';
    end if;

    insert into public.standard_estimate_revision_baseline_items (
      revision_id, option_id, option_category_id, section_code, selection_target_code, quantity,
      option_code_snapshot, option_name_snapshot, category_code_snapshot, category_name_snapshot,
      unit_price_snapshot, price_on_request_snapshot, sort_order
    )
    values (
      rev.id, o.id, c.id, public.estimate_section_for_option(c.code, o.is_installation), c.code, v_qty,
      o.code, o.name, c.code, c.name,
      case when o.price_on_request then 0 else o.price end, o.price_on_request, v_index
    )
    returning id into v_item_id;

    v_groups := '{}'::uuid[];
    foreach v_choice_id in array v_choice_ids loop
      select * into ch from public.option_variant_choices where id = v_choice_id;
      if not found or ch.status <> 'published' then
        raise exception 'VALIDATION: %件目：商品の選択肢が見つかりません', v_index using errcode = 'P0001';
      end if;
      select * into g from public.option_variant_groups where id = ch.group_id;
      if not found or g.option_id <> o.id or g.status <> 'published' then
        raise exception 'VALIDATION: %件目：この商品の選択肢ではありません', v_index using errcode = 'P0001';
      end if;
      if g.id = any(v_groups) then
        raise exception 'VALIDATION: %件目：同じ選択項目の選択肢が重複しています', v_index using errcode = 'P0001';
      end if;
      v_groups := array_append(v_groups, g.id);
      insert into public.standard_estimate_revision_baseline_variants (
        baseline_item_id, variant_group_id, variant_choice_id,
        variant_group_code_snapshot, variant_group_name_snapshot, variant_choice_code_snapshot, variant_choice_name_snapshot,
        extra_price_snapshot, price_on_request_snapshot, sort_order
      )
      values (
        v_item_id, g.id, ch.id, g.code, g.name, ch.code, ch.name,
        case when ch.price_on_request then 0 else ch.extra_price end, ch.price_on_request, cardinality(v_groups)
      );
    end loop;
  end loop;

  update public.standard_estimate_revisions
     set lock_version = lock_version + 1,
         updated_by = v_uid
   where id = rev.id
  returning * into rev;
  return rev;
end;
$set_baseline$;

-- 公開中の標準見積を、売価だけの形で返す（シミュレーターのページがサーバー側でサービスロールから呼ぶ）。
-- 原価・販売費率・掛率・調整理由・明細の備考（社内メモ）は返さない。POR の行は単価・金額とも NULL
create function public.get_standard_estimate_sale_views(p_base_model_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $sale_views$
  select coalesce(jsonb_agg(v.view order by v.spec_code, v.size_code, v.fire_rank), '[]'::jsonb)
    from (
      select m.spec_code, mr.size_code, case bm.fire_spec_code when 'non_fire' then 0 else 1 end as fire_rank,
             jsonb_build_object(
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
                 select jsonb_agg(jsonb_build_object(
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
                 select jsonb_agg(jsonb_build_object(
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
               'lines', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'section_code', l.section_code,
                          'group_label', l.group_label,
                          'name', l.name,
                          'quantity', l.quantity,
                          'unit', l.unit,
                          'unit_price', l.unit_price,
                          'amount', l.amount,
                          'is_por', l.price_mode = 'por'
                        ) order by l.sort_order, l.id)
                   from public.standard_estimate_revision_lines l
                  where l.revision_id = r.id
               ), '[]'::jsonb),
               'baseline', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'option_id', b.option_id,
                          'section_code', b.section_code,
                          'selection_target_code', b.selection_target_code,
                          'quantity', b.quantity,
                          'unit_price', b.unit_price_snapshot,
                          'price_on_request', b.price_on_request_snapshot,
                          'variant_choice_ids', coalesce((
                            select jsonb_agg(bv.variant_choice_id order by bv.sort_order)
                              from public.standard_estimate_revision_baseline_variants bv
                             where bv.baseline_item_id = b.id
                          ), '[]'::jsonb),
                          'variant_extra', coalesce((
                            select sum(bv.extra_price_snapshot)
                              from public.standard_estimate_revision_baseline_variants bv
                             where bv.baseline_item_id = b.id
                          ), 0)
                        ) order by b.sort_order, b.id)
                   from public.standard_estimate_revision_baseline_items b
                  where b.revision_id = r.id
               ), '[]'::jsonb)
             ) as view
        from public.standard_estimate_masters m
        join public.standard_estimate_revisions r on r.id = m.current_published_revision_id and r.status = 'published'
        join public.base_masters bm on bm.id = m.base_master_id
        join public.matrix_rows mr on mr.id = bm.matrix_row_id
        join public.base_models model on model.id = m.base_model_id and model.status = 'published'
       where m.base_model_id = p_base_model_id
         and m.status = 'active'
    ) v;
$sale_views$;

-- ---------- 既存の標準見積の処理への差し込み（適用済みの定義を検査してから置き換える） ----------

-- start_next_standard_estimate_revision：次の Revision へ標準状態の商品も引き継ぐ（snapshot は公開時に取り直す）
do $patch_start_next$
declare
  v_signature constant text := 'public.start_next_standard_estimate_revision(uuid, uuid)';
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
    E'  perform public.recalculate_standard_estimate_revision(v_rev, cur.standard_adjustment_amount, cur.standard_adjustment_reason);\n'
  ];
  v_to := array[
    E'  /* 標準状態の商品（シミュレーターの差額の基準）も引き継ぐ。snapshot は公開時に商品台帳の現在の価格で取り直す */\n'
    || E'  perform public.copy_standard_estimate_baseline(cur.id, v_rev);\n'
    || v_from[1]
  ];

  v_oid := to_regprocedure(v_signature);
  if v_oid is null then
    raise exception 'STANDARD_ESTIMATE_BASELINE: function % is missing', v_signature using errcode = 'P0001';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before from pg_catalog.pg_proc p where p.oid = v_oid;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_expected := v_definition;
  for v_index in 1 .. array_length(v_from, 1) loop
    if (length(v_expected) - length(replace(v_expected, v_from[v_index], ''))) / length(v_from[v_index]) <> 1 then
      raise exception 'STANDARD_ESTIMATE_BASELINE: % differs from the reviewed definition (anchor % is not unique)', v_signature, v_index
        using errcode = 'P0001';
    end if;
    v_expected := replace(v_expected, v_from[v_index], v_to[v_index]);
  end loop;

  execute v_expected;

  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after from pg_catalog.pg_proc p where p.oid = v_oid;
  if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
    raise exception 'STANDARD_ESTIMATE_BASELINE: % was not replaced as expected', v_signature using errcode = 'P0001';
  end if;
  if v_after.proowner is distinct from v_before.proowner
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.acl is distinct from v_before.acl then
    raise exception 'STANDARD_ESTIMATE_BASELINE: % owner / security definer / search_path / EXECUTE changed', v_signature using errcode = 'P0001';
  end if;
end;
$patch_start_next$;

-- publish_standard_estimate_revision：公開の直前に、標準状態の商品を確かめて snapshot を取り直す
do $patch_publish$
declare
  v_signature constant text := 'public.publish_standard_estimate_revision(uuid, integer)';
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
    E'  perform public.recalculate_standard_estimate_revision(rev.id);\n'
  ];
  v_to := array[
    E'  /* 標準状態の商品：公開中で、この仕様で選べる商品だけであることを確かめ、商品台帳の現在の価格で snapshot を取り直す */\n'
    || E'  perform public.refresh_standard_estimate_baseline(rev.id);\n'
    || v_from[1]
  ];

  v_oid := to_regprocedure(v_signature);
  if v_oid is null then
    raise exception 'STANDARD_ESTIMATE_BASELINE: function % is missing', v_signature using errcode = 'P0001';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_before from pg_catalog.pg_proc p where p.oid = v_oid;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_expected := v_definition;
  for v_index in 1 .. array_length(v_from, 1) loop
    if (length(v_expected) - length(replace(v_expected, v_from[v_index], ''))) / length(v_from[v_index]) <> 1 then
      raise exception 'STANDARD_ESTIMATE_BASELINE: % differs from the reviewed definition (anchor % is not unique)', v_signature, v_index
        using errcode = 'P0001';
    end if;
    v_expected := replace(v_expected, v_from[v_index], v_to[v_index]);
  end loop;

  execute v_expected;

  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into v_after from pg_catalog.pg_proc p where p.oid = v_oid;
  if pg_catalog.pg_get_functiondef(v_oid) is distinct from v_expected then
    raise exception 'STANDARD_ESTIMATE_BASELINE: % was not replaced as expected', v_signature using errcode = 'P0001';
  end if;
  if v_after.proowner is distinct from v_before.proowner
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.acl is distinct from v_before.acl then
    raise exception 'STANDARD_ESTIMATE_BASELINE: % owner / security definer / search_path / EXECUTE changed', v_signature using errcode = 'P0001';
  end if;
end;
$patch_publish$;

-- ---------- owner / EXECUTE ----------

alter function public.copy_standard_estimate_baseline(uuid, uuid) owner to postgres;
alter function public.refresh_standard_estimate_baseline(uuid) owner to postgres;
alter function public.set_standard_estimate_baseline(uuid, jsonb, integer) owner to postgres;
alter function public.get_standard_estimate_sale_views(uuid) owner to postgres;

revoke all on function public.copy_standard_estimate_baseline(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.refresh_standard_estimate_baseline(uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_standard_estimate_baseline(uuid, jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.get_standard_estimate_sale_views(uuid) from public, anon, authenticated, service_role;

grant execute on function public.set_standard_estimate_baseline(uuid, jsonb, integer) to authenticated;
grant execute on function public.get_standard_estimate_sale_views(uuid) to service_role;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn regprocedure;
  v_view text;
begin
  v_fn := 'public.set_standard_estimate_baseline(uuid, jsonb, integer)'::regprocedure;
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('service_role', v_fn, 'EXECUTE')
     or not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'POSTCONDITION: % must be executable by authenticated only', v_fn;
  end if;
  v_fn := 'public.get_standard_estimate_sale_views(uuid)'::regprocedure;
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'POSTCONDITION: % must be executable by service_role only (server side)', v_fn;
  end if;
  foreach v_fn in array array[
    'public.copy_standard_estimate_baseline(uuid, uuid)'::regprocedure,
    'public.refresh_standard_estimate_baseline(uuid)'::regprocedure
  ]
  loop
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by API roles', v_fn;
    end if;
  end loop;

  -- 売価だけの取得経路は、原価・販売費率・掛率・備考を返さない
  v_view := pg_catalog.pg_get_functiondef('public.get_standard_estimate_sale_views(uuid)'::regprocedure);
  if v_view ~* '''(cost_[a-z_]*|sales_fee_rate|markup_rate|remark|standard_adjustment_reason)''' then
    raise exception 'POSTCONDITION: sale views must not expose costs, internal rates or remarks';
  end if;
end;
$postcondition$;

commit;
