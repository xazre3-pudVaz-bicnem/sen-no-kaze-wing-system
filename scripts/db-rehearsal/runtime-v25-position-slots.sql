-- v2.5 PR-S1：窓タイプと、位置・用途ごとの選択枠・枠ごとの選べる商品の実行時検査。使い捨てDB専用。最後に rollback する。
begin;

create temp table _psl_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _psl_result to public;

create function pg_temp.psl_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.psl_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _psl_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.psl_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _psl_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || ':%');
$fn$;

-- 下書きの保存の中身（率は C1 と同じ 1.07・1.5・0.15）。slots は jsonb の配列
create function pg_temp.psl_payload(p_slots jsonb) returns text
language sql as $fn$
  select jsonb_build_object(
    'rates', jsonb_build_object('sales_fee_rate', '1.07', 'markup_rate', '1.5', 'expense_rate', '0.15'),
    'adjustment', 0, 'adjustment_reason', null,
    'slots', p_slots,
    'lines', '[]'::jsonb)::text;
$fn$;

-- 選択枠 1 行（位置の枠は slot_code・slot_label・選べる商品つき）
create function pg_temp.psl_slot(p_option uuid, p_choices jsonb, p_slot_code text, p_slot_label text, p_selectable jsonb, p_quantity text default '1')
returns jsonb
language sql as $fn$
  select jsonb_build_object('baseline_key', null, 'option_id', p_option, 'variant_choice_ids', p_choices, 'quantity', p_quantity,
                            'price_mode', 'auto', 'manual_unit_price', null,
                            'slot_code', p_slot_code, 'slot_label', p_slot_label, 'selectable_option_ids', p_selectable);
$fn$;

-- お客様のプランの保存（新しいプラン。カテゴリー単位の選択は o1、位置の選択は p_slots）
create function pg_temp.psl_save(p_customer uuid, p_model uuid, p_option_ids uuid[], p_slots jsonb, p_id uuid default null, p_lock integer default null,
                                  p_level text default 'full')
returns text
language sql as $fn$
  select pg_temp.psl_run_as('authenticated', p_customer, format(
    $q$ select (public.save_configuration_atomic(
          p_configuration_id => %L, p_base_model_id => %L, p_name => 'S1 検査', p_option_ids => %L::uuid[],
          p_preview_image_url => null, p_notes => null, p_finish_level => %L, p_variant_choice_ids => '{}'::uuid[],
          p_spec_code => 'office', p_exterior_faces => '[]'::jsonb, p_expected_lock_version => %L::integer,
          p_slot_selections => %L::jsonb)).id::text $q$,
    p_id, p_model, p_option_ids, p_level, p_lock, p_slots));
$fn$;

do $test$
declare
  u_admin constant uuid := '29100000-0000-4000-8000-000000000001';
  u_editor constant uuid := '29100000-0000-4000-8000-000000000002';
  u_customer constant uuid := '29100000-0000-4000-8000-000000000003';
  org_hq constant uuid := '29100000-0000-4000-8000-000000000101';
  m_model constant uuid := '29100000-0000-4000-8000-000000000201';
  mr_office constant uuid := '29100000-0000-4000-8000-000000000301';
  cat_sash constant uuid := '29100000-0000-4000-8000-000000000401';
  cat_opt constant uuid := '29100000-0000-4000-8000-000000000402';
  s1 constant uuid := '29100000-0000-4000-8000-000000000501';
  s2 constant uuid := '29100000-0000-4000-8000-000000000502';
  s3 constant uuid := '29100000-0000-4000-8000-000000000503';
  s4 constant uuid := '29100000-0000-4000-8000-000000000504';
  s5 constant uuid := '29100000-0000-4000-8000-000000000505';
  s6 constant uuid := '29100000-0000-4000-8000-000000000508';
  o1 constant uuid := '29100000-0000-4000-8000-000000000506';
  o2 constant uuid := '29100000-0000-4000-8000-000000000507';
  g_color constant uuid := '29100000-0000-4000-8000-000000000601';
  c_white constant uuid := '29100000-0000-4000-8000-000000000701';
  c_black constant uuid := '29100000-0000-4000-8000-000000000702';
  g_o2 constant uuid := '29100000-0000-4000-8000-000000000602';
  c_o2 constant uuid := '29100000-0000-4000-8000-000000000703';
  v_bmr text;
  v_se text;
  v_master uuid;
  v_rev uuid;
  v_rev2 uuid;
  v_rev3 uuid;
  v_pin uuid;
  v_out text;
  v_view jsonb;
  v_money jsonb;
  v_cfg uuid;
  v_cfg2 uuid;
  v_copy uuid;
  v_quote uuid;
  v_wall_cat uuid;
  v_slots_ok jsonb;
  v_lock integer;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'psl-admin@runtime.invalid', '{}'::jsonb), (u_editor, 'psl-editor@runtime.invalid', '{}'::jsonb),
         (u_customer, 'psl-customer@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'psl-admin@runtime.invalid', 'global admin', 'admin'),
         (u_editor, 'psl-editor@runtime.invalid', 'HQ editor', 'customer'),
         (u_customer, 'psl-customer@runtime.invalid', 'customer', 'customer');
  insert into public.organizations (id, code, name, organization_type, status)
  values (org_hq, 'runtime-psl-hq', 'S1 Runtime HQ', 'headquarters', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values (org_hq, u_editor, 'editor', 'active');
  -- 仕様 office をお客様が選べるように Preset を持たせる（保存の関数の仕様の確認）
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-psl-model', 'S1 検査モデル', 1000000, 'published',
          '[{"code":"office","name":"事務所","option_codes":[]}]'::jsonb);
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_office, m_model, 'office', '2100x4550', false);
  -- サッシ（1 つだけ選べる・窓タイプを使う）と、ほかの商品のカテゴリー。本体分類表に対応の無いカテゴリーは、どの仕様でも選べる（区分はオプション）
  insert into public.option_categories (id, code, name, status, selection_mode, uses_window_type)
  values (cat_sash, 'runtime-psl-sash', 'S1 サッシ', 'published', 'single', true),
         (cat_opt, 'runtime-psl-option', 'S1 設備', 'published', 'multi', false);
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation)
  values
    (s1, cat_sash, 'runtime-psl-s1', 'S1 サッシ1（02609）', 30000, false, 'published', 'PRD-939001', false),
    (s2, cat_sash, 'runtime-psl-s2', 'S1 サッシ2', 40000, false, 'published', 'PRD-939002', false),
    (s3, cat_sash, 'runtime-psl-s3', 'S1 サッシ3（選べる商品に入れない）', 50000, false, 'published', 'PRD-939003', false),
    (s4, cat_sash, 'runtime-psl-s4', 'S1 サッシ4（販売停止にする）', 45000, false, 'published', 'PRD-939004', false),
    (s5, cat_sash, 'runtime-psl-s5', 'S1 サッシ5（削除の確認）', 46000, false, 'published', 'PRD-939005', false),
    (s6, cat_sash, 'runtime-psl-s6', 'S1 サッシ6（ホテル用）', 47000, false, 'published', 'PRD-939008', false),
    (o1, cat_opt, 'runtime-psl-o1', 'S1 設備1', 20000, false, 'published', 'PRD-939006', false),
    (o2, cat_opt, 'runtime-psl-o2', 'S1 設備2', 10000, false, 'published', 'PRD-939007', false);
  -- サッシ6 はホテル用の仕様だけの商品（事務所用の標準見積の選べる商品にはできない）
  update public.options set spec_codes = '{hotel}' where id = s6;
  insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
  values (g_color, s1, 'color', '色', 1, true, 'published'), (g_o2, o2, 'size', 'サイズ', 1, false, 'published');
  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status, sort_order)
  values (c_white, g_color, 'white', '白', 'standard', 0, 'published', 1),
         (c_black, g_color, 'black', '黒', 'option', 3000, 'published', 2),
         (c_o2, g_o2, 'large', '大', 'option', 1000, 'published', 1);
  set local session_replication_role = origin;

  -- ---------- 窓タイプ ----------
  perform pg_temp.psl_expect_eq('S1-1 窓タイプの初期 4 件（FIX窓・引違い窓・縦すべり出し窓・横すべり出し窓）。ログインしていない人も読める',
    'FIX窓・引違い窓・縦すべり出し窓・横すべり出し窓',
    pg_temp.psl_run_as('anon', null, 'select string_agg(label, ''・'' order by sort_order) from public.window_types where status = ''active'''));
  perform pg_temp.psl_expect_eq('S1-2 窓タイプのマスターは本部だけが足せる（お客様は RLS で拒否）', 'true',
    (pg_temp.psl_run_as('authenticated', u_customer, 'insert into public.window_types (code, label) values (''bay'', ''出窓'') returning code') like 'ERROR 42501:%')::text);
  perform pg_temp.psl_expect_eq('S1-3 本部は窓タイプを足せる', 'bay',
    pg_temp.psl_run_as('authenticated', u_admin, 'insert into public.window_types (code, label, sort_order) values (''bay'', ''出窓'', 50) returning code'));
  perform pg_temp.psl_expect_eq('S1-4 サッシ（窓タイプを使うカテゴリー）の商品には窓タイプを設定できる', 'sliding',
    pg_temp.psl_run_as('authenticated', u_admin, format('update public.options set window_type_code = ''sliding'' where id = %L returning window_type_code', s1)));
  perform pg_temp.psl_expect_error('S1-5 窓タイプを使わないカテゴリーの商品には設定できない', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_admin, format('update public.options set window_type_code = ''fix'' where id = %L returning window_type_code', o1)));
  perform pg_temp.psl_run_as('authenticated', u_admin, 'update public.window_types set status = ''retired'' where code = ''bay'' returning code');
  perform pg_temp.psl_expect_error('S1-6 使われなくなった（retired）窓タイプは新しく設定できない', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_admin, format('update public.options set window_type_code = ''bay'' where id = %L returning window_type_code', s2)));
  perform pg_temp.psl_expect_error('S1-7 窓タイプの設定された商品があるカテゴリーは、窓タイプの設定を外せない', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_admin, format('update public.option_categories set uses_window_type = false where id = %L returning code', cat_sash)));
  perform pg_temp.psl_expect_eq('S1-8 窓タイプは商品の列として、ログインしていない人も読める（原価の列は読めない）', 'sliding/denied',
    pg_temp.psl_run_as('anon', null, format('select window_type_code from public.options where id = %L', s1)) || '/' ||
    case when pg_temp.psl_run_as('anon', null, format('select price::text from public.options where id = %L', s1)) like 'ERROR 42501:%' then 'denied' else 'readable' end);

  -- ---------- 原価の Version（本部）と、本体・標準見積の準備 ----------
  perform pg_temp.psl_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 30000, 0, ''検査'')', s1));
  perform pg_temp.psl_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 40000, 0, ''検査'')', s2));
  perform pg_temp.psl_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 50000, 0, ''検査'')', s3));
  perform pg_temp.psl_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 45000, 0, ''検査'')', s4));
  perform pg_temp.psl_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 20000, 0, ''検査'')', o1));
  perform pg_temp.psl_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 10000, 0, ''検査'')', o2));
  perform pg_temp.psl_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 0, null, ''検査'')', c_white));
  perform pg_temp.psl_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 3000, null, ''検査'')', c_black));
  perform pg_temp.psl_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 1000, null, ''検査'')', c_o2));

  v_bmr := pg_temp.psl_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, 'S1 本体', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_office));
  perform pg_temp.psl_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, 'S1 本体', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr));
  perform pg_temp.psl_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr));
  v_se := pg_temp.psl_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr));
  select r.standard_estimate_master_id into v_master from public.standard_estimate_revisions r where r.id::text = v_se;
  v_rev := pg_temp.psl_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master))::uuid;

  -- ---------- 下書きの保存：位置・用途の選択枠 ----------
  -- カテゴリー単位の枠（設備1）と、サッシの位置の枠 3 つ（掃出し窓＝サッシ1 白・選べる商品にサッシ2、開き窓①②＝同じサッシ1 の白・黒）
  v_slots_ok := jsonb_build_array(
    pg_temp.psl_slot(o1, '[]'::jsonb, null, null, '[]'::jsonb),
    pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hakidashi', '掃出し窓', jsonb_build_array(s2)),
    pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hiraki-1', '開き窓①', '[]'::jsonb),
    pg_temp.psl_slot(s1, jsonb_build_array(c_black), 'hiraki-2', '開き窓②', '[]'::jsonb));
  perform pg_temp.psl_expect_error('S1-10 位置・用途の名前だけ（識別子なし）は保存できない', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
      pg_temp.psl_payload(jsonb_build_array(pg_temp.psl_slot(s1, jsonb_build_array(c_white), null, '掃出し窓', '[]'::jsonb))))));
  perform pg_temp.psl_expect_error('S1-11 識別子の形式（英小文字・数字・ハイフン）', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
      pg_temp.psl_payload(jsonb_build_array(pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'Hakidashi 1', '掃出し窓', '[]'::jsonb))))));
  perform pg_temp.psl_expect_error('S1-12 同じ識別子の枠を 2 つ保存できない', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
      pg_temp.psl_payload(jsonb_build_array(
        pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hakidashi', '掃出し窓', '[]'::jsonb),
        pg_temp.psl_slot(s2, '[]'::jsonb, 'hakidashi', '洗面窓', '[]'::jsonb))))));
  perform pg_temp.psl_expect_error('S1-13 同じカテゴリーに同じ名前の位置を 2 つ保存できない', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
      pg_temp.psl_payload(jsonb_build_array(
        pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hakidashi', '掃出し窓', '[]'::jsonb),
        pg_temp.psl_slot(s2, '[]'::jsonb, 'hakidashi-2', '掃出し窓', '[]'::jsonb))))));
  perform pg_temp.psl_expect_error('S1-14 位置の枠の数量は 1', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
      pg_temp.psl_payload(jsonb_build_array(pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hakidashi', '掃出し窓', '[]'::jsonb, '2'))))));
  perform pg_temp.psl_expect_error('S1-15 選べる商品は、標準の商品と同じカテゴリーの商品だけ', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
      pg_temp.psl_payload(jsonb_build_array(pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hakidashi', '掃出し窓', jsonb_build_array(o1)))))));
  perform pg_temp.psl_expect_error('S1-16 選べる商品は、位置・用途の枠にだけ指定できる', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
      pg_temp.psl_payload(jsonb_build_array(pg_temp.psl_slot(o1, '[]'::jsonb, null, null, jsonb_build_array(o2)))))));
  perform pg_temp.psl_expect_error('S1-17 カテゴリー単位の枠は、これまでどおり同じ商品を 2 つ持てない', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
      pg_temp.psl_payload(jsonb_build_array(
        pg_temp.psl_slot(o1, '[]'::jsonb, null, null, '[]'::jsonb),
        pg_temp.psl_slot(o1, '[]'::jsonb, null, null, '[]'::jsonb))))));
  -- 外壁には位置の枠を作れない（外壁のカテゴリーが無い DB では作る。試験のため商品2 を一時的に外壁へ移す）
  select id into v_wall_cat from public.option_categories where code = 'exterior-wall';
  if v_wall_cat is null then
    set local session_replication_role = replica;
    insert into public.option_categories (id, code, name, status) values ('29100000-0000-4000-8000-000000000403', 'exterior-wall', '外壁（検査）', 'published');
    set local session_replication_role = origin;
    v_wall_cat := '29100000-0000-4000-8000-000000000403';
  end if;
  set local session_replication_role = replica;
  update public.options set category_id = v_wall_cat where id = o2;
  set local session_replication_role = origin;
  perform pg_temp.psl_expect_error('S1-18 外壁には位置・用途の選択枠を作れない', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
      pg_temp.psl_payload(jsonb_build_array(pg_temp.psl_slot(o2, '[]'::jsonb, 'front-wall', '正面の壁', '[]'::jsonb))))));
  set local session_replication_role = replica;
  update public.options set category_id = cat_opt where id = o2;
  set local session_replication_role = origin;

  v_out := pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.psl_payload(v_slots_ok)));
  perform pg_temp.psl_expect_eq('S1-19 位置の枠 3 つ（同じ商品を 2 つの位置で使う）とカテゴリー単位の枠を保存できる', '3',
    v_out);
  perform pg_temp.psl_expect_eq('S1-20 位置の識別子・名前と選べる商品を保存する（選べる商品は位置の枠にだけ）',
    'hakidashi:掃出し窓:1/hiraki-1:開き窓①:0/hiraki-2:開き窓②:0',
    (select string_agg(bi.slot_code || ':' || bi.slot_label || ':' ||
              (select count(*)::text from public.standard_estimate_revision_slot_options so where so.revision_id = bi.revision_id and so.slot_code = bi.slot_code),
              '/' order by bi.slot_code)
       from public.standard_estimate_revision_baseline_items bi where bi.revision_id = v_rev and bi.slot_code is not null));

  -- ---------- 公開の決まり ----------
  -- カテゴリー単位の枠と位置の枠を同じカテゴリーに混ぜた下書きは公開できない（サッシ3 をカテゴリー単位で足す）
  perform pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 3, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.psl_payload(v_slots_ok || jsonb_build_array(pg_temp.psl_slot(s3, '[]'::jsonb, null, null, '[]'::jsonb)))));
  v_out := pg_temp.psl_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 4)).status', v_rev));
  perform pg_temp.psl_expect_eq('S1-21 カテゴリー単位の枠と位置の枠を同じカテゴリーに混ぜた版は公開できない', 'true',
    (v_out like 'ERROR P0001: LOCKED: シミュレーターの選択枠の決まりに合わないため公開できません（%カテゴリー単位の選択枠と位置・用途の選択枠を、同じカテゴリーに混ぜられません：「S1 サッシ」%')::text);
  -- 販売停止の商品を選べる商品に入れた版は公開できない
  perform pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 4, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.psl_payload(jsonb_build_array(
      pg_temp.psl_slot(o1, '[]'::jsonb, null, null, '[]'::jsonb),
      pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hakidashi', '掃出し窓', jsonb_build_array(s2, s4)),
      pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hiraki-1', '開き窓①', '[]'::jsonb),
      pg_temp.psl_slot(s1, jsonb_build_array(c_black), 'hiraki-2', '開き窓②', '[]'::jsonb)))));
  set local session_replication_role = replica;
  update public.options set archived_at = now() where id = s4;
  set local session_replication_role = origin;
  v_out := pg_temp.psl_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 5)).status', v_rev));
  perform pg_temp.psl_expect_eq('S1-22 販売停止の商品を選べる商品に入れた版は公開できない', 'true',
    (v_out like 'ERROR P0001: LOCKED: シミュレーターの選択枠の決まりに合わないため公開できません（%選べる商品は%「S1 サッシ4（販売停止にする）」%')::text);
  set local session_replication_role = replica;
  update public.options set archived_at = null where id = s4;
  set local session_replication_role = origin;
  perform pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 5, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.psl_payload(v_slots_ok)));
  v_out := pg_temp.psl_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 6)).status', v_rev));
  -- 本体 350,532 ＋ 経費 52,579、オプション：設備1 32,100 ＋ サッシ1 白 48,150 × 2 ＋ サッシ1 黒 52,965 ＝ 181,365、経費 27,204 → 税抜 611,680・税 61,168
  perform pg_temp.psl_expect_eq('S1-23 1 つだけ選べるカテゴリーでも、位置の枠は位置ごとに 1 つ選ぶので公開できる（税込 672,848 円）', 'published/672848',
    v_out || '/' || (select total::text from public.standard_estimate_revisions where id = v_rev));
  perform pg_temp.psl_expect_eq('S1-24 ログインした利用者（本部も）は選べる商品の表へ直接書けない（v2.5 の画面の保存からだけ）', 'true',
    (pg_temp.psl_run_as('authenticated', u_admin, format('insert into public.standard_estimate_revision_slot_options (revision_id, slot_code, option_id) values (%L, ''hiraki-1'', %L) returning slot_code', v_rev, s2))
       like 'ERROR 42501:%')::text);
  -- 権限のある接続から直接書いても、公開した版は変えられない（トリガー）
  begin
    insert into public.standard_estimate_revision_slot_options (revision_id, slot_code, option_id) values (v_rev, 'hiraki-1', s2);
    v_out := 'inserted';
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  perform pg_temp.psl_expect_error('S1-24b 公開した版の選べる商品は、トリガーでも変えられない', 'P0001', 'LOCKED', v_out);
  perform pg_temp.psl_expect_eq('S1-25 お客様は版の選べる商品の表を直接読めない（RLS）', '0',
    pg_temp.psl_run_as('authenticated', u_customer, format('select count(*)::text from public.standard_estimate_revision_slot_options where revision_id = %L', v_rev)));

  -- ---------- 売価だけの形（シミュレーターに渡す） ----------
  v_view := public.standard_estimate_v25_sale_view(v_rev, false);
  perform pg_temp.psl_expect_eq('S1-26 選択枠に位置の識別子・名前・選べる商品（標準の商品が先頭）を持たせる',
    'hakidashi/掃出し窓/2/true',
    (select x.value ->> 'slot_code' || '/' || (x.value ->> 'slot_label') || '/' || jsonb_array_length(x.value -> 'selectable_option_ids')::text || '/' ||
            ((x.value #>> '{selectable_option_ids,0}') = s1::text)::text
       from jsonb_array_elements(v_view -> 'baseline') x(value) where x.value ->> 'slot_code' = 'hakidashi'));
  perform pg_temp.psl_expect_eq('S1-27 見積書の明細の区分名は「カテゴリー（位置）」、カテゴリー単位の枠は選べる商品なし',
    'S1 サッシ（掃出し窓）/(null)',
    (select x.value ->> 'group_label' from jsonb_array_elements(v_view -> 'lines') x(value) where x.value ->> 'slot_code' = 'hakidashi') || '/' ||
    coalesce((select x.value ->> 'selectable_option_ids' from jsonb_array_elements(v_view -> 'baseline') x(value) where x.value ->> 'option_id' = o1::text), '(null)'));

  -- ---------- 売価単価：位置の枠ごと ----------
  -- 公開の後に黒の原価差額を 3,000 → 4,000 にする。開き窓② の標準（サッシ1 黒）は固定した原価のまま、ほかの位置・カテゴリー単位は今の原価
  perform pg_temp.psl_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 4000, %L, ''改定'')', c_black,
    (select v.id from public.option_variant_cost_versions v where v.variant_choice_id = c_black and v.superseded_at is null)));
  perform pg_temp.psl_expect_eq('S1-28 位置の枠は、その枠の標準と同じ「商品＋選択肢」だけ公開した版の売価（開き窓② 52,965）、ほかの位置・カテゴリー単位は今の原価（54,570）',
    '52965/54570/54570/48150',
    coalesce(public.standard_estimate_v25_selection_unit(v_rev, s1, array[c_black], 'hiraki-2')::text, 'null') || '/' ||
    coalesce(public.standard_estimate_v25_selection_unit(v_rev, s1, array[c_black], 'hiraki-1')::text, 'null') || '/' ||
    coalesce(public.standard_estimate_v25_selection_unit(v_rev, s1, array[c_black])::text, 'null') || '/' ||
    coalesce(public.standard_estimate_v25_selection_unit(v_rev, s1, array[c_white], 'hiraki-1')::text, 'null'));

  -- ---------- お客様のプランの保存：位置ごとの選択 ----------
  perform pg_temp.psl_expect_error('S1-30 スイッチが切れている間は、位置ごとの選択を保存しない', 'P0001', 'VALIDATION',
    pg_temp.psl_save(u_customer, m_model, array[o1], jsonb_build_array(
      jsonb_build_object('slot_code', 'hakidashi', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)))));
  perform pg_temp.psl_expect_eq('S1-31 前提：有効な標準見積がすべて v2.5 なので、本部はスイッチを入れられる', 'true',
    pg_temp.psl_run_as('authenticated', u_admin, 'select public.set_simulator_standard_pricing(true)::text'));
  perform pg_temp.psl_expect_error('S1-32 版の位置の枠がそろっていない保存は止める', 'P0001', 'VALIDATION',
    pg_temp.psl_save(u_customer, m_model, array[o1], jsonb_build_array(
      jsonb_build_object('slot_code', 'hakidashi', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)),
      jsonb_build_object('slot_code', 'hiraki-1', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)))));
  perform pg_temp.psl_expect_error('S1-33 その位置で選べない商品は保存できない（開き窓① は標準の商品だけ）', 'P0001', 'VALIDATION',
    pg_temp.psl_save(u_customer, m_model, array[o1], jsonb_build_array(
      jsonb_build_object('slot_code', 'hakidashi', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)),
      jsonb_build_object('slot_code', 'hiraki-1', 'option_id', s2, 'variant_choice_ids', '[]'::jsonb),
      jsonb_build_object('slot_code', 'hiraki-2', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_black)))));
  perform pg_temp.psl_expect_error('S1-34 版に無い位置は保存できない', 'P0001', 'VALIDATION',
    pg_temp.psl_save(u_customer, m_model, array[o1], jsonb_build_array(
      jsonb_build_object('slot_code', 'hakidashi', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)),
      jsonb_build_object('slot_code', 'hiraki-1', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)),
      jsonb_build_object('slot_code', 'hiraki-2', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_black)),
      jsonb_build_object('slot_code', 'senmen', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)))));
  perform pg_temp.psl_expect_error('S1-35 位置ごとの選択の選択肢は、その商品のものだけ', 'P0001', 'VALIDATION',
    pg_temp.psl_save(u_customer, m_model, array[o1], jsonb_build_array(
      jsonb_build_object('slot_code', 'hakidashi', 'option_id', s2, 'variant_choice_ids', jsonb_build_array(c_white)),
      jsonb_build_object('slot_code', 'hiraki-1', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)),
      jsonb_build_object('slot_code', 'hiraki-2', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_black)))));
  perform pg_temp.psl_expect_error('S1-36 位置で選ぶカテゴリーの商品を、カテゴリー単位でも選ぶ保存は止める', 'P0001', 'VALIDATION',
    pg_temp.psl_save(u_customer, m_model, array[o1, s3], jsonb_build_array(
      jsonb_build_object('slot_code', 'hakidashi', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)),
      jsonb_build_object('slot_code', 'hiraki-1', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)),
      jsonb_build_object('slot_code', 'hiraki-2', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_black)))));
  v_out := pg_temp.psl_save(u_customer, m_model, array[o1], jsonb_build_array(
    jsonb_build_object('slot_code', 'hakidashi', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)),
    jsonb_build_object('slot_code', 'hiraki-1', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)),
    jsonb_build_object('slot_code', 'hiraki-2', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_black))));
  v_cfg := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.psl_expect_eq('S1-37 標準のままの位置ごとの選択を保存できる（1 つだけ選べるサッシでも、位置ごとなら 3 行）。合計は公開した版と同じ',
    '3/672848',
    (select count(*)::text from public.configuration_items where configuration_id = v_cfg and slot_code is not null) || '/' ||
    coalesce((select total::text from public.configurations where id = v_cfg), v_out));
  v_lock := (select lock_version from public.configurations where id = v_cfg);
  v_out := pg_temp.psl_save(u_customer, m_model, array[o1], jsonb_build_array(
    jsonb_build_object('slot_code', 'hakidashi', 'option_id', s2, 'variant_choice_ids', '[]'::jsonb),
    jsonb_build_object('slot_code', 'hiraki-1', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white)),
    jsonb_build_object('slot_code', 'hiraki-2', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_black))), v_cfg, v_lock);
  -- 掃出し窓をサッシ2（64,200）に：オプション 181,365 ＋ 16,050 ＝ 197,415、経費 29,612 → 税抜 630,138・税 63,013
  perform pg_temp.psl_expect_eq('S1-38 掃出し窓を選べる商品（サッシ2）に変えると、その位置の差額で計算する（税込 693,151 円）', '693151',
    coalesce((select total::text from public.configurations where id = v_cfg), v_out));
  v_money := public.standard_estimate_v25_configuration_money(v_cfg, v_rev);
  perform pg_temp.psl_expect_eq('S1-39 区分の変更差額は位置ごとの差の合計', '16050',
    v_money #>> '{sections,option,delta_line}');

  -- ---------- 見積依頼・複製 ----------
  v_out := pg_temp.psl_run_as('authenticated', u_customer, format(
    $q$ select (public.create_quote_from_configuration(%L, '{"full_name":"検査"}'::jsonb, null, %s))::text $q$,
    v_cfg, (select lock_version from public.configurations where id = v_cfg)));
  select q.id into v_quote from public.quotes q join public.quote_requests r on r.id = q.quote_request_id where r.configuration_id = v_cfg;
  perform pg_temp.psl_expect_eq('S1-40 見積依頼の明細に、位置ごとの選んだ商品・仕様を 0 円の写しで残す（標準から変えた位置は印つき）',
    'S1 サッシ（掃出し窓）:S1 サッシ2:0:標準から変更/S1 サッシ（開き窓①）:S1 サッシ1（02609） ／ 色：白:0:標準の商品/S1 サッシ（開き窓②）:S1 サッシ1（02609） ／ 色：黒:0:標準の商品',
    coalesce((select string_agg(qi.name || ':' || qi.description || ':' || qi.amount::text || ':' ||
                       case when qi.remark like '%標準から変更%' then '標準から変更' else '標準の商品' end, '/' order by qi.sort_order)
                from public.quote_items qi where qi.quote_id = v_quote and qi.name like 'S1 サッシ（%'), v_out));
  perform pg_temp.psl_expect_eq('S1-41 見積の合計は保存したプランと同じ', '693151',
    coalesce((select total::text from public.quotes where id = v_quote), v_out));
  v_out := pg_temp.psl_run_as('authenticated', u_customer, format('select (public.duplicate_configuration(%L)).id::text', v_cfg));
  v_copy := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.psl_expect_eq('S1-42 プランの複製は、位置ごとの選択を位置のまま写す', 'hakidashi,hiraki-1,hiraki-2',
    coalesce((select string_agg(slot_code, ',' order by slot_code) from public.configuration_items where configuration_id = v_copy and slot_code is not null), v_out));

  -- ---------- 版が変わった後の古い保存 ----------
  -- 次の版：開き窓① をやめて開き窓③ にする（識別子 hiraki-3）。古い保存は見積を依頼できない（保存し直してから）
  v_rev2 := pg_temp.psl_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, null)::text', v_master))::uuid;
  perform pg_temp.psl_expect_eq('S1-43 公開した版から作る次の下書きに、位置の識別子・名前・選べる商品を引き継ぐ', 'hakidashi:掃出し窓:1/hiraki-1:開き窓①:0/hiraki-2:開き窓②:0',
    coalesce((select string_agg(bi.slot_code || ':' || bi.slot_label || ':' ||
              (select count(*)::text from public.standard_estimate_revision_slot_options so where so.revision_id = bi.revision_id and so.slot_code = bi.slot_code),
              '/' order by bi.slot_code)
       from public.standard_estimate_revision_baseline_items bi where bi.revision_id = v_rev2 and bi.slot_code is not null), 'none'));
  perform pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, %s, %L::jsonb)).lock_version::text', v_rev2,
    (select lock_version from public.standard_estimate_revisions where id = v_rev2),
    pg_temp.psl_payload(jsonb_build_array(
      pg_temp.psl_slot(o1, '[]'::jsonb, null, null, '[]'::jsonb),
      pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hakidashi', '掃出し窓', jsonb_build_array(s2)),
      pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hiraki-3', '開き窓③', '[]'::jsonb),
      pg_temp.psl_slot(s1, jsonb_build_array(c_black), 'hiraki-2', '開き窓②', '[]'::jsonb)))));
  -- 開き窓② の黒は前の版の原価を引き継いでいる（S1-28 で改定済み）。公開の前に最新原価を取り込む（v2.5 の決まり）
  perform pg_temp.psl_run_as('authenticated', u_editor, format('select (public.refresh_standard_estimate_v25_costs(%L, %s)).lock_version::text', v_rev2,
    (select lock_version from public.standard_estimate_revisions where id = v_rev2)));
  v_out := pg_temp.psl_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, %s)).status', v_rev2,
    (select lock_version from public.standard_estimate_revisions where id = v_rev2)));
  perform pg_temp.psl_expect_eq('S1-44 前提：位置を変えた次の版を、最新原価を取り込んでから公開できた', 'published', v_out);
  perform pg_temp.psl_expect_eq('S1-44b 最新原価を取り込むと、開き窓② の売価も今の原価になる（54,570）', '54570',
    coalesce(public.standard_estimate_v25_selection_unit(v_rev2, s1, array[c_black], 'hiraki-2')::text, 'null'));
  perform pg_temp.psl_expect_error('S1-45 版の位置が変わった後の古い保存は、見積を依頼できない（保存し直してから）', 'P0001', 'LOCKED',
    pg_temp.psl_run_as('authenticated', u_customer, format(
      $q$ select (public.create_quote_from_configuration(%L, '{"full_name":"検査"}'::jsonb, null, %s))::text $q$,
      v_copy, (select lock_version from public.configurations where id = v_copy))));
  perform pg_temp.psl_expect_eq('S1-46 前の版の位置ごとの売価は、前の版のまま（公開した版は変えない）', '52965',
    coalesce(public.standard_estimate_v25_selection_unit(v_rev, s1, array[c_black], 'hiraki-2')::text, 'null'));

  -- ---------- 商品の安全な削除 ----------
  -- 下書きの版の選べる商品にだけ入っている商品（サッシ5）も、使っている商品として削除しない
  v_out := pg_temp.psl_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, null)::text', v_master));
  v_rev3 := v_out::uuid;
  perform pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, %s, %L::jsonb)).lock_version::text', v_out::uuid,
    (select lock_version from public.standard_estimate_revisions where id::text = v_out),
    pg_temp.psl_payload(jsonb_build_array(
      pg_temp.psl_slot(o1, '[]'::jsonb, null, null, '[]'::jsonb),
      pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hakidashi', '掃出し窓', jsonb_build_array(s2, s5)),
      pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hiraki-3', '開き窓③', '[]'::jsonb),
      pg_temp.psl_slot(s1, jsonb_build_array(c_black), 'hiraki-2', '開き窓②', '[]'::jsonb)))));
  perform pg_temp.psl_expect_eq('S1-47 前提：下書きの選べる商品にサッシ5 が入った', '1',
    (select count(*)::text from public.standard_estimate_revision_slot_options so where so.revision_id::text = v_out and so.option_id = s5));
  -- サッシ5 には原価の履歴も保存したプランも無い（選べる商品の参照だけで止まることを確かめる）
  perform pg_temp.psl_expect_error('S1-48 選べる商品で使っている商品は、未使用の登録済み商品の削除でも削除できない（使っている商品と同じ案内）', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_admin, format('select public.delete_unused_published_option(%L)::text', s5)));
  perform pg_temp.psl_expect_eq('S1-49 前提：削除されずに残っている', '1', (select count(*)::text from public.options where id = s5));

  -- ---------- 注文範囲の外の位置 ----------
  -- サッシ・設備のカテゴリーは注文範囲「すべて（full）」。「設備まで（equipment）」に狭めたプランでは、位置を選ばない・選ばせない
  v_out := pg_temp.psl_save(u_customer, m_model, '{}'::uuid[], '[]'::jsonb, null, null, 'equipment');
  perform pg_temp.psl_expect_eq('S1-50 注文範囲の外の位置は選ばなくてよい（範囲を狭めたプランを保存できる）', 'true',
    (v_out ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.psl_expect_error('S1-51 注文範囲の外の位置は選べない', 'P0001', 'VALIDATION',
    pg_temp.psl_save(u_customer, m_model, '{}'::uuid[], jsonb_build_array(
      jsonb_build_object('slot_code', 'hakidashi', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white))), null, null, 'equipment'));

  -- ---------- ログインなしの一時保存 ----------
  perform pg_temp.psl_expect_eq('S1-52 一時保存に位置ごとの選択を持てる（形だけ確かめる。版との照らし合わせは保存のとき）', 'true',
    (pg_temp.psl_run_as('service_role', null, format($q$ select public.create_guest_plan(%L, %L, %L::jsonb)::text $q$,
      repeat('a', 64), m_model,
      jsonb_build_object('option_ids', jsonb_build_array(o1), 'spec_code', 'office', 'slot_selections', jsonb_build_array(
        jsonb_build_object('slot_code', 'hakidashi', 'option_id', s1, 'variant_choice_ids', jsonb_build_array(c_white))))))
     not like 'ERROR%')::text);
  perform pg_temp.psl_expect_error('S1-53 一時保存の位置ごとの選択の形が正しくなければ止める', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('service_role', null, format($q$ select public.create_guest_plan(%L, %L, %L::jsonb)::text $q$,
      repeat('b', 64), m_model,
      jsonb_build_object('spec_code', 'office', 'slot_selections', jsonb_build_array(jsonb_build_object('slot_code', 'Bad Code', 'option_id', s1))))));

  -- ---------- 仕様で選べない商品・原価の固定の引き継ぎ（独立レビューの指摘への対応） ----------
  perform pg_temp.psl_expect_error('S1-54 この仕様（事務所用）で選べない商品は、選べる商品にできない', 'P0001', 'VALIDATION',
    pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, %s, %L::jsonb)).lock_version::text', v_rev3,
      (select lock_version from public.standard_estimate_revisions where id = v_rev3),
      pg_temp.psl_payload(jsonb_build_array(
        pg_temp.psl_slot(o1, '[]'::jsonb, null, null, '[]'::jsonb),
        pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hakidashi', '掃出し窓', jsonb_build_array(s6)),
        pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hiraki-3', '開き窓③', '[]'::jsonb),
        pg_temp.psl_slot(s1, jsonb_build_array(c_black), 'hiraki-2', '開き窓②', '[]'::jsonb))))));
  -- 下書きの開き窓② の黒は 4,000 円の原価差額に固定されている。原価差額を 5,000 円に改定した後、位置の識別子だけを変えて保存し直しても、
  -- 同じ行（baseline_key）の同じ「商品＋選択肢」なので固定を引き継ぐ（v2.5 の「原価 Version は黙って更新しない」）
  select bv.variant_cost_version_id into v_pin
    from public.standard_estimate_revision_baseline_items bi
    join public.standard_estimate_revision_baseline_variants bv on bv.baseline_item_id = bi.id
   where bi.revision_id = v_rev3 and bi.slot_code = 'hiraki-2';
  perform pg_temp.psl_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 5000, %L, ''改定'')', c_black,
    (select v.id from public.option_variant_cost_versions v where v.variant_choice_id = c_black and v.superseded_at is null)));
  perform pg_temp.psl_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, %s, %L::jsonb)).lock_version::text', v_rev3,
    (select lock_version from public.standard_estimate_revisions where id = v_rev3),
    pg_temp.psl_payload(jsonb_build_array(
      pg_temp.psl_slot(o1, '[]'::jsonb, null, null, '[]'::jsonb),
      pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hakidashi', '掃出し窓', jsonb_build_array(s2)),
      pg_temp.psl_slot(s1, jsonb_build_array(c_white), 'hiraki-3', '開き窓③', '[]'::jsonb),
      pg_temp.psl_slot(s1, jsonb_build_array(c_black), 'hiraki-2b', '開き窓②', '[]'::jsonb)
        || jsonb_build_object('baseline_key', (select bi.baseline_key from public.standard_estimate_revision_baseline_items bi
                                                where bi.revision_id = v_rev3 and bi.slot_code = 'hiraki-2'))))));
  perform pg_temp.psl_expect_eq('S1-55 位置の識別子だけを変えて保存し直しても、同じ行の原価の固定は変わらない（原価を改定した後でも）', 'true/true',
    coalesce((select (bv.variant_cost_version_id = v_pin)::text
       from public.standard_estimate_revision_baseline_items bi
       join public.standard_estimate_revision_baseline_variants bv on bv.baseline_item_id = bi.id
      where bi.revision_id = v_rev3 and bi.slot_code = 'hiraki-2b'), 'none') || '/' ||
    (v_pin is not null)::text);
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _psl_result;

rollback;
