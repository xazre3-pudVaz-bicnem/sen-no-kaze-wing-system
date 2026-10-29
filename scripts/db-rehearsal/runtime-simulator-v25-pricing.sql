-- v2.5 PR-C1：シミュレーター・保存した仕様・見積依頼の v2.5 の売価の実行時検査。使い捨てDB専用。最後に rollback する。
begin;

create temp table _svp_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _svp_result to public;

create function pg_temp.svp_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.svp_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _svp_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.svp_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _svp_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

create function pg_temp.svp_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _svp_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || ':%');
$fn$;

do $test$
declare
  u_admin constant uuid := '29000000-0000-4000-8000-000000000001';
  u_editor constant uuid := '29000000-0000-4000-8000-000000000002';
  u_customer constant uuid := '29000000-0000-4000-8000-000000000003';
  org_hq constant uuid := '29000000-0000-4000-8000-000000000101';
  m_model constant uuid := '29000000-0000-4000-8000-000000000201';
  mr_office constant uuid := '29000000-0000-4000-8000-000000000301';
  mr_hotel constant uuid := '29000000-0000-4000-8000-000000000302';
  cat_opt constant uuid := '29000000-0000-4000-8000-000000000401';
  p1 constant uuid := '29000000-0000-4000-8000-000000000501';
  p2 constant uuid := '29000000-0000-4000-8000-000000000502';
  p3 constant uuid := '29000000-0000-4000-8000-000000000503';
  p4 constant uuid := '29000000-0000-4000-8000-000000000504';
  p5 constant uuid := '29000000-0000-4000-8000-000000000505';
  g1 constant uuid := '29000000-0000-4000-8000-000000000601';
  c1 constant uuid := '29000000-0000-4000-8000-000000000701';
  c2 constant uuid := '29000000-0000-4000-8000-000000000702';
  cfg_same constant uuid := '29000000-0000-4000-8000-000000000801';
  cfg_changed constant uuid := '29000000-0000-4000-8000-000000000802';
  cfg_por constant uuid := '29000000-0000-4000-8000-000000000803';
  cfg_nose constant uuid := '29000000-0000-4000-8000-000000000804';
  q_same constant uuid := '29000000-0000-4000-8000-000000000901';
  q_nose constant uuid := '29000000-0000-4000-8000-000000000902';
  v_bmr text;
  v_bmr_hotel text;
  v_se text;
  v_master uuid;
  v_master_hotel uuid;
  v_rev uuid;
  v_out text;
  v_views jsonb;
  v_view jsonb;
  v_money jsonb;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'svp-admin@runtime.invalid', '{}'::jsonb), (u_editor, 'svp-editor@runtime.invalid', '{}'::jsonb),
         (u_customer, 'svp-customer@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'svp-admin@runtime.invalid', 'global admin', 'admin'),
         (u_editor, 'svp-editor@runtime.invalid', 'HQ editor', 'customer'),
         (u_customer, 'svp-customer@runtime.invalid', 'customer', 'customer');
  insert into public.organizations (id, code, name, organization_type, status)
  values (org_hq, 'runtime-svp-hq', 'C1 Runtime HQ', 'headquarters', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values (org_hq, u_editor, 'editor', 'active');
  insert into public.base_models (id, slug, name, base_price, status)
  values (m_model, 'runtime-svp-model', 'C1 検査モデル', 1000000, 'published');
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_office, m_model, 'office', '2100x4550', false), (mr_hotel, m_model, 'hotel', '3640x4550', false);
  -- 本体分類表に対応の無いカテゴリーは、どの仕様でもお客様が選べる（区分は「オプション」）
  insert into public.option_categories (id, code, name, status) values (cat_opt, 'runtime-svp-category', 'C1 検査', 'published');
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation)
  values
    (p1, cat_opt, 'runtime-svp-p1', 'C1 商品1（選択肢あり）', 100000, false, 'published', 'PRD-929001', false),
    (p2, cat_opt, 'runtime-svp-p2', 'C1 商品2', 20000, false, 'published', 'PRD-929002', false),
    (p3, cat_opt, 'runtime-svp-p3', 'C1 商品3（原価未設定）', 50000, false, 'published', 'PRD-929003', false),
    (p4, cat_opt, 'runtime-svp-p4', 'C1 施工4（別途工事）', 15000, false, 'published', 'PRD-929004', true),
    (p5, cat_opt, 'runtime-svp-p5', 'C1 商品5（別途見積）', 0, true, 'published', 'PRD-929005', false);
  insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
  values (g1, p1, 'size', 'サイズ', 1, true, 'published');
  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status, sort_order)
  values (c1, g1, 'standard', '標準', 'standard', 0, 'published', 1), (c2, g1, 'large', '大', 'option', 5000, 'published', 2);
  set local session_replication_role = origin;

  -- 原価の Version（本部）
  perform pg_temp.svp_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 100000, 0, ''検査'')', p1));
  perform pg_temp.svp_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 20000, 0, ''検査'')', p2));
  perform pg_temp.svp_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 15000, 0, ''検査'')', p4));
  perform pg_temp.svp_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 0, null, ''検査'')', c1));
  perform pg_temp.svp_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 5000, null, ''検査'')', c2));

  -- 本体（基準原価 18,200 円 × 12 本）を公開し、標準見積（事務所用）を v2.5 で作って公開する
  v_bmr := pg_temp.svp_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, 'C1 本体', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_office));
  perform pg_temp.svp_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, 'C1 本体', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr));
  perform pg_temp.svp_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr));
  v_se := pg_temp.svp_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr));
  select r.standard_estimate_master_id into v_master from public.standard_estimate_revisions r where r.id::text = v_se;
  v_out := pg_temp.svp_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master));
  v_rev := v_out::uuid;
  perform pg_temp.svp_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
    jsonb_build_object(
      'rates', jsonb_build_object('sales_fee_rate', '1.07', 'markup_rate', '1.5', 'expense_rate', '0.15'),
      'adjustment', 0, 'adjustment_reason', null,
      'slots', jsonb_build_array(
        jsonb_build_object('baseline_key', null, 'option_id', p1, 'variant_choice_ids', jsonb_build_array(c1), 'quantity', '1', 'price_mode', 'auto', 'manual_unit_price', null),
        jsonb_build_object('baseline_key', null, 'option_id', p2, 'variant_choice_ids', '[]'::jsonb, 'quantity', '2', 'price_mode', 'auto', 'manual_unit_price', null)),
      'lines', jsonb_build_array(
        jsonb_build_object('line_key', null, 'section_code', 'sitework', 'group_label', null, 'name', '設置工事', 'quantity', '1', 'unit', '式',
                           'price_mode', 'manual', 'unit_price', 50000, 'remark', null, 'review_required', false)))::text));
  v_out := pg_temp.svp_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 3)).status', v_rev));
  perform pg_temp.svp_expect_eq('前提：v2.5 の標準見積（事務所用）を公開できた（税込 782,667 円）', 'published/782667',
    v_out || '/' || (select total::text from public.standard_estimate_revisions where id = v_rev));

  -- ---------- シミュレーターの売価（売価だけ・service_role だけ） ----------
  perform pg_temp.svp_expect_denied('ログインしていない人はシミュレーターの売価を直接読めない', '42501',
    pg_temp.svp_run_as('anon', null, format('select public.get_simulator_v25_sale_views(%L)::text', m_model)));
  perform pg_temp.svp_expect_denied('ログインした人も直接は読めない（ページのサーバーだけ）', '42501',
    pg_temp.svp_run_as('authenticated', u_customer, format('select public.get_simulator_v25_sale_views(%L)::text', m_model)));
  v_out := pg_temp.svp_run_as('service_role', null, format('select public.get_simulator_v25_sale_views(%L)::text', m_model));
  v_views := v_out::jsonb;
  v_view := v_views -> 0;
  perform pg_temp.svp_expect_eq('公開中の v2.5 の版を 1 件、売価だけの形で返す', '1/v2.5/office/782667',
    jsonb_array_length(v_views)::text || '/' || (v_view ->> 'pricing_model') || '/' || (v_view ->> 'spec_code') || '/' || (v_view ->> 'total'));
  perform pg_temp.svp_expect_eq('原価・率・原価の Version は返さない', 'false',
    (v_out like '%standard_cost%' or v_out like '%cost_unit_price%' or v_out like '%selection_cost%'
     or v_out like '%sales_fee_rate%' or v_out like '%markup_rate%' or v_out like '%cost_version%' or v_out like '%cost_adjustment%')::text);
  perform pg_temp.svp_expect_eq('本体の明細は売価（18,200 円 × 1.07 × 1.5 → 29,211 円 × 12 本）', '29211/350532',
    (v_view #>> '{base_lines,0,unit_price}') || '/' || (v_view #>> '{base_lines,0,amount}'));
  perform pg_temp.svp_expect_eq('選択肢の組み合わせごとの売価（選ばない・標準・大）', '160500/160500/168525',
    (v_view #>> array['prices', p1::text, 'units', '-']) || '/' || (v_view #>> array['prices', p1::text, 'units', '0']) || '/' ||
    (v_view #>> array['prices', p1::text, 'units', '1']));
  perform pg_temp.svp_expect_eq('組み合わせの表の選択肢の順は、選択項目の表示順', jsonb_build_array(jsonb_build_array(c1, c2))::text,
    (v_view #> array['prices', p1::text, 'groups'])::text);
  perform pg_temp.svp_expect_eq('原価未設定・別途工事・別途見積の商品は価格未確定（por）', 'true/true/true',
    (v_view #>> array['prices', p3::text, 'por']) || '/' || (v_view #>> array['prices', p4::text, 'por']) || '/' || (v_view #>> array['prices', p5::text, 'por']));
  perform pg_temp.svp_expect_eq('差額の基準（版の選択枠）は公開した版の売価', '160500/32100',
    (select string_agg(x.value ->> 'unit_price', '/' order by x.ordinality) from jsonb_array_elements(v_view -> 'baseline') with ordinality as x(value, ordinality)));

  -- ---------- 商品の売価単価：版の選択枠と同じなら固定した原価、それ以外は今の原価 ----------
  perform pg_temp.svp_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 110000, %s, ''原価の改定'')', p1,
    (select lock_version from public.option_hq_standard_costs where option_id = p1)));
  perform pg_temp.svp_expect_eq('原価を改定しても、版の選択枠と同じ「商品＋選択肢」は公開した版の売価のまま', '160500',
    coalesce(public.standard_estimate_v25_selection_unit(v_rev, p1, array[c1])::text, 'null'));
  perform pg_temp.svp_expect_eq('選択肢を変えた商品は、今の原価（110,000＋5,000）と版の率で計算する', '184575',
    coalesce(public.standard_estimate_v25_selection_unit(v_rev, p1, array[c2])::text, 'null'));
  perform pg_temp.svp_expect_eq('原価未設定・別途工事・別途見積は未確定（null）', 'null/null/null',
    coalesce(public.standard_estimate_v25_selection_unit(v_rev, p3, '{}')::text, 'null') || '/' ||
    coalesce(public.standard_estimate_v25_selection_unit(v_rev, p4, '{}')::text, 'null') || '/' ||
    coalesce(public.standard_estimate_v25_selection_unit(v_rev, p5, '{}')::text, 'null'));
  perform pg_temp.svp_expect_eq('ほかの商品の選択肢を混ぜた選び方は未確定', 'null',
    coalesce(public.standard_estimate_v25_selection_unit(v_rev, p2, array[c2])::text, 'null'));

  -- ---------- 保存した仕様の金額 ----------
  set local session_replication_role = replica;
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (cfg_same, u_customer, m_model, '標準のまま', 'draft', 'office', 'full'),
         (cfg_changed, u_customer, m_model, '選択肢を変えた', 'draft', 'office', 'full'),
         (cfg_por, u_customer, m_model, '未確定の商品を含む', 'draft', 'office', 'full'),
         (cfg_nose, u_customer, m_model, '標準見積の無い仕様', 'draft', 'hotel', 'full');
  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  values (cfg_same, p1, 1, array[c1]), (cfg_same, p2, 2, '{}'),
         (cfg_changed, p1, 1, array[c2]), (cfg_changed, p2, 2, '{}'),
         (cfg_por, p1, 1, array[c1]), (cfg_por, p2, 2, '{}'), (cfg_por, p3, 1, '{}'),
         (cfg_nose, p2, 1, '{}');
  set local session_replication_role = origin;

  v_money := public.standard_estimate_v25_configuration_money(cfg_same, v_rev);
  perform pg_temp.svp_expect_eq('標準のままの仕様は、公開した版の合計と同じ（差額 0）', '782667/0/false',
    (v_money ->> 'total') || '/' || (v_money #>> '{sections,option,delta_line}') || '/' || (v_money ->> 'has_por'));
  v_money := public.standard_estimate_v25_configuration_money(cfg_changed, v_rev);
  -- オプション：224,700 ＋（184,575 − 160,500）＝ 248,775、経費 trunc(248,775 × 0.15) ＝ 37,316
  perform pg_temp.svp_expect_eq('選択肢を変えた仕様は、差額と区分の経費を計算し直す', '24075/248775/37316',
    (v_money #>> '{sections,option,delta_line}') || '/' || (v_money #>> '{sections,option,line_subtotal}') || '/' || (v_money #>> '{sections,option,expense_amount}'));
  perform pg_temp.svp_expect_eq('税抜・税・税込（本体と別途工事は版のまま）', '739202/73920/813122',
    (v_money ->> 'subtotal') || '/' || (v_money ->> 'tax') || '/' || (v_money ->> 'total'));
  v_money := public.standard_estimate_v25_configuration_money(cfg_por, v_rev);
  perform pg_temp.svp_expect_eq('価格未確定の商品は 0 円として合計し、未確定の印を付ける', '782667/true',
    (v_money ->> 'total') || '/' || (v_money ->> 'has_por'));

  -- ---------- スイッチ：切れている間はこれまでの計算・入れる前に v2.5 の版がそろっているか確かめる ----------
  perform pg_temp.svp_expect_eq('スイッチが切れている間は、これまでの計算のまま（DB の入口は使わない）', 'false/(null)',
    public.apply_standard_estimate_to_configuration(cfg_same)::text || '/' ||
    coalesce(public.standard_estimate_sale_view_for_configuration(cfg_same)::text, '(null)'));
  -- v2.5 以前の版だけの標準見積があると、スイッチを入れられない
  v_bmr_hotel := pg_temp.svp_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, 'C1 本体（ホテル）', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_hotel));
  perform pg_temp.svp_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, 'C1 本体（ホテル）', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr_hotel));
  perform pg_temp.svp_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr_hotel));
  v_out := pg_temp.svp_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr_hotel));
  select r.standard_estimate_master_id into v_master_hotel from public.standard_estimate_revisions r where r.id::text = v_out;
  perform pg_temp.svp_expect_denied('本部以外はスイッチを入れられない', '42501',
    pg_temp.svp_run_as('authenticated', u_customer, 'select public.set_simulator_standard_pricing(true)::text'));
  perform pg_temp.svp_expect_error('公開中の版が v2.5 でない標準見積があると、スイッチを入れられない', 'P0001', 'VALIDATION',
    pg_temp.svp_run_as('authenticated', u_admin, 'select public.set_simulator_standard_pricing(true)::text'));
  set local session_replication_role = replica;
  update public.standard_estimate_masters set status = 'archived' where id = v_master_hotel;
  set local session_replication_role = origin;
  perform pg_temp.svp_expect_eq('有効な標準見積がすべて v2.5 なら、本部はスイッチを入れられる', 'true',
    pg_temp.svp_run_as('authenticated', u_admin, 'select public.set_simulator_standard_pricing(true)::text'));

  -- ---------- スイッチが入っている間：保存した仕様と見積依頼の明細 ----------
  -- 関数の実行と結果の読み取りは別の文にする（同じ文の中の副問い合わせは、関数より前の時点で読まれる）
  v_out := public.apply_standard_estimate_to_configuration(cfg_same)::text;
  perform pg_temp.svp_expect_eq('保存した仕様は v2.5 の版で計算する（合計は版と同じ）', 'true/782667',
    v_out || '/' || (select total::text from public.configurations where id = cfg_same));
  perform pg_temp.svp_expect_eq('見積依頼の税率・備考に使う入口は v2.5 の版を返す', 'v2.5/0.100000',
    (public.standard_estimate_sale_view_for_configuration(cfg_same) ->> 'pricing_model') || '/' ||
    (public.standard_estimate_sale_view_for_configuration(cfg_same) ->> 'tax_rate'));
  v_out := public.apply_standard_estimate_to_configuration(cfg_changed)::text;
  perform pg_temp.svp_expect_eq('選択肢を変えた仕様の保存額', 'true/813122',
    v_out || '/' || (select total::text from public.configurations where id = cfg_changed));
  -- 前提：v2.5 の版が無い仕様の保存額を、先に 0 円でない値にしておく（0 円にしたことを確かめるため）
  set local session_replication_role = replica;
  update public.configurations set base_price = 1234, total = 5678 where id = cfg_nose;
  set local session_replication_role = origin;
  v_out := public.apply_standard_estimate_to_configuration(cfg_nose)::text;
  perform pg_temp.svp_expect_eq('v2.5 の版が無い仕様は、商品価格の列（原価）で計算せず、金額を未確定（0 円）にする', 'true/0/0',
    v_out || '/' || (select base_price::text from public.configurations where id = cfg_nose)
    || '/' || (select total::text from public.configurations where id = cfg_nose));

  set local session_replication_role = replica;
  insert into public.quote_requests (id, configuration_id, user_id, quote_id, status)
  values (q_same, cfg_same, u_customer, q_same, 'new'), (q_nose, cfg_nose, u_customer, q_nose, 'new');
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, status, valid_until, customer_name, base_model_name,
                             base_price, option_subtotal, installation_subtotal, subtotal, tax_rate, tax, total)
  values (q_same, 'RT-C1-1', q_same, cfg_same, u_customer, 'issued', now() + interval '30 days', '顧客', 'C1 検査モデル', 0, 0, 0, 0, 0.10, 0, 0),
         (q_nose, 'RT-C1-2', q_nose, cfg_nose, u_customer, 'issued', now() + interval '30 days', '顧客', 'C1 検査モデル', 0, 0, 0, 0, 0.10, 0, 0);
  set local session_replication_role = origin;
  v_out := public.write_standard_estimate_quote_items(cfg_same, q_same)::text;
  perform pg_temp.svp_expect_eq('見積依頼の明細は v2.5 の版の売価（明細の合計は税抜と同じ・本体・選択枠・明細・経費）', 'true/711516/1',
    v_out || '/' ||
    (select sum(amount)::text from public.quote_items where quote_id = q_same) || '/' ||
    (select count(*)::text from public.quote_items where quote_id = q_same and kind = 'base'));
  v_out := public.write_standard_estimate_quote_items(cfg_nose, q_nose)::text;
  perform pg_temp.svp_expect_eq('v2.5 の版が無い仕様の見積は、別途お見積りの 1 行（0 円）', 'true/1/0/価格未確定（別途お見積り）',
    v_out || '/' ||
    (select count(*)::text from public.quote_items where quote_id = q_nose) || '/' ||
    (select sum(amount)::text from public.quote_items where quote_id = q_nose) || '/' ||
    (select remark from public.quote_items where quote_id = q_nose limit 1));
  perform pg_temp.svp_expect_eq('見積の明細に原価は書かない（売価の明細だけ）', '0',
    (select count(*)::text from public.quote_items where quote_id = q_same and unit_price in (100000, 20000, 18200)));
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _svp_result;

rollback;
