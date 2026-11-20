-- 標準見積 v2.5：手入力明細の原価単価（20261110150000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 旧標準見積（原価を登録した手入力明細）→ v2.5 の下書きへの写し・原価単価の保存（未入力と 0 円の区別・別途見積・古い画面の保存）・
-- 区分と版の原価の合計・売価が変わらないこと・入力の決まり・公開の可否・次の版への写し・案件見積の下書き（D1c）・
-- お客様向けの売価の形に原価を出さないこと・本部以外は読めないこと・既存の下書きへ旧標準見積の原価を写す内部の関数を確かめる
begin;

create temp table _lc_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _lc_result to public;

create function pg_temp.lc_run_as(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $fn$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_out, '(null)');
end;
$fn$;

create function pg_temp.lc_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _lc_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

-- 下書きの保存の中身（率は販売費 1・掛率 1.5・経費 15%）
create function pg_temp.lc_payload(p_slots jsonb, p_lines jsonb) returns text
language sql as $fn$
  select jsonb_build_object(
    'rates', jsonb_build_object('sales_fee_rate', '1', 'markup_rate', '1.5', 'expense_rate', '0.15'),
    'adjustment', 0, 'adjustment_reason', null,
    'slots', p_slots,
    'lines', p_lines)::text;
$fn$;

-- 手入力明細。p_cost が 'absent' なら cost_unit_price の項目を付けない（原価の欄を知らない画面の保存）
create function pg_temp.lc_line(p_key uuid, p_section text, p_name text, p_qty text, p_mode text, p_sale integer, p_cost jsonb) returns jsonb
language sql as $fn$
  select jsonb_build_object('line_key', p_key, 'section_code', p_section, 'group_label', null, 'name', p_name,
                            'quantity', p_qty, 'unit', '式', 'price_mode', p_mode, 'unit_price', p_sale, 'remark', null,
                            'review_required', false)
         || case when p_cost = '"absent"'::jsonb then '{}'::jsonb else jsonb_build_object('cost_unit_price', p_cost) end;
$fn$;

create function pg_temp.lc_save(p_editor uuid, p_rev uuid, p_payload text) returns text
language sql as $fn$
  select pg_temp.lc_run_as('authenticated', p_editor, format(
    'select (public.save_standard_estimate_v25_draft(%L, %s, %L::jsonb)).lock_version::text', p_rev,
    (select lock_version from public.standard_estimate_revisions where id = p_rev), p_payload));
$fn$;

-- 手入力明細の原価（品名:原価単価:原価金額。未設定は -）
create function pg_temp.lc_costs(p_rev uuid) returns text
language sql as $fn$
  select coalesce(string_agg(l.name || ':' || coalesce(l.cost_unit_price::text, '-') || ':' || coalesce(l.cost_amount::text, '-'), '/'
                             order by l.sort_order), '(none)')
    from public.standard_estimate_revision_v25_lines l where l.revision_id = p_rev;
$fn$;

-- 売価側の指紋（版の金額と計算結果・区分の売価・選択枠と明細の売価）
create function pg_temp.lc_sale(p_rev uuid) returns text
language sql as $fn$
  select concat_ws('|',
    (select concat_ws('/', r.subtotal_raw, r.subtotal, r.tax, r.total, r.has_por, r.v25_pricing_complete, md5(r.v25_calc_result::text))
       from public.standard_estimate_revisions r where r.id = p_rev),
    (select string_agg(concat_ws(':', s.section_code, s.line_subtotal, s.expense_amount, s.total, s.has_por), ',' order by s.section_code)
       from public.standard_estimate_revision_sections s where s.revision_id = p_rev),
    (select string_agg(concat_ws(':', b.baseline_key, b.cost_unit_price, b.sale_unit_price, b.amount), ',' order by b.baseline_key)
       from public.standard_estimate_revision_baseline_items b where b.revision_id = p_rev),
    (select string_agg(concat_ws(':', l.line_key, l.price_mode, l.unit_price, l.amount), ',' order by l.line_key)
       from public.standard_estimate_revision_v25_lines l where l.revision_id = p_rev));
$fn$;

-- 原価側（区分の原価明細小計・原価側の経費・原価合計と、版の原価合計）
create function pg_temp.lc_cost_totals(p_rev uuid) returns text
language sql as $fn$
  select (select string_agg(concat_ws(':', s.section_code, s.cost_line_subtotal, s.cost_expense_amount, s.cost_total), ',' order by s.section_code)
            from public.standard_estimate_revision_sections s where s.revision_id = p_rev)
         || '|' || (select r.cost_total::text from public.standard_estimate_revisions r where r.id = p_rev);
$fn$;

-- 案件見積の下書きの明細を保存の形にする（経費の行は除く。p_prices の品名の行は売価・原価を入れて manual にする）
create function pg_temp.lc_draft_lines(p_draft uuid, p_prices jsonb) returns jsonb
language sql as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'line_key', i.line_key, 'section_code', c.section_code, 'name', i.name, 'description', i.description,
           'unit', i.unit, 'remark', i.remark, 'quantity', i.quantity,
           'price_mode', case when p_prices ? i.name then 'manual' else i.price_mode end,
           'cost_unit_price', coalesce((p_prices -> i.name ->> 'cost')::integer, c.cost_unit_price),
           'unit_price', coalesce((p_prices -> i.name ->> 'sale')::integer, i.unit_price)
         ) order by i.sort_order, i.line_key), '[]'::jsonb)
    from public.quote_draft_items i
    join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key
   where i.draft_id = p_draft and c.line_role = 'line';
$fn$;

-- 本部として案件見積の下書きを保存する（率・経費の方法は下書きのまま）
create function pg_temp.lc_draft_save(p_user uuid, p_draft uuid, p_lines jsonb) returns text
language sql as $fn$
  select pg_temp.lc_run_as('authenticated', p_user, format(
    $q$ select public.save_standard_quote_draft(%L, %s, %s, %s, %s, %L::jsonb, %L::jsonb, 0, null, null)::text $q$,
    p_draft, d.lock_version, n.sales_fee_rate, n.expense_rate, n.markup_rate, n.expense_methods, p_lines))
    from public.quote_drafts d
    join public.quote_draft_internals n on n.draft_id = d.id
   where d.id = p_draft;
$fn$;

do $test$
declare
  u_admin constant uuid := '68900000-0000-4000-8000-000000000001';
  u_editor constant uuid := '68900000-0000-4000-8000-000000000002';
  u_dealer constant uuid := '68900000-0000-4000-8000-000000000003';
  u_master constant uuid := '68900000-0000-4000-8000-000000000004';
  u_customer constant uuid := '68900000-0000-4000-8000-000000000005';
  org_hq constant uuid := '68900000-0000-4000-8000-000000000101';
  m_model constant uuid := '68900000-0000-4000-8000-000000000201';
  mr_office constant uuid := '68900000-0000-4000-8000-000000000301';
  cat_eq constant uuid := '68900000-0000-4000-8000-000000000401';
  p1 constant uuid := '68900000-0000-4000-8000-000000000501';
  k_new constant uuid := '68900000-0000-4000-8000-000000000701';
  k_slot constant uuid := '68900000-0000-4000-8000-000000000601';
  v_bmr text;
  v_legacy text;
  v_master uuid;
  v_rev uuid;
  v_rev2 uuid;
  v_out text;
  k1 uuid;
  k2 uuid;
  k3 uuid;
  k4 uuid;
  k5 uuid;
  k6 uuid;
  k7 uuid;
  k8 uuid;
  v_legacy2 uuid;
  v_lines jsonb;
  v_quote uuid;
  v_draft_cost text;
  v_slots jsonb;
  v_sale_a text;
  v_sale_b text;
  v_cost_a text;
  v_cost_b text;
  v_preview jsonb;
  v_draft uuid;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'lc-admin@runtime.invalid', '{}'::jsonb), (u_editor, 'lc-editor@runtime.invalid', '{}'::jsonb),
         (u_dealer, 'lc-dealer@runtime.invalid', '{}'::jsonb), (u_master, 'lc-master@runtime.invalid', '{}'::jsonb),
         (u_customer, 'lc-customer@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'lc-admin@runtime.invalid', 'global admin', 'admin'),
         (u_editor, 'lc-editor@runtime.invalid', 'HQ editor', 'customer'),
         (u_dealer, 'lc-dealer@runtime.invalid', 'dealer', 'dealer'),
         (u_master, 'lc-master@runtime.invalid', 'master dealer', 'master_dealer'),
         (u_customer, 'lc-customer@runtime.invalid', 'customer', 'customer');
  insert into public.organizations (id, code, name, organization_type, status)
  values (org_hq, 'runtime-lc-hq', 'LC Runtime HQ', 'headquarters', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values (org_hq, u_editor, 'editor', 'active');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-lc-model', '原価の検査モデル', 1000000, 'published', '[{"code":"office","name":"事務所","option_codes":[]}]'::jsonb);
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_office, m_model, 'office', '2100x4550', false);
  insert into public.option_categories (id, code, name, status, selection_mode)
  values (cat_eq, 'runtime-lc-eq', '原価 設備', 'published', 'multi');
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation, price_unit)
  values (p1, cat_eq, 'runtime-lc-p1', '原価 設備1', 20000, false, 'published', 'PRD-968901', false, '台');
  set local session_replication_role = origin;

  perform pg_temp.lc_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 20000, 0, ''検査'')', p1));
  v_bmr := pg_temp.lc_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, '原価 本体', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_office));
  perform pg_temp.lc_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, '原価 本体', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr));
  perform pg_temp.lc_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr));

  -- 旧標準見積：手入力明細に原価を登録して公開する（取付費 auto 6,000 円 × 2・養生 manual 原価 0 円 売価 0 円・
  -- 足場 auto 10,001 円 × 1.5（内外装）・外構工事 別途見積（別途工事）・運搬費 manual 原価 3,000 円 売価 5,000 円・
  -- 清掃費 manual 原価 2,000 円 売価 3,000 円・設置工事 auto 30,000 円（別途工事）・大型工事 manual 原価 150,000,000 円 売価 200,000,000 円）。
  -- 次の版で運搬費の原価だけ 3,500 円にする
  v_legacy := pg_temp.lc_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr));
  select r.standard_estimate_master_id into v_master from public.standard_estimate_revisions r where r.id::text = v_legacy;
  v_out := pg_temp.lc_run_as('authenticated', u_editor, format($q$ select (public.save_standard_estimate_draft(%L, 1, 0.15, 1.5, 0, null,
    '{"base":"rate","interior_exterior":"rate","option":"rate","sitework":"none"}'::jsonb,
    '[{"section_code":"option","name":"取付費","quantity":2,"unit":"式","price_mode":"auto","cost_unit_price":6000},
      {"section_code":"option","name":"養生","quantity":1,"unit":"式","price_mode":"manual","cost_unit_price":0,"unit_price":0},
      {"section_code":"interior_exterior","name":"足場","quantity":1.5,"unit":"式","price_mode":"auto","cost_unit_price":10001},
      {"section_code":"sitework","name":"外構工事","quantity":1,"unit":"式","price_mode":"por"},
      {"section_code":"option","name":"運搬費","quantity":1,"unit":"式","price_mode":"manual","cost_unit_price":3000,"unit_price":5000},
      {"section_code":"option","name":"清掃費","quantity":1,"unit":"式","price_mode":"manual","cost_unit_price":2000,"unit_price":3000},
      {"section_code":"sitework","name":"設置工事","quantity":1,"unit":"式","price_mode":"auto","cost_unit_price":30000},
      {"section_code":"option","name":"大型工事","quantity":1,"unit":"式","price_mode":"manual","cost_unit_price":150000000,"unit_price":200000000}]'::jsonb,
    %s)).lock_version::text $q$, v_legacy, (select lock_version from public.standard_estimate_revisions where id::text = v_legacy)));
  v_out := pg_temp.lc_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_revision(%L, %s)).status', v_legacy,
    (select lock_version from public.standard_estimate_revisions where id::text = v_legacy)));
  v_legacy2 := pg_temp.lc_run_as('authenticated', u_editor, format('select public.start_next_standard_estimate_revision(%L)::text', v_master))::uuid;
  select jsonb_agg(jsonb_build_object('line_key', l.line_key, 'section_code', l.section_code, 'name', l.name, 'quantity', l.quantity, 'unit', l.unit,
                                      'price_mode', l.price_mode,
                                      'cost_unit_price', case when l.name = '運搬費' then 3500 else l.cost_unit_price end,
                                      'unit_price', l.unit_price) order by l.sort_order)
    into v_lines
    from public.standard_estimate_revision_lines l where l.revision_id = v_legacy2;
  perform pg_temp.lc_run_as('authenticated', u_editor, format($q$ select (public.save_standard_estimate_draft(%L, 1, 0.15, 1.5, 0, null,
    '{"base":"rate","interior_exterior":"rate","option":"rate","sitework":"none"}'::jsonb, %L::jsonb, %s)).id::text $q$,
    v_legacy2, v_lines, (select lock_version from public.standard_estimate_revisions where id = v_legacy2)));
  v_out := v_out || '/' || pg_temp.lc_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_revision(%L, %s)).status', v_legacy2,
    (select lock_version from public.standard_estimate_revisions where id = v_legacy2)));
  perform pg_temp.lc_expect_eq('LC-0 前提：手入力明細に原価を登録した旧標準見積を 2 版公開できる（運搬費の原価だけ 3,000 → 3,500）', 'published/published', v_out);

  -- ---------- 旧標準見積から v2.5 の下書きへ：登録された原価を写す（⑤-5） ----------
  v_rev := pg_temp.lc_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, null)::text', v_master))::uuid;
  perform pg_temp.lc_expect_eq('LC-1 旧標準見積（公開中の版）から写した手入力明細に、登録された原価単価・原価金額も写す（0 円は 0 円、別途見積・別途工事・1 億円超は原価なし）',
    '取付費:6000:12000/養生:0:0/足場:10001:15001/外構工事:-:-/運搬費:3500:3500/清掃費:2000:2000/設置工事:-:-/大型工事:-:-', pg_temp.lc_costs(v_rev));
  select l.line_key into k1 from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev and l.name = '取付費';
  select l.line_key into k2 from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev and l.name = '養生';
  select l.line_key into k3 from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev and l.name = '足場';
  select l.line_key into k4 from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev and l.name = '外構工事';
  select l.line_key into k5 from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev and l.name = '運搬費';
  select l.line_key into k6 from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev and l.name = '清掃費';
  select l.line_key into k7 from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev and l.name = '設置工事';
  select l.line_key into k8 from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev and l.name = '大型工事';

  -- ---------- 原価単価の保存：数・0 円・未入力（null）・別途見積 ----------
  -- 商品の行は同じ識別子で保存する（売価の指紋を保存の前後で比べるため）
  v_slots := jsonb_build_array(jsonb_build_object('baseline_key', k_slot, 'option_id', p1, 'variant_choice_ids', '[]'::jsonb, 'quantity', '1',
                                                  'price_mode', 'auto', 'manual_unit_price', null, 'slot_code', null, 'slot_label', null,
                                                  'selectable_option_ids', '[]'::jsonb));
  v_out := pg_temp.lc_save(u_editor, v_rev, pg_temp.lc_payload(v_slots, jsonb_build_array(
    pg_temp.lc_line(k1, 'option', '取付費', '2', 'manual', 9000, '6000'),
    pg_temp.lc_line(k2, 'option', '養生', '1', 'manual', 0, '0'),
    pg_temp.lc_line(k3, 'interior_exterior', '足場', '1.5', 'manual', 15001, '10001'),
    pg_temp.lc_line(k4, 'sitework', '外構工事', '1', 'por', null, '5000'),
    pg_temp.lc_line(k_new, 'option', '新規の材料', '3', 'manual', 1000, 'null'))));
  perform pg_temp.lc_expect_eq('LC-2 原価単価を売価と別に保存する。原価金額 = trunc(数量 × 原価単価)。0 円と未入力（-）を分け、別途見積は原価を持たない',
    '取付費:6000:12000/養生:0:0/足場:10001:15001/外構工事:-:-/新規の材料:-:-', pg_temp.lc_costs(v_rev));
  perform pg_temp.lc_expect_eq('LC-3 原価を入れても売価は変わらない（売価単価・売価金額は入力のまま）',
    '取付費:9000:18000/養生:0:0/足場:15001:22501/新規の材料:1000:3000',
    (select string_agg(l.name || ':' || l.unit_price || ':' || l.amount, '/' order by l.sort_order)
       from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev and l.price_mode = 'manual'));

  -- ---------- 区分と版の原価の合計 ----------
  -- 内外装：足場 15,001・経費 trunc(15,001 × 0.15) = 2,250。オプション：商品の原価 ＋ 取付費 12,000 ＋ 養生 0（新規の材料は未設定で含めない）。
  -- 別途工事：別途見積だけで 0。版の原価合計は区分の原価合計の和
  perform pg_temp.lc_expect_eq('LC-4 区分の原価明細小計に手入力明細の原価金額を足し、原価側の経費 = trunc(小計 × 経費率)。版の原価合計は区分の和',
    'interior_exterior:15001:2250:17251/option:+12000/rate:true/sitework:0:0:0/sum:true',
    (select concat_ws(':', s.section_code, s.cost_line_subtotal, s.cost_expense_amount, s.cost_total)
       from public.standard_estimate_revision_sections s where s.revision_id = v_rev and s.section_code = 'interior_exterior') || '/' ||
    (select 'option:+' || (s.cost_line_subtotal - (select coalesce(sum(trunc(b.quantity * b.cost_unit_price)), 0)
                                                     from public.standard_estimate_revision_baseline_items b
                                                    where b.revision_id = v_rev and b.section_code = 'option' and b.cost_unit_price is not null))::text
            || '/rate:' || (s.cost_expense_amount = trunc(s.cost_line_subtotal * 0.15) and s.cost_total = s.cost_line_subtotal + s.cost_expense_amount)::text
       from public.standard_estimate_revision_sections s where s.revision_id = v_rev and s.section_code = 'option') || '/' ||
    (select concat_ws(':', s.section_code, s.cost_line_subtotal, s.cost_expense_amount, s.cost_total)
       from public.standard_estimate_revision_sections s where s.revision_id = v_rev and s.section_code = 'sitework') || '/sum:' ||
    (select (r.cost_total = (select sum(s.cost_total) from public.standard_estimate_revision_sections s where s.revision_id = r.id))::text
       from public.standard_estimate_revisions r where r.id = v_rev));

  -- ---------- 原価だけを変えても売価は変わらない・数量を変えると原価金額も計算し直す ----------
  v_sale_a := pg_temp.lc_sale(v_rev);
  v_cost_a := pg_temp.lc_cost_totals(v_rev);
  v_out := pg_temp.lc_save(u_editor, v_rev, pg_temp.lc_payload(v_slots, jsonb_build_array(
    pg_temp.lc_line(k1, 'option', '取付費', '2', 'manual', 9000, '7000'),
    pg_temp.lc_line(k2, 'option', '養生', '1', 'manual', 0, '0'),
    pg_temp.lc_line(k3, 'interior_exterior', '足場', '1.5', 'manual', 15001, '10001'),
    pg_temp.lc_line(k4, 'sitework', '外構工事', '1', 'por', null, 'null'),
    pg_temp.lc_line(k_new, 'option', '新規の材料', '3', 'manual', 1000, '600'))));
  v_sale_b := pg_temp.lc_sale(v_rev);
  v_cost_b := pg_temp.lc_cost_totals(v_rev);
  perform pg_temp.lc_expect_eq('LC-5 原価単価だけを変えた保存は、版・区分・行の売価と計算結果を変えず、原価の合計だけが変わる', 'true/true',
    (v_sale_a = v_sale_b)::text || '/' || (v_cost_a <> v_cost_b)::text);
  -- オプションの原価明細の増え方：取付費 (7,000 − 6,000) × 2 ＋ 新規の材料 600 × 3 ＝ 3,800
  perform pg_temp.lc_expect_eq('LC-6 原価の合計の増え方は、変えた原価金額の差（オプション +3,800）', '3800',
    ((select s.cost_line_subtotal from public.standard_estimate_revision_sections s where s.revision_id = v_rev and s.section_code = 'option')
     - split_part(split_part(v_cost_a, 'option:', 2), ':', 1)::integer)::text);
  v_out := pg_temp.lc_save(u_editor, v_rev, pg_temp.lc_payload(v_slots, jsonb_build_array(
    pg_temp.lc_line(k1, 'option', '取付費', '3', 'manual', 9000, '7000'),
    pg_temp.lc_line(k2, 'option', '養生', '1', 'manual', 0, '0'),
    pg_temp.lc_line(k3, 'interior_exterior', '足場', '1.5', 'manual', 15001, '10001'),
    pg_temp.lc_line(k4, 'sitework', '外構工事', '1', 'por', null, 'null'),
    pg_temp.lc_line(k_new, 'option', '新規の材料', '3', 'manual', 1000, '600'))));
  perform pg_temp.lc_expect_eq('LC-7 数量を変えると、原価金額も売価金額も計算し直す（取付費 3 × 7,000・3 × 9,000）', '21000/27000',
    (select l.cost_amount || '/' || l.amount from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev and l.line_key = k1));

  -- ---------- 古い画面（原価の項目なし）の保存は原価を残す・null は消す ----------
  v_out := pg_temp.lc_save(u_editor, v_rev, pg_temp.lc_payload(v_slots, jsonb_build_array(
    pg_temp.lc_line(k1, 'option', '取付費', '3', 'manual', 9000, '"absent"'),
    pg_temp.lc_line(k2, 'option', '養生', '1', 'manual', 0, 'null'),
    pg_temp.lc_line(k3, 'interior_exterior', '足場', '2', 'manual', 15001, '"absent"'),
    pg_temp.lc_line(k4, 'sitework', '外構工事', '1', 'por', null, '"absent"'),
    pg_temp.lc_line(null, 'option', '名前の無い行', '1', 'manual', 100, '"absent"'))));
  perform pg_temp.lc_expect_eq('LC-8 原価の項目の無い行（古い画面）は同じ line_key の原価を残し（数量に合わせて原価金額も計算）、null は未入力に戻す。新しい行は未入力',
    '取付費:7000:21000/養生:-:-/足場:10001:20002/外構工事:-:-/名前の無い行:-:-', pg_temp.lc_costs(v_rev));

  -- ---------- 入力の決まり ----------
  perform pg_temp.lc_expect_eq('LC-9 原価単価が数でない（"1200"・1.5・true）・範囲外（-1・100,000,001）・原価金額が整数を超える行は保存しない', 'true/true/true/true/true/true',
    (pg_temp.lc_save(u_editor, v_rev, pg_temp.lc_payload('[]'::jsonb, jsonb_build_array(pg_temp.lc_line(null, 'option', 'A', '1', 'manual', 100, '"1200"'))))
       like 'ERROR P0001: VALIDATION: 明細 1 行目：原価単価は数で指定してください%')::text || '/' ||
    (pg_temp.lc_save(u_editor, v_rev, pg_temp.lc_payload('[]'::jsonb, jsonb_build_array(pg_temp.lc_line(null, 'option', 'A', '1', 'manual', 100, '1.5'))))
       like 'ERROR P0001: VALIDATION:%')::text || '/' ||
    (pg_temp.lc_save(u_editor, v_rev, pg_temp.lc_payload('[]'::jsonb, jsonb_build_array(pg_temp.lc_line(null, 'option', 'A', '1', 'manual', 100, 'true'))))
       like 'ERROR P0001: VALIDATION:%')::text || '/' ||
    (pg_temp.lc_save(u_editor, v_rev, pg_temp.lc_payload('[]'::jsonb, jsonb_build_array(pg_temp.lc_line(null, 'option', 'A', '1', 'manual', 100, '-1'))))
       like 'ERROR P0001: VALIDATION: 明細 1 行目の原価単価（税別）は 0〜100,000,000 円の整数で入力してください%')::text || '/' ||
    (pg_temp.lc_save(u_editor, v_rev, pg_temp.lc_payload('[]'::jsonb, jsonb_build_array(pg_temp.lc_line(null, 'option', 'A', '1', 'manual', 100, '100000001'))))
       like 'ERROR P0001: VALIDATION: 明細 1 行目の原価単価（税別）は 0〜100,000,000 円の整数で入力してください%')::text || '/' ||
    (pg_temp.lc_save(u_editor, v_rev, pg_temp.lc_payload('[]'::jsonb, jsonb_build_array(pg_temp.lc_line(null, 'option', 'A', '99999', 'manual', 0, '100000000'))))
       like 'ERROR P0001: VALIDATION: 明細 1 行目の原価金額（数量 × 原価単価）が大きすぎます%')::text);
  perform pg_temp.lc_expect_eq('LC-10 拒否した保存では下書きの原価は変わらない', '取付費:7000:21000/養生:-:-/足場:10001:20002/外構工事:-:-/名前の無い行:-:-',
    pg_temp.lc_costs(v_rev));

  -- ---------- 公開：原価単価が未入力の手入力明細があれば公開しない ----------
  v_preview := (pg_temp.lc_run_as('authenticated', u_editor, format('select public.preview_standard_estimate_v25_revision(%L)::text', v_rev)))::jsonb;
  perform pg_temp.lc_expect_eq('LC-11 編集画面の確認：原価単価が未入力の明細を返し、公開できない', '養生/名前の無い行|false',
    (select string_agg(x.value ->> 'name', '/' order by x.ordinality) from jsonb_array_elements(v_preview -> 'missing_line_costs') with ordinality as x(value, ordinality))
    || '|' || (v_preview ->> 'publishable'));
  perform pg_temp.lc_expect_eq('LC-12 原価単価が未入力の明細があれば公開しない（0 円にしない。行の名前を示す）', 'true/draft',
    (pg_temp.lc_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, %s)).status', v_rev,
       (select lock_version from public.standard_estimate_revisions where id = v_rev)))
     like 'ERROR P0001: LOCKED: 原価単価が未入力の明細が 2 行あります（「養生」・「名前の無い行」）%')::text || '/' ||
    (select r.status from public.standard_estimate_revisions r where r.id = v_rev));
  v_out := pg_temp.lc_save(u_editor, v_rev, pg_temp.lc_payload(v_slots, jsonb_build_array(
    pg_temp.lc_line(k1, 'option', '取付費', '3', 'manual', 9000, '7000'),
    pg_temp.lc_line(k2, 'option', '養生', '1', 'manual', 0, '0'),
    pg_temp.lc_line(k3, 'interior_exterior', '足場', '1.5', 'manual', 15001, '10001'),
    pg_temp.lc_line(k4, 'sitework', '外構工事', '1', 'por', null, 'null'),
    pg_temp.lc_line(k_new, 'option', '新規の材料', '3', 'manual', 1000, '600'))));
  v_out := pg_temp.lc_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, %s)).status', v_rev,
    (select lock_version from public.standard_estimate_revisions where id = v_rev)));
  perform pg_temp.lc_expect_eq('LC-13 すべての手入力明細に原価単価（0 円を含む）を入れると公開できる。原価は版と一緒に固定される', 'published/取付費:7000:21000/養生:0:0/足場:10001:15001/外構工事:-:-/新規の材料:600:1800',
    v_out || '/' || pg_temp.lc_costs(v_rev));
  begin
    update public.standard_estimate_revision_v25_lines set cost_unit_price = 1, cost_amount = 3 where revision_id = v_rev and line_key = k1;
    v_out := 'updated';
  exception when others then
    v_out := format('ERROR %s', sqlstate);
  end;
  perform pg_temp.lc_expect_eq('LC-14 公開した版の手入力明細の原価は変えられない（トリガー）', 'ERROR P0001', v_out);

  -- ---------- お客様向けの売価の形には原価を出さない ----------
  perform pg_temp.lc_expect_eq('LC-15 見積書・シミュレーターの売価の形（sale_view）の明細に原価の項目は無い', '0/5',
    (select count(*)::text from jsonb_array_elements(public.standard_estimate_v25_sale_view(v_rev, false) -> 'lines') x
       cross join lateral jsonb_object_keys(x.value) k where k like '%cost%') || '/' ||
    (select count(*)::text from jsonb_array_elements(public.standard_estimate_v25_sale_view(v_rev, false) -> 'lines') x
       where x.value ->> 'name' in ('取付費', '養生', '足場', '外構工事', '新規の材料')));

  -- ---------- 本部以外は原価を読めない ----------
  perform pg_temp.lc_expect_eq('LC-16 本部（組織のメンバー）は原価を読める。代理店・総代理店・お客様は手入力明細の行を読めない。匿名は表を読めない',
    '4/0/0/0/true',
    pg_temp.lc_run_as('authenticated', u_editor, format('select count(*)::text from public.standard_estimate_revision_v25_lines where revision_id = %L and cost_unit_price is not null', v_rev)) || '/' ||
    pg_temp.lc_run_as('authenticated', u_dealer, format('select count(*)::text from public.standard_estimate_revision_v25_lines where revision_id = %L', v_rev)) || '/' ||
    pg_temp.lc_run_as('authenticated', u_master, format('select count(*)::text from public.standard_estimate_revision_v25_lines where revision_id = %L', v_rev)) || '/' ||
    pg_temp.lc_run_as('authenticated', u_customer, format('select count(*)::text from public.standard_estimate_revision_v25_lines where revision_id = %L', v_rev)) || '/' ||
    (pg_temp.lc_run_as('anon', null, format('select count(*)::text from public.standard_estimate_revision_v25_lines where revision_id = %L', v_rev)) like 'ERROR 42501%')::text);
  perform pg_temp.lc_expect_eq('LC-17 ログインした利用者は原価の列を直接書き換えられない・内部の写しの関数を実行できない', 'true/true',
    (pg_temp.lc_run_as('authenticated', u_editor, format('update public.standard_estimate_revision_v25_lines set cost_unit_price = 1 where revision_id = %L returning id::text', v_rev))
       like 'ERROR 42501%')::text || '/' ||
    (pg_temp.lc_run_as('authenticated', u_editor, format('select public.standard_estimate_v25_fill_line_costs_from_legacy(%L)::text', v_rev))
       like 'ERROR 42501%')::text);

  -- ---------- 次の版の下書き：原価も写す ----------
  v_rev2 := pg_temp.lc_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, null)::text', v_master))::uuid;
  perform pg_temp.lc_expect_eq('LC-18 公開した版から作る次の下書きに、手入力明細の原価も写す', pg_temp.lc_costs(v_rev), pg_temp.lc_costs(v_rev2));

  -- ---------- Web 以外の案件見積の下書き（D1c）：版で固定した原価を写す ----------
  perform pg_temp.lc_expect_eq('LC-19 案件見積の下書きの行に、手入力明細の版の原価単価を写す（別途見積は原価なし）',
    '足場:10001/取付費:7000/養生:0/新規の材料:600/外構工事:-',
    (select string_agg((x.value ->> 'name') || ':' || coalesce(x.value ->> 'cost_unit_price', '-'), '/' order by x.ordinality)
       from jsonb_array_elements(public.standard_estimate_v25_quote_draft_lines(v_rev, true)) with ordinality as x(value, ordinality)
      where x.value ->> 'name' in ('取付費', '養生', '足場', '外構工事', '新規の材料')));
  v_out := pg_temp.lc_run_as('authenticated', u_admin,
    format($q$ select public.create_standard_quote_case('原価の検査 案件', '{"full_name":"検査 花子"}'::jsonb, '電話で受付', %L)::text $q$, v_rev));
  v_draft := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.lc_expect_eq('LC-20 本部は手入力明細の原価がそろった版から案件見積の下書きを作れ、社内の記録の原価は版の原価', '足場:10001/取付費:7000/養生:0/新規の材料:600',
    coalesce((select string_agg(i.name || ':' || coalesce(c.cost_unit_price::text, '-'), '/' order by i.sort_order)
                from public.quote_draft_items i
                join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key
               where i.draft_id = v_draft and i.name in ('取付費', '養生', '足場', '新規の材料')), v_out));
  -- 発行まで通す：別途見積の行（外構工事）に金額を入れて保存し、正式保存する（版の 0 円の明細「養生」は変えていないので止めない）
  v_out := pg_temp.lc_draft_save(u_admin, v_draft, pg_temp.lc_draft_lines(v_draft, jsonb_build_object('外構工事', jsonb_build_object('sale', 30000, 'cost', 25000))));
  v_draft_cost := pg_temp.lc_run_as('authenticated', u_admin, format($q$ select public.get_standard_quote_draft(%L) -> 'internals' ->> 'cost_total' $q$, v_draft));
  v_out := pg_temp.lc_run_as('authenticated', u_admin, format('select public.finalize_quote_draft(%L, %s)::text', v_draft,
    (select lock_version from public.quote_drafts where id = v_draft)));
  v_quote := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.lc_expect_eq('LC-20b 手入力明細の原価を写した下書きを正式保存できる（版の 0 円の明細は止めない）。見積の明細は版の売価、社内の記録の原価合計は下書きと同じ',
    'true/足場:22501/取付費:27000/養生:0/新規の材料:3000/true',
    (v_quote is not null)::text || '/' ||
    coalesce((select string_agg(qi.name || ':' || qi.amount, '/' order by qi.sort_order)
                from public.quote_items qi where qi.quote_id = v_quote and qi.name in ('取付費', '養生', '足場', '新規の材料')), v_out) || '/' ||
    coalesce((select (s.cost_total::text = v_draft_cost)::text from public.quote_internal_snapshots s where s.quote_id = v_quote), '(no snapshot)'));
  -- 原価単価が未入力の手入力明細を含む版からは作らない（版の行の名前を示す）
  v_out := pg_temp.lc_save(u_editor, v_rev2, pg_temp.lc_payload(v_slots, jsonb_build_array(
    pg_temp.lc_line(k1, 'option', '取付費', '3', 'manual', 9000, 'null'))));
  begin
    v_out := public.standard_estimate_v25_quote_draft_lines(v_rev2, true)::text;
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  perform pg_temp.lc_expect_eq('LC-21 原価単価が未入力の手入力明細を含む版からは、案件見積の下書きを作らない（0 円にも売価と同じにもしない）', 'true',
    (v_out like 'ERROR P0001: LOCKED: 標準見積の版に、原価が未設定の明細（「取付費」）%')::text);

  -- ---------- 既存の下書きへ、旧標準見積に登録された原価を写す（内部の関数。migration の写しと同じ） ----------
  -- 旧標準見積から写したまま変えていない行（取付費 2 × 9,000・養生 0・足場 1.5 × 15,001）は原価未設定、足場は売価を変えた行、
  -- 新しい行は旧標準見積に無い行にして、写せる行だけに写ることを確かめる
  v_out := pg_temp.lc_save(u_editor, v_rev2, pg_temp.lc_payload(v_slots, jsonb_build_array(
    pg_temp.lc_line(k1, 'option', '取付費', '2', 'manual', 9000, 'null'),
    pg_temp.lc_line(k2, 'option', '養生', '1', 'manual', 0, 'null'),
    pg_temp.lc_line(k3, 'interior_exterior', '足場', '1.5', 'manual', 16000, 'null'),
    pg_temp.lc_line(k4, 'sitework', '外構工事', '1', 'por', null, 'null'),
    pg_temp.lc_line(k_new, 'option', '新規の材料', '3', 'manual', 1000, 'null'),
    pg_temp.lc_line(k5, 'option', '運搬費', '1', 'manual', 5000, 'null'),
    pg_temp.lc_line(k6, 'option', '清掃費', '1', 'manual', 3000, 'null') || '{"unit": "m2"}'::jsonb,
    pg_temp.lc_line(k7, 'sitework', '設置工事', '1', 'manual', 45000, 'null'),
    pg_temp.lc_line(k8, 'option', '大型工事', '1', 'manual', 200000000, 'null'))));
  v_sale_a := pg_temp.lc_sale(v_rev2);
  perform public.standard_estimate_v25_set_writer(true);
  v_out := public.standard_estimate_v25_fill_line_costs_from_legacy(v_rev2)::text;
  perform public.standard_estimate_v25_set_writer(false);
  perform pg_temp.lc_expect_eq('LC-22 旧標準見積から写したまま変えていない行だけに写す（売価を変えた行・新しい行・別途見積・旧の版で原価が違う行・単位が違う行・別途工事・1 億円超は未設定のまま）',
    '2|取付費:6000:12000/養生:0:0/足場:-:-/外構工事:-:-/新規の材料:-:-/運搬費:-:-/清掃費:-:-/設置工事:-:-/大型工事:-:-', v_out || '|' || pg_temp.lc_costs(v_rev2));
  v_sale_b := pg_temp.lc_sale(v_rev2);
  v_cost_a := pg_temp.lc_cost_totals(v_rev2);
  perform public.standard_estimate_v25_set_writer(true);
  perform public.standard_estimate_v25_recalculate(v_rev2, false);
  perform public.standard_estimate_v25_set_writer(false);
  v_cost_b := pg_temp.lc_cost_totals(v_rev2);
  perform pg_temp.lc_expect_eq('LC-23 写した後の区分・版の原価の合計は正式な再計算と同じ。売価の列は変えない', 'true/true',
    (v_cost_a = v_cost_b)::text || '/' || (v_sale_a = v_sale_b)::text);
  perform public.standard_estimate_v25_set_writer(true);
  v_out := public.standard_estimate_v25_fill_line_costs_from_legacy(v_rev2)::text || '/' ||
           public.standard_estimate_v25_fill_line_costs_from_legacy(v_rev)::text;
  perform public.standard_estimate_v25_set_writer(false);
  perform pg_temp.lc_expect_eq('LC-24 もう一度呼んでも写さない（写した行は未設定でない）。公開済みの版には写さない', '0/0', v_out);
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _lc_result;

rollback;
