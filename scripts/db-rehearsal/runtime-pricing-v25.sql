-- v2.5 PR-A2：計算ルール・税ルールの Version と正式計算の関数の実行時検査（権限・変えられないこと）。使い捨てDB専用。最後にrollbackする。
-- 計算結果の突き合わせ（テストベクトル・DB と TypeScript の一致）は runtime-pricing-v25.mjs が行う。
begin;

create temp table _prv_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _prv_result to public;

create function pg_temp.prv_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.prv_try_super(p_sql text) returns text
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

create function pg_temp.prv_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _prv_result (step, expected, actual, ok)
  values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.prv_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _prv_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

create function pg_temp.prv_expect_error(p_step text, p_code text, p_kind text, p_actual text) returns void
language sql as $fn$
  insert into _prv_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || ' ' || p_kind || '）', p_actual, p_actual like 'ERROR ' || p_code || ': ' || p_kind || ':%');
$fn$;

do $test$
declare
  u_admin constant uuid := '25000000-0000-4000-8000-000000000021';
  u_owner constant uuid := '25000000-0000-4000-8000-000000000022';
  u_editor constant uuid := '25000000-0000-4000-8000-000000000023';
  u_viewer constant uuid := '25000000-0000-4000-8000-000000000024';
  u_master constant uuid := '25000000-0000-4000-8000-000000000025';
  u_customer constant uuid := '25000000-0000-4000-8000-000000000026';
  org_hq constant uuid := '25000000-0000-4000-8000-000000000121';
  org_master constant uuid := '25000000-0000-4000-8000-000000000122';
  v_calc uuid;
  v_tax uuid;
  v_next uuid := gen_random_uuid();
  v_input text := '{"rates":{"sales_fee_rate":"1","markup_rate":"1.5","expense_rate":"0.15"},"sections":[{"code":"base","lines":[{"key":"b1","mode":"auto","quantity":"1","standard_cost":100000}]}]}';
begin
  set local session_replication_role = replica;

  insert into auth.users (id, email, raw_user_meta_data)
  values
    (u_admin, 'prv-admin@runtime.invalid', '{}'::jsonb),
    (u_owner, 'prv-owner@runtime.invalid', '{}'::jsonb),
    (u_editor, 'prv-editor@runtime.invalid', '{}'::jsonb),
    (u_viewer, 'prv-viewer@runtime.invalid', '{}'::jsonb),
    (u_master, 'prv-master@runtime.invalid', '{}'::jsonb),
    (u_customer, 'prv-customer@runtime.invalid', '{}'::jsonb);

  insert into public.profiles (id, email, full_name, role_code)
  values
    (u_admin, 'prv-admin@runtime.invalid', 'global admin', 'admin'),
    (u_owner, 'prv-owner@runtime.invalid', 'HQ owner', 'customer'),
    (u_editor, 'prv-editor@runtime.invalid', 'HQ editor', 'customer'),
    (u_viewer, 'prv-viewer@runtime.invalid', 'HQ viewer', 'customer'),
    (u_master, 'prv-master@runtime.invalid', 'master dealer', 'master_dealer'),
    (u_customer, 'prv-customer@runtime.invalid', 'customer', 'customer');

  insert into public.organizations (id, code, name, organization_type, status)
  values
    (org_hq, 'runtime-prv-hq', 'Pricing Rule Version HQ', 'headquarters', 'active'),
    (org_master, 'runtime-prv-master', 'Pricing Rule Version Master', 'master_dealer', 'active');

  insert into public.organization_memberships (organization_id, profile_id, member_role, status)
  values
    (org_hq, u_owner, 'owner', 'active'),
    (org_hq, u_editor, 'editor', 'active'),
    (org_hq, u_viewer, 'viewer', 'active'),
    (org_master, u_master, 'owner', 'active');

  set local session_replication_role = origin;

  select r.id into v_calc from public.pricing_calculation_rule_versions r where r.superseded_at is null;
  select t.id into v_tax from public.tax_rule_versions t where t.superseded_at is null;

  -- ---------- 初期の Version ----------

  perform pg_temp.prv_expect_eq('初期の計算ルールはv2.5の式・trunc・経費対象4区分で、現在有効は1つ', 'CALC-V25-1/v2.5/trunc/{base,interior_exterior,option,sitework}/1',
    (select r.code || '/' || r.formula_code || '/' || r.rounding_mode || '/' || r.expense_target_sections::text from public.pricing_calculation_rule_versions r where r.id = v_calc) || '/' ||
    (select count(*)::text from public.pricing_calculation_rule_versions r where r.superseded_at is null));
  perform pg_temp.prv_expect_eq('初期の税ルールは全額課税・単一税率10%・truncで、現在有効は1つ', 'TAX-10-1/full_single_rate/0.100000/trunc/1',
    (select t.code || '/' || t.tax_mode || '/' || t.tax_rate::text || '/' || t.rounding_mode from public.tax_rule_versions t where t.id = v_tax) || '/' ||
    (select count(*)::text from public.tax_rule_versions t where t.superseded_at is null));

  -- ---------- 読める人 ----------

  perform pg_temp.prv_expect_denied('計算ルールはanonから読めない', '42501',
    pg_temp.prv_run_as('anon', null, 'select count(*)::text from public.pricing_calculation_rule_versions'));
  perform pg_temp.prv_expect_denied('税ルールはanonから読めない', '42501',
    pg_temp.prv_run_as('anon', null, 'select count(*)::text from public.tax_rule_versions'));
  perform pg_temp.prv_expect_denied('計算ルールはservice_roleから読めない', '42501',
    pg_temp.prv_run_as('service_role', null, 'select count(*)::text from public.pricing_calculation_rule_versions'));
  perform pg_temp.prv_expect_eq('global adminは計算ルール・税ルールを読める', '1/1',
    pg_temp.prv_run_as('authenticated', u_admin, 'select (select count(*) from public.pricing_calculation_rule_versions)::text || ''/'' || (select count(*) from public.tax_rule_versions)::text'));
  perform pg_temp.prv_expect_eq('本部のeditorは計算ルール・税ルールを読める', '1/1',
    pg_temp.prv_run_as('authenticated', u_editor, 'select (select count(*) from public.pricing_calculation_rule_versions)::text || ''/'' || (select count(*) from public.tax_rule_versions)::text'));
  perform pg_temp.prv_expect_eq('本部のviewerは読めない', '0/0',
    pg_temp.prv_run_as('authenticated', u_viewer, 'select (select count(*) from public.pricing_calculation_rule_versions)::text || ''/'' || (select count(*) from public.tax_rule_versions)::text'));
  perform pg_temp.prv_expect_eq('総代理店は読めない', '0/0',
    pg_temp.prv_run_as('authenticated', u_master, 'select (select count(*) from public.pricing_calculation_rule_versions)::text || ''/'' || (select count(*) from public.tax_rule_versions)::text'));
  perform pg_temp.prv_expect_eq('customerは読めない', '0/0',
    pg_temp.prv_run_as('authenticated', u_customer, 'select (select count(*) from public.pricing_calculation_rule_versions)::text || ''/'' || (select count(*) from public.tax_rule_versions)::text'));

  -- ---------- 書き込み・実行の境界 ----------

  perform pg_temp.prv_expect_denied('本部のownerでも計算ルールを直接追加できない', '42501',
    pg_temp.prv_run_as('authenticated', u_owner,
      'insert into public.pricing_calculation_rule_versions(code,version_no,formula_code,expense_target_sections,description) values (''CALC-X'',9,''v2.5'',''{}'',''直接'') returning id::text'));
  perform pg_temp.prv_expect_denied('本部のownerでも税ルールを直接変更できない', '42501',
    pg_temp.prv_run_as('authenticated', u_owner, 'update public.tax_rule_versions set description = ''変更'' returning id::text'));
  perform pg_temp.prv_expect_denied('正式計算の関数はanonから実行できない', '42501',
    pg_temp.prv_run_as('anon', null, format('select public.pricing_calculate(%L,%L,%L::jsonb)::text', v_calc, v_tax, v_input)));
  perform pg_temp.prv_expect_denied('正式計算の関数はログインした利用者から直接実行できない（原価・率を渡して計算させない）', '42501',
    pg_temp.prv_run_as('authenticated', u_admin, format('select public.pricing_calculate(%L,%L,%L::jsonb)::text', v_calc, v_tax, v_input)));
  perform pg_temp.prv_expect_denied('正式計算の関数はservice_roleから実行できない', '42501',
    pg_temp.prv_run_as('service_role', null, format('select public.pricing_calculate(%L,%L,%L::jsonb)::text', v_calc, v_tax, v_input)));
  perform pg_temp.prv_expect_denied('入力の検査の部品はログインした利用者から実行できない', '42501',
    pg_temp.prv_run_as('authenticated', u_admin, 'select public.pricing_input_decimal(''1''::jsonb, ''x'', 4)::text'));

  -- ---------- Version は変えられない（DB 管理者でも） ----------

  perform pg_temp.prv_expect_error('計算ルールの中身は書き換えられない', 'P0001', 'LOCKED',
    pg_temp.prv_try_super(format('update public.pricing_calculation_rule_versions set expense_target_sections = ''{base}'' where id = %L returning id::text', v_calc)));
  perform pg_temp.prv_expect_error('税率は書き換えられない', 'P0001', 'LOCKED',
    pg_temp.prv_try_super(format('update public.tax_rule_versions set tax_rate = 0.08 where id = %L returning id::text', v_tax)));
  perform pg_temp.prv_expect_error('計算ルールは削除できない', 'P0001', 'LOCKED',
    pg_temp.prv_try_super(format('delete from public.pricing_calculation_rule_versions where id = %L returning id::text', v_calc)));
  perform pg_temp.prv_expect_error('税ルールは削除できない', 'P0001', 'LOCKED',
    pg_temp.prv_try_super(format('delete from public.tax_rule_versions where id = %L returning id::text', v_tax)));
  perform pg_temp.prv_expect_denied('現在有効な税ルールを2つにはできない（一意制約）', '23505',
    pg_temp.prv_try_super(
      'insert into public.tax_rule_versions(code,version_no,tax_mode,tax_rate,description) values (''TAX-8-2'',2,''full_single_rate'',0.08,''二重'') returning id::text'));
  perform pg_temp.prv_expect_denied('対応していない計算の式は登録できない', '23514',
    pg_temp.prv_try_super(format(
      'insert into public.pricing_calculation_rule_versions(code,version_no,formula_code,expense_target_sections,description,superseded_at,superseded_by_version_id) values (''CALC-LEGACY'',7,''legacy'',''{}'',''旧式'',now(),%L) returning id::text', v_calc)));
  perform pg_temp.prv_expect_denied('知らない区分を経費対象にできない', '23514',
    pg_temp.prv_try_super(format(
      'insert into public.pricing_calculation_rule_versions(code,version_no,formula_code,expense_target_sections,description,superseded_at,superseded_by_version_id) values (''CALC-BAD'',8,''v2.5'',''{discount}'',''不正'',now(),%L) returning id::text', v_calc)));

  -- 新しい Version への切替（将来の migration の手順）：現在の Version を閉じてから、新しい Version を作る
  perform pg_temp.prv_expect_eq('現在の税ルールを閉じて新しいVersionを作れる（切替は1回だけ）', 'ok',
    pg_temp.prv_try_super(format(
      'with closed as (update public.tax_rule_versions set superseded_at = now(), superseded_by_version_id = %L where id = %L returning id)
       insert into public.tax_rule_versions(id,code,version_no,tax_mode,tax_rate,description) select %L,''TAX-TEST-2'',2,''full_single_rate'',0.100000,''切替の確認'' from closed returning ''ok''',
      v_next, v_tax, v_next)));
  perform pg_temp.prv_expect_eq('切替の後も現在有効は1つで、古いVersionは値を変えずに閉じている', '1/0.100000/true',
    (select count(*)::text from public.tax_rule_versions t where t.superseded_at is null) || '/' ||
    (select t.tax_rate::text from public.tax_rule_versions t where t.id = v_tax) || '/' ||
    (select (t.superseded_by_version_id = v_next)::text from public.tax_rule_versions t where t.id = v_tax));
  perform pg_temp.prv_expect_error('閉じたVersionは開き直せない', 'P0001', 'LOCKED',
    pg_temp.prv_try_super(format('update public.tax_rule_versions set superseded_at = null, superseded_by_version_id = null where id = %L returning id::text', v_tax)));
  perform pg_temp.prv_expect_eq('閉じた（過去の）税ルールでも、固定した見積の再計算に使える', '172500/17250',
    pg_temp.prv_try_super(format('select r ->> ''adjusted_subtotal'' || ''/'' || (r ->> ''tax'') from (select public.pricing_calculate(%L,%L,%L::jsonb) as r) x', v_calc, v_tax, v_input)));
end;
$test$;

select jsonb_agg(jsonb_build_object(
  'step', step,
  'expected', expected,
  'actual', actual,
  'ok', ok
) order by seq) as j
from _prv_result;

rollback;
