-- 20261016112000（販売停止・廃番）と 20261016113000（商品の変更履歴のトリガー関数の EXECUTE を外す）の適用後の確認。
-- 読み取りだけ（真偽・件数・関数の属性だけを返す）。
--
--   npx supabase db query --linked --output-format json -f scripts/db-rehearsal/postflight-product-sales-stop.sql
--
-- 合格の条件：discontinued_column・functions_present・triggers_enabled・finalize_patched・messages_patched・
-- rpc_authenticated_only・internal_functions_closed・audit_function_closed がすべて true、discontinued_products が 0。
-- function_attributes は適用直前の preflight と比べる（変わってよいのは trg_audit_option() の config（search_path を空へ）と acl だけ）。
select
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'options' and column_name = 'discontinued_at'
  ) and exists (
    select 1 from pg_catalog.pg_constraint c
     where c.conrelid = 'public.options'::regclass and c.conname = 'options_discontinued_requires_stopped' and c.convalidated
  ) as discontinued_column,
  to_regprocedure('public.set_option_discontinued(uuid, timestamptz, boolean, text)') is not null
    and to_regprocedure('public.spec_stopped_baseline_names(uuid, text)') is not null
    and to_regprocedure('public.get_spec_acceptance_state(uuid, text)') is not null
    and to_regprocedure('public.quote_requests_baseline_lifecycle_guard()') is not null
    and to_regprocedure('public.standard_estimate_stopped_baseline_names(uuid)') is not null
    and to_regprocedure('public.quote_drafts_standard_estimate_lifecycle_guard()') is not null
    and to_regprocedure('public.assert_standard_estimate_source_sellable(uuid)') is not null as functions_present,
  (select count(*) = 4 and bool_and(t.tgenabled = 'O')
     from pg_catalog.pg_trigger t
    where not t.tgisinternal
      and ((t.tgrelid = 'public.options'::regclass and t.tgname in ('options_lifecycle_guard', 'trg_options_audit'))
        or (t.tgrelid = 'public.quote_requests'::regclass and t.tgname = 'quote_requests_baseline_lifecycle_guard')
        or (t.tgrelid = 'public.quote_drafts'::regclass and t.tgname = 'quote_drafts_standard_estimate_lifecycle_guard'))) as triggers_enabled,
  strpos(pg_catalog.pg_get_functiondef('public.finalize_quote_draft(uuid, integer)'::regprocedure),
         'perform public.assert_standard_estimate_source_sellable(d.id);') > 0
    and strpos(pg_catalog.pg_get_functiondef('public.finalize_quote_revision_draft(uuid, integer)'::regprocedure),
               'perform public.assert_standard_estimate_source_sellable(d.id);') > 0 as finalize_patched,
  (select count(*) = 0 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('options_lifecycle_guard', 'configuration_items_lifecycle_guard', 'configurations_exterior_lifecycle_guard',
      'estimate_templates_lifecycle_guard', 'quote_draft_items_lifecycle_guard', 'quote_items_lifecycle_guard', 'quote_requests_lifecycle_guard',
      'standard_estimate_baseline_lifecycle_guard', 'standard_estimate_baseline_variant_lifecycle_guard', 'standard_estimate_publish_lifecycle_guard')
      and p.prosrc like '%取扱終了%')
    and (select count(*) = 9 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('configuration_items_lifecycle_guard', 'configurations_exterior_lifecycle_guard',
            'estimate_templates_lifecycle_guard', 'quote_draft_items_lifecycle_guard', 'quote_items_lifecycle_guard', 'quote_requests_lifecycle_guard',
            'standard_estimate_baseline_lifecycle_guard', 'standard_estimate_baseline_variant_lifecycle_guard', 'standard_estimate_publish_lifecycle_guard')
            and p.prosrc like '%販売停止中%') as messages_patched,
  has_function_privilege('authenticated', 'public.set_option_discontinued(uuid, timestamptz, boolean, text)', 'execute')
    and has_function_privilege('authenticated', 'public.get_spec_acceptance_state(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.set_option_discontinued(uuid, timestamptz, boolean, text)', 'execute')
    and not has_function_privilege('anon', 'public.get_spec_acceptance_state(uuid, text)', 'execute')
    and not has_function_privilege('service_role', 'public.set_option_discontinued(uuid, timestamptz, boolean, text)', 'execute')
    and not has_function_privilege('service_role', 'public.get_spec_acceptance_state(uuid, text)', 'execute')
    as rpc_authenticated_only,
  not exists (
    select 1
      from unnest(array['anon', 'authenticated', 'service_role']) as r(role_name),
           unnest(array[
             'public.spec_stopped_baseline_names(uuid, text)', 'public.standard_estimate_stopped_baseline_names(uuid)',
             'public.assert_standard_estimate_source_sellable(uuid)', 'public.quote_requests_baseline_lifecycle_guard()',
             'public.quote_drafts_standard_estimate_lifecycle_guard()', 'public.options_lifecycle_guard()']) as f(fn)
     where has_function_privilege(r.role_name, f.fn, 'execute')
  ) as internal_functions_closed,
  not exists (
    select 1 from pg_catalog.pg_proc p
     cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     where p.oid = 'public.trg_audit_option()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  )
    and not has_function_privilege('anon', 'public.trg_audit_option()', 'execute')
    and not has_function_privilege('authenticated', 'public.trg_audit_option()', 'execute')
    and not has_function_privilege('service_role', 'public.trg_audit_option()', 'execute') as audit_function_closed,
  (select count(*) from public.options where discontinued_at is not null) as discontinued_products,
  (select count(*) from public.options where archived_at is not null) as stopped_products,
  (select json_agg(
            json_build_object('fn', p.oid::regprocedure::text, 'owner', pg_catalog.pg_get_userbyid(p.proowner),
                              'security_definer', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text)
            order by p.oid::regprocedure::text)
     from pg_catalog.pg_proc p
    where p.oid in (
      to_regprocedure('public.options_lifecycle_guard()'), to_regprocedure('public.trg_audit_option()'),
      to_regprocedure('public.finalize_quote_draft(uuid, integer)'), to_regprocedure('public.finalize_quote_revision_draft(uuid, integer)'),
      to_regprocedure('public.configuration_items_lifecycle_guard()'), to_regprocedure('public.configurations_exterior_lifecycle_guard()'),
      to_regprocedure('public.estimate_templates_lifecycle_guard()'), to_regprocedure('public.quote_draft_items_lifecycle_guard()'),
      to_regprocedure('public.quote_items_lifecycle_guard()'), to_regprocedure('public.quote_requests_lifecycle_guard()'),
      to_regprocedure('public.standard_estimate_baseline_lifecycle_guard()'),
      to_regprocedure('public.standard_estimate_baseline_variant_lifecycle_guard()'),
      to_regprocedure('public.standard_estimate_publish_lifecycle_guard()'))) as function_attributes;
