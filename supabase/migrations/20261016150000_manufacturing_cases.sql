-- 製造担当の案件（2026-10-15 先方確定：総代理店は製造受付・製造工程・検査・出荷・製造側の記録を更新する）。
--
-- 製造担当（製造担当組織のメンバー、これまでの案件で本部が選んだ総代理店の利用者）は、見積（お客様の情報を含む）を読めないため、
-- これまで製造の一覧の「受領する」しか操作の入口が無かった。製造・技術検討に必要な案件の情報を、お客様の情報を含まない形で返す。
--
-- 作り：
-- * list_manufacturing_cases()：自分が製造の担当の案件（本部はすべての製造担当つきの案件）。見積番号・仕様・営業担当・主担当者・
--   契約の済否・製造依頼と個体の進み具合
-- * get_manufacturing_case(p_request_id)：上に加えて、現在の見積の明細（品名・数量・単位だけ。金額は返さない）
-- * **お客様の氏名・会社名・連絡先・住所・メッセージ、見積の金額・備考、設置場所・土地、現地確認・打合せ記録は返さない**
-- * 判定は case_access() = 'manufacturer'（本部は admin）。書き込みは従来の RPC（製造依頼の状態・個体・工程・施工の記録・技術検討）

begin;

do $preflight$
begin
  if to_regprocedure('public.case_access(uuid)') is null or to_regprocedure('public.is_case_legacy_manufacturer(uuid)') is null then
    raise exception 'PRECONDITION: case sales organization (20261016130000) must be applied first';
  end if;
end;
$preflight$;

-- 1 件分の行（一覧と詳細で共通）。内部用
create function public.manufacturing_case_row(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'request_id', r.id,
           'quote', (
             select jsonb_build_object(
                      'quote_no', q.quote_no, 'revision', q.revision, 'status', q.status,
                      'base_model_name', q.base_model_name, 'spec_code', q.spec_code, 'finish_level', q.finish_level)
               from public.quotes q where q.id = r.quote_id
           ),
           'sales_organization', (select jsonb_build_object('id', s.id, 'name', s.name) from public.organizations s where s.id = w.sales_organization_id),
           'manufacturing_organization', (select jsonb_build_object('id', m.id, 'name', m.name) from public.organizations m where m.id = w.manufacturing_organization_id),
           'primary_staff_name', (select p.full_name from public.profiles p where p.id = w.primary_staff_id),
           'contract_signed', exists (select 1 from public.contracts c where c.quote_request_id = r.id and c.status = 'signed'),
           'order', (
             select jsonb_build_object(
                      'status', o.status, 'unit_count', o.unit_count, 'requested_delivery_on', o.requested_delivery_on,
                      'sent_at', o.sent_at, 'received_at', o.received_at, 'completed_at', o.completed_at,
                      'units_shipped', (select count(*) from public.manufacturing_units u where u.order_id = o.id and u.status in ('shipped', 'installed', 'handed_over')),
                      'units_installed', (select count(*) from public.manufacturing_units u where u.order_id = o.id and u.status in ('installed', 'handed_over')))
               from public.manufacturing_orders o
              where o.quote_request_id = r.id and o.status <> 'canceled'
              order by o.created_at desc
              limit 1
           ),
           'activity_at', greatest(w.updated_at, r.updated_at,
                                   coalesce((select max(o.updated_at) from public.manufacturing_orders o where o.quote_request_id = r.id), w.updated_at))
         )
    from public.quote_requests r
    join public.case_workflows w on w.quote_request_id = r.id
   where r.id = p_request_id;
$$;

-- 自分が製造の担当の案件（本部はすべての製造担当つきの案件）
create function public.list_manufacturing_cases()
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
    select jsonb_agg(public.manufacturing_case_row(x.quote_request_id) order by x.updated_at desc, x.quote_request_id)
      from (
        select w.quote_request_id, w.updated_at
          from public.case_workflows w
         where case
                 when v_admin then w.manufacturing_organization_id is not null or w.manufacturer_id is not null
                 -- 所属している組織・自分あての案件に絞ってから、書き込みの判定と同じ規則で確かめる
                 else (w.manufacturing_organization_id in (
                         select om.organization_id from public.organization_memberships om
                          where om.profile_id = v_uid and om.status = 'active')
                       or (w.manufacturing_organization_id is null and w.manufacturer_id = v_uid))
                      and public.case_access(w.quote_request_id) = 'manufacturer'
               end
      ) x
  ), '[]'::jsonb);
end;
$$;

-- 製造担当の案件の詳細（仕様の明細は品名・数量・単位だけ）
create function public.get_manufacturing_case(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access text;
  v_row jsonb;
  v_quote uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  v_access := public.case_access(p_request_id);
  if v_access is null or v_access not in ('admin', 'manufacturer') then
    raise exception using errcode = '42501', message = 'FORBIDDEN: この案件の製造の担当ではありません';
  end if;
  v_row := public.manufacturing_case_row(p_request_id);
  if v_row is null then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 製造の担当が決まっている案件ではありません';
  end if;
  select r.quote_id into v_quote from public.quote_requests r where r.id = p_request_id;
  return v_row || jsonb_build_object(
    'spec_items', coalesce((
      select jsonb_agg(jsonb_build_object('kind', qi.kind, 'name', qi.name, 'quantity', qi.quantity, 'unit', qi.unit)
                       order by qi.sort_order, qi.id)
        from public.quote_items qi where qi.quote_id = v_quote
    ), '[]'::jsonb)
  );
end;
$$;

alter function public.manufacturing_case_row(uuid) owner to postgres;
alter function public.list_manufacturing_cases() owner to postgres;
alter function public.get_manufacturing_case(uuid) owner to postgres;
revoke all on function public.manufacturing_case_row(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_manufacturing_cases() from public, anon, authenticated, service_role;
revoke all on function public.get_manufacturing_case(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_manufacturing_cases() to authenticated;
grant execute on function public.get_manufacturing_case(uuid) to authenticated;

do $postcondition$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner_name, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('manufacturing_case_row', 'list_manufacturing_cases', 'get_manufacturing_case')
  loop
    if v_fn.prosecdef is distinct from true or v_fn.owner_name <> 'postgres' then
      raise exception 'POSTCONDITION: % must be postgres-owned SECURITY DEFINER', v_fn.proname;
    end if;
    if not coalesce(v_fn.proconfig, '{}'::text[]) @> array['search_path=""']::text[] then
      raise exception 'POSTCONDITION: % search_path must be empty', v_fn.proname;
    end if;
    if has_function_privilege('anon', v_fn.oid, 'EXECUTE') or has_function_privilege('service_role', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by anon or service_role', v_fn.proname;
    end if;
    if v_fn.proname = 'manufacturing_case_row' and has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: internal function % must not be executable by application roles', v_fn.proname;
    end if;
    if v_fn.proname <> 'manufacturing_case_row' and not has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must be executable by authenticated', v_fn.proname;
    end if;
  end loop;
end;
$postcondition$;

commit;
