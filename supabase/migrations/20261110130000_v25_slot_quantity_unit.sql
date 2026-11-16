-- 標準見積 v2.5：選択枠の「選ぶ数」と「計上数量」を分ける（Issue #647・2026-11-16 の先方の依頼）
--
-- これまで、お客様の選択の金額は「売価 × 1」で、差額の基準は選択枠の金額（売価 × 選択枠の数量）だったので、
-- 数量が 1 でない選択枠があると標準のままでも差額が出た。そのため公開の判定で「外壁以外は数量 1」を求めていた。
--
-- * 選ぶ数：今のまま（シミュレーターで選ぶ商品は 1 つ。外壁は 4 面）。列は作らない
-- * 計上数量：選択枠の quantity（例：屋根 23.5）。既存の公開済みの版・見積の値は変えない
-- * 単位：選択枠に、下書きの保存のときの商品台帳の販売単位（options.price_unit）を写して持つ（unit_snapshot）。
--   公開済みの版の行は null のまま。下書きの版の行には、この migration で今の販売単位を写す（保存し直したときと同じ値）
-- * 金額：お客様の選択の金額 ＝ trunc(売価 × 選択の数量 × 枠の計上数量)。枠の計上数量を掛けるのは、
--   版の中でそのカテゴリーのカテゴリー単位の選択枠がちょうど 1 つ（外壁を除く）か、位置・用途の選択枠のとき。
--   判定は版の中の変わらない行だけで行う（公開した後にカテゴリーの設定が変わっても、金額の決まりは変わらない）。
--   版の枠と同じ「商品＋選択肢」は保存した単位のまま。それ以外の商品は、販売単位が枠と同じときだけ計上数量を掛け、
--   違えば価格未確定にする（単位の違う商品に数量を掛けない）
-- * 公開の判定：「外壁以外は数量 1」を、1 つだけ選べるカテゴリーにその選択枠だけがあるなら 1 以外も可・販売単位が必要・
--   そのカテゴリーの選べる商品は同じ販売単位、に変える。位置・用途の選択枠は今までどおり数量 1（表の制約・保存の検査もそのまま）
-- * 見積の行：計上数量が 1 でない選択枠は「23.5 ㎡」のように保存した販売単位で示す（数量 1 の枠と外壁は今までどおり「式」）
--
-- 既存の関数は、目印を確かめて差し込む（本体を丸ごと写さない）。未適用の #618 が使う目印の行は変えない（どちらを先に当てても通る）。
begin;

set local lock_timeout = '5s';

-- ---------- preflight ----------

do $preflight$
begin
  if to_regprocedure('public.standard_estimate_v25_slot_rule_issues(uuid)') is null
     or to_regprocedure('public.standard_estimate_v25_configuration_money(uuid, uuid)') is null
     or to_regprocedure('public.standard_estimate_v25_sale_view(uuid, boolean)') is null
     or to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid, boolean)') is null
     or to_regprocedure('public.save_standard_estimate_v25_draft(uuid, integer, jsonb)') is null
     or to_regprocedure('public.standard_estimate_v25_copy_slots(uuid, uuid)') is null
     or to_regprocedure('public.standard_estimate_v25_set_writer(boolean)') is null
     or to_regprocedure('public.customer_product_spec_selectable(text, text, text[])') is null then
    raise exception 'PRECONDITION: the v2.5 standard estimate functions must exist';
  end if;
  if to_regprocedure('public.standard_estimate_v25_slot_measured(uuid, text, uuid)') is not null
     or to_regprocedure('public.standard_estimate_v25_slot_measure(uuid, uuid, uuid[], uuid, text)') is not null
     or exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'standard_estimate_revision_baseline_items' and column_name = 'unit_snapshot') then
    raise exception 'PRECONDITION: #647 is already applied';
  end if;
  -- 位置・用途の選択枠は数量 1 のまま（表の制約が残っていること）
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conrelid = 'public.standard_estimate_revision_baseline_items'::regclass
                    and conname = 'standard_estimate_baseline_items_slot_quantity') then
    raise exception 'PRECONDITION: the position slot quantity constraint must exist';
  end if;
end;
$preflight$;

-- ---------- 選択枠の販売単位の写し ----------

alter table public.standard_estimate_revision_baseline_items add column unit_snapshot text;
alter table public.standard_estimate_revision_baseline_items
  add constraint standard_estimate_revision_baseline_items_unit_snapshot_check
  check (unit_snapshot is null or (unit_snapshot = pg_catalog.btrim(unit_snapshot) and unit_snapshot <> ''));
comment on column public.standard_estimate_revision_baseline_items.unit_snapshot is
  '選択枠の計上数量（quantity）の単位。v2.5 の下書きの保存のときの商品台帳の販売単位（options.price_unit）の写し。null は未設定（#647）';

-- ---------- お客様の選択に、選択枠の計上数量を掛ける枠か ----------

-- 位置・用途の選択枠（slot_code あり）か、版の中でそのカテゴリーのカテゴリー単位の選択枠がちょうど 1 つ（外壁を除く）のとき。
-- 版の中の行だけで決める（公開した後にカテゴリーの「1 つだけ選べる」などの設定が変わっても、判定は変わらない）
create function public.standard_estimate_v25_slot_measured(p_revision_id uuid, p_slot_code text, p_category_id uuid)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select p_slot_code is not null
      or ((select count(*) from public.standard_estimate_revision_baseline_items x
            where x.revision_id = p_revision_id and x.slot_code is null and x.option_category_id = p_category_id) = 1
          and not exists (select 1 from public.standard_estimate_revision_baseline_items x
                           where x.revision_id = p_revision_id and x.slot_code is null and x.option_category_id = p_category_id
                             and x.selection_target_code = 'exterior-wall'));
$function$;

-- お客様の選択（商品・選択肢・カテゴリー・位置）に掛ける計上数量。掛ける枠が無い・枠の数量が 1 なら 1。
-- 版の枠と同じ「商品＋選択肢」は枠の数量。それ以外は、販売単位が枠の販売単位と同じときだけ枠の数量、違えば null（価格未確定）
create function public.standard_estimate_v25_slot_measure(p_revision_id uuid, p_option_id uuid, p_choice_ids uuid[], p_category_id uuid, p_slot_code text)
returns numeric
language sql
stable
set search_path to ''
as $function$
  with slot as (
    select bi.id, bi.quantity, bi.unit_snapshot, bi.option_id
      from public.standard_estimate_revision_baseline_items bi
     where bi.revision_id = p_revision_id
       and ((p_slot_code is not null and bi.slot_code = p_slot_code)
            or (p_slot_code is null and bi.slot_code is null and bi.option_category_id = p_category_id))
       and public.standard_estimate_v25_slot_measured(p_revision_id, p_slot_code, p_category_id)
     order by bi.sort_order, bi.id
     limit 1
  )
  select case
           when not exists (select 1 from slot) then 1::numeric
           when (select s.quantity from slot s) = 1 then 1::numeric
           when (select s.option_id from slot s) = p_option_id
                and array(select bv.variant_choice_id from public.standard_estimate_revision_baseline_variants bv
                           where bv.baseline_item_id = (select s.id from slot s) order by bv.variant_choice_id)
                    = array(select distinct z from pg_catalog.unnest(coalesce(p_choice_ids, '{}'::uuid[])) z order by z)
             then (select s.quantity from slot s)
           when (select s.unit_snapshot from slot s) is not null
                and (select nullif(pg_catalog.btrim(o.price_unit), '') from public.options o where o.id = p_option_id)
                    = (select s.unit_snapshot from slot s)
             then (select s.quantity from slot s)
           else null
         end;
$function$;

-- ---------- 公開の判定（シミュレーターの選択枠の決まり） ----------

create or replace function public.standard_estimate_v25_slot_rule_issues(p_revision_id uuid)
returns text
language sql
stable
set search_path to ''
as $function$
  with rev as (
    select m.spec_code, m.base_model_id, bm.slug as model_slug
      from public.standard_estimate_revisions r
      join public.standard_estimate_masters m on m.id = r.standard_estimate_master_id
      join public.base_models bm on bm.id = m.base_model_id
     where r.id = p_revision_id
  ),
  slots as (
    select bi.option_name_snapshot as name, bi.quantity, bi.slot_code, bi.slot_label, bi.unit_snapshot, o.spec_codes,
           c.id as category_id, c.name as category_name, c.code as category_code,
           (c.selection_mode = 'single' or c.code in ('boiler', 'aircon', 'washbasin', 'toilet', 'kitchen')) as single_select,
           case when o.code in ('washbasin-kb', 'faucet-kb') then 'washbasin-standard-set' else bi.id::text end as display_key,
           -- 計上数量を 1 以外にできる枠（#647）：1 つだけ選べるカテゴリーに、そのカテゴリー単位の選択枠だけがある
           (bi.slot_code is null
            and public.standard_estimate_v25_slot_measured(bi.revision_id, bi.slot_code, bi.option_category_id)
            and (c.selection_mode = 'single' or c.code in ('boiler', 'aircon', 'washbasin', 'toilet', 'kitchen'))) as quantity_allowed
      from public.standard_estimate_revision_baseline_items bi
      join public.options o on o.id = bi.option_id
      join public.option_categories c on c.id = o.category_id
     where bi.revision_id = p_revision_id
  ),
  slot_options as (
    select so.slot_code, o.name, o.category_id, o.status, o.archived_at, o.discontinued_at, o.spec_codes, s.category_id as slot_category_id
      from public.standard_estimate_revision_slot_options so
      join public.options o on o.id = so.option_id
      join slots s on s.slot_code = so.slot_code
     where so.revision_id = p_revision_id
  )
  select nullif(pg_catalog.concat_ws('／',
    (select '外壁の選択枠は数量 4（面）にしてください：' || string_agg(distinct '「' || s.name || '」', '・')
       from slots s where s.category_code = 'exterior-wall' and s.quantity <> 4),
    (select '外壁以外の選択枠の数量を 1 以外にできるのは、1 つだけ選べるカテゴリーにその選択枠だけがあるときです'
            || '（位置・用途の選択枠とほかは数量 1 にし、個別に選ばない数量は明細にします）：' || string_agg(distinct '「' || s.name || '」', '・')
       from slots s where s.category_code <> 'exterior-wall' and s.quantity <> 1 and not s.quantity_allowed),
    (select '数量が 1 以外の選択枠には、商品台帳の販売単位（12 文字まで）が必要です（商品台帳で販売単位を設定してから、下書きを保存し直してください）：'
            || string_agg(distinct '「' || s.name || '」', '・')
       from slots s
      where s.category_code <> 'exterior-wall' and s.quantity <> 1 and s.quantity_allowed
        and (s.unit_snapshot is null or pg_catalog.char_length(s.unit_snapshot) > 12)),
    -- そのカテゴリーの、この仕様でお客様が選べる公開中・販売中の商品は、同じ販売単位（違う商品は価格未確定になるため）
    (select '数量が 1 以外の選択枠のカテゴリーの商品は、標準の商品と同じ販売単位にしてください：'
            || string_agg(distinct '「' || x.name || '」（' || coalesce(x.price_unit, '販売単位なし') || '）', '・')
       from (select o.name, nullif(pg_catalog.btrim(o.price_unit), '') as price_unit, s.unit_snapshot
               from slots s
              cross join rev
               join public.options o on o.category_id = s.category_id
              where s.category_code <> 'exterior-wall' and s.quantity <> 1 and s.quantity_allowed and s.unit_snapshot is not null
                and o.status = 'published' and o.archived_at is null and o.discontinued_at is null
                and (o.base_model_id is null or o.base_model_id = rev.base_model_id)
                and public.customer_product_spec_selectable(rev.model_slug, rev.spec_code, o.spec_codes)) x
      where x.price_unit is distinct from x.unit_snapshot),
    (select '外壁・防火仕様には位置・用途の選択枠を作れません：' || string_agg(distinct '「' || s.name || '」', '・')
       from slots s where s.slot_code is not null and s.category_code in ('exterior-wall', 'fireproof')),
    (select 'カテゴリー単位の選択枠と位置・用途の選択枠を、同じカテゴリーに混ぜられません：'
            || string_agg('「' || x.category_name || '」', '・' order by x.category_name)
       from (select s.category_id, s.category_name
               from slots s
              group by s.category_id, s.category_name
             having bool_or(s.slot_code is null) and bool_or(s.slot_code is not null)) x),
    (select '1 つだけ選べるカテゴリーの選択枠は 1 つにしてください：'
            || string_agg('「' || x.category_name || '」', '・' order by x.category_name)
            || '（位置ごとに分けるときは、位置・用途の選択枠にします）'
       from (select s.category_id, s.category_name
               from slots s
              where s.single_select and s.slot_code is null
              group by s.category_id, s.category_name
             having count(distinct s.display_key) > 1) x),
    (select '選べる商品は、その枠の標準の商品と同じカテゴリーの、公開中で販売停止・廃番でない商品にしてください：'
            || string_agg(distinct '「' || so.name || '」', '・')
       from slot_options so
      where so.category_id <> so.slot_category_id or so.status <> 'published'
         or so.archived_at is not null or so.discontinued_at is not null),
    -- 位置の枠の標準の商品と選べる商品は、この標準見積の仕様でお客様が選べる商品（選べないと、お客様の保存で止まる）
    (select '位置・用途の選択枠の商品と選べる商品は、この仕様で選べる商品にしてください：' || string_agg(distinct '「' || x.name || '」', '・')
       from (select s.name, s.spec_codes from slots s where s.slot_code is not null
             union all
             select so.name, so.spec_codes from slot_options so) x
      cross join rev
      where not public.customer_product_spec_selectable(rev.model_slug, rev.spec_code, x.spec_codes))
  ), '');
$function$;

-- ---------- 既存の関数に、目印を確かめて差し込む ----------

-- 適用済みの定義（pg_get_functiondef）の目印がちょうど 1 か所あることを確かめてから置き換える。
-- 想定と違う定義なら何も変えずに止まる。所有者・SECURITY DEFINER・search_path・EXECUTE は前後で変わらないことを確かめる
create function pg_temp.q647_patch_function(p_target regprocedure, p_old text, p_new text)
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

-- 保存したプランの金額：お客様の選択に、枠の計上数量を掛ける
select pg_temp.q647_patch_function(
  'public.standard_estimate_v25_configuration_money(uuid, uuid)'::regprocedure,
  $old$  v_unit integer;$old$,
  $new$  v_unit integer;
  v_measure numeric;$new$
);
select pg_temp.q647_patch_function(
  'public.standard_estimate_v25_configuration_money(uuid, uuid)'::regprocedure,
  $old$        select ci.option_id, ci.quantity, coalesce(ci.variant_choice_ids, '{}'::uuid[]) as choice_ids, ci.slot_code$old$,
  $new$        select ci.option_id, ci.quantity, coalesce(ci.variant_choice_ids, '{}'::uuid[]) as choice_ids, ci.slot_code, cat.id as category_id$new$
);
select pg_temp.q647_patch_function(
  'public.standard_estimate_v25_configuration_money(uuid, uuid)'::regprocedure,
  $old$          v_current := v_current + v_unit::bigint * item.quantity;$old$,
  $new$          -- 選択枠の計上数量（#647）。販売単位の違う商品は価格未確定
          v_measure := public.standard_estimate_v25_slot_measure(rev.id, item.option_id, item.choice_ids, item.category_id, item.slot_code);
          if v_measure is null then
            v_item_por := true;
          else
            v_current := v_current + pg_catalog.trunc(v_unit::numeric * item.quantity * v_measure)::bigint;
          end if;$new$
);

-- 売価だけの形：見積書の明細の単位、差額の基準の単位と「枠の数量を掛ける枠か」
select pg_temp.q647_patch_function(
  'public.standard_estimate_v25_sale_view(uuid, boolean)'::regprocedure,
  $old$                          'unit', '式',$old$,
  $new$                          -- 計上数量が 1 でない選択枠は保存した販売単位で示す（#647。外壁の 4 は面の数なので「式」のまま）
                          'unit', case when bi.quantity <> 1 and bi.selection_target_code <> 'exterior-wall' and bi.unit_snapshot is not null
                                       then bi.unit_snapshot else '式' end,$new$
);
select pg_temp.q647_patch_function(
  'public.standard_estimate_v25_sale_view(uuid, boolean)'::regprocedure,
  $old$                      'amount', bi.amount,
                      -- 位置・用途の選択枠（v2.5 PR-S1）$old$,
  $new$                      'amount', bi.amount,
                      -- 計上数量の単位（保存した販売単位）と、お客様の選択に枠の計上数量を掛ける枠か（#647）
                      'unit', bi.unit_snapshot,
                      'measured', public.standard_estimate_v25_slot_measured(bi.revision_id, bi.slot_code, bi.option_category_id),
                      -- 位置・用途の選択枠（v2.5 PR-S1）$new$
);

-- Web 以外の見積の下書きの行（D1c）：単位は見積書の明細と同じ
select pg_temp.q647_patch_function(
  'public.standard_estimate_v25_quote_draft_lines(uuid, boolean)'::regprocedure,
  $old$             'unit', '式',$old$,
  $new$             -- 計上数量が 1 でない選択枠は保存した販売単位で示す（#647。外壁の 4 は面の数なので「式」のまま）
             'unit', case when bi.quantity <> 1 and bi.selection_target_code <> 'exterior-wall' and bi.unit_snapshot is not null
                          then bi.unit_snapshot else '式' end,$new$
);

-- 下書きの保存：販売単位を写す
select pg_temp.q647_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$      price_mode, standard_cost_version_id, manual_unit_price, slot_code, slot_label
$old$,
  $new$      price_mode, standard_cost_version_id, manual_unit_price, slot_code, slot_label, unit_snapshot
$new$
);
select pg_temp.q647_patch_function(
  'public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure,
  $old$      v_mode, v_cost_pin, v_manual, v_slot_code, v_slot_label
$old$,
  $new$      v_mode, v_cost_pin, v_manual, v_slot_code, v_slot_label, nullif(pg_catalog.btrim(coalesce(o.price_unit, '')), '')
$new$
);

-- 版の複製（公開した版から次の下書きを作る）：販売単位の写しも写す
select pg_temp.q647_patch_function(
  'public.standard_estimate_v25_copy_slots(uuid, uuid)'::regprocedure,
  $old$manual_unit_price, slot_code, slot_label$old$,
  $new$manual_unit_price, slot_code, slot_label, unit_snapshot$new$
);
select pg_temp.q647_patch_function(
  'public.standard_estimate_v25_copy_slots(uuid, uuid)'::regprocedure,
  $old$b.slot_code, b.slot_label$old$,
  $new$b.slot_code, b.slot_label, b.unit_snapshot$new$
);

-- ---------- 下書きの版の選択枠に、今の販売単位を写す ----------

-- 下書きを保存し直したときと同じ値（公開済み・置き換え済みの版は変えない）。v2.5 の行は v2.5 の書き込みの印の間だけ書ける
select public.standard_estimate_v25_set_writer(true);
update public.standard_estimate_revision_baseline_items bi
   set unit_snapshot = nullif(pg_catalog.btrim(coalesce(o.price_unit, '')), '')
  from public.standard_estimate_revisions r, public.options o
 where r.id = bi.revision_id and r.pricing_model = 'v2.5' and r.status = 'draft'
   and o.id = bi.option_id;
select public.standard_estimate_v25_set_writer(false);

-- ---------- 所有者と権限 ----------

-- 内部の部品は API のロールから直接実行させない（Supabase は public の関数へ既定で EXECUTE を付けるため明示して外す）
alter function public.standard_estimate_v25_slot_measured(uuid, text, uuid) owner to postgres;
alter function public.standard_estimate_v25_slot_measure(uuid, uuid, uuid[], uuid, text) owner to postgres;
alter function public.standard_estimate_v25_slot_rule_issues(uuid) owner to postgres;
revoke all on function public.standard_estimate_v25_slot_measured(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_slot_measure(uuid, uuid, uuid[], uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.standard_estimate_v25_slot_rule_issues(uuid) from public, anon, authenticated, service_role;

-- ---------- postconditions ----------

do $postconditions$
declare
  v_money text := pg_catalog.pg_get_functiondef('public.standard_estimate_v25_configuration_money(uuid, uuid)'::regprocedure);
  v_save text := pg_catalog.pg_get_functiondef('public.save_standard_estimate_v25_draft(uuid, integer, jsonb)'::regprocedure);
begin
  -- 内部の部品は API のロールから実行できない
  if has_function_privilege('anon', 'public.standard_estimate_v25_slot_measure(uuid, uuid, uuid[], uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.standard_estimate_v25_slot_measure(uuid, uuid, uuid[], uuid, text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.standard_estimate_v25_slot_measure(uuid, uuid, uuid[], uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.standard_estimate_v25_slot_measured(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.standard_estimate_v25_slot_measured(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.standard_estimate_v25_slot_measured(uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.standard_estimate_v25_slot_rule_issues(uuid)', 'EXECUTE') then
    raise exception 'POSTCONDITION: internal helper functions must not be executable by API roles';
  end if;
  -- 公開済み・置き換え済みの版の行は変えていない（単位の写しは null のまま）
  if exists (select 1 from public.standard_estimate_revision_baseline_items bi
               join public.standard_estimate_revisions r on r.id = bi.revision_id
              where r.status <> 'draft' and bi.unit_snapshot is not null) then
    raise exception 'POSTCONDITION: baseline items of published / superseded revisions must not change';
  end if;
  -- v2.5 の下書きの行には今の販売単位が写っている
  if exists (select 1 from public.standard_estimate_revision_baseline_items bi
               join public.standard_estimate_revisions r on r.id = bi.revision_id
               join public.options o on o.id = bi.option_id
              where r.status = 'draft' and r.pricing_model = 'v2.5'
                and bi.unit_snapshot is distinct from nullif(pg_catalog.btrim(coalesce(o.price_unit, '')), '')) then
    raise exception 'POSTCONDITION: draft baseline items must have the current sale unit';
  end if;
  if pg_catalog.strpos(v_money, 'public.standard_estimate_v25_slot_measure(rev.id, item.option_id, item.choice_ids, item.category_id, item.slot_code)') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.standard_estimate_v25_sale_view(uuid, boolean)'::regprocedure),
                          '''measured'', public.standard_estimate_v25_slot_measured(') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.standard_estimate_v25_copy_slots(uuid, uuid)'::regprocedure),
                          'b.slot_code, b.slot_label, b.unit_snapshot') = 0
     or pg_catalog.strpos(v_save, 'v_slot_code, v_slot_label, nullif(pg_catalog.btrim(coalesce(o.price_unit, ''''))') = 0 then
    raise exception 'POSTCONDITION: the patched functions are not as expected';
  end if;
  -- #618（区分の経費の決め方）がまだ当たっていなければ、#618 の目印の行が残っていること（#618 を後から当てられる）
  if to_regprocedure('public.standard_estimate_v25_expense_settings(uuid)') is null
     and (pg_catalog.strpos(v_money, '      v_expense := case when s.expense_method = ''rate'' then trunc(v_line * rev.expense_rate)::bigint else 0 end;') = 0
          or pg_catalog.strpos(v_save, '  perform public.standard_estimate_v25_recalculate(rev.id, false, v_adjustment, v_reason);') = 0) then
    raise exception 'POSTCONDITION: the markers of #618 must remain';
  end if;
end;
$postconditions$;

commit;
