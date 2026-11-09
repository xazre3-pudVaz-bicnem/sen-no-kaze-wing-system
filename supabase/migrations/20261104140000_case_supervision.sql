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
--   現地確認の内容と写真）を足す（B-3）。製造の担当の画面（次の migration 20261104150000 の get_manufacturing_case）も同じ関数を使う
-- * 現地確認の写真（case_files の site_survey のうち画像）は、配下の確認と製造の担当からも読める。現地確認でも画像でない資料は見せない。
--   配下の確認は、施工・製造の記録（progress）も読める（ファイルの取り出しは RLS で判定する）
-- * 製造は、取り消していない・下書きでない製造依頼と、その個体だけを返す（進み具合の数とそろえる）
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
               from public.case_files f
              where f.quote_request_id = r.id and f.context = 'site_survey' and f.content_type like 'image/%'
           ), '[]'::jsonb))
    from public.quote_requests r
    left join public.quotes q on q.id = r.quote_id
    left join public.profiles p on p.id = r.user_id
    left join public.configuration_site_profiles sp on sp.configuration_id = r.configuration_id
   where r.id = p_request_id;
$$;

-- 案件の資料（case_files）を読めるか（RLS から呼ぶ。行ごとに case_role を 1 回だけ求める）。
-- 製造担当組織と配下の確認（直属の総代理店の管理者）は、施工・製造の記録（progress）と現地確認の写真（site_survey の画像）だけ（B-3）。
-- 現地確認の資料でも画像でないもの（PDF など）・お客様が送った資料・契約書・打合せの資料は見せない。これまでの個人の製造担当は従来どおり
create function public.case_file_readable(p_request_id uuid, p_context text, p_content_type text, p_customer_visible boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.case_role(p_request_id);
begin
  return case
    when v_role in ('admin', 'staff', 'manager') then true
    when v_role in ('manufacturer', 'supervisor') then
      p_context = 'progress'
      or (p_context = 'site_survey' and coalesce(p_content_type, '') like 'image/%')
      or (v_role = 'manufacturer' and public.is_case_legacy_manufacturer(p_request_id))
    when v_role = 'customer' then coalesce(p_customer_visible, false)
    else false
  end;
end;
$$;

comment on function public.case_file_readable(uuid, text, text, boolean) is
  '案件の資料を読めるか（case_files の RLS）。製造担当組織・配下の確認は施工・製造の記録と現地確認の写真だけ（2026-11-04 の先方回答 B-3）。';

drop policy if exists case_files_read on public.case_files;
create policy case_files_read on public.case_files
for select to authenticated
using (public.case_file_readable(quote_request_id, context, content_type, customer_visible));

-- ---------- 進み具合（内部用。権限は呼び出し側で確かめる） ----------
-- 配下の案件の一覧で、行ごとに get_case_progress（読み取りの判定をやり直す）を呼ばないよう、中身だけを分ける。
-- get_case_progress は読み取りの判定（case_role）の後にこれを返す（返す項目は 20261104130000 と同じ）
create function public.case_progress_summary(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.case_workflows;
  s public.site_surveys;
  o public.manufacturing_orders;
  h public.case_handovers;
  v_primary_name text;
begin
  select * into w from public.case_workflows where quote_request_id = p_request_id;
  select * into s from public.site_surveys where quote_request_id = p_request_id;
  select * into o from public.manufacturing_orders where quote_request_id = p_request_id and status <> 'canceled';
  select * into h from public.case_handovers where quote_request_id = p_request_id;
  if w.primary_staff_id is not null then
    select p.full_name into v_primary_name from public.profiles p where p.id = w.primary_staff_id;
  end if;
  return jsonb_build_object(
    'acknowledged_at', w.acknowledged_at,
    'primary_staff_name', v_primary_name,
    'site_survey_status', coalesce(s.status, 'none'),
    'site_survey_completed_at', s.completed_at,
    -- 製造：状態と棟数・出荷済み・設置済みの数だけ（仕様のスナップショット・供給手配のメモは返さない）
    'manufacturing_status', coalesce(case when o.status = 'draft' then null else o.status end, 'none'),
    'unit_count', o.unit_count,
    'units_shipped', (select count(*) from public.manufacturing_units u where u.order_id = o.id and u.status in ('shipped', 'installed', 'handed_over')),
    'units_installed', (select count(*) from public.manufacturing_units u where u.order_id = o.id and u.status in ('installed', 'handed_over')),
    -- 契約は締結済みかどうかだけ（契約の中身は本部とお客様だけが読める）。担当代理店・製造の担当の画面の判定に使う
    'contract_signed', exists (select 1 from public.contracts c where c.quote_request_id = p_request_id and c.status = 'signed'),
    'handover_status', coalesce(h.status, 'none')
  );
end;
$$;

create or replace function public.get_case_progress(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.case_role(p_request_id) is null then
    return null;
  end if;
  return public.case_progress_summary(p_request_id);
end;
$$;

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
                 -- 権限は下の条件で確かめているため、行ごとに読み取りの判定をやり直さない
                 'progress', public.case_progress_summary(w.quote_request_id),
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
  v_order public.manufacturing_orders;
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
  -- 製造依頼は、取り消し・下書きでないもの（進み具合の数と同じ。下書きは製造の担当へまだ届いていない）
  select * into v_order
    from public.manufacturing_orders mo
   where mo.quote_request_id = p_request_id and mo.status not in ('draft', 'canceled')
   order by mo.created_at desc
   limit 1;

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
    'progress', public.case_progress_summary(p_request_id),
    'manufacturing_order', case when v_order.id is null then null else jsonb_build_object(
      'status', v_order.status, 'unit_count', v_order.unit_count, 'requested_delivery_on', v_order.requested_delivery_on,
      'order_no', v_order.order_no, 'sent_at', v_order.sent_at, 'received_at', v_order.received_at, 'completed_at', v_order.completed_at,
      'spec_snapshot', v_order.spec_snapshot) end,
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
               'seq', u.seq, 'unit_no', u.unit_no, 'status', u.status, 'produced_on', u.produced_on,
               'inspected_on', u.inspected_on, 'shipped_on', u.shipped_on, 'installed_on', u.installed_on,
               'handed_over_on', u.handed_over_on, 'note', u.note
             ) order by u.seq)
        from public.manufacturing_units u where u.order_id = v_order.id
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
    -- 施工・製造の記録の資料（写真など）。ファイルの取り出しは case_files の RLS（case_file_readable）で判定する
    'progress_files', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'content_type', f.content_type,
                                          'caption', f.caption, 'created_at', f.created_at) order by f.created_at, f.id)
        from public.case_files f where f.quote_request_id = p_request_id and f.context = 'progress'
    ), '[]'::jsonb),
    'handover_status', coalesce((select h.status from public.case_handovers h where h.quote_request_id = p_request_id), 'none'),
    -- 製造・出荷・施工に必要な案件の情報（B-3。お客様の氏名・連絡先などは含めない）
    'partner_info', public.case_partner_site_info(p_request_id)
  );
end;
$$;

alter function public.case_partner_site_info(uuid) owner to postgres;
alter function public.case_file_readable(uuid, text, text, boolean) owner to postgres;
alter function public.case_progress_summary(uuid) owner to postgres;
alter function public.get_case_progress(uuid) owner to postgres;
alter function public.list_supervised_cases() owner to postgres;
alter function public.get_supervised_case(uuid) owner to postgres;
revoke all on function public.case_partner_site_info(uuid) from public, anon, authenticated, service_role;
revoke all on function public.case_progress_summary(uuid) from public, anon, authenticated, service_role;
revoke all on function public.case_file_readable(uuid, text, text, boolean) from public, anon, authenticated, service_role;
-- 資料の表の RLS から呼ぶ
grant execute on function public.case_file_readable(uuid, text, text, boolean) to authenticated;
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
     where n.nspname = 'public'
       and p.proname in ('list_supervised_cases', 'get_supervised_case', 'case_partner_site_info', 'case_progress_summary',
                         'case_file_readable', 'get_case_progress')
  loop
    if v_fn.prosecdef is distinct from true or v_fn.owner_name <> 'postgres' then
      raise exception 'POSTCONDITION: % must be postgres-owned SECURITY DEFINER', v_fn.proname;
    end if;
    if not coalesce(v_fn.proconfig, '{}'::text[]) @> array['search_path=""']::text[] then
      raise exception 'POSTCONDITION: % search_path must be empty', v_fn.proname;
    end if;
    if v_fn.proname in ('case_partner_site_info', 'case_progress_summary') then
      continue;
    end if;
    if has_function_privilege('anon', v_fn.oid, 'EXECUTE') or has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
       or not has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % EXECUTE must be authenticated only', v_fn.proname;
    end if;
  end loop;
  -- 内部の部品（B-3）は利用者から呼べない
  if has_function_privilege('anon', 'public.case_partner_site_info(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.case_partner_site_info(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.case_partner_site_info(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.case_progress_summary(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.case_progress_summary(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.case_progress_summary(uuid)', 'EXECUTE') then
    raise exception 'POSTCONDITION: case_partner_site_info / case_progress_summary must not be executable by application roles';
  end if;
  -- 資料の表は case_file_readable() の範囲だけ
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'case_files' and policyname = 'case_files_read'
       and qual like '%case_file_readable(quote_request_id, context, content_type, customer_visible)%'
  ) then
    raise exception 'POSTCONDITION: case_files must be readable only through case_file_readable()';
  end if;
end;
$postcondition$;

commit;
