-- 本部商品基準原価の実行時検査。使い捨てDB専用。最後にrollbackする。
begin;

create temp table _hq_cost_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _hq_cost_result to public;

create function pg_temp.hq_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.hq_try_super(p_sql text) returns text
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

create function pg_temp.hq_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _hq_cost_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.hq_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _hq_cost_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

do $test$
declare
  u_admin constant uuid := '10000000-0000-4000-8000-000000000001';
  u_owner constant uuid := '10000000-0000-4000-8000-000000000002';
  u_hq_admin constant uuid := '10000000-0000-4000-8000-000000000003';
  u_editor constant uuid := '10000000-0000-4000-8000-000000000004';
  u_viewer constant uuid := '10000000-0000-4000-8000-000000000005';
  u_master constant uuid := '10000000-0000-4000-8000-000000000006';
  u_customer constant uuid := '10000000-0000-4000-8000-000000000007';
  org_hq constant uuid := '10000000-0000-4000-8000-000000000101';
  org_master constant uuid := '10000000-0000-4000-8000-000000000102';
  cat_id constant uuid := '10000000-0000-4000-8000-000000000201';
  opt_draft constant uuid := '10000000-0000-4000-8000-000000000301';
  opt_pub constant uuid := '10000000-0000-4000-8000-000000000302';
  v_audit_before bigint;
  v_audit_after bigint;
begin
  set local session_replication_role = replica;

  insert into auth.users (id, email, raw_user_meta_data)
  values
    (u_admin, 'hq-cost-admin@runtime.invalid', '{}'::jsonb),
    (u_owner, 'hq-cost-owner@runtime.invalid', '{}'::jsonb),
    (u_hq_admin, 'hq-cost-hqadmin@runtime.invalid', '{}'::jsonb),
    (u_editor, 'hq-cost-editor@runtime.invalid', '{}'::jsonb),
    (u_viewer, 'hq-cost-viewer@runtime.invalid', '{}'::jsonb),
    (u_master, 'hq-cost-master@runtime.invalid', '{}'::jsonb),
    (u_customer, 'hq-cost-customer@runtime.invalid', '{}'::jsonb);

  insert into public.profiles (id, email, full_name, role_code)
  values
    (u_admin, 'hq-cost-admin@runtime.invalid', 'global admin', 'admin'),
    (u_owner, 'hq-cost-owner@runtime.invalid', 'HQ owner', 'customer'),
    (u_hq_admin, 'hq-cost-hqadmin@runtime.invalid', 'HQ admin', 'customer'),
    (u_editor, 'hq-cost-editor@runtime.invalid', 'HQ editor', 'customer'),
    (u_viewer, 'hq-cost-viewer@runtime.invalid', 'HQ viewer', 'customer'),
    (u_master, 'hq-cost-master@runtime.invalid', 'master dealer', 'master_dealer'),
    (u_customer, 'hq-cost-customer@runtime.invalid', 'customer', 'customer');

  insert into public.organizations (id, code, name, organization_type, status)
  values
    (org_hq, 'runtime-hq-cost-hq', 'HQ Cost Runtime HQ', 'headquarters', 'active'),
    (org_master, 'runtime-hq-cost-master', 'HQ Cost Runtime Master', 'master_dealer', 'active');

  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values
    (org_hq, u_owner, 'owner', 'active'),
    (org_hq, u_hq_admin, 'admin', 'active'),
    (org_hq, u_editor, 'editor', 'active'),
    (org_hq, u_viewer, 'viewer', 'active'),
    (org_master, u_master, 'owner', 'active');

  insert into public.option_categories (id, code, name, status)
  values (cat_id, 'runtime-hq-cost-category', '本部基準原価Runtime', 'published');

  insert into public.options (id, category_id, code, name, price, status, product_no)
  values
    (opt_draft, cat_id, 'runtime-hq-cost-draft', '原価Runtime下書き', 150000, 'draft', 'PRD-999991'),
    (opt_pub, cat_id, 'runtime-hq-cost-published', '原価Runtime登録済み', 180000, 'published', 'PRD-999992');

  set local session_replication_role = origin;

  perform pg_temp.hq_expect_denied('原価helperはanonから直接実行できない', '42501',
    pg_temp.hq_run_as('anon', null, 'select public.can_view_option_hq_standard_cost()::text'));
  perform pg_temp.hq_expect_denied('原価テーブルはanonから直接読めない', '42501',
    pg_temp.hq_run_as('anon', null, 'select count(*)::text from public.option_hq_standard_costs'));
  perform pg_temp.hq_expect_denied('原価テーブルはservice_roleから直接読めない', '42501',
    pg_temp.hq_run_as('service_role', null, 'select count(*)::text from public.option_hq_standard_costs'));

  perform pg_temp.hq_expect_eq('global adminは閲覧・更新可能', 'true/true',
    pg_temp.hq_run_as('authenticated', u_admin, 'select public.can_view_option_hq_standard_cost()::text || ''/'' || public.can_manage_option_hq_standard_cost()::text'));
  perform pg_temp.hq_expect_eq('HQ ownerは閲覧・更新可能', 'true/true',
    pg_temp.hq_run_as('authenticated', u_owner, 'select public.can_view_option_hq_standard_cost()::text || ''/'' || public.can_manage_option_hq_standard_cost()::text'));
  perform pg_temp.hq_expect_eq('HQ adminは閲覧・更新可能', 'true/true',
    pg_temp.hq_run_as('authenticated', u_hq_admin, 'select public.can_view_option_hq_standard_cost()::text || ''/'' || public.can_manage_option_hq_standard_cost()::text'));
  perform pg_temp.hq_expect_eq('HQ editorは閲覧のみ', 'true/false',
    pg_temp.hq_run_as('authenticated', u_editor, 'select public.can_view_option_hq_standard_cost()::text || ''/'' || public.can_manage_option_hq_standard_cost()::text'));
  perform pg_temp.hq_expect_eq('HQ viewerは原価権限なし', 'false/false',
    pg_temp.hq_run_as('authenticated', u_viewer, 'select public.can_view_option_hq_standard_cost()::text || ''/'' || public.can_manage_option_hq_standard_cost()::text'));
  perform pg_temp.hq_expect_eq('総代理店は原価権限なし', 'false/false',
    pg_temp.hq_run_as('authenticated', u_master, 'select public.can_view_option_hq_standard_cost()::text || ''/'' || public.can_manage_option_hq_standard_cost()::text'));
  perform pg_temp.hq_expect_eq('customerは原価権限なし', 'false/false',
    pg_temp.hq_run_as('authenticated', u_customer, 'select public.can_view_option_hq_standard_cost()::text || ''/'' || public.can_manage_option_hq_standard_cost()::text'));

  perform pg_temp.hq_expect_denied('HQ ownerでも原価テーブルへ直接INSERTできない', '42501',
    pg_temp.hq_run_as('authenticated', u_owner, format(
      'insert into public.option_hq_standard_costs(option_id,standard_cost) values (%L,1) returning standard_cost::text', opt_draft)));

  select count(*) into v_audit_before from public.audit_logs where entity = 'option_hq_standard_cost' and entity_id = opt_draft;
  perform pg_temp.hq_expect_eq('adminは未設定商品へ0円を明示設定できる', '0/1/true',
    pg_temp.hq_run_as('authenticated', u_admin, format(
      'select standard_cost::text || ''/'' || lock_version::text || ''/'' || changed::text from public.set_option_hq_standard_cost(%L,0,0,''初回0円設定'')', opt_draft)));
  perform pg_temp.hq_expect_eq('未設定と0円は行の有無で区別される', '1/0/0',
    (select count(*)::text from public.option_hq_standard_costs where option_id = opt_draft) || '/' ||
    (select standard_cost::text from public.option_hq_standard_costs where option_id = opt_draft) || '/' ||
    (select count(*)::text from public.option_hq_standard_costs where option_id = opt_pub));

  perform pg_temp.hq_expect_eq('HQ editorは設定済み原価を読める', '1',
    pg_temp.hq_run_as('authenticated', u_editor, format('select count(*)::text from public.option_hq_standard_costs where option_id=%L', opt_draft)));
  perform pg_temp.hq_expect_eq('HQ viewerは設定済み原価を読めない', '0',
    pg_temp.hq_run_as('authenticated', u_viewer, format('select count(*)::text from public.option_hq_standard_costs where option_id=%L', opt_draft)));
  perform pg_temp.hq_expect_eq('総代理店は設定済み原価を読めない', '0',
    pg_temp.hq_run_as('authenticated', u_master, format('select count(*)::text from public.option_hq_standard_costs where option_id=%L', opt_draft)));
  perform pg_temp.hq_expect_denied('HQ editorはRPCで原価変更できない', '42501',
    pg_temp.hq_run_as('authenticated', u_editor, format('select changed::text from public.set_option_hq_standard_cost(%L,100000,1,''editor変更'')', opt_draft)));

  perform pg_temp.hq_expect_eq('HQ ownerは正しいversionで更新できる', '100000/2/true',
    pg_temp.hq_run_as('authenticated', u_owner, format(
      'select standard_cost::text || ''/'' || lock_version::text || ''/'' || changed::text from public.set_option_hq_standard_cost(%L,100000,1,''基準原価改定'')', opt_draft)));
  perform pg_temp.hq_expect_denied('古いversionの更新は競合で拒否する', 'P0001',
    pg_temp.hq_run_as('authenticated', u_hq_admin, format('select changed::text from public.set_option_hq_standard_cost(%L,110000,1,''stale更新'')', opt_draft)));

  select count(*) into v_audit_after from public.audit_logs where entity = 'option_hq_standard_cost' and entity_id = opt_draft;
  perform pg_temp.hq_expect_eq('初回設定と変更は2件の監査履歴になる', (v_audit_before + 2)::text, v_audit_after::text);
  perform pg_temp.hq_expect_eq('同額・正しいversionはno-op', '100000/2/false',
    pg_temp.hq_run_as('authenticated', u_hq_admin, format(
      'select standard_cost::text || ''/'' || lock_version::text || ''/'' || changed::text from public.set_option_hq_standard_cost(%L,100000,2,''同額確認'')', opt_draft)));
  perform pg_temp.hq_expect_eq('no-opでは監査履歴を増やさない', v_audit_after::text,
    (select count(*)::text from public.audit_logs where entity = 'option_hq_standard_cost' and entity_id = opt_draft));

  perform pg_temp.hq_expect_eq('監査履歴にbefore/after・商品・理由を残す', '0/100000/PRD-999991/原価Runtime下書き/基準原価改定',
    (select (before ->> 'standard_cost') || '/' || (after ->> 'standard_cost') || '/' ||
            (after ->> 'product_no') || '/' || (after ->> 'product_name') || '/' || (after ->> 'change_reason')
     from public.audit_logs
     where entity = 'option_hq_standard_cost' and entity_id = opt_draft and action = 'hq_standard_cost_update'
     order by created_at desc limit 1));

  perform pg_temp.hq_expect_denied('変更理由空欄は拒否する', 'P0001',
    pg_temp.hq_run_as('authenticated', u_owner, format('select changed::text from public.set_option_hq_standard_cost(%L,100001,2,'''')', opt_draft)));
  perform pg_temp.hq_expect_denied('初回設定でexpected versionが0以外なら拒否する', 'P0001',
    pg_temp.hq_run_as('authenticated', u_owner, format('select changed::text from public.set_option_hq_standard_cost(%L,90000,1,''誤version'')', opt_pub)));
  perform pg_temp.hq_expect_eq('published商品にも基準原価を設定できる', '90000/1/true',
    pg_temp.hq_run_as('authenticated', u_hq_admin, format(
      'select standard_cost::text || ''/'' || lock_version::text || ''/'' || changed::text from public.set_option_hq_standard_cost(%L,90000,0,''登録済み商品設定'')', opt_pub)));

  perform pg_temp.hq_expect_denied('基準原価がある商品は通常DELETEをFK RESTRICTで止める', '23503',
    pg_temp.hq_try_super(format('delete from public.options where id=%L returning id::text', opt_pub)));
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _hq_cost_result;

rollback;
