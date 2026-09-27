-- Quote acceptance lifecycle hardening.
-- Formality is proven by revision lineage and the QuoteRequest current pointer,
-- never by a revision number or a mutable note.
create or replace function public.respond_to_quote(p_quote_id uuid, p_status text)
returns public.quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  v_current_quote_id uuid;
begin
  if p_status not in ('accepted', 'declined') then
    raise exception 'VALIDATION: 回答が不正です' using errcode = 'P0001';
  end if;

  -- create_quote_revision locks this same row before superseding it.
  select * into q
    from public.quotes
   where id = p_quote_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if q.user_id <> auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if q.status <> 'issued' then
    raise exception 'LOCKED: この見積にはすでに回答済みです（または改訂されています）' using errcode = 'P0001';
  end if;

  -- The pointer is replaced in the same transaction as every revision.
  select quote_id into v_current_quote_id
    from public.quote_requests
   where id = q.quote_request_id
     and user_id = q.user_id
   for update;

  if not found or v_current_quote_id is distinct from q.id then
    raise exception 'LOCKED: この見積は最新の版ではありません' using errcode = 'P0001';
  end if;

  -- Declining a current preliminary estimate is allowed.  Only acceptance
  -- needs the formal-revision lineage required for contract progression.
  if p_status = 'accepted' and (
    q.parent_quote_id is null or not exists (
      select 1
        from public.quotes parent
       where parent.id = q.parent_quote_id
         and parent.quote_request_id = q.quote_request_id
         and parent.user_id = q.user_id
    )
  ) then
    raise exception 'LOCKED: 現地条件と施工金額を反映した確定見積の発行後に承諾できます' using errcode = 'P0001';
  end if;

  update public.quotes set status = p_status where id = p_quote_id returning * into q;
  update public.configurations set status = 'closed' where id = q.configuration_id;
  return q;
end;
$$;

-- Security-definer lifecycle functions execute as postgres.  Ordinary Data
-- API writes execute as authenticated and cannot manufacture a status change.
create or replace function public.guard_quote_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and current_user <> 'postgres' then
    raise exception 'QUOTE_STATUS_IMMUTABLE: 見積状態は承諾・改訂のライフサイクル処理でのみ変更できます'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quotes_status_lifecycle on public.quotes;
create trigger trg_quotes_status_lifecycle
before update on public.quotes
for each row execute function public.guard_quote_status_transition();

-- Keep the existing dealer-assignment RPC on the same hardened execution
-- boundary as the lifecycle RPCs.  Every object lookup remains qualified so
-- an empty search_path cannot be influenced by a caller.
create or replace function public.assign_quote_dealer(p_quote_id uuid, p_dealer_id uuid)
returns public.quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_dealer_id is not null
     and not exists (
       select 1
         from public.profiles p
        where p.id = p_dealer_id
          and public.role_rank(p.role_code) >= 1
     ) then
    raise exception 'VALIDATION: 代理店以上の権限を持つユーザーを指定してください'
      using errcode = 'P0001';
  end if;

  update public.quotes
     set dealer_id = p_dealer_id
   where id = p_quote_id
  returning * into q;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return q;
end;
$$;

-- The lifecycle RPCs are SECURITY DEFINER functions owned by postgres.  Pin
-- that owner before the guards below rely on current_user, then fail migration
-- application if any function cannot be pinned as expected.
alter function public.create_quote_from_configuration(uuid, jsonb, text) owner to postgres;
alter function public.create_quote_revision(uuid, jsonb, text) owner to postgres;
alter function public.respond_to_quote(uuid, text) owner to postgres;
alter function public.assign_quote_dealer(uuid, uuid) owner to postgres;

do $$
begin
  if exists (
    select 1
      from pg_catalog.pg_proc p
     where p.oid in (
       'public.create_quote_from_configuration(uuid, jsonb, text)'::regprocedure,
       'public.create_quote_revision(uuid, jsonb, text)'::regprocedure,
       'public.respond_to_quote(uuid, text)'::regprocedure,
       'public.assign_quote_dealer(uuid, uuid)'::regprocedure
     )
       and pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
  ) then
    raise exception 'QUOTE_LIFECYCLE_OWNER_INVALID: lifecycle RPC owner must be postgres'
      using errcode = 'P0001';
  end if;
end;
$$;

-- These columns define a quote's immutable revision lineage.  Inserts and
-- lineage rewrites are accepted only from the postgres-owned lifecycle RPCs;
-- the existing admin RLS update policy therefore cannot manufacture a formal
-- quote or re-parent an existing snapshot.
create or replace function public.guard_quote_lineage_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'postgres' then
    if tg_op = 'INSERT'
       or old.parent_quote_id is distinct from new.parent_quote_id
       or old.revision is distinct from new.revision
       or old.quote_request_id is distinct from new.quote_request_id
       or old.configuration_id is distinct from new.configuration_id
       or old.user_id is distinct from new.user_id
    then
      raise exception 'QUOTE_LINEAGE_IMMUTABLE: 見積の系譜はライフサイクル処理でのみ変更できます'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quotes_lineage_lifecycle on public.quotes;
create trigger trg_quotes_lineage_lifecycle
before insert or update on public.quotes
for each row execute function public.guard_quote_lineage_transition();

-- quote_requests.quote_id is the single current-revision pointer.  It is
-- moved in the same transaction that creates a quote or supersedes a parent.
create or replace function public.guard_quote_request_current_pointer_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'postgres' then
    if (tg_op = 'INSERT' and new.quote_id is not null)
       or (tg_op = 'UPDATE' and old.quote_id is distinct from new.quote_id)
    then
      raise exception 'QUOTE_REQUEST_CURRENT_IMMUTABLE: 現在の見積はライフサイクル処理でのみ変更できます'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quote_requests_current_lifecycle on public.quote_requests;
create trigger trg_quote_requests_current_lifecycle
before insert or update on public.quote_requests
for each row execute function public.guard_quote_request_current_pointer_transition();

-- A directly assigned dealer can read a Quote but not the full QuoteRequest.
-- Return only the fields needed to recognize the request's current revision
-- (plus the site-address metadata already exposed by the dealer list RPC).
-- The authorization predicate is bound to the requested Quote's dealer_id;
-- no QuoteRequest rows are made selectable through RLS.
create or replace function public.get_dealer_quote_request_current(p_quote_id uuid)
returns table (
  quote_request_id uuid,
  is_current boolean,
  request_status text,
  site_address text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         r.quote_id is not distinct from q.id,
         r.status,
         r.contact ->> 'site_address'
    from public.quotes q
    join public.quote_requests r on r.id = q.quote_request_id
   where q.id = p_quote_id
     and q.dealer_id = (select auth.uid())
     and (select public.is_dealer());
$$;

alter function public.get_dealer_quote_request_current(uuid) owner to postgres;

do $$
begin
  if pg_catalog.pg_get_userbyid(
       (select p.proowner
          from pg_catalog.pg_proc p
         where p.oid = 'public.get_dealer_quote_request_current(uuid)'::regprocedure)
     ) <> 'postgres' then
    raise exception 'DEALER_QUOTE_REQUEST_META_OWNER_INVALID: RPC owner must be postgres'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.respond_to_quote(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.respond_to_quote(uuid, text) to authenticated;

revoke execute on function public.assign_quote_dealer(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assign_quote_dealer(uuid, uuid) to authenticated;

revoke execute on function public.get_dealer_quote_request_current(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_dealer_quote_request_current(uuid) to authenticated;
