-- v2.5 PR-A3：既存の商品価格・追加金額の初期の原価 Version への取り込み（import_option_standard_costs）の実行時検査。
-- 使い捨てDB専用。最後に rollback する。
begin;

create temp table _ici_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _ici_result to public;

create function pg_temp.ici_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.ici_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _ici_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.ici_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _ici_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

create function pg_temp.ici_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _ici_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || ':%');
$fn$;

do $test$
declare
  u_admin constant uuid := '27000000-0000-4000-8000-000000000001';
  u_owner constant uuid := '27000000-0000-4000-8000-000000000002';
  u_master constant uuid := '27000000-0000-4000-8000-000000000005';
  u_customer constant uuid := '27000000-0000-4000-8000-000000000006';
  org_hq constant uuid := '27000000-0000-4000-8000-000000000101';
  org_master constant uuid := '27000000-0000-4000-8000-000000000102';
  cat_id constant uuid := '27000000-0000-4000-8000-000000000201';
  -- 登録済み・金額あり（取り込む）
  opt_a constant uuid := '27000000-0000-4000-8000-000000000301';
  -- 下書き（取り込まない）
  opt_draft constant uuid := '27000000-0000-4000-8000-000000000302';
  -- 登録済み・別途見積（取り込まない）
  opt_por constant uuid := '27000000-0000-4000-8000-000000000303';
  -- 登録済み・0 円（取り込まない）
  opt_zero constant uuid := '27000000-0000-4000-8000-000000000304';
  -- 登録済み・選択肢の差額がマイナスの在庫データ（0 円未満になるので止める）
  opt_neg constant uuid := '27000000-0000-4000-8000-000000000305';
  g_a constant uuid := '27000000-0000-4000-8000-000000000401';
  g_neg constant uuid := '27000000-0000-4000-8000-000000000402';
  c_a0 constant uuid := '27000000-0000-4000-8000-000000000501';
  c_a1 constant uuid := '27000000-0000-4000-8000-000000000502';
  c_apor constant uuid := '27000000-0000-4000-8000-000000000503';
  c_neg constant uuid := '27000000-0000-4000-8000-000000000504';
  -- 取り込みの順序の確認（今の版：商品 1,000 円・選択肢 -800 円 → 台帳の 500 円・0 円を取り込む）
  opt_ord constant uuid := '27000000-0000-4000-8000-000000000306';
  g_ord constant uuid := '27000000-0000-4000-8000-000000000403';
  c_ord constant uuid := '27000000-0000-4000-8000-000000000505';
  v_items text;
  v_audit_before bigint;
begin
  set local session_replication_role = replica;

  insert into auth.users (id, email, raw_user_meta_data)
  values
    (u_admin, 'ici-admin@runtime.invalid', '{}'::jsonb),
    (u_owner, 'ici-owner@runtime.invalid', '{}'::jsonb),
    (u_master, 'ici-master@runtime.invalid', '{}'::jsonb),
    (u_customer, 'ici-customer@runtime.invalid', '{}'::jsonb);
  insert into public.profiles (id, email, full_name, role_code)
  values
    (u_admin, 'ici-admin@runtime.invalid', 'global admin', 'admin'),
    (u_owner, 'ici-owner@runtime.invalid', 'HQ owner', 'customer'),
    (u_master, 'ici-master@runtime.invalid', 'master dealer', 'master_dealer'),
    (u_customer, 'ici-customer@runtime.invalid', 'customer', 'customer');
  insert into public.organizations (id, code, name, organization_type, status)
  values
    (org_hq, 'runtime-ici-hq', 'Initial Cost Import HQ', 'headquarters', 'active'),
    (org_master, 'runtime-ici-master', 'Initial Cost Import Master', 'master_dealer', 'active');
  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values
    (org_hq, u_owner, 'owner', 'active'),
    (org_master, u_master, 'owner', 'active');

  insert into public.option_categories (id, code, name, status)
  values (cat_id, 'runtime-ici-category', '初期原価の取り込み Runtime', 'published');
  insert into public.options (id, category_id, code, name, price, price_on_request, status, product_no)
  values
    (opt_a, cat_id, 'runtime-ici-a', '取り込み商品A', 120000, false, 'published', 'PRD-927001'),
    (opt_draft, cat_id, 'runtime-ici-draft', '取り込み下書き', 50000, false, 'draft', 'PRD-927002'),
    (opt_por, cat_id, 'runtime-ici-por', '取り込み別途見積', 0, true, 'published', 'PRD-927003'),
    (opt_zero, cat_id, 'runtime-ici-zero', '取り込み0円', 0, false, 'published', 'PRD-927004'),
    (opt_neg, cat_id, 'runtime-ici-neg', '取り込みマイナス', 1000, false, 'published', 'PRD-927005'),
    (opt_ord, cat_id, 'runtime-ici-ord', '取り込みの順序', 1000, false, 'published', 'PRD-927006');
  insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
  values
    (g_a, opt_a, 'size', 'サイズ', 1, true, 'published'),
    (g_neg, opt_neg, 'size', 'サイズ', 1, true, 'published'),
    (g_ord, opt_ord, 'size', 'サイズ', 1, true, 'published');
  insert into public.option_variant_choices (id, group_id, code, name, extra_price, price_on_request, status)
  values
    (c_a0, g_a, 'std', '標準', 0, false, 'published'),
    (c_a1, g_a, 'large', '大', 8000, false, 'published'),
    (c_apor, g_a, 'custom', '特注', 0, true, 'published'),
    (c_neg, g_neg, 'small', '小', 0, false, 'published'),
    (c_ord, g_ord, 'small', '小', 0, false, 'published');
  set local session_replication_role = origin;

  v_items := format(
    '[{"kind":"option","id":"%s","amount":120000},{"kind":"choice","id":"%s","amount":0},{"kind":"choice","id":"%s","amount":8000}]',
    opt_a, c_a0, c_a1);

  -- 権限：本部だけ
  perform pg_temp.ici_expect_denied('ログインしていない人は取り込めない（EXECUTE なし）', '42501',
    pg_temp.ici_run_as('anon', null, format('select count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)', v_items, '検査')));
  perform pg_temp.ici_expect_error('お客様は取り込めない', '42501', 'FORBIDDEN',
    pg_temp.ici_run_as('authenticated', u_customer, format('select count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)', v_items, '検査')));
  perform pg_temp.ici_expect_error('総代理店は取り込めない', '42501', 'FORBIDDEN',
    pg_temp.ici_run_as('authenticated', u_master, format('select count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)', v_items, '検査')));
  perform pg_temp.ici_expect_eq('service_role は実行できない（EXECUTE なし）', 'false',
    has_function_privilege('service_role', 'public.import_option_standard_costs(jsonb, text)', 'EXECUTE')::text);

  -- 除外の条件
  perform pg_temp.ici_expect_error('下書きの商品は取り込まない（登録のときに記録する）', 'P0001', 'VALIDATION',
    pg_temp.ici_run_as('authenticated', u_owner, format('select count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)',
      format('[{"kind":"option","id":"%s","amount":50000}]', opt_draft), '検査')));
  perform pg_temp.ici_expect_error('別途見積の商品は取り込まない', 'P0001', 'VALIDATION',
    pg_temp.ici_run_as('authenticated', u_owner, format('select count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)',
      format('[{"kind":"option","id":"%s","amount":0}]', opt_por), '検査')));
  perform pg_temp.ici_expect_error('0 円の商品は取り込まない', 'P0001', 'VALIDATION',
    pg_temp.ici_run_as('authenticated', u_owner, format('select count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)',
      format('[{"kind":"option","id":"%s","amount":0}]', opt_zero), '検査')));
  perform pg_temp.ici_expect_error('別途見積の選択肢は取り込まない', 'P0001', 'VALIDATION',
    pg_temp.ici_run_as('authenticated', u_owner, format('select count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)',
      format('[{"kind":"choice","id":"%s","amount":0}]', c_apor), '検査')));
  perform pg_temp.ici_expect_error('確かめた後に金額が変わっていたら止める（後勝ちにしない）', 'P0001', 'CONFLICT',
    pg_temp.ici_run_as('authenticated', u_owner, format('select count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)',
      format('[{"kind":"option","id":"%s","amount":119000}]', opt_a), '検査')));
  perform pg_temp.ici_expect_error('同じ商品が 2 回ある一覧は止める', 'P0001', 'VALIDATION',
    pg_temp.ici_run_as('authenticated', u_owner, format('select count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)',
      format('[{"kind":"option","id":"%s","amount":120000},{"kind":"option","id":"%s","amount":120000}]', opt_a, opt_a), '検査')));
  -- 画面からは入らないマイナスの差額でも、取り込みの前の確認で止まる
  perform pg_temp.ici_expect_error('取り込んだ後に原価が 0 円未満になる商品は、商品名つきで止める', 'P0001', 'VALIDATION',
    pg_temp.ici_run_as('authenticated', u_owner, format('select count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)',
      format('[{"kind":"option","id":"%s","amount":1000},{"kind":"choice","id":"%s","amount":-5000}]', opt_neg, c_neg), '検査')));
  perform pg_temp.ici_expect_eq('止めた取り込みでは何も記録しない', '0/0',
    (select count(*) from public.option_standard_cost_versions where option_id in (opt_a, opt_neg))::text || '/' ||
    (select count(*) from public.option_variant_cost_versions where variant_choice_id in (c_a0, c_a1, c_neg))::text);

  -- 取り込み（本部）
  select count(*) into v_audit_before from public.audit_logs where entity_id = opt_a;
  perform pg_temp.ici_expect_eq('本部は取り込める（商品 1・選択肢 2 を新しく記録）', 'imported:3',
    pg_temp.ici_run_as('authenticated', u_owner, format(
      'select string_agg(distinct result, '','') || '':'' || count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)',
      v_items, '既存の商品価格・追加金額を初期の原価 Version へ取り込み（検査）')));
  perform pg_temp.ici_expect_eq('商品標準原価は今の商品価格と同じ金額で第 1 版になる', '120000/1',
    (select standard_cost::text || '/' || version_no::text from public.option_standard_cost_versions where option_id = opt_a and superseded_at is null));
  perform pg_temp.ici_expect_eq('選択肢の 0 円も「差額 0 円」の版として記録する', '0/8000',
    (select string_agg(cost_adjustment::text, '/' order by cost_adjustment) from public.option_variant_cost_versions
      where variant_choice_id in (c_a0, c_a1) and superseded_at is null));
  perform pg_temp.ici_expect_eq('写しの表（本部商品基準原価）も同じ金額になる', '120000',
    (select standard_cost::text from public.option_hq_standard_costs where option_id = opt_a));
  perform pg_temp.ici_expect_eq('今の商品価格・追加金額の列は変えない（旧シミュレーターはそのまま）', '120000/0/8000',
    (select price::text from public.options where id = opt_a) || '/' ||
    (select string_agg(extra_price::text, '/' order by extra_price) from public.option_variant_choices where id in (c_a0, c_a1)));
  perform pg_temp.ici_expect_eq('取り込みの理由つきで監査に残る（既存の RPC の記録）', 'true',
    ((select count(*) from public.audit_logs where entity_id = opt_a) > v_audit_before
      and exists (select 1 from public.option_standard_cost_versions
                   where option_id = opt_a and change_reason = '既存の商品価格・追加金額を初期の原価 Version へ取り込み（検査）'))::text);

  -- 2 回目は同じ金額なので何もしない
  perform pg_temp.ici_expect_eq('もう一度取り込んでも、同じ金額なら何も作らない', 'unchanged:3',
    pg_temp.ici_run_as('authenticated', u_owner, format(
      'select string_agg(distinct result, '','') || '':'' || count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)',
      v_items, '検査（2 回目）')));
  perform pg_temp.ici_expect_eq('版の数は増えない', '1/2',
    (select count(*) from public.option_standard_cost_versions where option_id = opt_a)::text || '/' ||
    (select count(*) from public.option_variant_cost_versions where variant_choice_id in (c_a0, c_a1))::text);

  -- 金額が変わった後に取り込み直すと、次の版を作る（global admin でも同じ）
  set local session_replication_role = replica;
  update public.options set price = 125000 where id = opt_a;
  set local session_replication_role = origin;
  -- 取り込みと結果の読み取りは別の文にする（同じ式の中の副問い合わせは、関数より先に評価されうる）
  perform pg_temp.ici_expect_eq('金額を変えた後に取り込み直すと、新しく記録する（global admin でも同じ）', 'imported:1',
    pg_temp.ici_run_as('authenticated', u_admin, format(
      'select string_agg(distinct result, '','') || '':'' || count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)',
      format('[{"kind":"option","id":"%s","amount":125000}]', opt_a), '検査（金額の変更）')));
  perform pg_temp.ici_expect_eq('金額を変えた後の取り込みは第 2 版になり、第 1 版は閉じる', '125000/2/1',
    (select standard_cost::text || '/' || version_no::text from public.option_standard_cost_versions where option_id = opt_a and superseded_at is null)
    || '/' || (select count(*)::text from public.option_standard_cost_versions where option_id = opt_a and superseded_at is not null));

  -- 取り込みの順序：今の版（商品 1,000 円・選択肢 -800 円）から、台帳の 500 円・0 円へ。最後は 500 円で 0 円以上。
  -- 商品を先に記録すると、その時点では 500 + (-800) < 0 で既存の RPC に止められる → 選択肢の上げを先にする
  perform pg_temp.ici_run_as('authenticated', u_owner, format('select changed::text from public.set_option_hq_standard_cost(%L, 1000, 0, %L)', opt_ord, '検査の準備'));
  perform pg_temp.ici_run_as('authenticated', u_owner, format('select changed::text from public.set_option_variant_cost_adjustment(%L, -800, null, %L)', c_ord, '検査の準備'));
  set local session_replication_role = replica;
  update public.options set price = 500 where id = opt_ord;
  set local session_replication_role = origin;
  perform pg_temp.ici_expect_eq('選択肢の版を上げてから商品を下げる順なら、途中で止まらずに取り込める', 'imported:2',
    pg_temp.ici_run_as('authenticated', u_owner, format(
      'select string_agg(distinct result, '','') || '':'' || count(*)::text from public.import_option_standard_costs(%L::jsonb, %L)',
      format('[{"kind":"option","id":"%s","amount":500},{"kind":"choice","id":"%s","amount":0}]', opt_ord, c_ord), '検査（順序）')));
  perform pg_temp.ici_expect_eq('取り込んだ後の版：商品 500 円・選択肢 0 円', '500/0',
    (select standard_cost::text from public.option_standard_cost_versions where option_id = opt_ord and superseded_at is null) || '/' ||
    (select cost_adjustment::text from public.option_variant_cost_versions where variant_choice_id = c_ord and superseded_at is null));
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _ici_result;

rollback;
