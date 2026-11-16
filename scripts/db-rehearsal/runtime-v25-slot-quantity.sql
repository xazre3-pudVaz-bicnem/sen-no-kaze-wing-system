-- 標準見積 v2.5：選択枠の「選ぶ数」と「計上数量」を分ける（Issue #647・20261110130000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 屋根（1 つだけ選べるカテゴリーの唯一の枠）23.5㎡、床（位置の枠）1、設備（多く選べる）1 の版で、下書きの保存と開き直し・公開の判定・
-- お客様の保存の金額・見積依頼の行・Web 以外の下書きの行・次の版への写しを確かめる。
-- 率は販売費 100%・掛率 150%・経費 15%（屋根1 の原価 7,000 円/㎡ → 売価 10,500 円/㎡ → 23.5㎡ で 246,750 円。選択肢「別色」は原価 +500 円）
begin;

create temp table _q647_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _q647_result to public;

create function pg_temp.q647_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.q647_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _q647_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

-- 下書きの保存の中身。slots は jsonb の配列
create function pg_temp.q647_payload(p_slots jsonb) returns text
language sql as $fn$
  select jsonb_build_object(
    'rates', jsonb_build_object('sales_fee_rate', '1', 'markup_rate', '1.5', 'expense_rate', '0.15'),
    'adjustment', 0, 'adjustment_reason', null,
    'slots', p_slots,
    'lines', '[]'::jsonb)::text;
$fn$;

create function pg_temp.q647_slot(p_option uuid, p_quantity text, p_choices jsonb default '[]'::jsonb,
                                  p_slot_code text default null, p_slot_label text default null)
returns jsonb
language sql as $fn$
  select jsonb_build_object('baseline_key', null, 'option_id', p_option, 'variant_choice_ids', p_choices, 'quantity', p_quantity,
                            'price_mode', 'auto', 'manual_unit_price', null,
                            'slot_code', p_slot_code, 'slot_label', p_slot_label, 'selectable_option_ids', '[]'::jsonb);
$fn$;

-- お客様のプランの保存（カテゴリー単位の選択は p_option_ids と p_choices、位置の選択は p_slots）
create function pg_temp.q647_save(p_customer uuid, p_model uuid, p_option_ids uuid[], p_choices uuid[], p_slots jsonb,
                                  p_id uuid default null, p_lock integer default null)
returns text
language sql as $fn$
  select pg_temp.q647_run_as('authenticated', p_customer, format(
    $q$ select (public.save_configuration_atomic(
          p_configuration_id => %L, p_base_model_id => %L, p_name => '#647 検査', p_option_ids => %L::uuid[],
          p_preview_image_url => null, p_notes => null, p_finish_level => 'full', p_variant_choice_ids => %L::uuid[],
          p_spec_code => 'office', p_exterior_faces => '[]'::jsonb, p_expected_lock_version => %L::integer,
          p_slot_selections => %L::jsonb)).id::text $q$,
    p_id, p_model, p_option_ids, p_choices, p_lock, p_slots));
$fn$;

do $test$
declare
  u_admin constant uuid := '64700000-0000-4000-8000-000000000001';
  u_editor constant uuid := '64700000-0000-4000-8000-000000000002';
  u_customer constant uuid := '64700000-0000-4000-8000-000000000003';
  org_hq constant uuid := '64700000-0000-4000-8000-000000000101';
  m_model constant uuid := '64700000-0000-4000-8000-000000000201';
  mr_office constant uuid := '64700000-0000-4000-8000-000000000301';
  cat_roof constant uuid := '64700000-0000-4000-8000-000000000401';
  cat_floor constant uuid := '64700000-0000-4000-8000-000000000402';
  cat_multi constant uuid := '64700000-0000-4000-8000-000000000403';
  r1 constant uuid := '64700000-0000-4000-8000-000000000501';
  r2 constant uuid := '64700000-0000-4000-8000-000000000502';
  r3 constant uuid := '64700000-0000-4000-8000-000000000503';
  f1 constant uuid := '64700000-0000-4000-8000-000000000504';
  f2 constant uuid := '64700000-0000-4000-8000-000000000505';
  m1 constant uuid := '64700000-0000-4000-8000-000000000506';
  g_color constant uuid := '64700000-0000-4000-8000-000000000601';
  v_std constant uuid := '64700000-0000-4000-8000-000000000701';
  v_alt constant uuid := '64700000-0000-4000-8000-000000000702';
  v_bmr text;
  v_se text;
  v_master uuid;
  v_rev uuid;
  v_rev2 uuid;
  v_out text;
  v_view jsonb;
  v_money jsonb;
  v_cfg uuid;
  v_quote uuid;
  v_lock integer;
  v_hall jsonb;
  v_std_slots jsonb;
  v_total text;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'q647-admin@runtime.invalid', '{}'::jsonb), (u_editor, 'q647-editor@runtime.invalid', '{}'::jsonb),
         (u_customer, 'q647-customer@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'q647-admin@runtime.invalid', 'global admin', 'admin'),
         (u_editor, 'q647-editor@runtime.invalid', 'HQ editor', 'customer'),
         (u_customer, 'q647-customer@runtime.invalid', 'customer', 'customer');
  insert into public.organizations (id, code, name, organization_type, status)
  values (org_hq, 'runtime-q647-hq', '#647 Runtime HQ', 'headquarters', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values (org_hq, u_editor, 'editor', 'active');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-q647-model', '#647 検査モデル', 1000000, 'published',
          '[{"code":"office","name":"事務所","option_codes":[]}]'::jsonb);
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_office, m_model, 'office', '2100x4550', false);
  -- 屋根・床は 1 つだけ選べる、設備は多く選べる。本体分類表に対応の無いカテゴリーは、どの仕様でも選べる（区分はオプション）
  insert into public.option_categories (id, code, name, status, selection_mode)
  values (cat_roof, 'runtime-q647-roof', '#647 屋根', 'published', 'single'),
         (cat_floor, 'runtime-q647-floor', '#647 床', 'published', 'single'),
         (cat_multi, 'runtime-q647-multi', '#647 設備', 'published', 'multi');
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation, price_unit)
  values
    (r1, cat_roof, 'runtime-q647-r1', '#647 屋根1（標準）', 7000, false, 'published', 'PRD-964701', false, '㎡'),
    (r2, cat_roof, 'runtime-q647-r2', '#647 屋根2', 8000, false, 'published', 'PRD-964702', false, '㎡'),
    (r3, cat_roof, 'runtime-q647-r3', '#647 屋根3（単位が式）', 5000, false, 'published', 'PRD-964703', false, '式'),
    (f1, cat_floor, 'runtime-q647-f1', '#647 床1（標準）', 3000, false, 'published', 'PRD-964704', false, '㎡'),
    (f2, cat_floor, 'runtime-q647-f2', '#647 床2', 4000, false, 'published', 'PRD-964705', false, '㎡'),
    (m1, cat_multi, 'runtime-q647-m1', '#647 設備1', 20000, false, 'published', 'PRD-964706', false, '台');
  insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
  values (g_color, r1, 'color', '色', 1, true, 'published');
  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status, sort_order)
  values (v_std, g_color, 'std', '標準色', 'standard', 0, 'published', 1),
         (v_alt, g_color, 'alt', '別色', 'option', 0, 'published', 2);
  set local session_replication_role = origin;

  -- ---------- 原価の Version（本部）と、本体・標準見積の準備 ----------
  perform pg_temp.q647_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 7000, 0, ''検査'')', r1));
  perform pg_temp.q647_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 8000, 0, ''検査'')', r2));
  perform pg_temp.q647_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 5000, 0, ''検査'')', r3));
  perform pg_temp.q647_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 3000, 0, ''検査'')', f1));
  perform pg_temp.q647_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 4000, 0, ''検査'')', f2));
  perform pg_temp.q647_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 20000, 0, ''検査'')', m1));
  perform pg_temp.q647_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 0, null, ''検査'')', v_std));
  perform pg_temp.q647_run_as('authenticated', u_admin, format('select changed::text from public.set_option_variant_cost_adjustment(%L, 500, null, ''検査'')', v_alt));
  v_bmr := pg_temp.q647_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, '#647 本体', 'non_fire', null, %L)::text $q$, m_model, org_hq, mr_office));
  perform pg_temp.q647_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, '#647 本体', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr));
  perform pg_temp.q647_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr));
  v_se := pg_temp.q647_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr));
  select r.standard_estimate_master_id into v_master from public.standard_estimate_revisions r where r.id::text = v_se;
  v_rev := pg_temp.q647_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master))::uuid;

  -- ---------- 下書きの保存と開き直し ----------
  -- 屋根 23.5（カテゴリー単位の唯一の枠・標準色）、床の位置の枠（ホール・数量 1）、設備 1
  v_std_slots := jsonb_build_array(
    pg_temp.q647_slot(r1, '23.5', jsonb_build_array(v_std)),
    pg_temp.q647_slot(f1, '1', '[]'::jsonb, 'hall', 'ホール'),
    pg_temp.q647_slot(m1, '1'));
  v_out := pg_temp.q647_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.q647_payload(v_std_slots)));
  perform pg_temp.q647_expect_eq('Q647-1 屋根 23.5 の下書きを保存できる', '3', v_out);
  v_out := pg_temp.q647_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 3, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.q647_payload(v_std_slots)));
  perform pg_temp.q647_expect_eq('Q647-2 保存して開き直しても、数量 23.5・単位 ㎡・売価 10,500・金額 246,750 が保たれる',
    '4|23.5000/㎡/10500/246750',
    v_out || '|' || coalesce((select bi.quantity::text || '/' || coalesce(bi.unit_snapshot, '(null)') || '/' || bi.sale_unit_price::text || '/' || bi.amount::text
                                from public.standard_estimate_revision_baseline_items bi where bi.revision_id = v_rev and bi.option_id = r1), 'none'));
  perform pg_temp.q647_expect_eq('Q647-3 位置・用途の選択枠は今までどおり数量 1（1 以外は保存で止まる）', 'true',
    (pg_temp.q647_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 4, %L::jsonb)).lock_version::text', v_rev,
       pg_temp.q647_payload(jsonb_build_array(pg_temp.q647_slot(r1, '23.5', jsonb_build_array(v_std)),
                                              pg_temp.q647_slot(f1, '12.5', '[]'::jsonb, 'hall', 'ホール'), pg_temp.q647_slot(m1, '1')))))
      like 'ERROR P0001: VALIDATION: 商品 2 件目：位置・用途の選択枠の数量は 1 です%')::text);

  -- ---------- 公開の判定 ----------
  v_out := coalesce(public.standard_estimate_v25_slot_rule_issues(v_rev), '');
  perform pg_temp.q647_expect_eq('Q647-4 数量 1 以外の枠のカテゴリーに販売単位の違う商品があると公開できない（数量そのものは止めない）',
    'true/false',
    (v_out like '%数量が 1 以外の選択枠のカテゴリーの商品は、標準の商品と同じ販売単位にしてください：「#647 屋根3（単位が式）」（式）%')::text || '/' ||
    (v_out like '%外壁以外の選択枠の数量を 1 以外にできるのは%')::text);
  set local session_replication_role = replica;
  update public.options set price_unit = '㎡' where id = r3;
  set local session_replication_role = origin;
  perform pg_temp.q647_expect_eq('Q647-5 販売単位をそろえると、数量の判定は出ない（屋根 23.5㎡ の版）', '(none)',
    coalesce(public.standard_estimate_v25_slot_rule_issues(v_rev), '(none)'));
  -- 多く選べるカテゴリーの枠は、数量 1 以外にできない（どの選択に数量を掛けるか決まらない）
  perform pg_temp.q647_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 4, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.q647_payload(jsonb_build_array(pg_temp.q647_slot(r1, '23.5', jsonb_build_array(v_std)),
                                           pg_temp.q647_slot(f1, '1', '[]'::jsonb, 'hall', 'ホール'), pg_temp.q647_slot(m1, '2')))));
  perform pg_temp.q647_expect_eq('Q647-6 多く選べるカテゴリーの枠の数量 2 は公開の判定で止まる', 'true',
    (coalesce(public.standard_estimate_v25_slot_rule_issues(v_rev), '') like
       '%外壁以外の選択枠の数量を 1 以外にできるのは、1 つだけ選べるカテゴリーにその選択枠だけがあるときです%「#647 設備1」%')::text);
  -- 標準の商品の販売単位が未設定なら止まる
  set local session_replication_role = replica;
  update public.options set price_unit = null where id = r1;
  set local session_replication_role = origin;
  perform pg_temp.q647_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 5, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.q647_payload(v_std_slots)));
  perform pg_temp.q647_expect_eq('Q647-7 販売単位の無い標準の商品の数量 1 以外は止まる', 'true',
    (coalesce(public.standard_estimate_v25_slot_rule_issues(v_rev), '') like
       '%数量が 1 以外の選択枠には、商品台帳の販売単位（12 文字まで）が必要です%「#647 屋根1（標準）」%')::text);
  set local session_replication_role = replica;
  update public.options set price_unit = '㎡' where id = r1;
  set local session_replication_role = origin;
  perform pg_temp.q647_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 6, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.q647_payload(v_std_slots)));
  v_out := pg_temp.q647_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 7)).status', v_rev));
  perform pg_temp.q647_expect_eq('Q647-8 販売単位を設定して保存し直すと公開できる', 'published', v_out);

  -- ---------- 見積書の明細の形（売価だけの形） ----------
  v_view := public.standard_estimate_v25_sale_view(v_rev, false);
  perform pg_temp.q647_expect_eq('Q647-9 見積書の明細：屋根は 23.5 ㎡ × 10,500 ＝ 246,750、数量 1 の枠は今までどおり「式」',
    '23.5000:㎡:10500:246750/1.0000:式:4500:4500/1.0000:式:30000:30000',
    (select string_agg((x.value ->> 'quantity') || ':' || (x.value ->> 'unit') || ':' || (x.value ->> 'unit_price') || ':' || (x.value ->> 'amount'),
                       '/' order by x.ordinality)
       from jsonb_array_elements(v_view -> 'lines') with ordinality as x(value, ordinality)));
  perform pg_temp.q647_expect_eq('Q647-10 差額の基準：計上数量を掛ける枠の印と単位（版の中の行だけで決める）',
    '#647 屋根1（標準）:true:㎡/#647 床1（標準）:true:㎡/#647 設備1:true:台',
    (select string_agg(o.name || ':' || (x.value ->> 'measured') || ':' || coalesce(x.value ->> 'unit', '(null)'), '/' order by x.ordinality)
       from jsonb_array_elements(v_view -> 'baseline') with ordinality as x(value, ordinality)
       join public.options o on o.id = (x.value ->> 'option_id')::uuid));

  -- ---------- お客様のプランの保存（金額） ----------
  perform pg_temp.q647_expect_eq('Q647-11 前提：本部はスイッチを入れられる', 'true',
    pg_temp.q647_run_as('authenticated', u_admin, 'select public.set_simulator_standard_pricing(true)::text'));
  v_total := (select total::text from public.standard_estimate_revisions where id = v_rev);
  v_hall := jsonb_build_array(jsonb_build_object('slot_code', 'hall', 'option_id', f1, 'variant_choice_ids', '[]'::jsonb));
  v_out := pg_temp.q647_save(u_customer, m_model, array[r1, m1], array[v_std], v_hall);
  v_cfg := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  v_money := public.standard_estimate_v25_configuration_money(v_cfg, v_rev);
  perform pg_temp.q647_expect_eq('Q647-12 標準のままの保存は、差額 0・合計は公開した版と同じ（屋根 23.5㎡ を正しく数える）',
    '0/' || v_total || '/false',
    coalesce((v_money #>> '{sections,option,delta_line}') || '/' || (select total::text from public.configurations where id = v_cfg) || '/' ||
             (v_money ->> 'has_por'), v_out));
  v_lock := (select lock_version from public.configurations where id = v_cfg);
  v_out := pg_temp.q647_save(u_customer, m_model, array[r2, m1], '{}'::uuid[], v_hall, v_cfg, v_lock);
  perform pg_temp.q647_expect_eq('Q647-13 屋根を屋根2（12,000 円/㎡）に変えると、差額は 23.5㎡ 分（282,000 − 246,750 ＝ 35,250）', '35250',
    coalesce(public.standard_estimate_v25_configuration_money(v_cfg, v_rev) #>> '{sections,option,delta_line}', v_out));
  v_lock := (select lock_version from public.configurations where id = v_cfg);
  v_out := pg_temp.q647_save(u_customer, m_model, array[r1, m1], array[v_alt], v_hall, v_cfg, v_lock);
  perform pg_temp.q647_expect_eq('Q647-14 同じ屋根の別の選択肢は、今の原価の売価 × 23.5（264,375 − 246,750 ＝ 17,625）', '17625',
    coalesce(public.standard_estimate_v25_configuration_money(v_cfg, v_rev) #>> '{sections,option,delta_line}', v_out));
  -- 公開した後に屋根のカテゴリーを「多く選べる」に変えても、版の金額の決まりは変わらない（判定は版の中の行だけで行う）
  set local session_replication_role = replica;
  update public.option_categories set selection_mode = 'multi' where id = cat_roof;
  set local session_replication_role = origin;
  v_lock := (select lock_version from public.configurations where id = v_cfg);
  v_out := pg_temp.q647_save(u_customer, m_model, array[r1, m1], array[v_std], v_hall, v_cfg, v_lock);
  perform pg_temp.q647_expect_eq('Q647-15 公開した後にカテゴリーの「1 つだけ選べる」を外しても、標準のままの差額は 0', '0/' || v_total,
    coalesce((public.standard_estimate_v25_configuration_money(v_cfg, v_rev) #>> '{sections,option,delta_line}') || '/' ||
             (select total::text from public.configurations where id = v_cfg), v_out));
  set local session_replication_role = replica;
  update public.option_categories set selection_mode = 'single' where id = cat_roof;
  -- 公開した後に屋根1 の販売単位が変わっても、版の枠と同じ「商品＋選択肢」はそのまま。別の選択肢は価格未確定
  update public.options set price_unit = '式' where id = r1;
  set local session_replication_role = origin;
  perform pg_temp.q647_expect_eq('Q647-16 標準の商品の販売単位が後から変わっても、版の枠と同じ「商品＋選択肢」は差額 0。別の選択肢は価格未確定',
    '0/false|true',
    coalesce((public.standard_estimate_v25_configuration_money(v_cfg, v_rev) #>> '{sections,option,delta_line}') || '/' ||
             (public.standard_estimate_v25_configuration_money(v_cfg, v_rev) ->> 'has_por'), 'none') || '|' ||
    coalesce((public.standard_estimate_v25_slot_measure(v_rev, r1, array[v_alt], cat_roof, null) is null)::text, 'none'));
  set local session_replication_role = replica;
  update public.options set price_unit = '㎡' where id = r1;
  -- 公開した後に屋根3 の販売単位が変わったら、屋根3 には 23.5 を掛けず価格未確定にする（単位の違う商品に数量を掛けない）
  update public.options set price_unit = '式' where id = r3;
  set local session_replication_role = origin;
  v_lock := (select lock_version from public.configurations where id = v_cfg);
  v_out := pg_temp.q647_save(u_customer, m_model, array[r3, m1], '{}'::uuid[], v_hall, v_cfg, v_lock);
  v_money := public.standard_estimate_v25_configuration_money(v_cfg, v_rev);
  perform pg_temp.q647_expect_eq('Q647-17 販売単位の違う商品は計上数量を掛けず価格未確定（has_por）にする', 'true/-246750',
    coalesce((v_money ->> 'has_por') || '/' || (v_money #>> '{sections,option,delta_line}'), v_out));
  set local session_replication_role = replica;
  update public.options set price_unit = '㎡' where id = r3;
  set local session_replication_role = origin;

  -- ---------- 見積依頼の行 ----------
  v_lock := (select lock_version from public.configurations where id = v_cfg);
  v_out := pg_temp.q647_save(u_customer, m_model, array[r1, m1], array[v_std], v_hall, v_cfg, v_lock);
  v_out := pg_temp.q647_run_as('authenticated', u_customer, format(
    $q$ select (public.create_quote_from_configuration(%L, '{"full_name":"検査"}'::jsonb, null, %s))::text $q$,
    v_cfg, (select lock_version from public.configurations where id = v_cfg)));
  select q.id into v_quote from public.quotes q join public.quote_requests r on r.id = q.quote_request_id where r.configuration_id = v_cfg;
  perform pg_temp.q647_expect_eq('Q647-18 見積依頼の行：屋根は 23.5 ㎡・単価 10,500・246,750、見積の合計は版と同じ',
    '23.5000/㎡/10500/246750|' || v_total,
    coalesce((select qi.quantity::text || '/' || qi.unit || '/' || qi.unit_price::text || '/' || qi.amount::text
                from public.quote_items qi where qi.quote_id = v_quote and qi.name like '#647 屋根1（標準）%'), 'none:' || v_out) || '|' ||
    coalesce((select total::text from public.quotes where id = v_quote), 'none'));

  -- ---------- Web 以外の見積の下書きの行（D1c） ----------
  perform pg_temp.q647_expect_eq('Q647-19 Web 以外の見積の下書きの行も 23.5 ㎡（数量 1 の枠は「式」）', '23.5000/㎡|1.0000/式',
    coalesce((select (x.value ->> 'quantity') || '/' || (x.value ->> 'unit')
                from jsonb_array_elements(public.standard_estimate_v25_quote_draft_lines(v_rev)) x(value)
               where x.value ->> 'name' like '#647 屋根1（標準）%'), 'none') || '|' ||
    coalesce((select (x.value ->> 'quantity') || '/' || (x.value ->> 'unit')
                from jsonb_array_elements(public.standard_estimate_v25_quote_draft_lines(v_rev)) x(value)
               where x.value ->> 'name' = '#647 設備1'), 'none'));

  -- ---------- 次の版への写し・公開した版は変えない ----------
  v_rev2 := pg_temp.q647_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, null)::text', v_master))::uuid;
  perform pg_temp.q647_expect_eq('Q647-20 公開した版から作る次の下書きに、計上数量と販売単位を写す', '23.5000/㎡',
    coalesce((select bi.quantity::text || '/' || coalesce(bi.unit_snapshot, '(null)') from public.standard_estimate_revision_baseline_items bi
               where bi.revision_id = v_rev2 and bi.option_id = r1), 'none'));
  begin
    update public.standard_estimate_revision_baseline_items set unit_snapshot = 'm' where revision_id = v_rev and option_id = r1;
    v_out := 'updated';
  exception when others then
    v_out := format('ERROR %s', sqlstate);
  end;
  perform pg_temp.q647_expect_eq('Q647-21 公開した版の販売単位の写しは変えられない（トリガー）', 'ERROR P0001', v_out);
  perform pg_temp.q647_expect_eq('Q647-22 内部の部品は API のロールから実行できない', 'false/false/false/false',
    has_function_privilege('anon', 'public.standard_estimate_v25_slot_measure(uuid, uuid, uuid[], uuid, text)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.standard_estimate_v25_slot_measure(uuid, uuid, uuid[], uuid, text)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.standard_estimate_v25_slot_measured(uuid, text, uuid)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.standard_estimate_v25_slot_rule_issues(uuid)', 'EXECUTE')::text);
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _q647_result;

rollback;
