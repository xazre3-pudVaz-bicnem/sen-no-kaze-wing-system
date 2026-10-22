-- 正式見積の発行で金額未確定の明細を残さない止め（20261016111000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 商品マスターが空の DB で実行する（検査用のモデル・カテゴリー・商品だけで見積を作るため）。
-- 2026-10-22 の確定事項 A-2-1：明細の扱い（金額確定／金額未確定／契約対象外／0円確定）は明示の状態で区別し、自由記述の備考から推測しない。
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
  qr6 constant uuid := '7a600000-0000-4000-8000-000000000006';
  se_rev constant uuid := '7a650000-0000-4000-8000-000000000001';
  qd3 constant uuid := '7a800000-0000-4000-8000-000000000003';
  k3_std constant uuid := '7a930000-0000-4000-8000-000000000001';
  k3_exp constant uuid := '7a930000-0000-4000-8000-000000000002';
  k3_new constant uuid := '7a930000-0000-4000-8000-000000000003';
  k3_dup constant uuid := '7a930000-0000-4000-8000-000000000004';
  q1 constant uuid := '7a700000-0000-4000-8000-000000000001';
  q2 constant uuid := '7a700000-0000-4000-8000-000000000002';
  q3 constant uuid := '7a700000-0000-4000-8000-000000000003';
  q4 constant uuid := '7a700000-0000-4000-8000-000000000004';
  q5 constant uuid := '7a700000-0000-4000-8000-000000000005';
  qd constant uuid := '7a800000-0000-4000-8000-000000000001';
  qd2 constant uuid := '7a800000-0000-4000-8000-000000000002';
  i4_inst constant uuid := '7a900000-0000-4000-8000-000000000001';
  d_line constant uuid := '7a910000-0000-4000-8000-000000000001';
  d_new constant uuid := '7a910000-0000-4000-8000-000000000002';
  d2_same constant uuid := '7a910000-0000-4000-8000-000000000003';
  d2_other constant uuid := '7a910000-0000-4000-8000-000000000004';
  k_cure constant uuid := '7a920000-0000-4000-8000-000000000001';
  v_faces jsonb;
  v_keys text;
  v_out text;
  v_confirm text;
  v_new text;
  v_v3 text;
  v_rest jsonb;
  v_items_por_left text;
  v_items_free_text text;
  v_items_priced text;
  v_items_zero_confirmed text;
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
    (q1, 'RT-QPG-1', qr, cfg, u_cust, u_dealer, 'issued', now() + interval '30 days', 'お客様', 'POR 検査用モデル', 1000000, 10000, 80000, 1090000, 0.10, 109000, 1199000, 1, null),
    (q2, 'RT-QPG-2', qr2, cfg2, u_cust, u_dealer, 'issued', now() + interval '30 days', 'お客様', 'POR 検査用モデル', 1000000, 10000, 0, 1010000, 0.10, 101000, 1111000, 1, null),
    (q3, 'RT-QPG-3', qr3, cfg3, u_cust, u_dealer, 'accepted', now() + interval '30 days', 'お客様', 'POR 検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 1, null),
    (q4, 'RT-QPG-4', qr4, cfg4, u_cust, u_dealer, 'accepted', now() + interval '30 days', 'お客様', 'POR 検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 1, null);
  insert into public.quote_items (quote_id, kind, name, description, remark, unit_price, quantity, amount, sort_order)
  values (q1, 'base', '本体', null, null, 1000000, 1, 1000000, 1),
         (q1, 'option', '検査の別途見積の商品', '設置場所確認後に別途お見積り', null, 0, 1, 0, 1001),
         (q1, 'option', '検査の通常の商品（色：特注色）', 'POR 検査の商品', null, 10000, 1, 10000, 1002),
         (q1, 'installation', '養生', null, null, 0, 1, 0, 2001),
         (q1, 'installation', '電気設備工事', null, null, 80000, 1, 80000, 2002),
         (q2, 'base', '本体', null, null, 1000000, 1, 1000000, 1),
         (q2, 'option', '検査の通常の商品（色：白）', 'POR 検査の商品', null, 10000, 1, 10000, 1001),
         (q3, 'base', '本体', null, null, 1000000, 1, 1000000, 1),
         (q3, 'option', '検査の別途見積の商品', '設置場所確認後に別途お見積り', null, 0, 1, 0, 1001),
         (q4, 'base', '本体', null, null, 1000000, 1, 1000000, 1);
  insert into public.quote_items (id, quote_id, kind, name, description, remark, unit_price, quantity, amount, sort_order)
  values (i4_inst, q4, 'installation', '検査の別途見積の工事', '設置場所確認後に別途お見積り', null, 0, 1, 0, 1001);
  insert into public.quote_items (quote_id, line_key, kind, name, description, remark, unit_price, quantity, amount, sort_order)
  values (q2, k_cure, 'installation', '養生', null, null, 0, 1, 0, 2001);

  -- Web 以外の下書き（正式保存の前の確認だけを直接確かめる）。qd は初回、qd2 は q2 を前の版にした改訂の下書き
  insert into public.quote_requests (id, status, contact) values (qr5, 'new', '{}'::jsonb);
  insert into public.quote_drafts (id, quote_request_id, base_model_id, spec_code, quote_kind, tax_rate, lock_version, source_kind, finish_level)
  values (qd, qr5, m_model, 'base', 'formal', 0.10, 0, 'manual', 'full');
  insert into public.quote_drafts (id, quote_request_id, parent_quote_id, base_model_id, spec_code, quote_kind, tax_rate, lock_version, source_kind, finish_level)
  values (qd2, qr2, q2, m_model, 'base', 'formal', 0.10, 0, 'manual', 'full');
  insert into public.quote_draft_items (id, draft_id, line_key, kind, option_id, name, remark, unit_price, quantity, amount, sort_order, price_mode)
  values (d_line, qd, gen_random_uuid(), 'option', o_por, '検査の別途見積の商品', '別途見積', 0, 1, 0, 1, 'manual'),
         (d2_same, qd2, k_cure, 'installation', null, '養生', null, 0, 1, 0, 1, 'manual');
  set local session_replication_role = origin;

  -- ---------- 金額未確定の明細の決まり ----------
  perform pg_temp.qpg_expect_eq('QPG-1 明細の状態の印：対象外（メモ任意）・0円確定（理由が必要）。文中の印・理由のない書き出しは状態ではない',
    'excluded,excluded,zero_confirmed,-,-,-,-',
    concat_ws(',',
      coalesce(public.quote_line_explicit_state('［今回の契約対象外］'), '-'),
      coalesce(public.quote_line_explicit_state('［今回の契約対象外］お客様手配'), '-'),
      coalesce(public.quote_line_explicit_state('［0円確定］：電気設備工事に含む'), '-'),
      coalesce(public.quote_line_explicit_state('［0円確定］：'), '-'),
      coalesce(public.quote_line_explicit_state('［0円確定］：   '), '-'),
      coalesce(public.quote_line_explicit_state('前回は［今回の契約対象外］'), '-'),
      coalesce(public.quote_line_explicit_state(null), '-')));
  perform pg_temp.qpg_expect_eq('QPG-2 別途見積の目印がある 0 円の行は未確定（前の版から変えていなくても）。自由記述の備考では解消しない',
    'true,true,true,true,true,true,true,true,true,true',
    concat_ws(',',
      public.quote_line_unresolved('option', 0, null, '設置場所確認後に別途お見積り', null, false, false)::text,
      public.quote_line_unresolved('option', 0, null, '設置場所確認後に別途お見積り', null, false, true)::text,
      public.quote_line_unresolved('installation', 0, null, null, '別途見積', false, false)::text,
      public.quote_line_unresolved('installation', 0, null, null, ' 別途見積 ', false, false)::text,
      public.quote_line_unresolved('interior_exterior', 0, null, null, '価格未確定（別途お見積り）', false, false)::text,
      public.quote_line_unresolved('interior_exterior', 0, null, null, '別途見積項目あり・見積発行時点の面別外壁仕様', false, false)::text,
      public.quote_line_unresolved('option', 0, o_por, null, null, false, false)::text,
      public.quote_line_unresolved('option', 0, null, '設置場所確認後に別途お見積り', '電気設備工事に含む', false, false)::text,
      public.quote_line_unresolved('option', 0, o_por, null, 'サービス', false, false)::text,
      public.quote_line_unresolved('installation', 0, null, null, 'サービス', false, false)::text));
  perform pg_temp.qpg_expect_eq('QPG-3 明示の状態（対象外・0円確定）と金額の入った行は確定。理由のない 0円確定 の書き出しは未確定',
    'false,false,false,true,false,false',
    concat_ws(',',
      public.quote_line_unresolved('option', 0, null, '設置場所確認後に別途お見積り', '［今回の契約対象外］', false, false)::text,
      public.quote_line_unresolved('installation', 0, null, null, '［今回の契約対象外］お客様手配', false, false)::text,
      public.quote_line_unresolved('option', 0, o_por, null, '［0円確定］：電気設備工事に含む', false, false)::text,
      public.quote_line_unresolved('installation', 0, null, null, '［0円確定］：', false, false)::text,
      public.quote_line_unresolved('option', 5000, null, '設置場所確認後に別途お見積り', null, false, false)::text,
      public.quote_line_unresolved('interior_exterior', 1000, null, null, '別途見積項目あり・見積発行時点の面別外壁仕様', false, false)::text));
  perform pg_temp.qpg_expect_eq('QPG-4 0 円の内外装・オプション・別途工事・フリー商品：台帳の 0 円の商品・自動計算・前の版と同じ 0 円の明細だけはそのまま',
    'false,true,false,false,true,true,true',
    concat_ws(',',
      public.quote_line_unresolved('option', 0, o_ext, null, null, false, false)::text,
      public.quote_line_unresolved('option', 0, o_plain, null, null, false, false)::text,
      public.quote_line_unresolved('option', 0, null, null, null, true, false)::text,
      public.quote_line_unresolved('installation', 0, null, null, null, false, true)::text,
      public.quote_line_unresolved('installation', 0, null, null, null, false, false)::text,
      public.quote_line_unresolved('free', 0, null, null, null, false, false)::text,
      public.quote_line_unresolved('interior_exterior', 0, null, null, null, false, false)::text));
  perform pg_temp.qpg_expect_eq('QPG-5 本体・本体諸費用・内外装工事経費・オプション諸費用・値引きの行は対象外', 'false,false,false,false,false',
    concat_ws(',',
      public.quote_line_unresolved('base', 0, null, null, null, false, false)::text,
      public.quote_line_unresolved('base_expense', 0, null, null, null, false, false)::text,
      public.quote_line_unresolved('interior_exterior_expense', 0, null, null, null, false, false)::text,
      public.quote_line_unresolved('option_expense', 0, null, null, null, false, false)::text,
      public.quote_line_unresolved('discount', 0, null, null, null, false, false)::text));

  -- ---------- 明細の表の保存境界（トリガー） ----------
  perform pg_temp.qpg_expect_error('QPG-6 発行済みの明細の表：状態の印のある行に金額は入れられない', 'P0001', 'VALIDATION: 「対象外」「0円確定」の明細（検査の行）は 0 円にしてください',
    pg_temp.qpg_try(format($q$ insert into public.quote_items (quote_id, kind, name, remark, unit_price, quantity, amount, sort_order)
      values (%L, 'installation', '検査の行', '［今回の契約対象外］', 1000, 1, 1000, 9001) returning 'inserted' $q$, q2)));
  perform pg_temp.qpg_expect_error('QPG-7 下書きの明細の表：0円確定は理由が必要', 'P0001', 'VALIDATION: 0円確定の明細（検査の行）は理由を入力してください',
    pg_temp.qpg_try(format($q$ insert into public.quote_draft_items (draft_id, line_key, kind, name, remark, unit_price, quantity, amount, sort_order, price_mode)
      values (%L, gen_random_uuid(), 'installation', '検査の行', '［0円確定］：', 0, 1, 0, 9001, 'manual') returning 'inserted' $q$, qd)));
  perform pg_temp.qpg_expect_error('QPG-8 下書きの明細の表：状態の印のある行は「金額を入力」だけ（自動計算・POR にはできない）', 'P0001', 'VALIDATION: 「対象外」「0円確定」の明細（検査の行）は、価格の決め方を「金額を入力」にしてください',
    pg_temp.qpg_try(format($q$ insert into public.quote_draft_items (draft_id, line_key, kind, name, remark, unit_price, quantity, amount, sort_order, price_mode)
      values (%L, gen_random_uuid(), 'installation', '検査の行', '［今回の契約対象外］', 0, 1, 0, 9001, 'auto') returning 'inserted' $q$, qd)));
  perform pg_temp.qpg_expect_eq('QPG-9 2 つのトリガーが有効で、保存境界の部品も利用者からは実行できない', 'O,O/false',
    (select string_agg(t.tgenabled::text, ',' order by t.tgname) from pg_catalog.pg_trigger t
      where t.tgname in ('quote_items_line_state_guard', 'quote_draft_items_line_state_guard') and not t.tgisinternal) || '/'
    || (has_function_privilege('authenticated', 'public.quote_line_state_guard()', 'execute')
        or has_function_privilege('anon', 'public.quote_line_state_guard()', 'execute'))::text);

  -- ---------- お客様が選んだ POR の一覧 ----------
  perform pg_temp.qpg_expect_eq('QPG-10 お客様が選んだ POR：商品・選択肢・外壁の面（外壁の商品の明細は面として数える）',
    'product:' || o_por || '|検査の別途見積の商品|' || ';variant:' || o_plain || ':' || vc_por || '|検査の通常の商品|色：特注色'
      || ';face:front:' || o_ext || '|検査の外壁|外壁（正面）：塗装：特注塗装',
    (select string_agg((e ->> 'key') || '|' || (e ->> 'name') || '|' || coalesce(e ->> 'detail', ''), ';' order by ord)
       from jsonb_array_elements(public.configuration_por_selections(cfg)) with ordinality as x(e, ord)));
  perform pg_temp.qpg_expect_eq('QPG-11 POR を選んでいない構成・存在しない構成は空', '[]/[]',
    public.configuration_por_selections(cfg2)::text || '/' || public.configuration_por_selections(gen_random_uuid())::text);

  -- ---------- 権限 ----------
  perform pg_temp.qpg_expect_eq('QPG-12 内部の部品は anon・ログインした利用者・service_role から実行できない', 'false',
    (select bool_or(has_function_privilege(r, f, 'execute'))::text
       from unnest(array['anon', 'authenticated', 'service_role']) as r,
            unnest(array['public.quote_line_explicit_state(text)', 'public.quote_line_por_marked(uuid, text, text)',
                         'public.quote_line_unresolved(text, numeric, uuid, text, text, boolean, boolean)',
                         'public.configuration_por_selections(uuid)', 'public.quote_por_selections_confirmed(uuid, uuid, jsonb)',
                         'public.assert_quote_lines_resolved(uuid)', 'public.assert_quote_draft_lines_resolved(uuid)',
                         'public.assert_case_por_selections_confirmed(uuid, uuid)']) as f));
  perform pg_temp.qpg_expect_eq('QPG-13 一覧の取得・確認の RPC はログインした利用者だけ（anon・service_role は不可）', 'false/false/true',
    (has_function_privilege('anon', 'public.get_quote_por_selections(uuid)', 'execute') or has_function_privilege('anon', 'public.confirm_quote_por_selections(uuid, text[])', 'execute'))::text
    || '/' || (has_function_privilege('service_role', 'public.get_quote_por_selections(uuid)', 'execute') or has_function_privilege('service_role', 'public.confirm_quote_por_selections(uuid, text[])', 'execute'))::text
    || '/' || (has_function_privilege('authenticated', 'public.get_quote_por_selections(uuid)', 'execute') and has_function_privilege('authenticated', 'public.confirm_quote_por_selections(uuid, text[])', 'execute'))::text);
  perform pg_temp.qpg_expect_eq('QPG-14 確認の記録の表は RLS 有効で、利用者からは読み書きできない', 'true/false',
    (select c.relrowsecurity::text from pg_catalog.pg_class c where c.oid = 'public.quote_por_confirmations'::regclass) || '/'
    || (has_table_privilege('authenticated', 'public.quote_por_confirmations', 'select') or has_table_privilege('authenticated', 'public.quote_por_confirmations', 'insert')
        or has_table_privilege('anon', 'public.quote_por_confirmations', 'select'))::text);
  perform pg_temp.qpg_expect_error('QPG-15 担当外の代理店は一覧を取れない', '42501', 'FORBIDDEN',
    pg_temp.qpg_run_as('authenticated', u_dealer2, format('select public.get_quote_por_selections(%L)::text', q1)));
  perform pg_temp.qpg_expect_error('QPG-16 担当外の総代理店は一覧を取れない', '42501', 'FORBIDDEN',
    pg_temp.qpg_run_as('authenticated', u_master, format('select public.get_quote_por_selections(%L)::text', q1)));
  perform pg_temp.qpg_expect_error('QPG-17 お客様は一覧を取れない', '42501', 'FORBIDDEN',
    pg_temp.qpg_run_as('authenticated', u_cust, format('select public.get_quote_por_selections(%L)::text', q1)));
  perform pg_temp.qpg_expect_eq('QPG-18 担当の代理店・本部は一覧を取れる（まだ確認していない）', '3/false/3/false',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select jsonb_array_length(j -> 'selections') || '/' || (j ->> 'confirmed') from public.get_quote_por_selections(%L) j $q$, q1))
    || '/' || pg_temp.qpg_run_as('authenticated', u_admin, format($q$ select jsonb_array_length(j -> 'selections') || '/' || (j ->> 'confirmed') from public.get_quote_por_selections(%L) j $q$, q1)));

  -- ---------- 改訂（確定見積）：create_quote_revision ----------
  -- 前の版 q1：本体・別途見積の商品（0 円）・通常の商品・養生（0 円）・電気設備工事（80,000 円）
  v_rest := jsonb_build_array(
    jsonb_build_object('kind', 'option', 'name', '検査の通常の商品（色：特注色）', 'description', 'POR 検査の商品', 'unit_price', 12000, 'quantity', 1),
    jsonb_build_object('kind', 'installation', 'name', '養生', 'unit_price', 0, 'quantity', 1),
    jsonb_build_object('kind', 'installation', 'name', '電気設備工事', 'unit_price', 80000, 'quantity', 1));
  v_items_por_left := (jsonb_build_array(
    jsonb_build_object('kind', 'option', 'name', '検査の別途見積の商品', 'description', '設置場所確認後に別途お見積り', 'unit_price', 0, 'quantity', 1)) || v_rest)::text;
  v_items_free_text := (jsonb_build_array(
    jsonb_build_object('kind', 'option', 'name', '検査の別途見積の商品', 'description', '設置場所確認後に別途お見積り', 'remark', '電気設備工事に含む', 'unit_price', 0, 'quantity', 1)) || v_rest)::text;
  v_items_priced := (jsonb_build_array(
    jsonb_build_object('kind', 'option', 'name', '検査の別途見積の商品', 'description', '設置場所確認後に別途お見積り', 'unit_price', 50000, 'quantity', 1),
    jsonb_build_object('kind', 'installation', 'name', '外壁の特注塗装', 'unit_price', 30000, 'quantity', 1)) || v_rest)::text;
  v_items_zero_confirmed := (jsonb_build_array(
    jsonb_build_object('kind', 'option', 'name', '検査の別途見積の商品', 'description', '設置場所確認後に別途お見積り', 'remark', '［0円確定］：電気設備工事に含む', 'unit_price', 0, 'quantity', 1)) || v_rest)::text;

  perform pg_temp.qpg_expect_error('QPG-19 別途見積の行を 0 円のまま残した改訂は発行しない（前の版と同じでも）', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（検査の別途見積の商品）',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1, v_items_por_left)));
  perform pg_temp.qpg_expect_error('QPG-20 備考に理由を書いただけ（自由記述）では解消しない', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（検査の別途見積の商品）',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1, v_items_free_text)));
  perform pg_temp.qpg_expect_error('QPG-21 新しく足した 0 円の行は未確定', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（追加の運搬）',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1,
      (v_items_priced::jsonb || jsonb_build_array(jsonb_build_object('kind', 'installation', 'name', '追加の運搬', 'unit_price', 0, 'quantity', 1)))::text)));
  perform pg_temp.qpg_expect_error('QPG-22 前の版にある 0 円の明細（養生 1 行）と同じものをもう 1 行足すと、足した 1 行は未確定（同じ数まで）', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（養生）',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1,
      (v_items_priced::jsonb || jsonb_build_array(jsonb_build_object('kind', 'installation', 'name', '養生', 'unit_price', 0, 'quantity', 1)))::text)));
  perform pg_temp.qpg_expect_error('QPG-23 0 円に変えた明細は未確定（前の版では 80,000 円）', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（電気設備工事）',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1,
      jsonb_build_array(
        jsonb_build_object('kind', 'option', 'name', '検査の別途見積の商品', 'description', '設置場所確認後に別途お見積り', 'unit_price', 50000, 'quantity', 1),
        jsonb_build_object('kind', 'option', 'name', '検査の通常の商品（色：特注色）', 'description', 'POR 検査の商品', 'unit_price', 12000, 'quantity', 1),
        jsonb_build_object('kind', 'installation', 'name', '養生', 'unit_price', 0, 'quantity', 1),
        jsonb_build_object('kind', 'installation', 'name', '電気設備工事', 'unit_price', 0, 'quantity', 1))::text)));
  perform pg_temp.qpg_expect_error('QPG-24 状態の印のある行に金額を入れて送っても保存しない（RPC を直接呼んでも同じ）', 'P0001', 'VALIDATION: 「対象外」「0円確定」の明細（検査の別途見積の商品）は 0 円にしてください',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1,
      (jsonb_build_array(jsonb_build_object('kind', 'option', 'name', '検査の別途見積の商品', 'remark', '［今回の契約対象外］', 'unit_price', 5000, 'quantity', 1)) || v_rest)::text)));
  perform pg_temp.qpg_expect_error('QPG-25 金額を入れても、お客様が選んだ POR を担当者が確認していなければ発行しない', 'P0001', 'VALIDATION: お客様が選んだ別途見積の商品（3 件',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1, v_items_priced)));
  perform pg_temp.qpg_expect_eq('QPG-26 止めた改訂では版が増えず、元の版は発行中のまま', '1/issued',
    (select count(*)::text from public.quotes where quote_request_id = qr) || '/' || (select status from public.quotes where id = q1));

  select string_agg(e ->> 'key', ',') into v_keys from jsonb_array_elements(public.configuration_por_selections(cfg)) e;
  perform pg_temp.qpg_expect_error('QPG-27 担当外の代理店は確認を記録できない', '42501', 'FORBIDDEN',
    pg_temp.qpg_run_as('authenticated', u_dealer2, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', q1, v_keys)));
  perform pg_temp.qpg_expect_error('QPG-28 画面に出した一覧と今の一覧が違えば、確認を記録しない', 'P0001', 'LOCKED',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, array[%L])::text', q1, 'product:' || o_por)));
  perform pg_temp.qpg_expect_error('QPG-29 POR を選んでいない案件では確認はない', 'P0001', 'VALIDATION',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, array[]::text[])::text', q2)));

  -- 本部の確認は、発行する担当代理店の確認の代わりにならない
  v_out := pg_temp.qpg_run_as('authenticated', u_admin, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', q1, v_keys));
  perform pg_temp.qpg_expect_eq('QPG-30 本部は確認を記録できる', 'true', (v_out ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.qpg_expect_error('QPG-31 発行する担当者自身の確認がなければ、本部の確認があっても発行しない', 'P0001', 'VALIDATION: お客様が選んだ別途見積の商品',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1, v_items_priced)));

  v_confirm := pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', q1, v_keys));
  v_out := pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', q1, v_keys));
  perform pg_temp.qpg_expect_eq('QPG-32 担当代理店の確認を記録し、同じ一覧の確認は二重に残さない', 'true/true/1',
    (v_confirm ~ '^[0-9a-f-]{36}$')::text || '/' || (v_out = v_confirm)::text || '/'
    || (select count(*)::text from public.quote_por_confirmations c where c.quote_id = q1 and c.confirmed_by = u_dealer));
  perform pg_temp.qpg_expect_eq('QPG-33 確認の後は、一覧の取得でも確認済みと分かる', 'true',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select j ->> 'confirmed' from public.get_quote_por_selections(%L) j $q$, q1)));
  perform pg_temp.qpg_expect_error('QPG-34 確認の後でも、別途見積の行を 0 円のまま残せば発行しない', 'P0001', 'VALIDATION: 金額が未確定の明細',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1, v_items_por_left)));

  perform pg_temp.qpg_expect_error('QPG-35 確認済みでも、同じ 0 円の明細（養生）をもう 1 行足した改訂は発行しない', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（養生）',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1,
      (v_items_zero_confirmed::jsonb || jsonb_build_array(jsonb_build_object('kind', 'installation', 'name', '養生', 'unit_price', 0, 'quantity', 1)))::text)));
  perform pg_temp.qpg_expect_eq('QPG-36 止めた改訂では版が増えない', '1/issued',
    (select count(*)::text from public.quotes where quote_request_id = qr) || '/' || (select status from public.quotes where id = q1));

  v_new := pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', q1,
    (v_items_zero_confirmed::jsonb || jsonb_build_array(jsonb_build_object('kind', 'installation', 'name', '養生', 'remark', '［今回の契約対象外］', 'unit_price', 0, 'quantity', 1)))::text));
  perform pg_temp.qpg_expect_eq('QPG-37 確認済みで、別途見積の行を「0円確定（理由）」にすれば 0 円のまま発行できる（前の版と同じ 0 円の養生はそのまま。同じ品名の対象外の行は数に入れない）', 'true', (v_new ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.qpg_expect_eq('QPG-38 発行した改訂が案件の現在の見積になり、元の版は置き換わる。0円確定の印は明細に残る', '2/superseded/issued/' || v_new || '/［0円確定］：電気設備工事に含む',
    (select count(*)::text from public.quotes where quote_request_id = qr) || '/' || (select status from public.quotes where id = q1) || '/'
    || coalesce((select status from public.quotes where id::text = v_new), '-') || '/' || (select quote_id::text from public.quote_requests where id = qr) || '/'
    || coalesce((select i.remark from public.quote_items i where i.quote_id::text = v_new and i.name = '検査の別途見積の商品'), '-'));
  perform pg_temp.qpg_expect_eq('QPG-39 新しい版では、もう一度確認が要る（確認は版ごと）', 'false',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select j ->> 'confirmed' from public.get_quote_por_selections(%L) j $q$, v_new)));
  perform pg_temp.qpg_expect_error('QPG-40 置き換わった版には確認を記録できない', 'P0001', 'LOCKED',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', q1, v_keys)));
  perform pg_temp.qpg_expect_error('QPG-41 確認の記録は DB の管理者でも書き換えられない', 'P0001', 'IMMUTABLE',
    pg_temp.qpg_try(format('update public.quote_por_confirmations set confirmed_at = now() where quote_id = %L returning ''updated''', q1)));
  perform pg_temp.qpg_expect_error('QPG-42 確認の記録は DB の管理者でも削除できない', 'P0001', 'IMMUTABLE',
    pg_temp.qpg_try(format('delete from public.quote_por_confirmations where quote_id = %L returning ''deleted''', q1)));

  -- 対象外の明細があっても、確定した範囲の正式見積は止めない
  perform pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', v_new, v_keys));
  v_v3 := pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', v_new,
    (jsonb_build_array(
       jsonb_build_object('kind', 'option', 'name', '検査の別途見積の商品', 'description', '設置場所確認後に別途お見積り', 'remark', '［今回の契約対象外］お客様手配', 'unit_price', 0, 'quantity', 1),
       jsonb_build_object('kind', 'installation', 'name', '給排水工事', 'remark', '［今回の契約対象外］', 'unit_price', 0, 'quantity', 1)) || v_rest)::text));
  perform pg_temp.qpg_expect_eq('QPG-43 「対象外」の明細があるだけでは止めない（確定した範囲で発行できる）', 'true/3', (v_v3 ~ '^[0-9a-f-]{36}$')::text || '/'
    || coalesce((select q.revision::text from public.quotes q where q.id::text = v_v3), '-'));
  perform pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, string_to_array(%L, '',''))::text', v_v3, v_keys));
  perform pg_temp.qpg_expect_error('QPG-44 前の版で対象外だった明細を、印を外して 0 円のまま含めると未確定', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（給排水工事）',
    pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.create_quote_revision(%L, %L::jsonb, null)::text', v_v3,
      (jsonb_build_array(
         jsonb_build_object('kind', 'option', 'name', '検査の別途見積の商品', 'description', '設置場所確認後に別途お見積り', 'remark', '［今回の契約対象外］お客様手配', 'unit_price', 0, 'quantity', 1),
         jsonb_build_object('kind', 'installation', 'name', '給排水工事', 'unit_price', 0, 'quantity', 1)) || v_rest)::text)));

  v_out := pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select public.create_quote_revision(%L, '[{"kind":"installation","name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, null)::text $q$, q2));
  perform pg_temp.qpg_expect_eq('QPG-45 POR を選んでいない案件は、確認なしで従来どおり改訂できる', 'true', (v_out ~ '^[0-9a-f-]{36}$')::text);

  -- ---------- 承諾済みの概算からの確定見積（旧形式の互換） ----------
  v_out := pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, array[%L])::text', q3, 'product:' || o_por));
  perform pg_temp.qpg_expect_eq('QPG-46 承諾済みの概算にも確認を記録できる', 'true', (v_out ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.qpg_expect_error('QPG-47 施工以外の別途見積の行（この画面では直せない）が残る概算からは確定見積を作らない', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[]'::jsonb, null)::text $q$, q3)));
  perform pg_temp.qpg_expect_error('QPG-48 施工の別途見積の行を 0 円・状態なしで残せば確定見積を作らない（備考の自由記述でも同じ）', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, %L::jsonb, null)::text $q$, q4,
      jsonb_build_array(jsonb_build_object('source_item_id', i4_inst, 'name', '検査の別途見積の工事', 'remark', '基礎工事に含む', 'unit_price', 0, 'quantity', 1)))));
  perform pg_temp.qpg_expect_error('QPG-49 施工の金額を入れても、担当者の確認がなければ確定見積を作らない', 'P0001', 'VALIDATION: お客様が選んだ別途見積の商品（1 件',
    pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, %L::jsonb, null)::text $q$, q4,
      jsonb_build_array(jsonb_build_object('source_item_id', i4_inst, 'name', '検査の別途見積の工事', 'unit_price', 80000, 'quantity', 1)))));
  perform pg_temp.qpg_run_as('authenticated', u_dealer, format('select public.confirm_quote_por_selections(%L, array[%L])::text', q4, 'product:' || o_inst));
  v_out := pg_temp.qpg_run_as('authenticated', u_dealer, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, %L::jsonb, null)::text $q$, q4,
    jsonb_build_array(
      jsonb_build_object('source_item_id', i4_inst, 'name', '検査の別途見積の工事', 'unit_price', 80000, 'quantity', 1),
      jsonb_build_object('name', '外構工事', 'remark', '［今回の契約対象外］', 'unit_price', 0, 'quantity', 1))));
  perform pg_temp.qpg_expect_eq('QPG-50 確認済みで施工の金額を入れれば、対象外の施工があっても確定見積を作れる', 'true/formal/80000',
    (v_out ~ '^[0-9a-f-]{36}$')::text || '/' || coalesce((select q.quote_kind from public.quotes q where q.id::text = v_out), '-') || '/'
    || coalesce((select q.installation_subtotal::text from public.quotes q where q.id::text = v_out), '-'));

  -- ---------- Web 以外の下書きの正式保存 ----------
  perform pg_temp.qpg_expect_error('QPG-51 下書きに 0 円の別途見積の商品の行が残っていれば、正式保存の前の確認で止める', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（検査の別途見積の商品）',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_resolved(%L)::text || ''ok''', qd)));
  update public.quote_draft_items set remark = 'サービス' where id = d_line;
  perform pg_temp.qpg_expect_error('QPG-52 備考の自由記述（サービス など）では止めを解かない', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_resolved(%L)::text || ''ok''', qd)));
  update public.quote_draft_items set remark = '［0円確定］：サービス' where id = d_line;
  perform pg_temp.qpg_expect_eq('QPG-53 「0円確定（理由）」にすれば止めない', 'ok',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_resolved(%L)::text || ''ok''', qd)));
  perform pg_temp.qpg_expect_error('QPG-54 0円確定の行に金額を入れる更新は保存しない（表の保存境界）', 'P0001', 'VALIDATION: 「対象外」「0円確定」の明細',
    pg_temp.qpg_try(format('update public.quote_draft_items set unit_price = 1000, amount = 1000 where id = %L returning ''updated''', d_line)));
  insert into public.quote_draft_items (id, draft_id, line_key, kind, name, remark, unit_price, quantity, amount, sort_order, price_mode)
  values (d_new, qd, gen_random_uuid(), 'installation', '追加の運搬', null, 0, 1, 0, 2, 'manual');
  perform pg_temp.qpg_expect_error('QPG-55 初回の下書きに足した 0 円の直接入力の行は未確定', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（追加の運搬）',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_resolved(%L)::text || ''ok''', qd)));
  update public.quote_draft_items set remark = '［今回の契約対象外］' where id = d_new;
  insert into public.quote_draft_items (draft_id, line_key, kind, option_id, name, remark, unit_price, quantity, amount, sort_order, price_mode)
  values (qd, gen_random_uuid(), 'option', o_ext, '検査の外壁', null, 0, 1, 0, 3, 'manual');
  perform pg_temp.qpg_expect_eq('QPG-56 対象外の行・台帳の 0 円の商品は止めない（経費の行は標準見積の下書きの検査で確かめる）', 'ok',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_resolved(%L)::text || ''ok''', qd)));
  perform pg_temp.qpg_expect_eq('QPG-57 改訂の下書き：前の版の同じ明細（明細のキー・区分・品名・説明が同じ 0 円）はそのまま', 'ok',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_resolved(%L)::text || ''ok''', qd2)));
  insert into public.quote_draft_items (id, draft_id, line_key, kind, name, remark, unit_price, quantity, amount, sort_order, price_mode)
  values (d2_other, qd2, gen_random_uuid(), 'installation', '養生', null, 0, 1, 0, 2, 'manual');
  perform pg_temp.qpg_expect_error('QPG-58 改訂の下書き：品名が同じでも明細のキーが違う 0 円の行は未確定', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（養生）',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_resolved(%L)::text || ''ok''', qd2)));
  set local session_replication_role = replica;
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, base_model_name, base_price, option_subtotal, installation_subtotal,
                             subtotal, tax_rate, tax, total, revision, parent_quote_id)
  values (q5, 'RT-QPG-5', qr2, cfg2, u_cust, u_dealer, 'issued', now() + interval '30 days', 'お客様', 'POR 検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 9, q2);
  insert into public.quote_items (quote_id, kind, name, description, remark, unit_price, quantity, amount, sort_order)
  values (q5, 'installation', '養生', null, null, 0, 1, 0, 1),
         (q5, 'installation', '養生', null, null, 0, 1, 0, 2),
         (q5, 'installation', '養生', null, '［今回の契約対象外］', 0, 1, 0, 3);
  set local session_replication_role = origin;
  perform pg_temp.qpg_expect_error('QPG-59 発行する版の判定：前の版に 1 行の 0 円の明細が、新しい版に 2 行あれば 1 行は未確定（対象外の行は数えない）', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（養生）',
    pg_temp.qpg_try(format('select public.assert_quote_lines_resolved(%L)::text || ''ok''', q5)));
  set local session_replication_role = replica;
  insert into public.quote_items (quote_id, kind, name, description, remark, unit_price, quantity, amount, sort_order)
  values (q2, 'installation', '養生', null, null, 0, 1, 0, 2002);
  set local session_replication_role = origin;
  perform pg_temp.qpg_expect_eq('QPG-60 前の版にも同じ 0 円の明細が 2 行あれば、2 行ともそのまま', 'ok',
    pg_temp.qpg_try(format('select public.assert_quote_lines_resolved(%L)::text || ''ok''', q5)));
  -- 標準見積から作った初回の下書き（元の標準見積の版の 0 円の行と比べる。自動計算として外すのは経費の行だけ）
  set local session_replication_role = replica;
  insert into public.quote_requests (id, status, contact) values (qr6, 'new', '{}'::jsonb);
  insert into public.standard_estimate_revision_lines (revision_id, line_key, section_code, name, quantity, unit, price_mode, cost_unit_price, cost_amount, unit_price, amount, sort_order)
  values (se_rev, gen_random_uuid(), 'sitework', '標準の0円の工事', 1, '式', 'auto', 0, 0, 0, 0, 1);
  insert into public.quote_drafts (id, quote_request_id, base_model_id, spec_code, quote_kind, tax_rate, lock_version, source_kind, standard_estimate_revision_id, finish_level)
  values (qd3, qr6, m_model, 'base', 'formal', 0.10, 0, 'standard_estimate', se_rev, 'full');
  insert into public.quote_draft_items (draft_id, line_key, kind, name, remark, unit_price, quantity, amount, sort_order, price_mode)
  values (qd3, k3_std, 'installation', '標準の0円の工事', null, 0, 1, 0, 1, 'auto'),
         (qd3, k3_exp, 'installation', '別途工事経費', null, 0, 1, 0, 2, 'auto');
  insert into public.quote_draft_item_costs (draft_id, line_key, section_code, line_role, base_unit_cost, cost_unit_price, cost_amount)
  values (qd3, k3_std, 'sitework', 'line', null, 0, 0),
         (qd3, k3_exp, 'sitework', 'expense', null, 450, 450);
  set local session_replication_role = origin;
  perform pg_temp.qpg_expect_eq('QPG-61 標準見積から作った初回の下書き：元の標準見積の版の 0 円の行と、作り直す経費の行は止めない', 'ok',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_resolved(%L)::text || ''ok''', qd3)));
  set local session_replication_role = replica;
  insert into public.quote_draft_items (draft_id, line_key, kind, name, remark, unit_price, quantity, amount, sort_order, price_mode)
  values (qd3, k3_new, 'installation', '追加の運搬', null, 0, 1, 0, 3, 'auto');
  insert into public.quote_draft_item_costs (draft_id, line_key, section_code, line_role, base_unit_cost, cost_unit_price, cost_amount)
  values (qd3, k3_new, 'sitework', 'line', null, 0, 0);
  set local session_replication_role = origin;
  perform pg_temp.qpg_expect_error('QPG-62 自動計算でも、新しく足した原価 0 円（売価 0 円）の行は未確定', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（追加の運搬）',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_resolved(%L)::text || ''ok''', qd3)));
  set local session_replication_role = replica;
  delete from public.quote_draft_item_costs where draft_id = qd3 and line_key = k3_new;
  delete from public.quote_draft_items where draft_id = qd3 and line_key = k3_new;
  insert into public.quote_draft_items (draft_id, line_key, kind, name, remark, unit_price, quantity, amount, sort_order, price_mode)
  values (qd3, k3_dup, 'installation', '標準の0円の工事', null, 0, 1, 0, 4, 'auto');
  insert into public.quote_draft_item_costs (draft_id, line_key, section_code, line_role, base_unit_cost, cost_unit_price, cost_amount)
  values (qd3, k3_dup, 'sitework', 'line', null, 0, 0);
  set local session_replication_role = origin;
  perform pg_temp.qpg_expect_error('QPG-63 元の標準見積の版の 0 円の行と同じ行は、版の行の数まで（もう 1 行は未確定）', 'P0001', 'VALIDATION: 金額が未確定の明細が 1 行残っています（標準の0円の工事）',
    pg_temp.qpg_try(format('select public.assert_quote_draft_lines_resolved(%L)::text || ''ok''', qd3)));
  perform pg_temp.qpg_expect_eq('QPG-64 正式保存の 2 つの関数は、既存の POR の確認の直後にこの確認を呼ぶ', 'true/true',
    (select (strpos(d, '価格未確定（POR）の明細が残っています') between 1 and strpos(d, 'perform public.assert_quote_draft_lines_resolved(d.id);'))::text
       from pg_catalog.pg_get_functiondef('public.finalize_quote_draft(uuid, integer)'::regprocedure) d) || '/' ||
    (select (strpos(d, '価格未確定（POR）の明細が残っています') between 1 and strpos(d, 'perform public.assert_quote_draft_lines_resolved(d.id);'))::text
       from pg_catalog.pg_get_functiondef('public.finalize_quote_revision_draft(uuid, integer)'::regprocedure) d));
  perform pg_temp.qpg_expect_eq('QPG-65 止めを足した 4 つの関数は、owner・SECURITY DEFINER・EXECUTE が従来どおり', 'postgres/true/true/false',
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
