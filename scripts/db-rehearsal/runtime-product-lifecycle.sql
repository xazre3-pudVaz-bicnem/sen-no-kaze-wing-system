-- 商品の取扱終了・シミュレーター表示の保存境界（20261015110000・20261015113000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 商品マスターが空の DB で実行する（必須カテゴリーの検証に掛からない、検査用のカテゴリーと商品だけで保存するため）。
begin;

create temp table _pl_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _pl_result to public;

create function pg_temp.pl_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.pl_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _pl_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

-- 拒否されたこと（SQLSTATE と、メッセージの先頭の印）を確かめる
create function pg_temp.pl_expect_error(p_step text, p_code text, p_prefix text, p_actual text) returns void
language sql as $fn$
  insert into _pl_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_prefix || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_prefix || '%');
$fn$;

-- 別々の保存（トランザクション）を同じ検査トランザクションの中で模すため、消した明細の一時領域を空にする
create function pg_temp.pl_next_transaction() returns void
language sql as $fn$
  select set_config('wing.product_lifecycle_stash', '', true), set_config('wing.product_lifecycle_variants', '', true);
$fn$;

-- superuser のまま実行して結果（エラー）を文字列で返す（トリガーの検査用）
create function pg_temp.pl_try(p_sql text) returns text
language plpgsql as $fn$
declare
  v_out text;
begin
  execute p_sql into v_out;
  return coalesce(v_out, 'ok');
exception when others then
  return format('ERROR %s: %s', sqlstate, sqlerrm);
end;
$fn$;

do $test$
declare
  u_admin constant uuid := '70000000-0000-4000-8000-000000000001';
  u_cust constant uuid := '70000000-0000-4000-8000-000000000002';
  u_dealer constant uuid := '70000000-0000-4000-8000-000000000003';
  u_editor constant uuid := '70000000-0000-4000-8000-000000000004';
  m_model constant uuid := '71000000-0000-4000-8000-000000000001';
  c_items constant uuid := '72000000-0000-4000-8000-000000000001';
  c_required constant uuid := '72000000-0000-4000-8000-000000000002';
  c_exterior uuid;
  o_vis constant uuid := '73000000-0000-4000-8000-000000000001';
  o_hid constant uuid := '73000000-0000-4000-8000-000000000002';
  o_draft constant uuid := '73000000-0000-4000-8000-000000000003';
  o_keep constant uuid := '73000000-0000-4000-8000-000000000004';
  o_hide_keep constant uuid := '73000000-0000-4000-8000-000000000005';
  o_base_hid constant uuid := '73000000-0000-4000-8000-000000000006';
  o_ret constant uuid := '73000000-0000-4000-8000-000000000007';
  o_default constant uuid := '73000000-0000-4000-8000-000000000008';
  o_dep_target constant uuid := '73000000-0000-4000-8000-000000000009';
  o_dep_source constant uuid := '73000000-0000-4000-8000-000000000010';
  o_std constant uuid := '73000000-0000-4000-8000-000000000011';
  o_std_draft constant uuid := '73000000-0000-4000-8000-000000000012';
  o_q constant uuid := '73000000-0000-4000-8000-000000000013';
  o_tmpl constant uuid := '73000000-0000-4000-8000-000000000014';
  o_q_carry constant uuid := '73000000-0000-4000-8000-000000000015';
  r_ret constant uuid := '73000000-0000-4000-8000-000000000016';
  r_hid constant uuid := '73000000-0000-4000-8000-000000000017';
  e_keep constant uuid := '73000000-0000-4000-8000-000000000021';
  e_vis constant uuid := '73000000-0000-4000-8000-000000000022';
  e_ret constant uuid := '73000000-0000-4000-8000-000000000023';
  o_keep2 constant uuid := '73000000-0000-4000-8000-000000000018';
  o_var2 constant uuid := '73000000-0000-4000-8000-000000000019';
  g_keep constant uuid := '74000000-0000-4000-8000-000000000001';
  k1 constant uuid := '74100000-0000-4000-8000-000000000001';
  k2 constant uuid := '74100000-0000-4000-8000-000000000002';
  g_std constant uuid := '74000000-0000-4000-8000-000000000002';
  s1 constant uuid := '74100000-0000-4000-8000-000000000003';
  s2 constant uuid := '74100000-0000-4000-8000-000000000004';
  g_keep2 constant uuid := '74000000-0000-4000-8000-000000000003';
  g_var2 constant uuid := '74000000-0000-4000-8000-000000000004';
  m1 constant uuid := '74100000-0000-4000-8000-000000000005';
  m2 constant uuid := '74100000-0000-4000-8000-000000000006';
  x1 constant uuid := '74100000-0000-4000-8000-000000000007';
  x2 constant uuid := '74100000-0000-4000-8000-000000000008';
  org constant uuid := '75000000-0000-4000-8000-000000000001';
  bm constant uuid := '75100000-0000-4000-8000-000000000001';
  bmr constant uuid := '75200000-0000-4000-8000-000000000001';
  sem constant uuid := '75300000-0000-4000-8000-000000000001';
  rev_pub constant uuid := '75400000-0000-4000-8000-000000000001';
  rev_draft constant uuid := '75400000-0000-4000-8000-000000000002';
  qr constant uuid := '76000000-0000-4000-8000-000000000001';
  qd constant uuid := '76100000-0000-4000-8000-000000000001';
  qr2 constant uuid := '76000000-0000-4000-8000-000000000002';
  qr3 constant uuid := '76000000-0000-4000-8000-000000000003';
  q_parent constant uuid := '76200000-0000-4000-8000-000000000001';
  qd_new constant uuid := '76100000-0000-4000-8000-000000000002';
  qd_old constant uuid := '76100000-0000-4000-8000-000000000003';
  l1 constant uuid := '76300000-0000-4000-8000-000000000001';
  l2 constant uuid := '76300000-0000-4000-8000-000000000002';
  l_carry constant uuid := '76300000-0000-4000-8000-000000000003';
  v_cfg uuid;
  v_cfg_hidden uuid;
  v_cfg_face uuid;
  v_cfg_var uuid;
  v_out text;
  v_lock integer;
  v_faces jsonb;
  v_before text;
  v_save text := $sql$
    select x.id::text from public.save_configuration_atomic(
      p_configuration_id => %L, p_base_model_id => %L, p_name => '検査', p_option_ids => %L::uuid[],
      p_preview_image_url => null, p_notes => null, p_finish_level => 'shell', p_variant_choice_ids => %L::uuid[],
      p_spec_code => %L, p_exterior_faces => %L::jsonb, p_site_prefecture => null, p_site_municipality => null,
      p_site_location_undecided => false, p_expected_lock_version => %s) x $sql$;
  v_items text;
begin
  if exists (select 1 from public.options o where o.code not like 'runtime-%') then
    perform pg_temp.pl_expect_eq('PL-0 商品マスターが空の DB で実行する検査のため省略', 'skipped', 'skipped');
    return;
  end if;

  -- ---------- 検査用のデータ ----------
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'pl-admin@runtime.invalid', '{}'), (u_cust, 'pl-cust@runtime.invalid', '{}'),
         (u_dealer, 'pl-dealer@runtime.invalid', '{}'), (u_editor, 'pl-editor@runtime.invalid', '{}');
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'pl-admin@runtime.invalid', '本部', 'admin'), (u_cust, 'pl-cust@runtime.invalid', 'お客様', 'customer'),
         (u_dealer, 'pl-dealer@runtime.invalid', '代理店', 'dealer'), (u_editor, 'pl-editor@runtime.invalid', '総代理店', 'master_dealer');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-pl-model', '状態検査用モデル', 1000000, 'published',
          '[{"code": "pl-spec", "name": "検査仕様", "option_codes": ["runtime-pl-base-hid"]}]'::jsonb);
  insert into public.option_categories (id, code, name, selection_mode, is_required, finish_level, status)
  values (c_items, 'runtime-pl-items', '状態検査の商品', 'multi', false, 'shell', 'published'),
         (c_required, 'runtime-pl-required', '状態検査の必須', 'single', true, 'shell', 'published');
  insert into public.option_categories (code, name, selection_mode, is_required, finish_level, status)
  values ('exterior-wall', '外壁', 'single', false, 'shell', 'published')
  on conflict (code) do nothing;
  select id into c_exterior from public.option_categories where code = 'exterior-wall';
  insert into public.options (id, base_model_id, category_id, code, name, price, status, product_no, simulator_visible, archived_at, is_default)
  values
    (o_vis, m_model, c_items, 'runtime-pl-vis', '登録済み', 1000, 'published', 'PRD-970001', true, null, false),
    (o_hid, m_model, c_items, 'runtime-pl-hid', '非表示', 1000, 'published', 'PRD-970002', false, null, false),
    (o_draft, m_model, c_items, 'runtime-pl-draft', '下書き', 1000, 'draft', 'PRD-970003', true, null, false),
    (o_keep, m_model, c_items, 'runtime-pl-keep', '後で取扱終了', 1000, 'published', 'PRD-970004', true, null, false),
    (o_hide_keep, m_model, c_items, 'runtime-pl-hide-keep', '後で非表示', 1000, 'published', 'PRD-970005', true, null, false),
    (o_base_hid, m_model, c_items, 'runtime-pl-base-hid', '標準構成の非表示', 1000, 'published', 'PRD-970006', false, null, false),
    (o_ret, m_model, c_items, 'runtime-pl-ret', '取扱終了', 1000, 'published', 'PRD-970007', false, now() - interval '1 day', false),
    (o_default, m_model, c_items, 'runtime-pl-default', '初期選択', 1000, 'published', 'PRD-970008', true, null, true),
    (o_dep_target, m_model, c_items, 'runtime-pl-dep-target', '前提商品', 1000, 'published', 'PRD-970009', true, null, false),
    (o_dep_source, m_model, c_items, 'runtime-pl-dep-source', '前提が必要な商品', 1000, 'published', 'PRD-970010', true, null, false),
    (o_std, m_model, c_items, 'runtime-pl-std', '公開中の標準見積の商品', 1000, 'published', 'PRD-970011', true, null, false),
    (o_std_draft, m_model, c_items, 'runtime-pl-std-draft', '下書きの標準見積の商品', 1000, 'published', 'PRD-970012', true, null, false),
    (o_q, m_model, c_items, 'runtime-pl-q', '見積の商品', 1000, 'published', 'PRD-970013', true, null, false),
    (o_tmpl, m_model, c_items, 'runtime-pl-tmpl', 'Excel 標準の基準商品', 1000, 'published', 'PRD-970014', true, null, false),
    (o_q_carry, m_model, c_items, 'runtime-pl-q-carry', '改訂で引き継ぐ商品', 1000, 'published', 'PRD-970015', true, now() - interval '1 day', false),
    (r_ret, m_model, c_required, 'runtime-pl-r-ret', '必須カテゴリーの取扱終了', 1000, 'published', 'PRD-970016', true, now() - interval '1 day', false),
    (r_hid, m_model, c_required, 'runtime-pl-r-hid', '必須カテゴリーの非表示', 1000, 'published', 'PRD-970017', false, null, false),
    (o_keep2, m_model, c_items, 'runtime-pl-keep2', '後で取扱終了（選択肢あり）', 1000, 'published', 'PRD-970018', true, null, false),
    (o_var2, m_model, c_items, 'runtime-pl-var2', '選択肢のある登録済み', 1000, 'published', 'PRD-970019', true, null, false),
    (e_keep, m_model, c_exterior, 'runtime-pl-e-keep', '後で取扱終了の外壁', 1000, 'published', 'PRD-970021', true, null, false),
    (e_vis, m_model, c_exterior, 'runtime-pl-e-vis', '登録済みの外壁', 1000, 'published', 'PRD-970022', true, null, false),
    (e_ret, m_model, c_exterior, 'runtime-pl-e-ret', '取扱終了の外壁', 1000, 'published', 'PRD-970023', true, now() - interval '1 day', false);
  insert into public.option_dependencies (option_id, requires_option_id) values (o_dep_source, o_dep_target);
  insert into public.option_variant_groups (id, option_id, code, name, status, is_required)
  values (g_keep, o_keep, 'pl-color', '色', 'published', false), (g_std, o_std_draft, 'pl-size', '大きさ', 'published', false),
         (g_keep2, o_keep2, 'pl-finish', '仕上げ', 'published', false), (g_var2, o_var2, 'pl-length', '長さ', 'published', false);
  insert into public.option_variant_choices (id, group_id, code, name, status)
  values (k1, g_keep, 'white', '白', 'published'), (k2, g_keep, 'black', '黒', 'published'),
         (s1, g_std, 'small', '小', 'published'), (s2, g_std, 'large', '大', 'published'),
         (m1, g_keep2, 'matte', 'つや消し', 'published'), (m2, g_keep2, 'gloss', 'つや', 'published'),
         (x1, g_var2, 'short', '短', 'published'), (x2, g_var2, 'long', '長', 'published');
  insert into public.estimate_templates (base_model_id, spec_code, name, source_file_name, source_sheet_name, source_sha256, baseline_option_ids)
  values (m_model, 'pl-tmpl', '検査用 Excel 標準', 'runtime.xlsx', 'runtime', repeat('0', 64), array[o_tmpl]);
  insert into public.organizations (id, code, name, organization_type) values (org, 'RT-PL-ORG', '状態検査の本部', 'headquarters');
  insert into public.base_masters (id, base_model_id, owner_organization_id, name) values (bm, m_model, org, '状態検査の本体');
  insert into public.base_master_revisions (id, base_master_id, version, expense_method, expense_rate) values (bmr, bm, 1, 'none', null);
  insert into public.standard_estimate_masters (id, owner_organization_id, base_model_id, base_master_id, spec_code, name, current_published_revision_id)
  values (sem, org, m_model, bm, 'base', '状態検査の標準見積', rev_pub);
  insert into public.standard_estimate_revisions (id, standard_estimate_master_id, version, base_master_revision_id, status, published_at, tax_rate)
  values (rev_pub, sem, 1, bmr, 'published', now(), 0.10), (rev_draft, sem, 2, bmr, 'draft', null, 0.10);
  insert into public.standard_estimate_revision_baseline_items (
    revision_id, option_id, option_category_id, section_code, selection_target_code, quantity,
    option_code_snapshot, option_name_snapshot, category_code_snapshot, category_name_snapshot, unit_price_snapshot, sort_order)
  values (rev_pub, o_std, c_items, 'option', 'runtime-pl-items', 1, 'runtime-pl-std', '公開中の標準見積の商品', 'runtime-pl-items', '状態検査の商品', 1000, 1),
         (rev_draft, o_std_draft, c_items, 'option', 'runtime-pl-items', 2, 'runtime-pl-std-draft', '下書きの標準見積の商品', 'runtime-pl-items', '状態検査の商品', 1000, 1);
  insert into public.standard_estimate_revision_baseline_variants (
    baseline_item_id, variant_group_id, variant_choice_id, variant_group_code_snapshot, variant_group_name_snapshot,
    variant_choice_code_snapshot, variant_choice_name_snapshot, extra_price_snapshot, sort_order)
  select b.id, g_std, s1, 'pl-size', '大きさ', 'small', '小', 0, 1
    from public.standard_estimate_revision_baseline_items b where b.revision_id = rev_draft;
  insert into public.quote_requests (id, status, contact) values (qr, 'new', '{}'::jsonb), (qr2, 'new', '{}'::jsonb), (qr3, 'new', '{}'::jsonb);
  insert into public.quote_drafts (id, quote_request_id, base_model_id, spec_code, quote_kind, tax_rate, lock_version, source_kind, finish_level, created_at)
  values (qd, qr, m_model, 'base', 'formal', 0.10, 0, 'manual', 'full', now() - interval '1 day');
  insert into public.quotes (id, quote_no, quote_request_id, valid_until, customer_name, base_model_name, base_price, option_subtotal,
                             installation_subtotal, subtotal, tax_rate, tax, total, status, quote_kind, base_model_id, spec_code)
  values (q_parent, 'RT-PL-Q1', qr2, now() + interval '30 days', '検査', '状態検査用モデル', 0, 2000, 0, 2000, 0.10, 200, 2200, 'issued', 'formal', m_model, 'base');
  insert into public.quote_items (quote_id, kind, name, unit_price, quantity, amount, sort_order, line_key, option_id)
  values (q_parent, 'option', '改訂で引き継ぐ商品', 1000, 2, 2000, 1, l_carry, o_q_carry);
  -- 改訂 Draft：今日作った（このトランザクション）ものと、前日に作ったもの
  insert into public.quote_drafts (id, quote_request_id, parent_quote_id, base_model_id, spec_code, quote_kind, tax_rate, lock_version, source_kind, finish_level)
  values (qd_new, qr2, q_parent, m_model, 'base', 'formal', 0.10, 0, 'manual', 'full');
  set local session_replication_role = origin;

  -- ---------- 状態の判定（DB 側の部品） ----------
  perform pg_temp.pl_expect_eq('PL-1 状態の判定：下書き／登録済み（表示・非表示）／取扱終了', 'draft/registered/registered/retired',
    (select string_agg(public.product_lifecycle_state(o.status, o.archived_at), '/' order by array_position(array[o_draft, o_vis, o_hid, o_ret], o.id))
       from public.options o where o.id in (o_draft, o_vis, o_hid, o_ret)));

  -- ---------- 構成（シミュレーター）：新しい選択 ----------
  v_out := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, array[o_vis], '{}', 'base', '[]', 'null'));
  perform pg_temp.pl_expect_eq('PL-2 登録済み・表示の商品は新しい構成で選べる', 'true', (v_out ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.pl_expect_error('PL-3 シミュレーター非表示の商品は新しい構成で選べない', 'P0001', 'VALIDATION',
    pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, array[o_hid], '{}', 'base', '[]', 'null')));
  perform pg_temp.pl_expect_error('PL-4 取扱終了の商品は新しい構成で選べない', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, array[o_ret], '{}', 'base', '[]', 'null')));
  perform pg_temp.pl_expect_error('PL-5 下書きの商品は新しい構成で選べない', 'P0001', 'VALIDATION',
    pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, array[o_draft], '{}', 'base', '[]', 'null')));
  v_out := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, array[o_base_hid], '{}', 'pl-spec', '[]', 'null'));
  perform pg_temp.pl_expect_eq('PL-6 シミュレーター非表示でも、モデル・仕様の標準構成に入っている商品は構成に入れられる', 'true', (v_out ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.pl_expect_error('PL-7 標準構成に入っていない仕様では、同じ非表示の商品は選べない', 'P0001', 'VALIDATION',
    pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, array[o_base_hid], '{}', 'base', '[]', 'null')));

  -- ---------- 構成：保存済みの明細の保持（取扱終了） ----------
  -- 選択肢を使う構成は商品 1 つにする（選択肢があり商品が 2 つ以上の保存は、#507 で直す別の不具合に当たるため）
  v_cfg := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, array[o_keep], array[k1], 'base', '[]', 'null'))::uuid;
  update public.options set archived_at = now() where id = o_keep;
  perform pg_temp.pl_next_transaction();
  select lock_version into v_lock from public.configurations where id = v_cfg;
  v_out := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, v_cfg, m_model, array[o_keep], array[k1], 'base', '[]', v_lock));
  perform pg_temp.pl_expect_eq('PL-8 取扱終了前から保存済みの明細は、変えずに保存し直せる', v_cfg::text, v_out);
  perform pg_temp.pl_next_transaction();
  select lock_version into v_lock from public.configurations where id = v_cfg;
  perform pg_temp.pl_expect_error('PL-9 取扱終了の明細の選択肢は変えられない', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_cust, format(v_save, v_cfg, m_model, array[o_keep], array[k2], 'base', '[]', v_lock)));
  perform pg_temp.pl_next_transaction();
  perform pg_temp.pl_expect_error('PL-10 取扱終了の明細の数量は増やせない（直接の更新も同じ）', 'P0001', 'RETIRED',
    pg_temp.pl_try(format('update public.configuration_items set quantity = 2 where configuration_id = %L and option_id = %L returning ''ok''', v_cfg, o_keep)));
  perform pg_temp.pl_next_transaction();
  select lock_version into v_lock from public.configurations where id = v_cfg;
  v_out := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, v_cfg, m_model, array[o_vis], '{}', 'base', '[]', v_lock));
  perform pg_temp.pl_expect_eq('PL-11 取扱終了の明細は削除できる', v_cfg::text || '/0', v_out || '/' ||
    (select count(*)::text from public.configuration_items where configuration_id = v_cfg and option_id = o_keep));
  perform pg_temp.pl_next_transaction();
  select lock_version into v_lock from public.configurations where id = v_cfg;
  perform pg_temp.pl_expect_error('PL-12 一度削除した取扱終了の商品は、後から足し直せない', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_cust, format(v_save, v_cfg, m_model, array[o_keep], array[k1], 'base', '[]', v_lock)));

  -- ---------- 構成：保存済みの明細の保持（シミュレーター非表示） ----------
  perform pg_temp.pl_next_transaction();
  v_cfg_hidden := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, array[o_hide_keep], '{}', 'base', '[]', 'null'))::uuid;
  update public.options set simulator_visible = false where id = o_hide_keep;
  perform pg_temp.pl_next_transaction();
  select lock_version into v_lock from public.configurations where id = v_cfg_hidden;
  v_out := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, v_cfg_hidden, m_model, array[o_hide_keep], '{}', 'base', '[]', v_lock));
  perform pg_temp.pl_expect_eq('PL-13 非表示にする前から保存済みの明細は、変えずに保存し直せる', v_cfg_hidden::text, v_out);
  perform pg_temp.pl_next_transaction();
  select lock_version into v_lock from public.configurations where id = v_cfg_hidden;
  perform pg_temp.pl_expect_error('PL-14 非表示の商品は、保存済みの構成にも新しく足せない', 'P0001', 'VALIDATION',
    pg_temp.pl_run_as('authenticated', u_cust, format(v_save, v_cfg_hidden, m_model, array[o_hide_keep, o_hid], '{}', 'base', '[]', v_lock)));

  -- ---------- 構成：外壁 4 面 ----------
  perform pg_temp.pl_next_transaction();
  v_faces := jsonb_build_array(
    jsonb_build_object('face_code', 'front', 'option_id', e_keep, 'variant_choice_ids', '[]'::jsonb),
    jsonb_build_object('face_code', 'right', 'option_id', e_vis, 'variant_choice_ids', '[]'::jsonb),
    jsonb_build_object('face_code', 'back', 'option_id', e_vis, 'variant_choice_ids', '[]'::jsonb),
    jsonb_build_object('face_code', 'left', 'option_id', e_vis, 'variant_choice_ids', '[]'::jsonb));
  v_cfg_face := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, '{}', '{}', 'base', v_faces, 'null'))::uuid;
  update public.options set archived_at = now() where id = e_keep;
  perform pg_temp.pl_next_transaction();
  select lock_version into v_lock from public.configurations where id = v_cfg_face;
  v_out := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, v_cfg_face, m_model, '{}', '{}', 'base', v_faces, v_lock));
  perform pg_temp.pl_expect_eq('PL-15 外壁：取扱終了前から保存済みの面は、そのまま保存し直せる', v_cfg_face::text, v_out);
  select lock_version into v_lock from public.configurations where id = v_cfg_face;
  perform pg_temp.pl_expect_error('PL-16 外壁：取扱終了の外壁を別の面へ足すことはできない', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_cust, format(v_save, v_cfg_face, m_model, '{}', '{}', 'base',
      jsonb_set(v_faces, '{1,option_id}', to_jsonb(e_keep::text)), v_lock)));
  perform pg_temp.pl_expect_error('PL-17 外壁：取扱終了の外壁は新しい構成で選べない', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, '{}', '{}', 'base',
      jsonb_set(v_faces, '{0,option_id}', to_jsonb(e_ret::text)), 'null')));

  -- ---------- 構成：複製・見積依頼 ----------
  perform pg_temp.pl_next_transaction();
  perform pg_temp.pl_expect_error('PL-18 取扱終了の商品を含む構成は複製できない（明示的に止める）', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_cust, format('select x.id::text from public.duplicate_configuration(%L) x', v_cfg_face)));
  perform pg_temp.pl_expect_error('PL-19 非表示の商品を含む構成も、新しい構成としての複製はできない', 'P0001', 'VALIDATION',
    pg_temp.pl_run_as('authenticated', u_cust, format('select x.id::text from public.duplicate_configuration(%L) x', v_cfg_hidden)));
  select lock_version into v_lock from public.configurations where id = v_cfg_face;
  perform pg_temp.pl_expect_error('PL-20 取扱終了の商品が残っている構成からは見積を依頼できない', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_cust, format(
      $q$ select x.id::text from public.create_quote_from_configuration(%L, '{"full_name": "検査"}'::jsonb, null, %s) as x(id) $q$, v_cfg_face, v_lock)));
  select lock_version into v_lock from public.configurations where id = v_cfg_hidden;
  v_out := pg_temp.pl_run_as('authenticated', u_cust, format(
    $q$ select x.id::text from public.create_quote_from_configuration(%L, '{"full_name": "検査"}'::jsonb, null, %s) as x(id) $q$, v_cfg_hidden, v_lock));
  perform pg_temp.pl_expect_eq('PL-21 非表示の商品だけなら（取扱終了でなければ）保存済みの構成から見積を依頼できる', 'true', (v_out ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.pl_next_transaction();
  v_out := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, array[o_vis], '{}', 'base', '[]', 'null'));
  perform pg_temp.pl_expect_eq('PL-22 必須カテゴリーの商品が取扱終了・非表示だけなら、そのカテゴリーは必須にならない', 'true', (v_out ~ '^[0-9a-f-]{36}$')::text);

  -- ---------- 見積 Draft：新しい選択・保持 ----------
  perform pg_temp.pl_next_transaction();
  v_items := jsonb_build_array(
    jsonb_build_object('kind', 'option', 'name', '見積の商品', 'option_id', o_q, 'quantity', 2, 'unit_price', 1000, 'line_key', l1))::text;
  v_out := pg_temp.pl_run_as('authenticated', u_admin, format(
    'select public.save_quote_draft(%L, 0, null, %L::jsonb, 0, null, null, null)::text', qd, v_items));
  perform pg_temp.pl_expect_eq('PL-23 見積 Draft：登録済みの商品を保存できる', '1', v_out);
  v_out := pg_temp.pl_run_as('authenticated', u_admin, format(
    'select public.save_quote_draft(%L, 1, null, %L::jsonb, 0, null, null, null)::text', qd,
    (v_items::jsonb || jsonb_build_array(jsonb_build_object('kind', 'option', 'name', '非表示', 'option_id', o_hid, 'quantity', 1, 'unit_price', 1000, 'line_key', l2)))::text));
  perform pg_temp.pl_expect_eq('PL-24 見積 Draft：シミュレーター非表示の商品も選べる（見積不可ではない）', '2', v_out);
  perform pg_temp.pl_expect_error('PL-25 見積 Draft：取扱終了の商品は新しく選べない（古い画面からの保存も DB で止まる）', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_admin, format(
      'select public.save_quote_draft(%L, 2, null, %L::jsonb, 0, null, null, null)::text', qd,
      (v_items::jsonb || jsonb_build_array(jsonb_build_object('kind', 'option', 'name', '取扱終了', 'option_id', o_ret, 'quantity', 1, 'unit_price', 1000)))::text)));
  update public.options set archived_at = now() where id = o_q;
  perform pg_temp.pl_next_transaction();
  v_out := pg_temp.pl_run_as('authenticated', u_admin, format(
    'select public.save_quote_draft(%L, 2, null, %L::jsonb, 0, null, null, null)::text', qd, v_items));
  perform pg_temp.pl_expect_eq('PL-26 見積 Draft：取扱終了前から保存済みの明細は、変えずに保存し直せる', '3', v_out);
  perform pg_temp.pl_next_transaction();
  perform pg_temp.pl_expect_error('PL-27 見積 Draft：取扱終了の明細の数量は増やせない', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_admin, format(
      'select public.save_quote_draft(%L, 3, null, %L::jsonb, 0, null, null, null)::text', qd,
      jsonb_build_array(jsonb_build_object('kind', 'option', 'name', '見積の商品', 'option_id', o_q, 'quantity', 3, 'unit_price', 1000, 'line_key', l1))::text)));
  perform pg_temp.pl_next_transaction();
  v_out := pg_temp.pl_run_as('authenticated', u_admin, format(
    'select public.save_quote_draft(%L, 3, null, %L::jsonb, 0, null, null, null)::text', qd,
    jsonb_build_array(jsonb_build_object('kind', 'option', 'name', '見積の商品', 'option_id', o_q, 'quantity', 1, 'unit_price', 1000, 'line_key', l1))::text));
  perform pg_temp.pl_expect_eq('PL-28 見積 Draft：取扱終了の明細の数量は減らせる', '4', v_out);
  perform pg_temp.pl_expect_error('PL-29 見積 Draft：別の商品の明細を取扱終了の商品へ置き換えられない', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_admin, format(
      'select public.save_quote_draft(%L, 4, null, %L::jsonb, 0, null, null, null)::text', qd,
      jsonb_build_array(
        jsonb_build_object('kind', 'option', 'name', '見積の商品', 'option_id', o_q, 'quantity', 1, 'unit_price', 1000, 'line_key', l1),
        jsonb_build_object('kind', 'option', 'name', '置き換え', 'option_id', o_ret, 'quantity', 1, 'unit_price', 1000, 'line_key', l2))::text)));
  perform pg_temp.pl_expect_error('PL-30 見積 Draft：同じ取扱終了の商品を別の明細として足せない', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_admin, format(
      'select public.save_quote_draft(%L, 4, null, %L::jsonb, 0, null, null, null)::text', qd,
      jsonb_build_array(
        jsonb_build_object('kind', 'option', 'name', '見積の商品', 'option_id', o_q, 'quantity', 1, 'unit_price', 1000, 'line_key', l1),
        jsonb_build_object('kind', 'option', 'name', '複製', 'option_id', o_q, 'quantity', 1, 'unit_price', 1000))::text)));
  perform pg_temp.pl_next_transaction();
  v_out := pg_temp.pl_run_as('authenticated', u_admin, format(
    'select public.save_quote_draft(%L, 4, null, %L::jsonb, 0, null, null, null)::text', qd,
    jsonb_build_array(jsonb_build_object('kind', 'free', 'name', '自由明細', 'quantity', 1, 'unit_price', 500))::text));
  perform pg_temp.pl_expect_eq('PL-31 見積 Draft：取扱終了の明細は削除できる（商品 ID のない自由明細は判定しない）', '5', v_out);
  perform pg_temp.pl_next_transaction();
  perform pg_temp.pl_expect_error('PL-32 見積 Draft：一度削除した取扱終了の明細は、同じ line_key でも足し直せない', 'P0001', 'RETIRED',
    pg_temp.pl_run_as('authenticated', u_admin, format(
      'select public.save_quote_draft(%L, 5, null, %L::jsonb, 0, null, null, null)::text', qd, v_items)));

  -- ---------- 改訂 Draft：発行済みの版からの引き継ぎ ----------
  perform pg_temp.pl_next_transaction();
  perform pg_temp.pl_expect_eq('PL-33 改訂 Draft を作るときは、親の版にある取扱終了の明細を引き継げる（line_key で系列を確かめる）', 'ok',
    pg_temp.pl_try(format(
      'insert into public.quote_draft_items (draft_id, line_key, kind, option_id, name, unit_price, quantity, amount, sort_order) values (%L, %L, ''option'', %L, ''改訂で引き継ぐ商品'', 1000, 2, 2000, 1) returning ''ok''',
      qd_new, l_carry, o_q_carry)));
  set local session_replication_role = replica;
  insert into public.quote_drafts (id, quote_request_id, parent_quote_id, base_model_id, spec_code, quote_kind, tax_rate, lock_version, source_kind, finish_level, created_at)
  values (qd_old, qr3, q_parent, m_model, 'base', 'formal', 0.10, 0, 'manual', 'full', now() - interval '1 day');
  set local session_replication_role = origin;
  perform pg_temp.pl_expect_error('PL-34 前に作った改訂 Draft には、親の版の取扱終了の明細を後から足し直せない', 'P0001', 'RETIRED',
    pg_temp.pl_try(format(
      'insert into public.quote_draft_items (draft_id, line_key, kind, option_id, name, unit_price, quantity, amount, sort_order) values (%L, %L, ''option'', %L, ''改訂で引き継ぐ商品'', 1000, 2, 2000, 1) returning ''ok''',
      qd_old, l_carry, o_q_carry)));
  perform pg_temp.pl_expect_error('PL-35 改訂 Draft を作るときも、親の版より数量を増やした引き継ぎはできない', 'P0001', 'RETIRED',
    pg_temp.pl_try(format(
      'update public.quote_draft_items set quantity = 3 where draft_id = %L and line_key = %L returning ''ok''', qd_new, l_carry)));

  -- ---------- 見積の発行 ----------
  perform pg_temp.pl_expect_error('PL-36 取扱終了の商品が残っている明細では見積を発行できない（発行の全経路が通る明細の追加で止める）', 'P0001', 'RETIRED',
    pg_temp.pl_try(format(
      'insert into public.quote_items (quote_id, kind, name, unit_price, quantity, amount, sort_order, option_id) values (%L, ''option'', ''取扱終了'', 1000, 1, 1000, 9, %L) returning ''ok''',
      q_parent, o_ret)));
  perform pg_temp.pl_expect_eq('PL-37 シミュレーター非表示だけなら見積を発行できる', 'ok',
    pg_temp.pl_try(format(
      'insert into public.quote_items (quote_id, kind, name, unit_price, quantity, amount, sort_order, option_id) values (%L, ''option'', ''非表示'', 1000, 1, 1000, 9, %L) returning ''ok''',
      q_parent, o_hid)));

  -- ---------- 標準見積 ----------
  -- 20261020110000（2026-10-19 の先方回答）：使用中でも販売停止（#500 の取扱終了）にでき、その仕様は新しい受付を止める
  perform pg_temp.pl_expect_eq('PL-38 公開中の標準見積の標準状態にある商品も販売停止にできる（20261020110000）', 'ok',
    pg_temp.pl_try(format('update public.options set archived_at = now() where id = %L returning ''ok''', o_std)));
  -- 後の検査（PL-39）のために販売を再開しておく
  perform pg_temp.pl_try(format('update public.options set archived_at = null where id = %L returning ''ok''', o_std));
  v_before := (select r.subtotal || '/' || r.total || '/' || b.unit_price_snapshot || '/' || b.quantity
                 from public.standard_estimate_revisions r join public.standard_estimate_revision_baseline_items b on b.revision_id = r.id
                where r.id = rev_pub);
  update public.options set simulator_visible = false where id = o_std;
  perform pg_temp.pl_expect_eq('PL-39 シミュレーター非表示にしても、公開中の標準見積の金額・標準状態・標準構成は変わらない', v_before || '/true',
    (select r.subtotal || '/' || r.total || '/' || b.unit_price_snapshot || '/' || b.quantity
       from public.standard_estimate_revisions r join public.standard_estimate_revision_baseline_items b on b.revision_id = r.id
      where r.id = rev_pub) || '/' || (o_std = any(public.product_lifecycle_baseline_option_ids(m_model, 'base')))::text);
  perform pg_temp.pl_expect_eq('PL-40 下書きの標準見積にだけある商品は取扱終了にできる', 'ok',
    pg_temp.pl_try(format('update public.options set archived_at = now() where id = %L returning ''ok''', o_std_draft)));
  perform pg_temp.pl_next_transaction();
  delete from public.standard_estimate_revision_baseline_items where revision_id = rev_draft;
  perform pg_temp.pl_expect_eq('PL-41 標準見積の下書き：保存済みの取扱終了の明細は、数量を増やさずに入れ直せる', 'ok',
    pg_temp.pl_try(format(
      'insert into public.standard_estimate_revision_baseline_items (revision_id, option_id, option_category_id, section_code, selection_target_code, quantity, option_code_snapshot, option_name_snapshot, category_code_snapshot, category_name_snapshot, unit_price_snapshot, sort_order) values (%L, %L, %L, ''option'', ''runtime-pl-items'', 1, ''runtime-pl-std-draft'', ''下書きの標準見積の商品'', ''runtime-pl-items'', ''状態検査の商品'', 1000, 1) returning ''ok''',
      rev_draft, o_std_draft, c_items)));
  perform pg_temp.pl_expect_error('PL-42 標準見積の下書き：保持した取扱終了の明細に、新しい選択肢は足せない', 'P0001', 'RETIRED',
    pg_temp.pl_try(format(
      'insert into public.standard_estimate_revision_baseline_variants (baseline_item_id, variant_group_id, variant_choice_id, variant_group_code_snapshot, variant_group_name_snapshot, variant_choice_code_snapshot, variant_choice_name_snapshot, extra_price_snapshot, sort_order) select b.id, %L, %L, ''pl-size'', ''大きさ'', ''large'', ''大'', 0, 1 from public.standard_estimate_revision_baseline_items b where b.revision_id = %L returning ''ok''',
      g_std, s2, rev_draft)));
  perform pg_temp.pl_expect_eq('PL-43 標準見積の下書き：保持した明細の保存前の選択肢は入れ直せる', 'ok',
    pg_temp.pl_try(format(
      'insert into public.standard_estimate_revision_baseline_variants (baseline_item_id, variant_group_id, variant_choice_id, variant_group_code_snapshot, variant_group_name_snapshot, variant_choice_code_snapshot, variant_choice_name_snapshot, extra_price_snapshot, sort_order) select b.id, %L, %L, ''pl-size'', ''大きさ'', ''small'', ''小'', 0, 1 from public.standard_estimate_revision_baseline_items b where b.revision_id = %L returning ''ok''',
      g_std, s1, rev_draft)));
  perform pg_temp.pl_expect_error('PL-44 標準見積の下書き：取扱終了の明細の数量は増やせない', 'P0001', 'RETIRED',
    pg_temp.pl_try(format('update public.standard_estimate_revision_baseline_items set quantity = 5 where revision_id = %L returning ''ok''', rev_draft)));
  perform pg_temp.pl_expect_error('PL-45 標準見積の下書き：取扱終了の商品を新しく標準状態に入れられない', 'P0001', 'RETIRED',
    pg_temp.pl_try(format(
      'insert into public.standard_estimate_revision_baseline_items (revision_id, option_id, option_category_id, section_code, selection_target_code, quantity, option_code_snapshot, option_name_snapshot, category_code_snapshot, category_name_snapshot, unit_price_snapshot, sort_order) values (%L, %L, %L, ''option'', ''runtime-pl-items'', 1, ''runtime-pl-ret'', ''取扱終了'', ''runtime-pl-items'', ''状態検査の商品'', 1000, 2) returning ''ok''',
      rev_draft, o_ret, c_items)));
  perform pg_temp.pl_expect_error('PL-46 取扱終了の商品が標準状態に残っている標準見積は公開できない', 'P0001', 'RETIRED',
    pg_temp.pl_try(format('update public.standard_estimate_revisions set status = ''published'', published_at = now() where id = %L returning ''ok''', rev_draft)));
  perform pg_temp.pl_expect_eq('PL-47 シミュレーター非表示の商品は、標準見積の標準状態に入れられる（見積不可ではない）', 'ok',
    pg_temp.pl_try(format(
      'insert into public.standard_estimate_revision_baseline_items (revision_id, option_id, option_category_id, section_code, selection_target_code, quantity, option_code_snapshot, option_name_snapshot, category_code_snapshot, category_name_snapshot, unit_price_snapshot, sort_order) values (%L, %L, %L, ''option'', ''runtime-pl-items'', 1, ''runtime-pl-hid'', ''非表示'', ''runtime-pl-items'', ''状態検査の商品'', 1000, 3) returning ''ok''',
      rev_draft, o_hid, c_items)));

  -- ---------- 取扱終了の参照保護・状態の変更 ----------
  perform pg_temp.pl_expect_eq('PL-48 Excel 標準見積の基準商品も販売停止にできる（20261020110000）', 'ok',
    pg_temp.pl_try(format('update public.options set archived_at = now() where id = %L returning ''ok''', o_tmpl)));
  perform pg_temp.pl_expect_error('PL-49 初期選択（必須）の商品は取扱終了にできない', 'P0001', 'LOCKED',
    pg_temp.pl_try(format('update public.options set archived_at = now() where id = %L returning ''ok''', o_default)));
  perform pg_temp.pl_expect_error('PL-50 取扱中の商品の前提商品は取扱終了にできない', 'P0001', 'LOCKED',
    pg_temp.pl_try(format('update public.options set archived_at = now() where id = %L returning ''ok''', o_dep_target)));
  perform pg_temp.pl_expect_eq('PL-51 本体の仕様（標準の商品構成）に入っている商品も販売停止にできる（20261020110000）', 'ok',
    pg_temp.pl_try(format('update public.options set archived_at = now() where id = %L returning ''ok''', o_base_hid)));
  perform pg_temp.pl_expect_error('PL-52 下書きの商品は取扱終了にできない', 'P0001', 'VALIDATION',
    pg_temp.pl_try(format('update public.options set archived_at = now() where id = %L returning ''ok''', o_draft)));
  perform pg_temp.pl_expect_error('PL-53 取扱終了の日時だけを変えることはできない（再開してから終了する）', 'P0001', 'VALIDATION',
    pg_temp.pl_try(format('update public.options set archived_at = now() - interval ''2 days'' where id = %L returning ''ok''', o_ret)));
  perform pg_temp.pl_expect_error('PL-54 取扱終了の商品のシミュレーター表示は変えられない', 'P0001', 'VALIDATION',
    pg_temp.pl_try(format('update public.options set simulator_visible = true where id = %L returning ''ok''', o_ret)));
  perform pg_temp.pl_expect_error('PL-55 下書きの商品のシミュレーター表示は変えられない', 'P0001', 'VALIDATION',
    pg_temp.pl_try(format('update public.options set simulator_visible = false where id = %L returning ''ok''', o_draft)));
  v_out := pg_temp.pl_try(format('update public.options set archived_at = null where id = %L returning ''ok''', o_ret));
  perform pg_temp.pl_expect_eq('PL-56 取扱を再開すると登録済みに戻り、シミュレーター表示は以前の値（非表示）のまま', 'ok/registered/false',
    v_out || '/' || (select public.product_lifecycle_state(o.status, o.archived_at) || '/' || o.simulator_visible::text from public.options o where o.id = o_ret));

  -- ---------- 権限・直接書き込み・旧経路 ----------
  perform pg_temp.pl_expect_eq('PL-57 お客様・代理店は商品の状態を変えられない（RLS で 0 行）', '0/0',
    pg_temp.pl_run_as('authenticated', u_cust, format('with u as (update public.options set archived_at = now() where id = %L returning 1) select count(*)::text from u', o_vis)) || '/' ||
    pg_temp.pl_run_as('authenticated', u_dealer, format('with u as (update public.options set archived_at = now() where id = %L returning 1) select count(*)::text from u', o_vis)));
  perform pg_temp.pl_expect_eq('PL-58 商品台帳を編集できる利用者（今の can_edit_catalog のまま。#502 の未確定事項は変えない）は状態を変えられる', '1',
    pg_temp.pl_run_as('authenticated', u_editor, format('with u as (update public.options set archived_at = now() where id = %L returning 1) select count(*)::text from u', o_hid)));
  perform pg_temp.pl_expect_error('PL-59 商品台帳を編集できる利用者でも、参照保護は DB で止まる', 'P0001', 'LOCKED',
    pg_temp.pl_run_as('authenticated', u_editor, format('update public.options set archived_at = now() where id = %L returning ''ok''', o_default)));
  perform pg_temp.pl_expect_error('PL-60 構成の明細は直接書き込めない（保存は RPC だけ）', '42501', '',
    pg_temp.pl_run_as('authenticated', u_cust, format('insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids) values (%L, %L, 1, ''{}'') returning ''ok''', v_cfg, o_ret)));
  perform pg_temp.pl_expect_error('PL-61 見積 Draft の明細は直接書き込めない', '42501', '',
    pg_temp.pl_run_as('authenticated', u_admin, format('insert into public.quote_draft_items (draft_id, line_key, kind, option_id, name, unit_price, quantity, amount, sort_order) values (%L, gen_random_uuid(), ''option'', %L, ''直接'', 0, 1, 0, 1) returning ''ok''', qd, o_ret)));
  perform pg_temp.pl_expect_error('PL-62 見積の明細は直接書き込めない（本部でも）', '42501', '',
    pg_temp.pl_run_as('authenticated', u_admin, format('insert into public.quote_items (quote_id, kind, name, unit_price, quantity, amount, sort_order, option_id) values (%L, ''option'', ''直接'', 0, 1, 0, 1, %L) returning ''ok''', q_parent, o_vis)));
  perform pg_temp.pl_expect_eq('PL-63 旧い保存の関数（互換用の save_configuration のすべての版）は、利用者に実行権限が無い', 'false/false',
    (select coalesce(bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')), false)::text || '/' ||
            coalesce(bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), false)::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'save_configuration'));
  perform pg_temp.pl_expect_eq('PL-64 画面の機能判定は、ログインした利用者だけが呼べる', 'true/denied',
    (pg_temp.pl_run_as('authenticated', u_cust, 'select (public.product_lifecycle_capability() ->> ''guards'')')) || '/' ||
    case when pg_temp.pl_run_as('anon', null, 'select public.product_lifecycle_capability()::text') like 'ERROR 42501:%' then 'denied' else 'allowed' end);
  perform pg_temp.pl_expect_error('PL-65 一時領域の部品は利用者から呼べない（消した明細を偽れない）', '42501', '',
    pg_temp.pl_run_as('authenticated', u_cust, format(
      $q$ select public.product_lifecycle_stash_add('configuration:' || %L, '{"option_id": "x"}'::jsonb)::text $q$, v_cfg)));

  -- ---------- #507 と合わせた保存（選択肢のある商品が 2 つ以上） ----------
  -- #507（20261015100000）で、構成の保存は選択肢をその商品の明細にだけ入れるようになった。直す前は、すべての明細に
  -- すべての選択肢が入るため、取扱終了の明細を残したまま別の商品の選択肢を変えると、保存前の明細と一致せず拒否される。
  -- そのため本番では #507 を先に（または同時に）適用する。#507 が無い DB（直す前の書き方が残っている）では省略する
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'save_configuration_atomic'
       and position('vg.option_id = option_id' in pg_get_functiondef(p.oid)) = 0
  ) then
    perform pg_temp.pl_next_transaction();
    v_cfg_var := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, null, m_model, array[o_keep2, o_var2], array[m1, x1], 'base', '[]', 'null'))::uuid;
    update public.options set archived_at = now() where id = o_keep2;
    perform pg_temp.pl_next_transaction();
    select lock_version into v_lock from public.configurations where id = v_cfg_var;
    v_out := pg_temp.pl_run_as('authenticated', u_cust, format(v_save, v_cfg_var, m_model, array[o_keep2, o_var2], array[m1, x2], 'base', '[]', v_lock));
    perform pg_temp.pl_expect_eq('PL-66 取扱終了の明細（選択肢あり）を残したまま、別の商品の選択肢を変えて保存できる（#507 適用後）',
      v_cfg_var::text || '/' || m1::text || '/' || x2::text,
      v_out || '/' ||
      coalesce((select array_to_string(ci.variant_choice_ids, ',') from public.configuration_items ci
                 where ci.configuration_id = v_cfg_var and ci.option_id = o_keep2), 'なし') || '/' ||
      coalesce((select array_to_string(ci.variant_choice_ids, ',') from public.configuration_items ci
                 where ci.configuration_id = v_cfg_var and ci.option_id = o_var2), 'なし'));
  else
    perform pg_temp.pl_expect_eq('PL-66 取扱終了の明細（選択肢あり）を残したまま別の商品の選択肢を変える保存（#507 の修正が未適用のため省略）', 'skipped', 'skipped');
  end if;
end;
$test$;

select jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq) as j
from _pl_result;

rollback;
