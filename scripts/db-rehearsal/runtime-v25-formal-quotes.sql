-- v2.5 PR-D1：v2.5 の標準見積から作った見積の第 2 版以降（正式見積）の実行時検査。使い捨てDB専用。最後に rollback する。
begin;

create temp table _fq_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _fq_result to public;

create function pg_temp.fq_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.fq_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _fq_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.fq_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _fq_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || '%');
$fn$;

-- 第 2 版以降の発行（担当者として呼ぶ）
create function pg_temp.fq_revise(p_user uuid, p_quote uuid, p_lines jsonb, p_adjustment integer default 0, p_reason text default null)
returns text
language sql as $fn$
  select pg_temp.fq_run_as('authenticated', p_user, format(
    $q$ select public.create_quote_revision_v25(%L, %L::jsonb, %s, %L, '申し送り')::text $q$,
    p_quote, p_lines, p_adjustment, p_reason));
$fn$;

do $test$
declare
  u_admin constant uuid := '2a200000-0000-4000-8000-000000000001';
  u_editor constant uuid := '2a200000-0000-4000-8000-000000000002';
  u_customer constant uuid := '2a200000-0000-4000-8000-000000000003';
  u_dealer constant uuid := '2a200000-0000-4000-8000-000000000004';
  u_dealer2 constant uuid := '2a200000-0000-4000-8000-000000000005';
  u_master constant uuid := '2a200000-0000-4000-8000-000000000006';
  org_hq constant uuid := '2a200000-0000-4000-8000-000000000101';
  m_model constant uuid := '2a200000-0000-4000-8000-000000000201';
  m_other constant uuid := '2a200000-0000-4000-8000-000000000202';
  mr_office constant uuid := '2a200000-0000-4000-8000-000000000301';
  cat_opt constant uuid := '2a200000-0000-4000-8000-000000000401';
  cat_site constant uuid := '2a200000-0000-4000-8000-000000000402';
  o1 constant uuid := '2a200000-0000-4000-8000-000000000501';
  o2 constant uuid := '2a200000-0000-4000-8000-000000000502';
  o3 constant uuid := '2a200000-0000-4000-8000-000000000503';
  o4 constant uuid := '2a200000-0000-4000-8000-000000000504';
  o5 constant uuid := '2a200000-0000-4000-8000-000000000505';
  o6 constant uuid := '2a200000-0000-4000-8000-000000000506';
  g_o2 constant uuid := '2a200000-0000-4000-8000-000000000601';
  g_o6 constant uuid := '2a200000-0000-4000-8000-000000000602';
  c_o2 constant uuid := '2a200000-0000-4000-8000-000000000701';
  c_o6a constant uuid := '2a200000-0000-4000-8000-000000000702';
  v_bmr text;
  v_se text;
  v_master uuid;
  v_rev uuid;
  v_out text;
  v_cfg uuid;
  v_q1 uuid;
  v_q2 uuid;
  v_q3 uuid;
  v_keys text;
  v_lines jsonb;
  v_item_o1 uuid;
  v_item_fee uuid;
  v_item_por uuid;
  v_item_porline uuid;
  v_item_base uuid;
  v_ctx jsonb;
  v_legacy_quote uuid;
  v_capture text;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'fq-admin@runtime.invalid', '{}'::jsonb), (u_editor, 'fq-editor@runtime.invalid', '{}'::jsonb),
         (u_customer, 'fq-customer@runtime.invalid', '{}'::jsonb), (u_dealer, 'fq-dealer@runtime.invalid', '{}'::jsonb),
         (u_dealer2, 'fq-dealer2@runtime.invalid', '{}'::jsonb), (u_master, 'fq-master@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'fq-admin@runtime.invalid', '本部', 'admin'),
         (u_editor, 'fq-editor@runtime.invalid', 'HQ editor', 'customer'),
         (u_customer, 'fq-customer@runtime.invalid', 'お客様', 'customer'),
         (u_dealer, 'fq-dealer@runtime.invalid', '担当代理店', 'dealer'),
         (u_dealer2, 'fq-dealer2@runtime.invalid', '担当外の代理店', 'dealer'),
         (u_master, 'fq-master@runtime.invalid', '担当外の総代理店', 'master_dealer');
  insert into public.organizations (id, code, name, organization_type, status)
  values (org_hq, 'runtime-fq-hq', 'D1 Runtime HQ', 'headquarters', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values (org_hq, u_editor, 'editor', 'active');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-fq-model', 'D1 検査モデル', 1000000, 'published', '[{"code":"office","name":"事務所","option_codes":[]}]'::jsonb),
         (m_other, 'runtime-fq-other', 'D1 別モデル', 1000000, 'published', '[]'::jsonb);
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_office, m_model, 'office', '2100x4550', false);
  insert into public.option_categories (id, code, name, status, selection_mode)
  values (cat_opt, 'runtime-fq-option', 'D1 設備', 'published', 'multi'),
         (cat_site, 'runtime-fq-site', 'D1 施工', 'published', 'multi');
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation, base_model_id)
  values
    (o1, cat_opt, 'runtime-fq-o1', 'D1 設備1', 20000, false, 'published', 'PRD-948001', false, null),
    (o2, cat_opt, 'runtime-fq-o2', 'D1 設備2', 10000, false, 'published', 'PRD-948002', false, null),
    (o3, cat_opt, 'runtime-fq-o3', 'D1 設備3（別途見積）', 0, true, 'published', 'PRD-948003', false, null),
    (o4, cat_opt, 'runtime-fq-o4', 'D1 設備4（別モデル）', 5000, false, 'published', 'PRD-948004', false, m_other),
    (o5, cat_site, 'runtime-fq-o5', 'D1 施工1', 8000, false, 'published', 'PRD-948005', true, null),
    (o6, cat_opt, 'runtime-fq-o6', 'D1 設備6（色が必須）', 7000, false, 'published', 'PRD-948006', false, null);
  insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
  values (g_o2, o2, 'size', 'サイズ', 1, false, 'published'), (g_o6, o6, 'color', '色', 1, true, 'published');
  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status, sort_order)
  values (c_o2, g_o2, 'large', '大', 'option', 1000, 'published', 1), (c_o6a, g_o6, 'white', '白', 'standard', 0, 'published', 1);
  set local session_replication_role = origin;

  -- 原価（本部）：設備1 20,000、設備2 10,000＋大 1,000、設備4 5,000（設備3 は別途見積）
  perform pg_temp.fq_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 20000, 0, ''検査'')', o1));
  perform pg_temp.fq_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 10000, 0, ''検査'')', o2));
  perform pg_temp.fq_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 5000, 0, ''検査'')', o4));
  perform pg_temp.fq_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 1000, null, ''検査'')', c_o2));

  -- 本体（伸縮脚 18,200 × 12 本）と、v2.5 の標準見積（設備1 の選択枠と、取付費 10,000 円の明細）。率は 1.07・1.5・経費 15%
  v_bmr := pg_temp.fq_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, 'D1 本体', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_office));
  perform pg_temp.fq_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, 'D1 本体', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr));
  perform pg_temp.fq_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr));
  v_se := pg_temp.fq_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr));
  select r.standard_estimate_master_id into v_master from public.standard_estimate_revisions r where r.id::text = v_se;
  v_rev := pg_temp.fq_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master))::uuid;
  v_out := pg_temp.fq_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, %s, %L::jsonb)).lock_version::text', v_rev,
    (select lock_version from public.standard_estimate_revisions where id = v_rev),
    jsonb_build_object(
      'rates', jsonb_build_object('sales_fee_rate', '1.07', 'markup_rate', '1.5', 'expense_rate', '0.15'),
      'adjustment', 0, 'adjustment_reason', null,
      'slots', jsonb_build_array(jsonb_build_object('baseline_key', null, 'option_id', o1, 'variant_choice_ids', '[]'::jsonb, 'quantity', '1',
        'price_mode', 'auto', 'manual_unit_price', null, 'slot_code', null, 'slot_label', null, 'selectable_option_ids', '[]'::jsonb)),
      'lines', jsonb_build_array(
        jsonb_build_object('line_key', null, 'section_code', 'option', 'group_label', 'D1 工事', 'name', '取付費',
          'quantity', '1', 'unit', '式', 'price_mode', 'manual', 'unit_price', 10000, 'remark', null, 'review_required', false),
        jsonb_build_object('line_key', null, 'section_code', 'option', 'group_label', 'D1 工事', 'name', '据付工事',
          'quantity', '1', 'unit', '式', 'price_mode', 'por', 'unit_price', null, 'remark', null, 'review_required', false)))::text));
  v_out := pg_temp.fq_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, %s)).status', v_rev,
    (select lock_version from public.standard_estimate_revisions where id = v_rev)));
  perform pg_temp.fq_expect_eq('D1-0 前提：v2.5 の標準見積を公開でき、スイッチを入れられる', 'published/true',
    v_out || '/' || pg_temp.fq_run_as('authenticated', u_admin, 'select public.set_simulator_standard_pricing(true)::text'));

  -- お客様：設備1（標準）と設備3（別途見積）を選んで保存し、見積を依頼する（第 1 版）
  v_out := pg_temp.fq_run_as('authenticated', u_customer, format(
    $q$ select (public.save_configuration_atomic(
          p_configuration_id => null, p_base_model_id => %L, p_name => 'D1 検査', p_option_ids => %L::uuid[],
          p_preview_image_url => null, p_notes => null, p_finish_level => 'full', p_variant_choice_ids => '{}'::uuid[],
          p_spec_code => 'office', p_exterior_faces => '[]'::jsonb, p_expected_lock_version => null::integer)).id::text $q$,
    m_model, array[o1, o3]));
  v_cfg := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  v_out := pg_temp.fq_run_as('authenticated', u_customer, format(
    $q$ select (public.create_quote_from_configuration(%L, '{"full_name":"検査"}'::jsonb, null, %s))::text $q$,
    v_cfg, (select lock_version from public.configurations where id = v_cfg)));
  select q.id into v_q1 from public.quotes q join public.quote_requests r on r.id = q.quote_request_id where r.configuration_id = v_cfg;
  set local session_replication_role = replica;
  update public.quotes set dealer_id = u_dealer where id = v_q1;
  set local session_replication_role = origin;

  -- 本体 29,211 × 12 ＝ 350,532、経費 52,579。オプション 設備1 32,100 ＋ 取付費 10,000 ＝ 42,100、経費 6,315。税抜 451,526・税 45,152
  perform pg_temp.fq_expect_eq('D1-1 第 1 版に、使った標準見積の版・計算ルール・税ルールの Version を固定する。金額は v2.5（496,678 円）',
    'v2.5/true/true/true/496678',
    coalesce((select pricing_model || '/' || (standard_estimate_revision_id = v_rev)::text || '/' ||
      (calc_rule_version_id = (select calc_rule_version_id from public.standard_estimate_revisions where id = v_rev))::text || '/' ||
      (tax_rule_version_id = (select tax_rule_version_id from public.standard_estimate_revisions where id = v_rev))::text || '/' || total::text
      from public.quotes where id = v_q1), v_out));
  perform pg_temp.fq_expect_error('D1-2 固定した版は、本部でも表の更新では変えられない', 'P0001', 'QUOTE_LINEAGE_IMMUTABLE',
    pg_temp.fq_run_as('authenticated', u_admin, format('update public.quotes set pricing_model = null, standard_estimate_revision_id = null, calc_rule_version_id = null, tax_rule_version_id = null where id = %L returning id::text', v_q1)));

  -- ---------- 編集画面に渡す値 ----------
  v_ctx := pg_temp.fq_run_as('authenticated', u_dealer, format('select public.get_quote_v25_context(%L)::text', v_q1))::jsonb;
  perform pg_temp.fq_expect_eq('D1-3 編集画面に渡す値は経費率・経費の対象の区分・税率・モデルと仕様だけ（販売費率・掛率・原価は返さない）',
    '0.1500/["base", "interior_exterior", "option"]/0.100000/runtime-fq-model/office/false',
    (v_ctx ->> 'expense_rate') || '/' || (v_ctx -> 'expense_sections')::text || '/' || (v_ctx ->> 'tax_rate') || '/' ||
    (v_ctx ->> 'model_slug') || '/' || (v_ctx ->> 'spec_code') || '/' ||
    (v_ctx ? 'sales_fee_rate' or v_ctx ? 'markup_rate' or v_ctx::text like '%cost%')::text);
  perform pg_temp.fq_expect_error('D1-4 担当外の代理店・お客様は、編集画面の値を読めない（見積の有無も返さない）', 'P0002', 'NOT_FOUND',
    pg_temp.fq_run_as('authenticated', u_dealer2, format('select public.get_quote_v25_context(%L)::text', v_q1)));
  perform pg_temp.fq_expect_error('D1-4b お客様も読めない', 'P0002', 'NOT_FOUND',
    pg_temp.fq_run_as('authenticated', u_customer, format('select public.get_quote_v25_units(%L, ''[]''::jsonb)::text', v_q1)));
  -- 設備2＋大：trunc(trunc((10,000＋1,000) × 1.07) × 1.5) ＝ 17,655。設備1 は版の売価 32,100。設備3 は別途見積（null）
  perform pg_temp.fq_expect_eq('D1-5 商品の売価は、見積に固定した版の v2.5 の売価（別途見積は null）', '[17655, 32100, null]',
    pg_temp.fq_run_as('authenticated', u_dealer, format('select public.get_quote_v25_units(%L, %L::jsonb)::text', v_q1,
      jsonb_build_array(jsonb_build_object('option_id', o2, 'choice_ids', jsonb_build_array(c_o2)),
                        jsonb_build_object('option_id', o1, 'choice_ids', '[]'::jsonb),
                        jsonb_build_object('option_id', o3, 'choice_ids', '[]'::jsonb)))));

  -- ---------- 第 2 版の発行：止める条件 ----------
  select i.id into v_item_o1 from public.quote_items i where i.quote_id = v_q1 and i.kind = 'option' and i.name like 'D1 設備1%';
  select i.id into v_item_fee from public.quote_items i where i.quote_id = v_q1 and i.name = '取付費';
  select i.id into v_item_por from public.quote_items i where i.quote_id = v_q1 and i.name = '価格未確定の商品';
  select i.id into v_item_porline from public.quote_items i where i.quote_id = v_q1 and i.name = '据付工事';
  select i.id into v_item_base from public.quote_items i where i.quote_id = v_q1 and i.kind = 'base' limit 1;
  perform pg_temp.fq_expect_eq('D1-6 前提：第 1 版に、設備1・取付費・据付工事（別途見積）・価格未確定の商品の行がある', 'true',
    (v_item_o1 is not null and v_item_fee is not null and v_item_por is not null and v_item_porline is not null and v_item_base is not null)::text);
  -- 何も変えずに写す（未確定の行は 0 円のまま扱いだけ決める）と、第 1 版と同じ金額になる。確かめた後は取り消す
  begin
    select string_agg(e ->> 'key', ',') into v_keys from jsonb_array_elements(public.configuration_por_selections(v_cfg)) e;
    perform pg_temp.fq_run_as('authenticated', u_admin, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', v_q1, v_keys));
    v_out := pg_temp.fq_revise(u_admin, v_q1, (select jsonb_agg(case
        when i.id = v_item_por then jsonb_build_object('source', 'parent', 'parent_item_id', i.id, 'state', 'zero_confirmed', 'state_reason', '検査')
        when i.id = v_item_porline then jsonb_build_object('source', 'parent', 'parent_item_id', i.id, 'state', 'excluded')
        else jsonb_build_object('source', 'parent', 'parent_item_id', i.id) end order by i.sort_order)
      from public.quote_items i where i.quote_id = v_q1 and i.kind not in ('base_expense', 'option_expense', 'interior_exterior_expense')));
    v_capture := coalesce((select (q2.base_price = q1.base_price and q2.base_expense = q1.base_expense and q2.option_subtotal = q1.option_subtotal
                                   and q2.option_expense = q1.option_expense and q2.installation_subtotal = q1.installation_subtotal
                                   and q2.subtotal = q1.subtotal and q2.tax = q1.tax and q2.total = q1.total)::text
                             from public.quotes q2, public.quotes q1 where q2.id::text = v_out and q1.id = v_q1), v_out);
    raise exception 'fq_rollback';
  exception when raise_exception then
    if sqlerrm <> 'fq_rollback' then raise; end if;
  end;
  perform pg_temp.fq_expect_eq('D1-6b 前の版の行を何も変えずに写すと、第 1 版と同じ金額になる（本部が出す場合）', 'true', v_capture);
  -- 第 2 版の明細：設備1（そのまま）・取付費（数量 2）・価格未確定の商品（0円確定）・設備2＋大 × 2（商品台帳）・運搬費 50,000（別途工事の自由明細）
  v_lines := jsonb_build_array(
    jsonb_build_object('source', 'parent', 'parent_item_id', v_item_o1),
    jsonb_build_object('source', 'parent', 'parent_item_id', v_item_fee, 'quantity', '2'),
    jsonb_build_object('source', 'parent', 'parent_item_id', v_item_porline, 'state', 'excluded', 'state_reason', 'お客様手配'),
    jsonb_build_object('source', 'parent', 'parent_item_id', v_item_por, 'state', 'zero_confirmed', 'state_reason', 'お客様と合意のうえ今回は見送り'),
    jsonb_build_object('source', 'catalog', 'section', 'option', 'option_id', o2, 'variant_choice_ids', jsonb_build_array(c_o2), 'quantity', '2'),
    jsonb_build_object('source', 'manual', 'section', 'sitework', 'name', '運搬費', 'unit', '式', 'quantity', '1', 'unit_price', 50000));

  perform pg_temp.fq_expect_error('D1-7 旧来の改訂（create_quote_revision）は、v2.5 の見積を止める', 'P0001', 'LOCKED',
    pg_temp.fq_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, ''[]''::jsonb, null)::text', v_q1)));
  perform pg_temp.fq_expect_error('D1-8 担当外の代理店・総代理店は発行できない', '42501', 'FORBIDDEN',
    pg_temp.fq_revise(u_master, v_q1, v_lines));
  perform pg_temp.fq_expect_error('D1-9 お客様が選んだ別途見積の商品（設備3）の確認が無ければ発行しない', 'P0001', 'VALIDATION: お客様が選んだ',
    pg_temp.fq_revise(u_dealer, v_q1, v_lines));
  select string_agg(e ->> 'key', ',') into v_keys from jsonb_array_elements(public.configuration_por_selections(v_cfg)) e;
  perform pg_temp.fq_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', v_q1, v_keys));
  perform pg_temp.fq_expect_error('D1-10 価格未確定の行を残したままは発行しない（#529 と同じ判定）', 'P0001', 'VALIDATION: 金額が未確定',
    pg_temp.fq_revise(u_dealer, v_q1, jsonb_build_array(
      jsonb_build_object('source', 'parent', 'parent_item_id', v_item_o1),
      jsonb_build_object('source', 'parent', 'parent_item_id', v_item_por))));
  perform pg_temp.fq_expect_error('D1-11 前の版の行の単価は変えられない（画面から来た単価で合計を作らない）', 'P0001', 'VALIDATION',
    pg_temp.fq_revise(u_dealer, v_q1, jsonb_build_array(jsonb_build_object('source', 'parent', 'parent_item_id', v_item_o1, 'unit_price', 1))));
  perform pg_temp.fq_expect_error('D1-12 代理店は本体の自由明細を足せない', '42501', 'FORBIDDEN',
    pg_temp.fq_revise(u_dealer, v_q1, v_lines || jsonb_build_array(
      jsonb_build_object('source', 'manual', 'section', 'base', 'name', '本体の追加', 'quantity', '1', 'unit_price', 1000))));
  perform pg_temp.fq_expect_error('D1-13 価格未確定の商品（別途見積）は商品台帳から足せない', 'P0001', 'VALIDATION',
    pg_temp.fq_revise(u_dealer, v_q1, v_lines || jsonb_build_array(
      jsonb_build_object('source', 'catalog', 'section', 'option', 'option_id', o3, 'variant_choice_ids', '[]'::jsonb))));
  perform pg_temp.fq_expect_error('D1-14 この見積の商品モデルで選べない商品は足せない', 'P0001', 'VALIDATION',
    pg_temp.fq_revise(u_dealer, v_q1, v_lines || jsonb_build_array(
      jsonb_build_object('source', 'catalog', 'section', 'option', 'option_id', o4, 'variant_choice_ids', '[]'::jsonb))));
  perform pg_temp.fq_expect_error('D1-15 商品は、その商品の区分にだけ足せる（施工の商品をオプションには足せない）', 'P0001', 'VALIDATION',
    pg_temp.fq_revise(u_dealer, v_q1, v_lines || jsonb_build_array(
      jsonb_build_object('source', 'catalog', 'section', 'option', 'option_id', o5, 'variant_choice_ids', '[]'::jsonb))));
  perform pg_temp.fq_expect_error('D1-16 経費の行は指定できない（区分の小計から作り直す）', 'P0001', 'VALIDATION',
    pg_temp.fq_revise(u_dealer, v_q1, v_lines || jsonb_build_array(jsonb_build_object('source', 'parent', 'parent_item_id',
      (select i.id from public.quote_items i where i.quote_id = v_q1 and i.kind = 'option_expense')))));
  perform pg_temp.fq_expect_error('D1-17 0円確定は理由が必須', 'P0001', 'VALIDATION',
    pg_temp.fq_revise(u_dealer, v_q1, jsonb_build_array(jsonb_build_object('source', 'parent', 'parent_item_id', v_item_por, 'state', 'zero_confirmed'))));
  perform pg_temp.fq_expect_error('D1-18 調整額を変えるときは理由が必須', 'P0001', 'VALIDATION',
    pg_temp.fq_revise(u_dealer, v_q1, v_lines, -1000, null));
  perform pg_temp.fq_expect_error('D1-19 自由明細の売価は 0 円以上', 'P0001', 'VALIDATION',
    pg_temp.fq_revise(u_dealer, v_q1, jsonb_build_array(jsonb_build_object('source', 'manual', 'section', 'option', 'name', '値引き', 'quantity', '1', 'unit_price', -100))));
  perform pg_temp.fq_expect_error('D1-20 状態の印を備考に直接書けない', 'P0001', 'VALIDATION',
    pg_temp.fq_revise(u_dealer, v_q1, jsonb_build_array(jsonb_build_object('source', 'manual', 'section', 'option', 'name', '値引き', 'quantity', '1', 'unit_price', 0,
      'remark', '［今回の契約対象外］'))));

  -- 別途見積の行に担当者が売価を入れると、確定の行になる（未確定の目印を外す）。確かめた後は取り消す
  begin
    v_out := pg_temp.fq_revise(u_dealer, v_q1, jsonb_build_array(
      jsonb_build_object('source', 'parent', 'parent_item_id', v_item_o1),
      jsonb_build_object('source', 'parent', 'parent_item_id', v_item_porline, 'unit_price', 30000),
      jsonb_build_object('source', 'parent', 'parent_item_id', v_item_por, 'state', 'zero_confirmed', 'state_reason', '検査')));
    v_capture := coalesce((select unit_price || '/' || amount || '/' || coalesce(remark, '(なし)') || '/' || total
                             from public.quote_items i join public.quotes q on q.id = i.quote_id
                            where i.quote_id::text = v_out and i.name = '据付工事'), v_out);
    raise exception 'fq_rollback';
  exception when raise_exception then
    if sqlerrm <> 'fq_rollback' then raise; end if;
  end;
  -- 設備1 32,100 ＋ 30,000 ＝ 62,100、経費 9,315 → 本体 403,111 と合わせて税抜 474,526・税 47,452
  perform pg_temp.fq_expect_eq('D1-20b 別途見積の行に担当者が売価を入れると確定の行になる（未確定の目印を外し、その売価で計算する）',
    '30000/30000/(なし)/521978', v_capture);
  perform pg_temp.fq_expect_error('D1-20c 別途見積の行を 0 円にするときは「0円確定」を選ぶ（売価 0 は受け付けない）', 'P0001', 'VALIDATION',
    pg_temp.fq_revise(u_dealer, v_q1, jsonb_build_array(jsonb_build_object('source', 'parent', 'parent_item_id', v_item_porline, 'unit_price', 0))));
  perform pg_temp.fq_expect_error('D1-20d 「価格未確定の商品」（選んだ商品の集約の行）には金額を入れられない', 'P0001', 'VALIDATION',
    pg_temp.fq_revise(u_dealer, v_q1, jsonb_build_array(jsonb_build_object('source', 'parent', 'parent_item_id', v_item_por, 'unit_price', 30000))));
  perform pg_temp.fq_expect_error('D1-20e 必須の仕様（色）を選ばない商品は足せない', 'P0001', 'VALIDATION: 1 行目：「D1 設備6',
    pg_temp.fq_revise(u_dealer, v_q1, jsonb_build_array(jsonb_build_object('source', 'catalog', 'section', 'option', 'option_id', o6, 'variant_choice_ids', '[]'::jsonb))));
  -- 版の選択枠と同じ商品（設備1）を足すと、売価は版の売価、原価の記録は版に固定した原価（公開の後に原価を改定しても）
  perform pg_temp.fq_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 25000, %s, ''改定'')', o1,
    (select lock_version from public.option_hq_standard_costs where option_id = o1)));
  begin
    v_out := pg_temp.fq_revise(u_dealer, v_q1, jsonb_build_array(
      jsonb_build_object('source', 'parent', 'parent_item_id', v_item_por, 'state', 'zero_confirmed', 'state_reason', '検査'),
      jsonb_build_object('source', 'parent', 'parent_item_id', v_item_porline, 'state', 'excluded'),
      jsonb_build_object('source', 'catalog', 'section', 'option', 'option_id', o1, 'variant_choice_ids', '[]'::jsonb)));
    v_capture := coalesce((select i.unit_price || '/' || p.standard_cost
                             from public.quote_items i join public.quote_item_cost_pins p on p.quote_item_id = i.id
                            where i.quote_id::text = v_out and i.option_id = o1), v_out);
    raise exception 'fq_rollback';
  exception when raise_exception then
    if sqlerrm <> 'fq_rollback' then raise; end if;
  end;
  perform pg_temp.fq_expect_eq('D1-20f 版の選択枠と同じ商品は、版の売価（32,100）と版に固定した原価（20,000。改定後の 25,000 ではない）を記録する',
    '32100/20000', v_capture);

  -- ---------- 第 2 版の発行 ----------
  -- オプション：設備1 32,100 ＋ 取付費 20,000 ＋ 0 ＋ 設備2 大 17,655 × 2 ＝ 35,310 → 87,410、経費 trunc(87,410 × 0.15) ＝ 13,111
  -- 別途工事 50,000（経費なし）。本体 350,532 ＋ 52,579（代理店なので前の版のまま）。税抜 553,632・税 55,363・税込 608,995（千円未満の切り捨てなし）
  v_out := pg_temp.fq_revise(u_dealer, v_q1, v_lines);
  v_q2 := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.fq_expect_eq('D1-21 第 2 版の金額はサーバーの v2.5 の計算（区分の経費・税は trunc、千円未満の切り捨てなし）',
    '350532/52579/87410/13111/50000/0/553632/55363/608995',
    coalesce((select base_price || '/' || base_expense || '/' || option_subtotal || '/' || option_expense || '/' || installation_subtotal || '/' ||
                     adjustment || '/' || subtotal || '/' || tax || '/' || total from public.quotes where id = v_q2), v_out));
  perform pg_temp.fq_expect_eq('D1-22 第 2 版は正式見積で、同じ版・計算ルールを引き継ぎ、前の版は superseded、案件は第 2 版を指す',
    'formal/v2.5/true/superseded/true/2',
    coalesce((select q.quote_kind || '/' || q.pricing_model || '/' || (q.standard_estimate_revision_id = v_rev)::text || '/' ||
                     (select status from public.quotes where id = v_q1) || '/' ||
                     ((select quote_id from public.quote_requests where id = q.quote_request_id) = q.id)::text || '/' || q.revision::text
                from public.quotes q where q.id = v_q2), v_out));
  perform pg_temp.fq_expect_eq('D1-23 明細：本体は前の版のまま、商品台帳の商品は名前に選択肢、0円確定は印、経費の行はサーバーが作る',
    'base:350532/option:D1 設備1:32100/option:取付費:20000/option:据付工事:0/option:価格未確定の商品:0:［0円確定］：お客様と合意のうえ今回は見送り/option:D1 設備2 ／ サイズ：大:35310/option_expense:13111/installation:運搬費:50000',
    coalesce((select string_agg(case
        when kind = 'base' then 'base:' || (select sum(amount) from public.quote_items b where b.quote_id = v_q2 and b.kind = 'base')
        when kind = 'option_expense' then 'option_expense:' || amount
        when name = '価格未確定の商品' then kind || ':' || name || ':' || amount || ':' || coalesce(remark, '')
        else kind || ':' || name || ':' || amount end, '/' order by sort_order)
      from public.quote_items where quote_id = v_q2 and kind <> 'base_expense' and not (kind = 'base' and sort_order > 1)), v_out));
  perform pg_temp.fq_expect_eq('D1-24 足した商品の原価の Version を社内の記録に残す（足した時点。率は版の率）',
    '10000/1000/true/1.0700/1.5000',
    coalesce((select p.standard_cost || '/' || p.variant_adjustment || '/' ||
                     (p.standard_cost_version_id = (select id from public.option_standard_cost_versions where option_id = o2 and superseded_at is null))::text || '/' ||
                     p.sales_fee_rate || '/' || p.markup_rate
                from public.quote_item_cost_pins p where p.quote_id = v_q2), v_out));
  perform pg_temp.fq_expect_eq('D1-25 原価の記録は本部だけが読める（担当の代理店は 0 件）', '1/0',
    pg_temp.fq_run_as('authenticated', u_admin, format('select count(*)::text from public.quote_item_cost_pins where quote_id = %L', v_q2)) || '/' ||
    pg_temp.fq_run_as('authenticated', u_dealer, format('select count(*)::text from public.quote_item_cost_pins where quote_id = %L', v_q2)));
  perform pg_temp.fq_expect_error('D1-26 原価の記録は変えられない', '42501', '',
    pg_temp.fq_run_as('authenticated', u_admin, format('update public.quote_item_cost_pins set standard_cost = 1 where quote_id = %L returning quote_id::text', v_q2)));
  perform pg_temp.fq_expect_error('D1-27 前の版（superseded）からは改訂できない', 'P0001', 'LOCKED',
    pg_temp.fq_revise(u_dealer, v_q1, v_lines));

  -- ---------- 第 3 版（本部）：本体の数量を変え、調整額（理由つき） ----------
  v_lines := (select jsonb_agg(jsonb_build_object('source', 'parent', 'parent_item_id', i.id) order by i.sort_order)
                from public.quote_items i where i.quote_id = v_q2 and i.kind not in ('base_expense', 'option_expense', 'interior_exterior_expense'));
  -- お客様が選んだ別途見積の商品の確認は、発行する担当者が版ごとにする（#529 と同じ）
  perform pg_temp.fq_expect_error('D1-27b 別の担当者（本部）は、自分の確認が無ければ発行できない', 'P0001', 'VALIDATION: お客様が選んだ',
    pg_temp.fq_revise(u_admin, v_q2, v_lines, -3632, '端数の調整（お客様と合意）'));
  perform pg_temp.fq_run_as('authenticated', u_admin, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', v_q2, v_keys));
  v_out := pg_temp.fq_revise(u_admin, v_q2, v_lines, -3632, '端数の調整（お客様と合意）');
  v_q3 := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.fq_expect_eq('D1-28 第 3 版：前の版の行をそのまま写すと同じ金額。調整額（理由つき）を引いた税抜 550,000・税 55,000',
    '553632/-3632/550000/55000/605000/端数の調整（お客様と合意）',
    coalesce((select (subtotal - adjustment) || '/' || adjustment || '/' || subtotal || '/' || tax || '/' || total || '/' || adjustment_reason
                from public.quotes where id = v_q3), v_out));
  perform pg_temp.fq_expect_eq('D1-29 第 3 版の明細の 0円確定の印・商品の行（商品台帳の紐付け・足した時点の原価の記録）は前の版のまま',
    '［0円確定］：お客様と合意のうえ今回は見送り/D1 設備2 ／ サイズ：大/true',
    coalesce((select remark from public.quote_items where quote_id = v_q3 and name = '価格未確定の商品') || '/' ||
             (select name from public.quote_items where quote_id = v_q3 and option_id = o2) || '/' ||
             (select (p3.standard_cost_version_id = p2.standard_cost_version_id and p3.standard_cost = p2.standard_cost)::text
                from public.quote_item_cost_pins p3, public.quote_item_cost_pins p2
               where p3.quote_id = v_q3 and p2.quote_id = v_q2), v_out));
  perform pg_temp.fq_expect_eq('D1-30 お客様は第 3 版（正式見積）を承諾できる', 'accepted',
    pg_temp.fq_run_as('authenticated', u_customer, format('select (public.respond_to_quote(%L, ''accepted'')).status', v_q3)));

  -- ---------- 旧来の見積は変わらない・承諾済みの概算からの確定 ----------
  set local session_replication_role = replica;
  insert into public.quote_requests (id, configuration_id, user_id, status)
  values ('2a200000-0000-4000-8000-000000000901', v_cfg, u_customer, 'sent');
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, base_model_name, base_price, option_subtotal, installation_subtotal, subtotal, tax_rate, tax, total, revision)
  values ('2a200000-0000-4000-8000-000000000902', 'RT-FQ-LEGACY', '2a200000-0000-4000-8000-000000000901', v_cfg, u_customer, u_dealer, 'issued',
          now() + interval '30 days', 'お客様', 'D1 検査モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 1);
  update public.quote_requests set quote_id = '2a200000-0000-4000-8000-000000000902' where id = '2a200000-0000-4000-8000-000000000901';
  set local session_replication_role = origin;
  v_legacy_quote := '2a200000-0000-4000-8000-000000000902';
  perform pg_temp.fq_expect_error('D1-31 旧来の見積（v2.5 でない）は、v2.5 の発行では扱わない', 'P0001', 'LOCKED',
    pg_temp.fq_revise(u_dealer, v_legacy_quote, '[]'::jsonb));
  set local session_replication_role = replica;
  update public.quotes set status = 'accepted' where id = v_q1;
  update public.quote_requests set quote_id = v_q1 where id = (select quote_request_id from public.quotes where id = v_q1);
  set local session_replication_role = origin;
  perform pg_temp.fq_expect_error('D1-32 承諾済みの概算からの確定（旧来）も、v2.5 の見積を止める', 'P0001', 'LOCKED',
    pg_temp.fq_run_as('authenticated', u_dealer, format('select public.create_formal_quote_from_accepted_preliminary(%L, ''[]''::jsonb, null)::text', v_q1)));
  perform pg_temp.fq_expect_eq('D1-33 権限：発行・編集画面の値はログインした担当者だけ（ログインしていない人・service_role は実行できない）', 'false/false/true/false',
    has_function_privilege('anon', 'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)', 'EXECUTE')::text || '/' ||
    has_function_privilege('service_role', 'public.get_quote_v25_units(uuid, jsonb)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.get_quote_v25_context(uuid)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.quote_v25_editable(uuid)', 'EXECUTE')::text);
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _fq_result;

rollback;
