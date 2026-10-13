-- 権限境界の実行時検査（使い捨て DB 専用）。
--
-- 試験用の利用者・案件を作り、API と同じロール（anon / authenticated ＋ JWT の sub）へ切り替えて
-- 「見えてよいものだけが見えるか」「実行できてはいけない関数が拒否されるか」を確かめる。
-- 全体を 1 トランザクションで実行し、最後に必ず rollback する。
--
-- ★ 本番では実行しないこと（rollback するが、auth.users への投入を伴う）。
--    リハーサル（npm run db:rehearse -- --runtime）と CI のローカル Supabase DB で使う。

begin;

create temp table _result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _result to public;

-- role と JWT の sub を切り替えて SQL を 1 つ実行し、結果（1 行 1 列の文字列）かエラー内容を返す
create function pg_temp.run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

-- 「拒否されること」の確認。p_code は期待する SQLSTATE（42501 = 権限なし）
create function pg_temp.expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

-- 「書けない・読めない」の確認。権限エラー（42501）でも、RLS で 0 行になる場合でもよい
create function pg_temp.expect_blocked(p_step text, p_actual text) returns void
language sql as $fn$
  insert into _result (step, expected, actual, ok)
  values (p_step, '拒否（42501）または 0 行', p_actual, p_actual like 'ERROR 42501:%' or p_actual in ('(null)', '0'));
$fn$;

do $test$
declare
  u_admin  constant uuid := '00000000-0000-4000-8000-00000000a001';
  u_master constant uuid := '00000000-0000-4000-8000-00000000a002';
  u_dealer1 constant uuid := '00000000-0000-4000-8000-00000000a003';
  u_dealer2 constant uuid := '00000000-0000-4000-8000-00000000a004';
  u_cust_x constant uuid := '00000000-0000-4000-8000-00000000a005';
  u_cust_y constant uuid := '00000000-0000-4000-8000-00000000a006';
  c_x constant uuid := '00000000-0000-4000-8000-00000000c00a';
  c_y constant uuid := '00000000-0000-4000-8000-00000000c00b';
  r_x constant uuid := '00000000-0000-4000-8000-00000000e00a';
  r_y constant uuid := '00000000-0000-4000-8000-00000000e00b';
  q_x constant uuid := '00000000-0000-4000-8000-00000000f00a';
  q_y constant uuid := '00000000-0000-4000-8000-00000000f00b';
  -- respond_to_quote の検査用（顧客Xの確定見積と、同じ依頼の旧版）
  c_f constant uuid := '00000000-0000-4000-8000-00000000c00c';
  r_f constant uuid := '00000000-0000-4000-8000-00000000e00c';
  q_f constant uuid := '00000000-0000-4000-8000-00000000f00c';
  q_x_old constant uuid := '00000000-0000-4000-8000-00000000f00d';
  q_y2 constant uuid := '00000000-0000-4000-8000-00000000f00e';
  -- 担当未割当の見積と、旧形式で承諾済みの見積（第2版＝確定見積／第1版＝概算）
  c_u constant uuid := '00000000-0000-4000-8000-00000000c0aa';
  r_u constant uuid := '00000000-0000-4000-8000-00000000e0aa';
  q_u constant uuid := '00000000-0000-4000-8000-00000000f0aa';
  c_l2 constant uuid := '00000000-0000-4000-8000-00000000c0bb';
  r_l2 constant uuid := '00000000-0000-4000-8000-00000000e0bb';
  q_l1 constant uuid := '00000000-0000-4000-8000-00000000f0b1';
  q_l2 constant uuid := '00000000-0000-4000-8000-00000000f0b2';
  q_l3 constant uuid := '00000000-0000-4000-8000-00000000f0b3';
  c_l1 constant uuid := '00000000-0000-4000-8000-00000000c0cc';
  r_l1 constant uuid := '00000000-0000-4000-8000-00000000e0cc';
  q_lp constant uuid := '00000000-0000-4000-8000-00000000f0c1';
  v_model uuid;
  v_notifications_before bigint;
  v_audit_before bigint;
  v_quotes_before bigint;
  -- 本体マスターの identity（組織 × 機種・用途・サイズ × 防火）の検査用
  o_hq constant uuid := '00000000-0000-4000-8000-000000000d01';
  m_other constant uuid := '00000000-0000-4000-8000-00000000b002';
  mr_nofire constant uuid := '00000000-0000-4000-8000-000000000e01';
  mr_fire constant uuid := '00000000-0000-4000-8000-000000000e02';
  v_bmr_text text;
  v_se_text text;
  v_se_next_text text;
  -- 標準見積から作成した見積（PR H）の検査用
  o_dealer constant uuid := '00000000-0000-4000-8000-000000000d02';
  r_old constant uuid := '00000000-0000-4000-8000-00000000e0dd';
  q_old constant uuid := '00000000-0000-4000-8000-00000000f0dd';
  v_tmp text;
  v_sq_text text;
  v_sq_base_key text;
  v_sq_quote_text text;
  v_sq_rev2_text text;
  v_old_rev2_text text;
  v_manual_text text;
begin
  ---------------------------------------------------------------------------
  -- 試験データ（トリガーと外部キー検査を止めて、必要な行だけを直接入れる）
  ---------------------------------------------------------------------------
  set local session_replication_role = replica;

  insert into public.base_models (id, slug, name, base_price, status)
  values ('00000000-0000-4000-8000-00000000b001', 'runtime-check', '権限検査用モデル', 1000000, 'published')
  on conflict (slug) do nothing;
  select id into v_model from public.base_models where slug = 'runtime-check';

  insert into auth.users (id, email, raw_user_meta_data)
  select id, email, '{}'::jsonb
    from (values
      (u_admin, 'admin@runtime.invalid'), (u_master, 'master@runtime.invalid'),
      (u_dealer1, 'dealer1@runtime.invalid'), (u_dealer2, 'dealer2@runtime.invalid'),
      (u_cust_x, 'x@runtime.invalid'), (u_cust_y, 'y@runtime.invalid')
    ) as v(id, email);

  insert into public.profiles (id, email, full_name, role_code)
  values
    (u_admin, 'admin@runtime.invalid', '本部', 'admin'),
    (u_master, 'master@runtime.invalid', '総代理店', 'master_dealer'),
    (u_dealer1, 'dealer1@runtime.invalid', '代理店1', 'dealer'),
    (u_dealer2, 'dealer2@runtime.invalid', '代理店2', 'dealer'),
    (u_cust_x, 'x@runtime.invalid', '顧客X', 'customer'),
    (u_cust_y, 'y@runtime.invalid', '顧客Y', 'customer');

  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (c_x, u_cust_x, v_model, '顧客Xの案件', 'quote_requested', 'office', 'full'),
         (c_y, u_cust_y, v_model, '顧客Yの案件', 'quote_requested', 'office', 'full');

  insert into public.quote_requests (id, configuration_id, user_id, quote_id, status)
  values (r_x, c_x, u_cust_x, q_x, 'sent'), (r_y, c_y, u_cust_y, q_y, 'sent');

  -- 顧客Xの見積は代理店1、顧客Yの見積は総代理店が担当
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, base_model_name, base_price, option_subtotal, installation_subtotal,
                             subtotal, tax_rate, tax, total)
  values
    (q_x, 'RT-0001', r_x, c_x, u_cust_x, u_dealer1, 'issued', now() + interval '30 days', '顧客X', '権限検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000),
    (q_y, 'RT-0002', r_y, c_y, u_cust_y, u_master,  'issued', now() + interval '30 days', '顧客Y', '権限検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000);

  set local session_replication_role = origin;

  ---------------------------------------------------------------------------
  -- 1. 案件の閲覧境界（RLS）
  ---------------------------------------------------------------------------
  perform pg_temp.expect_eq('1-1 未ログインは見積を読めない', '0',
    pg_temp.run_as('anon', null, $q$ select count(*)::text from public.quotes $q$));
  perform pg_temp.expect_eq('1-2 未ログインは保存済みプランを読めない', '0',
    pg_temp.run_as('anon', null, $q$ select count(*)::text from public.configurations $q$));
  perform pg_temp.expect_eq('1-3 未ログインは会員情報を読めない', '0',
    pg_temp.run_as('anon', null, $q$ select count(*)::text from public.profiles $q$));

  perform pg_temp.expect_eq('1-4 顧客Xは自分の見積だけ', 'RT-0001',
    pg_temp.run_as('authenticated', u_cust_x, $q$ select coalesce(string_agg(quote_no, ',' order by quote_no), '') from public.quotes $q$));
  perform pg_temp.expect_eq('1-5 顧客Yは自分の見積だけ', 'RT-0002',
    pg_temp.run_as('authenticated', u_cust_y, $q$ select coalesce(string_agg(quote_no, ',' order by quote_no), '') from public.quotes $q$));
  perform pg_temp.expect_eq('1-6 顧客Xは他人のプランを読めない', '顧客Xの案件',
    pg_temp.run_as('authenticated', u_cust_x, $q$ select coalesce(string_agg(name, ',' order by name), '') from public.configurations where name like '顧客%の案件' $q$));
  perform pg_temp.expect_eq('1-7 顧客Xは他人の会員情報を読めない', '1',
    pg_temp.run_as('authenticated', u_cust_x, $q$ select count(*)::text from public.profiles $q$));

  perform pg_temp.expect_eq('1-8 代理店1は担当案件だけ', 'RT-0001',
    pg_temp.run_as('authenticated', u_dealer1, $q$ select coalesce(string_agg(quote_no, ',' order by quote_no), '') from public.quotes $q$));
  perform pg_temp.expect_eq('1-9 代理店2（担当なし）は 0 件', '',
    pg_temp.run_as('authenticated', u_dealer2, $q$ select coalesce(string_agg(quote_no, ',' order by quote_no), '') from public.quotes $q$));
  perform pg_temp.expect_eq('1-10 総代理店は担当案件だけ（担当外は読めない）', 'RT-0002',
    pg_temp.run_as('authenticated', u_master, $q$ select coalesce(string_agg(quote_no, ',' order by quote_no), '') from public.quotes $q$));
  perform pg_temp.expect_eq('1-11 本部は全案件', 'RT-0001,RT-0002',
    pg_temp.run_as('authenticated', u_admin, $q$ select coalesce(string_agg(quote_no, ',' order by quote_no), '') from public.quotes where quote_no like 'RT-%' $q$));

  ---------------------------------------------------------------------------
  -- 2. 直接書き込みの拒否
  ---------------------------------------------------------------------------
  perform pg_temp.expect_blocked('2-1 未ログインは保存済みプランを直接更新できない',
    pg_temp.run_as('anon', null, format($q$ update public.configurations set name = 'x' where id = %L returning 'updated' $q$, c_x)));
  perform pg_temp.expect_denied('2-2 顧客は保存済みプランを直接更新できない（保存は RPC のみ）', '42501',
    pg_temp.run_as('authenticated', u_cust_x, format($q$ update public.configurations set name = 'x' where id = %L returning 'updated' $q$, c_x)));
  perform pg_temp.expect_blocked('2-3 顧客は見積金額を直接変更できない',
    pg_temp.run_as('authenticated', u_cust_x, format($q$ update public.quotes set total = 1 where id = %L returning 'updated' $q$, q_x)));
  perform pg_temp.expect_blocked('2-4 代理店は担当外の見積を更新できない',
    pg_temp.run_as('authenticated', u_dealer2, format($q$ update public.quotes set total = 1 where id = %L returning 'updated' $q$, q_x)));
  perform pg_temp.expect_blocked('2-5 代理店は担当の見積でも金額を直接変更できない（改訂は RPC のみ）',
    pg_temp.run_as('authenticated', u_dealer1, format($q$ update public.quotes set total = 1 where id = %L returning 'updated' $q$, q_x)));
  perform pg_temp.expect_blocked('2-6 ログイン利用者は見積下書きテーブルを直接読めない',
    pg_temp.run_as('authenticated', u_dealer1, $q$ select count(*)::text from public.quote_drafts $q$));
  perform pg_temp.expect_eq('2-7 直接更新を試みても見積金額は変わっていない', '1100000',
    (select total::text from public.quotes where id = q_x));

  ---------------------------------------------------------------------------
  -- 3. API から実行させない関数（EXECUTE）
  ---------------------------------------------------------------------------
  perform pg_temp.expect_denied('3-1 未ログインは notify を実行できない', '42501',
    pg_temp.run_as('anon', null, format($q$ select public.notify(%L, null, 'x', 't', 'b', 'https://example.invalid')::text $q$, u_admin)));
  perform pg_temp.expect_denied('3-2 ログイン利用者も notify を実行できない', '42501',
    pg_temp.run_as('authenticated', u_cust_x, format($q$ select public.notify(%L, null, 'x', 't', 'b', null)::text $q$, u_admin)));
  perform pg_temp.expect_denied('3-3 未ログインは write_audit を実行できない', '42501',
    pg_temp.run_as('anon', null, $q$ select public.write_audit('x', 'x', null, 'x', null, null)::text $q$));
  perform pg_temp.expect_denied('3-4 ログイン利用者も write_audit を実行できない', '42501',
    pg_temp.run_as('authenticated', u_cust_x, $q$ select public.write_audit('x', 'x', null, 'x', null, null)::text $q$));
  perform pg_temp.expect_denied('3-5 未ログインは duplicate_configuration を実行できない', '42501',
    pg_temp.run_as('anon', null, format($q$ select (public.duplicate_configuration(%L)).id::text $q$, c_x)));
  perform pg_temp.expect_denied('3-6 未ログインは configuration_pricing_json を実行できない', '42501',
    pg_temp.run_as('anon', null, format($q$ select public.configuration_pricing_json(%L)::text $q$, c_x)));
  perform pg_temp.expect_denied('3-7 ログイン利用者も configuration_pricing_json を直接実行できない', '42501',
    pg_temp.run_as('authenticated', u_cust_y, format($q$ select public.configuration_pricing_json(%L)::text $q$, c_x)));
  perform pg_temp.expect_denied('3-8 未ログインは recalculate_configuration を実行できない', '42501',
    pg_temp.run_as('anon', null, format($q$ select (public.recalculate_configuration(%L)).id::text $q$, c_x)));
  perform pg_temp.expect_denied('3-9 ログイン利用者も recalculate_configuration を直接実行できない', '42501',
    pg_temp.run_as('authenticated', u_cust_y, format($q$ select (public.recalculate_configuration(%L)).id::text $q$, c_x)));
  perform pg_temp.expect_denied('3-10 旧 save_configuration は実行できない', '42501',
    pg_temp.run_as('authenticated', u_cust_x, format($q$ select (public.save_configuration(null, %L, 'x', '{}'::uuid[], null, null, 'full', '{}'::uuid[], 'office')).id::text $q$, v_model)));
  perform pg_temp.expect_denied('3-11 未ログインは validate_configuration_items を実行できない', '42501',
    pg_temp.run_as('anon', null, format($q$ select public.validate_configuration_items(%L, '{}'::uuid[], 'full')::text $q$, v_model)));

  ---------------------------------------------------------------------------
  -- 4. duplicate_configuration の権限境界
  ---------------------------------------------------------------------------
  perform pg_temp.expect_denied('4-1 他人のプランは複製できない', '42501',
    pg_temp.run_as('authenticated', u_cust_y, format($q$ select (public.duplicate_configuration(%L)).id::text $q$, c_x)));
  perform pg_temp.expect_denied('4-2 sub の無いトークンでは複製できない', '42501',
    pg_temp.run_as('authenticated', null, format($q$ select (public.duplicate_configuration(%L)).id::text $q$, c_x)));
  perform pg_temp.expect_denied('4-3 担当代理店でも顧客のプランは複製できない', '42501',
    pg_temp.run_as('authenticated', u_dealer1, format($q$ select (public.duplicate_configuration(%L)).id::text $q$, c_x)));
  perform pg_temp.expect_eq('4-4 本人は自分のプランを複製できる（複製先も本人のもの）', u_cust_x::text,
    pg_temp.run_as('authenticated', u_cust_x, format($q$ select (public.duplicate_configuration(%L)).user_id::text $q$, c_x)));
  perform pg_temp.expect_eq('4-5 本部は顧客のプランを複製できる（複製先は顧客のもの）', u_cust_x::text,
    pg_temp.run_as('authenticated', u_admin, format($q$ select (public.duplicate_configuration(%L)).user_id::text $q$, c_x)));

  ---------------------------------------------------------------------------
  -- 5. 内部関数を閉じても、トリガー経由の通知・監査は止まらない
  ---------------------------------------------------------------------------
  select count(*) into v_notifications_before from public.notifications;
  insert into public.contact_messages (full_name, email, topic, message)
  values ('権限検査', 'contact@runtime.invalid', 'other', '通知トリガーの確認');
  perform pg_temp.expect_eq('5-1 問い合わせ登録で通知が作られる（trigger → notify）', 'true',
    ((select count(*) from public.notifications) > v_notifications_before)::text);

  select count(*) into v_audit_before from public.audit_logs;
  perform pg_temp.run_as('authenticated', u_admin, $q$ update public.base_models set base_price = base_price + 1 where slug = 'runtime-check' returning 'updated' $q$);
  perform pg_temp.expect_eq('5-2 本部の価格変更で監査ログが作られる（trigger → write_audit）', 'true',
    ((select count(*) from public.audit_logs) > v_audit_before)::text);

  ---------------------------------------------------------------------------
  -- 6. respond_to_quote（お客様の承諾・辞退）の権限境界
  ---------------------------------------------------------------------------
  -- 顧客Xの確定見積（最新版）と、顧客Xの依頼 r_x に残る旧版（最新版は q_x）を追加する
  set local session_replication_role = replica;
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (c_f, u_cust_x, v_model, '顧客Xの確定見積案件', 'quoted', 'office', 'full');
  insert into public.quote_requests (id, configuration_id, user_id, quote_id, status)
  values (r_f, c_f, u_cust_x, q_f, 'sent');
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, base_model_name, base_price, option_subtotal, installation_subtotal,
                             subtotal, tax_rate, tax, total, quote_kind)
  values
    (q_f, 'RT-0003', r_f, c_f, u_cust_x, u_dealer1, 'issued', now() + interval '30 days', '顧客X', '権限検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 'formal'),
    (q_x_old, 'RT-0004', r_x, c_x, u_cust_x, u_dealer1, 'issued', now() + interval '30 days', '顧客X', '権限検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, null);
  -- 顧客Yの依頼は、旧形式（quote_kind なし）のまま第2版が最新になった状態にする
  update public.quotes set status = 'superseded' where id = q_y;
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, base_model_name, base_price, option_subtotal, installation_subtotal,
                             subtotal, tax_rate, tax, total, revision, parent_quote_id)
  values (q_y2, 'RT-0005', r_y, c_y, u_cust_y, u_master, 'issued', now() + interval '30 days', '顧客Y', '権限検査用モデル', 1000000, 0, 200000, 1200000, 0.10, 120000, 1320000, 2, q_y);
  update public.quote_requests set quote_id = q_y2 where id = r_y;
  set local session_replication_role = origin;

  perform pg_temp.expect_denied('6-1 未ログインは見積へ回答できない', '42501',
    pg_temp.run_as('anon', null, format($q$ select (public.respond_to_quote(%L, 'declined')).status $q$, q_x)));
  perform pg_temp.expect_denied('6-2 sub の無いトークンでは回答できない', '42501',
    pg_temp.run_as('authenticated', null, format($q$ select (public.respond_to_quote(%L, 'declined')).status $q$, q_x)));
  perform pg_temp.expect_denied('6-3 他人の見積には回答できない', '42501',
    pg_temp.run_as('authenticated', u_cust_y, format($q$ select (public.respond_to_quote(%L, 'declined')).status $q$, q_x)));
  perform pg_temp.expect_denied('6-4 担当代理店は顧客の代わりに回答できない', '42501',
    pg_temp.run_as('authenticated', u_dealer1, format($q$ select (public.respond_to_quote(%L, 'declined')).status $q$, q_x)));
  perform pg_temp.expect_denied('6-5 本部も顧客の代わりに回答できない', '42501',
    pg_temp.run_as('authenticated', u_admin, format($q$ select (public.respond_to_quote(%L, 'declined')).status $q$, q_x)));
  perform pg_temp.expect_denied('6-6 回答の値が不正なら拒否する', 'P0001',
    pg_temp.run_as('authenticated', u_cust_x, format($q$ select (public.respond_to_quote(%L, 'approved')).status $q$, q_x)));
  perform pg_temp.expect_denied('6-7 概算見積（確定見積の発行前）は承諾できない', 'P0001',
    pg_temp.run_as('authenticated', u_cust_x, format($q$ select (public.respond_to_quote(%L, 'accepted')).status $q$, q_x)));
  perform pg_temp.expect_denied('6-8 最新の版ではない見積には回答できない', 'P0001',
    pg_temp.run_as('authenticated', u_cust_x, format($q$ select (public.respond_to_quote(%L, 'declined')).status $q$, q_x_old)));
  perform pg_temp.expect_eq('6-9 拒否された操作では見積の状態が変わっていない', 'issued,issued,issued',
    (select string_agg(status, ',' order by quote_no) from public.quotes where id in (q_x, q_x_old, q_f)));
  perform pg_temp.expect_eq('6-10 本人は確定見積（最新版）を承諾できる', 'accepted',
    pg_temp.run_as('authenticated', u_cust_x, format($q$ select (public.respond_to_quote(%L, 'accepted')).status $q$, q_f)));
  perform pg_temp.expect_eq('6-11 承諾するとプランが closed になる', 'closed',
    (select status from public.configurations where id = c_f));
  perform pg_temp.expect_denied('6-12 回答済みの見積へは再回答できない', 'P0001',
    pg_temp.run_as('authenticated', u_cust_x, format($q$ select (public.respond_to_quote(%L, 'declined')).status $q$, q_f)));
  perform pg_temp.expect_eq('6-13 旧形式でも、親を持つ改訂版（確定見積）は承諾できる', 'accepted',
    pg_temp.run_as('authenticated', u_cust_y, format($q$ select (public.respond_to_quote(%L, 'accepted')).status $q$, q_y2)));
  perform pg_temp.expect_eq('6-14 概算見積の辞退は本人ならできる', 'declined',
    pg_temp.run_as('authenticated', u_cust_x, format($q$ select (public.respond_to_quote(%L, 'declined')).status $q$, q_x)));

  ---------------------------------------------------------------------------
  -- 7. 担当未割当の見積と、旧形式（quote_kind なし）の見積（NULL で判定が素通りしないこと）
  ---------------------------------------------------------------------------
  set local session_replication_role = replica;
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (c_u, u_cust_x, v_model, '担当未割当の案件', 'quote_requested', 'office', 'full'),
         (c_l2, u_cust_x, v_model, '旧形式・第2版を承諾済み', 'closed', 'office', 'full'),
         (c_l1, u_cust_x, v_model, '旧形式・第1版を承諾済み', 'closed', 'office', 'full');
  insert into public.quote_requests (id, configuration_id, user_id, quote_id, status)
  values (r_u, c_u, u_cust_x, q_u, 'new'), (r_l2, c_l2, u_cust_x, q_l2, 'sent'), (r_l1, c_l1, u_cust_x, q_lp, 'sent');
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, base_model_name, base_price, option_subtotal, installation_subtotal,
                             subtotal, tax_rate, tax, total, revision, parent_quote_id)
  values
    -- 担当未割当（dealer_id が NULL）。新しい Web 見積依頼は、本部が担当を決めるまでこの状態
    (q_u,  'RT-0100', r_u,  c_u,  u_cust_x, null,      'issued',     now() + interval '30 days', '顧客X', '権限検査用モデル', 1000000, 0, 0,      1000000, 0.10, 100000, 1100000, 1, null),
    -- 旧形式：第1版 → 第2版（確定見積）を承諾済み
    (q_l1, 'RT-0201', r_l2, c_l2, u_cust_x, u_dealer1, 'superseded', now() + interval '30 days', '顧客X', '権限検査用モデル', 1000000, 0, 0,      1000000, 0.10, 100000, 1100000, 1, null),
    (q_l2, 'RT-0202', r_l2, c_l2, u_cust_x, u_dealer1, 'accepted',   now() + interval '30 days', '顧客X', '権限検査用モデル', 1000000, 0, 300000, 1300000, 0.10, 130000, 1430000, 2, q_l1),
    -- 旧形式：第1版（概算）を承諾済み。概算→確定の互換処理の本来の対象
    (q_lp, 'RT-0203', r_l1, c_l1, u_cust_x, u_dealer1, 'accepted',   now() + interval '30 days', '顧客X', '権限検査用モデル', 1000000, 0, 0,      1000000, 0.10, 100000, 1100000, 1, null);
  insert into public.quote_items (quote_id, kind, name, unit_price, quantity, amount, sort_order)
  values (q_u, 'base', '本体', 1000000, 1, 1000000, 1),
         (q_l2, 'base', '本体', 1000000, 1, 1000000, 1), (q_l2, 'installation', '基礎工事', 300000, 1, 300000, 2),
         (q_lp, 'base', '本体', 1000000, 1, 1000000, 1);
  set local session_replication_role = origin;

  perform pg_temp.expect_denied('7-1 担当外の代理店は、担当未割当の見積のプランを読めない', '42501',
    pg_temp.run_as('authenticated', u_dealer2, format($q$ select left(t::text, 80) from public.get_case_plan_configuration(%L) t $q$, q_u)));
  perform pg_temp.expect_denied('7-2 担当外の総代理店も、担当未割当の見積のプランを読めない', '42501',
    pg_temp.run_as('authenticated', u_master, format($q$ select left(t::text, 80) from public.get_case_plan_configuration(%L) t $q$, q_u)));
  perform pg_temp.expect_denied('7-3 担当外の代理店は、担当未割当の見積を改訂できない', '42501',
    pg_temp.run_as('authenticated', u_dealer2, format($q$ select public.create_quote_revision(%L, '[{"kind":"installation","name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_u)));
  perform pg_temp.expect_denied('7-4 担当外の総代理店も、担当未割当の見積を改訂できない', '42501',
    pg_temp.run_as('authenticated', u_master, format($q$ select public.create_quote_revision(%L, '[{"kind":"installation","name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_u)));
  perform pg_temp.expect_denied('7-5 担当外の代理店は、担当未割当の見積の互換状態を問い合わせできない', '42501',
    pg_temp.run_as('authenticated', u_dealer2, format($q$ select t::text from public.get_legacy_accepted_formalization_state(%L) t $q$, q_u)));
  perform pg_temp.expect_eq('7-6 担当未割当の見積は改訂されていない（版は 1 つのまま）', '1',
    (select count(*)::text from public.quotes where quote_request_id = r_u));
  perform pg_temp.expect_eq('7-7 本部は担当未割当の見積のプランを読める', 'true',
    (pg_temp.run_as('authenticated', u_admin, format($q$ select left(t::text, 80) from public.get_case_plan_configuration(%L) t $q$, q_u)) not like 'ERROR %')::text);

  perform pg_temp.expect_denied('7-8 旧形式で承諾済みの改訂版（確定見積）には、概算→確定の互換処理を実行できない', 'P0001',
    pg_temp.run_as('authenticated', u_dealer1, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[{"name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_l2)));
  perform pg_temp.expect_eq('7-9 拒否された互換処理で、承諾済みの見積と版数は変わっていない', 'RT-0201:superseded,RT-0202:accepted',
    (select string_agg(quote_no || ':' || status, ',' order by quote_no) from public.quotes where quote_request_id = r_l2));

  -- legacy 改訂版を historical にした場合も preliminary 互換候補へ戻らないことを確認する。
  set local session_replication_role = replica;
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, base_model_name, base_price, option_subtotal, installation_subtotal,
                             subtotal, tax_rate, tax, total, revision, parent_quote_id, quote_kind)
  values (q_l3, 'RT-0202-3', r_l2, c_l2, u_cust_x, u_dealer1, 'issued', now() + interval '30 days',
          '顧客X', '権限検査用モデル', 1000000, 0, 300000, 1300000, 0.10, 130000, 1430000, 3, q_l2, 'formal');
  update public.quote_requests set quote_id = q_l3 where id = r_l2;
  set local session_replication_role = origin;
  perform pg_temp.expect_eq('7-10 旧形式の改訂版がhistoricalでも、互換状態はineligible', 'ineligible',
    pg_temp.run_as('authenticated', u_dealer1, format($q$ select state from public.get_legacy_accepted_formalization_state(%L) $q$, q_l2)));

  perform pg_temp.expect_eq('7-11 旧形式で承諾済みの第1版（概算）には、担当代理店が互換処理を実行できる', 'true',
    (pg_temp.run_as('authenticated', u_dealer1, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[{"name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_lp)) not like 'ERROR %')::text);
  perform pg_temp.expect_eq('7-12 互換処理後も、承諾済みの概算見積（親）は変わらず、確定見積が 1 つ発行される', 'RT-0203:accepted:,RT-0203-2:issued:formal',
    (select string_agg(quote_no || ':' || status || ':' || coalesce(quote_kind, ''), ',' order by quote_no) from public.quotes where quote_request_id = r_l1));

  ---------------------------------------------------------------------------
  -- 8. 概算→確定の互換処理は、権限のない利用者に案件の状態を返さない（権限確認が状態判定より先）
  ---------------------------------------------------------------------------
  v_quotes_before := (select count(*) from public.quotes where quote_no like 'RT-%');

  perform pg_temp.expect_denied('8-1 担当外の代理店には、互換処理済みの概算見積でも権限の拒否だけを返す', '42501',
    pg_temp.run_as('authenticated', u_dealer2, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[{"name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_lp)));
  perform pg_temp.expect_denied('8-2 担当外の代理店には、辞退済みの見積でも権限の拒否だけを返す', '42501',
    pg_temp.run_as('authenticated', u_dealer2, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[{"name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_x)));
  perform pg_temp.expect_denied('8-3 担当外の代理店には、担当未割当の見積でも権限の拒否だけを返す', '42501',
    pg_temp.run_as('authenticated', u_dealer2, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[{"name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_u)));
  perform pg_temp.expect_denied('8-4 担当外の総代理店には、承諾済みの改訂版でも権限の拒否だけを返す', '42501',
    pg_temp.run_as('authenticated', u_master, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[{"name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_l2)));
  perform pg_temp.expect_denied('8-5 お客様本人にも、承諾済みの確定見積で権限の拒否だけを返す', '42501',
    pg_temp.run_as('authenticated', u_cust_x, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[{"name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_f)));
  perform pg_temp.expect_denied('8-6 担当代理店には、従来どおり状態に応じた判定を返す（互換処理済みは LOCKED）', 'P0001',
    pg_temp.run_as('authenticated', u_dealer1, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[{"name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_lp)));
  perform pg_temp.expect_denied('8-7 本部には、従来どおり状態に応じた判定を返す（辞退済みは LOCKED）', 'P0001',
    pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[{"name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_x)));
  perform pg_temp.expect_eq('8-8 拒否された互換処理では見積が増えていない', v_quotes_before::text,
    (select count(*)::text from public.quotes where quote_no like 'RT-%'));

  ---------------------------------------------------------------------------
  -- 9. 本体仕様マトリクス：誰でも読めるが、API ロールからは書き換えられない（変更は管理画面の RPC だけ）
  ---------------------------------------------------------------------------
  if to_regclass('public.matrix_rows') is not null then
    perform pg_temp.expect_eq('9-1 未ログインでも Matrix Item（15 項目）を読める', '15',
      pg_temp.run_as('anon', null, $q$ select count(*)::text from public.matrix_items where status = 'active' $q$));
    perform pg_temp.expect_eq('9-2 未ログインでも Matrix Row を読める（機種がある DB では確定 seed の 6 行）',
      (case when exists (select 1 from public.base_models where slug in ('wing-01', 'box', 'flat')) then '6' else '0' end),
      pg_temp.run_as('anon', null, $q$ select count(*)::text from public.matrix_rows $q$));
    perform pg_temp.expect_denied('9-3 未ログインは Matrix Row を追加できない', '42501',
      pg_temp.run_as('anon', null, format($q$ insert into public.matrix_rows (base_model_id, spec_code, size_code, fire_selectable) values (%L, 'hotel', '3640x4550', true) returning 'inserted' $q$, v_model)));
    perform pg_temp.expect_denied('9-4 お客様は選択可否を書き換えられない', '42501',
      pg_temp.run_as('authenticated', u_cust_x, $q$ update public.matrix_cells set selectable = true returning 'updated' $q$));
    perform pg_temp.expect_denied('9-5 本部でも表を直接は書き換えられない（変更は RPC だけ）', '42501',
      pg_temp.run_as('authenticated', u_admin, $q$ update public.matrix_rows set fire_selectable = true returning 'updated' $q$));
    perform pg_temp.expect_denied('9-6 本部でも Matrix Item を直接は追加できない', '42501',
      pg_temp.run_as('authenticated', u_admin, $q$ insert into public.matrix_items (code, label) values ('fireproof', '防火') returning 'inserted' $q$));
    perform pg_temp.expect_denied('9-7 代理店は Category→Item の対応を追加できない', '42501',
      pg_temp.run_as('authenticated', u_dealer1, $q$ insert into public.option_category_matrix_items (category_id, matrix_item_code) select id, 'other' from public.option_categories limit 1 returning 'inserted' $q$));
    perform pg_temp.expect_eq('9-8 Category→Item の対応は確定 24 カテゴリーだけ（商品が無い空の DB では登録しない）',
      (case when exists (select 1 from public.options) then '24' else '0' end),
      (select count(*)::text from public.option_category_matrix_items));
    perform pg_temp.expect_denied('9-10 お客様は本体分類表の判定関数を直接実行できない', '42501',
      pg_temp.run_as('authenticated', u_cust_x, $q$ select public.customer_category_selectable('wing-01', 'hotel', 'kitchen')::text $q$));

    -- 10. 本体分類表の選択 / × は DB のマトリクスから判定する（管理画面での変更がそのまま効く）
    if exists (select 1 from public.option_category_matrix_items) and exists (select 1 from public.matrix_rows) then
      perform pg_temp.expect_eq('10-1 Wing ホテル仕様ではキッチンを選べない（確定 seed）', 'false',
        public.customer_category_selectable('wing-01', 'hotel', 'kitchen')::text);
      update public.matrix_cells c set selectable = true
        from public.matrix_rows r join public.base_models m on m.id = r.base_model_id
       where c.matrix_row_id = r.id and m.slug = 'wing-01' and r.spec_code = 'hotel' and c.matrix_item_code = 'kitchen';
      perform pg_temp.expect_eq('10-2 セルを「選択」に変えると、同じ判定がすぐに選べるへ変わる（データ駆動）', 'true',
        public.customer_category_selectable('wing-01', 'hotel', 'kitchen')::text);
      update public.matrix_rows r set status = 'retired'
        from public.base_models m where m.id = r.base_model_id and m.slug = 'wing-01' and r.spec_code = 'hotel';
      perform pg_temp.expect_eq('10-3 行を retired にすると、その仕様では対象カテゴリーを選べない（fail closed）', 'false',
        public.customer_category_selectable('wing-01', 'hotel', 'kitchen')::text);
      perform pg_temp.expect_eq('10-4 互換：BOX hotel-single は BOX ホテル仕様と同じ（キッチン不可・ベッド可）', 'false,true',
        public.customer_category_selectable('box', 'hotel-single', 'kitchen')::text || ',' ||
        public.customer_category_selectable('box', 'hotel-single', 'bed')::text);
      perform pg_temp.expect_eq('10-5 互換：本体のみは屋根・外壁／玄関ドア／サッシだけ', 'true,true,false',
        public.customer_category_selectable('flat', 'base', 'exterior-wall')::text || ',' ||
        public.customer_category_selectable('flat', 'base', 'sash')::text || ',' ||
        public.customer_category_selectable('flat', 'base', 'ub')::text);
      perform pg_temp.expect_eq('10-6 確定 6 行に無い仕様（Wing room）では対象カテゴリーを選べない', 'false',
        public.customer_category_selectable('wing-01', 'room', 'bed')::text);
      perform pg_temp.expect_eq('10-7 マトリクスの対象外カテゴリー（断熱）は制限しない', 'true',
        public.customer_category_selectable('flat', 'office', 'insulation')::text);
    end if;

    -- 11. 本体マスターの identity：組織 × 機種・用途・サイズ（マトリクスの行）× 防火
    if to_regprocedure('public.create_base_master_draft(uuid, uuid, text, text, uuid, uuid)') is not null then
      set local session_replication_role = replica;
      insert into public.base_models (id, slug, name, base_price, status)
      values (m_other, 'runtime-check-other', '権限検査用モデル2', 1000000, 'published') on conflict (slug) do nothing;
      insert into public.organizations (id, code, name, organization_type) values (o_hq, 'RT-HQ', '検査用本部', 'headquarters');
      insert into public.organization_memberships (organization_id, profile_id, member_role) values (o_hq, u_admin, 'editor');
      insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
      values (mr_nofire, v_model, 'office', '2100x4550', false), (mr_fire, v_model, 'hotel', '3640x4550', true);
      set local session_replication_role = origin;

      perform pg_temp.expect_denied('11-1 防火を選べない行では、防火の本体を作れない', 'P0001',
        pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_base_master_draft(%L, %L, '検査 防火', 'fire', null, %L)::text $q$, v_model, o_hq, mr_nofire)));
      perform pg_temp.expect_denied('11-2 行と商品モデルが違う本体は作れない', 'P0001',
        pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_base_master_draft(%L, %L, '検査 不一致', 'non_fire', null, %L)::text $q$, m_other, o_hq, mr_nofire)));
      perform pg_temp.expect_denied('11-3 行（機種・用途・サイズ）の指定が無い本体は作れない', 'P0001',
        pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_base_master_draft(%L, %L, '検査 行なし', 'non_fire', null, null)::text $q$, v_model, o_hq)));
      perform pg_temp.expect_eq('11-4 防火を選べる行では、防火の本体を作れる', 'true',
        (pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_base_master_draft(%L, %L, '検査 防火', 'fire', null, %L)::text $q$, v_model, o_hq, mr_fire)) not like 'ERROR %')::text);
      perform pg_temp.expect_denied('11-5 同じ組織 × 行 × 防火の本体は 2 つ作れない', '23505',
        pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_base_master_draft(%L, %L, '検査 防火2', 'fire', null, %L)::text $q$, v_model, o_hq, mr_fire)));
      perform pg_temp.expect_eq('11-6 防火を選べない行でも、非防火の本体は作れる', 'true',
        (pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_base_master_draft(%L, %L, '検査 非防火', 'non_fire', null, %L)::text $q$, v_model, o_hq, mr_nofire)) not like 'ERROR %')::text);
      perform pg_temp.expect_denied('11-7 所属の無いお客様は本体を作れない', '42501',
        pg_temp.run_as('authenticated', u_cust_x, format($q$ select public.create_base_master_draft(%L, %L, '検査 顧客', 'non_fire', null, %L)::text $q$, v_model, o_hq, mr_fire)));
      perform pg_temp.expect_eq('11-8 作られた本体はすべて行を持ち、identity が重複していない', '2/2',
        (select count(*)::text || '/' || count(distinct (matrix_row_id, fire_spec_code))::text from public.base_masters where owner_organization_id = o_hq));

      -- 13. マトリクスの変更は本部だけ・版の一致・有効な項目だけ。防火の本体がある行は防火不可にできない
      if to_regprocedure('public.update_matrix_row(uuid, boolean, text[], integer)') is not null then
        perform pg_temp.expect_denied('13-1 お客様はマトリクスを変更できない', '42501',
          pg_temp.run_as('authenticated', u_cust_x, format($q$ select (public.update_matrix_row(%L, false, '{}'::text[], 1)).id::text $q$, mr_nofire)));
        perform pg_temp.run_as('authenticated', u_admin,
          format($q$ select (public.update_matrix_row(%L, false, array['roof-exterior', 'sash'], 1)).id::text $q$, mr_nofire));
        perform pg_temp.expect_eq('13-2 本部は版が一致すれば変更でき、版が進み、選択できる項目が置き換わる', '2/roof-exterior,sash',
          (select r.lock_version::text || '/' || string_agg(c.matrix_item_code, ',' order by c.matrix_item_code)
             from public.matrix_rows r join public.matrix_cells c on c.matrix_row_id = r.id and c.selectable
            where r.id = mr_nofire group by r.lock_version));
        perform pg_temp.expect_denied('13-3 古い版のままの変更は拒否される', 'P0001',
          pg_temp.run_as('authenticated', u_admin, format($q$ select (public.update_matrix_row(%L, false, '{}'::text[], 1)).id::text $q$, mr_nofire)));
        perform pg_temp.expect_denied('13-4 有効でない項目（防火など）は選択できる項目にできない', 'P0001',
          pg_temp.run_as('authenticated', u_admin, format($q$ select (public.update_matrix_row(%L, false, array['fireproof'], 2)).id::text $q$, mr_nofire)));
        perform pg_temp.expect_denied('13-5 防火の本体がある行は、防火不可へ変更できない', 'P0001',
          pg_temp.run_as('authenticated', u_admin, format($q$ select (public.update_matrix_row(%L, false, '{}'::text[], 1)).id::text $q$, mr_fire)));
        perform pg_temp.expect_denied('13-6 同じ機種・仕様・サイズの行は追加できない', 'P0001',
          pg_temp.run_as('authenticated', u_admin, format($q$ select (public.create_matrix_row(%L, 'office', '2100x4550', false, '{}'::text[])).id::text $q$, v_model)));
        perform pg_temp.run_as('authenticated', u_admin,
          format($q$ select (public.set_matrix_row_status(%L, 'retired', 2)).id::text $q$, mr_nofire));
        perform pg_temp.expect_eq('13-7 本部は行を停止でき、変更は監査ログに残る', 'retired/2',
          (select r.status || '/' || (select count(*)::text from public.audit_logs a where a.entity = 'matrix_rows' and a.entity_id = mr_nofire)
             from public.matrix_rows r where r.id = mr_nofire));
      end if;

      -- 14. 標準見積の金額（trunc・率・price_mode・POR 除外）と、公開・次の Revision・内部原価の非公開
      if to_regprocedure('public.save_standard_estimate_draft(uuid, numeric, numeric, numeric, integer, text, jsonb, jsonb, integer)') is not null then
        -- 基準の本体：組織 × Wing相当の行（mr_fire）× 非防火。明細 1 行（基準原価 18,200 円 × 12）を公開する
        v_bmr_text := pg_temp.run_as('authenticated', u_admin,
          format($q$ select public.create_base_master_draft(%L, %L, '検査 標準見積用', 'non_fire', null, %L)::text $q$, v_model, o_hq, mr_fire));
        perform pg_temp.run_as('authenticated', u_admin, format($q$ select (public.save_base_master_draft(%L, '検査 標準見積用', 'non_fire', 'none', null, 0,
          '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id::text $q$, v_bmr_text));
        perform pg_temp.run_as('authenticated', u_admin, format($q$ select (public.publish_base_master_draft(%L)).id::text $q$, v_bmr_text));

        perform pg_temp.expect_denied('14-1 お客様は標準見積を作成できない', '42501',
          pg_temp.run_as('authenticated', u_cust_x, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr_text)));
        perform pg_temp.expect_denied('14-2 公開中でない本体 Revision では作成できない', 'P0001',
          pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_standard_estimate_draft(%L)::text $q$,
            (select r.id from public.base_master_revisions r join public.base_masters b on b.id = r.base_master_id
              where b.owner_organization_id = o_hq and b.matrix_row_id = mr_fire and b.fire_spec_code = 'fire' and r.status = 'draft' limit 1))));
        v_se_text := pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_standard_estimate_draft(%L)::text $q$, v_bmr_text));
        perform pg_temp.run_as('authenticated', u_admin, format($q$ select (public.save_standard_estimate_draft(%L, 1.07, 0.15, 1.5, -719, '端数調整',
          '{"base":"rate","interior_exterior":"rate","option":"rate","sitework":"none"}'::jsonb,
          '[{"section_code":"option","name":"洗面器","quantity":1,"price_mode":"auto","cost_unit_price":46150},{"section_code":"option","name":"未定の備品","quantity":1,"price_mode":"por"}]'::jsonb,
          1)).id::text $q$, v_se_text));
        perform pg_temp.expect_eq('14-3 金額は画面の試算と同じ（trunc・販売費率・掛率・経費率・調整額・税、POR は除外）', '482000/48200/530200/321813/true',
          (select subtotal || '/' || tax || '/' || total || '/' || cost_total || '/' || has_por from public.standard_estimate_revisions where id::text = v_se_text));
        perform pg_temp.expect_eq('14-4 本体の明細は写さず、本体 Revision から計算する（POR の行は単価・金額とも NULL）', '0/1/233688/350532',
          (select (select count(*) from public.standard_estimate_revision_lines l where l.revision_id::text = v_se_text and l.section_code = 'base')::text || '/' ||
                  (select count(*) from public.standard_estimate_revision_lines l where l.revision_id::text = v_se_text and l.price_mode = 'por'
                      and l.unit_price is null and l.amount is null and l.cost_amount is null)::text || '/' ||
                  s.cost_line_subtotal || '/' || s.line_subtotal
             from public.standard_estimate_revision_sections s where s.revision_id::text = v_se_text and s.section_code = 'base'));
        perform pg_temp.expect_denied('14-5 古い版のままの保存は拒否される', 'P0001',
          pg_temp.run_as('authenticated', u_admin, format($q$ select (public.save_standard_estimate_draft(%L, 1, 0.15, 1.5, 0, null, '{}'::jsonb, '[]'::jsonb, 1)).id::text $q$, v_se_text)));
        perform pg_temp.expect_denied('14-6 範囲外の率（掛率 260%）は拒否される', 'P0001',
          pg_temp.run_as('authenticated', u_admin, format($q$ select (public.save_standard_estimate_draft(%L, 1, 0.15, 2.6, 0, null, '{}'::jsonb, '[]'::jsonb, 2)).id::text $q$, v_se_text)));
        perform pg_temp.expect_denied('14-7 固定額の経費は新しく使えない', 'P0001',
          pg_temp.run_as('authenticated', u_admin, format($q$ select (public.save_standard_estimate_draft(%L, 1, 0.15, 1.5, 0, null, '{"option":"fixed"}'::jsonb, '[]'::jsonb, 2)).id::text $q$, v_se_text)));

        perform pg_temp.run_as('authenticated', u_admin, format($q$ select (public.publish_standard_estimate_revision(%L, 2)).id::text $q$, v_se_text));
        perform pg_temp.expect_eq('14-8 公開でき、公開中の本体 Revision を固定し、現在の版になる', 'published/true/true',
          (select r.status || '/' || (r.base_master_revision_id::text = v_bmr_text)::text || '/' || (m.current_published_revision_id = r.id)::text
             from public.standard_estimate_revisions r join public.standard_estimate_masters m on m.id = r.standard_estimate_master_id
            where r.id::text = v_se_text));
        perform pg_temp.expect_denied('14-9 公開済みの Revision は保存できない', 'P0001',
          pg_temp.run_as('authenticated', u_admin, format($q$ select (public.save_standard_estimate_draft(%L, 1, 0.15, 1.5, 0, null, '{}'::jsonb, '[]'::jsonb, 3)).id::text $q$, v_se_text)));
        perform pg_temp.expect_denied('14-10 公開済みの率は、DB を直接操作しても変えられない', 'P0001',
          pg_temp.run_as('postgres', null, format($q$ update public.standard_estimate_revisions set markup_rate = 2 where id = %L returning 'updated' $q$, v_se_text)));
        v_se_next_text := pg_temp.run_as('authenticated', u_admin, format($q$ select public.start_next_standard_estimate_revision(%L)::text $q$,
          (select standard_estimate_master_id from public.standard_estimate_revisions where id::text = v_se_text)));
        perform pg_temp.expect_eq('14-11 次の Revision は公開版の率・明細を引き継いだ下書き（版 2）で、公開版は変わらない', 'draft/2/1.5000/2/published',
          (select r.status || '/' || r.version || '/' || r.markup_rate || '/' ||
                  (select count(*) from public.standard_estimate_revision_lines l where l.revision_id = r.id)::text || '/' ||
                  (select p.status from public.standard_estimate_revisions p where p.id::text = v_se_text)
             from public.standard_estimate_revisions r where r.id::text = v_se_next_text));
        perform pg_temp.expect_eq('14-12 内部原価（標準見積）はお客様・代理店には見えない', '0/0',
          pg_temp.run_as('authenticated', u_cust_x, $q$ select count(*)::text from public.standard_estimate_revisions $q$) || '/' ||
          pg_temp.run_as('authenticated', u_dealer1, $q$ select count(*)::text from public.standard_estimate_revisions $q$));

        -- 15. 標準見積 → 見積（PR H）：作成・編集・発行は本部だけ。POR は発行できず、内部原価は本部だけ。
        --     第 2 版は直前の発行版を引き継ぎ、最新の標準見積へは追従しない。新しい下書き・版の金額は trunc
        if to_regprocedure('public.create_standard_quote_case(text, jsonb, text, uuid)') is not null then
          perform pg_temp.expect_denied('15-1 お客様は標準見積から見積を作れない', '42501',
            pg_temp.run_as('authenticated', u_cust_x, format($q$ select public.create_standard_quote_case('検査案件', '{"full_name":"検査 太郎"}'::jsonb, null, %L)::text $q$, v_se_text)));
          perform pg_temp.expect_denied('15-2 代理店も標準見積から見積を作れない（現在は本部だけ）', '42501',
            pg_temp.run_as('authenticated', u_dealer1, format($q$ select public.create_standard_quote_case('検査案件', '{"full_name":"検査 太郎"}'::jsonb, null, %L)::text $q$, v_se_text)));
          v_sq_text := pg_temp.run_as('authenticated', u_admin,
            format($q$ select public.create_standard_quote_case('検査案件', '{"full_name":"検査 太郎"}'::jsonb, null, %L)::text $q$, v_se_text));
          perform pg_temp.expect_eq('15-3 公開中の標準見積から見積下書きを作れ、合計は標準見積と同じ（経費は率から計算し直し、POR は合計に含めない）',
            'standard_estimate/true/1/482000/530200/5/1',
            coalesce((select d.source_kind || '/' || (d.standard_estimate_revision_id::text = v_se_text)::text || '/' || d.lock_version || '/' ||
                             d.subtotal || '/' || d.total || '/' ||
                             (select count(*) from public.quote_draft_items i where i.draft_id = d.id)::text || '/' ||
                             (select count(*) from public.quote_draft_items i
                               where i.draft_id = d.id and i.price_mode = 'por' and i.unit_price is null and i.amount is null)::text
                        from public.quote_drafts d where d.id::text = v_sq_text), v_sq_text));
          perform pg_temp.expect_eq('15-4 本部は RPC で率・内部原価を読め、内部原価は標準見積と同じ', '321813/1.5000',
            pg_temp.run_as('authenticated', u_admin, format($q$ select (public.get_standard_quote_draft(%L) -> 'internals' ->> 'cost_total') || '/' ||
                                                                       (public.get_standard_quote_draft(%L) -> 'internals' ->> 'markup_rate') $q$, v_sq_text, v_sq_text)));
          perform pg_temp.expect_denied('15-5 代理店は見積下書きの率・内部原価を読めない', '42501',
            pg_temp.run_as('authenticated', u_dealer1, format($q$ select public.get_standard_quote_draft(%L)::text $q$, v_sq_text)));
          perform pg_temp.expect_blocked('15-6 お客様は明細の内部原価の表を直接読めない',
            pg_temp.run_as('authenticated', u_cust_x, $q$ select count(*)::text from public.quote_draft_item_costs $q$));
          perform pg_temp.expect_denied('15-7 価格未確定（POR）の明細が残っている見積は発行できない', 'P0001',
            pg_temp.run_as('authenticated', u_admin, format($q$ select public.finalize_quote_draft(%L, 1)::text $q$, v_sq_text)));
          perform pg_temp.expect_denied('15-8 手入力の保存処理では、標準見積から作成した見積を保存できない', 'P0001',
            pg_temp.run_as('authenticated', u_admin, format($q$ select public.save_quote_draft(%L, 1, null, '[]'::jsonb, 0, null, null, null)::text $q$, v_sq_text)));

          -- POR を売価入力で確定し、別途工事（2.5 m × 2,001 円）を足して保存する。本体の行へ送った原価（1 円）は使われない
          v_sq_base_key := (select i.line_key::text from public.quote_draft_items i where i.draft_id::text = v_sq_text and i.kind = 'base');
          v_tmp := pg_temp.run_as('authenticated', u_admin, format($q$ select public.save_standard_quote_draft(%L, 1, 1.07, 0.15, 1.5,
              '{"base":"rate","interior_exterior":"rate","option":"rate","sitework":"none"}'::jsonb,
              jsonb_build_array(
                jsonb_build_object('line_key', %L, 'section_code', 'base', 'name', '伸縮脚', 'quantity', 12, 'unit', '本', 'price_mode', 'auto', 'cost_unit_price', 1),
                '{"section_code":"option","name":"洗面器","quantity":1,"price_mode":"auto","cost_unit_price":46150}'::jsonb,
                '{"section_code":"option","name":"未定の備品","quantity":1,"price_mode":"manual","cost_unit_price":500,"unit_price":900}'::jsonb,
                '{"section_code":"sitework","name":"据付","quantity":2.5,"unit":"m","price_mode":"manual","cost_unit_price":999,"unit_price":2001}'::jsonb),
              -756, '端数調整', null)::text $q$, v_sq_text, v_sq_base_key));
          perform pg_temp.expect_eq('15-9 本部は保存でき、DB が trunc で計算し直す（本体の原価は本体マスターから）', '2/488000/536800/324885',
            v_tmp || '/' || coalesce((select d.subtotal || '/' || d.total || '/' || n.cost_total
                                        from public.quote_drafts d join public.quote_draft_internals n on n.draft_id = d.id
                                       where d.id::text = v_sq_text), '(なし)'));
          perform pg_temp.expect_denied('15-10 古い版のままの保存は拒否される', 'P0001',
            pg_temp.run_as('authenticated', u_admin, format($q$ select public.save_standard_quote_draft(%L, 1, 1.07, 0.15, 1.5, '{}'::jsonb, '[]'::jsonb, 0, null, null)::text $q$, v_sq_text)));

          v_sq_quote_text := pg_temp.run_as('authenticated', u_admin, format($q$ select public.finalize_quote_draft(%L, 2)::text $q$, v_sq_text));
          perform pg_temp.expect_eq('15-11 価格を確定すると発行でき、内部原価・率・粗利が snapshot に残る（明細 6 行、別途工事は trunc で 5,002 円）',
            '536800/6/5002/324885/163115/true',
            coalesce((select q.total || '/' || (select count(*) from public.quote_items qi where qi.quote_id = q.id)::text || '/' ||
                             (select qi.amount from public.quote_items qi where qi.quote_id = q.id and qi.name = '据付')::text || '/' ||
                             s.cost_total || '/' || s.gross_profit || '/' || (s.standard_estimate_revision_id::text = v_se_text)::text
                        from public.quotes q join public.quote_internal_snapshots s on s.quote_id = q.id
                       where q.id::text = v_sq_quote_text), v_sq_quote_text));
          perform pg_temp.expect_eq('15-12 発行済み見積の内部原価は、お客様・代理店には見えない', '0/0',
            pg_temp.run_as('authenticated', u_cust_x, $q$ select count(*)::text from public.quote_internal_snapshots $q$) || '/' ||
            pg_temp.run_as('authenticated', u_dealer1, $q$ select count(*)::text from public.quote_internal_snapshots $q$));
          perform pg_temp.expect_eq('15-13 本部は発行済み見積の内部原価を読める', '1',
            pg_temp.run_as('authenticated', u_admin, format($q$ select count(*)::text from public.quote_internal_snapshots where quote_id = %L $q$, v_sq_quote_text)));

          -- 標準見積の次の版（掛率 200%）を公開しても、見積の第 2 版は追従しない
          perform pg_temp.run_as('authenticated', u_admin, format($q$ select (public.save_standard_estimate_draft(%L, 1.07, 0.15, 2.0, 0, null,
            '{"base":"rate","interior_exterior":"rate","option":"rate","sitework":"none"}'::jsonb, '[]'::jsonb, 1)).id::text $q$, v_se_next_text));
          perform pg_temp.run_as('authenticated', u_admin, format($q$ select (public.publish_standard_estimate_revision(%L, 2)).id::text $q$, v_se_next_text));

          set local session_replication_role = replica;
          update public.quotes set dealer_id = u_dealer1 where id::text = v_sq_quote_text;
          set local session_replication_role = origin;
          perform pg_temp.expect_denied('15-14 担当の代理店でも、標準見積から作成した見積の改訂は作れない（現在は本部だけ）', '42501',
            pg_temp.run_as('authenticated', u_dealer1, format($q$ select public.create_quote_revision_draft(%L)::text $q$, v_sq_quote_text)));
          set local session_replication_role = replica;
          update public.quotes set dealer_id = null where id::text = v_sq_quote_text;
          set local session_replication_role = origin;

          v_sq_rev2_text := pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_quote_revision_draft(%L)::text $q$, v_sq_quote_text));
          perform pg_temp.expect_eq('15-15 第 2 版の下書きは直前の発行版の率・明細・元の標準見積を引き継ぎ、最新の標準見積（掛率 200%）へは追従しない',
            'standard_estimate/true/1.5000/2/324885',
            coalesce((select d.source_kind || '/' || (d.standard_estimate_revision_id::text = v_se_text)::text || '/' || n.markup_rate || '/' ||
                             (select count(*) from public.quote_draft_items i where i.draft_id = d.id and i.price_mode = 'manual')::text || '/' || n.cost_total
                        from public.quote_drafts d join public.quote_draft_internals n on n.draft_id = d.id
                       where d.id::text = v_sq_rev2_text), v_sq_rev2_text));
          v_tmp := pg_temp.run_as('authenticated', u_admin, format($q$ select public.finalize_quote_revision_draft(%L, 0)::text $q$, v_sq_rev2_text));
          perform pg_temp.expect_eq('15-16 第 2 版も発行でき、内部原価・率は直前の版と同じ snapshot になる', '2/536800/1.5000/324885',
            coalesce((select q.revision || '/' || q.total || '/' || s.markup_rate || '/' || s.cost_total
                        from public.quotes q join public.quote_internal_snapshots s on s.quote_id = q.id
                       where q.id::text = v_tmp), v_tmp));

          -- 旧 round で発行した手入力の版（2.5 m × 2,001 円 = 5,003 円）から第 2 版を作ると、trunc で 5,002 円に計算し直す
          set local session_replication_role = replica;
          insert into public.quote_requests (id, configuration_id, user_id, quote_id, status, contact, created_by)
          values (r_old, null, null, q_old, 'reviewing', '{"full_name":"旧形式 検査"}'::jsonb, u_admin);
          insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, status, valid_until, customer_name,
                                     base_model_name, base_price, option_subtotal, installation_subtotal, subtotal, tax_rate, tax, total,
                                     revision, quote_kind, base_model_id, base_master_revision_id, spec_code, created_by)
          values (q_old, 'RT-OLD-1', r_old, null, null, 'issued', now() + interval '30 days', '旧形式 検査',
                  '権限検査用モデル', 0, 0, 5003, 5003, 0.10, 500, 5503,
                  1, 'formal', v_model, v_bmr_text::uuid, 'office', u_admin);
          insert into public.quote_items (quote_id, line_key, kind, name, unit_price, quantity, amount, sort_order)
          values (q_old, gen_random_uuid(), 'installation', '据付（旧 round）', 2001, 2.5, 5003, 1);
          set local session_replication_role = origin;
          v_old_rev2_text := pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_quote_revision_draft(%L)::text $q$, q_old));
          perform pg_temp.expect_eq('15-17 旧 round で発行した版から作る第 2 版は trunc で計算し直す（発行済みの版は 5,003 円のまま）', '5002/5002/5003',
            coalesce((select (select i.amount from public.quote_draft_items i where i.draft_id = d.id)::text || '/' || d.subtotal_raw || '/' ||
                             (select qi.amount from public.quote_items qi where qi.quote_id = q_old)::text
                        from public.quote_drafts d where d.id::text = v_old_rev2_text), v_old_rev2_text));

          -- 手入力の新しい下書きも trunc
          set local session_replication_role = replica;
          update public.base_models set presets = '[{"code":"office","label":"事務所"}]'::jsonb where id = v_model;
          set local session_replication_role = origin;
          v_manual_text := pg_temp.run_as('authenticated', u_admin, format($q$ select public.create_manual_quote_draft_with_items(
              '検査 手入力', '{"full_name":"手入力 検査"}'::jsonb, null, %L, 'office', 'full', null,
              '[{"kind":"installation","name":"据付","quantity":2.5,"unit":"m","unit_price":2001}]'::jsonb, 0, null)::text $q$, v_model));
          perform pg_temp.expect_eq('15-18 手入力の見積も、新しい下書きの金額は trunc（2.5 m × 2,001 円 = 5,002 円）', '5002',
            coalesce((select i.amount::text from public.quote_draft_items i where i.draft_id::text = v_manual_text), v_manual_text));

          -- 標準見積の閲覧は本部だけ（代理店組織の所属者でも、原価・率を含む標準見積は読めない）
          set local session_replication_role = replica;
          insert into public.organizations (id, code, name, organization_type) values (o_dealer, 'RT-DEALER', '検査用代理店', 'dealer');
          insert into public.organization_memberships (organization_id, profile_id, member_role) values (o_dealer, u_dealer2, 'editor');
          set local session_replication_role = origin;
          perform pg_temp.expect_eq('15-19 代理店組織の所属者でも、標準見積（原価・率を含む）は読めない', '0/0',
            pg_temp.run_as('authenticated', u_dealer2, $q$ select count(*)::text from public.standard_estimate_revisions $q$) || '/' ||
            pg_temp.run_as('authenticated', u_dealer2, $q$ select count(*)::text from public.standard_estimate_revision_lines $q$));
        end if;
      end if;
    end if;

    perform pg_temp.expect_eq('9-9 防火を選べない行は Flat 事務所だけ（機種がある DB）',
      (case when exists (select 1 from public.base_models where slug = 'flat') then 'flat/office/2100x4550' else '' end),
      (select coalesce(string_agg(m.slug || '/' || r.spec_code || '/' || r.size_code, ','), '')
         from public.matrix_rows r join public.base_models m on m.id = r.base_model_id
        where not r.fire_selectable and m.slug not like 'runtime-check%'));
  end if;
end
$test$;

select coalesce(jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq), '[]'::jsonb) as j
  from _result;

rollback;