-- A-2 ⑥：v2.5 の経費を「率で計算」か「金額を手動」で決める（標準見積・シミュレーター・Web の見積・Web 以外の下書き）の実行時検査。
-- 使い捨てDB専用。最後に rollback する。
begin;

create temp table _exp_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _exp_result to public;

create function pg_temp.exp_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.exp_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _exp_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.exp_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _exp_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || '%');
$fn$;

-- 標準見積の v2.5 の下書きを保存する（p_payload はそのまま）
create function pg_temp.exp_save_se(p_user uuid, p_rev uuid, p_payload jsonb) returns text
language sql as $fn$
  select pg_temp.exp_run_as('authenticated', p_user, format(
    'select (public.save_standard_estimate_v25_draft(%L, %s, %L::jsonb)).lock_version::text',
    p_rev, (select lock_version from public.standard_estimate_revisions where id = p_rev), p_payload));
$fn$;

-- 標準見積の区分の経費（方法/額/区分の合計）
create function pg_temp.exp_section(p_rev uuid, p_code text) returns text
language sql as $fn$
  select coalesce((select s.expense_method || '/' || s.expense_amount || '/' || s.total
                     from public.standard_estimate_revision_sections s
                    where s.revision_id = p_rev and s.section_code = p_code), '(none)');
$fn$;

-- Web の第 2 版以降の発行（担当者として呼ぶ）
create function pg_temp.exp_revise(p_user uuid, p_quote uuid, p_lines jsonb) returns text
language sql as $fn$
  select pg_temp.exp_run_as('authenticated', p_user, format(
    $q$ select public.create_quote_revision_v25(%L, %L::jsonb, 0, null, null)::text $q$, p_quote, p_lines));
$fn$;

-- 前の版の明細をそのまま写す（経費の行は除く）。p_extra を後ろに足す
create function pg_temp.exp_parent_lines(p_quote uuid, p_extra jsonb default '[]'::jsonb) returns jsonb
language sql as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('source', 'parent', 'parent_item_id', i.id) order by i.sort_order, i.id), '[]'::jsonb) || p_extra
    from public.quote_items i
   where i.quote_id = p_quote and i.kind not in ('base_expense', 'interior_exterior_expense', 'option_expense');
$fn$;

-- 見積の経費の行（品名=金額|説明）
create function pg_temp.exp_quote_expenses(p_quote uuid) returns text
language sql as $fn$
  select coalesce(string_agg(i.name || '=' || i.amount || '|' || coalesce(i.description, ''), ' ; ' order by i.sort_order), '(none)')
    from public.quote_items i
   where i.quote_id = p_quote and i.kind in ('base_expense', 'interior_exterior_expense', 'option_expense');
$fn$;

-- 下書きの明細を保存の形にする（経費の行は除く）
create function pg_temp.exp_draft_lines(p_draft uuid) returns jsonb
language sql as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'line_key', i.line_key, 'section_code', c.section_code, 'name', i.name, 'description', i.description,
           'unit', i.unit, 'remark', i.remark, 'quantity', i.quantity, 'price_mode', i.price_mode,
           'cost_unit_price', c.cost_unit_price, 'unit_price', i.unit_price
         ) order by i.sort_order, i.line_key), '[]'::jsonb)
    from public.quote_draft_items i
    join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key
   where i.draft_id = p_draft and c.line_role = 'line';
$fn$;

-- 本部として下書きを保存する（率は下書きのまま、経費の決め方は p_methods）
create function pg_temp.exp_save_draft(p_user uuid, p_draft uuid, p_methods jsonb, p_markup numeric default null) returns text
language sql as $fn$
  select pg_temp.exp_run_as('authenticated', p_user, format(
    $q$ select public.save_standard_quote_draft(%L, %s, %s, %s, %s, %L::jsonb, %L::jsonb, 0, null, null)::text $q$,
    p_draft, d.lock_version, n.sales_fee_rate, n.expense_rate, coalesce(p_markup, n.markup_rate), p_methods, pg_temp.exp_draft_lines(p_draft)))
    from public.quote_drafts d
    join public.quote_draft_internals n on n.draft_id = d.id
   where d.id = p_draft;
$fn$;

-- 下書きの経費の行（品名=売価/原価|説明）
create function pg_temp.exp_draft_expenses(p_draft uuid) returns text
language sql as $fn$
  select coalesce(string_agg(i.name || '=' || i.amount || '/' || c.cost_amount || '|' || coalesce(i.description, ''), ' ; ' order by i.sort_order), '(none)')
    from public.quote_draft_items i
    join public.quote_draft_item_costs c on c.draft_id = i.draft_id and c.line_key = i.line_key
   where i.draft_id = p_draft and c.line_role = 'expense';
$fn$;

do $test$
declare
  u_admin constant uuid := '2a400000-0000-4000-8000-000000000001';
  u_editor constant uuid := '2a400000-0000-4000-8000-000000000002';
  u_customer constant uuid := '2a400000-0000-4000-8000-000000000003';
  u_dealer constant uuid := '2a400000-0000-4000-8000-000000000004';
  org_hq constant uuid := '2a400000-0000-4000-8000-000000000101';
  m_model constant uuid := '2a400000-0000-4000-8000-000000000201';
  mr_office constant uuid := '2a400000-0000-4000-8000-000000000301';
  mr_hotel constant uuid := '2a400000-0000-4000-8000-000000000302';
  mr_residence constant uuid := '2a400000-0000-4000-8000-000000000303';
  cat_opt constant uuid := '2a400000-0000-4000-8000-000000000401';
  o1 constant uuid := '2a400000-0000-4000-8000-000000000501';
  o2 constant uuid := '2a400000-0000-4000-8000-000000000502';
  g_o2 constant uuid := '2a400000-0000-4000-8000-000000000601';
  c_o2 constant uuid := '2a400000-0000-4000-8000-000000000701';
  v_bmr text;
  v_bmr2 text;
  v_bmr3 text;
  v_se text;
  v_legacy text;
  v_legacy2 text;
  v_master uuid;
  v_rev uuid;
  v_rev_next uuid;
  v_rule uuid;
  v_tax uuid;
  v_slot jsonb;
  v_base_payload jsonb;
  v_out text;
  v_cfg uuid;
  v_q1 uuid;
  v_q2 uuid;
  v_q3 uuid;
  v_q4 uuid;
  v_ctx jsonb;
  v_draft uuid;
  v_quote uuid;
  v_rdraft uuid;
  v_legacy_draft uuid;
  v_calc jsonb;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'exp-admin@runtime.invalid', '{}'::jsonb), (u_editor, 'exp-editor@runtime.invalid', '{}'::jsonb),
         (u_customer, 'exp-customer@runtime.invalid', '{}'::jsonb), (u_dealer, 'exp-dealer@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'exp-admin@runtime.invalid', '本部', 'admin'),
         (u_editor, 'exp-editor@runtime.invalid', 'HQ editor', 'customer'),
         (u_customer, 'exp-customer@runtime.invalid', 'お客様', 'customer'),
         (u_dealer, 'exp-dealer@runtime.invalid', '担当代理店', 'dealer');
  insert into public.organizations (id, code, name, organization_type, status)
  values (org_hq, 'runtime-exp-hq', 'Expense Runtime HQ', 'headquarters', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values (org_hq, u_editor, 'editor', 'active');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-exp-model', '経費検査モデル', 1000000, 'published', '[{"code":"office","name":"事務所","option_codes":[]}]'::jsonb);
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_office, m_model, 'office', '2100x4550', false), (mr_hotel, m_model, 'hotel', '2100x4550', false),
         (mr_residence, m_model, 'residence', '2100x4550', false);
  insert into public.option_categories (id, code, name, status, selection_mode)
  values (cat_opt, 'runtime-exp-option', '経費検査 設備', 'published', 'multi');
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation)
  values (o1, cat_opt, 'runtime-exp-o1', '経費検査 設備1', 20000, false, 'published', 'PRD-949001', false),
         (o2, cat_opt, 'runtime-exp-o2', '経費検査 設備2', 10000, false, 'published', 'PRD-949002', false);
  insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
  values (g_o2, o2, 'size', 'サイズ', 1, false, 'published');
  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status, sort_order)
  values (c_o2, g_o2, 'large', '大', 'option', 1000, 'published', 1);
  set local session_replication_role = origin;

  -- 原価（本部）：設備1 20,000、設備2 10,000＋大 1,000
  perform pg_temp.exp_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 20000, 0, ''検査'')', o1));
  perform pg_temp.exp_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 10000, 0, ''検査'')', o2));
  perform pg_temp.exp_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 1000, null, ''検査'')', c_o2));

  -- ---------- 計算（pricing_calculate） ----------
  select r.id into v_rule from public.pricing_calculation_rule_versions r where r.superseded_at is null;
  select t.id into v_tax from public.tax_rule_versions t where t.superseded_at is null;
  v_calc := public.pricing_calculate(v_rule, v_tax, jsonb_build_object(
    'rates', jsonb_build_object('sales_fee_rate', '1.07', 'markup_rate', '1.5', 'expense_rate', '0.15'),
    'sections', jsonb_build_array(
      jsonb_build_object('code', 'base', 'lines', jsonb_build_array(jsonb_build_object('key', 'b1', 'mode', 'manual', 'quantity', '1', 'manual_unit_price', 100000))),
      jsonb_build_object('code', 'option', 'expense_amount', 12345,
        'lines', jsonb_build_array(jsonb_build_object('key', 'o1', 'mode', 'manual', 'quantity', '1', 'manual_unit_price', 50000))),
      jsonb_build_object('code', 'interior_exterior', 'expense_amount', 7000,
        'lines', jsonb_build_array(jsonb_build_object('key', 'i1', 'mode', 'por', 'quantity', '1'))),
      jsonb_build_object('code', 'sitework', 'lines', '[]'::jsonb))));
  perform pg_temp.exp_expect_eq('EXP-1 計算：区分の手動の額はその額（率で計算しない）。区分ごとの方法（rate / fixed / none）を返し、別途見積を含む区分は未確定のまま',
    'rate/15000|fixed/12345/62345|fixed/null|none/0',
    (select string_agg(case x.value ->> 'code'
              when 'base' then (x.value ->> 'expense_method') || '/' || (x.value ->> 'expense')
              when 'option' then (x.value ->> 'expense_method') || '/' || (x.value ->> 'expense') || '/' || (x.value ->> 'total')
              when 'interior_exterior' then (x.value ->> 'expense_method') || '/' || coalesce(x.value ->> 'expense', 'null')
              else (x.value ->> 'expense_method') || '/' || (x.value ->> 'expense') end, '|' order by x.ordinality)
       from jsonb_array_elements(v_calc -> 'sections') with ordinality as x(value, ordinality)));
  begin
    v_calc := public.pricing_calculate(v_rule, v_tax, jsonb_build_object(
      'rates', jsonb_build_object('sales_fee_rate', '1.07', 'markup_rate', '1.5', 'expense_rate', '0.15'),
      'sections', jsonb_build_array(jsonb_build_object('code', 'sitework', 'expense_amount', 1000, 'lines', '[]'::jsonb))));
    v_out := 'calculated';
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  perform pg_temp.exp_expect_error('EXP-2 計算：経費を掛けない区分（別途工事）には手動の額を指定できない', 'P0001', 'VALIDATION: 区分 sitework には経費を掛けないため', v_out);
  begin
    v_calc := public.pricing_calculate(v_rule, v_tax, jsonb_build_object(
      'rates', jsonb_build_object('sales_fee_rate', '1.07', 'markup_rate', '1.5', 'expense_rate', '0.15'),
      'sections', jsonb_build_array(jsonb_build_object('code', 'option', 'expense_amount', 100.5, 'lines', '[]'::jsonb))));
    v_out := 'calculated';
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  perform pg_temp.exp_expect_error('EXP-3 計算：手動の額は整数円だけ', 'P0001', 'VALIDATION: 経費の手動の額 は', v_out);

  -- ---------- 標準見積（v2.5 の版） ----------
  -- 本体（伸縮脚 18,200 × 12 本）。売価 29,211 × 12 ＝ 350,532、原価 19,474 × 12 ＝ 233,688
  v_bmr := pg_temp.exp_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, '経費検査 本体', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_office));
  perform pg_temp.exp_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, '経費検査 本体', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr));
  perform pg_temp.exp_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr));
  v_se := pg_temp.exp_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr));
  select r.standard_estimate_master_id into v_master from public.standard_estimate_revisions r where r.id::text = v_se;
  v_rev := pg_temp.exp_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master))::uuid;
  v_slot := jsonb_build_object('baseline_key', null, 'variant_choice_ids', '[]'::jsonb, 'quantity', '1', 'price_mode', 'auto',
                               'manual_unit_price', null, 'slot_code', null, 'slot_label', null, 'selectable_option_ids', '[]'::jsonb);
  v_base_payload := jsonb_build_object(
    'rates', jsonb_build_object('sales_fee_rate', '1.07', 'markup_rate', '1.5', 'expense_rate', '0.15'),
    'adjustment', 0, 'adjustment_reason', null,
    'slots', jsonb_build_array(v_slot || jsonb_build_object('option_id', o1)),
    'lines', '[]'::jsonb);

  -- オプションの経費を手動 30,000 円に（設備1 32,100 円。率なら 4,815 円）
  v_out := pg_temp.exp_save_se(u_editor, v_rev, v_base_payload || jsonb_build_object('expenses',
    jsonb_build_object('option', jsonb_build_object('method', 'fixed', 'amount', 30000))));
  perform pg_temp.exp_expect_eq('EXP-4 標準見積：区分の経費を手動の額にできる（オプション 32,100＋手動 30,000。本体は率のまま）',
    'fixed/30000/62100|rate/52579/403111|30000/fixed',
    pg_temp.exp_section(v_rev, 'option') || '|' || pg_temp.exp_section(v_rev, 'base') || '|' ||
    coalesce((select (x.value ->> 'expense') || '/' || (x.value ->> 'expense_method')
                from public.standard_estimate_revisions r, jsonb_array_elements(r.v25_calc_result -> 'calc' -> 'sections') x
               where r.id = v_rev and x.value ->> 'code' = 'option'), v_out));
  perform pg_temp.exp_expect_eq('EXP-5 社内の原価側の経費は、手動の区分も率のまま（設備1 の原価 21,400 × 15% ＝ 3,210）', '21400/3210',
    coalesce((select s.cost_line_subtotal || '/' || s.cost_expense_amount from public.standard_estimate_revision_sections s
               where s.revision_id = v_rev and s.section_code = 'option'), '(none)'));
  -- 明細を変えても（設備2＋大 17,655 円を足す。expenses は送らない）、手動の額は変わらない
  v_out := pg_temp.exp_save_se(u_editor, v_rev, jsonb_set(v_base_payload, '{slots}', jsonb_build_array(
    v_slot || jsonb_build_object('option_id', o1),
    v_slot || jsonb_build_object('option_id', o2, 'variant_choice_ids', jsonb_build_array(c_o2)))));
  perform pg_temp.exp_expect_eq('EXP-6 明細を変えて保存し直しても、手動の額は計算し直さない（49,755＋30,000）', 'fixed/30000/79755',
    pg_temp.exp_section(v_rev, 'option'));
  -- 率に戻すと、率の経費になる
  v_out := pg_temp.exp_save_se(u_editor, v_rev, jsonb_set(v_base_payload, '{slots}', jsonb_build_array(
    v_slot || jsonb_build_object('option_id', o1),
    v_slot || jsonb_build_object('option_id', o2, 'variant_choice_ids', jsonb_build_array(c_o2)))) || jsonb_build_object('expenses',
    jsonb_build_object('option', jsonb_build_object('method', 'rate'))));
  perform pg_temp.exp_expect_eq('EXP-7 「率で計算」に戻すと率の経費（49,755 × 15% ＝ 7,463）', 'rate/7463/57218', pg_temp.exp_section(v_rev, 'option'));
  -- 止める条件
  perform pg_temp.exp_expect_error('EXP-8 経費を掛けない区分（別途工事）は手動にできない', 'P0001', 'VALIDATION: 別途工事 には経費を掛けないため',
    pg_temp.exp_save_se(u_editor, v_rev, v_base_payload || jsonb_build_object('expenses',
      jsonb_build_object('sitework', jsonb_build_object('method', 'fixed', 'amount', 1000)))));
  perform pg_temp.exp_expect_error('EXP-9 手動の額は 0〜100,000,000 円の整数（マイナス・小数・上限超えは止める）', 'P0001', 'VALIDATION: オプションの経費の手動の額は',
    pg_temp.exp_save_se(u_editor, v_rev, v_base_payload || jsonb_build_object('expenses',
      jsonb_build_object('option', jsonb_build_object('method', 'fixed', 'amount', -1)))));
  perform pg_temp.exp_expect_error('EXP-9b 小数の額も止める', 'P0001', 'VALIDATION: オプションの経費の手動の額は',
    pg_temp.exp_save_se(u_editor, v_rev, v_base_payload || jsonb_build_object('expenses',
      jsonb_build_object('option', jsonb_build_object('method', 'fixed', 'amount', 10.5)))));
  perform pg_temp.exp_expect_error('EXP-9c 1 億円を超える額も止める', 'P0001', 'VALIDATION: オプションの経費の手動の額は',
    pg_temp.exp_save_se(u_editor, v_rev, v_base_payload || jsonb_build_object('expenses',
      jsonb_build_object('option', jsonb_build_object('method', 'fixed', 'amount', 100000001)))));
  perform pg_temp.exp_expect_error('EXP-10 決め方は「率で計算」か「金額を手動」だけ（「なし」にはできない）', 'P0001', 'VALIDATION: オプションの経費の決め方は',
    pg_temp.exp_save_se(u_editor, v_rev, v_base_payload || jsonb_build_object('expenses',
      jsonb_build_object('option', jsonb_build_object('method', 'none')))));
  perform pg_temp.exp_expect_eq('EXP-11 止めた保存は何も変えない（オプションは率のまま）', 'rate/7463/57218', pg_temp.exp_section(v_rev, 'option'));
  -- v2.5 の RPC の外からは fixed にできない（v2.5 の版は編集画面から。旧来の版は今と同じく固定額を使えない）
  begin
    update public.standard_estimate_revision_sections set expense_method = 'fixed', expense_rate = null
     where revision_id = v_rev and section_code = 'option';
    v_out := 'updated';
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  perform pg_temp.exp_expect_error('EXP-12 v2.5 の版の区分を、編集の RPC の外から手動にはできない', 'P0001', 'LOCKED', v_out);

  -- 公開する：本体を手動 50,000 円、オプションを手動 30,000 円（設備1 だけ）
  v_out := pg_temp.exp_save_se(u_editor, v_rev, v_base_payload || jsonb_build_object('expenses', jsonb_build_object(
    'base', jsonb_build_object('method', 'fixed', 'amount', 50000),
    'option', jsonb_build_object('method', 'fixed', 'amount', 30000))));
  v_out := pg_temp.exp_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, %s)).status', v_rev,
    (select lock_version from public.standard_estimate_revisions where id = v_rev)));
  -- 本体 350,532＋50,000、オプション 32,100＋30,000。税抜 462,632・税 46,263・税込 508,895。原価 233,688＋35,053＋21,400＋3,210 ＝ 293,351
  perform pg_temp.exp_expect_eq('EXP-13 手動の経費のまま公開できる（税込 508,895 円。原価側の経費は率）',
    'published/462632/46263/508895/293351/fixed/50000/400532/fixed/30000/62100',
    v_out || '/' || coalesce((select r.subtotal || '/' || r.tax || '/' || r.total || '/' || r.cost_total from public.standard_estimate_revisions r where r.id = v_rev), '(none)')
    || '/' || pg_temp.exp_section(v_rev, 'base') || '/' || pg_temp.exp_section(v_rev, 'option'));
  -- 次の下書きは、版の方法と額を写す（再計算でも変わらない）
  v_rev_next := pg_temp.exp_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L)::text', v_master))::uuid;
  perform pg_temp.exp_expect_eq('EXP-14 次の下書きは、公開した版の経費の決め方と手動の額を写す（合計も同じ）',
    'fixed/50000/400532|fixed/30000/62100|rate/0/0|none/0/0|508895',
    pg_temp.exp_section(v_rev_next, 'base') || '|' || pg_temp.exp_section(v_rev_next, 'option') || '|' ||
    pg_temp.exp_section(v_rev_next, 'interior_exterior') || '|' || pg_temp.exp_section(v_rev_next, 'sitework') || '|' ||
    coalesce((select r.total::text from public.standard_estimate_revisions r where r.id = v_rev_next), '(none)'));

  -- ---------- シミュレーターと Web の第 1 版 ----------
  perform pg_temp.exp_expect_eq('EXP-16b 前提：サイトの新価格のスイッチを入れられる（公開中の版はすべて v2.5）', 'true',
    pg_temp.exp_run_as('authenticated', u_admin, 'select public.set_simulator_standard_pricing(true)::text'));
  v_out := pg_temp.exp_run_as('authenticated', u_customer, format(
    $q$ select (public.save_configuration_atomic(
          p_configuration_id => null, p_base_model_id => %L, p_name => '経費検査', p_option_ids => %L::uuid[],
          p_preview_image_url => null, p_notes => null, p_finish_level => 'full', p_variant_choice_ids => %L::uuid[],
          p_spec_code => 'office', p_exterior_faces => '[]'::jsonb, p_expected_lock_version => null::integer)).id::text $q$,
    m_model, array[o1, o2], array[c_o2]));
  v_cfg := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  -- お客様が設備2＋大（17,655 円）を足しても、手動の区分の経費は手動の額のまま
  perform pg_temp.exp_expect_eq('EXP-17 シミュレーターの金額：手動の区分の経費は、商品を変えても手動の額のまま（オプション 49,755＋30,000・税込 528,315 円）',
    '49755/30000/fixed/50000/528315',
    coalesce((select (m.value #>> '{sections,option,line_subtotal}') || '/' || (m.value #>> '{sections,option,expense_amount}') || '/' ||
                     (m.value #>> '{sections,option,expense_method}') || '/' || (m.value #>> '{sections,base,expense_amount}') || '/' || (m.value ->> 'total')
                from (select public.standard_estimate_v25_configuration_money(v_cfg, v_rev) as value) m), v_out));
  v_out := pg_temp.exp_run_as('authenticated', u_customer, format(
    $q$ select (public.create_quote_from_configuration(%L, '{"full_name":"検査"}'::jsonb, null, %s))::text $q$,
    v_cfg, (select lock_version from public.configurations where id = v_cfg)));
  select q.id into v_q1 from public.quotes q join public.quote_requests r on r.id = q.quote_request_id where r.configuration_id = v_cfg;
  set local session_replication_role = replica;
  update public.quotes set dealer_id = u_dealer where id = v_q1;
  set local session_replication_role = origin;
  perform pg_temp.exp_expect_eq('EXP-18 Web の第 1 版：手動の区分の経費の行に率を出さない。合計は版の決め方のまま（税込 528,315 円）',
    '本体諸費用=50000|交通費、労災、安全管理費等 ; オプション諸費用=30000|交通費、労災、安全管理費等/528315',
    pg_temp.exp_quote_expenses(v_q1) || '/' || coalesce((select q.total::text from public.quotes q where q.id = v_q1), v_out));
  perform pg_temp.exp_expect_eq('EXP-19 見積に区分の経費の決め方を残す（第 2 版以降の既定）',
    'fixed/50000|rate|fixed/30000|none',
    coalesce((select (q.v25_expenses #>> '{base,method}') || '/' || (q.v25_expenses #>> '{base,amount}') || '|' ||
                     (q.v25_expenses #>> '{interior_exterior,method}') || '|' ||
                     (q.v25_expenses #>> '{option,method}') || '/' || (q.v25_expenses #>> '{option,amount}') || '|' ||
                     (q.v25_expenses #>> '{sitework,method}')
                from public.quotes q where q.id = v_q1), '(none)'));
  perform pg_temp.exp_expect_error('EXP-20 見積の経費の決め方は、本部でも表の更新では変えられない', 'P0001', 'QUOTE_LINEAGE_IMMUTABLE',
    pg_temp.exp_run_as('authenticated', u_admin, format('update public.quotes set v25_expenses = null where id = %L returning id::text', v_q1)));

  -- ---------- Web の第 2 版以降 ----------
  v_out := pg_temp.exp_run_as('authenticated', u_dealer, format('select public.get_quote_v25_context(%L)::text', v_q1));
  v_ctx := case when v_out like '{%' then v_out::jsonb else jsonb_build_object('error', v_out) end;
  perform pg_temp.exp_expect_eq('EXP-21 編集画面に、この見積の経費の決め方を渡す（原価・販売費率・掛率は渡さない）',
    'fixed/50000|fixed/30000|rate|false',
    (v_ctx #>> '{expenses,base,method}') || '/' || (v_ctx #>> '{expenses,base,amount}') || '|' ||
    (v_ctx #>> '{expenses,option,method}') || '/' || (v_ctx #>> '{expenses,option,amount}') || '|' ||
    (v_ctx #>> '{expenses,interior_exterior,method}') || '|' ||
    (v_ctx ? 'sales_fee_rate' or v_ctx ? 'markup_rate' or v_ctx::text like '%cost%')::text);
  -- 何も指定しないと前の版の決め方を引き継ぐ（明細を足しても手動の額のまま）
  v_out := pg_temp.exp_revise(u_dealer, v_q1, pg_temp.exp_parent_lines(v_q1, jsonb_build_array(
    jsonb_build_object('source', 'manual', 'section', 'option', 'name', '追加工事', 'unit', '式', 'quantity', '1', 'unit_price', 20000))));
  v_q2 := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.exp_expect_eq('EXP-22 第 2 版：指定が無ければ前の版の決め方（手動の額）を引き継ぐ（明細を足しても 30,000 円のまま）',
    '本体諸費用=50000|交通費、労災、安全管理費等 ; オプション諸費用=30000|交通費、労災、安全管理費等/fixed/30000',
    pg_temp.exp_quote_expenses(v_q2) || '/' ||
    coalesce((select (q.v25_expenses #>> '{option,method}') || '/' || (q.v25_expenses #>> '{option,amount}') from public.quotes q where q.id = v_q2), v_out));
  -- 明細の「経費」で率に戻す：オプション 49,755＋20,000 ＝ 69,755 × 15% ＝ 10,463
  v_out := pg_temp.exp_revise(u_dealer, v_q2, pg_temp.exp_parent_lines(v_q2, jsonb_build_array(
    jsonb_build_object('source', 'expense', 'section', 'option', 'method', 'rate'))));
  v_q3 := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.exp_expect_eq('EXP-23 第 3 版：「率で計算」に戻すと率の経費（69,755 × 15% ＝ 10,463。率を説明に出す）',
    '本体諸費用=50000|交通費、労災、安全管理費等 ; オプション諸費用=10463|交通費、労災、安全管理費等（15%）/rate',
    pg_temp.exp_quote_expenses(v_q3) || '/' || coalesce((select q.v25_expenses #>> '{option,method}' from public.quotes q where q.id = v_q3), v_out));
  -- 担当の代理店は、本体諸費用の決め方を変えられない（本体の行と同じ）
  perform pg_temp.exp_expect_error('EXP-24 代理店は本体諸費用の決め方を変えられない（本部・総代理店だけ）', 'P0001', 'VALIDATION: 1 行目：本体諸費用の決め方は',
    pg_temp.exp_revise(u_dealer, v_q3, jsonb_build_array(jsonb_build_object('source', 'expense', 'section', 'base', 'method', 'rate'))
      || pg_temp.exp_parent_lines(v_q3)));
  perform pg_temp.exp_expect_error('EXP-25 経費を掛けない区分（別途工事）は指定できない', 'P0001', 'VALIDATION: 1 行目：経費を掛ける区分',
    pg_temp.exp_revise(u_dealer, v_q3, jsonb_build_array(jsonb_build_object('source', 'expense', 'section', 'sitework', 'method', 'fixed', 'amount', 1000))
      || pg_temp.exp_parent_lines(v_q3)));
  perform pg_temp.exp_expect_error('EXP-26 同じ区分の指定の重複は止める', 'P0001', 'VALIDATION: 2 行目：同じ区分の経費の決め方が重複',
    pg_temp.exp_revise(u_dealer, v_q3, jsonb_build_array(
      jsonb_build_object('source', 'expense', 'section', 'option', 'method', 'rate'),
      jsonb_build_object('source', 'expense', 'section', 'option', 'method', 'fixed', 'amount', 1000)) || pg_temp.exp_parent_lines(v_q3)));
  perform pg_temp.exp_expect_error('EXP-27 手動の額はマイナスにできない', 'P0001', 'VALIDATION: 1 行目：経費の手動の額は',
    pg_temp.exp_revise(u_dealer, v_q3, jsonb_build_array(jsonb_build_object('source', 'expense', 'section', 'option', 'method', 'fixed', 'amount', -1))
      || pg_temp.exp_parent_lines(v_q3)));
  perform pg_temp.exp_expect_error('EXP-28 決め方は「率で計算」か「金額を手動」だけ', 'P0001', 'VALIDATION: 1 行目：経費の決め方は',
    pg_temp.exp_revise(u_dealer, v_q3, jsonb_build_array(jsonb_build_object('source', 'expense', 'section', 'option', 'method', 'none'))
      || pg_temp.exp_parent_lines(v_q3)));
  -- 明細は 300 行まで。経費の決め方は明細に数えない（300 行の明細と経費の決め方を一緒に送れる）
  perform pg_temp.exp_expect_error('EXP-44 明細が 301 行なら止める', 'P0001', 'VALIDATION: 明細は 300 行までです',
    pg_temp.exp_revise(u_dealer, v_q3, (select jsonb_agg(jsonb_build_object('source', 'manual')) from generate_series(1, 301))));
  v_out := pg_temp.exp_revise(u_dealer, v_q3, (select jsonb_agg(jsonb_build_object('source', 'manual')) from generate_series(1, 300))
    || jsonb_build_array(jsonb_build_object('source', 'expense', 'section', 'option', 'method', 'rate')));
  perform pg_temp.exp_expect_eq('EXP-45 明細 300 行＋経費の決め方 1 つは、行数の上限で止めない（後の行の検査へ進む）', 'true',
    (v_out like 'ERROR P0001:%' and v_out not like '%明細は 300 行まで%')::text || case when v_out like 'ERROR P0001:%' then '' else ' ' || v_out end);
  -- 本部は本体諸費用も変えられる：本体を率に、オプションを手動 12,345 円に
  v_out := pg_temp.exp_revise(u_admin, v_q3, pg_temp.exp_parent_lines(v_q3, jsonb_build_array(
    jsonb_build_object('source', 'expense', 'section', 'base', 'method', 'rate'),
    jsonb_build_object('source', 'expense', 'section', 'option', 'method', 'fixed', 'amount', 12345))));
  v_q4 := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  -- 本体 350,532 × 15% ＝ 52,579。税抜 350,532＋52,579＋69,755＋12,345 ＝ 485,211・税 48,521・税込 533,732
  perform pg_temp.exp_expect_eq('EXP-29 本部：本体諸費用を率に、オプションを手動 12,345 円にできる（税込 533,732 円）',
    '本体諸費用=52579|交通費、労災、安全管理費等（15%） ; オプション諸費用=12345|交通費、労災、安全管理費等/533732',
    pg_temp.exp_quote_expenses(v_q4) || '/' || coalesce((select q.total::text from public.quotes q where q.id = v_q4), v_out));

  perform pg_temp.exp_run_as('authenticated', u_admin, 'select public.set_simulator_standard_pricing(false)::text');

  -- v2.5 以前の下書きを v2.5 に切り替えるとき、v2.5 以前の固定額（10/13 より前のデータ）は引き継がない
  v_bmr2 := pg_temp.exp_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, '経費検査 本体 2', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_hotel));
  perform pg_temp.exp_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, '経費検査 本体 2', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr2));
  perform pg_temp.exp_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr2));
  v_legacy := pg_temp.exp_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr2));
  begin
    update public.standard_estimate_revision_sections set expense_method = 'fixed', expense_rate = null
     where revision_id::text = v_legacy and section_code = 'option';
    v_out := 'updated';
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  perform pg_temp.exp_expect_error('EXP-15 旧来の版は、今と同じく固定額の経費を新しく使えない', 'P0001', 'VALIDATION: 経費の計算方法は「率」か「なし」', v_out);
  set local session_replication_role = replica;
  update public.standard_estimate_revision_sections set expense_method = 'fixed', expense_rate = null, expense_amount = 9999, total = line_subtotal + 9999
   where revision_id::text = v_legacy and section_code = 'option';
  set local session_replication_role = origin;
  v_out := pg_temp.exp_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, %s)::text',
    (select r.standard_estimate_master_id from public.standard_estimate_revisions r where r.id::text = v_legacy),
    (select r.lock_version from public.standard_estimate_revisions r where r.id::text = v_legacy)));
  perform pg_temp.exp_expect_eq('EXP-16 v2.5 以前の下書きの固定額は、v2.5 に切り替えると率になる（今までどおり）', 'v2.5/rate/0',
    coalesce((select r.pricing_model from public.standard_estimate_revisions r where r.id::text = v_legacy), v_out) || '/' ||
    coalesce((select s.expense_method || '/' || s.expense_amount from public.standard_estimate_revision_sections s
               where s.revision_id::text = v_legacy and s.section_code = 'option'), '(none)'));


  -- ---------- Web 以外の案件の下書き（v2.5 の版から作る） ----------
  v_out := pg_temp.exp_run_as('authenticated', u_admin,
    format($q$ select public.create_standard_quote_case('経費検査 案件', '{"full_name":"検査 花子"}'::jsonb, '電話で受付', %L)::text $q$, v_rev));
  v_draft := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.exp_expect_eq('EXP-30 下書きは版の経費の決め方と手動の額を写す（合計は版と同じ 508,895 円）',
    '{"base": "fixed", "option": "fixed", "sitework": "none", "interior_exterior": "rate"}/{"base": 50000, "option": 30000}/508895',
    coalesce((select n.expense_methods::text || '/' || n.expense_amounts::text from public.quote_draft_internals n where n.draft_id = v_draft), v_out)
    || '/' || coalesce((select d.total::text from public.quote_drafts d where d.id = v_draft), '(none)'));
  perform pg_temp.exp_expect_eq('EXP-31 下書きの経費の行：売価は手動の額で率を出さない、原価は率（本体 35,053・オプション 3,210）',
    '本体諸費用=50000/35053|交通費、労災、安全管理費等 ; オプション諸費用=30000/3210|交通費、労災、安全管理費等',
    pg_temp.exp_draft_expenses(v_draft));
  -- 経費の決め方は変えられる（オプションを率に：32,100 × 15% ＝ 4,815）
  v_out := pg_temp.exp_save_draft(u_admin, v_draft, '{"base":"fixed","interior_exterior":"rate","option":"rate","sitework":"none","amounts":{"base":50000}}'::jsonb);
  perform pg_temp.exp_expect_eq('EXP-32 下書きの経費の決め方は変えられる（オプションを率に：4,815 円。率を説明に出す）',
    '本体諸費用=50000/35053|交通費、労災、安全管理費等 ; オプション諸費用=4815/3210|交通費、労災、安全管理費等（15%）',
    pg_temp.exp_draft_expenses(v_draft));
  v_out := pg_temp.exp_save_draft(u_admin, v_draft, '{"base":"fixed","interior_exterior":"rate","option":"fixed","sitework":"none","amounts":{"base":50000,"option":40000}}'::jsonb);
  perform pg_temp.exp_expect_eq('EXP-33 オプションを手動 40,000 円に（税込 = (350,532＋50,000＋32,100＋40,000) × 1.1 の切り捨て）',
    '472632/47263/519895/{"base": 50000, "option": 40000}',
    coalesce((select d.subtotal || '/' || d.tax || '/' || d.total from public.quote_drafts d where d.id = v_draft), v_out) || '/' ||
    coalesce((select n.expense_amounts::text from public.quote_draft_internals n where n.draft_id = v_draft), '(none)'));
  perform pg_temp.exp_expect_error('EXP-34 版の率（掛率）は今と同じく変えられない', 'P0001', 'VALIDATION: v2.5 の標準見積から作った見積は、版の率',
    pg_temp.exp_save_draft(u_admin, v_draft, '{"base":"fixed","interior_exterior":"rate","option":"fixed","sitework":"none","amounts":{"base":50000,"option":40000}}'::jsonb, 1.6));
  perform pg_temp.exp_expect_error('EXP-35 経費を掛ける区分は「なし」にできない', 'P0001', 'VALIDATION: v2.5 の標準見積から作った見積は、版の率',
    pg_temp.exp_save_draft(u_admin, v_draft, '{"base":"fixed","interior_exterior":"rate","option":"none","sitework":"none","amounts":{"base":50000}}'::jsonb));
  perform pg_temp.exp_expect_error('EXP-36 手動の区分の額が無ければ止める', 'P0001', 'VALIDATION: オプションの経費の手動の額',
    pg_temp.exp_save_draft(u_admin, v_draft, '{"base":"fixed","interior_exterior":"rate","option":"fixed","sitework":"none","amounts":{"base":50000}}'::jsonb));
  perform pg_temp.exp_expect_error('EXP-37 別途工事は手動にできない（経費なしのまま）', 'P0001', 'VALIDATION: v2.5 の標準見積から作った見積は、版の率',
    pg_temp.exp_save_draft(u_admin, v_draft, '{"base":"fixed","interior_exterior":"rate","option":"fixed","sitework":"fixed","amounts":{"base":50000,"option":40000,"sitework":1}}'::jsonb));
  v_out := pg_temp.exp_run_as('authenticated', u_admin, format('select public.finalize_quote_draft(%L, %s)::text', v_draft,
    (select lock_version from public.quote_drafts where id = v_draft)));
  v_quote := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.exp_expect_eq('EXP-38 発行の記録に手動の額を残す（見積は Web 以外の仕組みのまま）', '519895/{"base": 50000, "option": 40000}',
    coalesce((select q.total::text from public.quotes q where q.id = v_quote), v_out) || '/' ||
    coalesce((select s.expense_amounts::text from public.quote_internal_snapshots s where s.quote_id = v_quote), '(no snapshot)'));
  v_out := pg_temp.exp_run_as('authenticated', u_admin, format('select public.create_quote_revision_draft(%L)::text', v_quote));
  v_rdraft := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.exp_expect_eq('EXP-39 改訂の下書きは、発行した版の経費の決め方と手動の額を引き継ぐ',
    '{"base": "fixed", "option": "fixed", "sitework": "none", "interior_exterior": "rate"}/{"base": 50000, "option": 40000}',
    coalesce((select n.expense_methods::text || '/' || n.expense_amounts::text from public.quote_draft_internals n where n.draft_id = v_rdraft), v_out));

  -- 旧来の標準見積（v2.5 でない版）から作った下書きは、今と同じく固定額を使えない
  v_bmr3 := pg_temp.exp_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, '経費検査 本体 3', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_residence));
  perform pg_temp.exp_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, '経費検査 本体 3', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr3));
  perform pg_temp.exp_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr3));
  v_legacy2 := pg_temp.exp_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr3));
  v_out := pg_temp.exp_run_as('authenticated', u_editor, format('select public.publish_standard_estimate_revision(%L, %s)::text',
    v_legacy2, (select r.lock_version from public.standard_estimate_revisions r where r.id::text = v_legacy2)));
  v_out := pg_temp.exp_run_as('authenticated', u_admin,
    format($q$ select public.create_standard_quote_case('経費検査 旧来', '{"full_name":"検査 次郎"}'::jsonb, null, %L)::text $q$, v_legacy2));
  v_legacy_draft := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.exp_expect_eq('EXP-40 前提：旧来の標準見積の公開版から下書きを作れる（率／なしのまま）', 'legacy/{}',
    coalesce((select r.pricing_model from public.standard_estimate_revisions r where r.id::text = v_legacy2), '(none)') || '/' ||
    coalesce((select n.expense_amounts::text from public.quote_draft_internals n where n.draft_id = v_legacy_draft), v_out));
  perform pg_temp.exp_expect_error('EXP-41 旧来の標準見積から作った下書きは、今と同じく固定額を使えない', 'P0001', 'VALIDATION: 経費の計算方法は「率」か「なし」',
    pg_temp.exp_save_draft(u_admin, v_legacy_draft, '{"base":"rate","interior_exterior":"rate","option":"fixed","sitework":"none","amounts":{"option":1000}}'::jsonb));

  perform pg_temp.exp_expect_eq('EXP-42 権限：内部の部品は API のロールから実行できない', 'false/false/false/false/false',
    has_function_privilege('authenticated', 'public.quote_expense_amounts_valid(jsonb, jsonb)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.standard_estimate_v25_expense_settings(uuid)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.quote_v25_default_expenses(text[])', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.quote_v25_expense_description(text, text)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.quotes_v25_expenses_guard()', 'EXECUTE')::text);
  -- check 制約の関数は書き込むロールの実行権限で動く。表に書ける service_role の書き込みでも、手動の額の検査が動く
  perform pg_temp.exp_expect_eq('EXP-43 権限：手動の額の check 制約は service_role の書き込みでも動く（検査の関数を実行できる。anon はできない）', 'ok/true/false',
    pg_temp.exp_run_as('service_role', null,
      format($q$ update public.quote_draft_internals set expense_amounts = expense_amounts where draft_id = %L returning 'ok' $q$, v_rdraft))
    || '/' || has_function_privilege('service_role', 'public.quote_expense_amounts_valid(jsonb, jsonb)', 'EXECUTE')::text
    || '/' || has_function_privilege('anon', 'public.quote_expense_amounts_valid(jsonb, jsonb)', 'EXECUTE')::text);
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _exp_result;

rollback;
