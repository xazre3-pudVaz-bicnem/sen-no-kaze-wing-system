-- =============================================================
-- 顧客管理：担当案件に限定した read-only RPC
--
-- 本部(admin)        : 全顧客・全案件
-- 総代理店 / 代理店 : 自分が担当する quote_request 系列だけ
--
-- profiles / quote_requests / configurations の既存RLSは広げない。
-- 非Web Draft段階の担当根拠は後続Quote基盤で確定後に追加する。
-- =============================================================

create or replace function public.list_accessible_customers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rank integer;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  v_rank := public.current_role_rank();
  if v_rank < 1 then
    raise exception 'FORBIDDEN: 顧客管理を閲覧できるのは代理店以上です'
      using errcode = '42501';
  end if;

  with accessible_requests as (
    select r.*
      from public.quote_requests as r
     where v_rank >= 3
        or exists (
          select 1
            from public.quotes as aq
           where aq.quote_request_id = r.id
             and aq.dealer_id = v_uid
        )
  ),
  case_rows as (
    select
      r.id as case_id,
      r.user_id as request_user_id,
      r.status as request_status,
      r.contact,
      latest.id as latest_quote_id,
      latest.quote_no as latest_quote_no,
      latest.status as latest_quote_status,
      latest.base_model_name as latest_model_name,
      latest.dealer_id as latest_dealer_id,
      open_quote.id as open_quote_id,
      dealer.full_name as dealer_name,
      coalesce(
        nullif(btrim(r.contact ->> 'site_address'), ''),
        case
          when cfg.site_location_undecided then '未定'
          else nullif(concat_ws('', cfg.site_prefecture, cfg.site_municipality), '')
        end
      ) as site_address,
      coalesce(latest.base_model_name, model.name) as model_name,
      greatest(
        r.updated_at,
        r.created_at,
        coalesce(latest.updated_at, 'epoch'::timestamptz),
        coalesce(latest.issued_at, 'epoch'::timestamptz),
        coalesce(latest.created_at, 'epoch'::timestamptz),
        coalesce(cfg.updated_at, 'epoch'::timestamptz)
      ) as activity_at,
      case
        when latest.id is not null then latest.status in ('issued', 'accepted')
        else r.status in ('new', 'reviewing', 'sent')
      end as ongoing,
      case
        when exists (
          select 1
            from public.quotes as iq
           where iq.quote_request_id = r.id
             and iq.user_id <> r.user_id
        ) then 'inconsistent_user_id'
        when not exists (
          select 1
            from public.profiles as ip
           where ip.id = r.user_id
        ) then 'missing_profile'
        when not exists (
          select 1
            from public.profiles as ip
           where ip.id = r.user_id
             and ip.role_code = 'customer'
        ) then 'non_customer_profile'
        else 'none'
      end as identity_issue
    from accessible_requests as r
    left join public.configurations as cfg
      on cfg.id = r.configuration_id
    left join public.base_models as model
      on model.id = cfg.base_model_id
    left join lateral (
      select q.*
        from public.quotes as q
       where q.quote_request_id = r.id
       order by q.revision desc, q.issued_at desc, q.updated_at desc, q.id desc
       limit 1
    ) as latest on true
    left join lateral (
      select q.id
        from public.quotes as q
       where q.quote_request_id = r.id
         and (v_rank >= 3 or q.dealer_id = v_uid)
       order by q.revision desc, q.issued_at desc, q.updated_at desc, q.id desc
       limit 1
    ) as open_quote on true
    left join public.profiles as dealer
      on dealer.id = latest.dealer_id
  ),
  customer_rows as (
    select
      p.id,
      p.customer_no,
      p.full_name,
      p.company_name,
      p.email,
      p.phone,
      p.address,
      (
        select count(*)::integer
          from case_rows as oc
         where oc.identity_issue = 'none'
           and oc.request_user_id = p.id
           and oc.ongoing
      ) as ongoing_case_count,
      (
        select max(rc.activity_at)
          from case_rows as rc
         where rc.identity_issue = 'none'
           and rc.request_user_id = p.id
      ) as recent_activity,
      (
        select jsonb_build_object(
          'id', rc.case_id,
          'open_quote_id', rc.open_quote_id,
          'quote_no', rc.latest_quote_no,
          'model_name', rc.model_name,
          'site_address', rc.site_address,
          'activity_at', rc.activity_at,
          'dealer_name', rc.dealer_name
        )
          from case_rows as rc
         where rc.identity_issue = 'none'
           and rc.request_user_id = p.id
         order by rc.activity_at desc, rc.case_id desc
         limit 1
      ) as recent_case
    from public.profiles as p
    where p.role_code = 'customer'
      and (
        v_rank >= 3
        or exists (
          select 1
            from case_rows as ac
           where ac.identity_issue = 'none'
             and ac.request_user_id = p.id
        )
      )
  )
  select jsonb_build_object(
    'customers',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'customer_no', c.customer_no,
            'full_name', c.full_name,
            'company_name', c.company_name,
            'email', c.email,
            'phone', c.phone,
            'address', c.address,
            'ongoing_case_count', c.ongoing_case_count,
            'recent_case', c.recent_case
          )
          order by c.recent_activity desc nulls last, c.full_name, c.id
        )
          from customer_rows as c
      ),
      '[]'::jsonb
    ),
    'unlinked_cases',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', uc.case_id,
            'full_name', coalesce(
              nullif(btrim(uc.contact ->> 'full_name'), ''),
              (
                select q.customer_name
                  from public.quotes as q
                 where q.quote_request_id = uc.case_id
                 order by q.revision desc, q.issued_at desc, q.id desc
                 limit 1
              ),
              '顧客名未登録'
            ),
            'company_name', coalesce(
              nullif(btrim(uc.contact ->> 'company_name'), ''),
              (
                select q.customer_company
                  from public.quotes as q
                 where q.quote_request_id = uc.case_id
                 order by q.revision desc, q.issued_at desc, q.id desc
                 limit 1
              )
            ),
            'identity_issue', uc.identity_issue,
            'open_quote_id', uc.open_quote_id,
            'quote_no', uc.latest_quote_no,
            'model_name', uc.model_name,
            'site_address', uc.site_address,
            'activity_at', uc.activity_at,
            'dealer_name', uc.dealer_name
          )
          order by uc.activity_at desc, uc.case_id desc
        )
          from case_rows as uc
         where uc.identity_issue <> 'none'
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.get_accessible_customer_detail(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rank integer;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  v_rank := public.current_role_rank();
  if v_rank < 1 then
    raise exception 'FORBIDDEN: 顧客管理を閲覧できるのは代理店以上です'
      using errcode = '42501';
  end if;

  with accessible_requests as (
    select r.*
      from public.quote_requests as r
     where v_rank >= 3
        or exists (
          select 1
            from public.quotes as aq
           where aq.quote_request_id = r.id
             and aq.dealer_id = v_uid
        )
  ),
  case_rows as (
    select
      r.id as case_id,
      r.user_id as request_user_id,
      r.status as request_status,
      r.message,
      r.contact,
      latest.id as latest_quote_id,
      latest.quote_no as latest_quote_no,
      latest.status as latest_quote_status,
      latest.revision as latest_quote_revision,
      latest.base_model_name as latest_model_name,
      latest.issued_at as latest_issued_at,
      latest.total as latest_total,
      latest.dealer_id as latest_dealer_id,
      open_quote.id as open_quote_id,
      dealer.full_name as dealer_name,
      dealer.company_name as dealer_company,
      coalesce(
        nullif(btrim(r.contact ->> 'site_address'), ''),
        case
          when cfg.site_location_undecided then '未定'
          else nullif(concat_ws('', cfg.site_prefecture, cfg.site_municipality), '')
        end
      ) as site_address,
      case
        when nullif(btrim(r.contact ->> 'site_address'), '') is not null then 'quote_contact'
        when cfg.site_location_undecided
          or cfg.site_prefecture is not null
          or cfg.site_municipality is not null then 'configuration'
        else null
      end as site_source,
      coalesce(latest.base_model_name, model.name) as model_name,
      greatest(
        r.updated_at,
        r.created_at,
        coalesce(latest.updated_at, 'epoch'::timestamptz),
        coalesce(latest.issued_at, 'epoch'::timestamptz),
        coalesce(latest.created_at, 'epoch'::timestamptz),
        coalesce(cfg.updated_at, 'epoch'::timestamptz)
      ) as activity_at,
      case
        when latest.id is not null then latest.status in ('issued', 'accepted')
        else r.status in ('new', 'reviewing', 'sent')
      end as ongoing,
      case
        when exists (
          select 1
            from public.quotes as iq
           where iq.quote_request_id = r.id
             and iq.user_id <> r.user_id
        ) then 'inconsistent_user_id'
        when not exists (
          select 1
            from public.profiles as ip
           where ip.id = r.user_id
        ) then 'missing_profile'
        when not exists (
          select 1
            from public.profiles as ip
           where ip.id = r.user_id
             and ip.role_code = 'customer'
        ) then 'non_customer_profile'
        else 'none'
      end as identity_issue
    from accessible_requests as r
    left join public.configurations as cfg
      on cfg.id = r.configuration_id
    left join public.base_models as model
      on model.id = cfg.base_model_id
    left join lateral (
      select q.*
        from public.quotes as q
       where q.quote_request_id = r.id
       order by q.revision desc, q.issued_at desc, q.updated_at desc, q.id desc
       limit 1
    ) as latest on true
    left join lateral (
      select q.id
        from public.quotes as q
       where q.quote_request_id = r.id
         and (v_rank >= 3 or q.dealer_id = v_uid)
       order by q.revision desc, q.issued_at desc, q.updated_at desc, q.id desc
       limit 1
    ) as open_quote on true
    left join public.profiles as dealer
      on dealer.id = latest.dealer_id
  ),
  target_customer as (
    select
      p.id,
      p.customer_no,
      p.full_name,
      p.company_name,
      p.email,
      p.phone,
      p.postal_code,
      p.address,
      p.created_at
    from public.profiles as p
    where p.id = p_customer_id
      and p.role_code = 'customer'
      and (
        v_rank >= 3
        or exists (
          select 1
            from case_rows as ac
           where ac.identity_issue = 'none'
             and ac.request_user_id = p.id
        )
      )
  )
  select jsonb_build_object(
    'customer',
    jsonb_build_object(
      'id', p.id,
      'customer_no', p.customer_no,
      'full_name', p.full_name,
      'company_name', p.company_name,
      'email', p.email,
      'phone', p.phone,
      'postal_code', p.postal_code,
      'address', p.address,
      'created_at', p.created_at
    ),
    'latest_contact',
    (
      select jsonb_build_object(
        'full_name', coalesce(lc.contact ->> 'full_name', ''),
        'company_name', nullif(lc.contact ->> 'company_name', ''),
        'email', coalesce(lc.contact ->> 'email', ''),
        'phone', coalesce(lc.contact ->> 'phone', ''),
        'address', coalesce(lc.contact ->> 'address', ''),
        'site_address', nullif(lc.contact ->> 'site_address', '')
      )
        from case_rows as lc
       where lc.identity_issue = 'none'
         and lc.request_user_id = p.id
       order by lc.activity_at desc, lc.case_id desc
       limit 1
    ),
    'cases',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', cr.case_id,
            'request_status', cr.request_status,
            'message', cr.message,
            'contact', jsonb_build_object(
              'full_name', coalesce(cr.contact ->> 'full_name', ''),
              'company_name', nullif(cr.contact ->> 'company_name', ''),
              'email', coalesce(cr.contact ->> 'email', ''),
              'phone', coalesce(cr.contact ->> 'phone', ''),
              'address', coalesce(cr.contact ->> 'address', ''),
              'site_address', nullif(cr.contact ->> 'site_address', '')
            ),
            'site_address', cr.site_address,
            'site_source', cr.site_source,
            'ongoing', cr.ongoing,
            'activity_at', cr.activity_at,
            'model_name', cr.model_name,
            'dealer_name', cr.dealer_name,
            'dealer_company', cr.dealer_company,
            'open_quote_id', cr.open_quote_id,
            'latest_quote',
              case
                when cr.latest_quote_id is null then null
                else jsonb_build_object(
                  'id', cr.latest_quote_id,
                  'case_id', cr.case_id,
                  'quote_no', cr.latest_quote_no,
                  'revision', cr.latest_quote_revision,
                  'status', cr.latest_quote_status,
                  'base_model_name', cr.latest_model_name,
                  'issued_at', cr.latest_issued_at,
                  'total', cr.latest_total,
                  'can_open_quote', v_rank >= 3 or cr.latest_dealer_id = v_uid
                )
              end
          )
          order by cr.activity_at desc, cr.case_id desc
        )
          from case_rows as cr
         where cr.identity_issue = 'none'
           and cr.request_user_id = p.id
      ),
      '[]'::jsonb
    ),
    'quote_history',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', q.id,
            'case_id', cr.case_id,
            'quote_no', q.quote_no,
            'revision', q.revision,
            'status', q.status,
            'base_model_name', q.base_model_name,
            'issued_at', q.issued_at,
            'total', q.total,
            'can_open_quote', v_rank >= 3 or q.dealer_id = v_uid
          )
          order by q.issued_at desc, q.revision desc, q.updated_at desc, q.id desc
        )
          from case_rows as cr
          join public.quotes as q
            on q.quote_request_id = cr.case_id
         where cr.identity_issue = 'none'
           and cr.request_user_id = p.id
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from target_customer as p;

  -- 存在しない顧客と権限外の顧客はどちらもnullを返す。
  return v_result;
end;
$$;

alter function public.list_accessible_customers() owner to postgres;
alter function public.get_accessible_customer_detail(uuid) owner to postgres;

do $$
begin
  if pg_catalog.pg_get_userbyid(
       (select p.proowner
          from pg_catalog.pg_proc as p
         where p.oid = 'public.list_accessible_customers()'::regprocedure)
     ) <> 'postgres' then
    raise exception 'ACCESSIBLE_CUSTOMER_LIST_OWNER_INVALID: RPC owner must be postgres'
      using errcode = 'P0001';
  end if;

  if pg_catalog.pg_get_userbyid(
       (select p.proowner
          from pg_catalog.pg_proc as p
         where p.oid = 'public.get_accessible_customer_detail(uuid)'::regprocedure)
     ) <> 'postgres' then
    raise exception 'ACCESSIBLE_CUSTOMER_DETAIL_OWNER_INVALID: RPC owner must be postgres'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.list_accessible_customers()
  from public, anon, authenticated, service_role;
revoke execute on function public.get_accessible_customer_detail(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.list_accessible_customers() to authenticated;
grant execute on function public.get_accessible_customer_detail(uuid) to authenticated;

comment on function public.list_accessible_customers() is
  '顧客管理一覧。adminは全顧客、総代理店・代理店は自分が担当するquote_request系列の顧客だけを必要最小列で返す。';
comment on function public.get_accessible_customer_detail(uuid) is
  '顧客管理詳細。担当quote_request系列だけの案件・Revision履歴・受付情報を返し、権限外顧客はnullにする。';
