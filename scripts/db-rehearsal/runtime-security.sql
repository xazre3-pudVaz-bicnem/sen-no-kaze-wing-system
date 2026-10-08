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
end
$test$;

select coalesce(jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq), '[]'::jsonb) as j
  from _result;

rollback;
