-- 正式見積の発行で未解決の別途見積（POR）を残さない止め（20261016111000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 商品マスターが空の DB で実行する（検査用のモデル・カテゴリー・商品だけで見積を作るため）。
begin;

create temp table _qpg_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _qpg_result to public;

create function pg_temp.qpg_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.qpg_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _qpg_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

-- 拒否されたこと（SQLSTATE と、メッセージの先頭）を確かめる
create function pg_temp.qpg_expect_error(p_step text, p_code text, p_prefix text, p_actual text) returns void
language sql as $fn$
  insert into _qpg_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_prefix || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_prefix || '%');
$fn$;

-- superuser のまま実行して結果（エラー）を文字列で返す
create function pg_temp.qpg_try(p_sql text) returns text
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
  u_admin constant uuid := '7a000000-0000-4000-8000-000000000001';
  u_dealer constant uuid := '7a000000-0000-4000-8000-000000000002';
  u_dealer2 constant uuid := '7a000000-0000-4000-8000-000000000003';
  u_master constant uuid := '7a000000-0000-4000-8000-000000000004';
  u_cust constant uuid := '7a000000-0000-4000-8000-000000000005';
  m_model constant uuid := '7a100000-0000-4000-8000-000000000001';
  c_items constant uuid := '7a200000-0000-4000-8000-000000000001';
  c_exterior uuid;
  o_por constant uuid := '7a300000-0000-4000-8000-000000000001';
  o_plain constant uuid := '7a300000-0000-4000-8000-000000000002';
  o_ext constant uuid := '7a300000-0000-4000-8000-000000000003';
  o_inst constant uuid := '7a300000-0000-4000-8000-000000000004';
  g_plain constant uuid := '7a400000-0000-4000-8000-000000000001';
  g_ext constant uuid := '7a400000-0000-4000-8000-000000000002';
  vc_plain constant uuid := '7a410000-0000-4000-8000-000000000001';
  vc_por constant uuid := '7a410000-0000-4000-8000-000000000002';
  e_plain constant uuid := '7a410000-0000-4000-8000-000000000003';
  e_por constant uuid := '7a410000-0000-4000-8000-000000000004';
  cfg constant uuid := '7a500000-0000-4000-8000-000000000001';
  cfg2 constant uuid := '7a500000-0000-4000-8000-000000000002';
  cfg3 constant uuid := '7a500000-0000-4000-8000-000000000003';
  cfg4 constant uuid := '7a500000-0000-4000-8000-000000000004';
  qr constant uuid := '7a600000-0000-4000-8000-000000000001';
  qr2 constant uuid := '7a600000-0000-4000-8000-000000000002';
  qr3 constant uuid := '7a600000-0000-4000-8000-000000000003';
  qr4 constant uuid := '7a600000-0000-4000-8000-000000000004';
  qr5 constant uuid := '7a600000-0000-4000-8000-000000000005';
  q1 constant uuid := '7a700000-0000-4000-8000-000000000001';
  q2 constant uuid := '7a700000-0000-4000-8000-000000000002';
  q3 constant uuid := '7a700000-0000-4000-8000-000000000003';
  q4 constant uuid := '7a700000-0000-4000-8000-000000000004';
  qd constant uuid := '7a800000-0000-4000-8000-000000000001';
  i4_inst constant uuid := '7a900000-0000-4000-8000-000000000001';
  d_line constant uuid := '7a910000-0000-4000-8000-000000000001';
  v_faces jsonb;
  v_keys text;
  v_out text;
  v_confirm text;
  v_new text;
  v_count integer;
  v_items_por_left text;
  v_items_priced text;
  v_items_included text;
begin
  if exists (select 1 from public.options o where o.code not like 'runtime-%') then
    perform pg_temp.qpg_expect_eq('QPG-0 商品マスターが空の DB で実行する検査のため省略', 'skipped', 'skipped');
    return;
  end if;

  -- ---------- 検査用のデータ（トリガーと外部キー検査を止めて、必要な行だけを直接入れる） ----------
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'qpg-admin@runtime.invalid', '{}'), (u_dealer, 'qpg-dealer@runtime.invalid', '{}'),
         (u_dealer2, 'qpg-dealer2@runtime.invalid', '{}'), (u_master, 'qpg-master@runtime.invalid', '{}'),
         (u_cust, 'qpg-cust@runtime.invalid', '{}');
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'qpg-admin@runtime.invalid', '本部', 'admin'), (u_dealer, 'qpg-dealer@runtime.invalid', '担当代理店', 'dealer'),
         (u_dealer2, 'qpg-dealer2@runtime.invalid', '担当外の代理店', 'dealer'), (u_master, 'qpg-master@runtime.invalid', '担当外の総代理店', 'master_dealer'),
         (u_cust, 'qpg-cust@runtime.invalid', 'お客様', 'customer');
  insert into public.base_models (id, slug, name, base_price, status)
  values (m_model, 'runtime-qpg-model', 'POR 検査用モデル', 1000000, 'published');
  insert into public.option_categories (id, code, name, selection_mode, is_required, finish_level, status, sort_order)
  values (c_items, 'runtime-qpg-items', 'POR 検査の商品', 'multi', false, 'shell', 'published', 1);
  insert into public.option_categories (code, name, selection_mode, is_required, finish_level, status)
  values ('exterior-wall', '外壁', 'single', false, 'shell', 'published')
  on conflict (code) do nothing;
  select id into c_exterior from public.option_categories where code = 'exterior-wall';
  insert into public.options (id, base_model_id, category_id, code, name, price, price_on_request, status, product_no, sort_order, is_installation)
  values
    (o_por, m_model, c_items, 'runtime-qpg-por', '検査の別途見積の商品', 0, true, 'published', 'PRD-971001', 1, false),
    (o_plain, m_model, c_items, 'runtime-qpg-plain', '検査の通常の商品', 10000, false, 'published', 'PRD-971002', 2, false),
    (o_ext, m_model, c_exterior, 'runtime-qpg-ext', '検査の外壁', 0, false, 'published', 'PRD-971003', 1, false),
    (o_inst, m_model, c_items, 'runtime-qpg-inst', '検査の別途見積の工事', 0, true, 'published', 'PRD-971004', 3, true);
  insert into public.option_variant_groups (id, option_id, code, name, status, is_required, sort_order)
  values (g_plain, o_plain, 'qpg-color', '色', 'published', false, 1),
         (g_ext, o_ext, 'qpg-paint', '塗装', 'published', false, 1);
  insert into public.option_variant_choices (id, group_id, code, name, status, price_on_request, sort_order)
  values (vc_plain, g_plain, 'white', '白', 'published', false, 1), (vc_por, g_plain, 'custom', '特注色', 'published', true, 2),
         (e_plain, g_ext, 'standard', '標準', 'published', false, 1), (e_por, g_ext, 'custom', '特注塗装', 'published', true, 2);

  -- 構成 cfg：別途見積の商品・別途見積の選択肢・外壁の正面に別途見積の選択肢（外壁の商品の明細は面の選択として数える）
  v_faces := jsonb_build_array(
    jsonb_build_object('face_code', 'front', 'option_id', o_ext, 'variant_choice_ids', jsonb_build_array(e_por)),
    jsonb_build_object('face_code', 'right', 'option_id', o_ext, 'variant_choice_ids', jsonb_build_array(e_plain)),
    jsonb_build_object('face_code', 'back', 'option_id', o_ext, 'variant_choice_ids', jsonb_build_array(e_plain)),
    jsonb_build_object('face_code', 'left', 'option_id', o_ext, 'variant_choice_ids', jsonb_build_array(e_plain)));
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level, exterior_faces)
  values (cfg, u_cust, m_model, 'POR を含む案件', 'quote_requested', 'base', 'full', v_faces),
         (cfg2, u_cust, m_model, 'POR を含まない案件', 'quote_requested', 'base', 'full', '[]'::jsonb),
         (cfg3, u_cust, m_model, '旧形式・概算を承諾済み（施工以外の POR）', 'closed', 'base', 'full', '[]'::jsonb),
         (cfg4, u_cust, m_model, '旧形式・概算を承諾済み（施工の POR）', 'closed', 'base', 'full', '[]'::jsonb);
  insert into public.configuration_items (configuration_id, option_id, quantity, variant_choice_ids)
  values (cfg, o_por, 1, '{}'), (cfg, o_plain, 1, array[vc_por]), (cfg, o_ext, 1, array[e_plain]),
         (cfg2, o_plain, 1, array[vc_plain]),
         (cfg3, o_por, 1, '{}'),
         (cfg4, o_inst, 1, '{}');
  insert into public.quote_requests (id, configuration_id, user_id, quote_id, status)
  values (qr, cfg, u_cust, q1, 'sent'), (qr2, cfg2, u_cust, q2, 'sent'), (qr3, cfg3, u_cust, q3, 'sent'), (qr4, cfg4, u_cust, q4, 'sent');
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, base_model_name, base_price, option_subtotal, installation_subtotal,
                             subtotal, tax_rate, tax, total, revision, parent_quote_id)
  values
    (q1, 'RT-QPG-1', qr, cfg, u_cust, u_dealer, 'issued', now() + interval '30 days', 'お客様', 'POR 検査用モデル', 1000000, 10000, 0, 1010000, 0.10, 101000, 1111000, 1, null),
    (q2, 'RT-QPG-2', qr2, cfg2, u_cust, u_dealer, 'issued', now() + interval '30 days', 'お客様', 'POR 検査用モデル', 1000000, 10000, 0, 1010000, 0.10, 101000, 1111000, 1, null),
    (q3, 'RT-QPG-3', qr3, cfg3, u_cust, u_dealer, 'accepted', now() + interval '30 days', 'お客様', 'POR 検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 1, null),
    (q4, 'RT-QPG-4', qr4, cfg4, u_cust, u_dealer, 'accepted', now() + interval '30 days', 'お客様', 'POR 検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 1, null);
  insert into public.quote_items (quote_id, kind, name, description, remark, unit_price, quantity, amount, sort_order)
  values (q1, 'base', '本体', null, null, 1000000, 1, 1000000, 1),
         (q1, 'option', '検査の別途見積の商品', '設置場所確認後に別途お見積り', null, 0, 1, 0, 1001),
         (q1, 'option', '検査の通常の商品（色：特注色）', 'POR 検査の商品', null, 10000, 1, 10000, 1002),
         (q2, 'base', '本体', null, null, 1000000, 1, 1000000, 1),
         (q2, 'option', '検査の通常の商品（色：白）', 'POR 検査の商品', null, 10000, 1, 10000, 1001),
         (q3, 'base', '本体', null, null, 1000000, 1, 1000000, 1),
         (q3, 'option', '検査の別途見積の商品', '設置場所確認後に別途お見積り', null, 0, 1, 0, 1001),
         (q4, 'base', '本体', null, null, 1000000, 1, 1000000, 1);
  insert into public.quote_items (id, quote_id, kind, name, description, remark, unit_price, quantity, amount, sort_order)
  values (i4_inst, q4, 'installation', '検査の別途見積の工事', '設置場所確認後に別途お見積り', null, 0, 1, 0, 1001);

  -- Web 以外の下書き（正式保存の前の確認だけを直接確かめる）
  insert into public.quote_requests (id, status, contact) values (qr5, 'new', '{}'::jsonb);
  insert into public.quote_drafts (id, quote_request_id, base_model_id, spec_code, quote_kind, tax_rate, lock_version, source_kind, finish_level)
  values (qd, qr5, m_model, 'base', 'formal', 0.10, 0, 'manual', 'full');
  insert into public.quote_draft_items (id, draft_id, line_key, kind, option_id, name, remark, unit_price, quantity, amount, sort_order, price_mode)
  values (d_line, qd, gen_random_uuid(), 'option', o_por, '検査の別途見積の商品', '別途見積', 0, 1, 0, 1, 'manual');
  set local session_replication_role = origin;

  -- ---------- 未解決の POR の行の決まり ----------
  perform pg_temp.qpg_expect_eq('QPG-1 未解決の POR の行：0 円で、備考の目印、または備考が空で説明・商品が POR（金額か理由の備考で解消）',
    'true,false,false,true,true,true,true,false,true,false,false,false',
    concat_ws(',',
      public.quote_line_is_unresolved_por(0, null, '設置場所確認後に別途お見積り', null)::text,
      public.quote_line_is_unresolved_por(0, null, '設置場所確認後に別途お見積り', '電気設備工事に含む')::text,
      public.quote_line_is_unresolved_por(5000, null, '設置場所確認後に別途お見積り', null)::text,
      public.quote_line_is_unresolved_por(0, null, null, '別途見積')::text,
      public.quote_line_is_unresolved_por(0, null, null, ' 別途見積 ')::text,
      public.quote_line_is_unresolved_por(0, null, null, '価格未確定（別途お見積り）')::text,
      public.quote_line_is_unresolved_por(0, null, null, '別途見積項目あり・見積発行時点の面別外壁仕様')::text,
      public.quote_line_is_unresolved_por(1000, null, null, '別途見積項目あり・見積発行時点の面別外壁仕様')::text,
      public.quote_line_is_unresolved_por(0, o_por, null, null)::text,
      public.quote_line_is_unresolved_por(0, o_por, null, 'サービス')::text,
      public.quote_line_is_unresolved_por(0, o_plain, null, null)::text,
      public.quote_line_is_unresolved_por(0, null, null, null)::text));

  -- ---------- お客様が選んだ POR の一覧 ----------
  perform pg_temp.qpg_expect_eq('QPG-2 お客様が選んだ POR：商品・選択肢・外壁の面（外壁の商品の明細は面として数える）',
    'product:' || o_por || '|検査の別途見積の商品|' || ';variant:' || o_plain || ':' || vc_por || '|検査の通常の商品|色：特注色'
      || ';face:front:' || o_ext || '|検査の外壁|外壁（正面）：塗装：特注塗装',
    (select string_agg((e ->> 'key') || '|' || (e ->> 'name') || '|' || coalesce(e ->> 'detail', ''), ';' order by ord)
       from jsonb_array_elements(public.configuration_por_selections(cfg)) with ordinality as x(e, ord)));
  perform pg_temp.qpg_expect_eq('QPG-3 POR を選んでいない構成・存在しない構成は空', '[]/[]',
    public.configuration_por_selections(cfg2)::text || '/' || public.configuration_por_selections(gen_random_uuid())::text);

  -- ---------- 権限 ----------
  perform pg_temp.qpg_expect_eq('QPG-4 内部の部品は anon・ログインした利用者・service_role から実行できない', 'false',
    (select bool_or(has_function_privilege(r, f, 'execute'))::text
       from unnest(array['anon', 'authenticated', 'service_role']) as r,
            unnest(array['public.quote_line_is_unresolved_por(numeric, uuid, text, text)', 'public.configuration_por_selections(uuid)',
                         'public.quote_por_selections_confirmed(uuid, uuid, jsonb)', 'public.assert_quote_lines_por_resolved(uuid)',
                         'public.assert_quote_draft_lines_por_resolved(uuid)', 'public.assert_case_por_selections_confirmed(uuid, uuid)']) as f));
  perform pg_temp.qpg_expect_eq('QPG-5 一覧の取得・確認の RPC はログインした利用者だけ（anon・service_role は不可）', 'false/false/true',
    (has_function_privilege('anon', 'public.get_quote_por_selections(uuid)', 'execute') or has_function_privilege('anon', 'public.confirm_quote_por_selections(uuid, text[])', 'execute'))::text
    || '/' || (has_function_privilege('service_role', 'public.get_quote_por_selections(uuid)', 'execute') or has_function_privilege('service_role', 'public.confirm_quote_por_selections(uuid, text[])', 'execute'))::text
    || '/' || (has_function_privilege('authenticated', 'public.get_quote_por_selections(uuid)', 'execute') and has_function_privilege('authenticated', 'public.confirm_quote_por_selections(uuid, text[])', 'execute'))::text);
  perform pg_temp.qpg_expect_eq('QPG-6 確認の記録の表は RLS 有効で、利用者からは読み書きできない', 'true/false',
    (select c.relrowsecurity::text from pg_catalog.pg_class c where c.oid = 'public.quote_por_confirmations'::regclass) || '/'
    || (has_table_privilege('authenticated', 'public.quote_por_confirmations', 'select') or has_table_privilege('authenticated', 'public.quote_por_confirmations', 'insert')
        or has_table_privilege('anon', 'public.quote_por_confirmations', 'select'))::text);
  perform pg_temp.qpg_expect_error('QPG-7 担当外の代理店は一覧を取れない', '42501', 'FORBIDDEN',
    pg_temp.qpg_run_as('authenticated', u_dealer2, format('select public.get_quote_por_selections(%L)::text', q1)));
  perform pg_temp.qpg_expect_error('QPG-8 担当外の総代理店は一覧を取れない', '42501', 'FORBIDDEN',
    pg_temp.qpg_run_as('authenticated', u_master, format('select public.get_quote_por_selections(%L)::text', q1)));
  perform pg_temp.qpg_expect_error('QPG-9 お客様は一覧を取れない', '42501', 'FORBIDDEN',
    pg_temp.qpg_run_as('authenticated', u_cust, format('select public.get_quote_por_selections(%L)::text', q1)));
  perform pg_temp.qpg_expect_eq('QPG-10 担当の代理店・本部は一覧を取れる（まだ確認していない）', '3/false/3/false',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select jsonb_array_length(j -> 'selections') || '/' || (j ->> 'confirmed') from public.get_quote_por_selections(%L) j $q$, q1))
    || '/' || pg_temp.qpg_run_as('authenticated', u_admin, format($q$ select jsonb_array_length(j -> 'selections') || '/' || (j ->> 'confirmed') from public.get_quote_por_selections(%L) j $q$, q1)));

  -- ---------- 改訂（確定見積）：create_quote_revision ----------
  v_items_por_left := jsonb_build_array(
    jsonb_build_object('kind', 'option', 'name', '検査の別途見積の商品', 'description', '設置場所確認後に別途お見積り', 'unit_price', 0, 'quantity', 1),
    jsonb_build_object('kind', 'option', 'name', '検査の通常の商品（色：特注色）', 'unit_price', 10000, 'quantity', 1))::text;
  v_items_priced := jsonb_build_array(
    jsonb_build_object('kind', 'option', 'name', '検査の別途見積の商品', 'description', '設置場所確認後に別途お見積り', 'unit_price', 50000, 'quantity', 1),
    jsonb_build_object('kind', 'option', 'name', '検査の通常の商品（色：特注色）', 'unit_price', 12000, 'quantity', 1),
    jsonb_build_object('kind', 'installation', 'name', '外壁の特注塗装', 'unit_price', 30000, 'quantity', 1))::text;
  v_items_included := jsonb_build_array(
    jsonb_build_object('kind', 'option', 'name', '検査の別途見積の商品', 'description', '設置場所確認後に別途お見積り', 'remark', '電気設備工事に含む', 'unit_price', 0, 'quantity', 1),
    jsonb_build_object('kind', 'option', 'name', '検査の通常の商品（色：特注色）', 'unit_price', 12000, 'quantity', 1),
    jsonb_build_object('kind', 'installation', 'name', '電気設備工事（照明器具を含む）', 'unit_price', 80000, 'quantity', 1))::text;

  perform pg_temp.qpg_expect_error('QPG-11 POR の行を 0 円のまま残した改訂は発行しない', 'P0001', 'VALIDATION: 別途見積（価格未確定）の明細が 1 行残っています（検査の別途見積の商品）',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1, v_items_por_left)));
  perform pg_temp.qpg_expect_error('QPG-12 金額を入れても、お客様が選んだ POR を担当者が確認していなければ発行しない', 'P0001', 'VALIDATION: お客様が選んだ別途見積の商品（3 件',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1, v_items_priced)));
  perform pg_temp.qpg_expect_eq('QPG-13 止めた改訂では版が増えず、元の版は発行中のまま', '1/issued',
    (select count(*)::text from public.quotes where quote_request_id = qr) || '/' || (select status from public.quotes where id = q1));

  select string_agg(e ->> 'key', ',') into v_keys from jsonb_array_elements(public.configuration_por_selections(cfg)) e;
  perform pg_temp.qpg_expect_error('QPG-14 担当外の代理店は確認を記録できない', '42501', 'FORBIDDEN',
    pg_temp.qpg_run_as('authenticated', u_dealer2, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', q1, v_keys)));
  perform pg_temp.qpg_expect_error('QPG-15 画面に出した一覧と今の一覧が違えば、確認を記録しない', 'P0001', 'LOCKED',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, array[%L])::text', q1, 'product:' || o_por)));
  perform pg_temp.qpg_expect_error('QPG-16 POR を選んでいない案件では確認はない', 'P0001', 'VALIDATION',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, array[]::text[])::text', q2)));

  -- 本部の確認は、発行する担当代理店の確認の代わりにならない
  v_out := pg_temp.qpg_run_as('authenticated', u_admin, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', q1, v_keys));
  perform pg_temp.qpg_expect_eq('QPG-17 本部は確認を記録できる', 'true', (v_out ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.qpg_expect_error('QPG-18 発行する担当者自身の確認がなければ、本部の確認があっても発行しない', 'P0001', 'VALIDATION: お客様が選んだ別途見積の商品',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1, v_items_priced)));

  v_confirm := pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', q1, v_keys));
  v_out := pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', q1, v_keys));
  perform pg_temp.qpg_expect_eq('QPG-19 担当代理店の確認を記録し、同じ一覧の確認は二重に残さない', 'true/true/1',
    (v_confirm ~ '^[0-9a-f-]{36}$')::text || '/' || (v_out = v_confirm)::text || '/'
    || (select count(*)::text from public.quote_por_confirmations c where c.quote_id = q1 and c.confirmed_by = u_dealer));
  perform pg_temp.qpg_expect_eq('QPG-20 確認の後は、一覧の取得でも確認済みと分かる', 'true',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select j ->> 'confirmed' from public.get_quote_por_selections(%L) j $q$, q1)));
  perform pg_temp.qpg_expect_error('QPG-21 確認の後でも、POR の行を 0 円のまま残せば発行しない', 'P0001', 'VALIDATION: 別途見積（価格未確定）の明細',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1, v_items_por_left)));

  v_new := pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1, v_items_included));
  perform pg_temp.qpg_expect_eq('QPG-22 確認済みで、POR の行に理由（ほかの明細に含む）を書けば 0 円のままでも発行できる', 'true', (v_new ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.qpg_expect_eq('QPG-23 発行した改訂が案件の現在の見積になり、元の版は置き換わる', '2/superseded/issued/' || v_new,
    (select count(*)::text from public.quotes where quote_request_id = qr) || '/' || (select status from public.quotes where id = q1) || '/'
    || coalesce((select status from public.quotes where id::text = v_new), '-') || '/' || (select quote_id::text from public.quote_requests where id = qr));
  perform pg_temp.qpg_expect_eq('QPG-24 新しい版では、もう一度確認が要る（確認は版ごと）', 'false',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select j ->> 'confirmed' from public.get_quote_por_selections(%L) j $q$, v_new)));
  perform pg_temp.qpg_expect_error('QPG-25 置き換わった版には確認を記録できない', 'P0001', 'LOCKED',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', q1, v_keys)));
  perform pg_temp.qpg_expect_error('QPG-26 確認の記録は DB の管理者でも書き換えられない', 'P0001', 'IMMUTABLE',
    pg_temp.qpg_try(format('update public.quote_por_confirmations set confirmed_at = now() where quote_id = %L returning ''updated''', q1)));
  perform pg_temp.qpg_expect_error('QPG-27 確認の記録は DB の管理者でも削除できない', 'P0001', 'IMMUTABLE',
    pg_temp.qpg_try(format('delete from public.quote_por_confirmations where quote_id = %L returning ''deleted''', q1)));

  v_out := pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select public.create_quote_revision(%L, '[{"kind":"installation","name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, null)::text $q$, q2));
  perform pg_temp.qpg_expect_eq('QPG-28 POR を選んでいない案件は、確認なしで従来どおり改訂できる', 'true', (v_out ~ '^[0-9a-f-]{36}$')::text);

  -- ---------- 承諾済みの概算からの確定見積（旧形式の互換） ----------
  v_out := pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, array[%L])::text', q3, 'product:' || o_por));
  perform pg_temp.qpg_expect_eq('QPG-29 承諾済みの概算にも確認を記録できる', 'true', (v_out ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.qpg_expect_error('QPG-30 施工以外の POR の行（この画面では直せない）が残る概算からは確定見積を作らない', 'P0001', 'VALIDATION: 別途見積（価格未確定）の明細が 1 行',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[]'::jsonb, null)::text $q$, q3)));
  perform pg_temp.qpg_expect_error('QPG-31 施工の POR の行を 0 円・備考なしで残せば確定見積を作らない', 'P0001', 'VALIDATION: 別途見積（価格未確定）の明細が 1 行',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, %L::jsonb, null)::text $q$, q4,
      jsonb_build_array(jsonb_build_object('source_item_id', i4_inst, 'name', '検査の別途見積の工事', 'unit_price', 0, 'quantity', 1)))));
  perform pg_temp.qpg_expect_error('QPG-32 施工の金額を入れても、担当者の確認がなければ確定見積を作らない', 'P0001', 'VALIDATION: お客様が選んだ別途見積の商品（1 件',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, %L::jsonb, null)::text $q$, q4,
      jsonb_build_array(jsonb_build_object('source_item_id', i4_inst, 'name', '検査の別途見積の工事', 'unit_price', 80000, 'quantity', 1)))));
  perform pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, array[%L])::text', q4, 'product:' || o_inst));
  v_out := pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, %L::jsonb, null)::text $q$, q4,
    jsonb_build_array(jsonb_build_object('source_item_id', i4_inst, 'name', '検査の別途見積の工事', 'unit_price', 80000, 'quantity', 1))));
  perform pg_temp.qpg_expect_eq('QPG-33 確認済みで施工の金額を入れれば、確定見積を作れる', 'true/formal/80000',
    (v_out ~ '^[0-9a-f-]{36}$')::text || '/' || coalesce((select q.quote_kind from public.quotes q where q.id::text = v_out), '-') || '/'
    || coalesce((select q.installation_subtotal::text from public.quotes q where q.id::text = v_out), '-'));

  -- ---------- Web 以外の下書きの正式保存 ----------
  perform pg_temp.qpg_expect_error('QPG-34 下書きに 0 円の POR の商品の行が残っていれば、正式保存の前の確認で止める', 'P0001', 'VALIDATION: 別途見積（価格未確定）の明細が 1 行残っています（検査の別途見積の商品）',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_por_resolved(%L)::text || ''ok''', qd)));
  set local session_replication_role = replica;
  update public.quote_draft_items set remark = 'サービス' where id = d_line;
  set local session_replication_role = origin;
  perform pg_temp.qpg_expect_eq('QPG-35 理由の備考（サービス など）を書けば止めない', 'ok',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_por_resolved(%L)::text || ''ok''', qd)));
  perform pg_temp.qpg_expect_eq('QPG-36 正式保存の 2 つの関数は、既存の POR の確認の直後にこの確認を呼ぶ', 'true/true',
    (select (strpos(d, '価格未確定（POR）の明細が残っています') between 1 and strpos(d, 'perform public.assert_quote_draft_lines_por_resolved(d.id);'))::text
       from pg_catalog.pg_get_functiondef('public.finalize_quote_draft(uuid, integer)'::regprocedure) d) || '/' ||
    (select (strpos(d, '価格未確定（POR）の明細が残っています') between 1 and strpos(d, 'perform public.assert_quote_draft_lines_por_resolved(d.id);'))::text
       from pg_catalog.pg_get_functiondef('public.finalize_quote_revision_draft(uuid, integer)'::regprocedure) d));
  perform pg_temp.qpg_expect_eq('QPG-37 止めを足した 4 つの関数は、owner・SECURITY DEFINER・EXECUTE が従来どおり', 'postgres/true/true/false',
    (select string_agg(distinct pg_catalog.pg_get_userbyid(p.proowner), ',') from pg_catalog.pg_proc p where p.oid = any(v_sigs.oids)) || '/'
    || (select bool_and(p.prosecdef)::text from pg_catalog.pg_proc p where p.oid = any(v_sigs.oids)) || '/'
    || (select bool_and(has_function_privilege('authenticated', p.oid, 'execute'))::text from pg_catalog.pg_proc p where p.oid = any(v_sigs.oids)) || '/'
    || (select bool_or(has_function_privilege('anon', p.oid, 'execute'))::text from pg_catalog.pg_proc p where p.oid = any(v_sigs.oids)))
    from (select array[
      'public.finalize_quote_draft(uuid, integer)'::regprocedure::oid,
      'public.finalize_quote_revision_draft(uuid, integer)'::regprocedure::oid,
      'public.create_quote_revision(uuid, jsonb, text)'::regprocedure::oid,
      'public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)'::regprocedure::oid] as oids) v_sigs;
end;
$test$;

select coalesce(json_agg(json_build_object('ok', ok, 'step', step, 'expected', expected, 'actual', actual) order by seq), '[]'::json) as j
  from _qpg_result;

rollback;
