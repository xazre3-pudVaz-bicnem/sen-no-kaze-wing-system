-- Harden the customer Quote response boundary without changing the existing
-- Quote / QuoteRequest / Configuration lifecycle contract.
--
-- This is an additive corrective.  The final pre-existing behavior comes from
-- 20261005090000_legacy_accepted_formal_compat.sql; only authentication and
-- SECURITY DEFINER execution boundaries are tightened here.

begin;

create or replace function public.respond_to_quote(p_quote_id uuid, p_status text)
returns public.quotes
language plpgsql
security definer
set search_path = ''
as $respond_to_quote$
declare
  q public.quotes;
  v_current_quote_id uuid;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if p_status not in ('accepted', 'declined') then
    raise exception 'VALIDATION: 回答が不正です' using errcode = 'P0001';
  end if;

  select * into q
    from public.quotes
   where id = p_quote_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if q.user_id is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if q.status <> 'issued' then
    raise exception 'LOCKED: この見積にはすでに回答済みです（または改訂されています）' using errcode = 'P0001';
  end if;

  select quote_id into v_current_quote_id
    from public.quote_requests
   where id = q.quote_request_id
     and user_id = q.user_id
   for update;

  if not found or v_current_quote_id is distinct from q.id then
    raise exception 'LOCKED: この見積は最新の版ではありません' using errcode = 'P0001';
  end if;

  if p_status = 'accepted' and not (
    q.quote_kind = 'formal'
    or (
      q.quote_kind is null
      and q.parent_quote_id is not null
      and exists (
        select 1
          from public.quotes parent
         where parent.id = q.parent_quote_id
           and parent.quote_request_id = q.quote_request_id
           and parent.user_id = q.user_id
      )
    )
  ) then
    raise exception 'LOCKED: 現地条件と施工金額を反映した確定見積の発行後に承諾できます'
      using errcode = 'P0001';
  end if;

  update public.quotes set status = p_status where id = p_quote_id returning * into q;
  update public.configurations set status = 'closed' where id = q.configuration_id;
  return q;
end;
$respond_to_quote$;

alter function public.respond_to_quote(uuid, text) owner to postgres;

revoke execute on function public.respond_to_quote(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.respond_to_quote(uuid, text) to authenticated;

-- Fail migration application if the SECURITY DEFINER boundary is not the one
-- expected by the application.  This changes no business data.
do $respond_to_quote_security_postcondition$
declare
  v_oid oid := 'public.respond_to_quote(uuid, text)'::regprocedure;
  v_owner text;
  v_security_definer boolean;
  v_proconfig text[];
begin
  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    into v_owner, v_security_definer, v_proconfig
    from pg_catalog.pg_proc p
   where p.oid = v_oid;

  if v_owner is distinct from 'postgres' then
    raise exception 'RESPOND_TO_QUOTE_OWNER_INVALID: owner must be postgres'
      using errcode = 'P0001';
  end if;

  if v_security_definer is distinct from true then
    raise exception 'RESPOND_TO_QUOTE_SECURITY_INVALID: function must be SECURITY DEFINER'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from pg_catalog.unnest(coalesce(v_proconfig, array[]::text[])) as cfg(value)
     where cfg.value in ('search_path=', 'search_path=""')
  ) then
    raise exception 'RESPOND_TO_QUOTE_SEARCH_PATH_INVALID: search_path must be empty'
      using errcode = 'P0001';
  end if;

  if pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'RESPOND_TO_QUOTE_ACL_INVALID: anon must not execute'
      using errcode = 'P0001';
  end if;

  if not pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'RESPOND_TO_QUOTE_ACL_INVALID: authenticated must execute'
      using errcode = 'P0001';
  end if;

  if pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'RESPOND_TO_QUOTE_ACL_INVALID: service_role must not execute'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc p,
           lateral pg_catalog.aclexplode(
             coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
           ) acl
     where p.oid = v_oid
       and acl.grantee = 0
       and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'RESPOND_TO_QUOTE_ACL_INVALID: PUBLIC must not execute'
      using errcode = 'P0001';
  end if;
end;
$respond_to_quote_security_postcondition$;

commit;
