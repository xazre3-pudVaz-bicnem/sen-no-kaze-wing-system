-- 製造担当の案件（20261016150000）の実行時検査。使い捨て DB 専用。最後に rollback する。
begin;

create temp table _mf_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _mf_result to public;

create function pg_temp.mf_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.mf_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _mf_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.mf_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _mf_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

do $test$
declare
  u_admin constant uuid := '50000000-0000-4000-8000-000000000001';
  u_md_mgr constant uuid := '50000000-0000-4000-8000-000000000002';
  u_md_staff constant uuid := '50000000-0000-4000-8000-000000000003';
  u_md2_mgr constant uuid := '50000000-0000-4000-8000-000000000004';
  u_d_mgr constant uuid := '50000000-0000-4000-8000-000000000005';
  u_d_staff constant uuid := '50000000-0000-4000-8000-000000000006';
  u_cust constant uuid := '50000000-0000-4000-8000-000000000007';
  u_legacy constant uuid := '50000000-0000-4000-8000-000000000008';
  o_md constant uuid := '51000000-0000-4000-8000-000000000001';
  o_md2 constant uuid := '51000000-0000-4000-8000-000000000002';
  o_d constant uuid := '51000000-0000-4000-8000-000000000003';
  m_model constant uuid := '52000000-0000-4000-8000-000000000001';
  c_1 constant uuid := '53000000-0000-4000-8000-000000000001';
  c_2 constant uuid := '53000000-0000-4000-8000-000000000002';
  c_3 constant uuid := '53000000-0000-4000-8000-000000000003';
  r_1 constant uuid := '54000000-0000-4000-8000-000000000001';
  r_2 constant uuid := '54000000-0000-4000-8000-000000000002';
  r_3 constant uuid := '54000000-0000-4000-8000-000000000003';
  q_1 constant uuid := '55000000-0000-4000-8000-000000000001';
  q_2 constant uuid := '55000000-0000-4000-8000-000000000002';
  q_3 constant uuid := '55000000-0000-4000-8000-000000000003';
  k_1 constant uuid := '56000000-0000-4000-8000-000000000001';
  mo_1 constant uuid := '57000000-0000-4000-8000-000000000001';
  v_out text;
  v_membership uuid;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  select v.id, v.email, '{}'::jsonb
    from (values
      (u_admin, 'mf-admin@runtime.invalid'), (u_md_mgr, 'mf-md-mgr@runtime.invalid'), (u_md_staff, 'mf-md-staff@runtime.invalid'),
      (u_md2_mgr, 'mf-md2-mgr@runtime.invalid'), (u_d_mgr, 'mf-d-mgr@runtime.invalid'), (u_d_staff, 'mf-d-staff@runtime.invalid'),
      (u_cust, 'mf-customer-secret@runtime.invalid'), (u_legacy, 'mf-legacy@runtime.invalid')
    ) as v(id, email);
  insert into public.profiles (id, email, full_name, company_name, phone, address, role_code)
  values
    (u_admin, 'mf-admin@runtime.invalid', '本部', null, null, null, 'admin'),
    (u_md_mgr, 'mf-md-mgr@runtime.invalid', '製造総代理店 管理者', null, null, null, 'master_dealer'),
    (u_md_staff, 'mf-md-staff@runtime.invalid', '製造総代理店 担当者', null, null, null, 'master_dealer'),
    (u_md2_mgr, 'mf-md2-mgr@runtime.invalid', '別の総代理店 管理者', null, null, null, 'master_dealer'),
    (u_d_mgr, 'mf-d-mgr@runtime.invalid', '販売代理店 管理者', null, null, null, 'dealer'),
    (u_d_staff, 'mf-d-staff@runtime.invalid', '販売代理店 担当者', null, null, null, 'dealer'),
    (u_cust, 'mf-customer-secret@runtime.invalid', '秘密 花子', '秘密工業', '090-8888-0000', '秘密県秘密町4-5-6', 'customer'),
    (u_legacy, 'mf-legacy@runtime.invalid', 'これまでの製造担当', null, null, null, 'master_dealer');
  insert into public.organizations (id, code, name, organization_type, parent_organization_id)
  values
    (o_md, 'RT-MF-MD', '製造総代理店', 'master_dealer', null),
    (o_md2, 'RT-MF-MD2', '別の総代理店', 'master_dealer', null),
    (o_d, 'RT-MF-D', '販売代理店', 'dealer', o_md);
  insert into public.organization_memberships (organization_id, profile_id, member_role, status, is_primary)
  values
    (o_md, u_md_mgr, 'admin', 'active', true),
    (o_md, u_md_staff, 'editor', 'active', true),
    (o_md2, u_md2_mgr, 'admin', 'active', true),
    (o_d, u_d_mgr, 'admin', 'active', true),
    (o_d, u_d_staff, 'editor', 'active', true);
  insert into public.base_models (id, slug, name, base_price, status)
  values (m_model, 'runtime-mf-model', '製造確認用モデル', 1000000, 'published') on conflict (slug) do nothing;
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
  values (c_1, u_cust, m_model, '秘密 花子の案件', 'quote_requested', 'office', 'full'),
         (c_2, u_cust, m_model, 'これまでの案件', 'quote_requested', 'office', 'full'),
         (c_3, u_cust, m_model, '別の総代理店の案件', 'quote_requested', 'office', 'full');
  insert into public.quote_requests (id, configuration_id, user_id, quote_id, status, message, contact)
  values (r_1, c_1, u_cust, q_1, 'sent', 'お客様からの秘密のメッセージ', jsonb_build_object('full_name', '秘密 花子', 'phone', '090-8888-0000')),
         (r_2, c_2, u_cust, q_2, 'sent', null, '{}'::jsonb),
         (r_3, c_3, u_cust, q_3, 'sent', null, '{}'::jsonb);
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, customer_company, base_model_name, base_price, option_subtotal, installation_subtotal,
                             subtotal, tax_rate, tax, total, revision, notes, dealer_note, spec_code)
  values (q_1, 'RT-MF-1', r_1, c_1, u_cust, u_d_staff, 'accepted', now() + interval '30 days',
          '秘密 花子', '秘密工業', '製造確認用モデル', 1000000, 200000, 0, 1200000, 0.10, 120000, 1320000, 2,
          'お客様向けの秘密の備考', '社内の秘密の備考', 'office'),
         (q_2, 'RT-MF-2', r_2, c_2, u_cust, u_d_mgr, 'issued', now() + interval '30 days',
          '秘密 花子', null, '製造確認用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 1, null, null, 'office'),
         (q_3, 'RT-MF-3', r_3, c_3, u_cust, null, 'issued', now() + interval '30 days',
          '秘密 花子', null, '製造確認用モデル', 1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 1, null, null, 'office');
  insert into public.quote_items (quote_id, kind, name, unit_price, quantity, amount, sort_order, unit)
  values (q_1, 'base', '製造確認用モデル 本体', 1000000, 1, 1000000, 1, '式'),
         (q_1, 'option', '製造確認用 設備', 200000, 2, 400000, 2, '台');
  insert into public.case_workflows (quote_request_id, sales_organization_id, manufacturing_organization_id, manufacturing_auto, primary_staff_id, manufacturer_id, updated_by)
  values (r_1, o_d, o_md, true, u_d_staff, null, u_admin),
         (r_2, null, null, true, null, u_legacy, u_admin),
         (r_3, o_d, o_md2, false, u_d_staff, null, u_admin);
  insert into public.contracts (id, quote_request_id, quote_id, user_id, provider, status, signer_name, signer_email, contract_total, signed_at, signed_file_path)
  values (k_1, r_1, q_1, u_cust, 'paper', 'signed', '秘密 花子', 'mf-customer-secret@runtime.invalid', 1320000, now(), 'runtime/mf-contract.pdf');
  insert into public.manufacturing_orders (id, quote_request_id, contract_id, quote_id, manufacturing_organization_id, status, unit_count, created_by, sent_at, received_at, spec_snapshot)
  values (mo_1, r_1, k_1, q_1, o_md, 'received', 2, u_d_staff, now(), now(), '{"quote_no": "RT-MF-1", "items": []}'::jsonb);
  insert into public.manufacturing_units (order_id, quote_request_id, seq, status)
  values (mo_1, r_1, 1, 'shipped'), (mo_1, r_1, 2, 'in_production');
  set local session_replication_role = origin;

  -- ---------- 一覧：製造担当組織のメンバー（管理者でなくても）は自分たちの案件を見られる ----------
  v_out := pg_temp.mf_run_as('authenticated', u_md_staff, 'select public.list_manufacturing_cases()::text');
  perform pg_temp.mf_expect_eq('27-1 製造担当組織の担当者は、製造担当の案件を一覧で見られる（見積番号・営業担当・製造依頼の状態・出荷数）',
    '1/RT-MF-1/販売代理店/received/1',
    jsonb_array_length(v_out::jsonb)::text || '/' ||
    (v_out::jsonb -> 0 -> 'quote' ->> 'quote_no') || '/' ||
    (v_out::jsonb -> 0 -> 'sales_organization' ->> 'name') || '/' ||
    (v_out::jsonb -> 0 -> 'order' ->> 'status') || '/' ||
    (v_out::jsonb -> 0 -> 'order' ->> 'units_shipped'));
  perform pg_temp.mf_expect_eq('27-2 一覧にはお客様の情報・見積の金額・備考を含めない', 'false/false/false/false',
    (v_out like '%秘密%')::text || '/' || (v_out like '%"total"%')::text || '/' || (v_out like '%unit_price%')::text || '/' || (v_out like '%amount%')::text);
  v_out := pg_temp.mf_run_as('authenticated', u_md2_mgr, 'select public.list_manufacturing_cases()::text');
  perform pg_temp.mf_expect_eq('27-3 別の総代理店の管理者の一覧には、自分たちの案件だけが出る', '1/RT-MF-3',
    jsonb_array_length(v_out::jsonb)::text || '/' || (v_out::jsonb -> 0 -> 'quote' ->> 'quote_no'));
  perform pg_temp.mf_expect_eq('27-4 営業担当の代理店（管理者・主担当者）とお客様の一覧には出ない', '[]/[]/[]',
    pg_temp.mf_run_as('authenticated', u_d_mgr, 'select public.list_manufacturing_cases()::text') || '/' ||
    pg_temp.mf_run_as('authenticated', u_d_staff, 'select public.list_manufacturing_cases()::text') || '/' ||
    pg_temp.mf_run_as('authenticated', u_cust, 'select public.list_manufacturing_cases()::text'));

  -- ---------- 詳細：仕様の明細は品名・数量・単位だけ ----------
  v_out := pg_temp.mf_run_as('authenticated', u_md_staff, format('select public.get_manufacturing_case(%L)::text', r_1));
  perform pg_temp.mf_expect_eq('27-5 製造担当は、仕様の明細（品名・数量・単位）と契約の済否を見られる', '2/製造確認用 設備/2/台/true',
    jsonb_array_length(v_out::jsonb -> 'spec_items')::text || '/' ||
    (v_out::jsonb -> 'spec_items' -> 1 ->> 'name') || '/' ||
    (v_out::jsonb -> 'spec_items' -> 1 ->> 'quantity') || '/' ||
    (v_out::jsonb -> 'spec_items' -> 1 ->> 'unit') || '/' ||
    (v_out::jsonb ->> 'contract_signed'));
  perform pg_temp.mf_expect_eq('27-6 詳細にはお客様の情報・金額・備考を含めない', 'false/false/false/false/false',
    (v_out like '%秘密%')::text || '/' || (v_out like '%"total"%')::text || '/' || (v_out like '%unit_price%')::text || '/' ||
    (v_out like '%amount%')::text || '/' || (v_out like '%mf-customer%')::text);
  perform pg_temp.mf_expect_denied('27-7 別の総代理店は詳細を見られない', '42501',
    pg_temp.mf_run_as('authenticated', u_md2_mgr, format('select public.get_manufacturing_case(%L)::text', r_1)));
  perform pg_temp.mf_expect_denied('27-8 営業担当の代理店の管理者は、この関数では見られない（案件画面で見る）', '42501',
    pg_temp.mf_run_as('authenticated', u_d_mgr, format('select public.get_manufacturing_case(%L)::text', r_1)));
  perform pg_temp.mf_expect_denied('27-9 主担当者も、この関数では見られない（案件画面で見る）', '42501',
    pg_temp.mf_run_as('authenticated', u_d_staff, format('select public.get_manufacturing_case(%L)::text', r_1)));
  perform pg_temp.mf_expect_denied('27-10 お客様は見られない', '42501',
    pg_temp.mf_run_as('authenticated', u_cust, format('select public.get_manufacturing_case(%L)::text', r_1)));
  perform pg_temp.mf_expect_denied('27-11 未ログインでは呼べない', '42501',
    pg_temp.mf_run_as('anon', null, format('select public.get_manufacturing_case(%L)::text', r_1)));

  -- ---------- これまでの案件・本部 ----------
  v_out := pg_temp.mf_run_as('authenticated', u_legacy, 'select public.list_manufacturing_cases()::text');
  perform pg_temp.mf_expect_eq('27-12 これまでの案件で本部が選んだ製造の担当は、一覧と詳細で見られる', '1/RT-MF-2/RT-MF-2',
    jsonb_array_length(v_out::jsonb)::text || '/' || (v_out::jsonb -> 0 -> 'quote' ->> 'quote_no') || '/' ||
    (pg_temp.mf_run_as('authenticated', u_legacy, format('select public.get_manufacturing_case(%L)::text', r_2))::jsonb -> 'quote' ->> 'quote_no'));
  v_out := pg_temp.mf_run_as('authenticated', u_admin, 'select public.list_manufacturing_cases()::text');
  perform pg_temp.mf_expect_eq('27-13 本部は製造担当つきの案件をすべて一覧で見られ、詳細も見られる', 'true/RT-MF-1',
    (jsonb_array_length(v_out::jsonb) >= 3)::text || '/' ||
    (pg_temp.mf_run_as('authenticated', u_admin, format('select public.get_manufacturing_case(%L)::text', r_1))::jsonb -> 'quote' ->> 'quote_no'));

  -- ---------- 所属を外れたメンバー・内部の関数 ----------
  select m.id into v_membership from public.organization_memberships m where m.profile_id = u_md_staff and m.status = 'active';
  perform pg_temp.mf_run_as('authenticated', u_md_mgr, format('select public.deactivate_organization_member(%L)::text', v_membership));
  perform pg_temp.mf_expect_eq('27-14 所属を外れたメンバーは、一覧に出ず詳細も見られない', '[]/denied',
    pg_temp.mf_run_as('authenticated', u_md_staff, 'select public.list_manufacturing_cases()::text') || '/' ||
    case when pg_temp.mf_run_as('authenticated', u_md_staff, format('select public.get_manufacturing_case(%L)::text', r_1)) like 'ERROR 42501:%'
         then 'denied' else 'visible' end);
  perform pg_temp.mf_expect_denied('27-15 1 件分の行を作る内部の関数は、利用者から呼べない', '42501',
    pg_temp.mf_run_as('authenticated', u_md_mgr, format('select public.manufacturing_case_row(%L)::text', r_1)));
end;
$test$;

select jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq) as j
from _mf_result;

rollback;
