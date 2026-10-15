-- 総代理店の配下の確認（2026-10-15 先方確定。顧客情報の項目は先方の確認待ち）。
--
-- 先方の決まり：総代理店は配下代理店の案件全体の進捗を確認できる。案件の仕様・見積金額・明細・製造や施工に必要な記録は閲覧できる。
-- 顧客情報は案件対応に必要な範囲だけ（具体的な項目は、先方に提示した案の確認が済んでから確定する）。配下代理店の営業の内容
-- （担当の変更・顧客情報の変更・見積金額の変更や発行）は変えられない。製造側の記録の更新は、製造担当組織として行う。
--
-- 作り：
-- * 配下の案件の一覧と詳細を、専用の関数で返す（案件・見積の表の RLS は開かない）
-- * **お客様の氏名・会社名・連絡先・住所・メッセージ、設置場所・土地の情報、日程の希望、打合せ記録・本部への相談は返さない**。
--   見積からも customer_name／customer_company／お客様向けの備考（notes）／社内の備考（dealer_note）は返さない
-- * 対象は「営業担当が代理店で、その直属の総代理店の管理者」（is_case_supervisor）。本部は確認のために同じ内容を見られる

begin;

do $preflight$
begin
  if to_regprocedure('public.is_case_supervisor(uuid)') is null or to_regprocedure('public.case_role(uuid)') is null then
    raise exception 'PRECONDITION: case sales organization (20261015130000) must be applied first';
  end if;
end;
$preflight$;

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
    'handover_status', coalesce((select h.status from public.case_handovers h where h.quote_request_id = p_request_id), 'none')
  );
end;
$$;

alter function public.list_supervised_cases() owner to postgres;
alter function public.get_supervised_case(uuid) owner to postgres;
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
end;
$postcondition$;

commit;
