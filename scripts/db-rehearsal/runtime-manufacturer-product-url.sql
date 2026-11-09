-- メーカー公式商品ページの任意 URL（PR #535・20261105100000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 列は NULL 可で、anon・ログインした利用者が読めること（列ごとの読み取り許可。v2.5 PR-C1b）、
-- https・認証情報なし・空白なし・1000 文字以内だけを保存できること、公開中の商品なら anon から URL が読めることを確かめる。
begin;

create temp table _mpu_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _mpu_result to public;

create function pg_temp.mpu_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _mpu_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual is not distinct from p_expected);
$fn$;

-- URL を入れてみる（拒否されたら SQLSTATE を返す。ほかの行は変えない）
create function pg_temp.mpu_try_set(p_option uuid, p_url text) returns text
language plpgsql as $fn$
begin
  update public.options set manufacturer_product_url = p_url where id = p_option;
  return 'ok';
exception when others then
  return format('ERROR %s', sqlstate);
end;
$fn$;

do $mpu$
declare
  v_cat constant uuid := '29350000-0000-4000-8000-000000000001';
  v_opt constant uuid := '29350000-0000-4000-8000-000000000011';
  v_draft constant uuid := '29350000-0000-4000-8000-000000000012';
  v_out text;
begin
  -- ---------- 列と権限 ----------
  select data_type || ',' || is_nullable into v_out
    from information_schema.columns
   where table_schema = 'public' and table_name = 'options' and column_name = 'manufacturer_product_url';
  perform pg_temp.mpu_expect_eq('MPU-1 列は text・NULL 可', 'text,YES', v_out);

  perform pg_temp.mpu_expect_eq('MPU-2 anon・authenticated・service_role が列を読める（列ごとの読み取り許可）', 'anon=true,authenticated=true,service_role=true',
    format('anon=%s,authenticated=%s,service_role=%s',
      has_column_privilege('anon', 'public.options', 'manufacturer_product_url', 'SELECT')::text,
      has_column_privilege('authenticated', 'public.options', 'manufacturer_product_url', 'SELECT')::text,
      has_column_privilege('service_role', 'public.options', 'manufacturer_product_url', 'SELECT')::text));

  -- 商品価格の列は今までどおり anon・authenticated から読めない（この migration で広げていない）
  perform pg_temp.mpu_expect_eq('MPU-3 商品価格の列は anon・authenticated から読めないまま', 'anon=false,authenticated=false',
    format('anon=%s,authenticated=%s',
      has_column_privilege('anon', 'public.options', 'price', 'SELECT')::text,
      has_column_privilege('authenticated', 'public.options', 'price', 'SELECT')::text));

  select count(*)::text into v_out from public.options where manufacturer_product_url is not null;
  perform pg_temp.mpu_expect_eq('MPU-4 既存の商品はすべて NULL（値を入れない）', '0', v_out);

  -- ---------- 保存できる値・できない値 ----------
  insert into public.option_categories (id, code, name, status) values (v_cat, 'runtime-mpu', 'MPU 検査', 'published');
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation)
  values (v_opt, v_cat, 'runtime-mpu-1', 'MPU 公開中の商品', 10000, false, 'published', 'PRD-935001', false),
         (v_draft, v_cat, 'runtime-mpu-2', 'MPU 下書きの商品', 10000, false, 'draft', 'PRD-935002', false);

  perform pg_temp.mpu_expect_eq('MPU-10 https のメーカーの商品ページ', 'ok', pg_temp.mpu_try_set(v_opt, 'https://www.lixil.co.jp/lineup/entrance/giesta/'));
  perform pg_temp.mpu_expect_eq('MPU-11 パスの @・クエリ・フラグメントは使える', 'ok', pg_temp.mpu_try_set(v_opt, 'https://example.com/@maker/product?color=white#spec'));
  perform pg_temp.mpu_expect_eq('MPU-12 スキームの大文字（アプリの検査と同じく通す）', 'ok', pg_temp.mpu_try_set(v_opt, 'HTTPS://WWW.EXAMPLE.COM/P'));
  perform pg_temp.mpu_expect_eq('MPU-13 ポート番号つき', 'ok', pg_temp.mpu_try_set(v_opt, 'https://example.com:8443/products/1'));
  perform pg_temp.mpu_expect_eq('MPU-14 ちょうど 1000 文字', 'ok', pg_temp.mpu_try_set(v_opt, 'https://example.com/' || repeat('a', 1000 - char_length('https://example.com/'))));
  perform pg_temp.mpu_expect_eq('MPU-15 NULL に戻せる', 'ok', pg_temp.mpu_try_set(v_opt, null));

  perform pg_temp.mpu_expect_eq('MPU-20 http は拒否', 'ERROR 23514', pg_temp.mpu_try_set(v_opt, 'http://www.example.com/'));
  perform pg_temp.mpu_expect_eq('MPU-21 認証情報つき（user:pass@）は拒否', 'ERROR 23514', pg_temp.mpu_try_set(v_opt, 'https://user:pass@www.example.com/'));
  perform pg_temp.mpu_expect_eq('MPU-22 ユーザー名だけ（user@）も拒否', 'ERROR 23514', pg_temp.mpu_try_set(v_opt, 'https://user@www.example.com/'));
  perform pg_temp.mpu_expect_eq('MPU-23 空白を含む URL は拒否', 'ERROR 23514', pg_temp.mpu_try_set(v_opt, 'https://www.example.com/a b'));
  perform pg_temp.mpu_expect_eq('MPU-24 javascript: は拒否', 'ERROR 23514', pg_temp.mpu_try_set(v_opt, 'javascript:alert(1)'));
  perform pg_temp.mpu_expect_eq('MPU-25 ホストの無い https:// は拒否', 'ERROR 23514', pg_temp.mpu_try_set(v_opt, 'https://'));
  perform pg_temp.mpu_expect_eq('MPU-26 1001 文字は拒否', 'ERROR 23514', pg_temp.mpu_try_set(v_opt, 'https://example.com/' || repeat('a', 1001 - char_length('https://example.com/'))));
  perform pg_temp.mpu_expect_eq('MPU-27 拒否した後も値は前のまま（NULL）', null, (select manufacturer_product_url from public.options where id = v_opt));
  -- ASCII の範囲だけを通す（DB とアプリで解釈が分かれないように。日本語のパスはアプリが %エンコードしてから保存する）
  perform pg_temp.mpu_expect_eq('MPU-28 ASCII でない文字（ノーブレークスペース・日本語）・ホストの記号（<・%）は拒否し、%エンコードした形は通す',
    'ERROR 23514/ERROR 23514/ERROR 23514/ERROR 23514/ok',
    pg_temp.mpu_try_set(v_opt, 'https://www.example.com/a' || chr(160) || 'b') || '/' ||
    pg_temp.mpu_try_set(v_opt, 'https://www.example.co.jp/商品') || '/' ||
    pg_temp.mpu_try_set(v_opt, 'https://exa<mple.com/p') || '/' ||
    pg_temp.mpu_try_set(v_opt, 'https://a%40b/') || '/' ||
    pg_temp.mpu_try_set(v_opt, 'https://www.example.co.jp/%E5%95%86%E5%93%81'));
  perform pg_temp.mpu_try_set(v_opt, null);

  -- ---------- 本番の保存の経路：ログインした本部が PostgREST から UPDATE … RETURNING（列の読み取りの許可が要る。#619 と同じ形） ----------
  insert into auth.users (id, email, raw_user_meta_data) values ('29350000-0000-4000-8000-000000000101', 'mpu-admin@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code) values ('29350000-0000-4000-8000-000000000101', 'mpu-admin@runtime.invalid', 'MPU 本部', 'admin')
    on conflict (id) do update set role_code = 'admin';
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', '29350000-0000-4000-8000-000000000101')::text, true);
  set local role authenticated;
  begin
    update public.options set manufacturer_product_url = 'https://www.example.com/products/admin', price = 10000
     where id = v_opt returning manufacturer_product_url into v_out;
  exception when others then
    v_out := format('ERROR %s %s', sqlstate, sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.mpu_expect_eq('MPU-29 本部：ログインした利用者の保存（UPDATE で金額も書き、URL を返す）が通る', 'https://www.example.com/products/admin', v_out);
  perform pg_temp.mpu_try_set(v_opt, null);

  -- ---------- 公開中の商品は anon から URL が読める（下書きは読めない。options の RLS は変えていない） ----------
  perform pg_temp.mpu_try_set(v_opt, 'https://www.example.com/products/wing');
  perform pg_temp.mpu_try_set(v_draft, 'https://www.example.com/products/draft');
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  select string_agg(coalesce(manufacturer_product_url, '(null)'), ',' order by code) into v_out
    from public.options where id in (v_opt, v_draft);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.mpu_expect_eq('MPU-30 anon は公開中の商品の URL だけ読める', 'https://www.example.com/products/wing', v_out);
end;
$mpu$;

select coalesce(json_agg(json_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq), '[]'::json) as j
  from _mpu_result;

rollback;
