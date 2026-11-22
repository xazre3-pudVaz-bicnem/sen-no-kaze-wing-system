-- 標準見積 v2.5：商品行と手入力明細の混在の並び順と、商品行の工事項目の保存（20261110140000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 同じ区分（オプション）に商品 2 行（屋根・設備）と手入力明細 2 行を混ぜて並べ、保存と読み込み・見積書の明細の順と摘要・
-- Web 以外の下書きの行・並べ替えで金額が変わらないこと・決まり（全部か省略・重なり・範囲・長さ）・次の版への写しを確かめる
begin;

create temp table _rwo_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _rwo_result to public;

create function pg_temp.rwo_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.rwo_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _rwo_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

-- 下書きの保存の中身
create function pg_temp.rwo_payload(p_slots jsonb, p_lines jsonb) returns text
language sql as $fn$
  select jsonb_build_object(
    'rates', jsonb_build_object('sales_fee_rate', '1', 'markup_rate', '1.5', 'expense_rate', '0.15'),
    'adjustment', 0, 'adjustment_reason', null,
    'slots', p_slots,
    'lines', p_lines)::text;
$fn$;

create function pg_temp.rwo_slot(p_option uuid, p_baseline_key uuid, p_row_order integer, p_work_item text) returns jsonb
language sql as $fn$
  select jsonb_build_object('baseline_key', p_baseline_key, 'option_id', p_option, 'variant_choice_ids', '[]'::jsonb, 'quantity', '1',
                            'price_mode', 'auto', 'manual_unit_price', null,
                            'slot_code', null, 'slot_label', null, 'selectable_option_ids', '[]'::jsonb)
         || case when p_row_order is null then '{}'::jsonb else jsonb_build_object('row_order', p_row_order) end
         || case when p_work_item is null then '{}'::jsonb else jsonb_build_object('work_item', p_work_item) end;
$fn$;

create function pg_temp.rwo_line(p_line_key uuid, p_name text, p_group_label text, p_unit_price integer, p_row_order integer) returns jsonb
language sql as $fn$
  select jsonb_build_object('line_key', p_line_key, 'section_code', 'option', 'group_label', p_group_label, 'name', p_name,
                            'quantity', '2', 'unit', '式', 'price_mode', 'manual', 'unit_price', p_unit_price, 'remark', null,
                            'review_required', false,
                            -- 公開には手入力明細の原価単価が要る（20261110150000。売価の計算には関わらない）
                            'cost_unit_price', p_unit_price * 6 / 10)
         || case when p_row_order is null then '{}'::jsonb else jsonb_build_object('row_order', p_row_order) end;
$fn$;

create function pg_temp.rwo_save(p_editor uuid, p_rev uuid, p_payload text) returns text
language sql as $fn$
  select pg_temp.rwo_run_as('authenticated', p_editor, format(
    'select (public.save_standard_estimate_v25_draft(%L, %s, %L::jsonb)).lock_version::text', p_rev,
    (select lock_version from public.standard_estimate_revisions where id = p_rev), p_payload));
$fn$;

do $test$
declare
  u_admin constant uuid := '68800000-0000-4000-8000-000000000001';
  u_editor constant uuid := '68800000-0000-4000-8000-000000000002';
  org_hq constant uuid := '68800000-0000-4000-8000-000000000101';
  m_model constant uuid := '68800000-0000-4000-8000-000000000201';
  mr_office constant uuid := '68800000-0000-4000-8000-000000000301';
  cat_roof constant uuid := '68800000-0000-4000-8000-000000000401';
  cat_multi constant uuid := '68800000-0000-4000-8000-000000000402';
  r1 constant uuid := '68800000-0000-4000-8000-000000000501';
  m1 constant uuid := '68800000-0000-4000-8000-000000000502';
  k_r1 constant uuid := '68800000-0000-4000-8000-000000000601';
  k_m1 constant uuid := '68800000-0000-4000-8000-000000000602';
  k_l1 constant uuid := '68800000-0000-4000-8000-000000000701';
  k_l2 constant uuid := '68800000-0000-4000-8000-000000000702';
  cfg_q constant uuid := '68800000-0000-4000-8000-000000000801';
  q_q constant uuid := '68800000-0000-4000-8000-000000000901';
  v_bmr text;
  v_se text;
  v_master uuid;
  v_rev uuid;
  v_rev2 uuid;
  v_out text;
  v_view jsonb;
  v_money_a text;
  v_money_b text;
  v_pin_a text;
  v_pin_b text;
  v_mixed text;
  v_reversed text;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'rwo-admin@runtime.invalid', '{}'::jsonb), (u_editor, 'rwo-editor@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'rwo-admin@runtime.invalid', 'global admin', 'admin'), (u_editor, 'rwo-editor@runtime.invalid', 'HQ editor', 'customer');
  insert into public.organizations (id, code, name, organization_type, status)
  values (org_hq, 'runtime-rwo-hq', 'RWO Runtime HQ', 'headquarters', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values (org_hq, u_editor, 'editor', 'active');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-rwo-model', '並び順の検査モデル', 1000000, 'published', '[{"code":"office","name":"事務所","option_codes":[]}]'::jsonb);
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_office, m_model, 'office', '2100x4550', false);
  insert into public.option_categories (id, code, name, status, selection_mode)
  values (cat_roof, 'runtime-rwo-roof', '並び順 屋根', 'published', 'single'),
         (cat_multi, 'runtime-rwo-multi', '並び順 設備', 'published', 'multi');
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation, price_unit)
  values (r1, cat_roof, 'runtime-rwo-r1', '並び順 屋根1', 7000, false, 'published', 'PRD-968801', false, '㎡'),
         (m1, cat_multi, 'runtime-rwo-m1', '並び順 設備1', 20000, false, 'published', 'PRD-968802', false, '台');
  set local session_replication_role = origin;

  perform pg_temp.rwo_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 7000, 0, ''検査'')', r1));
  perform pg_temp.rwo_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 20000, 0, ''検査'')', m1));
  v_bmr := pg_temp.rwo_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, '並び順 本体', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_office));
  perform pg_temp.rwo_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, '並び順 本体', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr));
  perform pg_temp.rwo_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr));
  v_se := pg_temp.rwo_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr));
  select r.standard_estimate_master_id into v_master from public.standard_estimate_revisions r where r.id::text = v_se;
  v_rev := pg_temp.rwo_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master))::uuid;

  -- ---------- 混在の並び順と工事項目の保存・読み込み ----------
  -- オプションの区分に「手入力1 → 屋根1 → 手入力2 → 設備1」の順
  v_out := pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
    jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 2, '2. 屋根工事'), pg_temp.rwo_slot(m1, k_m1, 4, null)),
    jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', '1. 設備機器', 1000, 1), pg_temp.rwo_line(k_l2, '手入力2', null, 3000, 3))));
  perform pg_temp.rwo_expect_eq('RWO-1 商品と手入力明細を混ぜた並び順と工事項目を保存できる', '3', v_out);
  v_mixed := (select string_agg(x.name || ':' || x.display_order || ':' || coalesce(x.work_item, '-'), '/' order by x.display_order)
                from (select o.name, bi.display_order, bi.work_item from public.standard_estimate_revision_baseline_items bi
                        join public.options o on o.id = bi.option_id where bi.revision_id = v_rev
                      union all
                      select l.name, l.display_order, l.group_label from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev) x);
  perform pg_temp.rwo_expect_eq('RWO-2 開き直すと同じ順・同じ工事項目（商品は work_item、手入力は group_label）',
    '手入力1:1:1. 設備機器/並び順 屋根1:2:2. 屋根工事/手入力2:3:-/並び順 設備1:4:-', v_mixed);

  -- ---------- 見積書の明細（売価だけの形）と Web 以外の下書きの行 ----------
  v_view := public.standard_estimate_v25_sale_view(v_rev, false);
  perform pg_temp.rwo_expect_eq('RWO-3 見積書の明細は保存した順（商品と手入力が混ざる）。商品の行の摘要は工事項目、無ければカテゴリー',
    '手入力1|1. 設備機器/並び順 屋根1|2. 屋根工事/手入力2|-/並び順 設備1|並び順 設備',
    (select string_agg((x.value ->> 'name') || '|' || coalesce(x.value ->> 'group_label', '-'), '/' order by x.ordinality)
       from jsonb_array_elements(v_view -> 'lines') with ordinality as x(value, ordinality)));
  perform pg_temp.rwo_expect_eq('RWO-4 見積書の明細に work_item と display_order を返す', '1. 設備機器:1/2. 屋根工事:2/-:3/-:4',
    (select string_agg(coalesce(x.value ->> 'work_item', '-') || ':' || (x.value ->> 'display_order'), '/' order by x.ordinality)
       from jsonb_array_elements(v_view -> 'lines') with ordinality as x(value, ordinality)));
  perform pg_temp.rwo_expect_eq('RWO-5 Web 以外の見積の下書きの行も同じ順・同じ摘要',
    '手入力1|1. 設備機器/並び順 屋根1|2. 屋根工事/手入力2|-/並び順 設備1|並び順 設備',
    (select string_agg((x.value ->> 'name') || '|' || coalesce(x.value ->> 'description', '-'), '/' order by x.ordinality)
       from jsonb_array_elements(public.standard_estimate_v25_quote_draft_lines(v_rev, false)) with ordinality as x(value, ordinality)
      where x.value ->> 'section_code' = 'option'));

  -- ---------- 並べ替えだけでは金額・原価の固定は変わらない ----------
  v_money_a := (select concat_ws('/', r.subtotal_raw, r.subtotal, r.tax, r.total,
                  (select string_agg(concat_ws(':', s.section_code, s.line_subtotal, s.expense_amount, s.total), ',' order by s.section_code)
                     from public.standard_estimate_revision_sections s where s.revision_id = r.id))
                  from public.standard_estimate_revisions r where r.id = v_rev);
  v_pin_a := (select string_agg(bi.baseline_key::text || ':' || coalesce(bi.standard_cost_version_id::text, '-') || ':' || bi.amount || ':' || bi.sort_order, ',' order by bi.baseline_key)
                from public.standard_estimate_revision_baseline_items bi where bi.revision_id = v_rev)
             || '|' || (select string_agg(l.line_key::text || ':' || l.amount || ':' || l.sort_order, ',' order by l.line_key)
                          from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev);
  v_out := pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
    jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 3, '2. 屋根工事'), pg_temp.rwo_slot(m1, k_m1, 1, null)),
    jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', '1. 設備機器', 1000, 4), pg_temp.rwo_line(k_l2, '手入力2', null, 3000, 2))));
  v_money_b := (select concat_ws('/', r.subtotal_raw, r.subtotal, r.tax, r.total,
                  (select string_agg(concat_ws(':', s.section_code, s.line_subtotal, s.expense_amount, s.total), ',' order by s.section_code)
                     from public.standard_estimate_revision_sections s where s.revision_id = r.id))
                  from public.standard_estimate_revisions r where r.id = v_rev);
  v_pin_b := (select string_agg(bi.baseline_key::text || ':' || coalesce(bi.standard_cost_version_id::text, '-') || ':' || bi.amount || ':' || bi.sort_order, ',' order by bi.baseline_key)
                from public.standard_estimate_revision_baseline_items bi where bi.revision_id = v_rev)
             || '|' || (select string_agg(l.line_key::text || ':' || l.amount || ':' || l.sort_order, ',' order by l.line_key)
                          from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev);
  perform pg_temp.rwo_expect_eq('RWO-6 並べ替えて保存しても、区分の金額・合計・税・原価の固定・行の金額・配列の順（sort_order）は同じ', 'true/true/4',
    (v_money_a = v_money_b)::text || '/' || (v_pin_a = v_pin_b)::text || '/' || v_out);
  v_reversed := (select string_agg(x.value ->> 'name', '/' order by x.ordinality)
                   from jsonb_array_elements(public.standard_estimate_v25_sale_view(v_rev, false) -> 'lines') with ordinality as x(value, ordinality));
  perform pg_temp.rwo_expect_eq('RWO-7 並べ替えた順が見積書の明細の順になる', '並び順 設備1/手入力2/並び順 屋根1/手入力1', v_reversed);


  -- ---------- PR #701: UIの新しい工事項目を模したDraft保存→再読込 ----------
  -- UI側の入力検証・payload生成は tests/v25-work-item-ui.test.ts で確認。
  -- この試験では、そのpayloadと同形式の値を実際のRPCへ送り、DBからの読み直しと不変条件を確認する。
  -- 対象は使い捨てDBだけ。ファイル末尾のrollbackで全変更を取り消す。
  v_out := pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
    jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 3, '2. 屋根工事'), pg_temp.rwo_slot(m1, k_m1, 1, null)),
    jsonb_build_array(
      pg_temp.rwo_line(k_l1, '手入力1', '1. 設備機器', 1000, 4),
      pg_temp.rwo_line(k_l2, '手入力2', '2. 屋根工事', 3000, 2),
      pg_temp.rwo_line('68800000-0000-4000-8000-000000000703'::uuid, '手入力追加', '5. 造作工事', 4000, 5)
    )));
  perform pg_temp.rwo_expect_eq('RWO-17 PR701 工事項目追加→Draft保存成功', 'true', (v_out ~ '^[0-9]+
  perform pg_temp.rwo_expect_eq('RWO-8 並び順を一部の行だけに付けると止まる', 'true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
       jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null), pg_temp.rwo_slot(m1, k_m1, 2, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, null))))
     like 'ERROR P0001: VALIDATION: 並び順は、すべての商品と明細に付けるか、すべて省略してください%')::text);
  perform pg_temp.rwo_expect_eq('RWO-9 商品と明細で並び順が重なると止まる', 'true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
       jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, 1))))
     like 'ERROR P0001: VALIDATION: 明細 1 行目：並び順が重なっています（1）%')::text);
  perform pg_temp.rwo_expect_eq('RWO-10 並び順の範囲（0）と工事項目の長さ（121 文字）は止まる', 'true/true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 0, null)), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：並び順は 1〜100000 で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, repeat('あ', 121))), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：工事項目は 120 文字までです%')::text);
  perform pg_temp.rwo_expect_eq('RWO-15 並び順が数でない（"2"・"x"・1.5）・整数の範囲外（2147483648）、工事項目が文字でない（5）なら止まる（明細も）',
    'true/true/true/true/true/true/true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": "2"}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：工事項目は文字、並び順は数で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": "x"}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION:%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": 1.5}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION:%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": 2147483648}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION:%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"work_item": 5}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：工事項目は文字、並び順は数で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, null) || '{"row_order": "2"}'::jsonb)))
       like 'ERROR P0001: VALIDATION: 明細 1 行目：並び順は数で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, null) || '{"row_order": 1.5}'::jsonb)))
       like 'ERROR P0001: VALIDATION: 明細 1 行目%')::text);
  -- 並び順を省略すると今までどおり「商品→手入力」（工事項目は残る）
  v_out := pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
    jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, '2. 屋根工事'), pg_temp.rwo_slot(m1, k_m1, null, null)),
    jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', '1. 設備機器', 1000, null), pg_temp.rwo_line(k_l2, '手入力2', null, 3000, null))));
  perform pg_temp.rwo_expect_eq('RWO-11 並び順を省略した保存は今までどおり商品→手入力の順（display_order は null）',
    '並び順 屋根1/並び順 設備1/手入力1/手入力2|0',
    (select string_agg(x.value ->> 'name', '/' order by x.ordinality)
       from jsonb_array_elements(public.standard_estimate_v25_sale_view(v_rev, false) -> 'lines') with ordinality as x(value, ordinality)) || '|' ||
    ((select count(*) from public.standard_estimate_revision_baseline_items where revision_id = v_rev and display_order is not null)
     + (select count(*) from public.standard_estimate_revision_v25_lines where revision_id = v_rev and display_order is not null))::text);

  -- ---------- 公開した版から次の下書きへの写し・公開した版は変えない ----------
  v_out := pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
    jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 2, '2. 屋根工事'), pg_temp.rwo_slot(m1, k_m1, 4, null)),
    jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', '1. 設備機器', 1000, 1), pg_temp.rwo_line(k_l2, '手入力2', null, 3000, 3))));
  v_out := pg_temp.rwo_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, %s)).status', v_rev,
    (select lock_version from public.standard_estimate_revisions where id = v_rev)));
  perform pg_temp.rwo_expect_eq('RWO-12 前提：混在の並び順と工事項目の版を公開できる', 'published', v_out);
  -- Web の見積の明細（write_standard_estimate_quote_items）も、公開した版の並び順と工事項目の摘要になる
  -- （試験のため、価格のスイッチを入れた状態にし、見積依頼と見積の行を直接作る。この試験の終わりに全部取り消す）
  set local session_replication_role = replica;
  update public.app_settings set value = jsonb_build_object('enabled', true) where key = 'simulator_standard_pricing';
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (cfg_q, u_editor, m_model, '並び順の検査', 'draft', 'office', 'full');
  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  values (cfg_q, r1, 1, '{}'), (cfg_q, m1, 1, '{}');
  insert into public.quote_requests (id, configuration_id, user_id, quote_id, status)
  values (q_q, cfg_q, u_editor, q_q, 'new');
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, status, valid_until, customer_name, base_model_name,
                             base_price, option_subtotal, installation_subtotal, subtotal, tax_rate, tax, total)
  values (q_q, 'RT-RWO-1', q_q, cfg_q, u_editor, 'issued', now() + interval '30 days', '顧客', '並び順の検査モデル', 0, 0, 0, 0, 0.10, 0, 0);
  set local session_replication_role = origin;
  v_out := public.write_standard_estimate_quote_items(cfg_q, q_q)::text;
  perform pg_temp.rwo_expect_eq('RWO-16 Web の見積の明細も公開した版の並び順（商品と手入力が混ざる）で、商品の行の摘要は工事項目（無ければカテゴリー）',
    'true|手入力1:1. 設備機器/並び順 屋根1:2. 屋根工事/手入力2:-/並び順 設備1:並び順 設備',
    v_out || '|' || coalesce((select string_agg(qi.name || ':' || coalesce(qi.description, '-'), '/' order by qi.sort_order)
                                from public.quote_items qi
                               where qi.quote_id = q_q and qi.kind = 'option' and qi.sort_order > 2000 and qi.sort_order < 2700), '(なし)'));
  v_rev2 := pg_temp.rwo_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, null)::text', v_master))::uuid;
  perform pg_temp.rwo_expect_eq('RWO-13 公開した版から作る次の下書きに、並び順と工事項目を写す', v_mixed,
    (select string_agg(x.name || ':' || x.display_order || ':' || coalesce(x.work_item, '-'), '/' order by x.display_order)
       from (select o.name, bi.display_order, bi.work_item from public.standard_estimate_revision_baseline_items bi
               join public.options o on o.id = bi.option_id where bi.revision_id = v_rev2
             union all
             select l.name, l.display_order, l.group_label from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev2) x));
  begin
    update public.standard_estimate_revision_baseline_items set work_item = '変更' where revision_id = v_rev and option_id = r1;
    v_out := 'updated';
  exception when others then
    v_out := format('ERROR %s', sqlstate);
  end;
  perform pg_temp.rwo_expect_eq('RWO-14 公開した版の工事項目は変えられない（トリガー）', 'ERROR P0001', v_out);
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _rwo_result;

rollback;
)::text);
  perform pg_temp.rwo_expect_eq('RWO-18 PR701 再読込で新しい工事項目・品名・行ID・行順・原価単価を保持',
    '手入力追加|5. 造作工事|5|4000|2400|2',
    (select concat_ws('|', l.name, l.group_label, l.display_order::text, l.unit_price::text,
                      l.cost_unit_price::text, l.quantity::text)
       from public.standard_estimate_revision_v25_lines l
      where l.revision_id = v_rev and l.line_key = '68800000-0000-4000-8000-000000000703'::uuid));

  -- 名称だけ変更。追加時点の原価Version・合計・数量・金額・sort_order・行IDを基準とする。
  v_money_a := (select concat_ws('/', r.subtotal_raw, r.subtotal, r.tax, r.total,
                     (select string_agg(concat_ws(':', s.section_code, s.line_subtotal, s.expense_amount, s.total), ',' order by s.section_code)
                        from public.standard_estimate_revision_sections s where s.revision_id = r.id))
                  from public.standard_estimate_revisions r where r.id = v_rev);
  v_pin_a := (select string_agg(concat_ws(':', bi.baseline_key, bi.standard_cost_version_id,
                     bi.quantity, bi.amount, bi.sort_order), ',' order by bi.baseline_key)
                from public.standard_estimate_revision_baseline_items bi where bi.revision_id = v_rev)
            || '|' || (select string_agg(concat_ws(':', l.line_key, l.quantity, l.unit_price,
                     l.cost_unit_price, l.amount, l.sort_order), ',' order by l.line_key)
                        from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev);
  v_out := pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
    jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 3, '2. 屋根・板金工事'), pg_temp.rwo_slot(m1, k_m1, 1, null)),
    jsonb_build_array(
      pg_temp.rwo_line(k_l1, '手入力1', '1. 設備機器', 1000, 4),
      pg_temp.rwo_line(k_l2, '手入力2', '2. 屋根・板金工事', 3000, 2),
      pg_temp.rwo_line('68800000-0000-4000-8000-000000000703'::uuid, '手入力追加', '5. 造作工事', 4000, 5)
    )));
  perform pg_temp.rwo_expect_eq('RWO-19 PR701 工事項目の一括名称変更→Draft保存成功', 'true', (v_out ~ '^[0-9]+
  perform pg_temp.rwo_expect_eq('RWO-8 並び順を一部の行だけに付けると止まる', 'true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
       jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null), pg_temp.rwo_slot(m1, k_m1, 2, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, null))))
     like 'ERROR P0001: VALIDATION: 並び順は、すべての商品と明細に付けるか、すべて省略してください%')::text);
  perform pg_temp.rwo_expect_eq('RWO-9 商品と明細で並び順が重なると止まる', 'true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
       jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, 1))))
     like 'ERROR P0001: VALIDATION: 明細 1 行目：並び順が重なっています（1）%')::text);
  perform pg_temp.rwo_expect_eq('RWO-10 並び順の範囲（0）と工事項目の長さ（121 文字）は止まる', 'true/true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 0, null)), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：並び順は 1〜100000 で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, repeat('あ', 121))), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：工事項目は 120 文字までです%')::text);
  perform pg_temp.rwo_expect_eq('RWO-15 並び順が数でない（"2"・"x"・1.5）・整数の範囲外（2147483648）、工事項目が文字でない（5）なら止まる（明細も）',
    'true/true/true/true/true/true/true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": "2"}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：工事項目は文字、並び順は数で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": "x"}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION:%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": 1.5}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION:%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": 2147483648}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION:%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"work_item": 5}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：工事項目は文字、並び順は数で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, null) || '{"row_order": "2"}'::jsonb)))
       like 'ERROR P0001: VALIDATION: 明細 1 行目：並び順は数で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, null) || '{"row_order": 1.5}'::jsonb)))
       like 'ERROR P0001: VALIDATION: 明細 1 行目%')::text);
  -- 並び順を省略すると今までどおり「商品→手入力」（工事項目は残る）
  v_out := pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
    jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, '2. 屋根工事'), pg_temp.rwo_slot(m1, k_m1, null, null)),
    jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', '1. 設備機器', 1000, null), pg_temp.rwo_line(k_l2, '手入力2', null, 3000, null))));
  perform pg_temp.rwo_expect_eq('RWO-11 並び順を省略した保存は今までどおり商品→手入力の順（display_order は null）',
    '並び順 屋根1/並び順 設備1/手入力1/手入力2|0',
    (select string_agg(x.value ->> 'name', '/' order by x.ordinality)
       from jsonb_array_elements(public.standard_estimate_v25_sale_view(v_rev, false) -> 'lines') with ordinality as x(value, ordinality)) || '|' ||
    ((select count(*) from public.standard_estimate_revision_baseline_items where revision_id = v_rev and display_order is not null)
     + (select count(*) from public.standard_estimate_revision_v25_lines where revision_id = v_rev and display_order is not null))::text);

  -- ---------- 公開した版から次の下書きへの写し・公開した版は変えない ----------
  v_out := pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
    jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 2, '2. 屋根工事'), pg_temp.rwo_slot(m1, k_m1, 4, null)),
    jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', '1. 設備機器', 1000, 1), pg_temp.rwo_line(k_l2, '手入力2', null, 3000, 3))));
  v_out := pg_temp.rwo_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, %s)).status', v_rev,
    (select lock_version from public.standard_estimate_revisions where id = v_rev)));
  perform pg_temp.rwo_expect_eq('RWO-12 前提：混在の並び順と工事項目の版を公開できる', 'published', v_out);
  -- Web の見積の明細（write_standard_estimate_quote_items）も、公開した版の並び順と工事項目の摘要になる
  -- （試験のため、価格のスイッチを入れた状態にし、見積依頼と見積の行を直接作る。この試験の終わりに全部取り消す）
  set local session_replication_role = replica;
  update public.app_settings set value = jsonb_build_object('enabled', true) where key = 'simulator_standard_pricing';
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (cfg_q, u_editor, m_model, '並び順の検査', 'draft', 'office', 'full');
  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  values (cfg_q, r1, 1, '{}'), (cfg_q, m1, 1, '{}');
  insert into public.quote_requests (id, configuration_id, user_id, quote_id, status)
  values (q_q, cfg_q, u_editor, q_q, 'new');
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, status, valid_until, customer_name, base_model_name,
                             base_price, option_subtotal, installation_subtotal, subtotal, tax_rate, tax, total)
  values (q_q, 'RT-RWO-1', q_q, cfg_q, u_editor, 'issued', now() + interval '30 days', '顧客', '並び順の検査モデル', 0, 0, 0, 0, 0.10, 0, 0);
  set local session_replication_role = origin;
  v_out := public.write_standard_estimate_quote_items(cfg_q, q_q)::text;
  perform pg_temp.rwo_expect_eq('RWO-16 Web の見積の明細も公開した版の並び順（商品と手入力が混ざる）で、商品の行の摘要は工事項目（無ければカテゴリー）',
    'true|手入力1:1. 設備機器/並び順 屋根1:2. 屋根工事/手入力2:-/並び順 設備1:並び順 設備',
    v_out || '|' || coalesce((select string_agg(qi.name || ':' || coalesce(qi.description, '-'), '/' order by qi.sort_order)
                                from public.quote_items qi
                               where qi.quote_id = q_q and qi.kind = 'option' and qi.sort_order > 2000 and qi.sort_order < 2700), '(なし)'));
  v_rev2 := pg_temp.rwo_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, null)::text', v_master))::uuid;
  perform pg_temp.rwo_expect_eq('RWO-13 公開した版から作る次の下書きに、並び順と工事項目を写す', v_mixed,
    (select string_agg(x.name || ':' || x.display_order || ':' || coalesce(x.work_item, '-'), '/' order by x.display_order)
       from (select o.name, bi.display_order, bi.work_item from public.standard_estimate_revision_baseline_items bi
               join public.options o on o.id = bi.option_id where bi.revision_id = v_rev2
             union all
             select l.name, l.display_order, l.group_label from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev2) x));
  begin
    update public.standard_estimate_revision_baseline_items set work_item = '変更' where revision_id = v_rev and option_id = r1;
    v_out := 'updated';
  exception when others then
    v_out := format('ERROR %s', sqlstate);
  end;
  perform pg_temp.rwo_expect_eq('RWO-14 公開した版の工事項目は変えられない（トリガー）', 'ERROR P0001', v_out);
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _rwo_result;

rollback;
)::text);
  v_reversed := (select string_agg(x.name || ':' || x.display_order || ':' || coalesce(x.work_item, '-'),
                                   '/' order by x.display_order)
                  from (select o.name, bi.display_order, bi.work_item
                          from public.standard_estimate_revision_baseline_items bi
                          join public.options o on o.id = bi.option_id where bi.revision_id = v_rev
                        union all
                        select l.name, l.display_order, l.group_label
                          from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev) x);
  perform pg_temp.rwo_expect_eq('RWO-20 PR701 再読込で商品・手入力を同じ新名称へ変更し、混在順は不変',
    '並び順 設備1:1:-/手入力2:2:2. 屋根・板金工事/並び順 屋根1:3:2. 屋根・板金工事/手入力1:4:1. 設備機器/手入力追加:5:5. 造作工事',
    v_reversed);
  v_money_b := (select concat_ws('/', r.subtotal_raw, r.subtotal, r.tax, r.total,
                     (select string_agg(concat_ws(':', s.section_code, s.line_subtotal, s.expense_amount, s.total), ',' order by s.section_code)
                        from public.standard_estimate_revision_sections s where s.revision_id = r.id))
                  from public.standard_estimate_revisions r where r.id = v_rev);
  v_pin_b := (select string_agg(concat_ws(':', bi.baseline_key, bi.standard_cost_version_id,
                     bi.quantity, bi.amount, bi.sort_order), ',' order by bi.baseline_key)
                from public.standard_estimate_revision_baseline_items bi where bi.revision_id = v_rev)
            || '|' || (select string_agg(concat_ws(':', l.line_key, l.quantity, l.unit_price,
                     l.cost_unit_price, l.amount, l.sort_order), ',' order by l.line_key)
                        from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev);
  perform pg_temp.rwo_expect_eq('RWO-21 PR701 名称変更のみでは金額・数量・原価Version・原価単価・行ID・sort_orderは不変',
    'true/true/draft', (v_money_a = v_money_b)::text || '/' || (v_pin_a = v_pin_b)::text ||
    '/' || (select status from public.standard_estimate_revisions where id = v_rev));

  -- ---------- 決まり ----------
  perform pg_temp.rwo_expect_eq('RWO-8 並び順を一部の行だけに付けると止まる', 'true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
       jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null), pg_temp.rwo_slot(m1, k_m1, 2, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, null))))
     like 'ERROR P0001: VALIDATION: 並び順は、すべての商品と明細に付けるか、すべて省略してください%')::text);
  perform pg_temp.rwo_expect_eq('RWO-9 商品と明細で並び順が重なると止まる', 'true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
       jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, 1))))
     like 'ERROR P0001: VALIDATION: 明細 1 行目：並び順が重なっています（1）%')::text);
  perform pg_temp.rwo_expect_eq('RWO-10 並び順の範囲（0）と工事項目の長さ（121 文字）は止まる', 'true/true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 0, null)), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：並び順は 1〜100000 で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, repeat('あ', 121))), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：工事項目は 120 文字までです%')::text);
  perform pg_temp.rwo_expect_eq('RWO-15 並び順が数でない（"2"・"x"・1.5）・整数の範囲外（2147483648）、工事項目が文字でない（5）なら止まる（明細も）',
    'true/true/true/true/true/true/true',
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": "2"}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：工事項目は文字、並び順は数で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": "x"}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION:%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": 1.5}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION:%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"row_order": 2147483648}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION:%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, null) || '{"work_item": 5}'::jsonb), '[]'::jsonb))
       like 'ERROR P0001: VALIDATION: 商品 1 件目：工事項目は文字、並び順は数で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, null) || '{"row_order": "2"}'::jsonb)))
       like 'ERROR P0001: VALIDATION: 明細 1 行目：並び順は数で指定してください%')::text || '/' ||
    (pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 1, null)),
       jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', null, 1000, null) || '{"row_order": 1.5}'::jsonb)))
       like 'ERROR P0001: VALIDATION: 明細 1 行目%')::text);
  -- 並び順を省略すると今までどおり「商品→手入力」（工事項目は残る）
  v_out := pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
    jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, null, '2. 屋根工事'), pg_temp.rwo_slot(m1, k_m1, null, null)),
    jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', '1. 設備機器', 1000, null), pg_temp.rwo_line(k_l2, '手入力2', null, 3000, null))));
  perform pg_temp.rwo_expect_eq('RWO-11 並び順を省略した保存は今までどおり商品→手入力の順（display_order は null）',
    '並び順 屋根1/並び順 設備1/手入力1/手入力2|0',
    (select string_agg(x.value ->> 'name', '/' order by x.ordinality)
       from jsonb_array_elements(public.standard_estimate_v25_sale_view(v_rev, false) -> 'lines') with ordinality as x(value, ordinality)) || '|' ||
    ((select count(*) from public.standard_estimate_revision_baseline_items where revision_id = v_rev and display_order is not null)
     + (select count(*) from public.standard_estimate_revision_v25_lines where revision_id = v_rev and display_order is not null))::text);

  -- ---------- 公開した版から次の下書きへの写し・公開した版は変えない ----------
  v_out := pg_temp.rwo_save(u_editor, v_rev, pg_temp.rwo_payload(
    jsonb_build_array(pg_temp.rwo_slot(r1, k_r1, 2, '2. 屋根工事'), pg_temp.rwo_slot(m1, k_m1, 4, null)),
    jsonb_build_array(pg_temp.rwo_line(k_l1, '手入力1', '1. 設備機器', 1000, 1), pg_temp.rwo_line(k_l2, '手入力2', null, 3000, 3))));
  v_out := pg_temp.rwo_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, %s)).status', v_rev,
    (select lock_version from public.standard_estimate_revisions where id = v_rev)));
  perform pg_temp.rwo_expect_eq('RWO-12 前提：混在の並び順と工事項目の版を公開できる', 'published', v_out);
  -- Web の見積の明細（write_standard_estimate_quote_items）も、公開した版の並び順と工事項目の摘要になる
  -- （試験のため、価格のスイッチを入れた状態にし、見積依頼と見積の行を直接作る。この試験の終わりに全部取り消す）
  set local session_replication_role = replica;
  update public.app_settings set value = jsonb_build_object('enabled', true) where key = 'simulator_standard_pricing';
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (cfg_q, u_editor, m_model, '並び順の検査', 'draft', 'office', 'full');
  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  values (cfg_q, r1, 1, '{}'), (cfg_q, m1, 1, '{}');
  insert into public.quote_requests (id, configuration_id, user_id, quote_id, status)
  values (q_q, cfg_q, u_editor, q_q, 'new');
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, status, valid_until, customer_name, base_model_name,
                             base_price, option_subtotal, installation_subtotal, subtotal, tax_rate, tax, total)
  values (q_q, 'RT-RWO-1', q_q, cfg_q, u_editor, 'issued', now() + interval '30 days', '顧客', '並び順の検査モデル', 0, 0, 0, 0, 0.10, 0, 0);
  set local session_replication_role = origin;
  v_out := public.write_standard_estimate_quote_items(cfg_q, q_q)::text;
  perform pg_temp.rwo_expect_eq('RWO-16 Web の見積の明細も公開した版の並び順（商品と手入力が混ざる）で、商品の行の摘要は工事項目（無ければカテゴリー）',
    'true|手入力1:1. 設備機器/並び順 屋根1:2. 屋根工事/手入力2:-/並び順 設備1:並び順 設備',
    v_out || '|' || coalesce((select string_agg(qi.name || ':' || coalesce(qi.description, '-'), '/' order by qi.sort_order)
                                from public.quote_items qi
                               where qi.quote_id = q_q and qi.kind = 'option' and qi.sort_order > 2000 and qi.sort_order < 2700), '(なし)'));
  v_rev2 := pg_temp.rwo_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, null)::text', v_master))::uuid;
  perform pg_temp.rwo_expect_eq('RWO-13 公開した版から作る次の下書きに、並び順と工事項目を写す', v_mixed,
    (select string_agg(x.name || ':' || x.display_order || ':' || coalesce(x.work_item, '-'), '/' order by x.display_order)
       from (select o.name, bi.display_order, bi.work_item from public.standard_estimate_revision_baseline_items bi
               join public.options o on o.id = bi.option_id where bi.revision_id = v_rev2
             union all
             select l.name, l.display_order, l.group_label from public.standard_estimate_revision_v25_lines l where l.revision_id = v_rev2) x));
  begin
    update public.standard_estimate_revision_baseline_items set work_item = '変更' where revision_id = v_rev and option_id = r1;
    v_out := 'updated';
  exception when others then
    v_out := format('ERROR %s', sqlstate);
  end;
  perform pg_temp.rwo_expect_eq('RWO-14 公開した版の工事項目は変えられない（トリガー）', 'ERROR P0001', v_out);
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _rwo_result;

rollback;
