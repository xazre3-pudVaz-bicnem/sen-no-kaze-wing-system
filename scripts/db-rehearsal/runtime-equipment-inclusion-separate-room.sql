-- 設備包含（#628 の続き・A 案）：ユニットに含まれるカテゴリーの二重の選択の防止と「別室に追加」（20261127100000）の実行時検査。
-- 使い捨て DB 専用。最後に rollback する。商品マスターが空の DB で実行する（必須カテゴリー・商品選択設定の対応に掛からない、検査用の商品だけで保存するため）。
-- 第 1 部はスイッチ OFF（今の本番の計算・標準見積なし）、第 2 部は v2.5 の版を公開してスイッチを入れた計算。
-- 2026-11-12 の統合報告 6-5 の T1〜T15 のうち DB の部分（T1〜T5・T7〜T9・T11・T14）を確かめる。
begin;

create temp table _sr_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _sr_result to public;

create function pg_temp.sr_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.sr_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _sr_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual is not distinct from p_expected);
$fn$;

-- 拒否されたこと（SQLSTATE と、メッセージの先頭）を確かめる
create function pg_temp.sr_expect_error(p_step text, p_code text, p_prefix text, p_actual text) returns void
language sql as $fn$
  insert into _sr_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_prefix || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_prefix || '%');
$fn$;

-- お客様のプランの保存（カテゴリー単位の選択と、別室に追加した明細）。
-- 別々の保存（トランザクション）を同じ検査トランザクションの中で模すため、消した明細の一時領域（取扱終了の守り）を空にしてから呼ぶ
create function pg_temp.sr_save(p_customer uuid, p_model uuid, p_spec text, p_option_ids uuid[], p_separate uuid[],
                                p_id uuid default null, p_lock integer default null)
returns text
language plpgsql as $fn$
begin
  perform set_config('wing.product_lifecycle_stash', '', true), set_config('wing.product_lifecycle_variants', '', true);
  return pg_temp.sr_run_as('authenticated', p_customer, format(
    $q$ select (public.save_configuration_atomic(
          p_configuration_id => %L, p_base_model_id => %L, p_name => '設備包含の検査', p_option_ids => %L::uuid[],
          p_preview_image_url => null, p_notes => null, p_finish_level => 'full', p_variant_choice_ids => '{}'::uuid[],
          p_spec_code => %L, p_exterior_faces => '[]'::jsonb, p_expected_lock_version => %L::integer,
          p_separate_room_option_ids => %L::uuid[])).id::text $q$,
    p_id, p_model, p_option_ids, p_spec, p_lock, p_separate));
end;
$fn$;

-- プランの明細を「商品名:印」で並べる（印は別室なら true）
create function pg_temp.sr_items(p_cfg text) returns text
language sql as $fn$
  select coalesce(string_agg(o.name || ':' || ci.separate_room::text, '/' order by o.name, ci.separate_room), '(none)')
    from public.configuration_items ci join public.options o on o.id = ci.option_id
   where ci.configuration_id::text = p_cfg;
$fn$;

-- 見積の明細を「名前:金額」で並べる（0 円の注記・写しも含む）
create function pg_temp.sr_quote_lines(p_quote text, p_like text) returns text
language sql as $fn$
  select coalesce(string_agg(q.name || ':' || q.amount::text, '/' order by q.sort_order, q.name), '(none)')
    from public.quote_items q
   where q.quote_id::text = p_quote and q.name like p_like;
$fn$;

-- 下書きの保存の中身（v2.5）。slots は jsonb の配列
create function pg_temp.sr_payload(p_slots jsonb) returns text
language sql as $fn$
  select jsonb_build_object(
    'rates', jsonb_build_object('sales_fee_rate', '1', 'markup_rate', '1.5', 'expense_rate', '0.15'),
    'adjustment', 0, 'adjustment_reason', null,
    'slots', p_slots,
    'lines', '[]'::jsonb)::text;
$fn$;

create function pg_temp.sr_slot(p_option uuid) returns jsonb
language sql as $fn$
  select jsonb_build_object('baseline_key', null, 'option_id', p_option, 'variant_choice_ids', '[]'::jsonb, 'quantity', '1',
                            'price_mode', 'auto', 'manual_unit_price', null,
                            'slot_code', null, 'slot_label', null, 'selectable_option_ids', '[]'::jsonb);
$fn$;

do $test$
declare
  u_cust constant uuid := '62800000-0000-4000-8000-000000000001';
  u_other constant uuid := '62800000-0000-4000-8000-000000000002';
  u_admin constant uuid := '62800000-0000-4000-8000-000000000003';
  u_editor constant uuid := '62800000-0000-4000-8000-000000000004';
  org_hq constant uuid := '62800000-0000-4000-8000-000000000101';
  m_legacy constant uuid := '62800000-0000-4000-8000-000000000201';
  m_v25 constant uuid := '62800000-0000-4000-8000-000000000202';
  mr_office constant uuid := '62800000-0000-4000-8000-000000000301';
  c_ub constant uuid := '62800000-0000-4000-8000-000000000401';
  c_toilet constant uuid := '62800000-0000-4000-8000-000000000402';
  c_wash constant uuid := '62800000-0000-4000-8000-000000000403';
  c_other constant uuid := '62800000-0000-4000-8000-000000000404';
  ub_inc constant uuid := '62800000-0000-4000-8000-000000000501';
  ub_toilet constant uuid := '62800000-0000-4000-8000-000000000502';
  ub_plain constant uuid := '62800000-0000-4000-8000-000000000503';
  toilet_a constant uuid := '62800000-0000-4000-8000-000000000504';
  toilet_b constant uuid := '62800000-0000-4000-8000-000000000505';
  wash_a constant uuid := '62800000-0000-4000-8000-000000000506';
  other_a constant uuid := '62800000-0000-4000-8000-000000000507';
  v_inc_name constant text := '3点ユニット（トイレ・洗面つき）';
  v_out text;
  v_cfg text;
  v_cfg_sep text;
  v_cfg_xx text;
  v_cfg_dup uuid;
  v_quote text;
  v_lock integer;
  v_before text;
  v_bmr text;
  v_se text;
  v_master uuid;
  v_rev uuid;
  v_base_amount bigint;
  v_delta_expected bigint;
  v_money jsonb;
begin
  if exists (select 1 from public.options o where o.code not like 'runtime-%') then
    perform pg_temp.sr_expect_eq('SR-0 商品マスターが空の DB で実行する検査のため省略', 'skipped', 'skipped');
    return;
  end if;

  -- ---------- 列・一意の条件・権限 ----------
  perform pg_temp.sr_expect_eq('SR-1 明細の「別室」の印は boolean・NULL 不可・既定 false',
    'boolean,NO,false',
    (select data_type || ',' || is_nullable || ',' || column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = 'configuration_items' and column_name = 'separate_room'));
  perform pg_temp.sr_expect_eq('SR-2 カテゴリー単位の明細の一意の条件は「プラン × 商品 × 別室か」・位置の枠の明細には印を付けられない',
    'true/true',
    (pg_get_indexdef('public.configuration_items_option_key'::regclass) like '%(configuration_id, option_id, separate_room) WHERE (slot_code IS NULL)')::text
    || '/' || exists (select 1 from pg_constraint where conname = 'configuration_items_separate_room_category_level')::text);
  perform pg_temp.sr_expect_eq('SR-3 内部の部品は API のロールから実行できず、保存はログインした利用者だけ',
    'false/false/false/false/true',
    has_function_privilege('anon', 'public.validate_configuration_items(uuid, uuid[], text, uuid[], uuid[])', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.validate_configuration_items(uuid, uuid[], text, uuid[], uuid[])', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.write_configuration_inclusion_quote_notes(uuid, uuid, boolean)', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb, uuid[])', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb, uuid[])', 'EXECUTE')::text);

  -- ---------- 検査用のデータ ----------
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_cust, 'sr-cust@runtime.invalid', '{}'::jsonb), (u_other, 'sr-other@runtime.invalid', '{}'::jsonb),
         (u_admin, 'sr-admin@runtime.invalid', '{}'::jsonb), (u_editor, 'sr-editor@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_cust, 'sr-cust@runtime.invalid', 'お客様', 'customer'), (u_other, 'sr-other@runtime.invalid', 'ほかのお客様', 'customer'),
         (u_admin, 'sr-admin@runtime.invalid', '本部', 'admin'), (u_editor, 'sr-editor@runtime.invalid', '本部の編集者', 'customer');
  insert into public.organizations (id, code, name, organization_type, status)
  values (org_hq, 'runtime-sr-hq', '設備包含の検査の本部', 'headquarters', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values (org_hq, u_editor, 'editor', 'active');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_legacy, 'runtime-sr-legacy', '設備包含の検査モデル（旧来）', 1000000, 'published', '[{"code":"base","name":"標準","option_codes":[]}]'::jsonb),
         (m_v25, 'runtime-sr-v25', '設備包含の検査モデル（v2.5）', 1000000, 'published', '[{"code":"office","name":"事務所","option_codes":[]}]'::jsonb);
  insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
  values (mr_office, m_v25, 'office', '2100x4550', false);
  insert into public.option_categories (id, code, name, status, selection_mode, sort_order)
  values (c_ub, 'ub', '浴室', 'published', 'single', 60),
         (c_toilet, 'toilet', 'トイレ', 'published', 'multi', 80),
         (c_wash, 'washbasin', '洗面', 'published', 'multi', 70),
         (c_other, 'runtime-sr-other', 'その他の設備', 'published', 'multi', 90);
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation)
  values (ub_inc, c_ub, 'runtime-sr-ub-inc', v_inc_name, 600000, false, 'published', 'PRD-962801', false),
         (ub_toilet, c_ub, 'runtime-sr-ub-toilet', 'シャワートイレユニット', 500000, false, 'published', 'PRD-962802', false),
         (ub_plain, c_ub, 'runtime-sr-ub-plain', 'シャワーユニット', 450000, false, 'published', 'PRD-962803', false),
         (toilet_a, c_toilet, 'runtime-sr-toilet-a', 'トイレA', 120000, false, 'published', 'PRD-962804', false),
         (toilet_b, c_toilet, 'runtime-sr-toilet-b', 'トイレB', 150000, false, 'published', 'PRD-962805', false),
         (wash_a, c_wash, 'runtime-sr-wash-a', '洗面A', 80000, false, 'published', 'PRD-962806', false),
         (other_a, c_other, 'runtime-sr-other-a', 'その他A', 10000, false, 'published', 'PRD-962807', false);
  insert into public.option_included_categories (option_id, included_category_id)
  values (ub_inc, c_toilet), (ub_inc, c_wash), (ub_toilet, c_toilet);
  set local session_replication_role = origin;

  -- ---------- 第 1 部：スイッチ OFF（今の本番の計算） ----------
  v_cfg := pg_temp.sr_save(u_cust, m_legacy, 'base', array[ub_plain, toilet_a, wash_a], '{}');
  perform pg_temp.sr_expect_eq('SR-10 包含の無いユニットとトイレ・洗面は今までどおり保存でき、合計は 3 つの価格（650,000）',
    'true/650000', (v_cfg ~ '^[0-9a-f-]{36}$')::text || '/' || coalesce((select option_subtotal::text from public.configurations where id::text = v_cfg), v_cfg));

  perform pg_temp.sr_expect_error('SR-11 T3：トイレを含むユニットと、印の無いトイレは保存できない（画面を通さず RPC を直接呼ぶ）',
    'P0001', 'VALIDATION: 「トイレ」は「' || v_inc_name || '」に含まれています',
    pg_temp.sr_save(u_cust, m_legacy, 'base', array[ub_inc, toilet_a], '{}'));
  perform pg_temp.sr_expect_error('SR-12 洗面を含むユニットと、印の無い洗面も保存できない',
    'P0001', 'VALIDATION: 「洗面」は「' || v_inc_name || '」に含まれています',
    pg_temp.sr_save(u_cust, m_legacy, 'base', array[ub_inc, wash_a], '{}'));

  v_cfg := pg_temp.sr_save(u_cust, m_legacy, 'base', array[ub_inc], '{}');
  perform pg_temp.sr_expect_eq('SR-13 T1：トイレ・洗面を含むユニットだけなら保存でき、トイレ・洗面の分は計上しない（600,000）',
    'true/600000', (v_cfg ~ '^[0-9a-f-]{36}$')::text || '/' || coalesce((select option_subtotal::text from public.configurations where id::text = v_cfg), v_cfg));

  v_cfg_sep := pg_temp.sr_save(u_cust, m_legacy, 'base', array[ub_inc], array[toilet_a]);
  perform pg_temp.sr_expect_eq('SR-14 T2：別室にトイレを追加すると保存でき、追加の金額が入る（600,000 + 120,000）',
    v_inc_name || ':false/トイレA:true|720000',
    pg_temp.sr_items(v_cfg_sep) || '|' || coalesce((select option_subtotal::text from public.configurations where id::text = v_cfg_sep), v_cfg_sep));

  perform pg_temp.sr_expect_error('SR-15 別室に追加できるのはトイレ・洗面の商品だけ',
    'P0001', 'VALIDATION: 「その他A」は別室に追加できません',
    pg_temp.sr_save(u_cust, m_legacy, 'base', array[ub_inc], array[other_a]));

  v_out := pg_temp.sr_save(u_cust, m_legacy, 'base', array[ub_toilet, wash_a], '{}');
  perform pg_temp.sr_expect_eq('SR-16 T5：トイレだけを含むユニットなら、洗面は今までどおり選べる', 'true', (v_out ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.sr_expect_error('SR-17 T5：トイレだけを含むユニットに、印の無いトイレは選べない',
    'P0001', 'VALIDATION: 「トイレ」は「シャワートイレユニット」に含まれています',
    pg_temp.sr_save(u_cust, m_legacy, 'base', array[ub_toilet, toilet_b], '{}'));

  v_cfg_xx := pg_temp.sr_save(u_cust, m_legacy, 'base', array[ub_plain, toilet_a], array[toilet_a]);
  perform pg_temp.sr_expect_eq('SR-18 T4：包含の無いユニットに戻して標準のトイレと別室のトイレが同じ商品でも、2 行で保存し 2 つ数える',
    'シャワーユニット:false/トイレA:false/トイレA:true|690000',
    pg_temp.sr_items(v_cfg_xx) || '|' || coalesce((select option_subtotal::text from public.configurations where id::text = v_cfg_xx), v_cfg_xx));

  perform pg_temp.sr_expect_error('SR-19 別室に同じ商品を 2 回は保存できない',
    'P0001', 'VALIDATION: 別室に追加する同じ設備を複数回保存できません',
    pg_temp.sr_save(u_cust, m_legacy, 'base', array[ub_inc], array[toilet_a, toilet_a]));
  perform pg_temp.sr_expect_error('SR-20 別室に追加する設備は 10 件まで',
    'P0001', 'VALIDATION: 別室に追加する設備は 10 件までです',
    pg_temp.sr_save(u_cust, m_legacy, 'base', array[ub_inc], array_fill(toilet_a, array[11])));

  -- T11：ほかの人のプランへは保存できない（今の保存の権限のまま）
  v_lock := (select lock_version from public.configurations where id::text = v_cfg);
  v_out := pg_temp.sr_save(u_other, m_legacy, 'base', array[ub_inc], array[toilet_a], v_cfg::uuid, v_lock);
  perform pg_temp.sr_expect_eq('SR-21 T11：ほかのお客様は、印を付けてもほかの人のプランへ保存できない（明細は変わらない）',
    'true/' || v_inc_name || ':false',
    (v_out like 'ERROR %')::text || '/' || pg_temp.sr_items(v_cfg));

  -- プランの複製：別室の印も写す
  v_out := pg_temp.sr_run_as('authenticated', u_cust, format('select (public.duplicate_configuration(%L)).id::text', v_cfg_xx));
  perform pg_temp.sr_expect_eq('SR-22 プランを複製すると、別室の印も写る（同じ商品の 2 行もそのまま）',
    'シャワーユニット:false/トイレA:false/トイレA:true', case when v_out ~ '^[0-9a-f-]{36}$' then pg_temp.sr_items(v_out) else v_out end);

  -- ログインなしの一時保存：別室の明細の形
  perform pg_temp.sr_expect_eq('SR-23 ログインなしの一時保存は、別室に追加した明細を持てる', 'true',
    (pg_temp.sr_run_as('service_role', null, format(
       $q$ select public.create_guest_plan(%L, %L, %L::jsonb)::text $q$,
       repeat('a', 64), m_legacy,
       jsonb_build_object('name', '一時保存', 'option_ids', jsonb_build_array(ub_inc), 'separate_room_option_ids', jsonb_build_array(toilet_a))))
     not like 'ERROR %')::text);
  perform pg_temp.sr_expect_error('SR-24 ログインなしの一時保存で、別室の明細の形が正しくなければ止める',
    'P0001', 'VALIDATION: 別室に追加する設備の形式が正しくありません',
    pg_temp.sr_run_as('service_role', null, format(
      $q$ select public.create_guest_plan(%L, %L, %L::jsonb)::text $q$,
      repeat('b', 64), m_legacy,
      jsonb_build_object('name', '一時保存', 'option_ids', jsonb_build_array(ub_inc), 'separate_room_option_ids', 'x'))));

  -- 見積依頼（標準見積の無い旧仕様：明細を 1 行ずつ写す）
  v_lock := (select lock_version from public.configurations where id::text = v_cfg_sep);
  v_quote := pg_temp.sr_run_as('authenticated', u_cust, format(
    $q$ select (public.create_quote_from_configuration(%L, '{"full_name":"検査"}'::jsonb, null, %s))::text $q$, v_cfg_sep, v_lock));
  perform pg_temp.sr_expect_eq('SR-25 見積依頼（旧仕様）：別室の明細は価格つきで商品名に「（別室）」・含まれるカテゴリーは 0 円の注記・二重の写しは無い',
    'トイレA（別室）:120000|洗面（ユニットに含まれています）:0/トイレ（ユニットに含まれています）:0|(none)|720000',
    case when v_quote ~ '^[0-9a-f-]{36}$' then
      pg_temp.sr_quote_lines(v_quote, '%（別室）%') || '|' || pg_temp.sr_quote_lines(v_quote, '%ユニットに含まれています%') || '|' ||
      pg_temp.sr_quote_lines(v_quote, 'トイレ（別室）%') || '|' ||
      coalesce((select option_subtotal::text from public.quotes where id::text = v_quote), '(none)')
    else v_quote end);

  -- T7：前からある重複（含まれるカテゴリーの印の無い明細）は自動で消さず、見積依頼で止める
  set local session_replication_role = replica;
  insert into public.configurations (id, user_id, base_model_id, name, finish_level, spec_code)
  values ('62800000-0000-4000-8000-000000000901', u_cust, m_legacy, '前からある重複', 'full', 'base');
  insert into public.configuration_items (configuration_id, option_id, quantity)
  values ('62800000-0000-4000-8000-000000000901', ub_inc, 1), ('62800000-0000-4000-8000-000000000901', toilet_a, 1);
  set local session_replication_role = origin;
  v_lock := (select lock_version from public.configurations where id = '62800000-0000-4000-8000-000000000901');
  perform pg_temp.sr_expect_error('SR-26 T7：前からある重複のプランは見積を依頼できない（直すまで止める）',
    'P0001', 'VALIDATION: 「トイレ」は「' || v_inc_name || '」に含まれています',
    pg_temp.sr_run_as('authenticated', u_cust, format(
      $q$ select (public.create_quote_from_configuration(%L, '{"full_name":"検査"}'::jsonb, null, %s))::text $q$,
      '62800000-0000-4000-8000-000000000901', v_lock)));
  perform pg_temp.sr_expect_eq('SR-27 T7：止めても明細は自動で消さない', v_inc_name || ':false/トイレA:false',
    pg_temp.sr_items('62800000-0000-4000-8000-000000000901'));

  -- T8：発行済みの見積は、包含の設定を変えても明細・金額が変わらない
  v_before := pg_temp.sr_quote_lines(v_quote, '%');
  set local session_replication_role = replica;
  delete from public.option_included_categories where option_id = ub_inc;
  set local session_replication_role = origin;
  perform pg_temp.sr_expect_eq('SR-28 T8：包含の設定を外しても、発行済みの見積の明細・金額は変わらない', v_before, pg_temp.sr_quote_lines(v_quote, '%'));
  set local session_replication_role = replica;
  insert into public.option_included_categories (option_id, included_category_id) values (ub_inc, c_toilet), (ub_inc, c_wash);
  set local session_replication_role = origin;

  -- 案件のプランボード（本部・担当者の画面）：明細ごとの「別室」の印
  v_out := pg_temp.sr_run_as('authenticated', u_admin, format(
    $q$ select (select string_agg((x.value ->> 'option_id') || ':' || coalesce(x.value ->> 'separate_room', '(none)'), '/'
                                  order by x.value ->> 'option_id', x.value ->> 'separate_room')
                  from jsonb_array_elements(public.get_case_plan_configuration(%L) -> 'items') as x(value)) $q$, v_quote));
  perform pg_temp.sr_expect_eq('SR-29 案件のプランボードは、明細ごとに「別室」の印を返す（本部）',
    ub_inc::text || ':false/' || toilet_a::text || ':true', v_out);

  -- ---------- 第 2 部：v2.5 の版とスイッチ ON ----------
  perform pg_temp.sr_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 300000, 0, ''検査'')', ub_plain));
  perform pg_temp.sr_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 400000, 0, ''検査'')', ub_inc));
  perform pg_temp.sr_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 80000, 0, ''検査'')', toilet_a));
  perform pg_temp.sr_run_as('authenticated', u_admin, format('select changed::text from public.set_option_hq_standard_cost(%L, 50000, 0, ''検査'')', wash_a));
  v_bmr := pg_temp.sr_run_as('authenticated', u_editor,
    format($q$ select public.create_base_master_draft(%L, %L, '設備包含の検査の本体', 'non_fire', null, %L)::text $q$, m_v25, org_hq, mr_office));
  perform pg_temp.sr_run_as('authenticated', u_editor, format($q$ select (public.save_base_master_draft(%L, '設備包含の検査の本体', 'non_fire', 'none', null, 0,
    '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr));
  perform pg_temp.sr_run_as('authenticated', u_editor, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr));
  v_se := pg_temp.sr_run_as('authenticated', u_editor, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr));
  select r.standard_estimate_master_id into v_master from public.standard_estimate_revisions r where r.id::text = v_se;
  v_rev := pg_temp.sr_run_as('authenticated', u_editor, format('select public.start_standard_estimate_v25_draft(%L, 1)::text', v_master))::uuid;

  v_out := pg_temp.sr_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 2, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.sr_payload(jsonb_build_array(pg_temp.sr_slot(ub_plain), pg_temp.sr_slot(toilet_a), pg_temp.sr_slot(wash_a)))));
  perform pg_temp.sr_expect_eq('SR-30 版の標準が「シャワーユニット＋単体トイレ＋単体洗面」なら、包含の判定は出ない', '3/(none)',
    v_out || '/' || coalesce(nullif(public.standard_estimate_v25_slot_rule_issues(v_rev), ''), '(none)'));

  v_out := pg_temp.sr_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 3, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.sr_payload(jsonb_build_array(pg_temp.sr_slot(ub_inc), pg_temp.sr_slot(toilet_a)))));
  perform pg_temp.sr_expect_eq('SR-31 T9：版の標準に、トイレを含むユニットと単体のトイレがあれば、公開の判定に出る', '4/true',
    v_out || '/' || (coalesce(public.standard_estimate_v25_slot_rule_issues(v_rev), '')
      like '%ユニットに含まれる設備と同じカテゴリーの単体の商品を、同じ版の標準にできません：「トイレ」は「' || v_inc_name || '」に含まれています%')::text);
  v_out := pg_temp.sr_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 4)).status', v_rev));
  perform pg_temp.sr_expect_eq('SR-32 T9：その版は公開できない', 'true', (v_out like 'ERROR P0001:%ユニットに含まれる設備と同じカテゴリー%')::text);

  v_out := pg_temp.sr_run_as('authenticated', u_editor, format('select (public.save_standard_estimate_v25_draft(%L, 4, %L::jsonb)).lock_version::text', v_rev,
    pg_temp.sr_payload(jsonb_build_array(pg_temp.sr_slot(ub_plain), pg_temp.sr_slot(toilet_a), pg_temp.sr_slot(wash_a)))));
  v_out := v_out || '/' || pg_temp.sr_run_as('authenticated', u_editor, format('select (public.publish_standard_estimate_v25_revision(%L, 5)).status', v_rev));
  perform pg_temp.sr_expect_eq('SR-33 標準を直した版は公開できる', '5/published', v_out);
  perform pg_temp.sr_expect_eq('SR-34 前提：本部はスイッチを入れられる', 'true',
    pg_temp.sr_run_as('authenticated', u_admin, 'select public.set_simulator_standard_pricing(true)::text'));

  select coalesce(sum(bi.amount), 0) into v_base_amount
    from public.standard_estimate_revision_baseline_items bi where bi.revision_id = v_rev and bi.section_code = 'option' and bi.amount is not null;

  v_cfg := pg_temp.sr_save(u_cust, m_v25, 'office', array[ub_inc], '{}');
  v_delta_expected := public.standard_estimate_v25_selection_unit(v_rev, ub_inc, '{}'::uuid[], null)::bigint - v_base_amount;
  v_money := case when v_cfg ~ '^[0-9a-f-]{36}$' then public.standard_estimate_v25_configuration_money(v_cfg::uuid, v_rev) end;
  perform pg_temp.sr_expect_eq('SR-35 T1・T14：スイッチ ON で 3 点ユニットに変えると、標準の単体トイレ・洗面は外れ、差額＝ユニットの売価 − 版の 3 行の売価',
    v_delta_expected::text || '/' || v_inc_name || ':false',
    coalesce(v_money #>> '{sections,option,delta_line}', v_cfg) || '/' || pg_temp.sr_items(v_cfg));
  perform pg_temp.sr_expect_eq('SR-36 T1：区分の経費は、差額を入れた区分の小計に経費率を掛けて切り捨て（率でない区分は 0 のまま）', 'true',
    coalesce(((v_money #>> '{sections,option,expense_amount}')::bigint
      = case when v_money #>> '{sections,option,expense_method}' = 'rate'
             then trunc(((v_money #>> '{sections,option,line_subtotal}')::bigint) * (v_money ->> 'expense_rate')::numeric)::bigint
             else 0 end)::text, '(none)'));

  perform pg_temp.sr_expect_error('SR-37 T14：スイッチ ON でも、印の無いトイレは保存できない',
    'P0001', 'VALIDATION: 「トイレ」は「' || v_inc_name || '」に含まれています',
    pg_temp.sr_save(u_cust, m_v25, 'office', array[ub_inc, toilet_a], '{}'));

  v_lock := (select lock_version from public.configurations where id::text = v_cfg);
  v_out := pg_temp.sr_save(u_cust, m_v25, 'office', array[ub_inc], array[toilet_a], v_cfg::uuid, v_lock);
  v_delta_expected := v_delta_expected + public.standard_estimate_v25_selection_unit(v_rev, toilet_a, '{}'::uuid[], null)::bigint;
  perform pg_temp.sr_expect_eq('SR-38 T2・T14：別室にトイレ（版の標準と同じ商品）を追加すると、版の売価がそのまま差額に入る',
    v_delta_expected::text,
    coalesce(public.standard_estimate_v25_configuration_money(v_cfg::uuid, v_rev) #>> '{sections,option,delta_line}', v_out));

  v_lock := (select lock_version from public.configurations where id::text = v_cfg);
  v_quote := pg_temp.sr_run_as('authenticated', u_cust, format(
    $q$ select (public.create_quote_from_configuration(%L, '{"full_name":"検査"}'::jsonb, null, %s))::text $q$, v_cfg, v_lock));
  perform pg_temp.sr_expect_eq('SR-39 見積依頼（v2.5）：別室のトイレは 0 円の写し・含まれるカテゴリーは 0 円の注記・差額の行は計算と同じ',
    'トイレ（別室）:0|洗面（ユニットに含まれています）:0/トイレ（ユニットに含まれています）:0|選択商品の変更差額:' || v_delta_expected::text,
    case when v_quote ~ '^[0-9a-f-]{36}$' then
      pg_temp.sr_quote_lines(v_quote, '%（別室）%') || '|' || pg_temp.sr_quote_lines(v_quote, '%ユニットに含まれています%') || '|' ||
      pg_temp.sr_quote_lines(v_quote, '選択商品の変更差額')
    else v_quote end);

  v_before := pg_temp.sr_quote_lines(v_quote, '%');
  set local session_replication_role = replica;
  delete from public.option_included_categories where option_id = ub_inc;
  set local session_replication_role = origin;
  perform pg_temp.sr_expect_eq('SR-40 T8：スイッチ ON の見積も、包含の設定を外した後に明細・金額が変わらない', v_before, pg_temp.sr_quote_lines(v_quote, '%'));
end;
$test$;

select jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq) as j
from _sr_result;

rollback;
