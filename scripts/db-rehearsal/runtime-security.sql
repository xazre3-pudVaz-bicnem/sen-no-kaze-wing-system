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
  c_l1 constant uuid := '00000000-0000-4000-8000-00000000c0cc';
  r_l1 constant uuid := '00000000-0000-4000-8000-00000000e0cc';
  q_lp constant uuid := '00000000-0000-4000-8000-00000000f0c1';
  v_model uuid;
  v_notifications_before bigint;
  v_audit_before bigint;
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
  perform pg_temp.expect_eq('7-10 旧形式で承諾済みの第1版（概算）には、担当代理店が互換処理を実行できる', 'true',
    (pg_temp.run_as('authenticated', u_dealer1, format($q$ select public.create_formal_quote_from_accepted_preliminary(%L, '[{"name":"基礎工事","unit_price":300000,"quantity":1}]'::jsonb, 'x')::text $q$, q_lp)) not like 'ERROR %')::text);
  perform pg_temp.expect_eq('7-11 互換処理後も、承諾済みの概算見積（親）は変わらず、確定見積が 1 つ発行される', 'RT-0203:accepted:,RT-0203-2:issued:formal',
    (select string_agg(quote_no || ':' || status || ':' || coalesce(quote_kind, ''), ',' order by quote_no) from public.quotes where quote_request_id = r_l1));
end
$test$;

select coalesce(jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq), '[]'::jsonb) as j
  from _result;

rollback;
