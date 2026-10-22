-- 20261016111000（正式見積で金額未確定の明細を残さない）の適用後の確認。読み取りだけ（真偽・件数・関数の属性だけを返す）。
--
--   npx supabase db query --linked --output-format json -f scripts/db-rehearsal/postflight-quote-formal-por-guard.sql
--
-- 合格の条件：*_patched・triggers_enabled・rpc_authenticated_only・internal_functions_closed・confirmations_closed がすべて true、
-- confirmations_rows が 0、issuance_function_attributes が適用直前の preflight と同じ。
select
  strpos(pg_catalog.pg_get_functiondef('public.finalize_quote_draft(uuid, integer)'::regprocedure),
         'perform public.assert_quote_draft_lines_resolved(d.id);') > 0 as finalize_draft_patched,
  strpos(pg_catalog.pg_get_functiondef('public.finalize_quote_revision_draft(uuid, integer)'::regprocedure),
         'perform public.assert_quote_draft_lines_resolved(d.id);') > 0 as finalize_revision_draft_patched,
  strpos(pg_catalog.pg_get_functiondef('public.create_quote_revision(uuid, jsonb, text)'::regprocedure),
         'perform public.assert_quote_lines_resolved(v_new);') > 0
    and strpos(pg_catalog.pg_get_functiondef('public.create_quote_revision(uuid, jsonb, text)'::regprocedure),
               'perform public.assert_case_por_selections_confirmed(parent.id, v_uid);') > 0 as create_revision_patched,
  strpos(pg_catalog.pg_get_functiondef('public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)'::regprocedure),
         'perform public.assert_quote_lines_resolved(v_new);') > 0
    and strpos(pg_catalog.pg_get_functiondef('public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)'::regprocedure),
               'perform public.assert_case_por_selections_confirmed(parent.id, v_uid);') > 0 as formal_from_preliminary_patched,
  (select count(*) = 2 and bool_and(t.tgenabled = 'O')
     from pg_catalog.pg_trigger t
    where t.tgname in ('quote_items_line_state_guard', 'quote_draft_items_line_state_guard') and not t.tgisinternal) as triggers_enabled,
  has_function_privilege('authenticated', 'public.get_quote_por_selections(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.confirm_quote_por_selections(uuid, text[])', 'execute')
    and not has_function_privilege('anon', 'public.get_quote_por_selections(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.confirm_quote_por_selections(uuid, text[])', 'execute')
    and not has_function_privilege('service_role', 'public.get_quote_por_selections(uuid)', 'execute')
    and not has_function_privilege('service_role', 'public.confirm_quote_por_selections(uuid, text[])', 'execute')
    as rpc_authenticated_only,
  not exists (
    select 1
      from unnest(array['anon', 'authenticated', 'service_role']) as r(role_name),
           unnest(array[
             'public.quote_line_explicit_state(text)', 'public.quote_line_por_marked(uuid, text, text)',
             'public.quote_line_unresolved(text, numeric, uuid, text, text, boolean, boolean)', 'public.quote_line_state_guard()',
             'public.configuration_por_selections(uuid)', 'public.quote_por_selections_confirmed(uuid, uuid, jsonb)',
             'public.assert_quote_lines_resolved(uuid)', 'public.assert_quote_draft_lines_resolved(uuid)',
             'public.assert_case_por_selections_confirmed(uuid, uuid)']) as f(fn)
     where has_function_privilege(r.role_name, f.fn, 'execute')
  ) as internal_functions_closed,
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.quote_por_confirmations'::regclass)
    and not has_table_privilege('authenticated', 'public.quote_por_confirmations', 'select')
    and not has_table_privilege('authenticated', 'public.quote_por_confirmations', 'insert')
    and not has_table_privilege('anon', 'public.quote_por_confirmations', 'select')
    as confirmations_closed,
  (select count(*) from public.quote_por_confirmations) as confirmations_rows,
  (select json_agg(
            json_build_object('fn', p.oid::regprocedure::text, 'owner', pg_catalog.pg_get_userbyid(p.proowner),
                              'security_definer', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text)
            order by p.oid::regprocedure::text)
     from pg_catalog.pg_proc p
    where p.oid in (
      to_regprocedure('public.finalize_quote_draft(uuid, integer)'),
      to_regprocedure('public.finalize_quote_revision_draft(uuid, integer)'),
      to_regprocedure('public.create_quote_revision(uuid, jsonb, text)'),
      to_regprocedure('public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)')
    )) as issuance_function_attributes;
