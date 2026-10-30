-- 旧価格の列の保護（v2.5 PR-C1b・20261030100000）の実行時検査。使い捨て DB 専用。最後に rollback する。
-- 金額の列は anon・ログインした利用者（本部の管理者も）が API から直接読めず、service_role は読めること、
-- 本部商品の金額は本部だけが変えられ、総代理店（商品台帳の編集者）は直接の更新・一括登録・旧テンプレートの取込でも変えられないこと、
-- 旧フリー商品は今までどおり持ち主の代理店が変えられることを確かめる。
begin;

create temp table _lpg_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _lpg_result to public;

create function pg_temp.lpg_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.lpg_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _lpg_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.lpg_expect_error(p_step text, p_code text, p_prefix text, p_actual text) returns void
language sql as $fn$
  insert into _lpg_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_prefix || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_prefix || '%');
$fn$;

-- ---------- 権限（商品マスターが空でない DB でも行う） ----------
do $privileges$
declare
  v_open text;
  v_hidden text;
begin
  -- 金額の列：anon・authenticated は読めず、service_role は読める
  with cols(tbl, col) as (values
    ('options', 'price'), ('option_variant_choices', 'extra_price'), ('base_models', 'base_price'),
    ('base_breakdown_items', 'unit_price'), ('base_breakdown_items', 'amount'),
    ('estimate_templates', 'subtotal_raw'), ('estimate_templates', 'adjustment'), ('estimate_templates', 'subtotal'),
    ('estimate_templates', 'tax'), ('estimate_templates', 'total'),
    ('estimate_template_sections', 'line_subtotal'), ('estimate_template_sections', 'expense_amount'), ('estimate_template_sections', 'total'),
    ('estimate_template_lines', 'unit_price'), ('estimate_template_lines', 'amount'))
  select coalesce(string_agg(tbl || '.' || col, ', ' order by tbl, col) filter (
           where has_column_privilege('anon', ('public.' || tbl)::regclass, col, 'SELECT')
              or has_column_privilege('authenticated', ('public.' || tbl)::regclass, col, 'SELECT')
              or not has_column_privilege('service_role', ('public.' || tbl)::regclass, col, 'SELECT')), '')
    into v_open
    from cols;
  perform pg_temp.lpg_expect_eq('LPG-1 旧価格の 15 列は anon・authenticated から読めず、service_role は読める（合わない列の一覧が空）', '', v_open);

  -- ほかの列：今までどおり anon・authenticated が読める
  select coalesce(string_agg(c.relname || '.' || a.attname, ', ' order by c.relname, a.attname), '')
    into v_hidden
    from pg_catalog.pg_class c
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('options', 'option_variant_choices', 'base_models', 'base_breakdown_items',
                       'estimate_templates', 'estimate_template_sections', 'estimate_template_lines')
     and (c.relname, a.attname) not in (
       ('options', 'price'), ('option_variant_choices', 'extra_price'), ('base_models', 'base_price'),
       ('base_breakdown_items', 'unit_price'), ('base_breakdown_items', 'amount'),
       ('estimate_templates', 'subtotal_raw'), ('estimate_templates', 'adjustment'), ('estimate_templates', 'subtotal'),
       ('estimate_templates', 'tax'), ('estimate_templates', 'total'),
       ('estimate_template_sections', 'line_subtotal'), ('estimate_template_sections', 'expense_amount'), ('estimate_template_sections', 'total'),
       ('estimate_template_lines', 'unit_price'), ('estimate_template_lines', 'amount'))
     and not (has_column_privilege('anon', c.oid, a.attnum, 'SELECT') and has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT'));
  perform pg_temp.lpg_expect_eq('LPG-2 金額のほかの列は、今までどおり anon・authenticated が読める（読めない列の一覧が空）', '', v_hidden);

  perform pg_temp.lpg_expect_eq('LPG-3 内部の判定・トリガー関数は API のロールから実行できない', 'false',
    (select bool_or(has_function_privilege(r, f, 'execute'))::text
       from unnest(array['anon', 'authenticated', 'service_role']) as r,
            unnest(array['public.legacy_price_write_allowed()', 'public.option_category_is_hq_cost(uuid)',
                         'public.options_legacy_price_guard()', 'public.option_variant_choices_legacy_price_guard()',
                         'public.base_models_legacy_price_guard()', 'public.legacy_price_rows_guard()']) as f));
end;
$privileges$;

-- ---------- 読み取り・書き込みの動作（商品マスターが空の DB でだけ行う） ----------
do $behavior$
declare
  u_admin constant uuid := '7d000000-0000-4000-8000-000000000001';
  u_md constant uuid := '7d000000-0000-4000-8000-000000000002';
  u_dealer constant uuid := '7d000000-0000-4000-8000-000000000003';
  u_cust constant uuid := '7d000000-0000-4000-8000-000000000004';
  m_model constant uuid := '7d100000-0000-4000-8000-000000000001';
  c_items constant uuid := '7d200000-0000-4000-8000-000000000001';
  c_free constant uuid := '7d200000-0000-4000-8000-000000000002';
  o_hq constant uuid := '7d300000-0000-4000-8000-000000000001';
  o_free constant uuid := '7d300000-0000-4000-8000-000000000002';
  vg_hq constant uuid := '7d310000-0000-4000-8000-000000000001';
  vc_hq constant uuid := '7d320000-0000-4000-8000-000000000001';
  v_out text;
  v_template jsonb;
begin
  if exists (select 1 from public.options o where o.code not like 'runtime-%') then
    perform pg_temp.lpg_expect_eq('LPG-0 商品マスターが空の DB で行う検査のため、読み取り・書き込みの動作の確認は省略', 'skipped', 'skipped');
    return;
  end if;

  -- ---------- 検査用のデータ（トリガーと外部キー検査を止めて、必要な行だけを直接入れる） ----------
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  values (u_admin, 'lpg-admin@runtime.invalid', '{}'), (u_md, 'lpg-md@runtime.invalid', '{}'),
         (u_dealer, 'lpg-dealer@runtime.invalid', '{}'), (u_cust, 'lpg-cust@runtime.invalid', '{}');
  insert into public.profiles (id, email, full_name, role_code)
  values (u_admin, 'lpg-admin@runtime.invalid', '本部', 'admin'), (u_md, 'lpg-md@runtime.invalid', '総代理店', 'master_dealer'),
         (u_dealer, 'lpg-dealer@runtime.invalid', '代理店', 'dealer'), (u_cust, 'lpg-cust@runtime.invalid', 'お客様', 'customer');
  insert into public.base_models (id, slug, name, base_price, status)
  values (m_model, 'runtime-lpg-model', '旧価格の検査用モデル', 1000000, 'published');
  insert into public.option_categories (id, code, name, selection_mode, is_required, finish_level, status)
  values (c_items, 'runtime-lpg-items', '旧価格の検査の商品', 'multi', false, 'shell', 'published'),
         (c_free, 'free-product', 'フリー商品', 'multi', false, 'shell', 'published');
  insert into public.options (id, base_model_id, category_id, code, name, price, status, product_no, simulator_visible, owner_id)
  values (o_hq, m_model, c_items, 'runtime-lpg-hq', '本部商品', 10000, 'published', 'PRD-974001', true, null),
         (o_free, null, c_free, 'runtime-lpg-free', '代理店のフリー商品', 5000, 'published', 'PRD-974002', false, u_dealer);
  insert into public.option_variant_groups (id, option_id, code, name, status) values (vg_hq, o_hq, 'color', '色', 'published');
  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status)
  values (vc_hq, vg_hq, 'black', '黒', 'option', 1000, 'published');
  insert into public.base_breakdown_items (base_model_id, spec_code, section, name, quantity, unit, unit_price, amount, sort_order)
  values (m_model, 'lpg-spec', 'base', '検査の内訳', 1, '式', 100000, 100000, 1);
  insert into public.estimate_templates (base_model_id, spec_code, name, source_file_name, source_sheet_name, source_sha256, subtotal_raw, subtotal, tax, total)
  values (m_model, 'lpg-tmpl', '検査用 Excel 標準', 'runtime.xlsx', 'runtime', repeat('0', 64), 200000, 200000, 20000, 220000);
  set local session_replication_role = origin;

  -- ---------- 読み取り ----------
  perform pg_temp.lpg_expect_eq('LPG-10 未ログイン・お客様・本部の管理者は、商品価格を API から直接読めない（金額のほかの列は読める）',
    'denied/denied/denied/本部商品',
    (case when pg_temp.lpg_run_as('anon', null, format('select price::text from public.options where id = %L', o_hq)) like 'ERROR 42501:%' then 'denied' else 'readable' end) || '/' ||
    (case when pg_temp.lpg_run_as('authenticated', u_cust, format('select price::text from public.options where id = %L', o_hq)) like 'ERROR 42501:%' then 'denied' else 'readable' end) || '/' ||
    (case when pg_temp.lpg_run_as('authenticated', u_admin, format('select price::text from public.options where id = %L', o_hq)) like 'ERROR 42501:%' then 'denied' else 'readable' end) || '/' ||
    pg_temp.lpg_run_as('anon', null, format('select name from public.options where id = %L', o_hq)));
  perform pg_temp.lpg_expect_eq('LPG-11 本体価格・追加金額・本体内訳・旧テンプレートの金額も、ログインした利用者は直接読めない', 'denied/denied/denied/denied',
    (case when pg_temp.lpg_run_as('authenticated', u_md, format('select base_price::text from public.base_models where id = %L', m_model)) like 'ERROR 42501:%' then 'denied' else 'readable' end) || '/' ||
    (case when pg_temp.lpg_run_as('authenticated', u_md, format('select extra_price::text from public.option_variant_choices where id = %L', vc_hq)) like 'ERROR 42501:%' then 'denied' else 'readable' end) || '/' ||
    (case when pg_temp.lpg_run_as('authenticated', u_md, format('select amount::text from public.base_breakdown_items where base_model_id = %L limit 1', m_model)) like 'ERROR 42501:%' then 'denied' else 'readable' end) || '/' ||
    (case when pg_temp.lpg_run_as('authenticated', u_md, format('select total::text from public.estimate_templates where base_model_id = %L limit 1', m_model)) like 'ERROR 42501:%' then 'denied' else 'readable' end));
  perform pg_temp.lpg_expect_eq('LPG-12 サーバー（service_role）は金額を読める', '10000/1000/1000000',
    pg_temp.lpg_run_as('service_role', null, format('select price::text from public.options where id = %L', o_hq)) || '/' ||
    pg_temp.lpg_run_as('service_role', null, format('select extra_price::text from public.option_variant_choices where id = %L', vc_hq)) || '/' ||
    pg_temp.lpg_run_as('service_role', null, format('select base_price::text from public.base_models where id = %L', m_model)));

  -- ---------- 書き込み：本部商品の金額は本部だけ ----------
  perform pg_temp.lpg_expect_error('LPG-20 総代理店は本部商品の商品価格を直接変えられない', '42501', 'FORBIDDEN: 本部商品の商品標準原価（商品価格）は本部だけが変更できます',
    pg_temp.lpg_run_as('authenticated', u_md, format('update public.options set price = 12000 where id = %L returning ''ok''', o_hq)));
  perform pg_temp.lpg_expect_eq('LPG-21 総代理店も、本部商品の金額のほかの項目は今までどおり変えられる', 'ok',
    pg_temp.lpg_run_as('authenticated', u_md, format('update public.options set description = ''説明を更新'' where id = %L returning ''ok''', o_hq)));
  perform pg_temp.lpg_expect_eq('LPG-22 総代理店が本部商品を登録するときは、金額 0 なら登録でき、金額があると止める', 'ok/true',
    pg_temp.lpg_run_as('authenticated', u_md, format(
      $q$insert into public.options (base_model_id, category_id, code, name, price, status) values (%L, %L, 'runtime-lpg-md-0', '金額なし', 0, 'draft') returning 'ok'$q$, m_model, c_items)) || '/' ||
    (pg_temp.lpg_run_as('authenticated', u_md, format(
      $q$insert into public.options (base_model_id, category_id, code, name, price, status) values (%L, %L, 'runtime-lpg-md-1', '金額あり', 3000, 'draft') returning 'ok'$q$, m_model, c_items))
      like 'ERROR 42501: FORBIDDEN: 本部商品の商品標準原価（商品価格）は本部だけが登録できます%')::text);
  -- 更新と確認は別の文にする（同じ文の副問い合わせは、文の始まりの状態を見るため）
  v_out := pg_temp.lpg_run_as('authenticated', u_admin, format('update public.options set price = 12000 where id = %L returning ''ok''', o_hq));
  perform pg_temp.lpg_expect_eq('LPG-23 本部の管理者は本部商品の商品価格を変えられる', 'ok/12000',
    v_out || '/' || (select price::text from public.options where id = o_hq));
  v_out := pg_temp.lpg_run_as('authenticated', u_dealer, format('update public.options set price = 6000 where id = %L returning ''ok''', o_free));
  perform pg_temp.lpg_expect_eq('LPG-24 代理店は自分の旧フリー商品の金額を今までどおり変えられる', 'ok/6000',
    v_out || '/' || (select price::text from public.options where id = o_free));
  perform pg_temp.lpg_expect_error('LPG-25 総代理店は本部商品の選択肢の追加金額を変えられない', '42501', 'FORBIDDEN: 本部商品の選択肢の原価差額（追加金額）は本部だけが変更できます',
    pg_temp.lpg_run_as('authenticated', u_md, format('update public.option_variant_choices set extra_price = 2000 where id = %L returning ''ok''', vc_hq)));
  v_out := pg_temp.lpg_run_as('authenticated', u_admin, format('update public.option_variant_choices set extra_price = 2000 where id = %L returning ''ok''', vc_hq));
  perform pg_temp.lpg_expect_eq('LPG-26 本部の管理者は選択肢の追加金額を変えられる', 'ok/2000',
    v_out || '/' || (select extra_price::text from public.option_variant_choices where id = vc_hq));
  v_out := (pg_temp.lpg_run_as('authenticated', u_md, format('update public.base_models set base_price = 1200000 where id = %L returning ''ok''', m_model))
       like 'ERROR 42501: FORBIDDEN: 本体価格は本部だけが登録・変更できます%')::text || '/' ||
    pg_temp.lpg_run_as('authenticated', u_md, format('update public.base_models set tagline = ''検査'' where id = %L returning ''ok''', m_model)) || '/' ||
    pg_temp.lpg_run_as('authenticated', u_admin, format('update public.base_models set base_price = 1100000 where id = %L returning ''ok''', m_model));
  perform pg_temp.lpg_expect_eq('LPG-27 総代理店は本体価格を変えられず、本体のほかの項目は変えられる。本部の管理者は本体価格を変えられる', 'true/ok/ok/1100000',
    v_out || '/' || (select base_price::text from public.base_models where id = m_model));
  perform pg_temp.lpg_expect_eq('LPG-28 総代理店は金額のある本体内訳を追加・削除できない。本部の管理者はできる', 'true/true/ok',
    (pg_temp.lpg_run_as('authenticated', u_md, format(
       $q$insert into public.base_breakdown_items (base_model_id, spec_code, section, name, quantity, unit_price, amount) values (%L, 'lpg-spec', 'base', '追加', 1, 500, 500) returning 'ok'$q$, m_model))
       like 'ERROR 42501: FORBIDDEN: 本体内訳 の金額は本部だけが登録・変更・削除できます%')::text || '/' ||
    (pg_temp.lpg_run_as('authenticated', u_md, format($q$delete from public.base_breakdown_items where base_model_id = %L and spec_code = 'lpg-spec' returning 'ok'$q$, m_model))
       like 'ERROR 42501: FORBIDDEN: 本体内訳 の金額は本部だけが登録・変更・削除できます%')::text || '/' ||
    pg_temp.lpg_run_as('authenticated', u_admin, format(
       $q$insert into public.base_breakdown_items (base_model_id, spec_code, section, name, quantity, unit_price, amount) values (%L, 'lpg-spec', 'base', '追加', 1, 500, 500) returning 'ok'$q$, m_model)));

  -- ---------- SECURITY DEFINER の RPC の中でも、呼んだ利用者で判定する ----------
  perform pg_temp.lpg_expect_eq('LPG-30 一括登録（apply_catalog_import）：総代理店は本部商品の金額を変えられず、金額を変えない更新はできる', 'true/ok',
    (pg_temp.lpg_run_as('authenticated', u_md, format(
       $q$select public.apply_catalog_import(jsonb_build_array(jsonb_build_object('id', %L, 'code', 'runtime-lpg-hq', 'name', '本部商品', 'category_id', %L, 'base_model_id', %L, 'price', 99999, 'status', 'published')), '[]'::jsonb, '[]'::jsonb)::text || 'ok'$q$,
       o_hq, c_items, m_model))
       like 'ERROR %FORBIDDEN: 本部商品の商品標準原価（商品価格）は本部だけが%')::text || '/' ||
    pg_temp.lpg_run_as('authenticated', u_md, format(
       $q$select public.apply_catalog_import(jsonb_build_array(jsonb_build_object('id', %L, 'code', 'runtime-lpg-hq', 'name', '本部商品（名前を更新）', 'category_id', %L, 'base_model_id', %L, 'price', 12000, 'status', 'published')), '[]'::jsonb, '[]'::jsonb)::text || 'ok'$q$,
       o_hq, c_items, m_model)));
  v_template := jsonb_build_array(jsonb_build_object(
    'base_model_id', m_model, 'spec_code', 'lpg-tmpl', 'name', '差し替え', 'source_file_name', 'r.xlsx', 'source_sheet_name', 'r',
    'source_sha256', repeat('1', 64), 'subtotal_raw', 0, 'subtotal', 0, 'tax', 0, 'total', 0, 'sections', '[]'::jsonb, 'lines', '[]'::jsonb,
    'base_breakdown_items', '[]'::jsonb, 'baseline_option_ids', '[]'::jsonb));
  perform pg_temp.lpg_expect_error('LPG-31 旧テンプレートの取込（replace_estimate_templates_with_baselines）：総代理店は金額のある旧テンプレートを差し替えられない', '42501',
    'FORBIDDEN: 旧テンプレート（Excel の標準見積） の金額は本部だけが登録・変更・削除できます',
    pg_temp.lpg_run_as('authenticated', u_md, format('select public.replace_estimate_templates_with_baselines(%L::jsonb)::text || ''ok''', v_template)));
end;
$behavior$;

select coalesce(json_agg(json_build_object('ok', ok, 'step', step, 'expected', expected, 'actual', actual) order by seq), '[]'::json) as j
  from _lpg_result;

rollback;
