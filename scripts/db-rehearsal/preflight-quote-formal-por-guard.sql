-- 20261016111000（正式見積で金額未確定の明細を残さない）の適用直前の確認。読み取りだけ（件数・真偽・関数の属性だけを返す）。
--
--   npx supabase db query --linked --output-format json -f scripts/db-rehearsal/preflight-quote-formal-por-guard.sql
--
-- 止める条件：issuance_functions_present・draft_price_mode_present・confirmations_table_absent・guard_functions_absent の
-- どれかが false、または marker_quote_items・marker_draft_items が 0 でない（migration の preflight でも止まる）。
-- issuance_function_attributes は適用後の postflight と比べる（owner・SECURITY DEFINER・search_path・EXECUTE が変わらないこと）。
select
  to_regprocedure('public.finalize_quote_draft(uuid, integer)') is not null
    and to_regprocedure('public.finalize_quote_revision_draft(uuid, integer)') is not null
    and to_regprocedure('public.create_quote_revision(uuid, jsonb, text)') is not null
    and to_regprocedure('public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)') is not null
    as issuance_functions_present,
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'quote_draft_items' and column_name = 'price_mode'
  ) as draft_price_mode_present,
  to_regclass('public.quote_por_confirmations') is null as confirmations_table_absent,
  to_regprocedure('public.quote_line_unresolved(text, numeric, uuid, text, text, boolean, boolean)') is null
    and to_regprocedure('public.get_quote_por_selections(uuid)') is null
    as guard_functions_absent,
  (select count(*) from public.quote_items where remark like '［今回の契約対象外］%' or remark like '［0円確定］%') as marker_quote_items,
  (select count(*) from public.quote_draft_items where remark like '［今回の契約対象外］%' or remark like '［0円確定］%') as marker_draft_items,
  (select count(*) from public.quote_drafts) as open_drafts,
  (select count(*) from public.quotes where quote_kind = 'formal') as formal_quotes,
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
