-- 登録済み商品の追加画像・メーカー資料PDFの一括反映（PR #563・20261105110000 の apply_option_media_changes）の実行時検査。
-- 使い捨て DB 専用。最後に rollback する。
-- 権限（未ログイン・お客様・持ち主でない代理店は拒否、本部・旧フリー商品の持ち主の代理店は反映できる）、画面を開いた時点の状態の照合、
-- Storage の置き場所とファイルの存在の確認、削除・変更・追加・資料の差し替えと解除の一括反映、途中で失敗したときに何も変わらないこと、
-- 履歴、参照されなくなったファイルの一覧、枚数の上限を確かめる。
begin;

create temp table _omc_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _omc_result to public;

create function pg_temp.omc_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.omc_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _omc_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual is not distinct from p_expected);
$fn$;

create function pg_temp.omc_expect_error(p_step text, p_code text, p_prefix text, p_actual text) returns void
language sql as $fn$
  insert into _omc_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_prefix || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_prefix || '%');
$fn$;

-- 今の状態を、画面が送る「開いた時点の状態」の形にする
create function pg_temp.omc_expected(p_option uuid) returns jsonb
language sql as $fn$
  select jsonb_build_object(
    'gallery', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'caption', i.caption, 'sort_order', i.sort_order) order by i.sort_order, i.id)
                           from public.option_images i where i.option_id = p_option), '[]'::jsonb),
    'manufacturer_document_url', (select o.manufacturer_document_url from public.options o where o.id = p_option));
$fn$;

create function pg_temp.omc_call(p_option uuid, p_expected jsonb, p_changes jsonb) returns text
language sql as $fn$
  select format('select public.apply_option_media_changes(%L::uuid, %L::jsonb, %L::jsonb)::text', p_option, p_expected, p_changes);
$fn$;

-- 追加画像の行を「説明|表示順」の並び（表示順・id の順）で返す
create function pg_temp.omc_gallery(p_option uuid) returns text
language sql as $fn$
  select coalesce(string_agg(coalesce(i.caption, '(null)') || '|' || i.sort_order, ',' order by i.sort_order, i.id), '(none)')
    from public.option_images i where i.option_id = p_option;
$fn$;

do $omc$
declare
  u_admin constant uuid := '7e000000-0000-4000-8000-000000000001';
  u_dealer constant uuid := '7e000000-0000-4000-8000-000000000002';
  u_dealer2 constant uuid := '7e000000-0000-4000-8000-000000000003';
  u_cust constant uuid := '7e000000-0000-4000-8000-000000000004';
  c_items constant uuid := '7e200000-0000-4000-8000-000000000001';
  o_hq constant uuid := '7e300000-0000-4000-8000-000000000001';
  o_free constant uuid := '7e300000-0000-4000-8000-000000000002';
  o_other constant uuid := '7e300000-0000-4000-8000-000000000003';
  i_1 constant uuid := '7e400000-0000-4000-8000-000000000001';
  i_2 constant uuid := '7e400000-0000-4000-8000-000000000002';
  c_base constant text := 'https://runtime.supabase.co/storage/v1/object/public/';
  v_free_cat uuid;
  v_img text;
  v_doc text;
  v_out text;
  v_changes jsonb;
  v_stale jsonb;
  v_many jsonb := '[]'::jsonb;
begin
  v_img := c_base || 'product-images/option-' || o_hq || '/gallery/';
  v_doc := c_base || 'product-documents/option-' || o_hq || '/manufacturer/';

  -- ---------- 検査用のデータ ----------
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'omc-admin@runtime.invalid', '{}'), (u_dealer, 'omc-dealer@runtime.invalid', '{}'),
         (u_dealer2, 'omc-dealer2@runtime.invalid', '{}'), (u_cust, 'omc-cust@runtime.invalid', '{}');
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'omc-admin@runtime.invalid', '本部', 'admin'), (u_dealer, 'omc-dealer@runtime.invalid', '代理店', 'dealer'),
         (u_dealer2, 'omc-dealer2@runtime.invalid', '別の代理店', 'dealer'), (u_cust, 'omc-cust@runtime.invalid', 'お客様', 'customer')
  on conflict (id) do update set role_code = excluded.role_code, full_name = excluded.full_name;

  insert into public.option_categories (id, code, name, status) values (c_items, 'runtime-omc-items', 'OMC 設備', 'published');
  select id into v_free_cat from public.option_categories where code = 'free-product';
  if v_free_cat is null then
    v_free_cat := '7e200000-0000-4000-8000-000000000002';
    insert into public.option_categories (id, code, name, status) values (v_free_cat, 'free-product', 'フリー商品', 'published');
  end if;
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation, owner_id)
  values (o_hq, c_items, 'runtime-omc-hq', 'OMC 本部商品', 10000, false, 'published', 'PRD-936001', false, null),
         (o_free, v_free_cat, 'runtime-omc-free', 'OMC フリー商品', 5000, false, 'published', 'PRD-936002', false, u_dealer),
         (o_other, c_items, 'runtime-omc-other', 'OMC ほかの商品', 10000, false, 'published', 'PRD-936003', false, null);
  insert into storage.objects (bucket_id, name, metadata)
  values ('product-images', 'option-' || o_hq || '/gallery/img1.png', '{"mimetype":"image/png","size":100}'),
         ('product-images', 'option-' || o_hq || '/gallery/img2.png', '{"mimetype":"image/png","size":100}'),
         ('product-images', 'option-' || o_hq || '/gallery/new1.webp', '{"mimetype":"image/webp","size":100}'),
         ('product-images', 'option-' || o_hq || '/gallery/new2.png', '{"mimetype":"image/png","size":100}'),
         ('product-images', 'option-' || o_other || '/gallery/other.png', '{"mimetype":"image/png","size":100}'),
         ('product-images', 'option-' || o_free || '/gallery/free1.png', '{"mimetype":"image/png","size":100}'),
         ('product-documents', 'option-' || o_hq || '/manufacturer/doc1.pdf', '{"mimetype":"application/pdf","size":100}'),
         ('product-documents', 'option-' || o_hq || '/manufacturer/doc2.pdf', '{"mimetype":"application/pdf","size":100}'),
         ('product-images', 'option-' || o_hq || '/gallery/fake.png', '{"mimetype":"text/html","size":100}'),
         ('product-images', 'option-' || o_hq || '/gallery/huge.png', '{"mimetype":"image/png","size":10485761}'),
         ('product-documents', 'option-' || o_hq || '/manufacturer/fake.pdf', '{"mimetype":"image/png","size":100}');
  insert into public.option_images (id, option_id, url, alt, caption, sort_order)
  values (i_1, o_hq, v_img || 'img1.png', 'OMC', '正面', 10),
         (i_2, o_hq, v_img || 'img2.png', 'OMC', null, 20);
  update public.options set manufacturer_document_url = v_doc || 'doc1.pdf' where id = o_hq;

  -- ---------- 関数の作り ----------
  perform pg_temp.omc_expect_eq('OMC-1 SECURITY DEFINER・search_path は空・authenticated だけが実行できる',
    'secdef=true,path=search_path="",authenticated=true,anon=false,public=false',
    (select format('secdef=%s,path=%s,authenticated=%s,anon=%s,public=%s',
                   p.prosecdef::text, array_to_string(p.proconfig, ';'),
                   has_function_privilege('authenticated', p.oid, 'EXECUTE')::text,
                   has_function_privilege('anon', p.oid, 'EXECUTE')::text,
                   coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE'), false)::text)
       from pg_proc p where p.oid = 'public.apply_option_media_changes(uuid, jsonb, jsonb)'::regprocedure));

  -- ---------- 権限 ----------
  v_changes := jsonb_build_object('update', jsonb_build_array(jsonb_build_object('id', i_1, 'caption', '変更', 'sort_order', 10)));
  perform pg_temp.omc_expect_error('OMC-2 未ログイン（anon）は実行できない', '42501', 'permission denied',
    pg_temp.omc_run_as('anon', null, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq), v_changes)));
  perform pg_temp.omc_expect_error('OMC-3 お客様は拒否', 'P0001', 'FORBIDDEN',
    pg_temp.omc_run_as('authenticated', u_cust, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq), v_changes)));
  perform pg_temp.omc_expect_error('OMC-4 代理店は本部商品を変えられない', 'P0001', 'FORBIDDEN',
    pg_temp.omc_run_as('authenticated', u_dealer, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq), v_changes)));
  perform pg_temp.omc_expect_error('OMC-5 持ち主でない代理店は旧フリー商品を変えられない', 'P0001', 'FORBIDDEN',
    pg_temp.omc_run_as('authenticated', u_dealer2, pg_temp.omc_call(o_free, pg_temp.omc_expected(o_free),
      jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', c_base || 'product-images/option-' || o_free || '/gallery/free1.png', 'sort_order', 0))))));
  perform pg_temp.omc_expect_error('OMC-6 無い商品は NOT_FOUND', 'P0001', 'NOT_FOUND',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call('7e3fffff-0000-4000-8000-000000000009', '{"gallery":[]}', '{}')));
  perform pg_temp.omc_expect_eq('OMC-7 拒否の後も追加画像は変わらない', '正面|10,(null)|20', pg_temp.omc_gallery(o_hq));

  -- ---------- 画面を開いた時点の状態の照合 ----------
  v_stale := jsonb_set(pg_temp.omc_expected(o_hq), '{gallery,0,caption}', '"開いた後に変わる前の説明"');
  perform pg_temp.omc_expect_error('OMC-10 追加画像の説明が開いた後に変わっていたら CONFLICT', 'P0001', 'CONFLICT',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, v_stale, v_changes)));
  v_stale := jsonb_set(pg_temp.omc_expected(o_hq), '{gallery}', (pg_temp.omc_expected(o_hq) -> 'gallery') - 1);
  perform pg_temp.omc_expect_error('OMC-11 追加画像が開いた後に増えていたら CONFLICT', 'P0001', 'CONFLICT',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, v_stale, v_changes)));
  v_stale := jsonb_set(pg_temp.omc_expected(o_hq), '{manufacturer_document_url}', 'null');
  perform pg_temp.omc_expect_error('OMC-12 メーカー資料が開いた後に変わっていたら CONFLICT', 'P0001', 'CONFLICT',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, v_stale, v_changes)));
  perform pg_temp.omc_expect_error('OMC-13 開いた時点の状態が無いときは VALIDATION', 'P0001', 'VALIDATION',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, '{}', v_changes)));

  -- ---------- 置き場所とファイルの確認（どれも何も変えない） ----------
  perform pg_temp.omc_expect_error('OMC-20 ほかの商品のフォルダーの画像は紐付けない', 'P0001', 'VALIDATION: 追加画像の置き場所',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', c_base || 'product-images/option-' || o_other || '/gallery/other.png', 'sort_order', 30))))));
  perform pg_temp.omc_expect_error('OMC-21 Storage に無いファイルは紐付けない', 'P0001', 'VALIDATION: 追加画像のファイルが見つかりません',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', v_img || 'missing.png', 'sort_order', 30))))));
  perform pg_temp.omc_expect_error('OMC-22 資料のバケットの URL を追加画像にしない', 'P0001', 'VALIDATION: 追加画像の置き場所',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', v_doc || 'doc2.pdf', 'sort_order', 30))))));
  perform pg_temp.omc_expect_error('OMC-23 下の階層・上の階層を含むパスは紐付けない', 'P0001', 'VALIDATION: 追加画像の置き場所',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', v_img || '../gallery/new1.webp', 'sort_order', 30))))));
  perform pg_temp.omc_expect_error('OMC-24 メーカー資料はその商品の PDF だけ', 'P0001', 'VALIDATION: メーカー資料の置き場所',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('document', jsonb_build_object('action', 'replace', 'url', c_base || 'product-documents/option-' || o_other || '/manufacturer/doc2.pdf')))));
  perform pg_temp.omc_expect_error('OMC-25 今と同じメーカー資料への差し替えは VALIDATION', 'P0001', 'VALIDATION: 今と同じ',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('document', jsonb_build_object('action', 'replace', 'url', v_doc || 'doc1.pdf')))));
  perform pg_temp.omc_expect_error('OMC-26 表示順が範囲の外なら VALIDATION', 'P0001', 'VALIDATION: 追加画像の表示順',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('update', jsonb_build_array(jsonb_build_object('id', i_1, 'caption', '正面', 'sort_order', 100001))))));
  perform pg_temp.omc_expect_error('OMC-27 説明が 200 文字を超えたら VALIDATION', 'P0001', 'VALIDATION: 追加画像の説明',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('update', jsonb_build_array(jsonb_build_object('id', i_1, 'caption', repeat('あ', 201), 'sort_order', 10))))));
  perform pg_temp.omc_expect_error('OMC-28 同じ画像を 2 回削除しようとしたら VALIDATION', 'P0001', 'VALIDATION',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('delete', jsonb_build_array(i_2, i_2)))));
  perform pg_temp.omc_expect_error('OMC-29 ほかの商品の追加画像は削除できない', 'P0001', 'VALIDATION: 削除する追加画像が見つかりません',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_other, pg_temp.omc_expected(o_other),
      jsonb_build_object('delete', jsonb_build_array(i_2)))));

  perform pg_temp.omc_expect_error('OMC-33 Storage が画像以外と記録したファイルは追加画像にしない', 'P0001', 'VALIDATION: 追加画像は JPEG',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', v_img || 'fake.png', 'sort_order', 30))))));
  perform pg_temp.omc_expect_error('OMC-34 10MB を超える画像は追加画像にしない', 'P0001', 'VALIDATION: 追加画像は JPEG',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', v_img || 'huge.png', 'sort_order', 30))))));
  perform pg_temp.omc_expect_error('OMC-35 Storage が PDF 以外と記録したファイルはメーカー資料にしない', 'P0001', 'VALIDATION: メーカー資料は 20MB 以下の PDF',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('document', jsonb_build_object('action', 'replace', 'url', v_doc || 'fake.pdf')))));

  -- ---------- 途中で失敗したら何も変わらない（削除と変更の後に、紐付けられない追加がある） ----------
  perform pg_temp.omc_expect_error('OMC-30 削除・変更の後の追加が拒否されると、全体を取り消す', 'P0001', 'VALIDATION: 追加画像のファイルが見つかりません',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('delete', jsonb_build_array(i_2),
                         'update', jsonb_build_array(jsonb_build_object('id', i_1, 'caption', '取り消される説明', 'sort_order', 1)),
                         'add', jsonb_build_array(jsonb_build_object('url', v_img || 'missing.png', 'sort_order', 30))))));
  perform pg_temp.omc_expect_eq('OMC-31 取り消した後も追加画像・メーカー資料は前のまま', '正面|10,(null)|20 / doc1.pdf',
    pg_temp.omc_gallery(o_hq) || ' / ' || (select regexp_replace(manufacturer_document_url, '^.*/', '') from public.options where id = o_hq));
  perform pg_temp.omc_expect_eq('OMC-32 拒否・取り消しでは履歴を残さない', '0',
    (select count(*)::text from public.audit_logs where entity = 'option' and entity_id = o_hq and action = 'media'));

  -- ---------- 一括反映（削除・説明と表示順の変更・追加・資料の差し替え） ----------
  v_out := pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
    jsonb_build_object(
      'delete', jsonb_build_array(i_2),
      'update', jsonb_build_array(jsonb_build_object('id', i_1, 'caption', '  正面（新）  ', 'sort_order', 5)),
      'add', jsonb_build_array(jsonb_build_object('url', v_img || 'new1.webp', 'caption', '側面', 'sort_order', 30, 'alt', '')),
      'document', jsonb_build_object('action', 'replace', 'url', v_doc || 'doc2.pdf'))));
  perform pg_temp.omc_expect_eq('OMC-40 本部は一括で反映できる（説明の前後の空白は除く）', '正面（新）|5,側面|30', pg_temp.omc_gallery(o_hq));
  perform pg_temp.omc_expect_eq('OMC-41 メーカー資料は新しい PDF', 'doc2.pdf',
    (select regexp_replace(manufacturer_document_url, '^.*/', '') from public.options where id = o_hq));
  perform pg_temp.omc_expect_eq('OMC-42 参照されなくなったファイル（削除した画像・前の資料）を返す', 'img2.png,doc1.pdf',
    (select string_agg(regexp_replace(u, '^.*/', ''), ',' order by n) from jsonb_array_elements_text(v_out::jsonb -> 'unreferenced_urls') with ordinality as t(u, n)));
  perform pg_temp.omc_expect_eq('OMC-43 返す追加画像は表示順', '正面（新）,側面',
    (select string_agg(g ->> 'caption', ',' order by n) from jsonb_array_elements(v_out::jsonb -> 'gallery') with ordinality as t(g, n)));
  perform pg_temp.omc_expect_eq('OMC-44 追加した画像の代替テキストは空なら商品名', 'OMC 本部商品',
    (select alt from public.option_images where option_id = o_hq and url = v_img || 'new1.webp'));
  perform pg_temp.omc_expect_eq('OMC-45 履歴を 1 件残す（本部の操作・変更の数）',
    '1|' || u_admin || '|追加画像・メーカー資料を変更：OMC 本部商品（追加画像 削除 1・変更 1・追加 1／メーカー資料 差し替え）',
    (select count(*)::text || '|' || max(actor_id::text) || '|' || max(summary) from public.audit_logs where entity = 'option' and entity_id = o_hq and action = 'media'));
  perform pg_temp.omc_expect_eq('OMC-46 Storage のファイルは消さない（削除はアプリが反映の成功後に行う）', '11',
    (select count(*)::text from storage.objects where name like 'option-7e300000-%'));

  -- ---------- 資料の解除・同じファイルの重複・枚数の上限 ----------
  v_out := pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
    jsonb_build_object('document', jsonb_build_object('action', 'remove'))));
  perform pg_temp.omc_expect_eq('OMC-50 メーカー資料を解除でき、前の資料を参照されなくなったファイルとして返す', 'null|doc2.pdf',
    coalesce((select manufacturer_document_url from public.options where id = o_hq), 'null') || '|' ||
    (select string_agg(regexp_replace(u, '^.*/', ''), ',') from jsonb_array_elements_text(v_out::jsonb -> 'unreferenced_urls') u));
  perform pg_temp.omc_expect_error('OMC-51 登録されていない資料の解除は VALIDATION', 'P0001', 'VALIDATION: メーカー資料は登録されていません',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('document', jsonb_build_object('action', 'remove')))));
  perform pg_temp.omc_expect_error('OMC-52 登録済みのファイルをもう一度紐付けない', 'P0001', 'VALIDATION: 同じ画像ファイル',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', v_img || 'new1.webp', 'sort_order', 40))))));
  for n in 1..29 loop
    insert into storage.objects (bucket_id, name, metadata)
    values ('product-images', 'option-' || o_hq || '/gallery/bulk' || n || '.png', '{"mimetype":"image/png","size":100}');
    v_many := v_many || jsonb_build_array(jsonb_build_object('url', v_img || 'bulk' || n || '.png', 'sort_order', 100 + n));
  end loop;
  perform pg_temp.omc_expect_error('OMC-53 追加画像は 1 商品 30 枚まで（31 枚目で全体を取り消す）', 'P0001', 'VALIDATION: 追加画像は 1 商品 30 枚まで',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq), jsonb_build_object('add', v_many))));
  perform pg_temp.omc_expect_eq('OMC-54 上限で取り消した後は 2 枚のまま', '2',
    (select count(*)::text from public.option_images where option_id = o_hq));

  -- メイン画像にも使っているファイルは、追加画像から外しても「参照されなくなったファイル」に入れない（アプリが消さない）
  perform pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
    jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', v_img || 'new2.png', 'sort_order', 40)))));
  update public.options set image_url = v_img || 'new2.png' where id = o_hq;
  v_out := pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
    jsonb_build_object('delete', (select jsonb_agg(id) from public.option_images where option_id = o_hq and url = v_img || 'new2.png'))));
  perform pg_temp.omc_expect_eq('OMC-55 メイン画像にも使っているファイルは消す対象にしない', '2|(none)',
    (select count(*)::text from public.option_images where option_id = o_hq) || '|' ||
    coalesce((select string_agg(u, ',') from jsonb_array_elements_text(v_out::jsonb -> 'unreferenced_urls') u), '(none)'));

  -- ---------- 置き場所のホスト・同じファイルの判定（独立レビューの指摘） ----------
  insert into storage.objects (bucket_id, name, metadata)
  values ('product-images', 'option-' || o_hq || '/gallery/host1.png', '{"mimetype":"image/png","size":100}');
  perform pg_temp.omc_expect_error('OMC-36 Supabase 以外のホストの URL は、置き場所のパスが正しくても紐付けない', 'P0001', 'VALIDATION: 追加画像の置き場所が正しくありません',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url',
        'https://evil.example/storage/v1/object/public/product-images/option-' || o_hq || '/gallery/host1.png', 'sort_order', 60))))));
  perform pg_temp.omc_expect_error('OMC-37 ホストの書き方が違っても、同じファイル（置き場所）を 2 行に紐付けない', 'P0001', 'VALIDATION: 同じ画像ファイル',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
      jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url',
        'https://other.supabase.co/storage/v1/object/public/product-images/option-' || o_hq || '/gallery/img1.png', 'sort_order', 60))))));
  -- 別のホストの URL で同じファイルを使っている行があれば、削除しても「参照されなくなったファイル」に入れない
  perform pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
    jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', v_img || 'host1.png', 'sort_order', 60)))));
  update public.options set image_url = 'https://other.supabase.co/storage/v1/object/public/product-images/option-' || o_hq || '/gallery/host1.png' where id = o_hq;
  v_out := pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_hq, pg_temp.omc_expected(o_hq),
    jsonb_build_object('delete', (select jsonb_agg(id) from public.option_images where option_id = o_hq and url = v_img || 'host1.png'))));
  perform pg_temp.omc_expect_eq('OMC-38 使っているかは置き場所で比べる（別のホストの URL のメイン画像が使うファイルは消す対象にしない）', '2|(none)',
    (select count(*)::text from public.option_images where option_id = o_hq) || '|' ||
    coalesce((select string_agg(u, ',') from jsonb_array_elements_text(v_out::jsonb -> 'unreferenced_urls') u), '(none)'));

  -- ---------- 上限を超えている既存の商品（旧来の画面で 31 枚以上になったもの） ----------
  for n in 1..31 loop
    insert into public.option_images (option_id, url, alt, caption, sort_order)
    values (o_other, c_base || 'product-images/option-' || o_other || '/gallery/old' || n || '.png', 'OMC', null, 200 + n);
  end loop;
  v_out := pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_other, pg_temp.omc_expected(o_other),
    jsonb_build_object('update', jsonb_build_array(jsonb_build_object(
      'id', (select id from public.option_images where option_id = o_other order by sort_order limit 1), 'caption', '説明だけ', 'sort_order', 201)))));
  perform pg_temp.omc_expect_eq('OMC-56 上限を超えている商品でも、枚数を増やさない変更（説明・表示順）はできる', '31|説明だけ',
    (select count(*)::text from public.option_images where option_id = o_other) || '|' ||
    coalesce((select caption from public.option_images where option_id = o_other and caption = '説明だけ'), v_out));
  insert into storage.objects (bucket_id, name, metadata)
  values ('product-images', 'option-' || o_other || '/gallery/more.png', '{"mimetype":"image/png","size":100}');
  perform pg_temp.omc_expect_error('OMC-57 上限を超えている商品に、さらに足すことはできない', 'P0001', 'VALIDATION: 追加画像は 1 商品 30 枚まで',
    pg_temp.omc_run_as('authenticated', u_admin, pg_temp.omc_call(o_other, pg_temp.omc_expected(o_other),
      jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', c_base || 'product-images/option-' || o_other || '/gallery/more.png', 'sort_order', 300))))));

  -- ---------- 旧フリー商品の持ち主の代理店 ----------
  perform pg_temp.omc_run_as('authenticated', u_dealer, pg_temp.omc_call(o_free, pg_temp.omc_expected(o_free),
    jsonb_build_object('add', jsonb_build_array(jsonb_build_object('url', c_base || 'product-images/option-' || o_free || '/gallery/free1.png', 'caption', '自社', 'sort_order', 0)))));
  perform pg_temp.omc_expect_eq('OMC-60 旧フリー商品の持ち主の代理店は反映できる', '自社|0', pg_temp.omc_gallery(o_free));
end;
$omc$;

select coalesce(json_agg(json_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq), '[]'::json) as j
  from _omc_result;

rollback;
