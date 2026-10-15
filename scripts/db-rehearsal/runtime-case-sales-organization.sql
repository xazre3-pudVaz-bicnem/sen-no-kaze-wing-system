-- 案件の営業担当組織・主担当者・製造担当組織（20261015130000）の実行時検査。使い捨て DB 専用。最後に rollback する。
begin;

create temp table _cs_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _cs_result to public;

create function pg_temp.cs_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.cs_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _cs_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.cs_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _cs_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

do $test$
declare
  u_admin constant uuid := '30000000-0000-4000-8000-000000000001';
  u_d_mgr constant uuid := '30000000-0000-4000-8000-000000000002';
  u_d_staff constant uuid := '30000000-0000-4000-8000-000000000003';
  u_d_staff2 constant uuid := '30000000-0000-4000-8000-000000000004';
  u_md_mgr constant uuid := '30000000-0000-4000-8000-000000000005';
  u_md_staff constant uuid := '30000000-0000-4000-8000-000000000006';
  u_d2_mgr constant uuid := '30000000-0000-4000-8000-000000000007';
  u_md2_mgr constant uuid := '30000000-0000-4000-8000-000000000008';
  u_cust constant uuid := '30000000-0000-4000-8000-000000000009';
  u_legacy constant uuid := '30000000-0000-4000-8000-000000000010';
  u_cust2 constant uuid := '30000000-0000-4000-8000-000000000011';
  o_md constant uuid := '31000000-0000-4000-8000-000000000001';
  o_d constant uuid := '31000000-0000-4000-8000-000000000002';
  o_d2 constant uuid := '31000000-0000-4000-8000-000000000003';
  o_md2 constant uuid := '31000000-0000-4000-8000-000000000004';
  o_d3 constant uuid := '31000000-0000-4000-8000-000000000005';
  m_model constant uuid := '32000000-0000-4000-8000-000000000001';
  c_1 constant uuid := '33000000-0000-4000-8000-000000000001';
  c_legacy constant uuid := '33000000-0000-4000-8000-000000000002';
  r_1 constant uuid := '34000000-0000-4000-8000-000000000001';
  r_legacy constant uuid := '34000000-0000-4000-8000-000000000002';
  q_1a constant uuid := '35000000-0000-4000-8000-000000000001';
  q_1b constant uuid := '35000000-0000-4000-8000-000000000002';
  q_legacy constant uuid := '35000000-0000-4000-8000-000000000003';
  k_1 constant uuid := '36000000-0000-4000-8000-000000000001';
  mo_1 constant uuid := '37000000-0000-4000-8000-000000000001';
  v_out text;
  v_notifications_before bigint;
  v_membership uuid;
  v_lock integer;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  select v.id, v.email, '{}'::jsonb
    from (values
      (u_admin, 'cs-admin@runtime.invalid'), (u_d_mgr, 'cs-d-mgr@runtime.invalid'), (u_d_staff, 'cs-d-staff@runtime.invalid'),
      (u_d_staff2, 'cs-d-staff2@runtime.invalid'), (u_md_mgr, 'cs-md-mgr@runtime.invalid'), (u_md_staff, 'cs-md-staff@runtime.invalid'),
      (u_d2_mgr, 'cs-d2-mgr@runtime.invalid'), (u_md2_mgr, 'cs-md2-mgr@runtime.invalid'), (u_cust, 'cs-cust@runtime.invalid'),
      (u_legacy, 'cs-legacy@runtime.invalid'), (u_cust2, 'cs-cust2@runtime.invalid')
    ) as v(id, email);
  insert into public.profiles (id, email, full_name, role_code)
  values
    (u_admin, 'cs-admin@runtime.invalid', '本部', 'admin'),
    (u_d_mgr, 'cs-d-mgr@runtime.invalid', '代理店 管理者', 'dealer'),
    (u_d_staff, 'cs-d-staff@runtime.invalid', '代理店 担当者A', 'dealer'),
    (u_d_staff2, 'cs-d-staff2@runtime.invalid', '代理店 担当者B', 'dealer'),
    (u_md_mgr, 'cs-md-mgr@runtime.invalid', '総代理店 管理者', 'master_dealer'),
    (u_md_staff, 'cs-md-staff@runtime.invalid', '総代理店 担当者', 'master_dealer'),
    (u_d2_mgr, 'cs-d2-mgr@runtime.invalid', '別の代理店 管理者', 'dealer'),
    (u_md2_mgr, 'cs-md2-mgr@runtime.invalid', '別の総代理店 管理者', 'master_dealer'),
    (u_cust, 'cs-cust@runtime.invalid', 'お客様', 'customer'),
    (u_legacy, 'cs-legacy@runtime.invalid', 'これまでの代理店', 'dealer'),
    (u_cust2, 'cs-cust2@runtime.invalid', 'お客様2', 'customer');
  insert into public.organizations (id, code, name, organization_type, parent_organization_id)
  values
    (o_md, 'RT-CS-MD', '検査総代理店', 'master_dealer', null),
    (o_md2, 'RT-CS-MD2', '検査総代理店2', 'master_dealer', null),
    (o_d, 'RT-CS-D', '検査代理店', 'dealer', o_md),
    (o_d2, 'RT-CS-D2', '検査代理店2', 'dealer', o_md2),
    (o_d3, 'RT-CS-D3', '管理者のいない代理店', 'dealer', o_md);
  insert into public.organization_memberships (organization_id, profile_id, member_role, status, is_primary)
  values
    (o_d, u_d_mgr, 'admin', 'active', true),
    (o_d, u_d_staff, 'editor', 'active', true),
    (o_d, u_d_staff2, 'editor', 'active', true),
    (o_md, u_md_mgr, 'admin', 'active', true),
    (o_md, u_md_staff, 'editor', 'active', true),
    (o_d2, u_d2_mgr, 'admin', 'active', true),
    (o_md2, u_md2_mgr, 'admin', 'active', true);
  insert into public.base_models (id, slug, name, base_price, status)
  values (m_model, 'runtime-cs-model', '組織検査用モデル', 1000000, 'published') on conflict (slug) do nothing;
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (c_1, u_cust, m_model, '組織の案件', 'quote_requested', 'office', 'full'),
         (c_legacy, u_cust2, m_model, 'これまでの案件', 'quote_requested', 'office', 'full');
  insert into public.quote_requests (id, configuration_id, user_id, quote_id, status)
  values (r_1, c_1, u_cust, q_1b, 'sent'), (r_legacy, c_legacy, u_cust2, q_legacy, 'sent');
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, base_model_name, base_price, option_subtotal, installation_subtotal,
                             subtotal, tax_rate, tax, total, revision, parent_quote_id)
  values
    (q_1a, 'RT-CS-1', r_1, c_1, u_cust, null, 'superseded', now() + interval '30 days', 'お客様', '組織検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 1, null),
    (q_1b, 'RT-CS-1-2', r_1, c_1, u_cust, null, 'issued', now() + interval '30 days', 'お客様', '組織検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 2, q_1a),
    (q_legacy, 'RT-CS-L', r_legacy, c_legacy, u_cust2, u_legacy, 'issued', now() + interval '30 days', 'お客様2', '組織検査用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 1, null);
  set local session_replication_role = origin;

  -- ---------- お客様が代理店を選ぶ → 営業担当組織と製造担当（直属の総代理店）が決まる ----------
  perform pg_temp.cs_expect_denied('25-1 管理者のいない代理店は選べない', 'P0001',
    pg_temp.cs_run_as('authenticated', u_cust, format($q$ select public.set_quote_request_preferences(%L, jsonb_build_object('preferred_organization_id', %L))::text $q$, r_1, o_d3)));
  select count(*) into v_notifications_before from public.notifications where recipient_id = u_d_mgr;
  v_out := pg_temp.cs_run_as('authenticated', u_cust, format($q$ select public.set_quote_request_preferences(%L, jsonb_build_object('preferred_organization_id', %L))::text $q$, r_1, o_d));
  perform pg_temp.cs_expect_eq('25-2 お客様が選んだ代理店が営業担当になり、製造担当は直属の総代理店に自動で決まる', 'ok/検査代理店/検査総代理店/true',
    coalesce(nullif(v_out, ''), 'ok') || '/' ||
    (select coalesce(s.name, '-') || '/' || coalesce(m.name, '-') || '/' || w.manufacturing_auto::text
       from public.case_workflows w
       left join public.organizations s on s.id = w.sales_organization_id
       left join public.organizations m on m.id = w.manufacturing_organization_id
      where w.quote_request_id = r_1));
  perform pg_temp.cs_expect_eq('25-3 選ばれた代理店の管理者に「主担当者を決めてください」と知らせる', 'true',
    ((select count(*) from public.notifications where recipient_id = u_d_mgr and kind = 'case_sales_assigned') > 0)::text);

  -- ---------- 主担当者を決める前：管理者だけが見られる ----------
  perform pg_temp.cs_expect_eq('25-4 主担当者を決める前の関わり方（管理者／担当者／製造担当の総代理店／別の代理店／お客様）', 'manager/(null)/manufacturer/manufacturer/(null)/customer',
    pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_md_mgr, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_md_staff, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d2_mgr, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_cust, format('select public.case_role(%L)', r_1)));
  perform pg_temp.cs_expect_eq('25-5 管理者は自社の案件の見積（過去の版を含む）を読め、担当でない担当者・別の代理店・総代理店は読めない', '2/0/0/0',
    pg_temp.cs_run_as('authenticated', u_d_mgr, format('select count(*)::text from public.quotes where quote_request_id = %L', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff, format('select count(*)::text from public.quotes where quote_request_id = %L', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d2_mgr, format('select count(*)::text from public.quotes where quote_request_id = %L', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_md_mgr, format('select count(*)::text from public.quotes where quote_request_id = %L', r_1)));
  perform pg_temp.cs_expect_eq('25-6 管理者は案件の受付・担当の記録を読め、担当でない担当者は読めない', '1/0',
    pg_temp.cs_run_as('authenticated', u_d_mgr, format('select count(*)::text from public.case_workflows where quote_request_id = %L', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff, format('select count(*)::text from public.case_workflows where quote_request_id = %L', r_1)));
  perform pg_temp.cs_expect_denied('25-7 担当者は主担当者を決められない', '42501',
    pg_temp.cs_run_as('authenticated', u_d_staff, format('select public.assign_case_primary_staff(%L, %L)::text', r_1, u_d_staff)));
  perform pg_temp.cs_expect_denied('25-8 別の代理店の管理者は主担当者を決められない', '42501',
    pg_temp.cs_run_as('authenticated', u_d2_mgr, format('select public.assign_case_primary_staff(%L, %L)::text', r_1, u_d2_mgr)));
  perform pg_temp.cs_expect_denied('25-9 営業担当組織のメンバーでない人は主担当者にできない', 'P0001',
    pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.assign_case_primary_staff(%L, %L)::text', r_1, u_md_staff)));

  -- ---------- 管理者が主担当者を決める → 見積の担当がそろい、通知は 1 回 ----------
  select count(*) into v_notifications_before from public.notifications where recipient_id = u_d_staff;
  v_out := pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.assign_case_primary_staff(%L, %L)::text', r_1, u_d_staff));
  perform pg_temp.cs_expect_eq('25-10 管理者が主担当者を決めると、案件の見積（過去の版も）の担当がそろう', 'ok/2',
    coalesce(nullif(v_out, ''), 'ok') || '/' || (select count(*)::text from public.quotes where quote_request_id = r_1 and dealer_id = u_d_staff));
  perform pg_temp.cs_expect_eq('25-11 主担当者への通知は 1 回だけ（見積ごとの「担当になりました」は送らない）', '1/0',
    (select count(*)::text from public.notifications where recipient_id = u_d_staff and kind = 'case_primary_assigned') || '/' ||
    (select count(*)::text from public.notifications where recipient_id = u_d_staff and kind = 'quote_assigned'));
  perform pg_temp.cs_expect_eq('25-12 主担当者は担当として案件と見積を扱え、ほかの担当者は見られない', 'staff/2/(null)/0',
    pg_temp.cs_run_as('authenticated', u_d_staff, format('select public.case_access(%L)', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff, format('select count(*)::text from public.quotes where quote_request_id = %L', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff2, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff2, format('select count(*)::text from public.quotes where quote_request_id = %L', r_1)));

  v_out := pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.assign_case_primary_staff(%L, %L)::text', r_1, u_d_staff2));
  perform pg_temp.cs_expect_eq('25-13 担当を付け替えると、前の担当者は過去の見積からも案件を見られなくなる', 'ok/(null)/0/staff/2',
    coalesce(nullif(v_out, ''), 'ok') || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff, format('select count(*)::text from public.quotes where quote_request_id = %L', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff2, format('select public.case_access(%L)', r_1)) || '/' ||
    (select count(*)::text from public.quotes where quote_request_id = r_1 and dealer_id = u_d_staff2));

  -- 呼び出しと確認は別の文にする（同じ文の中では、関数を呼ぶ前の状態が見えるため）
  v_out := pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.acknowledge_case(%L)::text', r_1));
  perform pg_temp.cs_expect_eq('25-14 営業担当組織の管理者は受付できる', 'ok/true',
    coalesce(nullif(v_out, ''), 'ok') || '/' ||
    (select (w.acknowledged_at is not null)::text from public.case_workflows w where w.quote_request_id = r_1));
  perform pg_temp.cs_expect_denied('25-15 別の代理店の管理者は受付できない', '42501',
    pg_temp.cs_run_as('authenticated', u_d2_mgr, format('select public.acknowledge_case(%L)::text', r_1)));

  -- ---------- 画面用の情報：主担当者の候補は本部と管理者にだけ返す ----------
  perform pg_temp.cs_expect_eq('25-16 管理者には主担当者の候補（自社のメンバー 3 人）を返し、担当者には返さない。お客様には何も返さない', 'true/3/false/0/(null)',
    pg_temp.cs_run_as('authenticated', u_d_mgr, format($q$ select (public.get_case_organizations(%L) ->> 'can_assign') $q$, r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_mgr, format($q$ select jsonb_array_length(public.get_case_organizations(%L) -> 'candidates')::text $q$, r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff2, format($q$ select (public.get_case_organizations(%L) ->> 'can_assign') $q$, r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff2, format($q$ select jsonb_array_length(public.get_case_organizations(%L) -> 'candidates')::text $q$, r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_cust, format($q$ select public.get_case_organizations(%L)::text $q$, r_1)));

  -- ---------- 顧客管理・案件一覧 ----------
  perform pg_temp.cs_expect_eq('25-17 顧客管理：管理者と主担当者は自社の案件のお客様を見られ、担当でない担当者は見られない', 'true/true/false',
    pg_temp.cs_run_as('authenticated', u_d_mgr, format($q$ select (public.list_accessible_customers() -> 'customers') @> jsonb_build_array(jsonb_build_object('id', %L::text)) $q$, u_cust)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff2, format($q$ select (public.list_accessible_customers() -> 'customers') @> jsonb_build_array(jsonb_build_object('id', %L::text)) $q$, u_cust)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff, format($q$ select (public.list_accessible_customers() -> 'customers') @> jsonb_build_array(jsonb_build_object('id', %L::text)) $q$, u_cust)));
  perform pg_temp.cs_expect_eq('25-18 代理店の案件一覧：管理者は自社の案件の見積を見られる', '2/2/0',
    pg_temp.cs_run_as('authenticated', u_d_mgr, format('select count(*)::text from public.list_dealer_quote_request_meta() m where m.quote_id in (%L, %L)', q_1a, q_1b)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff2, format('select count(*)::text from public.list_dealer_quote_request_meta() m where m.quote_id in (%L, %L)', q_1a, q_1b)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff, format('select count(*)::text from public.list_dealer_quote_request_meta() m where m.quote_id in (%L, %L)', q_1a, q_1b)));
  perform pg_temp.cs_expect_eq('25-19 案件のプラン（仕様）は管理者・主担当者に返り、担当でない担当者には返らない', 'ok/ok/denied',
    case when pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.get_case_plan_configuration(%L)::text', q_1b)) like '{%' then 'ok' else 'denied' end || '/' ||
    case when pg_temp.cs_run_as('authenticated', u_d_staff2, format('select public.get_case_plan_configuration(%L)::text', q_1b)) like '{%' then 'ok' else 'denied' end || '/' ||
    case when pg_temp.cs_run_as('authenticated', u_d_staff, format('select public.get_case_plan_configuration(%L)::text', q_1b)) like '{%' then 'ok' else 'denied' end);

  -- ---------- 本部が営業担当組織・製造担当を変える ----------
  perform pg_temp.cs_expect_denied('25-20 営業担当組織を変えられるのは本部だけ', '42501',
    pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.set_case_sales_organization(%L, %L)::text', r_1, o_d2)));
  v_out := pg_temp.cs_run_as('authenticated', u_admin, format('select public.set_case_sales_organization(%L, %L)::text', r_1, o_d2));
  perform pg_temp.cs_expect_eq('25-21 本部が営業担当組織を変えると、主担当者と見積の担当は外れ、製造担当は新しい直属の総代理店になる', 'ok/検査代理店2/(none)/0/検査総代理店2',
    coalesce(nullif(v_out, ''), 'ok') || '/' ||
    (select s.name || '/' || coalesce(w.primary_staff_id::text, '(none)') from public.case_workflows w join public.organizations s on s.id = w.sales_organization_id where w.quote_request_id = r_1) || '/' ||
    (select count(*)::text from public.quotes where quote_request_id = r_1 and dealer_id is not null) || '/' ||
    (select m.name from public.case_workflows w join public.organizations m on m.id = w.manufacturing_organization_id where w.quote_request_id = r_1));
  perform pg_temp.cs_expect_eq('25-22 前の代理店の管理者は見られなくなり、新しい代理店の管理者が見られる', '(null)/manager',
    pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d2_mgr, format('select public.case_role(%L)', r_1)));
  perform pg_temp.cs_expect_denied('25-23 製造担当を変えられるのは本部だけ', '42501',
    pg_temp.cs_run_as('authenticated', u_d2_mgr, format('select public.set_case_manufacturing_organization(%L, %L)::text', r_1, o_md)));
  perform pg_temp.cs_expect_denied('25-24 製造担当に代理店は選べない', 'P0001',
    pg_temp.cs_run_as('authenticated', u_admin, format('select public.set_case_manufacturing_organization(%L, %L)::text', r_1, o_d)));
  v_out := pg_temp.cs_run_as('authenticated', u_admin, format('select public.set_case_manufacturing_organization(%L, %L)::text', r_1, o_md));
  perform pg_temp.cs_expect_eq('25-25 本部は製造担当を別の総代理店に変えられ（自動ではなくなる）、その総代理店が製造担当になる', 'ok/検査総代理店/false/manufacturer/(null)',
    coalesce(nullif(v_out, ''), 'ok') || '/' ||
    (select m.name || '/' || w.manufacturing_auto::text from public.case_workflows w join public.organizations m on m.id = w.manufacturing_organization_id where w.quote_request_id = r_1) || '/' ||
    pg_temp.cs_run_as('authenticated', u_md_staff, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_md2_mgr, format('select public.case_access(%L)', r_1)));
  v_out := pg_temp.cs_run_as('authenticated', u_admin, format('select public.set_case_manufacturing_organization(%L, null)::text', r_1));
  perform pg_temp.cs_expect_eq('25-26 製造担当を自動に戻すと、営業担当の直属の総代理店に戻る', 'ok/検査総代理店2/true',
    coalesce(nullif(v_out, ''), 'ok') || '/' ||
    (select m.name || '/' || w.manufacturing_auto::text from public.case_workflows w join public.organizations m on m.id = w.manufacturing_organization_id where w.quote_request_id = r_1));

  -- ---------- 直属の総代理店の管理者（配下の進み具合）：顧客情報を含む見積は読めない ----------
  perform pg_temp.cs_run_as('authenticated', u_admin, format('select public.set_case_manufacturing_organization(%L, %L)::text', r_1, o_md));
  perform pg_temp.cs_run_as('authenticated', u_admin, format('select public.set_case_sales_organization(%L, %L)::text', r_1, o_d));
  perform pg_temp.cs_run_as('authenticated', u_admin, format('select public.set_case_manufacturing_organization(%L, %L)::text', r_1, o_md2));
  perform pg_temp.cs_expect_eq('25-27 直属の総代理店の管理者（製造担当でない）は「配下の確認」として進み具合だけ見られ、見積（顧客情報を含む）は読めない', 'supervisor/ok/0',
    pg_temp.cs_run_as('authenticated', u_md_mgr, format('select public.case_role(%L)', r_1)) || '/' ||
    case when pg_temp.cs_run_as('authenticated', u_md_mgr, format('select public.get_case_progress(%L)::text', r_1)) like '{%' then 'ok' else 'denied' end || '/' ||
    pg_temp.cs_run_as('authenticated', u_md_mgr, format('select count(*)::text from public.quotes where quote_request_id = %L', r_1)));

  -- ---------- 製造依頼は製造担当組織へ送る ----------
  perform pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.assign_case_primary_staff(%L, %L)::text', r_1, u_d_staff));
  set local session_replication_role = replica;
  insert into public.contracts (id, quote_request_id, quote_id, user_id, provider, status, signer_name, signer_email, contract_total, signed_at, signed_file_path)
  values (k_1, r_1, q_1b, u_cust, 'paper', 'signed', 'お客様', 'cs-cust@runtime.invalid', 1100000, now(), 'runtime/cs-contract.pdf');
  insert into public.manufacturing_orders (id, quote_request_id, contract_id, quote_id, status, unit_count, created_by)
  values (mo_1, r_1, k_1, q_1b, 'draft', 1, u_d_staff);
  set local session_replication_role = origin;
  select o.lock_version into v_lock from public.manufacturing_orders o where o.id = mo_1;
  v_out := pg_temp.cs_run_as('authenticated', u_d_staff, format('select public.send_manufacturing_order(%L, %s)::text', mo_1, v_lock));
  perform pg_temp.cs_expect_eq('25-28 主担当者が製造依頼を送ると、製造担当組織（総代理店）あてになり、その管理者に知らせる', (v_lock + 1)::text || '/検査総代理店2/(none)/true',
    v_out || '/' ||
    (select coalesce(m.name, '-') || '/' || coalesce(o.manufacturer_id::text, '(none)') from public.manufacturing_orders o left join public.organizations m on m.id = o.manufacturing_organization_id where o.id = mo_1) || '/' ||
    ((select count(*) from public.notifications where recipient_id = u_md2_mgr and kind = 'manufacturing_order_sent') > 0)::text);
  perform pg_temp.cs_expect_denied('25-29 製造依頼を送った後は、製造担当を変えられない', 'P0001',
    pg_temp.cs_run_as('authenticated', u_admin, format('select public.set_case_manufacturing_organization(%L, %L)::text', r_1, o_md)));
  perform pg_temp.cs_expect_eq('25-30 製造担当組織のメンバーは製造依頼を読める', '1',
    pg_temp.cs_run_as('authenticated', u_md2_mgr, format('select count(*)::text from public.manufacturing_orders where quote_request_id = %L', r_1)));

  -- ---------- 所属を外れた担当者は、案件を扱えない ----------
  select m.id into v_membership from public.organization_memberships m where m.profile_id = u_d_staff and m.status = 'active';
  perform pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.deactivate_organization_member(%L)::text', v_membership));
  perform pg_temp.cs_expect_eq('25-31 所属を外れた主担当者は、案件を扱えない', '(null)/0',
    pg_temp.cs_run_as('authenticated', u_d_staff, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cs_run_as('authenticated', u_d_staff, format('select count(*)::text from public.quotes where quote_request_id = %L', r_1)));

  -- ---------- これまでの案件（営業担当組織が無い）は従来どおり ----------
  perform pg_temp.cs_expect_eq('25-32 これまでの案件は、現在の見積の担当が担当のまま', 'staff',
    pg_temp.cs_run_as('authenticated', u_legacy, format('select public.case_access(%L)', r_legacy)));
  perform pg_temp.cs_expect_denied('25-33 営業担当組織が決まっている案件には、これまでの「見積に担当代理店を割り当てる」は使えない', 'P0001',
    pg_temp.cs_run_as('authenticated', u_admin, format('select public.assign_quote_dealer(%L, %L)::text', q_1b, u_legacy)));
  perform pg_temp.cs_expect_denied('25-34 営業担当組織が決まっている案件には、これまでの「総代理店の利用者を製造担当にする」は使えない', 'P0001',
    pg_temp.cs_run_as('authenticated', u_admin, format('select public.set_case_manufacturer(%L, %L)::text', r_1, u_md_mgr)));

  -- ---------- 内部の関数は利用者から呼べない・変更は監査ログに残る ----------
  perform pg_temp.cs_expect_denied('25-35 主担当者をそろえる内部の関数は、利用者から呼べない', '42501',
    pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.apply_case_main_staff(%L, %L, %L)::text', r_1, u_d_mgr, u_d_mgr)));
  perform pg_temp.cs_expect_denied('25-36 ほかの人の所属を調べる内部の関数は、利用者から呼べない', '42501',
    pg_temp.cs_run_as('authenticated', u_d_mgr, format('select public.is_active_organization_member(%L, %L)::text', o_d, u_d_staff2)));
  perform pg_temp.cs_expect_eq('25-37 営業担当組織・製造担当・主担当者の変更は監査ログに残る', 'true',
    ((select count(*) from public.audit_logs where entity = 'quote_request' and entity_id = r_1
       and action in ('case_sales_organization', 'case_manufacturing_organization', 'case_primary_staff')) >= 6)::text);
end;
$test$;

select jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq) as j
from _cs_result;

rollback;
