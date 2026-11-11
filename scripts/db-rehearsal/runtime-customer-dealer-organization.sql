-- お客様が代理店を選ぶ（20261111150000）の実行時検査。使い捨て DB 専用。最後に rollback する。
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

create function pg_temp.cd_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _cd_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

-- お客様として、相談したい代理店を選んで希望を保存する
create function pg_temp.cd_choose(p_customer uuid, p_request uuid, p_dealer uuid) returns text
language sql as $fn$
  select pg_temp.cd_run_as('authenticated', p_customer,
    format($q$ select public.set_quote_request_preferences(%L, jsonb_build_object('preferred_dealer_id', %L))::text $q$, p_request, p_dealer));
$fn$;

create function pg_temp.cd_sales(p_request uuid) returns text
language sql as $fn$
  select coalesce((select s.name from public.case_workflows w join public.organizations s on s.id = w.sales_organization_id
                    where w.quote_request_id = p_request), '(none)');
$fn$;

create function pg_temp.cd_admin_notified(p_kind text, p_request uuid) returns text
language sql as $fn$
  select ((select count(*) from public.notifications n
            where n.audience = 'admin' and n.kind = p_kind and n.link like '%' || p_request::text) > 0)::text;
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
  u_area constant uuid := '60000000-0000-4000-8000-000000000008';
  o_md constant uuid := '61000000-0000-4000-8000-000000000001';
  o_d constant uuid := '61000000-0000-4000-8000-000000000002';
  o_nomgr constant uuid := '61000000-0000-4000-8000-000000000003';
  m_model constant uuid := '62000000-0000-4000-8000-000000000001';
  c_1 constant uuid := '63000000-0000-4000-8000-000000000001';
  c_2 constant uuid := '63000000-0000-4000-8000-000000000002';
  c_3 constant uuid := '63000000-0000-4000-8000-000000000003';
  c_4 constant uuid := '63000000-0000-4000-8000-000000000004';
  c_5 constant uuid := '63000000-0000-4000-8000-000000000005';
  c_6 constant uuid := '63000000-0000-4000-8000-000000000006';
  c_7 constant uuid := '63000000-0000-4000-8000-000000000007';
  c_8 constant uuid := '63000000-0000-4000-8000-000000000008';
  r_1 constant uuid := '64000000-0000-4000-8000-000000000001';
  r_2 constant uuid := '64000000-0000-4000-8000-000000000002';
  r_3 constant uuid := '64000000-0000-4000-8000-000000000003';
  r_4 constant uuid := '64000000-0000-4000-8000-000000000004';
  r_5 constant uuid := '64000000-0000-4000-8000-000000000005';
  r_6 constant uuid := '64000000-0000-4000-8000-000000000006';
  r_7 constant uuid := '64000000-0000-4000-8000-000000000007';
  r_8 constant uuid := '64000000-0000-4000-8000-000000000008';
  q_7 constant uuid := '65000000-0000-4000-8000-000000000007';
  v_out text;
  v_admin_before bigint;
begin
  set local session_replication_role = replica;
  insert into auth.users (id, email, raw_user_meta_data)
  select v.id, v.email, '{}'::jsonb
    from (values
      (u_admin, 'cd-admin@runtime.invalid'), (u_d_mgr, 'cd-d-mgr@runtime.invalid'), (u_d_staff, 'cd-d-staff@runtime.invalid'),
      (u_lone, 'cd-lone@runtime.invalid'), (u_nomgr, 'cd-nomgr@runtime.invalid'), (u_cust, 'cd-cust@runtime.invalid'),
      (u_md_mgr, 'cd-md-mgr@runtime.invalid'), (u_area, 'cd-area@runtime.invalid')
    ) as v(id, email);
  insert into public.profiles (id, email, full_name, role_code)
  values
    (u_admin, 'cd-admin@runtime.invalid', '本部', 'admin'),
    (u_d_mgr, 'cd-d-mgr@runtime.invalid', '選ばれる代理店 管理者', 'dealer'),
    (u_d_staff, 'cd-d-staff@runtime.invalid', '選ばれる代理店 担当者', 'dealer'),
    (u_lone, 'cd-lone@runtime.invalid', '組織に入っていない代理店', 'dealer'),
    (u_nomgr, 'cd-nomgr@runtime.invalid', '管理者のいない組織の担当者', 'dealer'),
    (u_cust, 'cd-cust@runtime.invalid', 'お客様', 'customer'),
    (u_md_mgr, 'cd-md-mgr@runtime.invalid', '直属の総代理店 管理者', 'master_dealer'),
    (u_area, 'cd-area@runtime.invalid', '富山県だけの代理店', 'dealer');
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
    (o_d, u_area, 'editor', 'active', true),
    (o_nomgr, u_nomgr, 'editor', 'active', true);
  insert into public.dealer_profiles (dealer_id, display_name, published, published_at, service_prefectures)
  values (u_d_staff, '選ばれる代理店', true, now(), '{}'),
         (u_lone, '組織に入っていない代理店', true, now(), '{}'),
         (u_nomgr, '管理者のいない代理店', true, now(), '{}'),
         (u_area, '富山県だけの代理店', true, now(), '{富山県}');
  insert into public.base_models (id, slug, name, base_price, status)
  values (m_model, 'runtime-cd-model', '選択検査用モデル', 1000000, 'published') on conflict (slug) do nothing;
  insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level, site_prefecture, site_municipality)
  values (c_1, u_cust, m_model, '組織の代理店を選ぶ', 'quote_requested', 'office', 'full', null, null),
         (c_2, u_cust, m_model, '組織に入っていない代理店を選ぶ', 'quote_requested', 'office', 'full', null, null),
         (c_3, u_cust, m_model, '管理者のいない組織の代理店を選ぶ', 'quote_requested', 'office', 'full', null, null),
         (c_4, u_cust, m_model, '営業担当が決まった後に選ぶ', 'quote_requested', 'office', 'full', null, null),
         (c_5, u_cust, m_model, '所属を外れた代理店を選ぶ', 'quote_requested', 'office', 'full', null, null),
         (c_6, u_cust, m_model, '前からある案件で選ぶ', 'quote_requested', 'office', 'full', null, null),
         (c_7, u_cust, m_model, '見積の担当がいる案件で選ぶ', 'quote_requested', 'office', 'full', null, null),
         (c_8, u_cust, m_model, '石川県の設置予定地', 'quote_requested', 'office', 'full', '石川県', '七尾市');
  insert into public.quote_requests (id, configuration_id, user_id, status, contact, created_at)
  values (r_1, c_1, u_cust, 'new', '{}'::jsonb, now()), (r_2, c_2, u_cust, 'new', '{}'::jsonb, now()),
         (r_3, c_3, u_cust, 'new', '{}'::jsonb, now()), (r_4, c_4, u_cust, 'new', '{}'::jsonb, now()),
         (r_5, c_5, u_cust, 'new', '{}'::jsonb, now()),
         -- 依頼から 2 日たった案件（見積依頼の直後でない）
         (r_6, c_6, u_cust, 'sent', '{}'::jsonb, now() - interval '2 days'),
         (r_7, c_7, u_cust, 'sent', '{}'::jsonb, now()), (r_8, c_8, u_cust, 'new', '{}'::jsonb, now());
  insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                             customer_name, base_model_name, base_price, option_subtotal, installation_subtotal,
                             subtotal, tax_rate, tax, total, revision)
  values (q_7, 'RT-CD-7', r_7, c_7, u_cust, u_lone, 'issued', now() + interval '30 days', 'お客様', '選択検査用モデル',
          1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 1);
  set local session_replication_role = origin;

  -- ---------- 見積依頼の直後に、組織に所属する代理店の紹介ページを選ぶ → その組織が営業担当、製造担当は直属の総代理店 ----------
  select count(*) into v_admin_before from public.notifications where audience = 'admin' and kind = 'case_preferred_dealer';
  v_out := pg_temp.cd_choose(u_cust, r_1, u_d_staff);
  perform pg_temp.cd_expect_eq('28-1 見積依頼の直後に、組織に所属する代理店（担当者）の紹介ページを選ぶと、その組織が営業担当になり、製造担当は直属の総代理店になる',
    '/選択検査代理店/選択検査総代理店/true',
    v_out || '/' ||
    (select s.name || '/' || m.name || '/' || w.manufacturing_auto::text
       from public.case_workflows w
       join public.organizations s on s.id = w.sales_organization_id
       join public.organizations m on m.id = w.manufacturing_organization_id
      where w.quote_request_id = r_1));
  perform pg_temp.cd_expect_eq('28-2 組織の管理者・製造担当の総代理店の管理者・本部（営業担当にした）に届き、本部に「担当代理店を割り当てて」は届かない',
    'true/true/true/0',
    ((select count(*) from public.notifications where recipient_id = u_d_mgr and kind = 'case_sales_assigned') > 0)::text || '/' ||
    ((select count(*) from public.notifications where recipient_id = u_md_mgr and kind = 'case_manufacturer_assigned') > 0)::text || '/' ||
    pg_temp.cd_admin_notified('case_sales_assigned', r_1) || '/' ||
    ((select count(*) from public.notifications where audience = 'admin' and kind = 'case_preferred_dealer') - v_admin_before)::text);
  perform pg_temp.cd_expect_eq('28-3 組織の管理者は案件を開け（manager）、選ばれた担当者はまだ主担当者ではない', 'manager/(null)',
    pg_temp.cd_run_as('authenticated', u_d_mgr, format('select public.case_role(%L)', r_1)) || '/' ||
    pg_temp.cd_run_as('authenticated', u_d_staff, format('select public.case_role(%L)', r_1)));
  perform pg_temp.cd_expect_eq('28-8 お客様の選択で営業担当組織を決めたことは監査ログに残る（お客様が実行・選んだ代理店つき）', 'true',
    (exists (select 1 from public.audit_logs a
              where a.entity = 'quote_request' and a.entity_id = r_1 and a.action = 'case_sales_organization'
                and a.actor_id = u_cust and (a.after ->> 'preferred_dealer_id') = u_d_staff::text))::text);

  -- ---------- 組織に所属していない代理店・管理者のいない組織の代理店は、これまでどおり本部が担当を決める ----------
  perform pg_temp.cd_choose(u_cust, r_2, u_lone);
  perform pg_temp.cd_expect_eq('28-4 組織に所属していない代理店を選ぶと、営業担当は決めず、本部に「相談したい代理店」が届く', '(none)/true',
    pg_temp.cd_sales(r_2) || '/' || pg_temp.cd_admin_notified('case_preferred_dealer', r_2));
  perform pg_temp.cd_choose(u_cust, r_3, u_nomgr);
  perform pg_temp.cd_expect_eq('28-5 管理者のいない組織の代理店を選んでも、営業担当にはしない（受けられる人がいないため）', '(none)/true',
    pg_temp.cd_sales(r_3) || '/' || pg_temp.cd_admin_notified('case_preferred_dealer', r_3));

  -- ---------- 営業担当が決まった後・本部が外した後は、お客様の選択では変えない ----------
  perform pg_temp.cd_run_as('authenticated', u_admin, format('select public.set_case_sales_organization(%L, %L)::text', r_4, o_md));
  perform pg_temp.cd_choose(u_cust, r_4, u_d_staff);
  perform pg_temp.cd_expect_eq('28-6 営業担当が決まった後に代理店を選んでも営業担当は変わらず、本部に「相談したい代理店」が届く', '選択検査総代理店/true',
    pg_temp.cd_sales(r_4) || '/' || pg_temp.cd_admin_notified('case_preferred_dealer', r_4));
  perform pg_temp.cd_run_as('authenticated', u_admin, format('select public.set_case_sales_organization(%L, null)::text', r_1));
  perform pg_temp.cd_choose(u_cust, r_1, u_d_staff);
  perform pg_temp.cd_expect_eq('28-9 本部が営業担当組織を外した案件で、お客様がもう一度希望を保存しても、営業担当組織は決まらない（2 回目の保存）', '(none)',
    pg_temp.cd_sales(r_1));

  -- ---------- 見積依頼の直後でない・見積の担当がいる案件は、お客様の選択で決めない ----------
  perform pg_temp.cd_choose(u_cust, r_6, u_d_staff);
  perform pg_temp.cd_expect_eq('28-10 依頼から時間がたった案件（これまでの案件を含む）で選んでも、営業担当組織は決まらず本部に届く', '(none)/true',
    pg_temp.cd_sales(r_6) || '/' || pg_temp.cd_admin_notified('case_preferred_dealer', r_6));
  perform pg_temp.cd_choose(u_cust, r_7, u_d_staff);
  perform pg_temp.cd_expect_eq('28-11 見積の担当がいる案件で選んでも、営業担当組織は決まらず、見積の担当も外れない', '(none)/1',
    pg_temp.cd_sales(r_7) || '/' || (select count(*)::text from public.quotes q where q.quote_request_id = r_7 and q.dealer_id = u_lone));

  -- ---------- 入力の確かめ：組織を直接指定させない・設置予定地に対応している代理店だけ ----------
  perform pg_temp.cd_expect_denied('28-12 組織を直接指定する入力（preferred_organization_id）は受け付けない', 'P0001',
    pg_temp.cd_run_as('authenticated', u_cust,
      format($q$ select public.set_quote_request_preferences(%L, jsonb_build_object('preferred_organization_id', %L))::text $q$, r_8, o_d)));
  perform pg_temp.cd_expect_denied('28-13 設置予定地（石川県）に対応していない代理店（富山県だけ）は選べない', 'P0001',
    pg_temp.cd_choose(u_cust, r_8, u_area));
  perform pg_temp.cd_expect_eq('28-14 拒否したときは希望も営業担当組織も保存しない', '0/(none)',
    (select count(*)::text from public.quote_request_preferences p where p.quote_request_id = r_8) || '/' || pg_temp.cd_sales(r_8));

  -- ---------- 見積依頼の画面の候補 ----------
  perform pg_temp.cd_expect_eq('28-15 見積依頼の画面で選べるのは、営業担当にできる組織（有効・管理者あり）の代理店だけ', 'true/true/false/false',
    pg_temp.cd_run_as('authenticated', u_cust, format('select (%L::uuid in (select public.list_selectable_dealer_ids()))::text', u_d_staff)) || '/' ||
    pg_temp.cd_run_as('authenticated', u_cust, format('select (%L::uuid in (select public.list_selectable_dealer_ids()))::text', u_area)) || '/' ||
    pg_temp.cd_run_as('authenticated', u_cust, format('select (%L::uuid in (select public.list_selectable_dealer_ids()))::text', u_lone)) || '/' ||
    pg_temp.cd_run_as('authenticated', u_cust, format('select (%L::uuid in (select public.list_selectable_dealer_ids()))::text', u_nomgr)));
  perform pg_temp.cd_expect_denied('28-16 候補の一覧は、ログインしていないと呼べない', '42501',
    pg_temp.cd_run_as('anon', null, 'select count(*)::text from public.list_selectable_dealer_ids()'));
  perform pg_temp.cd_expect_eq('28-17 内部の判定（設置予定地・組織）は、利用者から呼べない', '42501/42501',
    substr(pg_temp.cd_run_as('authenticated', u_cust, format('select public.dealer_serves_area(%L, %L, null)::text', u_area, '石川県')), 7, 5) || '/' ||
    substr(pg_temp.cd_run_as('authenticated', u_cust, format('select public.selectable_dealer_organization(%L)::text', u_d_staff)), 7, 5));

  -- ---------- 所属を外れた代理店は、組織の候補にしない ----------
  update public.organization_memberships set status = 'inactive' where profile_id = u_d_staff;
  perform pg_temp.cd_choose(u_cust, r_5, u_d_staff);
  perform pg_temp.cd_expect_eq('28-7 所属を外れた代理店の紹介ページを選んでも、もとの組織を営業担当にしない（候補の一覧からも消える）', '(none)/false',
    pg_temp.cd_sales(r_5) || '/' ||
    pg_temp.cd_run_as('authenticated', u_cust, format('select (%L::uuid in (select public.list_selectable_dealer_ids()))::text', u_d_staff)));
end;
$test$;

select jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq) as j
from _cd_result;

rollback;
