-- v2.5 の一式（A1〜C1b）・#603・S1・D1・D1c・S2b の 11 本を本番に適用した後の確認。読み取りだけ・件数だけ（表の中身は返さない）。
--   npx supabase db query --linked --output-format json -f scripts/db-rehearsal/postflight-v25-apply.sql
-- 期待（docs/v25-switch-readiness.md の「1.」）：
--   migrations_applied = 104・last_migration = 20261102140000・objects_present = true・
--   seeds：calc_rule_versions = 1・tax_rule_versions = 1・window_types = 4・sash_uses_window_type = option_categories_sash・
--          cost_versions_match_hq_costs = true
--   v25_state：switch_enabled = false・v25_revisions = 0・v25_quotes = 0・cost_pins = 0・quote_drafts_v25_guard_removed = true
--   privileges：legacy_price_readable_by_users = false・internal_functions_executable_by_api = 0・
--               staff_rpcs_executable_by_anon = 0・staff_rpcs_not_executable_by_authenticated = 0
--   counts：preflight-v25-apply.sql の counts と同じ（適用でデータを変えていない）
select pg_catalog.jsonb_build_object(
  'migrations_applied', (select count(*) from supabase_migrations.schema_migrations),
  'last_migration', (select max(version) from supabase_migrations.schema_migrations),
  'objects_present',
    to_regclass('public.option_standard_cost_versions') is not null
    and to_regclass('public.pricing_calculation_rule_versions') is not null
    and to_regclass('public.tax_rule_versions') is not null
    and to_regclass('public.standard_estimate_revision_v25_lines') is not null
    and to_regclass('public.window_types') is not null
    and to_regclass('public.standard_estimate_revision_slot_options') is not null
    and to_regclass('public.quote_item_cost_pins') is not null
    and to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid, boolean)') is not null
    and pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.get_case_plan_configuration(uuid)'::regprocedure), '''position_slots''') > 0,
  'seeds', pg_catalog.jsonb_build_object(
    'calc_rule_versions', (select count(*) from public.pricing_calculation_rule_versions),
    'tax_rule_versions', (select count(*) from public.tax_rule_versions),
    'window_types', (select count(*) from public.window_types),
    'sash_uses_window_type', (select count(*) from public.option_categories where code = 'sash' and uses_window_type),
    'cost_versions_match_hq_costs',
      (select count(*) from public.option_standard_cost_versions) = (select count(*) from public.option_hq_standard_costs)
      and not exists (select 1 from public.option_hq_standard_costs c
                       join public.option_standard_cost_versions v on v.id = c.current_version_id
                      where v.standard_cost <> c.standard_cost)
  ),
  'v25_state', pg_catalog.jsonb_build_object(
    'switch_enabled', coalesce((select (s.value ->> 'enabled')::boolean from public.app_settings s where s.key = 'simulator_standard_pricing'), false),
    'v25_revisions', (select count(*) from public.standard_estimate_revisions where pricing_model = 'v2.5'),
    'v25_quotes', (select count(*) from public.quotes where pricing_model = 'v2.5'),
    'cost_pins', (select count(*) from public.quote_item_cost_pins),
    'position_slots', (select count(*) from public.standard_estimate_revision_baseline_items where slot_code is not null),
    'quote_drafts_v25_guard_removed', not exists (select 1 from pg_catalog.pg_trigger t
                                                   where t.tgrelid = 'public.quote_drafts'::regclass
                                                     and t.tgname = 'quote_drafts_v25_standard_estimate_guard')
  ),
  'privileges', pg_catalog.jsonb_build_object(
    'legacy_price_readable_by_users', has_column_privilege('authenticated', 'public.options', 'price', 'SELECT')
                                      or has_column_privilege('anon', 'public.options', 'price', 'SELECT'),
    -- 内部の部品（API からは実行させない）
    'internal_functions_executable_by_api', (
      select count(*)
        from pg_catalog.unnest(array[
          'public.standard_estimate_v25_quote_draft_lines(uuid, boolean)',
          'public.standard_estimate_v25_sale_view(uuid, boolean)',
          'public.quote_v25_editable(uuid)',
          'public.pricing_calculate(uuid, uuid, jsonb)'
        ]) as f(signature)
        cross join pg_catalog.unnest(array['anon', 'authenticated']) as r(role_name)
       where to_regprocedure(f.signature) is not null
         and has_function_privilege(r.role_name, f.signature, 'EXECUTE')),
    -- 担当者の画面から呼ぶ RPC（ログインした利用者だけ。関数の中で本部・担当を確かめる）
    'staff_rpcs_executable_by_anon', (
      select count(*)
        from pg_catalog.unnest(array[
          'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)',
          'public.get_quote_v25_context(uuid)',
          'public.get_quote_v25_units(uuid, jsonb)',
          'public.get_case_plan_configuration(uuid)',
          'public.set_simulator_standard_pricing(boolean)'
        ]) as f(signature)
       where has_function_privilege('anon', f.signature, 'EXECUTE')),
    'staff_rpcs_not_executable_by_authenticated', (
      select count(*)
        from pg_catalog.unnest(array[
          'public.create_quote_revision_v25(uuid, jsonb, integer, text, text)',
          'public.get_quote_v25_context(uuid)',
          'public.get_quote_v25_units(uuid, jsonb)',
          'public.get_case_plan_configuration(uuid)',
          'public.set_simulator_standard_pricing(boolean)'
        ]) as f(signature)
       where not has_function_privilege('authenticated', f.signature, 'EXECUTE'))
  ),
  'counts', pg_catalog.jsonb_build_object(
    'options', (select count(*) from public.options),
    'option_variant_choices', (select count(*) from public.option_variant_choices),
    'option_categories', (select count(*) from public.option_categories),
    'option_categories_sash', (select count(*) from public.option_categories where code = 'sash'),
    'option_hq_standard_costs', (select count(*) from public.option_hq_standard_costs),
    'standard_estimate_masters_active', (select count(*) from public.standard_estimate_masters where status = 'active'),
    'standard_estimate_revisions_published', (select count(*) from public.standard_estimate_revisions where status = 'published'),
    'standard_estimate_baseline_items', (select count(*) from public.standard_estimate_revision_baseline_items),
    'configurations', (select count(*) from public.configurations),
    'configuration_items', (select count(*) from public.configuration_items),
    'quote_requests', (select count(*) from public.quote_requests),
    'quotes', (select count(*) from public.quotes),
    'quote_items', (select count(*) from public.quote_items),
    'quote_drafts', (select count(*) from public.quote_drafts),
    'quote_internal_snapshots', (select count(*) from public.quote_internal_snapshots),
    'contact_messages', (select count(*) from public.contact_messages)
  ),
  'checked_at', now()
) as result;
