-- A-3（2026-11-04 の先方回答）：別途工事 9 品目の削除（remove_sitework_catalog）と、見積の初期明細（quote_initial_lines）の実行時検査。
-- 使い捨てDB専用。最後に rollback する。
begin;

create temp table _a3_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _a3_result to public;

create function pg_temp.a3_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.a3_try(p_sql text) returns text
language plpgsql as $fn$
declare
  v_out text;
begin
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  return coalesce(v_out, '(null)');
end;
$fn$;

create function pg_temp.a3_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _a3_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.a3_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _a3_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || '%');
$fn$;

-- 対象の集合の照合値（ID の昇順・カンマ区切りの md5）
create function pg_temp.a3_expected(p_cfg uuid[], p_req uuid[], p_quote uuid[]) returns jsonb
language sql as $fn$
  select jsonb_build_object(
    'configurations', jsonb_build_object('count', cardinality(p_cfg), 'md5', md5(coalesce((select string_agg(x::text, ',' order by x) from unnest(p_cfg) x), ''))),
    'quote_requests', jsonb_build_object('count', cardinality(p_req), 'md5', md5(coalesce((select string_agg(x::text, ',' order by x) from unnest(p_req) x), ''))),
    'quotes', jsonb_build_object('count', cardinality(p_quote), 'md5', md5(coalesce((select string_agg(x::text, ',' order by x) from unnest(p_quote) x), ''))));
$fn$;

-- 行（jsonb）から、写しの表にある列だけを残して文字列にする
create function pg_temp.a3_archived_columns(p_row jsonb, p_table text) returns text
language sql as $fn$
  select coalesce(jsonb_object_agg(k, p_row -> k), '{}'::jsonb)::text
    from pg_attribute a
    cross join lateral (select a.attname::text as k) c
   where a.attrelid = to_regclass('archive_a3_20261104.' || p_table) and a.attnum > 0 and not a.attisdropped;
$fn$;

do $test$
declare
  u_cust constant uuid := '2a400000-0000-4000-8000-000000000001';
  u_dealer constant uuid := '2a400000-0000-4000-8000-000000000002';
  m_model constant uuid := '2a400000-0000-4000-8000-000000000101';
  cat_sw constant uuid := '2a400000-0000-4000-8000-000000000201';
  cat_keep constant uuid := '2a400000-0000-4000-8000-000000000202';
  o_keep constant uuid := '2a400000-0000-4000-8000-000000000300';
  o_extra constant uuid := '2a400000-0000-4000-8000-000000000310';
  c_draft constant uuid := '2a400000-0000-4000-8000-000000000401';
  c_req constant uuid := '2a400000-0000-4000-8000-000000000402';
  c_keep constant uuid := '2a400000-0000-4000-8000-000000000403';
  r_req constant uuid := '2a400000-0000-4000-8000-000000000501';
  r_manual constant uuid := '2a400000-0000-4000-8000-000000000502';
  q_req constant uuid := '2a400000-0000-4000-8000-000000000601';
  d_manual constant uuid := '2a400000-0000-4000-8000-000000000701';
  d_block constant uuid := '2a400000-0000-4000-8000-000000000702';
  v_codes constant text[] := array['sw-transport', 'sw-design-permit', 'sw-packing', 'sw-site-install', 'sw-electric',
                                    'sw-plumbing', 'sw-foundation', 'sw-disposal', 'sw-site-expense'];
  v_expected jsonb;
  v_out text;
  v_before text;
  v_archive text;
  v_table text;
  v_cols text;
  i integer;
begin
  -- ---------- migration の作り ----------
  perform pg_temp.a3_expect_eq('A3-0 初期明細は 9 種類の工事（削除する 9 品目の名前・並び順のまま）',
    '運送費/設計監理及び確認申請費/梱包養生/現場設置工事/電気設備工事/給排水給湯設備工事/基礎工事（設置後工事）/廃材処分費/別途現場諸費用',
    (select string_agg(l.name, '/' order by l.sort_order) from public.quote_initial_lines l where l.section_code = 'sitework' and l.is_active));
  perform pg_temp.a3_expect_eq('A3-0b 削除の関数は API のロールから実行できず、写しの場所は API のロールから使えない', 'false/false/false/false/false/false',
    has_function_privilege('anon', 'public.remove_sitework_catalog(jsonb)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.remove_sitework_catalog(jsonb)', 'EXECUTE')::text || '/' ||
    has_function_privilege('service_role', 'public.remove_sitework_catalog(jsonb)', 'EXECUTE')::text || '/' ||
    has_schema_privilege('anon', 'archive_a3_20261104', 'USAGE')::text || '/' ||
    has_schema_privilege('authenticated', 'archive_a3_20261104', 'USAGE')::text || '/' ||
    has_schema_privilege('service_role', 'archive_a3_20261104', 'USAGE')::text);
  perform pg_temp.a3_expect_eq('A3-1 9 品目の無い DB では何もしない', '{"skipped": true}',
    public.remove_sitework_catalog('{}'::jsonb)::text);

  -- ---------- 検査データ ----------
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_cust, 'a3-cust@runtime.invalid', '{}'::jsonb), (u_dealer, 'a3-dealer@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values (u_cust, 'a3-cust@runtime.invalid', 'A3 お客様', 'customer'), (u_dealer, 'a3-dealer@runtime.invalid', 'A3 代理店', 'dealer');
  insert into public.base_models (id, slug, name, base_price, status, presets)
  values (m_model, 'runtime-a3-model', 'A3 検査モデル', 1000000, 'published',
          '[{"code":"p1","name":"プラン1","option_codes":["sw-transport","runtime-a3-keep","sw-electric"]},
            {"code":"p2","name":"プラン2","option_codes":["runtime-a3-keep"]}]'::jsonb);
  insert into public.option_categories (id, code, name, status, selection_mode)
  values (cat_sw, 'sitework', '別途工事（現地施工）', 'published', 'multi'), (cat_keep, 'runtime-a3-keep', 'A3 残す', 'published', 'multi');
  for i in 1 .. 9 loop
    insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no, is_installation, is_required, is_default, sort_order)
    values (('2a400000-0000-4000-8000-00000000030' || i)::uuid, cat_sw, v_codes[i], '別途工事 ' || i, 0, true, 'published',
            'PRD-9481' || lpad(i::text, 2, '0'), true, true, true, i);
  end loop;
  insert into public.options (id, category_id, code, name, price, status, product_no, sort_order)
  values (o_keep, cat_keep, 'runtime-a3-keep', 'A3 残す商品', 1000, 'published', 'PRD-948100', 1);
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (c_draft, u_cust, m_model, '下書き（9 品目を含む）', 'draft', 'hotel', 'full'),
         (c_req, u_cust, m_model, '見積依頼済み（9 品目を含む）', 'quote_requested', 'hotel', 'full'),
         (c_keep, u_cust, m_model, '下書き（9 品目を含まない）', 'draft', 'hotel', 'full');
  insert into public.configuration_items (configuration_id, option_id, quantity)
  values (c_draft, '2a400000-0000-4000-8000-000000000301', 1), (c_draft, o_keep, 1),
         (c_req, '2a400000-0000-4000-8000-000000000305', 1), (c_req, '2a400000-0000-4000-8000-000000000301', 1),
         (c_keep, o_keep, 1);
  insert into public.configuration_snapshots (configuration_id, reason, snapshot)
  values (c_req, 'quote_requested', '{"lines":[{"option_id":"2a400000-0000-4000-8000-000000000305"}]}'::jsonb);
  insert into public.quote_requests (id, configuration_id, status, contact)
  values (r_req, c_req, 'new', '{}'::jsonb), (r_manual, null, 'new', '{"full_name":"Web 以外"}'::jsonb);
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, valid_until, customer_name, base_model_name, base_price, option_subtotal,
                             installation_subtotal, subtotal, tax_rate, tax, total, status, quote_kind, base_model_id, spec_code)
  values (q_req, 'RT-A3-Q1', r_req, c_req, now() + interval '30 days', '検査', 'A3 検査モデル', 1000, 0, 0, 1000, 0.10, 100, 1100, 'issued', 'formal', m_model, 'hotel');
  insert into public.quote_items (quote_id, kind, name, unit_price, quantity, amount, sort_order)
  values (q_req, 'base', '本体一式', 1000, 1, 1000, 1), (q_req, 'installation', '運送費', 0, 1, 0, 3001), (q_req, 'installation', '電気設備工事', 0, 1, 0, 3002);
  insert into public.quote_documents (quote_id, storage_path, file_name) values (q_req, 'runtime/a3.pdf', 'a3.pdf');
  insert into public.quote_drafts (id, quote_request_id, base_model_id, spec_code, quote_kind, tax_rate, lock_version, source_kind, finish_level)
  values (d_manual, r_manual, m_model, 'hotel', 'formal', 0.10, 0, 'manual', 'full');
  set local session_replication_role = origin;

  v_expected := pg_temp.a3_expected(array[c_draft, c_req], array[r_req], array[q_req]);
  v_before := (select count(*) from public.configurations)::text || '/' || (select count(*) from public.quote_requests)::text || '/' ||
              (select count(*) from public.quotes)::text || '/' || (select count(*) from public.options where category_id = cat_sw)::text;

  -- ---------- 初期明細の読み取りの権限 ----------
  perform pg_temp.a3_expect_eq('A3-2 初期明細は担当者（代理店）が読め、お客様は読めない（RLS）', '9/0',
    pg_temp.a3_run_as('authenticated', u_dealer, 'select count(*)::text from public.quote_initial_lines') || '/' ||
    pg_temp.a3_run_as('authenticated', u_cust, 'select count(*)::text from public.quote_initial_lines'));
  perform pg_temp.a3_expect_error('A3-2b ログインしていない人は読めない', '42501', 'permission denied',
    pg_temp.a3_run_as('anon', null, 'select count(*)::text from public.quote_initial_lines'));
  perform pg_temp.a3_expect_error('A3-2c 担当者も初期明細を書き換えられない', '42501', 'permission denied',
    pg_temp.a3_run_as('authenticated', u_dealer, $q$ insert into public.quote_initial_lines (section_code, name, sort_order) values ('sitework', '追加', 10) returning 'x' $q$));

  -- ---------- 止める条件（どれも何も消さない） ----------
  perform pg_temp.a3_expect_error('A3-3 対象の照合値が違えば止める', 'P0001', 'A3_STOP: 削除の対象（プラン・見積依頼・見積）が確認のときと違う',
    pg_temp.a3_try(format('select public.remove_sitework_catalog(%L::jsonb)::text', jsonb_set(v_expected, '{quotes,md5}', '"0"'))));
  -- 止める条件の行は、検査データと同じく DB の保護を外して足し引きする（関数は保護を戻してから呼ぶ）
  set local session_replication_role = replica;
  insert into public.quote_por_confirmations (quote_id, selections, confirmed_by) values (q_req, '[{"key":"x"}]'::jsonb, u_dealer);
  set local session_replication_role = origin;
  perform pg_temp.a3_expect_error('A3-4 対象に別途見積の確認の記録がつながっていれば止める', 'P0001', 'A3_STOP: 削除の対象に、契約',
    pg_temp.a3_try(format('select public.remove_sitework_catalog(%L::jsonb)::text', v_expected)));
  set local session_replication_role = replica;
  delete from public.quote_por_confirmations where quote_id = q_req;
  insert into public.quote_drafts (id, quote_request_id, parent_quote_id, base_model_id, spec_code, quote_kind, tax_rate, lock_version, source_kind, finish_level)
  values (d_block, r_req, q_req, m_model, 'hotel', 'formal', 0.10, 0, 'manual', 'full');
  set local session_replication_role = origin;
  perform pg_temp.a3_expect_error('A3-4b 対象から作った見積の下書きがあれば止める', 'P0001', 'A3_STOP: 削除の対象に、契約',
    pg_temp.a3_try(format('select public.remove_sitework_catalog(%L::jsonb)::text', v_expected)));
  set local session_replication_role = replica;
  delete from public.quote_drafts where id = d_block;
  insert into public.options (id, category_id, code, name, price, status, product_no, sort_order)
  values (o_extra, cat_sw, 'runtime-a3-extra', '別途工事のほかの商品', 0, 'published', 'PRD-948110', 10);
  set local session_replication_role = origin;
  perform pg_temp.a3_expect_error('A3-5 別途工事のカテゴリーに 9 品目以外の商品があれば止める', 'P0001', 'A3_STOP: 別途工事のカテゴリーに 9 品目以外の商品',
    pg_temp.a3_try(format('select public.remove_sitework_catalog(%L::jsonb)::text', v_expected)));
  set local session_replication_role = replica;
  delete from public.options where id = o_extra;
  insert into public.guest_plans (token_hash, base_model_id, plan)
  values (repeat('a', 64), m_model, '{"option_ids":["2a400000-0000-4000-8000-000000000302"]}'::jsonb);
  set local session_replication_role = origin;
  perform pg_temp.a3_expect_error('A3-6 ログインなしの一時保存が 9 品目を使っていれば止める', 'P0001', 'A3_STOP: 9 品目が、削除の対象の外',
    pg_temp.a3_try(format('select public.remove_sitework_catalog(%L::jsonb)::text', v_expected)));
  set local session_replication_role = replica;
  delete from public.guest_plans where token_hash = repeat('a', 64);
  set local session_replication_role = origin;
  perform pg_temp.a3_expect_eq('A3-7 止めたときは何も消していない（プラン・見積依頼・見積・9 品目の件数）', v_before,
    (select count(*) from public.configurations)::text || '/' || (select count(*) from public.quote_requests)::text || '/' ||
    (select count(*) from public.quotes)::text || '/' || (select count(*) from public.options where category_id = cat_sw)::text);

  -- ---------- 消す ----------
  v_out := public.remove_sitework_catalog(v_expected)::text;
  perform pg_temp.a3_expect_eq('A3-8 照合値が同じなら消す（プラン 2・見積依頼 1・見積 1・9 品目・標準構成 1 モデル。残す見積依頼・下書きは 1 件ずつ）',
    '2/1/1/9/1/1/1',
    (v_out::jsonb #>> '{removed,configurations,count}') || '/' || (v_out::jsonb #>> '{removed,quote_requests,count}') || '/' ||
    (v_out::jsonb #>> '{removed,quotes,count}') || '/' || (v_out::jsonb ->> 'products') || '/' || (v_out::jsonb ->> 'presets_updated') || '/' ||
    (v_out::jsonb ->> 'kept_quote_requests') || '/' || (v_out::jsonb ->> 'kept_quote_drafts'));
  perform pg_temp.a3_expect_eq('A3-9 消えたもの：9 品目を含むプラン・その見積依頼・見積・明細・PDF の記録・9 品目・カテゴリー', '0/0/0/0/0/0/0/0',
    (select count(*) from public.configurations where id in (c_draft, c_req))::text || '/' ||
    (select count(*) from public.configuration_snapshots where configuration_id = c_req)::text || '/' ||
    (select count(*) from public.quote_requests where id = r_req)::text || '/' ||
    (select count(*) from public.quotes where id = q_req)::text || '/' ||
    (select count(*) from public.quote_items where quote_id = q_req)::text || '/' ||
    (select count(*) from public.quote_documents where quote_id = q_req)::text || '/' ||
    (select count(*) from public.options where code = any(v_codes))::text || '/' ||
    (select count(*) from public.option_categories where code = 'sitework')::text);
  perform pg_temp.a3_expect_eq('A3-10 残すもの：9 品目を含まないプランと明細・Web 以外の見積依頼と下書き・ほかの商品とカテゴリー', '1/1/1/1/1/1',
    (select count(*) from public.configurations where id = c_keep)::text || '/' ||
    (select count(*) from public.configuration_items where configuration_id = c_keep)::text || '/' ||
    (select count(*) from public.quote_requests where id = r_manual)::text || '/' ||
    (select count(*) from public.quote_drafts where id = d_manual)::text || '/' ||
    (select count(*) from public.options where id = o_keep)::text || '/' ||
    (select count(*) from public.option_categories where id = cat_keep)::text);
  perform pg_temp.a3_expect_eq('A3-11 標準構成から 9 品目だけを外す（並びは変えない・9 品目の無いプランは変えない）',
    '["runtime-a3-keep"]/["runtime-a3-keep"]',
    (select (p.value -> 'option_codes')::text from public.base_models bm, jsonb_array_elements(bm.presets) p(value) where bm.id = m_model and p.value ->> 'code' = 'p1') || '/' ||
    (select (p.value -> 'option_codes')::text from public.base_models bm, jsonb_array_elements(bm.presets) p(value) where bm.id = m_model and p.value ->> 'code' = 'p2'));
  perform pg_temp.a3_expect_eq('A3-12 消す前の行を写しに残す（カテゴリー 1・商品 9・標準構成 1・プラン 2・明細 4・写し 1・見積依頼 1・見積 1・見積の明細 3・PDF の記録 1）',
    '1/9/1/2/4/1/1/1/3/1',
    (select count(*) from archive_a3_20261104.option_categories where id = cat_sw)::text || '/' ||
    (select count(*) from archive_a3_20261104.options where category_id = cat_sw)::text || '/' ||
    (select count(*) from archive_a3_20261104.base_model_presets where base_model_id = m_model and presets::text like '%sw-transport%')::text || '/' ||
    (select count(*) from archive_a3_20261104.configurations where id in (c_draft, c_req))::text || '/' ||
    (select count(*) from archive_a3_20261104.configuration_items where configuration_id in (c_draft, c_req))::text || '/' ||
    (select count(*) from archive_a3_20261104.configuration_snapshots where configuration_id = c_req)::text || '/' ||
    (select count(*) from archive_a3_20261104.quote_requests where id = r_req)::text || '/' ||
    (select count(*) from archive_a3_20261104.quotes where id = q_req)::text || '/' ||
    (select count(*) from archive_a3_20261104.quote_items where quote_id = q_req)::text || '/' ||
    (select count(*) from archive_a3_20261104.quote_documents where quote_id = q_req)::text);
  perform pg_temp.a3_expect_eq('A3-13 二度目は何もしない（9 品目が無いため）', '{"skipped": true}',
    public.remove_sitework_catalog(v_expected)::text);

  -- ---------- 写しから元に戻せる（緊急時の手順。DB の保護の仕組みは戻す間だけ外す） ----------
  -- 写しの表の列を名前で戻す（後の migration で足された列は既定値になる）
  set local session_replication_role = replica;
  foreach v_table in array array['option_categories', 'options', 'configurations', 'configuration_items', 'configuration_snapshots',
                                 'configuration_site_profiles', 'quote_requests', 'quote_request_preferences', 'quotes', 'quote_items', 'quote_documents'] loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
      from pg_attribute a where a.attrelid = to_regclass('archive_a3_20261104.' || v_table) and a.attnum > 0 and not a.attisdropped;
    execute format('insert into public.%I (%s) select %s from archive_a3_20261104.%I', v_table, v_cols, v_cols, v_table);
  end loop;
  update public.base_models bm set presets = a.presets from archive_a3_20261104.base_model_presets a where a.base_model_id = bm.id;
  set local session_replication_role = origin;
  select md5(string_agg(t.x, '|' order by t.x)) into v_archive from (
    select to_jsonb(a)::text as x from archive_a3_20261104.configurations a
    union all select to_jsonb(a)::text from archive_a3_20261104.quotes a
    union all select to_jsonb(a)::text from archive_a3_20261104.quote_items a
    union all select to_jsonb(a)::text from archive_a3_20261104.options a) t;
  -- 比べるのは写しの表の列だけ（後の migration で元の表に足された列は、写しに無い）
  perform pg_temp.a3_expect_eq('A3-14 写しから同じ ID・同じ内容で戻せる（プラン・見積・見積の明細・商品）', v_archive,
    (select md5(string_agg(t.x, '|' order by t.x)) from (
       select pg_temp.a3_archived_columns(to_jsonb(p), 'configurations') as x from public.configurations p where p.id in (c_draft, c_req)
       union all select pg_temp.a3_archived_columns(to_jsonb(p), 'quotes') from public.quotes p where p.id = q_req
       union all select pg_temp.a3_archived_columns(to_jsonb(p), 'quote_items') from public.quote_items p where p.quote_id = q_req
       union all select pg_temp.a3_archived_columns(to_jsonb(p), 'options') from public.options p where p.category_id = cat_sw) t));
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _a3_result;

rollback;
