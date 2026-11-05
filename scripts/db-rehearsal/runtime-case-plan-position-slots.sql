-- v2.5 PR-S2b：案件の画面のプランボードに、位置・用途の選択枠ごとの商品を出す（get_case_plan_configuration）の実行時検査。
-- 使い捨てDB専用。最後に rollback する。
begin;

create temp table _cps_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _cps_result to public;

create function pg_temp.cps_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.cps_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _cps_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.cps_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _cps_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || '%');
$fn$;

do $test$
declare
  u_admin constant uuid := '2a400000-0000-4000-8000-000000000001';
  u_editor constant uuid := '2a400000-0000-4000-8000-000000000002';
  u_customer constant uuid := '2a400000-0000-4000-8000-000000000003';
  u_dealer constant uuid := '2a400000-0000-4000-8000-000000000004';
  u_dealer2 constant uuid := '2a400000-0000-4000-8000-000000000005';
  org_hq constant uuid := '2a400000-0000-4000-8000-000000000101';
  m_model constant uuid := '2a400000-0000-4000-8000-000000000201';
  mr_office constant uuid := '2a400000-0000-4000-8000-000000000301';
  cat_sash constant uuid := '2a400000-0000-4000-8000-000000000401';
  cat_opt constant uuid := '2a400000-0000-4000-8000-000000000402';
  s1 constant uuid := '2a400000-0000-4000-8000-000000000501';
  s2 constant uuid := '2a400000-0000-4000-8000-000000000502';
  o1 constant uuid := '2a400000-0000-4000-8000-000000000503';
  g_color constant uuid := '2a400000-0000-4000-8000-000000000601';
  c_white constant uuid := '2a400000-0000-4000-8000-000000000701';
  v_bmr text;
  v_se text;
  v_master uuid;
  v_rev uuid;
  v_out text;
  v_cfg uuid;
  v_quote uuid;
  v_plan jsonb;
  v_slot jsonb;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'cps-admin@runtime.invalid', '{}'::jsonb), (u_editor, 'cps-editor@runtime.invalid', '{}'::jsonb),
         (u_customer, 'cps-customer@runtime.invalid', '{}'::jsonb), (u_dealer, 'cps-dealer@runtime.invalid', '{}'::jsonb),
         (u_dealer2, 'cps-dealer2@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'cps-admin@runtime.invalid', '本部', 'admin'),
         (u_editor, 'cps-editor@runtime.invalid', 'HQ editor', 'customer'),
         (u_customer, 'cps-customer@runtime.invalid', 'お客様', 'customer'),
         (u_dealer, 'cps-dealer@runtime.invalid', '担当代理店', 'dealer'),
         (u_dealer2, 'cps-dealer2@runtime.invalid', '担当外の代理店', 'dealer');
  insert into public.organizations (id, code, name, organization_type, status)
  values (org_hq, 'runtime-cps-hq', 'S2b Runtime HQ', 'headquarters', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values (org_hq, u_editor, 'editor', 'active');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-cps-model', 'S2b 検査モデル', 1000000, 'published', '[{"code":"office","name":"事務所","option_codes":[]}]'::jsonb);
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_office, m_model, 'office', '2100x4550', false);
  insert into public.option_categories (id, code, name, status, selection_mode, uses_window_type)
  values (cat_sash, 'runtime-cps-sash', 'S2b サッシ', 'published', 'single', true),
         (cat_opt, 'runtime-cps-option', 'S2b 設備', 'published', 'multi', false);
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation)
  values
    (s1, cat_sash, 'runtime-cps-s1', 'S2b サッシ1', 30000, false, 'published', 'PRD-946001', false),
    (s2, cat_sash, 'runtime-cps-s2', 'S2b サッシ2', 40000, false, 'published', 'PRD-946002', false),
    (o1, cat_opt, 'runtime-cps-o1', 'S2b 設備1', 20000, false, 'published', 'PRD-946003', false);
  insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
  values (g_color, s1, 'color', '色', 1, true, 'published');
  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status, sort_order)
  values (c_white, g_color, 'white', '白', 'standard', 0, 'published', 1);
  set local session_replication_role = origin;

  perform pg_temp.cps_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 30000, 0, ''検査'')', s1));
  perform pg_temp.cps_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 40000, 0, ''検査'')', s2));
  perform pg_temp.cps_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 20000, 0, ''検査'')', o1));
  perform pg_temp.cps_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 0, null, ''検査'')', c_white));

  -- 本体と v2.5 の標準見積：設備1（カテゴリー単位）と、サッシの位置 2 つ（掃出し窓＝サッシ1 白・選べる商品にサッシ2、開き窓①＝サッシ1 白）
  v_bmr := pg_temp.cps_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, 'S2b 本体', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_office));
  perform pg_temp.cps_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, 'S2b 本体', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr));
  perform pg_temp.cps_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr));
  v_se := pg_temp.cps_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr));
  select r.standard_estimate_master_id into v_master from public.standard_estimate_revisions r where r.id::text = v_se;
  v_rev := pg_temp.cps_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master))::uuid;
  v_slot := jsonb_build_object('baseline_key', null, 'variant_choice_ids', '[]'::jsonb, 'quantity', '1', 'price_mode', 'auto',
                               'manual_unit_price', null, 'slot_code', null, 'slot_label', null, 'selectable_option_ids', '[]'::jsonb);
  perform pg_temp.cps_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, %s, %L::jsonb)).lock_version::text', v_rev,
    (select lock_version from public.standard_estimate_revisions where id = v_rev),
    jsonb_build_object(
      'rates', jsonb_build_object('sales_fee_rate', '1.07', 'markup_rate', '1.5', 'expense_rate', '0.15'),
      'adjustment', 0, 'adjustment_reason', null,
      'slots', jsonb_build_array(
        v_slot || jsonb_build_object('option_id', o1),
        v_slot || jsonb_build_object('option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white), 'slot_code', 'hakidashi', 'slot_label', '掃出し窓',
                                     'selectable_option_ids', jsonb_build_array(s2)),
        v_slot || jsonb_build_object('option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white), 'slot_code', 'hiraki-1', 'slot_label', '開き窓①')),
      'lines', '[]'::jsonb)));
  v_out := pg_temp.cps_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, %s)).status', v_rev,
    (select lock_version from public.standard_estimate_revisions where id = v_rev)));
  perform pg_temp.cps_expect_eq('S2b-0 前提：位置の枠のある v2.5 の標準見積を公開でき、スイッチを入れられる', 'published/true',
    v_out || '/' || pg_temp.cps_run_as('authenticated', u_admin, 'select public.set_simulator_standard_pricing(true)::text'));

  -- お客様：掃出し窓をサッシ2 に変え、開き窓① は標準のまま、設備1 を選んで保存し、見積を依頼する
  v_out := pg_temp.cps_run_as('authenticated', u_customer, format(
    $q$ select (public.save_configuration_atomic(
          p_configuration_id => null, p_base_model_id => %L, p_name => 'S2b 検査', p_option_ids => %L::uuid[],
          p_preview_image_url => null, p_notes => null, p_finish_level => 'full', p_variant_choice_ids => '{}'::uuid[],
          p_spec_code => 'office', p_exterior_faces => '[]'::jsonb, p_expected_lock_version => null::integer,
          p_slot_selections => %L::jsonb)).id::text $q$,
    m_model, array[o1], jsonb_build_array(
      jsonb_build_object('slot_code', 'hakidashi', 'option_id', s2, 'variant_choice_ids', '[]'::jsonb),
      jsonb_build_object('slot_code', 'hiraki-1', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)))));
  v_cfg := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  v_out := pg_temp.cps_run_as('authenticated', u_customer, format(
    $q$ select (public.create_quote_from_configuration(%L, '{"full_name":"検査"}'::jsonb, null, %s))::text $q$,
    v_cfg, (select lock_version from public.configurations where id = v_cfg)));
  select q.id into v_quote from public.quotes q join public.quote_requests r on r.id = q.quote_request_id where r.configuration_id = v_cfg;
  set local session_replication_role = replica;
  update public.quotes set dealer_id = u_dealer where id = v_quote;
  set local session_replication_role = origin;

  -- ---------- 案件のプランボードの読み取り ----------
  v_out := pg_temp.cps_run_as('authenticated', u_dealer, format('select public.get_case_plan_configuration(%L)::text', v_quote));
  v_plan := case when v_out like '{%' then v_out::jsonb end;
  perform pg_temp.cps_expect_eq('S2b-1 明細ごとに位置を返す（位置の明細は位置ごと、カテゴリー単位の明細は null）',
    'hakidashi:S2b サッシ2/hiraki-1:S2b サッシ1/-:S2b 設備1',
    coalesce((select string_agg(coalesce(i.value ->> 'slot_code', '-') || ':' || o.name, '/' order by coalesce(i.value ->> 'slot_code', 'zz'))
                from jsonb_array_elements(v_plan -> 'items') i
                join public.options o on o.id = (i.value ->> 'option_id')::uuid), v_out));
  perform pg_temp.cps_expect_eq('S2b-2 見積に固定した版の位置の枠（名前・区分・カテゴリー・標準の商品と選択肢。版の順）を返す',
    'hakidashi:掃出し窓:option:true:S2b サッシ1:1/hiraki-1:開き窓①:option:true:S2b サッシ1:1',
    coalesce((select string_agg((s.value ->> 'slot_code') || ':' || (s.value ->> 'slot_label') || ':' || (s.value ->> 'section_code') || ':' ||
                                ((s.value ->> 'category_id')::uuid = cat_sash)::text || ':' || o.name || ':' ||
                                jsonb_array_length(s.value -> 'standard_variant_choice_ids')::text, '/' order by s.ordinality)
                from jsonb_array_elements(v_plan -> 'position_slots') with ordinality s(value, ordinality)
                join public.options o on o.id = (s.value ->> 'standard_option_id')::uuid), v_out));
  perform pg_temp.cps_expect_eq('S2b-3 これまでの値（プランの名前・仕様・外壁）は変わらない', 'S2b 検査/office/[]',
    coalesce((v_plan #>> '{configuration,name}') || '/' || (v_plan #>> '{configuration,spec_code}') || '/' || (v_plan -> 'exterior_faces')::text, v_out));
  perform pg_temp.cps_expect_error('S2b-4 担当外の代理店は読めない（今と同じ）', '42501', 'FORBIDDEN',
    pg_temp.cps_run_as('authenticated', u_dealer2, format('select public.get_case_plan_configuration(%L)::text', v_quote)));
  -- v2.5 でない見積（版を固定していない）：位置の枠は空
  set local session_replication_role = replica;
  update public.quotes set pricing_model = null, standard_estimate_revision_id = null, calc_rule_version_id = null, tax_rule_version_id = null
   where id = v_quote;
  set local session_replication_role = origin;
  perform pg_temp.cps_expect_eq('S2b-5 v2.5 でない見積（版を固定していない）では、位置の枠は空', '[]',
    coalesce((pg_temp.cps_run_as('authenticated', u_admin, format('select public.get_case_plan_configuration(%L)::text', v_quote))::jsonb -> 'position_slots')::text, '(none)'));
  perform pg_temp.cps_expect_eq('S2b-6 権限は今のまま（ログインした担当者だけ。ログインしていない人は実行できない）', 'false/true',
    has_function_privilege('anon', 'public.get_case_plan_configuration(uuid)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.get_case_plan_configuration(uuid)', 'EXECUTE')::text);
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _cps_result;

rollback;
