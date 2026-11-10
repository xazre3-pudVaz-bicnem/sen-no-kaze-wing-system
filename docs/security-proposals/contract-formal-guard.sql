-- REVIEW PROPOSAL ONLY: run "supabase migration new" in the integration branch before
-- moving this SQL into supabase/migrations. Not applied to production.
-- Scope: begin_electronic_contract only; preserve its existing owner/security/ACL/locks.
begin;

do $formal_guard$
declare
  v_fn regprocedure := to_regprocedure('public.begin_electronic_contract(uuid,text,text)');
  v_definition text;
  v_updated text;
  v_needle text := $old$  if q.status <> 'accepted' then
    raise exception 'LOCKED: お客様が承諾した見積だけ契約書を送信できます' using errcode = 'P0001';
  end if;$old$;
  v_guard text := $new$
  -- Explicitly issued formal quote only. Do not infer a formal quote from legacy NULL.
  if q.quote_kind is distinct from 'formal' then
    raise exception 'LOCKED: 正式見積として発行・承諾された見積だけ契約できます' using errcode = 'P0001';
  end if;
  if req.user_id is distinct from q.user_id then
    raise exception 'LOCKED: 見積と案件の顧客が一致しません' using errcode = 'P0001';
  end if;
  if q.revision < 1
     or (q.revision = 1 and q.parent_quote_id is not null)
     or (q.revision > 1 and (
       q.parent_quote_id is null
       or not exists (
         select 1 from public.quotes parent
          where parent.id = q.parent_quote_id
            and parent.quote_request_id = q.quote_request_id
            and parent.revision = q.revision - 1
       )
     )) then
    raise exception 'LOCKED: 見積Revisionの系譜を確認できません' using errcode = 'P0001';
  end if;
  -- v2.5 web initial quote is preliminary; only a pinned later formal revision is eligible.
  if q.pricing_model = 'v2.5' and (
    q.revision < 2 or q.parent_quote_id is null
    or q.standard_estimate_revision_id is null
    or q.calc_rule_version_id is null
    or q.tax_rule_version_id is null
  ) then
    raise exception 'LOCKED: v2.5正式見積の固定Revisionを確認できません' using errcode = 'P0001';
  end if;$new$;
  v_before record;
  v_after record;
  v_occurrences integer;
begin
  if v_fn is null then
    raise exception 'PRECONDITION: begin_electronic_contract is missing';
  end if;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text acl
    into v_before from pg_catalog.pg_proc p where p.oid=v_fn;
  if pg_catalog.pg_get_userbyid(v_before.proowner) <> 'postgres'
     or not v_before.prosecdef
     or not ('search_path=' = any(v_before.proconfig) or 'search_path=""' = any(v_before.proconfig))
     or pg_catalog.has_function_privilege('anon',v_fn,'EXECUTE')
     or pg_catalog.has_function_privilege('service_role',v_fn,'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',v_fn,'EXECUTE') then
    raise exception 'PRECONDITION: unexpected owner / SECURITY DEFINER / search_path / EXECUTE';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(v_fn);
  v_occurrences := (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_needle,''))) / pg_catalog.length(v_needle);
  if v_occurrences <> 1 then
    raise exception 'PRECONDITION: expected one exact acceptance marker; got %',v_occurrences;
  end if;
  v_updated := pg_catalog.replace(v_definition,v_needle,v_needle || v_guard);
  execute v_updated;

  select p.proowner,p.prosecdef,p.proconfig,p.proacl::text acl
    into v_after from pg_catalog.pg_proc p where p.oid=v_fn;
  if v_after is distinct from v_before then
    raise exception 'POSTCONDITION: owner/security/search_path/EXECUTE changed';
  end if;
  if pg_catalog.position('if q.quote_kind is distinct from ''formal''' in pg_catalog.pg_get_functiondef(v_fn))=0 then
    raise exception 'POSTCONDITION: formal quote guard absent';
  end if;
end;
$formal_guard$;

commit;
