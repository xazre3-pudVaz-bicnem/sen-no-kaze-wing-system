-- 総代理店の配下の確認（2026-10-15 先方確定。総代理店に見せる顧客情報の項目は 2026-11-04 の先方回答 B-3 で確定）。
--
-- 先方の決まり：総代理店は配下代理店の案件全体の進捗を確認できる。案件の仕様・見積金額・明細・製造や施工に必要な記録は閲覧できる。
-- 顧客情報は案件対応に必要な範囲だけ。配下代理店の営業の内容（担当の変更・顧客情報の変更・見積金額の変更や発行）は変えられない。
-- 製造側の記録の更新は、製造担当組織として行う。
-- B-3（2026-11-04）：総代理店には、配下の担当案件について製造・出荷・施工に必要な案件名・顧客番号・設置場所・現地確認情報等だけを
-- 表示する。顧客の氏名・会社名、連絡先、営業・契約情報、顧客からの提出資料は原則非表示（必要な資料は代理店から個別に共有）。
--
-- 作り：
-- * 配下の案件の一覧と詳細を、専用の関数で返す（案件・見積の表の RLS は開かない）
-- * **お客様の氏名・会社名・電話・メール・ご自宅の住所・メッセージ、日程の希望、打合せ記録・本部への相談、契約書、
--   お客様が送った資料、土地なしの場合の希望地域・予算・お客様のメモは返さない**。
--   見積からも customer_name／customer_company／お客様向けの備考（notes）／社内の備考（dealer_note）は返さない
-- * 詳細には、製造・出荷・施工に必要な情報（case_partner_site_info：案件名・顧客番号・設置場所の住所・設置場所の条件・用途・
--   現地確認の内容と写真）を足す（B-3）。製造の担当（get_manufacturing_case）も同じ関数を使う
-- * 現地確認の写真（case_files の site_survey）は、配下の確認と製造の担当からも読める（ファイルの取り出しは RLS で判定する）
-- * 対象は「営業担当が代理店で、その直属の総代理店の管理者」（is_case_supervisor）。本部は確認のために同じ内容を見られる

begin;

do $preflight$
begin
  if to_regprocedure('public.is_case_supervisor(uuid)') is null or to_regprocedure('public.case_role(uuid)') is null then
    raise exception 'PRECONDITION: case sales organization (20261104130000) must be applied first';
  end if;
end;
$preflight$;

-- ---------- 総代理店に見せる、製造・出荷・施工に必要な案件の情報（2026-11-04 の先方回答 B-3）。内部用 ----------
-- 見せる：案件名・顧客番号／設置場所の住所／設置場所の条件（土地の有無・面積・地目・前面道路・電気・水道・排水）／用途／
--         現地確認の内容（土地・搬入・インフラ・法規の項目、測量・確認のメモ）と現地確認の写真（一覧）
-- 見せない：お客様の氏名・会社名・電話・メール・ご自宅の住所、見積依頼のメッセージ・打合せの方法・希望日、
--           土地なしの場合の希望地域・予算・お客様のメモ、打合せ記録・本部への相談、契約書、お客様が送った資料
-- 設置場所の住所は、見積依頼のときの連絡先の設置予定地を先に、無ければ保存したプランの設置予定地
create function public.case_partner_site_info(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'case_name', nullif(btrim(coalesce(r.case_name, '')), ''),
           'customer_no', coalesce(q.customer_no, p.customer_no),
           'site_address', coalesce(nullif(btrim(coalesce(r.contact ->> 'site_address', '')), ''), nullif(btrim(coalesce(sp.site_address, '')), '')),
           'land', case when sp.configuration_id is null then null else jsonb_build_object(
             'land_status', sp.land_status, 'area_sqm', sp.area_sqm, 'land_category', sp.land_category,
             'road_access', sp.road_access, 'electricity', sp.electricity, 'water', sp.water, 'drainage', sp.drainage,
             'intended_use', sp.intended_use) end,
           'survey', (
             select jsonb_build_object('status', s.status, 'surveyed_on', s.surveyed_on, 'land', s.land, 'legal', s.legal,
                                       'survey_notes', s.survey_notes, 'completed_at', s.completed_at)
               from public.site_surveys s where s.quote_request_id = r.id
           ),
           'survey_files', coalesce((
             select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'content_type', f.content_type,
                                                 'caption', f.caption, 'created_at', f.created_at) order by f.created_at, f.id)
               from public.case_files f where f.quote_request_id = r.id and f.context = 'site_survey'
           ), '[]'::jsonb))
    from public.quote_requests r
    left join public.quotes q on q.id = r.quote_id
    left join public.profiles p on p.id = r.user_id
    left join public.configuration_site_profiles sp on sp.configuration_id = r.configuration_id
   where r.id = p_request_id;
$$;

-- 現地確認の写真は、配下の確認（直属の総代理店の管理者）と製造の担当からも読める（B-3）。
-- そのほかの資料（お客様が送った資料・契約書・打合せの資料など）は今までどおり
drop policy if exists case_files_read on public.case_files;
create policy case_files_read on public.case_files
for select to authenticated
using (
  public.case_role(quote_request_id) in ('admin', 'staff', 'manager')
  -- 製造担当組織は施工・製造の写真（progress）と現地確認の写真（site_survey）。これまでの個人の製造担当は従来どおり
  or (public.case_role(quote_request_id) = 'manufacturer'
      and (context in ('progress', 'site_survey') or public.is_case_legacy_manufacturer(quote_request_id)))
  -- 配下の確認は現地確認の写真だけ（B-3）
  or (context = 'site_survey' and public.case_role(quote_request_id) = 'supervisor')
  or (customer_visible and public.case_role(quote_request_id) = 'customer')
);

-- 配下の案件の一覧（総代理店の管理者・本部）
create function public.list_supervised_cases()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := coalesce(public.current_role_rank(), 0) >= 3;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  return coalesce((
    select jsonb_agg(x.row order by x.activity_at desc, x.request_id)
      from (
        select w.quote_request_id as request_id,
               greatest(w.updated_at, r.updated_at) as activity_at,
               jsonb_build_object(
                 'request_id', w.quote_request_id,
                 'sales_organization', jsonb_build_object('id', s.id, 'name', s.name),
                 'supervisor_organization', jsonb_build_object('id', p.id, 'name', p.name),
                 'manufacturing_organization', case when m.id is null then null else jsonb_build_object('id', m.id, 'name', m.name) end,
                 'primary_staff_name', ps.full_name,
                 'quote', (
                   select jsonb_build_object(
                            'id', q.id, 'quote_no', q.quote_no, 'revision', q.revision, 'status', q.status,
                            'base_model_name', q.base_model_name, 'spec_code', q.spec_code, 'finish_level', q.finish_level,
                            'total', q.total, 'issued_at', q.issued_at)
                     from public.quotes q where q.id = r.quote_id
                 ),
                 'progress', public.get_case_progress(w.quote_request_id),
                 'activity_at', greatest(w.updated_at, r.updated_at)
               ) as row
          from public.case_workflows w
          join public.quote_requests r on r.id = w.quote_request_id
          join public.organizations s on s.id = w.sales_organization_id and s.organization_type = 'dealer'
          join public.organizations p on p.id = s.parent_organization_id
          left join public.organizations m on m.id = w.manufacturing_organization_id
          left join public.profiles ps on ps.id = w.primary_staff_id
         where v_admin
            or (p.status = 'active' and exists (
                  select 1 from public.organization_memberships om
                   where om.organization_id = p.id and om.profile_id = v_uid and om.status = 'active'
                     and om.member_role in ('owner', 'admin')
                ))
      ) x
  ), '[]'::jsonb);
end;
$$;

-- 配下の案件の詳細（総代理店の管理者・本部）
create function public.get_supervised_case(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.case_workflows;
  r public.quote_requests;
  q public.quotes;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if not (coalesce(public.current_role_rank(), 0) >= 3 or public.is_case_supervisor(p_request_id)) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 配下の代理店の案件ではありません';
  end if;
  select * into w from public.case_workflows cw where cw.quote_request_id = p_request_id;
  select * into r from public.quote_requests qr where qr.id = p_request_id;
  if r.id is null then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 案件が見つかりません';
  end if;
  select * into q from public.quotes x where x.id = r.quote_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'sales_organization', (select jsonb_build_object('id', o.id, 'name', o.name) from public.organizations o where o.id = w.sales_organization_id),
    'manufacturing_organization', (select jsonb_build_object('id', o.id, 'name', o.name) from public.organizations o where o.id = w.manufacturing_organization_id),
    'primary_staff_name', (select p.full_name from public.profiles p where p.id = w.primary_staff_id),
    'quote', case when q.id is null then null else jsonb_build_object(
      'id', q.id, 'quote_no', q.quote_no, 'revision', q.revision, 'status', q.status,
      'issued_at', q.issued_at, 'valid_until', q.valid_until,
      'base_model_name', q.base_model_name, 'spec_code', q.spec_code, 'finish_level', q.finish_level,
      'base_price', q.base_price, 'base_expense', q.base_expense, 'option_subtotal', q.option_subtotal,
      'option_expense', q.option_expense, 'installation_subtotal', q.installation_subtotal, 'adjustment', q.adjustment,
      'subtotal', q.subtotal, 'tax_rate', q.tax_rate, 'tax', q.tax, 'total', q.total
    ) end,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', qi.kind, 'name', qi.name, 'description', qi.description, 'quantity', qi.quantity, 'unit', qi.unit,
               'unit_price', qi.unit_price, 'amount', qi.amount, 'remark', qi.remark
             ) order by qi.sort_order, qi.id)
        from public.quote_items qi where qi.quote_id = q.id
    ), '[]'::jsonb),
    'progress', public.get_case_progress(p_request_id),
    'manufacturing_order', (
      select jsonb_build_object(
               'status', o.status, 'unit_count', o.unit_count, 'requested_delivery_on', o.requested_delivery_on,
               'order_no', o.order_no, 'sent_at', o.sent_at, 'received_at', o.received_at, 'completed_at', o.completed_at,
               'spec_snapshot', o.spec_snapshot)
        from public.manufacturing_orders o
       where o.quote_request_id = p_request_id and o.status <> 'canceled'
       order by o.created_at desc
       limit 1
    ),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seq', u.seq, 'unit_no', u.unit_no, 'status', u.status, 'produced_on', u.produced_on,
               'inspected_on', u.inspected_on, 'shipped_on', u.shipped_on, 'installed_on', u.installed_on,
               'handed_over_on', u.handed_over_on, 'note', u.note
             ) order by u.seq)
        from public.manufacturing_units u where u.quote_request_id = p_request_id
    ), '[]'::jsonb),
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
               'category', s.category, 'title', s.title, 'planned_start', s.planned_start, 'planned_end', s.planned_end,
               'actual_start', s.actual_start, 'actual_end', s.actual_end, 'status', s.status, 'note', s.note
             ) order by s.sort_order, s.planned_start nulls last, s.id)
        from public.case_schedule_items s where s.quote_request_id = p_request_id
    ), '[]'::jsonb),
    'progress_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', pr.kind, 'title', pr.title, 'body', pr.body, 'reported_on', pr.reported_on, 'author_name', pr.author_name
             ) order by pr.reported_on desc nulls last, pr.created_at desc)
        from public.case_progress_reports pr where pr.quote_request_id = p_request_id
    ), '[]'::jsonb),
    'handover_status', coalesce((select h.status from public.case_handovers h where h.quote_request_id = p_request_id), 'none'),
    -- 製造・出荷・施工に必要な案件の情報（B-3。お客様の氏名・連絡先などは含めない）
    'partner_info', public.case_partner_site_info(p_request_id)
  );
end;
$$;

alter function public.case_partner_site_info(uuid) owner to postgres;
alter function public.list_supervised_cases() owner to postgres;
alter function public.get_supervised_case(uuid) owner to postgres;
revoke all on function public.case_partner_site_info(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_supervised_cases() from public, anon, authenticated, service_role;
revoke all on function public.get_supervised_case(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_supervised_cases() to authenticated;
grant execute on function public.get_supervised_case(uuid) to authenticated;

do $postcondition$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner_name, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('list_supervised_cases', 'get_supervised_case')
  loop
    if v_fn.prosecdef is distinct from true or v_fn.owner_name <> 'postgres' then
      raise exception 'POSTCONDITION: % must be postgres-owned SECURITY DEFINER', v_fn.proname;
    end if;
    if not coalesce(v_fn.proconfig, '{}'::text[]) @> array['search_path=""']::text[] then
      raise exception 'POSTCONDITION: % search_path must be empty', v_fn.proname;
    end if;
    if has_function_privilege('anon', v_fn.oid, 'EXECUTE') or has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
       or not has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % EXECUTE must be authenticated only', v_fn.proname;
    end if;
  end loop;
  -- 内部の部品（B-3）は利用者から呼べない
  if has_function_privilege('anon', 'public.case_partner_site_info(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.case_partner_site_info(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.case_partner_site_info(uuid)', 'EXECUTE') then
    raise exception 'POSTCONDITION: case_partner_site_info must not be executable by application roles';
  end if;
end;
$postcondition$;

commit;
