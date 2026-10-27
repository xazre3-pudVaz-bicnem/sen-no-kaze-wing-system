-- お客様が代理店を選ぶ（20261016160000）の実行時検査。使い捨て DB 専用。最後に rollback する。
begin;

create temp table _cd_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _cd_result to public;

create function pg_temp.cd_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.cd_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _cd_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

do $test$
declare
  u_admin constant uuid := '60000000-0000-4000-8000-000000000001';
  u_d_mgr constant uuid := '60000000-0000-4000-8000-000000000002';
  u_d_staff constant uuid := '60000000-0000-4000-8000-000000000003';
  u_lone constant uuid := '60000000-0000-4000-8000-000000000004';
  u_nomgr constant uuid := '60000000-0000-4000-8000-000000000005';
  u_cust constant uuid := '60000000-0000-4000-8000-000000000006';
  u_md_mgr constant uuid := '60000000-0000-4000-8000-000000000007';
  o_md constant uuid := '61000000-0000-4000-8000-000000000001';
  o_d constant uuid := '61000000-0000-4000-8000-000000000002';
  o_nomgr constant uuid := '61000000-0000-4000-8000-000000000003';
  m_model constant uuid := '62000000-0000-4000-8000-000000000001';
  c_1 constant uuid := '63000000-0000-4000-8000-000000000001';
  c_2 constant uuid := '63000000-0000-4000-8000-000000000002';
  c_3 constant uuid := '63000000-0000-4000-8000-000000000003';
  c_4 constant uuid := '63000000-0000-4000-8000-000000000004';
  r_1 constant uuid := '64000000-0000-4000-8000-000000000001';
  r_2 constant uuid := '64000000-0000-4000-8000-000000000002';
  r_3 constant uuid := '64000000-0000-4000-8000-000000000003';
  r_4 constant uuid := '64000000-0000-4000-8000-000000000004';
  v_out text;
  v_admin_before bigint;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  select v.id, v.email, '{}'::jsonb
    from (values
      (u_admin, 'cd-admin@runtime.invalid'), (u_d_mgr, 'cd-d-mgr@runtime.invalid'), (u_d_staff, 'cd-d-staff@runtime.invalid'),
      (u_lone, 'cd-lone@runtime.invalid'), (u_nomgr, 'cd-nomgr@runtime.invalid'), (u_cust, 'cd-cust@runtime.invalid'),
      (u_md_mgr, 'cd-md-mgr@runtime.invalid')
    ) as v(id, email);
  insert into public.profiles (id, email, full_name, role_code)
  values
    (u_admin, 'cd-admin@runtime.invalid', '本部', 'admin'),
    (u_d_mgr, 'cd-d-mgr@runtime.invalid', '選ばれる代理店 管理者', 'dealer'),
    (u_d_staff, 'cd-d-staff@runtime.invalid', '選ばれる代理店 担当者', 'dealer'),
    (u_lone, 'cd-lone@runtime.invalid', '組織に入っていない代理店', 'dealer'),
    (u_nomgr, 'cd-nomgr@runtime.invalid', '管理者のいない組織の担当者', 'dealer'),
    (u_cust, 'cd-cust@runtime.invalid', 'お客様', 'customer'),
    (u_md_mgr, 'cd-md-mgr@runtime.invalid', '直属の総代理店 管理者', 'master_dealer');
  insert into public.organizations (id, code, name, organization_type, parent_organization_id)
  values
    (o_md, 'RT-CD-MD', '選択検査総代理店', 'master_dealer', null),
    (o_d, 'RT-CD-D', '選択検査代理店', 'dealer', o_md),
    (o_nomgr, 'RT-CD-NOMGR', '管理者のいない代理店', 'dealer', o_md);
  insert into public.organization_memberships (organization_id, profile_id, member_role, status, is_primary)
  values
    (o_md, u_md_mgr, 'admin', 'active', true),
    (o_d, u_d_mgr, 'admin', 'active', true),
    (o_d, u_d_staff, 'editor', 'active', true),
    (o_nomgr, u_nomgr, 'editor', 'active', true);
  insert into public.dealer_profiles (dealer_id, display_name, published, published_at)
  values (u_d_staff, '選ばれる代理店', true, now()),
         (u_lone, '組織に入っていない代理店', true, now()),
         (u_nomgr, '管理者のいない代理店', true, now());
  insert into public.base_models (id, slug, name, base_price, status)
  values (m_model, 'runtime-cd-model', '選択検査用モデル', 1000000, 'published') on conflict (slug) do nothing;
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (c_1, u_cust, m_model, '組織の代理店を選ぶ', 'quote_requested', 'office', 'full'),
         (c_2, u_cust, m_model, '組織に入っていない代理店を選ぶ', 'quote_requested', 'office', 'full'),
         (c_3, u_cust, m_model, '管理者のいない組織の代理店を選ぶ', 'quote_requested', 'office', 'full'),
         (c_4, u_cust, m_model, '営業担当が決まった後に選ぶ', 'quote_requested', 'office', 'full');
  insert into public.quote_requests (id, configuration_id, user_id, status, contact)
  values (r_1, c_1, u_cust, 'new', '{}'::jsonb), (r_2, c_2, u_cust, 'new', '{}'::jsonb),
         (r_3, c_3, u_cust, 'new', '{}'::jsonb), (r_4, c_4, u_cust, 'new', '{}'::jsonb);
  set local session_replication_role = origin;

  -- ---------- 組織に所属する代理店の紹介ページを選ぶ → その組織が営業担当、製造担当は直属の総代理店 ----------
  select count(*) into v_admin_before from public.notifications where audience = 'admin' and kind = 'case_preferred_dealer';
  v_out := pg_temp.cd_run_as('authenticated', u_cust,
    format($q$ select public.set_quote_request_preferences(%L, jsonb_build_object('preferred_dealer_id', %L))::text $q$, r_1, u_d_staff));
  perform pg_temp.cd_expect_eq('28-1 組織に所属する代理店（担当者）の紹介ページを選ぶと、その組織が営業担当になり、製造担当は直属の総代理店になる',
    '/選択検査代理店/選択検査総代理店/true/選択検査代理店',
    v_out || '/' ||
    (select s.name || '/' || m.name || '/' || w.manufacturing_auto::text
       from public.case_workflows w
       join public.organizations s on s.id = w.sales_organization_id
       join public.organizations m on m.id = w.manufacturing_organization_id
      where w.quote_request_id = r_1) || '/' ||
    (select o.name from public.quote_request_preferences p join public.organizations o on o.id = p.preferred_organization_id where p.quote_request_id = r_1));
  perform pg_temp.cd_expect_eq('28-2 組織の管理者に届き、本部には「担当代理店を割り当てて」ではなく「営業担当にした」が届く', 'true/true/0',
    ((select count(*) from public.notifications where recipient_id = u_d_mgr and kind = 'case_sales_assigned') > 0)::text || '/' ||
    ((select count(*) from public.notifications where audience = 'admin' and kind = 'case_sales_assigned' and link like '%' || r_1::text) > 0)::text || '/' ||
    ((select count(*) from public.notifications where audience = 'admin' and kind = 'case_preferred_dealer') - v_admin_before)::text);
  perform pg_temp.cd_expect_eq('28-3 組織の管理者は案件を開け（manager）、選ばれた担当者はまだ主担当者ではない', 'manager/(null)',
    pg_temp.cd_run_as('authenticated', u_d_mgr, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cd_run_as('authenticated', u_d_staff, format('select public.case_role(%L)', r_1)));

  -- ---------- 組織に所属していない代理店・管理者のいない組織の代理店は、これまでどおり本部が担当を決める ----------
  perform pg_temp.cd_run_as('authenticated', u_cust,
    format($q$ select public.set_quote_request_preferences(%L, jsonb_build_object('preferred_dealer_id', %L))::text $q$, r_2, u_lone));
  perform pg_temp.cd_expect_eq('28-4 組織に所属していない代理店を選ぶと、営業担当は決めず、本部に「相談したい代理店」が届く', '(none)/(none)/true',
    coalesce((select w.sales_organization_id::text from public.case_workflows w where w.quote_request_id = r_2), '(none)') || '/' ||
    coalesce((select p.preferred_organization_id::text from public.quote_request_preferences p where p.quote_request_id = r_2), '(none)') || '/' ||
    ((select count(*) from public.notifications where audience = 'admin' and kind = 'case_preferred_dealer' and link like '%' || r_2::text) > 0)::text);
  perform pg_temp.cd_run_as('authenticated', u_cust,
    format($q$ select public.set_quote_request_preferences(%L, jsonb_build_object('preferred_dealer_id', %L))::text $q$, r_3, u_nomgr));
  perform pg_temp.cd_expect_eq('28-5 管理者のいない組織の代理店を選んでも、営業担当にはしない（受けられる人がいないため）', '(none)',
    coalesce((select w.sales_organization_id::text from public.case_workflows w where w.quote_request_id = r_3), '(none)'));

  -- ---------- 営業担当が決まった後は、お客様の選択では変えない ----------
  perform pg_temp.cd_run_as('authenticated', u_admin, format('select public.set_case_sales_organization(%L, %L)::text', r_4, o_md));
  perform pg_temp.cd_run_as('authenticated', u_cust,
    format($q$ select public.set_quote_request_preferences(%L, jsonb_build_object('preferred_dealer_id', %L))::text $q$, r_4, u_d_staff));
  perform pg_temp.cd_expect_eq('28-6 営業担当が決まった後に代理店を選んでも営業担当は変わらず、本部に「相談したい代理店」が届く', '選択検査総代理店/true',
    (select s.name from public.case_workflows w join public.organizations s on s.id = w.sales_organization_id where w.quote_request_id = r_4) || '/' ||
    ((select count(*) from public.notifications where audience = 'admin' and kind = 'case_preferred_dealer' and link like '%' || r_4::text) > 0)::text);

  -- ---------- 所属を外れた代理店は、組織の候補にしない ----------
  update public.organization_memberships set status = 'inactive' where profile_id = u_d_staff;
  delete from public.case_workflows where quote_request_id = r_1;
  perform pg_temp.cd_run_as('authenticated', u_cust,
    format($q$ select public.set_quote_request_preferences(%L, jsonb_build_object('preferred_dealer_id', %L))::text $q$, r_1, u_d_staff));
  perform pg_temp.cd_expect_eq('28-7 所属を外れた代理店の紹介ページを選んでも、もとの組織を営業担当にしない', '(none)',
    coalesce((select w.sales_organization_id::text from public.case_workflows w where w.quote_request_id = r_1), '(none)'));
end;
$test$;

select jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq) as j
from _cd_result;

rollback;
