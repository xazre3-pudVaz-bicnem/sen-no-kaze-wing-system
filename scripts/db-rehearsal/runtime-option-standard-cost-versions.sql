-- v2.5 PR-A1：商品の標準原価 Version・バリエーションの標準原価調整額 Version の実行時検査。使い捨てDB専用。最後にrollbackする。
begin;

create temp table _scv_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _scv_result to public;

create function pg_temp.scv_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.scv_try_super(p_sql text) returns text
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

create function pg_temp.scv_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _scv_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.scv_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _scv_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

-- エラーの種類（メッセージの先頭の語）まで確かめる
create function pg_temp.scv_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _scv_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || ':%');
$fn$;

do $test$
declare
  u_admin constant uuid := '25000000-0000-4000-8000-000000000001';
  u_owner constant uuid := '25000000-0000-4000-8000-000000000002';
  u_editor constant uuid := '25000000-0000-4000-8000-000000000003';
  u_viewer constant uuid := '25000000-0000-4000-8000-000000000004';
  u_master constant uuid := '25000000-0000-4000-8000-000000000005';
  u_customer constant uuid := '25000000-0000-4000-8000-000000000006';
  org_hq constant uuid := '25000000-0000-4000-8000-000000000101';
  org_master constant uuid := '25000000-0000-4000-8000-000000000102';
  cat_id constant uuid := '25000000-0000-4000-8000-000000000201';
  -- 商品の原価を先に設定し、バリエーションの調整額を後から足す商品
  opt_a constant uuid := '25000000-0000-4000-8000-000000000301';
  -- バリエーションの調整額を先に設定し、商品の原価を後から設定する商品
  opt_b constant uuid := '25000000-0000-4000-8000-000000000302';
  -- バリエーションの調整額だけを持つ商品（削除の保護）
  opt_c constant uuid := '25000000-0000-4000-8000-000000000303';
  g_a1 constant uuid := '25000000-0000-4000-8000-000000000401';
  g_a2 constant uuid := '25000000-0000-4000-8000-000000000402';
  g_b1 constant uuid := '25000000-0000-4000-8000-000000000403';
  g_c1 constant uuid := '25000000-0000-4000-8000-000000000404';
  c_a1 constant uuid := '25000000-0000-4000-8000-000000000501';
  c_a2 constant uuid := '25000000-0000-4000-8000-000000000502';
  c_a3 constant uuid := '25000000-0000-4000-8000-000000000503';
  c_a4 constant uuid := '25000000-0000-4000-8000-000000000504';
  c_b1 constant uuid := '25000000-0000-4000-8000-000000000505';
  c_c1 constant uuid := '25000000-0000-4000-8000-000000000506';
  v_v1 uuid;
  v_v2 uuid;
  v_c_a1_v1 uuid;
  v_c_a1_v2 uuid;
  v_audit_before bigint;
  -- 本部商品の外（旧フリー商品）：本部標準原価は本部商品だけ（2026-10-29 先方の回答）
  opt_free constant uuid := '25000000-0000-4000-8000-000000000304';
  g_free constant uuid := '25000000-0000-4000-8000-000000000405';
  c_free constant uuid := '25000000-0000-4000-8000-000000000507';
  v_free_cat uuid;
begin
  set local session_replication_role = replica;

  insert into auth.users (id, email, raw_user_meta_data)
  values
    (u_admin, 'scv-admin@runtime.invalid', '{}'::jsonb),
    (u_owner, 'scv-owner@runtime.invalid', '{}'::jsonb),
    (u_editor, 'scv-editor@runtime.invalid', '{}'::jsonb),
    (u_viewer, 'scv-viewer@runtime.invalid', '{}'::jsonb),
    (u_master, 'scv-master@runtime.invalid', '{}'::jsonb),
    (u_customer, 'scv-customer@runtime.invalid', '{}'::jsonb);

  insert into public.profiles (id, email, full_name, role_code)
  values
    (u_admin, 'scv-admin@runtime.invalid', 'global admin', 'admin'),
    (u_owner, 'scv-owner@runtime.invalid', 'HQ owner', 'customer'),
    (u_editor, 'scv-editor@runtime.invalid', 'HQ editor', 'customer'),
    (u_viewer, 'scv-viewer@runtime.invalid', 'HQ viewer', 'customer'),
    (u_master, 'scv-master@runtime.invalid', 'master dealer', 'master_dealer'),
    (u_customer, 'scv-customer@runtime.invalid', 'customer', 'customer');

  insert into public.organizations (id, code, name, organization_type, status)
  values
    (org_hq, 'runtime-scv-hq', 'Standard Cost Version HQ', 'headquarters', 'active'),
    (org_master, 'runtime-scv-master', 'Standard Cost Version Master', 'master_dealer', 'active');

  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values
    (org_hq, u_owner, 'owner', 'active'),
    (org_hq, u_editor, 'editor', 'active'),
    (org_hq, u_viewer, 'viewer', 'active'),
    (org_master, u_master, 'owner', 'active');

  insert into public.option_categories (id, code, name, status)
  values (cat_id, 'runtime-scv-category', '標準原価Version Runtime', 'published');

  insert into public.options (id, category_id, code, name, price, status, product_no)
  values
    (opt_a, cat_id, 'runtime-scv-a', '標準原価Version商品A', 150000, 'draft', 'PRD-925001'),
    (opt_b, cat_id, 'runtime-scv-b', '標準原価Version商品B', 80000, 'published', 'PRD-925002'),
    (opt_c, cat_id, 'runtime-scv-c', '標準原価Version商品C', 30000, 'draft', 'PRD-925003');

  insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
  values
    (g_a1, opt_a, 'size', 'サイズ', 1, true, 'published'),
    (g_a2, opt_a, 'finish', '仕上げ', 2, true, 'published'),
    (g_b1, opt_b, 'size', 'サイズ', 1, true, 'published'),
    (g_c1, opt_c, 'size', 'サイズ', 1, true, 'published');

  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status)
  values
    (c_a1, g_a1, 'small', '小', 'option', 0, 'published'),
    (c_a2, g_a1, 'large', '大', 'standard', 0, 'published'),
    (c_a3, g_a2, 'plain', '標準仕上げ', 'standard', 0, 'published'),
    (c_a4, g_a2, 'simple', '簡易仕上げ', 'option', 0, 'published'),
    (c_b1, g_b1, 'small', '小', 'option', 0, 'published'),
    (c_c1, g_c1, 'small', '小', 'option', 0, 'published');

  select id into v_free_cat from public.option_categories where code = 'free-product';
  if v_free_cat is null then
    v_free_cat := '25000000-0000-4000-8000-000000000202';
    insert into public.option_categories (id, code, name, status) values (v_free_cat, 'free-product', 'フリー商品', 'published');
  end if;
  insert into public.options (id, category_id, code, name, price, status, product_no, owner_id)
  values (opt_free, v_free_cat, 'runtime-scv-free', '標準原価Version旧フリー商品', 30000, 'published', 'PRD-925004', u_master);
  insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
  values (g_free, opt_free, 'size', 'サイズ', 1, true, 'published');
  insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status)
  values (c_free, g_free, 'large', '大', 'option', 2000, 'published');

  set local session_replication_role = origin;

  -- ---------- 公開の境界 ----------

  perform pg_temp.scv_expect_denied('商品の標準原価Versionはanonから読めない', '42501',
    pg_temp.scv_run_as('anon', null, 'select count(*)::text from public.option_standard_cost_versions'));
  perform pg_temp.scv_expect_denied('商品の標準原価Versionはservice_roleから読めない', '42501',
    pg_temp.scv_run_as('service_role', null, 'select count(*)::text from public.option_standard_cost_versions'));
  perform pg_temp.scv_expect_denied('バリエーションの調整額Versionはanonから読めない', '42501',
    pg_temp.scv_run_as('anon', null, 'select count(*)::text from public.option_variant_cost_versions'));
  perform pg_temp.scv_expect_denied('HQ ownerでもVersionへ直接INSERTできない', '42501',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'insert into public.option_standard_cost_versions(option_id,version_no,standard_cost,change_reason) values (%L,1,1,''直接'') returning id::text', opt_a)));
  perform pg_temp.scv_expect_denied('HQ ownerでもバリエーションの調整額Versionへ直接INSERTできない', '42501',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'insert into public.option_variant_cost_versions(variant_choice_id,version_no,cost_adjustment,change_reason) values (%L,1,1,''直接'') returning id::text', c_a1)));
  perform pg_temp.scv_expect_denied('anonは調整額の設定RPCを実行できない', '42501',
    pg_temp.scv_run_as('anon', null, format(
      'select changed::text from public.set_option_variant_cost_adjustment(%L,1,null,''anon'')', c_a1)));
  perform pg_temp.scv_expect_denied('内部の下限計算はauthenticatedから直接実行できない', '42501',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select public.option_variant_cost_min_total(%L)::text', opt_a)));
  perform pg_temp.scv_expect_error('ログインしていない呼び出しは調整額を設定できない', '42501', 'UNAUTHENTICATED',
    pg_temp.scv_run_as('authenticated', null, format(
      'select changed::text from public.set_option_variant_cost_adjustment(%L,1,null,''未ログイン'')', c_a1)));

  -- ---------- 商品の標準原価：設定・変更は新しい Version になる ----------

  select count(*) into v_audit_before from public.audit_logs where entity = 'option_hq_standard_cost' and entity_id = opt_a;

  perform pg_temp.scv_expect_eq('初回設定はVersion 1と写しのversion 1になる', '0/1/true',
    pg_temp.scv_run_as('authenticated', u_admin, format(
      'select standard_cost::text || ''/'' || lock_version::text || ''/'' || changed::text from public.set_option_hq_standard_cost(%L,0,0,''初回0円設定'')', opt_a)));
  select v.id into v_v1 from public.option_standard_cost_versions v where v.option_id = opt_a and v.superseded_at is null;
  perform pg_temp.scv_expect_eq('初回設定でVersion 1が現在のVersionになり、写しが指す', '1/1/0/true/初回0円設定',
    (select count(*)::text from public.option_standard_cost_versions v where v.option_id = opt_a) || '/' ||
    (select v.version_no::text from public.option_standard_cost_versions v where v.id = v_v1) || '/' ||
    (select v.standard_cost::text from public.option_standard_cost_versions v where v.id = v_v1) || '/' ||
    (select (c.current_version_id = v_v1)::text from public.option_hq_standard_costs c where c.option_id = opt_a) || '/' ||
    (select v.change_reason from public.option_standard_cost_versions v where v.id = v_v1));

  perform pg_temp.scv_expect_eq('変更は新しいVersionを作り写しのversionを上げる', '100000/2/true',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select standard_cost::text || ''/'' || lock_version::text || ''/'' || changed::text from public.set_option_hq_standard_cost(%L,100000,1,''基準原価改定'')', opt_a)));
  select v.id into v_v2 from public.option_standard_cost_versions v where v.option_id = opt_a and v.superseded_at is null;
  perform pg_temp.scv_expect_eq('古いVersionは値を変えずに閉じ、新しいVersionを指す', '2/1/0/true/2/100000/true',
    (select count(*)::text from public.option_standard_cost_versions v where v.option_id = opt_a) || '/' ||
    (select count(*)::text from public.option_standard_cost_versions v where v.option_id = opt_a and v.superseded_at is null) || '/' ||
    (select v.standard_cost::text from public.option_standard_cost_versions v where v.id = v_v1) || '/' ||
    (select (v.superseded_by_version_id = v_v2 and v.superseded_at is not null)::text from public.option_standard_cost_versions v where v.id = v_v1) || '/' ||
    (select v.version_no::text from public.option_standard_cost_versions v where v.id = v_v2) || '/' ||
    (select v.standard_cost::text from public.option_standard_cost_versions v where v.id = v_v2) || '/' ||
    (select (c.current_version_id = v_v2 and c.standard_cost = 100000)::text from public.option_hq_standard_costs c where c.option_id = opt_a));

  perform pg_temp.scv_expect_eq('同額・正しいversionはno-opでVersionを増やさない', '100000/2/false/2',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select standard_cost::text || ''/'' || lock_version::text || ''/'' || changed::text from public.set_option_hq_standard_cost(%L,100000,2,''同額確認'')', opt_a))
    || '/' || (select count(*)::text from public.option_standard_cost_versions v where v.option_id = opt_a));
  perform pg_temp.scv_expect_error('古いversionの変更は競合で拒否する', 'P0001', 'CONFLICT',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select changed::text from public.set_option_hq_standard_cost(%L,110000,1,''stale更新'')', opt_a)));
  perform pg_temp.scv_expect_eq('競合で拒否した変更はVersionを作らない', '2',
    (select count(*)::text from public.option_standard_cost_versions v where v.option_id = opt_a));

  perform pg_temp.scv_expect_eq('設定と変更は2件の監査履歴になる', (v_audit_before + 2)::text,
    (select count(*)::text from public.audit_logs where entity = 'option_hq_standard_cost' and entity_id = opt_a));
  perform pg_temp.scv_expect_eq('監査履歴に変更前後のVersionを残す', '1/2/0/100000/基準原価改定',
    (select (l.before ->> 'version_no') || '/' || (l.after ->> 'version_no') || '/' ||
            (l.before ->> 'standard_cost') || '/' || (l.after ->> 'standard_cost') || '/' || (l.after ->> 'change_reason')
       from public.audit_logs l
      where l.entity = 'option_hq_standard_cost' and l.entity_id = opt_a and l.action = 'hq_standard_cost_update'
      order by l.created_at desc limit 1));

  -- ---------- 読める人 ----------

  perform pg_temp.scv_expect_eq('HQ editorはVersion履歴を読める', '2',
    pg_temp.scv_run_as('authenticated', u_editor, format('select count(*)::text from public.option_standard_cost_versions where option_id=%L', opt_a)));
  perform pg_temp.scv_expect_eq('HQ viewerはVersion履歴を読めない', '0',
    pg_temp.scv_run_as('authenticated', u_viewer, format('select count(*)::text from public.option_standard_cost_versions where option_id=%L', opt_a)));
  perform pg_temp.scv_expect_eq('総代理店はVersion履歴を読めない', '0',
    pg_temp.scv_run_as('authenticated', u_master, format('select count(*)::text from public.option_standard_cost_versions where option_id=%L', opt_a)));
  perform pg_temp.scv_expect_eq('customerはVersion履歴を読めない', '0',
    pg_temp.scv_run_as('authenticated', u_customer, format('select count(*)::text from public.option_standard_cost_versions where option_id=%L', opt_a)));

  -- ---------- Version は変えられない（DB 管理者でも） ----------

  perform pg_temp.scv_expect_error('現在のVersionの金額は書き換えられない', 'P0001', 'LOCKED',
    pg_temp.scv_try_super(format('update public.option_standard_cost_versions set standard_cost = 1 where id = %L returning id::text', v_v2)));
  perform pg_temp.scv_expect_error('閉じたVersionの金額は書き換えられない', 'P0001', 'LOCKED',
    pg_temp.scv_try_super(format('update public.option_standard_cost_versions set standard_cost = 1 where id = %L returning id::text', v_v1)));
  perform pg_temp.scv_expect_error('閉じたVersionは開き直せない', 'P0001', 'LOCKED',
    pg_temp.scv_try_super(format('update public.option_standard_cost_versions set superseded_at = null, superseded_by_version_id = null where id = %L returning id::text', v_v1)));
  perform pg_temp.scv_expect_error('閉じる先の無い閉じ方はできない', 'P0001', 'LOCKED',
    pg_temp.scv_try_super(format('update public.option_standard_cost_versions set superseded_at = now() where id = %L returning id::text', v_v2)));
  perform pg_temp.scv_expect_error('Versionは削除できない', 'P0001', 'LOCKED',
    pg_temp.scv_try_super(format('delete from public.option_standard_cost_versions where id = %L returning id::text', v_v1)));
  perform pg_temp.scv_expect_denied('現在のVersionは1商品に1つだけ（2つ目の現在Versionは一意制約で拒否）', '23505',
    pg_temp.scv_try_super(format(
      'insert into public.option_standard_cost_versions(option_id,version_no,standard_cost,change_reason) values (%L,3,5,''二重'') returning id::text', opt_a)));
  perform pg_temp.scv_expect_eq('拒否の後もVersionと写しは元のまま', '2/1/100000',
    (select count(*)::text from public.option_standard_cost_versions v where v.option_id = opt_a) || '/' ||
    (select count(*)::text from public.option_standard_cost_versions v where v.option_id = opt_a and v.superseded_at is null) || '/' ||
    (select v.standard_cost::text from public.option_standard_cost_versions v where v.id = v_v2));

  -- ---------- バリエーションの標準原価調整額 ----------

  perform pg_temp.scv_expect_error('HQ editorは調整額を設定できない', '42501', 'FORBIDDEN',
    pg_temp.scv_run_as('authenticated', u_editor, format(
      'select changed::text from public.set_option_variant_cost_adjustment(%L,-1000,null,''editor'')', c_a1)));
  perform pg_temp.scv_expect_error('総代理店は調整額を設定できない', '42501', 'FORBIDDEN',
    pg_temp.scv_run_as('authenticated', u_master, format(
      'select changed::text from public.set_option_variant_cost_adjustment(%L,-1000,null,''master'')', c_a1)));
  perform pg_temp.scv_expect_error('変更理由が空の調整額は拒否する', 'P0001', 'VALIDATION',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select changed::text from public.set_option_variant_cost_adjustment(%L,-1000,null,''  '')', c_a1)));
  perform pg_temp.scv_expect_error('範囲外の調整額は拒否する', 'P0001', 'VALIDATION',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select changed::text from public.set_option_variant_cost_adjustment(%L,100000001,null,''範囲外'')', c_a1)));
  perform pg_temp.scv_expect_error('存在しない選択肢は見つからない', 'P0002', 'NOT_FOUND',
    pg_temp.scv_run_as('authenticated', u_owner,
      'select changed::text from public.set_option_variant_cost_adjustment(''25000000-0000-4000-8000-000000000599'',1,null,''不明'')'));

  select count(*) into v_audit_before from public.audit_logs where entity = 'option_variant_cost' and entity_id = opt_a;

  perform pg_temp.scv_expect_eq('マイナスの調整額を初回設定できる', '1/-30000/true',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select version_no::text || ''/'' || cost_adjustment::text || ''/'' || changed::text from public.set_option_variant_cost_adjustment(%L,-30000,null,''小サイズの原価差'')', c_a1)));
  select v.id into v_c_a1_v1 from public.option_variant_cost_versions v where v.variant_choice_id = c_a1 and v.superseded_at is null;
  perform pg_temp.scv_expect_error('未設定のつもりの古い画面からの設定は競合で拒否する', 'P0001', 'CONFLICT',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select changed::text from public.set_option_variant_cost_adjustment(%L,-20000,null,''古い画面'')', c_a1)));
  perform pg_temp.scv_expect_eq('同額・正しいVersionはno-op', '1/-30000/false',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select version_no::text || ''/'' || cost_adjustment::text || ''/'' || changed::text from public.set_option_variant_cost_adjustment(%L,-30000,%L,''同額'')', c_a1, v_c_a1_v1)));
  perform pg_temp.scv_expect_eq('調整額の変更は新しいVersionを作る', '2/-40000/true',
    pg_temp.scv_run_as('authenticated', u_admin, format(
      'select version_no::text || ''/'' || cost_adjustment::text || ''/'' || changed::text from public.set_option_variant_cost_adjustment(%L,-40000,%L,''原価差の見直し'')', c_a1, v_c_a1_v1)));
  select v.id into v_c_a1_v2 from public.option_variant_cost_versions v where v.variant_choice_id = c_a1 and v.superseded_at is null;
  perform pg_temp.scv_expect_eq('古い調整額Versionは値を変えずに閉じる', '2/1/-30000/true',
    (select count(*)::text from public.option_variant_cost_versions v where v.variant_choice_id = c_a1) || '/' ||
    (select count(*)::text from public.option_variant_cost_versions v where v.variant_choice_id = c_a1 and v.superseded_at is null) || '/' ||
    (select v.cost_adjustment::text from public.option_variant_cost_versions v where v.id = v_c_a1_v1) || '/' ||
    (select (v.superseded_by_version_id = v_c_a1_v2)::text from public.option_variant_cost_versions v where v.id = v_c_a1_v1));
  perform pg_temp.scv_expect_eq('プラスと0の調整額も設定できる', '15000/0',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select cost_adjustment::text from public.set_option_variant_cost_adjustment(%L,15000,null,''大サイズの原価差'')', c_a2)) || '/' ||
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select cost_adjustment::text from public.set_option_variant_cost_adjustment(%L,0,null,''標準仕上げは差なし'')', c_a3)));
  perform pg_temp.scv_expect_eq('調整額の設定・変更は監査履歴に残る', (v_audit_before + 4)::text || '/-30000/-40000',
    (select count(*)::text from public.audit_logs where entity = 'option_variant_cost' and entity_id = opt_a) || '/' ||
    (select (l.before ->> 'cost_adjustment') || '/' || (l.after ->> 'cost_adjustment')
       from public.audit_logs l
      where l.entity = 'option_variant_cost' and l.entity_id = opt_a and l.action = 'variant_standard_cost_update'
      order by l.created_at desc limit 1));
  perform pg_temp.scv_expect_eq('HQ editorは調整額の履歴を読め、HQ viewer・総代理店は読めない', '2/0/0',
    pg_temp.scv_run_as('authenticated', u_editor, format('select count(*)::text from public.option_variant_cost_versions where variant_choice_id=%L', c_a1)) || '/' ||
    pg_temp.scv_run_as('authenticated', u_viewer, format('select count(*)::text from public.option_variant_cost_versions where variant_choice_id=%L', c_a1)) || '/' ||
    pg_temp.scv_run_as('authenticated', u_master, format('select count(*)::text from public.option_variant_cost_versions where variant_choice_id=%L', c_a1)));
  perform pg_temp.scv_expect_error('調整額のVersionも書き換えられない', 'P0001', 'LOCKED',
    pg_temp.scv_try_super(format('update public.option_variant_cost_versions set cost_adjustment = 1 where id = %L returning id::text', v_c_a1_v2)));
  perform pg_temp.scv_expect_error('調整額のVersionも削除できない', 'P0001', 'LOCKED',
    pg_temp.scv_try_super(format('delete from public.option_variant_cost_versions where id = %L returning id::text', v_c_a1_v1)));

  -- ---------- 適用後の標準原価を 0 円未満にしない ----------

  -- 商品A：標準原価 100,000。サイズ（小 -40,000／大 +15,000）・仕上げ（標準 0／簡易 ?）。いちばん低い組み合わせは 小＋簡易
  perform pg_temp.scv_expect_error('どれかの組み合わせで0円未満になる調整額は拒否する', 'P0001', 'VALIDATION',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select changed::text from public.set_option_variant_cost_adjustment(%L,-60001,null,''簡易仕上げの原価差'')', c_a4)));
  perform pg_temp.scv_expect_eq('ちょうど0円になる調整額は設定できる', '-60000/true',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select cost_adjustment::text || ''/'' || changed::text from public.set_option_variant_cost_adjustment(%L,-60000,null,''簡易仕上げの原価差'')', c_a4)));
  perform pg_temp.scv_expect_error('調整額がある商品の原価を下げて0円未満の組み合わせを作ることはできない', 'P0001', 'VALIDATION',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select changed::text from public.set_option_hq_standard_cost(%L,99999,2,''原価の引き下げ'')', opt_a)));
  perform pg_temp.scv_expect_eq('拒否した原価の変更はVersionも写しも変えない', '2/2/100000',
    (select count(*)::text from public.option_standard_cost_versions v where v.option_id = opt_a) || '/' ||
    (select c.lock_version::text from public.option_hq_standard_costs c where c.option_id = opt_a) || '/' ||
    (select c.standard_cost::text from public.option_hq_standard_costs c where c.option_id = opt_a));

  -- 商品B：商品の原価がまだ無い間は調整額だけを先に設定でき、原価を設定するときに確かめる
  perform pg_temp.scv_expect_eq('商品の原価が未設定でも調整額は設定できる', '-5000/true',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select cost_adjustment::text || ''/'' || changed::text from public.set_option_variant_cost_adjustment(%L,-5000,null,''小サイズの原価差'')', c_b1)));
  perform pg_temp.scv_expect_error('調整額を適用すると0円未満になる商品の原価は設定できない', 'P0001', 'VALIDATION',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select changed::text from public.set_option_hq_standard_cost(%L,4999,0,''初回設定'')', opt_b)));
  perform pg_temp.scv_expect_eq('拒否した初回設定は原価のVersionも写しも作らない', '0/0',
    (select count(*)::text from public.option_standard_cost_versions v where v.option_id = opt_b) || '/' ||
    (select count(*)::text from public.option_hq_standard_costs c where c.option_id = opt_b));
  perform pg_temp.scv_expect_eq('登録済み商品にも原価を設定できる（適用後ちょうど0円）', '5000/1/true',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select standard_cost::text || ''/'' || lock_version::text || ''/'' || changed::text from public.set_option_hq_standard_cost(%L,5000,0,''初回設定'')', opt_b)));

  -- ---------- 原価の履歴がある商品・選択肢は消さない ----------

  perform pg_temp.scv_expect_eq('商品Cに調整額を設定できる', '1000/true',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select cost_adjustment::text || ''/'' || changed::text from public.set_option_variant_cost_adjustment(%L,1000,null,''小サイズの原価差'')', c_c1)));
  perform pg_temp.scv_expect_denied('調整額の履歴がある選択肢は削除できない（FK RESTRICT）', '23503',
    pg_temp.scv_try_super(format('delete from public.option_variant_choices where id = %L returning id::text', c_c1)));
  perform pg_temp.scv_expect_denied('調整額の履歴がある商品は削除できない（連鎖削除もFK RESTRICTで止める）', '23503',
    pg_temp.scv_try_super(format('delete from public.options where id = %L returning id::text', opt_c)));
  perform pg_temp.scv_expect_denied('原価の履歴がある商品は削除できない', '23503',
    pg_temp.scv_try_super(format('delete from public.options where id = %L returning id::text', opt_a)));
  perform pg_temp.scv_expect_eq('削除を止めた後も商品・選択肢・履歴が残る', '1/1/1/2',
    (select count(*)::text from public.options where id = opt_c) || '/' ||
    (select count(*)::text from public.option_variant_choices where id = c_c1) || '/' ||
    (select count(*)::text from public.option_variant_cost_versions where variant_choice_id = c_c1) || '/' ||
    (select count(*)::text from public.option_standard_cost_versions where option_id = opt_a));

  -- ---------- 本部商品の外（旧フリー商品）には本部標準原価を持たせない ----------

  perform pg_temp.scv_expect_error('本部でも旧フリー商品には商品の標準原価を設定できない', 'P0001', 'VALIDATION',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select changed::text from public.set_option_hq_standard_cost(%L,30000,0,''旧フリー商品'')', opt_free)));
  perform pg_temp.scv_expect_error('本部でも旧フリー商品の選択肢には調整額を設定できない', 'P0001', 'VALIDATION',
    pg_temp.scv_run_as('authenticated', u_owner, format(
      'select changed::text from public.set_option_variant_cost_adjustment(%L,2000,null,''旧フリー商品'')', c_free)));
  perform pg_temp.scv_expect_eq('旧フリー商品には版も写しもできない', '0/0/0',
    (select count(*) from public.option_standard_cost_versions where option_id = opt_free)::text || '/' ||
    (select count(*) from public.option_variant_cost_versions where variant_choice_id = c_free)::text || '/' ||
    (select count(*) from public.option_hq_standard_costs where option_id = opt_free)::text);
  perform pg_temp.scv_expect_eq('本部商品かどうかの判定（本部商品・旧フリー商品・存在しない商品）', 'true/false/false',
    public.option_is_hq_cost_product(opt_b)::text || '/' || public.option_is_hq_cost_product(opt_free)::text || '/' ||
    public.option_is_hq_cost_product('25000000-0000-4000-8000-0000000003ff')::text);
  perform pg_temp.scv_expect_denied('本部商品かどうかの判定は authenticated から直接実行できない（内部の部品）', '42501',
    pg_temp.scv_run_as('authenticated', u_owner, format('select public.option_is_hq_cost_product(%L)::text', opt_b)));

  -- ---------- 写しと現在の Version の一致（DB 全体） ----------

  perform pg_temp.scv_expect_eq('すべての写しが現在のVersionと同じ値を指す', '0',
    (select count(*)::text
       from public.option_hq_standard_costs c
       left join public.option_standard_cost_versions v on v.id = c.current_version_id
      where v.id is null or v.superseded_at is not null or v.option_id <> c.option_id or v.standard_cost <> c.standard_cost));
  perform pg_temp.scv_expect_eq('現在のVersionが2つある商品・選択肢は無い', '0/0',
    (select count(*)::text from (select v.option_id from public.option_standard_cost_versions v where v.superseded_at is null group by v.option_id having count(*) > 1) t) || '/' ||
    (select count(*)::text from (select v.variant_choice_id from public.option_variant_cost_versions v where v.superseded_at is null group by v.variant_choice_id having count(*) > 1) t));
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _scv_result;

rollback;
