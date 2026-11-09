-- 総代理店の配下の確認（20261104140000）の実行時検査。使い捨て DB 専用。最後に rollback する。
begin;

create temp table _sv_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _sv_result to public;

create function pg_temp.sv_run_as(p_role text, p_sub uuid, p_sql text) returns text
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

create function pg_temp.sv_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _sv_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.sv_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _sv_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

do $test$
declare
  u_admin constant uuid := '40000000-0000-4000-8000-000000000001';
  u_md_mgr constant uuid := '40000000-0000-4000-8000-000000000002';
  u_md_staff constant uuid := '40000000-0000-4000-8000-000000000003';
  u_md2_mgr constant uuid := '40000000-0000-4000-8000-000000000004';
  u_d_mgr constant uuid := '40000000-0000-4000-8000-000000000005';
  u_d_staff constant uuid := '40000000-0000-4000-8000-000000000006';
  u_cust constant uuid := '40000000-0000-4000-8000-000000000007';
  o_md constant uuid := '41000000-0000-4000-8000-000000000001';
  o_md2 constant uuid := '41000000-0000-4000-8000-000000000002';
  o_d constant uuid := '41000000-0000-4000-8000-000000000003';
  o_d2 constant uuid := '41000000-0000-4000-8000-000000000004';
  m_model constant uuid := '42000000-0000-4000-8000-000000000001';
  c_1 constant uuid := '43000000-0000-4000-8000-000000000001';
  r_1 constant uuid := '44000000-0000-4000-8000-000000000001';
  q_1 constant uuid := '45000000-0000-4000-8000-000000000001';
  k_1 constant uuid := '46000000-0000-4000-8000-000000000001';
  mo_1 constant uuid := '47000000-0000-4000-8000-000000000001';
  f_survey constant uuid := '48000000-0000-4000-8000-000000000001';
  f_doc constant uuid := '48000000-0000-4000-8000-000000000002';
  f_survey_pdf constant uuid := '48000000-0000-4000-8000-000000000003';
  f_progress constant uuid := '48000000-0000-4000-8000-000000000004';
  mo_0 constant uuid := '47000000-0000-4000-8000-000000000000';
  v_out text;
  v_info jsonb;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  select v.id, v.email, '{}'::jsonb
    from (values
      (u_admin, 'sv-admin@runtime.invalid'), (u_md_mgr, 'sv-md-mgr@runtime.invalid'), (u_md_staff, 'sv-md-staff@runtime.invalid'),
      (u_md2_mgr, 'sv-md2-mgr@runtime.invalid'), (u_d_mgr, 'sv-d-mgr@runtime.invalid'), (u_d_staff, 'sv-d-staff@runtime.invalid'),
      (u_cust, 'sv-customer-secret@runtime.invalid')
    ) as v(id, email);
  insert into public.profiles (id, email, full_name, company_name, phone, address, role_code)
  values
    (u_admin, 'sv-admin@runtime.invalid', '本部', null, null, null, 'admin'),
    (u_md_mgr, 'sv-md-mgr@runtime.invalid', '総代理店 管理者', null, null, null, 'master_dealer'),
    (u_md_staff, 'sv-md-staff@runtime.invalid', '総代理店 担当者', null, null, null, 'master_dealer'),
    (u_md2_mgr, 'sv-md2-mgr@runtime.invalid', '別の総代理店 管理者', null, null, null, 'master_dealer'),
    (u_d_mgr, 'sv-d-mgr@runtime.invalid', '代理店 管理者', null, null, null, 'dealer'),
    (u_d_staff, 'sv-d-staff@runtime.invalid', '代理店 担当者', null, null, null, 'dealer'),
    (u_cust, 'sv-customer-secret@runtime.invalid', '秘密 太郎', '秘密商事', '090-9999-0000', '秘密県秘密市1-2-3', 'customer');
  insert into public.organizations (id, code, name, organization_type, parent_organization_id)
  values
    (o_md, 'RT-SV-MD', '確認総代理店', 'master_dealer', null),
    (o_md2, 'RT-SV-MD2', '確認総代理店2', 'master_dealer', null),
    (o_d, 'RT-SV-D', '確認代理店', 'dealer', o_md),
    (o_d2, 'RT-SV-D2', '確認代理店2', 'dealer', o_md2);
  insert into public.organization_memberships (organization_id, profile_id, member_role, status, is_primary)
  values
    (o_md, u_md_mgr, 'admin', 'active', true),
    (o_md, u_md_staff, 'editor', 'active', true),
    (o_md2, u_md2_mgr, 'admin', 'active', true),
    (o_d, u_d_mgr, 'admin', 'active', true),
    (o_d, u_d_staff, 'editor', 'active', true);
  insert into public.base_models (id, slug, name, base_price, status)
  values (m_model, 'runtime-sv-model', '確認用モデル', 1000000, 'published') on conflict (slug) do nothing;
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level, site_prefecture, site_municipality)
  values (c_1, u_cust, m_model, '秘密 太郎の案件', 'quote_requested', 'office', 'full', '秘密県', '秘密市');
  insert into public.quote_requests (id, configuration_id, user_id, quote_id, status, message, contact, case_name)
  values (r_1, c_1, u_cust, q_1, 'sent', 'お客様からの秘密のメッセージ',
          jsonb_build_object('full_name', '秘密 太郎', 'phone', '090-9999-0000', 'site_address', '秘密県秘密市1-2-3',
                             'address', '自宅県自宅市9-9-9', 'email', 'sv-customer-secret@runtime.invalid', 'company_name', '秘密商事'),
          'RT 確認の案件');
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, customer_company, base_model_name, base_price, option_subtotal, installation_subtotal,
                             subtotal, tax_rate, tax, total, revision, notes, dealer_note, spec_code)
  values (q_1, 'RT-SV-1', r_1, c_1, u_cust, u_d_staff, 'issued', now() + interval '30 days',
          '秘密 太郎', '秘密商事', '確認用モデル', 1000000, 200000, 0, 1200000, 0.10, 120000, 1320000, 1,
          'お客様向けの秘密の備考', '社内の秘密の備考', 'office');
  insert into public.quote_items (quote_id, kind, name, unit_price, quantity, amount, sort_order, unit)
  values (q_1, 'base', '確認用モデル 本体', 1000000, 1, 1000000, 1, '式'),
         (q_1, 'option', '確認用 設備', 200000, 1, 200000, 2, '台');
  insert into public.case_workflows (quote_request_id, sales_organization_id, manufacturing_organization_id, manufacturing_auto, primary_staff_id, updated_by)
  values (r_1, o_d, o_md2, false, u_d_staff, u_admin);
  insert into public.contracts (id, quote_request_id, quote_id, user_id, provider, status, signer_name, signer_email, contract_total, signed_at, signed_file_path)
  values (k_1, r_1, q_1, u_cust, 'paper', 'signed', '秘密 太郎', 'sv-customer-secret@runtime.invalid', 1320000, now(), 'runtime/sv-contract.pdf');
  insert into public.manufacturing_orders (id, quote_request_id, contract_id, quote_id, manufacturing_organization_id, status, unit_count, created_by, sent_at, received_at, spec_snapshot)
  values (mo_1, r_1, k_1, q_1, o_md2, 'received', 1, u_d_staff, now(), now(), '{"quote_no": "RT-SV-1", "items": []}'::jsonb);
  insert into public.manufacturing_units (order_id, quote_request_id, seq, status)
  values (mo_1, r_1, 1, 'in_production');
  -- 取り消した前の製造依頼とその個体（配下の確認の詳細には出さない：26-16）
  insert into public.manufacturing_orders (id, quote_request_id, contract_id, quote_id, manufacturing_organization_id, status, unit_count, created_by, created_at, canceled_at)
  values (mo_0, r_1, k_1, q_1, o_md2, 'canceled', 1, u_d_staff, now() - interval '1 day', now() - interval '1 day');
  insert into public.manufacturing_units (order_id, quote_request_id, seq, status)
  values (mo_0, r_1, 1, 'in_production');
  insert into public.case_schedule_items (quote_request_id, category, title, status, created_by)
  values (r_1, 'manufacturing', '製造', 'in_progress', u_d_staff);
  insert into public.case_progress_reports (quote_request_id, kind, title, body, reported_on, created_by, author_name)
  values (r_1, 'progress', '基礎の確認', '基礎の水平を確認した', current_date, u_d_staff, '代理店 担当者');
  update public.quotes set customer_no = 'C-SV-0001' where id = q_1;
  insert into public.configuration_site_profiles (configuration_id, land_status, site_address, area_sqm, land_category, road_access, electricity, water, drainage, note)
  values (c_1, 'owned', '秘密県秘密市1-2-3', 120.5, 'residential', 'wide', 'available', 'unavailable', 'unknown', '土地の秘密のメモ');
  insert into public.site_surveys (quote_request_id, status, surveyed_on, surveyor_name, land, legal, survey_notes, completed_at, completed_by)
  values (r_1, 'completed', current_date, '代理店 担当者', '{"delivery_route": "4t 車で搬入できる"}'::jsonb,
          '{"zoning": "第一種住居地域"}'::jsonb, '北側の境界から 2m', now(), u_d_staff);
  insert into public.case_files (id, quote_request_id, context, storage_path, file_name, content_type, size_bytes, caption, customer_visible, uploaded_by)
  values (f_survey, r_1, 'site_survey', 'cases/' || r_1 || '/' || f_survey || '.jpg', 'survey.jpg', 'image/jpeg', 100, '搬入経路の写真', false, u_d_staff),
         (f_doc, r_1, 'document', 'cases/' || r_1 || '/' || f_doc || '.pdf', 'customer.pdf', 'application/pdf', 100, 'お客様が送った秘密の資料', true, u_cust),
         -- 現地確認の資料でも画像でないもの（総代理店には見せない：26-15）と、施工の写真（配下の確認も読める：26-15）
         (f_survey_pdf, r_1, 'site_survey', 'cases/' || r_1 || '/' || f_survey_pdf || '.pdf', 'survey.pdf', 'application/pdf', 100, '現地確認の秘密の資料', false, u_d_staff),
         (f_progress, r_1, 'progress', 'cases/' || r_1 || '/' || f_progress || '.jpg', 'progress.jpg', 'image/jpeg', 100, '基礎の写真', false, u_d_staff);
  insert into public.quote_request_preferences (quote_request_id, meeting_method, note)
  values (r_1, 'online', '打合せの秘密の希望');
  insert into public.case_notes (quote_request_id, kind, body, created_by, author_name)
  values (r_1, 'meeting', '打合せの秘密の記録', u_d_staff, '代理店 担当者');
  set local session_replication_role = origin;

  -- ---------- 一覧 ----------
  perform pg_temp.sv_expect_eq('26-1 直属の総代理店の管理者は、配下代理店の案件を一覧で見られる（見積番号・金額つき）', '1/RT-SV-1/1320000/確認代理店',
    pg_temp.sv_run_as('authenticated', u_md_mgr, $q$ select jsonb_array_length(public.list_supervised_cases())::text $q$) || '/' ||
    pg_temp.sv_run_as('authenticated', u_md_mgr, $q$ select (public.list_supervised_cases() -> 0 -> 'quote' ->> 'quote_no') $q$) || '/' ||
    pg_temp.sv_run_as('authenticated', u_md_mgr, $q$ select (public.list_supervised_cases() -> 0 -> 'quote' ->> 'total') $q$) || '/' ||
    pg_temp.sv_run_as('authenticated', u_md_mgr, $q$ select (public.list_supervised_cases() -> 0 -> 'sales_organization' ->> 'name') $q$));
  perform pg_temp.sv_expect_eq('26-2 総代理店の担当者・別の総代理店・代理店の管理者の一覧には出ない', '0/0/0',
    pg_temp.sv_run_as('authenticated', u_md_staff, $q$ select jsonb_array_length(public.list_supervised_cases())::text $q$) || '/' ||
    pg_temp.sv_run_as('authenticated', u_md2_mgr, $q$ select jsonb_array_length(public.list_supervised_cases())::text $q$) || '/' ||
    pg_temp.sv_run_as('authenticated', u_d_mgr, $q$ select jsonb_array_length(public.list_supervised_cases())::text $q$));
  v_out := pg_temp.sv_run_as('authenticated', u_md_mgr, $q$ select public.list_supervised_cases()::text $q$);
  perform pg_temp.sv_expect_eq('26-3 一覧にはお客様の氏名・会社名・メール・電話・住所・メッセージを含めない', '0/0/0/0/0/0',
    position('秘密 太郎' in v_out)::text || '/' || position('秘密商事' in v_out)::text || '/' ||
    position('sv-customer-secret' in v_out)::text || '/' || position('090-9999' in v_out)::text || '/' ||
    position('秘密県' in v_out)::text || '/' || position('秘密のメッセージ' in v_out)::text);

  -- ---------- 詳細 ----------
  v_out := pg_temp.sv_run_as('authenticated', u_md_mgr, format('select public.get_supervised_case(%L)::text', r_1));
  perform pg_temp.sv_expect_eq('26-4 詳細では、見積の金額・明細・製造依頼・個体・工程表・施工の記録を見られる', '1320000/2/received/1/1/1',
    (v_out::jsonb -> 'quote' ->> 'total') || '/' || jsonb_array_length(v_out::jsonb -> 'items')::text || '/' ||
    (v_out::jsonb -> 'manufacturing_order' ->> 'status') || '/' || jsonb_array_length(v_out::jsonb -> 'units')::text || '/' ||
    jsonb_array_length(v_out::jsonb -> 'schedule')::text || '/' || jsonb_array_length(v_out::jsonb -> 'progress_reports')::text);
  perform pg_temp.sv_expect_eq('26-5 詳細にはお客様の情報と見積の備考（お客様向け・社内）を含めない（設置場所は B-3 で見せる：26-12b）', '0/0/0/0/0/0/0/0',
    position('秘密 太郎' in v_out)::text || '/' || position('秘密商事' in v_out)::text || '/' ||
    position('sv-customer-secret' in v_out)::text || '/' || position('090-9999' in v_out)::text || '/' ||
    position('自宅県' in v_out)::text || '/' || position('秘密のメッセージ' in v_out)::text || '/' ||
    position('お客様向けの秘密の備考' in v_out)::text || '/' || position('社内の秘密の備考' in v_out)::text);
  perform pg_temp.sv_expect_denied('26-6 別の総代理店の管理者は詳細を見られない', '42501',
    pg_temp.sv_run_as('authenticated', u_md2_mgr, format('select public.get_supervised_case(%L)::text', r_1)));
  perform pg_temp.sv_expect_denied('26-7 総代理店の担当者は詳細を見られない（配下の確認は管理者だけ）', '42501',
    pg_temp.sv_run_as('authenticated', u_md_staff, format('select public.get_supervised_case(%L)::text', r_1)));
  perform pg_temp.sv_expect_denied('26-8 代理店の管理者は、この関数では見られない（自社の案件は案件画面で見る）', '42501',
    pg_temp.sv_run_as('authenticated', u_d_mgr, format('select public.get_supervised_case(%L)::text', r_1)));
  perform pg_temp.sv_expect_denied('26-9 お客様は見られない', '42501',
    pg_temp.sv_run_as('authenticated', u_cust, format('select public.get_supervised_case(%L)::text', r_1)));
  perform pg_temp.sv_expect_denied('26-10 未ログインでは呼べない', '42501',
    pg_temp.sv_run_as('anon', null, format('select public.get_supervised_case(%L)::text', r_1)));
  perform pg_temp.sv_expect_eq('26-11 本部は一覧と詳細を見られる', 'true/1320000',
    pg_temp.sv_run_as('authenticated', u_admin, $q$ select (jsonb_array_length(public.list_supervised_cases()) >= 1)::text $q$) || '/' ||
    pg_temp.sv_run_as('authenticated', u_admin, format($q$ select (public.get_supervised_case(%L) -> 'quote' ->> 'total') $q$, r_1)));
  perform pg_temp.sv_expect_eq('26-12 直属の総代理店の管理者でも、案件・見積の表は直接読めない（顧客情報を含むため）', '0/0',
    pg_temp.sv_run_as('authenticated', u_md_mgr, format('select count(*)::text from public.quotes where id = %L', q_1)) || '/' ||
    pg_temp.sv_run_as('authenticated', u_md_mgr, format('select count(*)::text from public.quote_items where quote_id = %L', q_1)));

  -- ---------- 製造・出荷・施工に必要な情報（2026-11-04 の先方回答 B-3） ----------
  v_info := (pg_temp.sv_run_as('authenticated', u_md_mgr, format('select public.get_supervised_case(%L)::text', r_1))::jsonb) -> 'partner_info';
  perform pg_temp.sv_expect_eq('26-12b 詳細に、案件名・顧客番号・設置場所の住所と条件・現地確認と写真を返す（B-3）',
    'RT 確認の案件/C-SV-0001/秘密県秘密市1-2-3/owned/120.50/residential/wide/available/unavailable/unknown/completed/4t 車で搬入できる/第一種住居地域/北側の境界から 2m/1/搬入経路の写真',
    coalesce((v_info ->> 'case_name') || '/' || (v_info ->> 'customer_no') || '/' || (v_info ->> 'site_address') || '/' ||
      (v_info #>> '{land,land_status}') || '/' || (v_info #>> '{land,area_sqm}') || '/' || (v_info #>> '{land,land_category}') || '/' ||
      (v_info #>> '{land,road_access}') || '/' || (v_info #>> '{land,electricity}') || '/' || (v_info #>> '{land,water}') || '/' ||
      (v_info #>> '{land,drainage}') || '/' || (v_info #>> '{survey,status}') || '/' || (v_info #>> '{survey,land,delivery_route}') || '/' ||
      (v_info #>> '{survey,legal,zoning}') || '/' || (v_info #>> '{survey,survey_notes}') || '/' ||
      jsonb_array_length(v_info -> 'survey_files')::text || '/' || (v_info #>> '{survey_files,0,caption}'), '(none)'));
  perform pg_temp.sv_expect_eq('26-12c 製造・出荷・施工に必要な情報にも、お客様の氏名・会社名・電話・メール・ご自宅の住所・メッセージ・打合せの希望と記録・土地のメモ・お客様が送った資料・調査者の名前は含めない',
    '0/0/0/0/0/0/0/0/0/0/0',
    position('秘密 太郎' in v_info::text)::text || '/' || position('秘密商事' in v_info::text)::text || '/' ||
    position('090-9999' in v_info::text)::text || '/' || position('sv-customer-secret' in v_info::text)::text || '/' ||
    position('自宅県' in v_info::text)::text || '/' || position('秘密のメッセージ' in v_info::text)::text || '/' ||
    position('打合せの秘密' in v_info::text)::text || '/' || position('土地の秘密のメモ' in v_info::text)::text || '/' ||
    position('お客様が送った秘密の資料' in v_info::text)::text || '/' || position('customer.pdf' in v_info::text)::text || '/' ||
    position('代理店 担当者' in v_info::text)::text);
  perform pg_temp.sv_expect_eq('26-12d 現地確認の写真は、直属の総代理店の管理者が読める（RLS）。お客様が送った資料は読めない', '1/0',
    pg_temp.sv_run_as('authenticated', u_md_mgr, format('select count(*)::text from public.case_files where id = %L', f_survey)) || '/' ||
    pg_temp.sv_run_as('authenticated', u_md_mgr, format('select count(*)::text from public.case_files where id = %L', f_doc)));
  perform pg_temp.sv_expect_eq('26-12e 総代理店の担当者（管理者でない）とお客様は、現地確認の写真を読めない', '0/0',
    pg_temp.sv_run_as('authenticated', u_md_staff, format('select count(*)::text from public.case_files where id = %L', f_survey)) || '/' ||
    pg_temp.sv_run_as('authenticated', u_cust, format('select count(*)::text from public.case_files where id = %L', f_survey)));
  perform pg_temp.sv_expect_eq('26-12g 製造担当組織（別の総代理店）は、現地確認の写真を読め、お客様が送った資料は読めない（B-3）', '1/0',
    pg_temp.sv_run_as('authenticated', u_md2_mgr, format('select count(*)::text from public.case_files where id = %L', f_survey)) || '/' ||
    pg_temp.sv_run_as('authenticated', u_md2_mgr, format('select count(*)::text from public.case_files where id = %L', f_doc)));
  perform pg_temp.sv_expect_denied('26-12f 内部の部品（case_partner_site_info）は利用者から直接呼べない', '42501',
    pg_temp.sv_run_as('authenticated', u_md_mgr, format('select public.case_partner_site_info(%L)::text', r_1)));

  -- ---------- 資料：現地確認は写真だけ、施工・製造の記録は配下の確認も読める（2026-11-09 の独立レビューへの対応） ----------
  v_out := pg_temp.sv_run_as('authenticated', u_md_mgr, format('select public.get_supervised_case(%L)::text', r_1));
  perform pg_temp.sv_expect_eq('26-15 配下の確認と製造担当組織は、施工の写真を読め、現地確認の画像でない資料は読めない。詳細の資料の一覧もそのとおり',
    '1/0/1/0/1/1/基礎の写真',
    pg_temp.sv_run_as('authenticated', u_md_mgr, format('select count(*)::text from public.case_files where id = %L', f_progress)) || '/' ||
    pg_temp.sv_run_as('authenticated', u_md_mgr, format('select count(*)::text from public.case_files where id = %L', f_survey_pdf)) || '/' ||
    pg_temp.sv_run_as('authenticated', u_md2_mgr, format('select count(*)::text from public.case_files where id = %L', f_progress)) || '/' ||
    pg_temp.sv_run_as('authenticated', u_md2_mgr, format('select count(*)::text from public.case_files where id = %L', f_survey_pdf)) || '/' ||
    jsonb_array_length(v_out::jsonb #> '{partner_info,survey_files}')::text || '/' ||
    jsonb_array_length(v_out::jsonb -> 'progress_files')::text || '/' || (v_out::jsonb #>> '{progress_files,0,caption}'));
  perform pg_temp.sv_expect_eq('26-16 詳細の個体は、今の製造依頼のものだけ（取り消した製造依頼の個体は出さない）', '1/2',
    jsonb_array_length(v_out::jsonb -> 'units')::text || '/' ||
    (select count(*)::text from public.manufacturing_units u where u.quote_request_id = r_1));
  perform pg_temp.sv_expect_eq('26-16b 案件の担当（主担当者）は、現地確認の画像でない資料も読める', '1',
    pg_temp.sv_run_as('authenticated', u_d_staff, format('select count(*)::text from public.case_files where id = %L', f_survey_pdf)));

  -- ---------- 営業担当が別の総代理店の配下に移ると、前の総代理店は見られない ----------
  update public.case_workflows set sales_organization_id = o_d2 where quote_request_id = r_1;
  perform pg_temp.sv_expect_eq('26-13 営業担当が別の総代理店の配下へ移ると、前の総代理店の一覧から消え、新しい総代理店の一覧に出る', '0/1',
    pg_temp.sv_run_as('authenticated', u_md_mgr, $q$ select jsonb_array_length(public.list_supervised_cases())::text $q$) || '/' ||
    pg_temp.sv_run_as('authenticated', u_md2_mgr, $q$ select jsonb_array_length(public.list_supervised_cases())::text $q$));
  perform pg_temp.sv_expect_denied('26-14 前の総代理店は詳細も見られない', '42501',
    pg_temp.sv_run_as('authenticated', u_md_mgr, format('select public.get_supervised_case(%L)::text', r_1)));

  -- 下書きの製造依頼は、製造の担当へまだ届いていないため出さない（進み具合の「なし」とそろえる）
  set local session_replication_role = replica;
  update public.manufacturing_orders set status = 'draft', sent_at = null, received_at = null where id = mo_1;
  set local session_replication_role = origin;
  v_out := pg_temp.sv_run_as('authenticated', u_admin, format('select public.get_supervised_case(%L)::text', r_1));
  perform pg_temp.sv_expect_eq('26-17 下書きの製造依頼とその個体は詳細に出さない（進み具合は「なし」）', 'null/0/none',
    coalesce(v_out::jsonb ->> 'manufacturing_order', 'null') || '/' || jsonb_array_length(v_out::jsonb -> 'units')::text || '/' ||
    (v_out::jsonb #>> '{progress,manufacturing_status}'));
end;
$test$;

select jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq) as j
from _sv_result;

rollback;
