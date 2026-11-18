-- 標準見積 v2.5：商品行と手入力明細の混在の並び順と、商品行の工事項目を保存する（2026-11-16 の先方の依頼）
--
-- * 並び順：選択枠（商品）と v2.5 の明細（手入力）に display_order（版の中で通しの番号）を持つ。保存の payload の
--   slots[i].row_order・lines[j].row_order（全部の行に付けるか、全部省略）をそのまま入れる。省略・既存の行は null で、
--   今までどおり「商品→手入力」の順。見積書の明細（sale_view の lines）と Web 以外の見積の下書きの行（D1c）は、
--   display_order があればその順（商品と手入力を混ぜる）で並べる。並びは金額の計算に関わらない
-- * 工事項目：選択枠に work_item（工事項目のラベルの写し。商品台帳には足さない）を持つ。保存の payload の slots[i].work_item。
--   手入力明細の工事項目は、今までどおり group_label。見積書の明細の摘要（商品の行）は、work_item があれば「工事項目（位置）」
-- * 次の版への写しは display_order・work_item も写す。既存の行（公開済み・下書き）は変えない
--
-- 既存の関数は、目印を確かめて差し込む（本体を丸ごと写さない）。未適用の #618 が使う目印の行は変えない（どちらを先に当てても通る）。
begin;

set local lock_timeout = '5s';

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.save_standard_estimate_v25_draft(uuid, integer, jsonb)') is null
     or to_regprocedure('public.standard_estimate_v25_copy_slots(uuid, uuid)') is null
     or to_regprocedure('public.standard_estimate_v25_copy_lines(uuid, uuid, boolean)') is null
     or to_regprocedure('public.standard_estimate_v25_sale_view(uuid, boolean)') is null
     or to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid, boolean)') is null then
    raise exception 'PRECONDITION: the v2.5 standard estimate functions must exist';
  end if;
  -- #647（販売単位の写し）の後であること
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'standard_estimate_revision_baseline_items' and column_name = 'unit_snapshot') then
    raise exception 'PRECONDITION: 20261110130000 (#647) must be applied first';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public'
                and ((table_name = 'standard_estimate_revision_baseline_items' and column_name in ('display_order', 'work_item'))
                     or (table_name = 'standard_estimate_revision_v25_lines' and column_name = 'display_order'))) then
    raise exception 'PRECONDITION: the row order / work item columns already exist';
  end if;
end;
$preflight$;

-- ---------- 列 ----------

alter table public.standard_estimate_revision_baseline_items
  add column display_order integer,
  add column work_item text;
alter table public.standard_estimate_revision_baseline_items
  add constraint standard_estimate_revision_baseline_items_display_order_check
    check (display_order is null or display_order between 1 and 100000),
  add constraint standard_estimate_revision_baseline_items_work_item_check
    check (work_item is null or (work_item = pg_catalog.btrim(work_item) and pg_catalog.char_length(work_item) between 1 and 120));
alter table public.standard_estimate_revision_v25_lines add column display_order integer;
alter table public.standard_estimate_revision_v25_lines
  add constraint standard_estimate_revision_v25_lines_display_order_check
    check (display_order is null or display_order between 1 and 100000);

comment on column public.standard_estimate_revision_baseline_items.display_order is
  '版の中で商品の行と手入力明細（v25_lines）を通して並べる順（1 始まり）。null は今までどおり「商品→手入力」の順（2026-11-16 の先方の依頼）';
comment on column public.standard_estimate_revision_baseline_items.work_item is
  '商品の行の工事項目（ラベルの写し。標準見積の画面でカテゴリーから自動で入れ、変えられる）。null は未設定（2026-11-16 の先方の依頼）';
comment on column public.standard_estimate_revision_v25_lines.display_order is
  '版の中で商品の行と手入力明細を通して並べる順（1 始まり）。null は今までどおり「商品→手入力」の順（2026-11-16 の先方の依頼）';

-- ---------- 既存の関数に、目印を確かめて差し込む ----------

-- 適用済みの定義（pg_get_functiondef）の目印がちょうど 1 か所あることを確かめてから置き換える。
-- 想定と違う定義なら何も変えずに止まる。所有者・SECURITY DEFINER・search_path・EXECUTE は前後で変わらないことを確かめる
create function pg_temp.rw_patch_function(p_target regprocedure, p_old text, p_new text)
returns void
language plpgsql
as $patch$
declare
  v_def text;
  v_count integer;
  v_before text;
  v_after text;
begin
  select pg_catalog.concat_ws('|', p.proowner::regrole::text, p.prosecdef::text, coalesce(p.proconfig::text, ''), coalesce(p.proacl::text, ''))
    into v_before
    from pg_catalog.pg_proc p where p.oid = p_target;
  v_def := pg_catalog.pg_get_functiondef(p_target);
  v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, p_old, ''))) / pg_catalog.length(p_old);
  if v_count <> 1 then
    raise exception 'PRECONDITION: the definition of % has % markers (expected 1)', p_target, v_count;
  end if;
  execute pg_catalog.replace(v_def, p_old, p_new);
  select pg_catalog.concat_ws('|', p.proowner::regrole::text, p.prosecdef::text, coalesce(p.proconfig::text, ''), coalesce(p.proacl::text, ''))
    into v_after
    from pg_catalog.pg_proc p where p.oid = p_target;
  if v_after is distinct from v_before then
    raise exception 'POSTCONDITION: owner / security definer / search_path / ACL of % changed (% -> %)', p_target, v_before, v_after;
  end if;
end;
$patch$;

-- 下書きの保存：row_order・work_item を受け取る
select pg_temp.rw_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$  v_item_id uuid;
$old$,
  $new$  v_item_id uuid;
  -- 混在の並び順と工事項目（2026-11-16 の先方の依頼）
  v_row_order integer;
  v_work_item text;
  v_order_given boolean;
  v_seen_orders integer[] := '{}'::integer[];
$new$
);
select pg_temp.rw_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$      v_slot_label := nullif(pg_catalog.btrim(coalesce(item ->> 'slot_label', '')), '');
$old$,
  $new$      v_slot_label := nullif(pg_catalog.btrim(coalesce(item ->> 'slot_label', '')), '');
      v_row_order := (item ->> 'row_order')::integer;
      v_work_item := nullif(pg_catalog.btrim(coalesce(item ->> 'work_item', '')), '');
$new$
);
select pg_temp.rw_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$message = format('VALIDATION: 商品 %s 件目：位置・用途の名前は 40 文字までです', v_index);
    end if;
$old$,
  $new$message = format('VALIDATION: 商品 %s 件目：位置・用途の名前は 40 文字までです', v_index);
    end if;
    -- 工事項目（文字で 120 文字まで）と並び順（数で、全部の行に付けるか全部省略。1〜100000 で、商品と明細を通して重ならない）
    if pg_catalog.jsonb_typeof(item -> 'work_item') not in ('string', 'null')
       or pg_catalog.jsonb_typeof(item -> 'row_order') not in ('number', 'null') then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：工事項目は文字、並び順は数で指定してください', v_index);
    end if;
    if v_work_item is not null and pg_catalog.char_length(v_work_item) > 120 then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：工事項目は 120 文字までです', v_index);
    end if;
    if v_order_given is not null and v_order_given <> (v_row_order is not null) then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 並び順は、すべての商品と明細に付けるか、すべて省略してください';
    end if;
    v_order_given := v_row_order is not null;
    if v_row_order is not null then
      if v_row_order < 1 or v_row_order > 100000 then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：並び順は 1〜100000 で指定してください', v_index);
      end if;
      if v_row_order = any(v_seen_orders) then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 商品 %s 件目：並び順が重なっています（%s）', v_index, v_row_order);
      end if;
      v_seen_orders := pg_catalog.array_append(v_seen_orders, v_row_order);
    end if;
$new$
);
select pg_temp.rw_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$      price_mode, standard_cost_version_id, manual_unit_price, slot_code, slot_label, unit_snapshot
$old$,
  $new$      price_mode, standard_cost_version_id, manual_unit_price, slot_code, slot_label, unit_snapshot, display_order, work_item
$new$
);
select pg_temp.rw_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$      v_mode, v_cost_pin, v_manual, v_slot_code, v_slot_label, nullif(pg_catalog.btrim(coalesce(o.price_unit, '')), '')
$old$,
  $new$      v_mode, v_cost_pin, v_manual, v_slot_code, v_slot_label, nullif(pg_catalog.btrim(coalesce(o.price_unit, '')), ''), v_row_order, v_work_item
$new$
);
select pg_temp.rw_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$      v_line_key := nullif(item ->> 'line_key', '')::uuid;
$old$,
  $new$      v_line_key := nullif(item ->> 'line_key', '')::uuid;
      v_row_order := (item ->> 'row_order')::integer;
$new$
);
select pg_temp.rw_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$    if v_mode = 'por' then
      v_unit_price := null;
    end if;
$old$,
  $new$    if v_mode = 'por' then
      v_unit_price := null;
    end if;
    -- 並び順（商品と同じ決まり）
    if pg_catalog.jsonb_typeof(item -> 'row_order') not in ('number', 'null') then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s 行目：並び順は数で指定してください', v_index);
    end if;
    if v_order_given is not null and v_order_given <> (v_row_order is not null) then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 並び順は、すべての商品と明細に付けるか、すべて省略してください';
    end if;
    v_order_given := v_row_order is not null;
    if v_row_order is not null then
      if v_row_order < 1 or v_row_order > 100000 then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s 行目：並び順は 1〜100000 で指定してください', v_index);
      end if;
      if v_row_order = any(v_seen_orders) then
        raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s 行目：並び順が重なっています（%s）', v_index, v_row_order);
      end if;
      v_seen_orders := pg_catalog.array_append(v_seen_orders, v_row_order);
    end if;
$new$
);
select pg_temp.rw_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order
$old$,
  $new$      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order, display_order
$new$
);
select pg_temp.rw_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$      coalesce((item ->> 'review_required')::boolean, false), v_index
$old$,
  $new$      coalesce((item ->> 'review_required')::boolean, false), v_index, v_row_order
$new$
);

-- 版の複製（公開した版から次の下書きを作る）：並び順と工事項目も写す
select pg_temp.rw_patch_function(
  'public.standard_estimate_v25_copy_slots(uuid, uuid)'::regprocedure,
  $old$manual_unit_price, slot_code, slot_label, unit_snapshot$old$,
  $new$manual_unit_price, slot_code, slot_label, unit_snapshot, display_order, work_item$new$
);
select pg_temp.rw_patch_function(
  'public.standard_estimate_v25_copy_slots(uuid, uuid)'::regprocedure,
  $old$b.slot_code, b.slot_label, b.unit_snapshot$old$,
  $new$b.slot_code, b.slot_label, b.unit_snapshot, b.display_order, b.work_item$new$
);

-- 明細の複製：v2.5 の版から写すときは並び順も写す（v2.5 以前の版の明細には並び順は無い）。#618 は変えない関数なので置き換える
create or replace function public.standard_estimate_v25_copy_lines(p_from_revision_id uuid, p_to_revision_id uuid, p_from_legacy boolean)
returns void
language plpgsql
set search_path to ''
as $function$
begin
  if not p_from_legacy then
    insert into public.standard_estimate_revision_v25_lines (
      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order,
      display_order
    )
    select p_to_revision_id, l.line_key, l.section_code, l.group_label, l.name, l.quantity, l.unit, l.price_mode, l.unit_price, l.amount,
           l.remark, l.review_required, l.sort_order, l.display_order
      from public.standard_estimate_revision_v25_lines l
     where l.revision_id = p_from_revision_id;
  else
    insert into public.standard_estimate_revision_v25_lines (
      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order
    )
    select p_to_revision_id, l.line_key, l.section_code, l.group_label, l.name, l.quantity, l.unit,
           case when l.price_mode = 'por' or l.section_code = 'sitework' then 'por' else 'manual' end,
           case when l.price_mode = 'por' or l.section_code = 'sitework' then null else l.unit_price end,
           case when l.price_mode = 'por' or l.section_code = 'sitework' then null else trunc(l.quantity * l.unit_price)::integer end,
           l.remark, true, l.sort_order
      from public.standard_estimate_revision_lines l
     where l.revision_id = p_from_revision_id;
  end if;
end;
$function$;

-- 売価だけの形：見積書の明細の並び（display_order があれば商品と手入力を混ぜる）と、商品の行の摘要（工事項目）
select pg_temp.rw_patch_function(
  'public.standard_estimate_v25_sale_view(uuid, boolean)'::regprocedure,
  $old$                          'group_label', case when bi.slot_label is null then bi.category_name_snapshot
                                              else bi.category_name_snapshot || '（' || bi.slot_label || '）' end,
$old$,
  $new$                          -- 工事項目があれば「工事項目（位置）」、無ければ今までどおり「カテゴリー（位置）」（2026-11-16 の先方の依頼）
                          'group_label', case when bi.work_item is not null then bi.work_item || coalesce('（' || bi.slot_label || '）', '')
                                              when bi.slot_label is null then bi.category_name_snapshot
                                              else bi.category_name_snapshot || '（' || bi.slot_label || '）' end,
                          'work_item', bi.work_item,
                          'display_order', bi.display_order,
$new$
);
select pg_temp.rw_patch_function(
  'public.standard_estimate_v25_sale_view(uuid, boolean)'::regprocedure,
  $old$                        pg_catalog.lpad(bi.sort_order::text, 6, '0') || '-a' as sort_key
$old$,
  $new$                        case when bi.display_order is not null then '0-' || pg_catalog.lpad(bi.display_order::text, 9, '0')
                             else '1-' || pg_catalog.lpad(bi.sort_order::text, 6, '0') || '-a' end as sort_key
$new$
);
select pg_temp.rw_patch_function(
  'public.standard_estimate_v25_sale_view(uuid, boolean)'::regprocedure,
  $old$                        pg_catalog.lpad((100000 + l.sort_order)::text, 6, '0') || '-b'
$old$,
  $new$                        case when l.display_order is not null then '0-' || pg_catalog.lpad(l.display_order::text, 9, '0')
                             else '1-' || pg_catalog.lpad((100000 + l.sort_order)::text, 6, '0') || '-b' end
$new$
);
select pg_temp.rw_patch_function(
  'public.standard_estimate_v25_sale_view(uuid, boolean)'::regprocedure,
  $old$                          'option_id', null,
                          'slot_code', null
$old$,
  $new$                          'option_id', null,
                          'slot_code', null,
                          'work_item', l.group_label,
                          'display_order', l.display_order
$new$
);

-- Web 以外の見積の下書きの行（D1c）：並びと商品の行の摘要は見積書の明細と同じ
select pg_temp.rw_patch_function(
  'public.standard_estimate_v25_quote_draft_lines(uuid, boolean)'::regprocedure,
  $old$    select case bi.section_code when 'interior_exterior' then 2 when 'option' then 3 else 4 end, 0, bi.sort_order, bi.id::text,
$old$,
  $new$    select case bi.section_code when 'interior_exterior' then 2 when 'option' then 3 else 4 end,
           case when bi.display_order is null then 1 else 0 end, coalesce(bi.display_order, bi.sort_order), bi.id::text,
$new$
);
select pg_temp.rw_patch_function(
  'public.standard_estimate_v25_quote_draft_lines(uuid, boolean)'::regprocedure,
  $old$             'description', case when bi.slot_label is null then bi.category_name_snapshot
                                 else bi.category_name_snapshot || '（' || bi.slot_label || '）' end,
$old$,
  $new$             'description', case when bi.work_item is not null then bi.work_item || coalesce('（' || bi.slot_label || '）', '')
                                 when bi.slot_label is null then bi.category_name_snapshot
                                 else bi.category_name_snapshot || '（' || bi.slot_label || '）' end,
$new$
);
select pg_temp.rw_patch_function(
  'public.standard_estimate_v25_quote_draft_lines(uuid, boolean)'::regprocedure,
  $old$    select case l.section_code when 'interior_exterior' then 2 when 'option' then 3 else 4 end, 1, l.sort_order, l.id::text,
$old$,
  $new$    select case l.section_code when 'interior_exterior' then 2 when 'option' then 3 else 4 end,
           case when l.display_order is null then 2 else 0 end, coalesce(l.display_order, l.sort_order), l.id::text,
$new$
);

-- ---------- 所有者と権限 ----------

alter function public.standard_estimate_v25_copy_lines(uuid, uuid, boolean) owner to postgres;
revoke all on function public.standard_estimate_v25_copy_lines(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- ---------- postconditions ----------

do $postconditions$
declare
  v_save text := pg_catalog.pg_get_functiondef('public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure);
begin
  -- 既存の行は変えていない（並び順・工事項目は全件 null）
  if exists (select 1 from public.standard_estimate_revision_baseline_items where display_order is not null or work_item is not null)
     or exists (select 1 from public.standard_estimate_revision_v25_lines where display_order is not null) then
    raise exception 'POSTCONDITION: existing rows must not change';
  end if;
  if has_function_privilege('authenticated', 'public.standard_estimate_v25_copy_lines(uuid, uuid, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.standard_estimate_v25_copy_lines(uuid, uuid, boolean)', 'EXECUTE') then
    raise exception 'POSTCONDITION: copy_lines must not be executable by API roles';
  end if;
  if pg_catalog.strpos(v_save, 'v_slot_code, v_slot_label, nullif(pg_catalog.btrim(coalesce(o.price_unit, '''')), ''''), v_row_order, v_work_item') = 0
     or pg_catalog.strpos(v_save, 'review_required, sort_order, display_order') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.standard_estimate_v25_sale_view(uuid, boolean)'::regprocedure),
                          '''work_item'', l.group_label') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.standard_estimate_v25_quote_draft_lines(uuid, boolean)'::regprocedure),
                          'coalesce(l.display_order, l.sort_order)') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.standard_estimate_v25_copy_slots(uuid, uuid)'::regprocedure),
                          'b.unit_snapshot, b.display_order, b.work_item') = 0 then
    raise exception 'POSTCONDITION: the patched functions are not as expected';
  end if;
  -- #618（区分の経費の決め方）がまだ当たっていなければ、#618 の保存の目印の行が残っていること
  if to_regprocedure('public.standard_estimate_v25_expense_settings(uuid)') is null
     and pg_catalog.strpos(v_save, '  perform public.standard_estimate_v25_recalculate(rev.id, false, v_adjustment, v_reason);') = 0 then
    raise exception 'POSTCONDITION: the markers of #618 must remain';
  end if;
end;
$postconditions$;

commit;
