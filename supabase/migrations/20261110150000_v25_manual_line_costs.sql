-- 標準見積 v2.5：手入力明細（商品に紐づかない明細）の原価単価を入力・保存し、内部原価・公開・案件見積の下書きに反映する
-- （2026-11-20 の先方の依頼「手入力明細の原価入力復活」）
--
-- 決まり（新しく決めたものは無い。既存の確定事項に合わせる）：
-- * 原価単価（税別・0〜100,000,000 円の整数）は売価と別に入力する。原価金額 = trunc(数量 × 原価単価)
--   （統合版依頼書 6-2・旧標準見積の手入力明細と同じ。販売費率・掛率は掛けない）。原価を入れても売価（unit_price・amount）は変えない
-- * 原価未入力（null。原価未設定）と 0 円を分ける。未入力を 0 円にしない（2026-11-06 の先方回答 ⑤-2・⑤-5）。別途見積の行は原価を持たない
-- * 内部原価：区分の原価明細小計に手入力明細の原価金額を足す。原価側の経費 = trunc(原価明細小計 × 経費率) は今の式のまま。売価側は変えない
-- * 公開：別途見積でない手入力明細の原価単価が未入力なら公開しない（⑤-2：別途見積でない自由明細の原価は登録必須）
-- * Web 以外の案件見積の下書き（D1c）：版で固定した手入力明細の原価を写す（最新の値で置き換えない）。
--   原価単価が未入力の手入力明細・売価を入力した商品の行を含む版からは、今までどおり作らない（原価を 0 円にも売価と同じにもしない）
-- * 次の版の下書きへ原価も写す。v2.5 以前の標準見積から写すときは、旧標準見積に登録された原価を写す（⑤-5。
--   別途見積・別途工事の行と、v2.5 の明細の決まり（0〜100,000,000 円・原価金額が整数に入る）に合わない値は原価未設定）
-- * 既存の下書きの手入力明細のうち、旧標準見積から写したまま変えていない行（line_key・区分・品名・数量・単位・売価が同じで、
--   旧標準見積の原価が 1 つに決まり、その値が v2.5 の明細の決まりに合う行。別途工事は除く）に、旧標準見積に登録された原価を写す
--   （⑤-5。2026-11-04 の提案 2-2 の 4）。ほかの行は原価未設定のまま。区分・版の原価の列だけを再計算と同じ式で足し直し、
--   売価の列は変えない（写した下書きの区分の原価の列が再計算の式と合わなければ止める）。公開済みの版・発行済みの見積は変えない
-- * 原価は本部だけが見る（明細の表は本部だけが読める今の決まりのまま。見積書・シミュレーター・Web の見積の売価の形には足さない）
-- * 保存の payload に cost_unit_price が無い行（原価の欄を知らない画面からの保存）は、同じ line_key の今の原価を残す
--
-- 既存の関数は、目印を確かめて差し込む（本体を丸ごと写さない）。未適用の #618 が使う目印の行は変えない（どちらを先に当てても通る）
begin;

set local lock_timeout = '5s';

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.save_standard_estimate_v25_draft(uuid, integer, jsonb)') is null
     or to_regprocedure('public.standard_estimate_v25_copy_lines(uuid, uuid, boolean)') is null
     or to_regprocedure('public.standard_estimate_v25_recalculate(uuid, boolean, integer, text)') is null
     or to_regprocedure('public.publish_standard_estimate_v25_revision(uuid, integer)') is null
     or to_regprocedure('public.preview_standard_estimate_v25_revision(uuid)') is null
     or to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid, boolean)') is null
     or to_regprocedure('public.standard_estimate_v25_set_writer(boolean)') is null then
    raise exception 'PRECONDITION: the v2.5 standard estimate functions must exist';
  end if;
  -- 混在の並び順（20261110140000）の後であること
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'standard_estimate_revision_v25_lines' and column_name = 'display_order') then
    raise exception 'PRECONDITION: 20261110140000 (row order / work items) must be applied first';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'standard_estimate_revision_v25_lines'
                and column_name in ('cost_unit_price', 'cost_amount'))
     or to_regprocedure('public.standard_estimate_v25_fill_line_costs_from_legacy(uuid)') is not null then
    raise exception 'PRECONDITION: the manual line cost columns already exist';
  end if;
  -- 旧標準見積の明細は、別途見積でない行に原価がある（写す原価の元）
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'standard_estimate_revision_lines' and column_name = 'cost_unit_price') then
    raise exception 'PRECONDITION: the legacy standard estimate lines must have cost_unit_price';
  end if;
end;
$preflight$;

-- ---------- 列 ----------

alter table public.standard_estimate_revision_v25_lines
  add column cost_unit_price integer,
  add column cost_amount integer;
alter table public.standard_estimate_revision_v25_lines
  add constraint standard_estimate_v25_lines_cost check (
    (cost_unit_price is null and cost_amount is null)
    or (price_mode = 'manual'
        and cost_unit_price between 0 and 100000000
        and cost_amount = trunc(quantity * cost_unit_price)::integer)
  );

comment on column public.standard_estimate_revision_v25_lines.cost_unit_price is
  '手入力明細の原価単価（税別・整数）。null は原価未設定（0 円と区別する）。別途見積の行は null。本部だけが見る社内の値（2026-11-20 の先方の依頼）';
comment on column public.standard_estimate_revision_v25_lines.cost_amount is
  '手入力明細の原価金額 = trunc(数量 × 原価単価)。原価未設定・別途見積は null（2026-11-20 の先方の依頼）';

-- ---------- 既存の関数に、目印を確かめて差し込む ----------

-- 適用済みの定義（pg_get_functiondef）の目印がちょうど 1 か所あることを確かめてから置き換える。
-- 想定と違う定義なら何も変えずに止まる。所有者・SECURITY DEFINER・search_path・EXECUTE は前後で変わらないことを確かめる
create function pg_temp.lc_patch_function(p_target regprocedure, p_old text, p_new text)
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

-- 下書きの保存：手入力明細の原価単価（cost_unit_price）を受け取る
select pg_temp.lc_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$  v_line_key uuid;
$old$,
  $new$  v_line_key uuid;
  -- 手入力明細の原価単価（2026-11-20 の先方の依頼）
  v_line_cost integer;
  v_old_line_costs jsonb;
$new$
);
select pg_temp.lc_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$  delete from public.standard_estimate_revision_v25_lines l where l.revision_id = rev.id;
  v_index := 0;
$old$,
  $new$  -- 手入力明細の原価：payload に cost_unit_price の無い行（原価の欄を知らない画面からの保存）は、同じ line_key の今の原価を残す
  select coalesce(pg_catalog.jsonb_object_agg(l.line_key::text, l.cost_unit_price), '{}'::jsonb)
    into v_old_line_costs
    from public.standard_estimate_revision_v25_lines l
   where l.revision_id = rev.id
     and l.cost_unit_price is not null;
  delete from public.standard_estimate_revision_v25_lines l where l.revision_id = rev.id;
  v_index := 0;
$new$
);
select pg_temp.lc_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$      v_line_key := nullif(item ->> 'line_key', '')::uuid;
      v_row_order := (item ->> 'row_order')::integer;
$old$,
  $new$      v_line_key := nullif(item ->> 'line_key', '')::uuid;
      v_row_order := (item ->> 'row_order')::integer;
      v_line_cost := (item ->> 'cost_unit_price')::integer;
$new$
);
select pg_temp.lc_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$    -- 並び順（商品と同じ決まり）
$old$,
  $new$    -- 原価単価（税別。2026-11-20 の先方の依頼）：数か null。未入力（null）と 0 円を分け、別途見積の行は原価を持たない
    if pg_catalog.jsonb_typeof(item -> 'cost_unit_price') not in ('number', 'null') then
      raise exception using errcode = 'P0001', message = format('VALIDATION: 明細 %s 行目：原価単価は数で指定してください', v_index);
    end if;
    if (item -> 'cost_unit_price') is null and v_line_key is not null then
      v_line_cost := (v_old_line_costs ->> v_line_key::text)::integer;
    end if;
    if v_mode = 'por' then
      v_line_cost := null;
    elsif v_line_cost is not null and (v_line_cost < 0 or v_line_cost > 100000000) then
      raise exception using errcode = 'P0001',
        message = format('VALIDATION: 明細 %s 行目の原価単価（税別）は 0〜100,000,000 円の整数で入力してください', v_index);
    elsif v_line_cost is not null and trunc(v_qty * v_line_cost) > 2147483647 then
      raise exception using errcode = 'P0001',
        message = format('VALIDATION: 明細 %s 行目の原価金額（数量 × 原価単価）が大きすぎます', v_index);
    end if;
    -- 並び順（商品と同じ決まり）
$new$
);
select pg_temp.lc_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order, display_order
$old$,
  $new$      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order, display_order,
      cost_unit_price, cost_amount
$new$
);
select pg_temp.lc_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$      coalesce((item ->> 'review_required')::boolean, false), v_index, v_row_order
$old$,
  $new$      coalesce((item ->> 'review_required')::boolean, false), v_index, v_row_order,
      v_line_cost, case when v_line_cost is null then null else trunc(v_qty * v_line_cost)::integer end
$new$
);

-- 明細の複製：v2.5 の版からは原価も写す。v2.5 以前の版からは、旧標準見積に登録された原価を写す（⑤-5。別途見積・別途工事は原価なし）
select pg_temp.lc_patch_function(
  'public.standard_estimate_v25_copy_lines(uuid, uuid, boolean)'::regprocedure,
  $old$    insert into public.standard_estimate_revision_v25_lines (
      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order,
      display_order
    )
$old$,
  $new$    insert into public.standard_estimate_revision_v25_lines (
      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order,
      display_order, cost_unit_price, cost_amount
    )
$new$
);
select pg_temp.lc_patch_function(
  'public.standard_estimate_v25_copy_lines(uuid, uuid, boolean)'::regprocedure,
  $old$           l.remark, l.review_required, l.sort_order, l.display_order
$old$,
  $new$           l.remark, l.review_required, l.sort_order, l.display_order, l.cost_unit_price, l.cost_amount
$new$
);
select pg_temp.lc_patch_function(
  'public.standard_estimate_v25_copy_lines(uuid, uuid, boolean)'::regprocedure,
  $old$    insert into public.standard_estimate_revision_v25_lines (
      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order
    )
$old$,
  $new$    insert into public.standard_estimate_revision_v25_lines (
      revision_id, line_key, section_code, group_label, name, quantity, unit, price_mode, unit_price, amount, remark, review_required, sort_order,
      cost_unit_price, cost_amount
    )
$new$
);
select pg_temp.lc_patch_function(
  'public.standard_estimate_v25_copy_lines(uuid, uuid, boolean)'::regprocedure,
  $old$           l.remark, true, l.sort_order
$old$,
  $new$           l.remark, true, l.sort_order,
           -- 旧標準見積に登録された原価（⑤-5）。v2.5 の明細の決まり（0〜100,000,000 円・原価金額が整数に入る）に合わない値は原価未設定にする
           case when l.price_mode = 'por' or l.section_code = 'sitework' or l.cost_unit_price is null
                     or l.cost_unit_price > 100000000 or trunc(l.quantity * l.cost_unit_price) > 2147483647 then null
                else l.cost_unit_price end,
           case when l.price_mode = 'por' or l.section_code = 'sitework' or l.cost_unit_price is null
                     or l.cost_unit_price > 100000000 or trunc(l.quantity * l.cost_unit_price) > 2147483647 then null
                else trunc(l.quantity * l.cost_unit_price)::integer end
$new$
);

-- 再計算：区分の原価明細小計に、手入力明細の原価金額を足す（原価未設定・別途見積は含めない。売価側は変えない）
select pg_temp.lc_patch_function(
  'public.standard_estimate_v25_recalculate(uuid, boolean, integer, text)'::regprocedure,
  $old$         and b.cost_unit_price is not null;
    end if;
$old$,
  $new$         and b.cost_unit_price is not null;
      -- 手入力明細（v25_lines）の原価金額 = trunc(数量 × 原価単価)（2026-11-20 の先方の依頼）
      v_cost_lines := v_cost_lines + (
        select coalesce(sum(l.cost_amount), 0)::bigint
          from public.standard_estimate_revision_v25_lines l
         where l.revision_id = rev.id
           and l.section_code = v_code
           and l.price_mode = 'manual'
           and l.cost_amount is not null);
    end if;
$new$
);

-- 公開：別途見積でない手入力明細の原価単価が未入力なら公開しない（⑤-2。0 円にしない）
select pg_temp.lc_patch_function(
  'public.publish_standard_estimate_v25_revision(uuid, integer)'::regprocedure,
  $old$  end if;

  perform public.standard_estimate_v25_set_writer(true);
$old$,
  $new$  end if;
  -- 手入力明細（別途見積でない行）の原価単価は必須（2026-11-06 の先方回答 ⑤-2。未入力を 0 円にしない。2026-11-20 の依頼）
  select string_agg('「' || l.name || '」', '・' order by l.sort_order, l.id)
    into v_names
    from public.standard_estimate_revision_v25_lines l
   where l.revision_id = rev.id
     and l.price_mode = 'manual'
     and l.cost_unit_price is null;
  if v_names is not null then
    raise exception using errcode = 'P0001',
      message = format('LOCKED: 原価単価が未入力の明細が %s 行あります（%s）。原価単価（税別。0 円なら 0）を入力して保存してから公開してください',
        (select count(*) from public.standard_estimate_revision_v25_lines l
          where l.revision_id = rev.id and l.price_mode = 'manual' and l.cost_unit_price is null),
        pg_catalog.left(v_names, 300));
  end if;

  perform public.standard_estimate_v25_set_writer(true);
$new$
);

-- 編集画面の確認：原価単価が未入力の手入力明細を返し、あれば公開できない
select pg_temp.lc_patch_function(
  'public.preview_standard_estimate_v25_revision(uuid)'::regprocedure,
  $old$    'review_required_lines', v_review_lines,
$old$,
  $new$    'review_required_lines', v_review_lines,
    -- 原価単価が未入力の手入力明細（別途見積でない行。2026-11-20 の先方の依頼）
    'missing_line_costs', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('line_key', l.line_key, 'name', l.name)
                                           order by l.sort_order, l.id), '[]'::jsonb)
        from public.standard_estimate_revision_v25_lines l
       where l.revision_id = rev.id
         and l.price_mode = 'manual'
         and l.cost_unit_price is null),
$new$
);
select pg_temp.lc_patch_function(
  'public.preview_standard_estimate_v25_revision(uuid)'::regprocedure,
  $old$                   and v_review_lines = 0
$old$,
  $new$                   and v_review_lines = 0
                   and not exists (select 1 from public.standard_estimate_revision_v25_lines l
                                    where l.revision_id = rev.id and l.price_mode = 'manual' and l.cost_unit_price is null)
$new$
);

-- Web 以外の見積の下書き（D1c）：手入力明細の原価を写す。原価単価が未入力の明細・売価を入力した商品の行を含む版からは作らない
select pg_temp.lc_patch_function(
  'public.standard_estimate_v25_quote_draft_lines(uuid, boolean)'::regprocedure,
  $old$      from (
        select bi.option_name_snapshot as name, 0 as part, bi.sort_order, bi.id::text as id
          from public.standard_estimate_revision_baseline_items bi
         where bi.revision_id = rev.id and bi.price_mode = 'manual'
        union all
        select l.name, 1, l.sort_order, l.id::text
          from public.standard_estimate_revision_v25_lines l
         where l.revision_id = rev.id and l.price_mode = 'manual'
      ) x;
$old$,
  $new$      from (
        select bi.option_name_snapshot as name, 0 as part, bi.sort_order, bi.id::text as id
          from public.standard_estimate_revision_baseline_items bi
         where bi.revision_id = rev.id and bi.price_mode = 'manual'
        union all
        -- 手入力明細は、原価単価が未入力の行だけ（2026-11-20 の先方の依頼で原価を持てるようになった）
        select l.name, 1, l.sort_order, l.id::text
          from public.standard_estimate_revision_v25_lines l
         where l.revision_id = rev.id and l.price_mode = 'manual'
           and l.cost_unit_price is null
      ) x;
$new$
);
select pg_temp.lc_patch_function(
  'public.standard_estimate_v25_quote_draft_lines(uuid, boolean)'::regprocedure,
  $old$        message = format('LOCKED: 標準見積の版に、売価だけを決めて原価が無い明細（%s）があります。売価だけの明細の原価の扱いを反映するまで、この版から見積下書きは作れません',
                         pg_catalog.left(v_names, 300));
$old$,
  $new$        message = format('LOCKED: 標準見積の版に、原価が未設定の明細（%s）があります（売価を入力した商品の行・原価単価が未入力の手入力明細）。標準見積の新しい版で直して公開してから作ってください',
                         pg_catalog.left(v_names, 300));
$new$
);
select pg_temp.lc_patch_function(
  'public.standard_estimate_v25_quote_draft_lines(uuid, boolean)'::regprocedure,
  $old$    -- 商品に紐づかない明細（manual / por）。manual の原価は版に無い（写さない。下書きを作るときは上で止める）
$old$,
  $new$    -- 商品に紐づかない明細（manual / por）。manual は版で固定した原価単価を写す（2026-11-20。原価単価が未入力の明細を含む版は、下書きを作るときに上で止める）
$new$
);
select pg_temp.lc_patch_function(
  'public.standard_estimate_v25_quote_draft_lines(uuid, boolean)'::regprocedure,
  $old$             'cost_unit_price', null,
$old$,
  $new$             -- 手入力明細は版で固定した原価単価（2026-11-20 の先方の依頼。最新の値で置き換えない）
             'cost_unit_price', case when l.price_mode = 'manual' then l.cost_unit_price end,
$new$
);

drop function pg_temp.lc_patch_function(regprocedure, text, text);

-- ---------- 既存の下書きへ、旧標準見積に登録された原価を写す（⑤-5） ----------

-- 内部用（API からは実行させない）。呼び出し側が v2.5 の書き込みの印（standard_estimate_v25_set_writer）を立てる。
-- 下書きの v2.5 の版の、原価が未設定の manual の手入力明細のうち、同じ標準見積の v2.5 以前の版に
-- line_key・区分・品名・数量・単位・売価が同じ行があり、その原価単価が 1 つに決まる行に、その原価を写す。
-- 別途工事の行は写さない（v2.5 以前の版から写すときと同じく、別途工事は原価を引き継がない）。
-- v2.5 の明細の決まり（0〜100,000,000 円・原価金額が整数に入る）に合わない値も写さない（原価未設定のまま）。
-- 区分・版の原価の列（原価明細小計・原価側の経費・原価合計）だけを足し直し、売価の列は変えない。
-- 原価側の経費は再計算と同じ式（計算ルールで経費を掛ける区分なら trunc(原価明細小計 × 版の経費率)、ほかは 0）。写した行数を返す
create function public.standard_estimate_v25_fill_line_costs_from_legacy(p_revision_id uuid)
returns integer
language plpgsql
set search_path = ''
as $fill$
declare
  v_master_id uuid;
  v_expense_rate numeric;
  v_targets text[];
  v_count integer := 0;
  v_diff bigint := 0;
begin
  select r.standard_estimate_master_id, r.expense_rate, rule.expense_target_sections
    into v_master_id, v_expense_rate, v_targets
    from public.standard_estimate_revisions r
    join public.pricing_calculation_rule_versions rule on rule.id = r.calc_rule_version_id
   where r.id = p_revision_id and r.pricing_model = 'v2.5' and r.status = 'draft'
   for update of r;
  if not found then
    return 0;
  end if;

  with matched as (
    select l.id, min(ll.cost_unit_price) as cost
      from public.standard_estimate_revision_v25_lines l
      join public.standard_estimate_revisions lr
        on lr.standard_estimate_master_id = v_master_id and lr.pricing_model = 'legacy'
      join public.standard_estimate_revision_lines ll
        on ll.revision_id = lr.id
       and ll.line_key = l.line_key
       and ll.section_code = l.section_code
       and ll.name = l.name
       and ll.quantity = l.quantity
       and ll.unit is not distinct from l.unit
       and ll.unit_price = l.unit_price
       and ll.price_mode in ('auto', 'manual')
       and ll.cost_unit_price is not null
     where l.revision_id = p_revision_id
       and l.price_mode = 'manual'
       and l.section_code <> 'sitework'
       and l.cost_unit_price is null
     group by l.id
    -- 原価が 1 つに決まり（範囲外の値も数に入れる）、その値が v2.5 の明細の決まりに合う行だけ
    having count(distinct ll.cost_unit_price) = 1
       and max(ll.cost_unit_price) <= 100000000
       and max(trunc(l.quantity * ll.cost_unit_price)) <= 2147483647
  ),
  filled as (
    update public.standard_estimate_revision_v25_lines l
       set cost_unit_price = m.cost,
           cost_amount = trunc(l.quantity * m.cost)::integer
      from matched m
     where l.id = m.id
    returning l.section_code, l.cost_amount
  ),
  per_section as (
    select s.section_code,
           s.cost_line_subtotal::bigint + sum(f.cost_amount)::bigint as new_lines,
           s.cost_total::bigint as old_total
      from filled f
      join public.standard_estimate_revision_sections s
        on s.revision_id = p_revision_id and s.section_code = f.section_code
     group by s.section_code, s.cost_line_subtotal, s.cost_total
  ),
  calc as (
    select p.section_code, p.new_lines, p.old_total,
           case when p.section_code = any(coalesce(v_targets, '{}'::text[]))
                then trunc(p.new_lines * v_expense_rate)::bigint else 0::bigint end as new_expense
      from per_section p
  ),
  upd as (
    update public.standard_estimate_revision_sections s
       set cost_line_subtotal = c.new_lines,
           cost_expense_amount = c.new_expense,
           cost_total = c.new_lines + c.new_expense
      from calc c
     where s.revision_id = p_revision_id
       and s.section_code = c.section_code
    returning (c.new_lines + c.new_expense) - c.old_total as diff
  )
  select coalesce((select sum(u.diff) from upd u), 0), (select count(*) from filled)
    into v_diff, v_count;

  if v_count > 0 then
    update public.standard_estimate_revisions r
       set cost_total = r.cost_total + v_diff
     where r.id = p_revision_id;
  end if;
  return v_count;
end;
$fill$;

comment on function public.standard_estimate_v25_fill_line_costs_from_legacy(uuid) is
  '下書きの v2.5 の版の、原価が未設定の手入力明細に、旧標準見積に登録された原価を写す（line_key・区分・品名・数量・単位・売価が同じで原価が 1 つに決まる行だけ。別途工事は写さない）。区分・版の原価の列だけを再計算と同じ式で足し直す。内部用（2026-11-20 の先方の依頼・⑤-5）';

alter function public.standard_estimate_v25_fill_line_costs_from_legacy(uuid) owner to postgres;
revoke all on function public.standard_estimate_v25_fill_line_costs_from_legacy(uuid) from public, anon, authenticated, service_role;

-- 既存の下書きへ写す。売価の列（版・区分・選択枠・明細）と、公開済み・置き換え済みの版と、写さない列は変わらないことを確かめる
do $backfill$
declare
  v_rev record;
  v_filled integer;
  v_total integer := 0;
  v_sale_before text;
  v_sale_after text;
  v_closed_before text;
  v_closed_after text;
  v_lines_before text;
  v_lines_after text;
  v_filled_ids uuid[] := '{}'::uuid[];
begin
  -- 売価側（下書き・公開済みとも）の指紋：版の金額と計算結果、区分の売価、選択枠と明細の売価
  select pg_catalog.md5(coalesce(pg_catalog.string_agg(x.v, '|' order by x.v), ''))
    into v_sale_before
    from (
      select concat_ws(',', r.id, r.status, r.lock_version, r.subtotal_raw, r.subtotal, r.tax, r.total, r.has_por,
                       r.v25_pricing_complete, r.v25_calc_result::text, r.standard_adjustment_amount) as v
        from public.standard_estimate_revisions r where r.pricing_model = 'v2.5'
      union all
      select concat_ws(',', s.revision_id, s.section_code, s.expense_method, s.expense_rate, s.expense_amount, s.line_subtotal, s.total, s.has_por)
        from public.standard_estimate_revision_sections s
        join public.standard_estimate_revisions r on r.id = s.revision_id and r.pricing_model = 'v2.5'
      union all
      select pg_catalog.md5(to_jsonb(b)::text)
        from public.standard_estimate_revision_baseline_items b
        join public.standard_estimate_revisions r on r.id = b.revision_id and r.pricing_model = 'v2.5'
    ) x;
  -- 公開済み・置き換え済みの版（v2.5・v2.5 以前とも）の区分・明細は何も変えない
  select pg_catalog.md5(coalesce(pg_catalog.string_agg(x.v, '|' order by x.v), ''))
    into v_closed_before
    from (
      select pg_catalog.md5((to_jsonb(s))::text) as v
        from public.standard_estimate_revision_sections s
        join public.standard_estimate_revisions r on r.id = s.revision_id and r.status <> 'draft'
      union all
      select pg_catalog.md5((to_jsonb(l) - 'cost_unit_price' - 'cost_amount')::text)
        from public.standard_estimate_revision_v25_lines l
        join public.standard_estimate_revisions r on r.id = l.revision_id and r.status <> 'draft'
      union all
      select pg_catalog.md5(to_jsonb(r)::text)
        from public.standard_estimate_revisions r where r.status <> 'draft'
    ) x;
  -- 手入力明細の原価以外の列
  select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5((to_jsonb(l) - 'cost_unit_price' - 'cost_amount')::text), '|'
                                                       order by l.id), ''))
    into v_lines_before
    from public.standard_estimate_revision_v25_lines l;

  perform public.standard_estimate_v25_set_writer(true);
  for v_rev in
    select r.id from public.standard_estimate_revisions r
     where r.pricing_model = 'v2.5' and r.status = 'draft'
     order by r.id
  loop
    v_filled := public.standard_estimate_v25_fill_line_costs_from_legacy(v_rev.id);
    v_total := v_total + v_filled;
    if v_filled > 0 then
      v_filled_ids := pg_catalog.array_append(v_filled_ids, v_rev.id);
    end if;
  end loop;
  perform public.standard_estimate_v25_set_writer(false);

  select pg_catalog.md5(coalesce(pg_catalog.string_agg(x.v, '|' order by x.v), ''))
    into v_sale_after
    from (
      select concat_ws(',', r.id, r.status, r.lock_version, r.subtotal_raw, r.subtotal, r.tax, r.total, r.has_por,
                       r.v25_pricing_complete, r.v25_calc_result::text, r.standard_adjustment_amount) as v
        from public.standard_estimate_revisions r where r.pricing_model = 'v2.5'
      union all
      select concat_ws(',', s.revision_id, s.section_code, s.expense_method, s.expense_rate, s.expense_amount, s.line_subtotal, s.total, s.has_por)
        from public.standard_estimate_revision_sections s
        join public.standard_estimate_revisions r on r.id = s.revision_id and r.pricing_model = 'v2.5'
      union all
      select pg_catalog.md5(to_jsonb(b)::text)
        from public.standard_estimate_revision_baseline_items b
        join public.standard_estimate_revisions r on r.id = b.revision_id and r.pricing_model = 'v2.5'
    ) x;
  select pg_catalog.md5(coalesce(pg_catalog.string_agg(x.v, '|' order by x.v), ''))
    into v_closed_after
    from (
      select pg_catalog.md5((to_jsonb(s))::text) as v
        from public.standard_estimate_revision_sections s
        join public.standard_estimate_revisions r on r.id = s.revision_id and r.status <> 'draft'
      union all
      select pg_catalog.md5((to_jsonb(l) - 'cost_unit_price' - 'cost_amount')::text)
        from public.standard_estimate_revision_v25_lines l
        join public.standard_estimate_revisions r on r.id = l.revision_id and r.status <> 'draft'
      union all
      select pg_catalog.md5(to_jsonb(r)::text)
        from public.standard_estimate_revisions r where r.status <> 'draft'
    ) x;
  select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5((to_jsonb(l) - 'cost_unit_price' - 'cost_amount')::text), '|'
                                                       order by l.id), ''))
    into v_lines_after
    from public.standard_estimate_revision_v25_lines l;

  if v_sale_after is distinct from v_sale_before then
    raise exception 'POSTCONDITION: the sale amounts of the v2.5 standard estimates must not change';
  end if;
  if v_closed_after is distinct from v_closed_before then
    raise exception 'POSTCONDITION: published / superseded revisions must not change';
  end if;
  if v_lines_after is distinct from v_lines_before then
    raise exception 'POSTCONDITION: only the cost columns of the manual lines may change';
  end if;
  -- 写した原価は旧標準見積の行と同じ。公開済みの版の手入力明細には原価を入れていない
  if exists (select 1 from public.standard_estimate_revision_v25_lines l
               join public.standard_estimate_revisions r on r.id = l.revision_id
              where l.cost_unit_price is not null
                and (r.status <> 'draft' or l.price_mode <> 'manual' or l.cost_amount <> trunc(l.quantity * l.cost_unit_price)::integer)) then
    raise exception 'POSTCONDITION: costs were written to unexpected lines';
  end if;
  -- 写した下書きの区分（本体以外）の原価の列は、再計算と同じ式の値（原価明細小計 = 選択枠の trunc(数量 × 原価単価) の和 +
  -- 手入力明細の原価金額の和、原価側の経費 = 計算ルールで経費を掛ける区分なら trunc(小計 × 版の経費率)、ほかは 0、
  -- 原価合計 = 小計 + 経費）。版の原価合計 = 区分の原価合計の和。違えば止める（保存済みの値がずれていた下書きに差分を足さない）
  if exists (
    select 1
      from public.standard_estimate_revision_sections s
      join public.standard_estimate_revisions r on r.id = s.revision_id
      join public.pricing_calculation_rule_versions rule on rule.id = r.calc_rule_version_id
     where s.revision_id = any(v_filled_ids)
       and s.section_code <> 'base'
       and (s.cost_line_subtotal is distinct from (
              (select coalesce(sum(trunc(b.quantity * b.cost_unit_price)), 0)
                 from public.standard_estimate_revision_baseline_items b
                where b.revision_id = s.revision_id and b.section_code = s.section_code and b.cost_unit_price is not null)
              + (select coalesce(sum(l.cost_amount), 0)
                   from public.standard_estimate_revision_v25_lines l
                  where l.revision_id = s.revision_id and l.section_code = s.section_code
                    and l.price_mode = 'manual' and l.cost_amount is not null))
            or s.cost_expense_amount is distinct from
                 (case when s.section_code = any(rule.expense_target_sections) then trunc(s.cost_line_subtotal * r.expense_rate) else 0 end)
            or s.cost_total is distinct from s.cost_line_subtotal + s.cost_expense_amount)) then
    raise exception 'POSTCONDITION: the section costs of a filled draft must equal the recalculation';
  end if;
  if exists (select 1 from public.standard_estimate_revisions r
              where r.id = any(v_filled_ids)
                and r.cost_total is distinct from (select sum(s.cost_total) from public.standard_estimate_revision_sections s where s.revision_id = r.id)) then
    raise exception 'POSTCONDITION: the cost total of a filled draft must equal the sum of its sections';
  end if;
  raise notice 'v2.5 manual line costs filled from the legacy standard estimates: % lines', v_total;
end;
$backfill$;

-- ---------- postconditions ----------

do $postconditions$
declare
  v_save text := pg_catalog.pg_get_functiondef('public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure);
  v_recalc text := pg_catalog.pg_get_functiondef('public.standard_estimate_v25_recalculate(uuid, boolean, integer, text)'::regprocedure);
begin
  if pg_catalog.strpos(v_save, 'v_line_cost, case when v_line_cost is null then null else trunc(v_qty * v_line_cost)::integer end') = 0
     or pg_catalog.strpos(v_save, 'v_old_line_costs ->> v_line_key::text') = 0
     or pg_catalog.strpos(v_recalc, 'and l.cost_amount is not null') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.standard_estimate_v25_copy_lines(uuid, uuid, boolean)'::regprocedure),
                          'l.display_order, l.cost_unit_price, l.cost_amount') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.standard_estimate_v25_copy_lines(uuid, uuid, boolean)'::regprocedure),
                          'trunc(l.quantity * l.cost_unit_price)::integer') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.publish_standard_estimate_v25_revision(uuid, integer)'::regprocedure),
                          'LOCKED: 原価単価が未入力の明細が') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.preview_standard_estimate_v25_revision(uuid)'::regprocedure),
                          '''missing_line_costs''') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.standard_estimate_v25_quote_draft_lines(uuid, boolean)'::regprocedure),
                          '''cost_unit_price'', case when l.price_mode = ''manual'' then l.cost_unit_price end') = 0 then
    raise exception 'POSTCONDITION: the patched functions are not as expected';
  end if;
  -- #618（区分の経費の決め方）がまだ当たっていなければ、#618 の目印の行が残っていること
  if to_regprocedure('public.standard_estimate_v25_expense_settings(uuid)') is null
     and (pg_catalog.strpos(v_save, '  perform public.standard_estimate_v25_recalculate(rev.id, false, v_adjustment, v_reason);') = 0
          or pg_catalog.strpos(v_recalc, '  v_cost_expense bigint;') = 0
          or pg_catalog.strpos(v_recalc, '    v_expense := case when v_target then trunc(v_priced * rev.expense_rate)::bigint else 0 end;') = 0
          or pg_catalog.strpos(v_recalc, '       set expense_method = case when v_target then ''rate'' else ''none'' end,') = 0) then
    raise exception 'POSTCONDITION: the markers of #618 must remain';
  end if;
  -- 新しい関数は API のロールから実行できない。原価の列は表の今の読み取りの決まり（本部だけの RLS）のまま
  if has_function_privilege('anon', 'public.standard_estimate_v25_fill_line_costs_from_legacy(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.standard_estimate_v25_fill_line_costs_from_legacy(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.standard_estimate_v25_fill_line_costs_from_legacy(uuid)', 'EXECUTE') then
    raise exception 'POSTCONDITION: the fill function must not be executable by API roles';
  end if;
  if has_column_privilege('anon', 'public.standard_estimate_revision_v25_lines', 'cost_unit_price', 'SELECT')
     or has_column_privilege('anon', 'public.standard_estimate_revision_v25_lines', 'cost_amount', 'SELECT')
     or has_column_privilege('authenticated', 'public.standard_estimate_revision_v25_lines', 'cost_unit_price', 'UPDATE')
     or has_column_privilege('authenticated', 'public.standard_estimate_revision_v25_lines', 'cost_unit_price', 'INSERT')
     or has_column_privilege('authenticated', 'public.standard_estimate_revision_v25_lines', 'cost_amount', 'UPDATE')
     or has_column_privilege('authenticated', 'public.standard_estimate_revision_v25_lines', 'cost_amount', 'INSERT')
     or not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.standard_estimate_revision_v25_lines'::regclass) then
    raise exception 'POSTCONDITION: the privileges of the manual line cost columns are not as expected';
  end if;
end;
$postconditions$;

commit;
