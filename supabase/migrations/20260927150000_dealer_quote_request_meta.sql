-- 代理店案件一覧に必要な依頼メタデータだけを返す。quote_requests の広範な SELECT は許可しない。
create or replace function public.list_dealer_quote_request_meta()
returns table (
  quote_id uuid,
  request_status text,
  site_address text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    q.id,
    r.status,
    r.contact ->> 'site_address'
  from public.quotes as q
  join public.quote_requests as r on r.id = q.quote_request_id
  where q.dealer_id = (select auth.uid())
    and (select public.is_dealer());
$$;

alter function public.list_dealer_quote_request_meta() owner to postgres;

do $$
begin
  if pg_catalog.pg_get_userbyid(
       (select p.proowner
          from pg_catalog.pg_proc p
         where p.oid = 'public.list_dealer_quote_request_meta()'::regprocedure)
     ) <> 'postgres' then
    raise exception 'DEALER_QUOTE_REQUEST_LIST_OWNER_INVALID: RPC owner must be postgres'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.list_dealer_quote_request_meta()
  from public, anon, authenticated, service_role;
grant execute on function public.list_dealer_quote_request_meta() to authenticated;
