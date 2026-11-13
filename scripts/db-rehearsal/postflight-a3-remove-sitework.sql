-- A-3（20261111100000）の適用の後の確認（読み取りだけ。件数と権限だけを返し、お客様の情報は返さない）。
-- 期待（2026-11-09 の適用前の照合と同じ本番なら）：9 品目・カテゴリーが無い、写しに カテゴリー 1・商品 9・標準構成 3 モデル・プラン 18・
-- 明細 400・写し 33・設置場所 1・見積依頼 10・希望 0・見積 10・見積の明細 473・PDF の記録 11、残す見積依頼 1・下書き 1・通知 23、初期明細 9
-- 使い方：npx supabase db query --linked --read-only --output-format json -f scripts/db-rehearsal/postflight-a3-remove-sitework.sql
select pg_catalog.jsonb_build_object(
  'checked_at', now(),
  'migration_applied', exists (select 1 from supabase_migrations.schema_migrations m where m.version = '20261111100000'),
  'sitework_category', (select count(*) from public.option_categories c where c.code = 'sitework'),
  'sitework_products', (select count(*) from public.options o where o.code in ('sw-transport', 'sw-design-permit', 'sw-packing', 'sw-site-install', 'sw-electric',
                                                                            'sw-plumbing', 'sw-foundation', 'sw-disposal', 'sw-site-expense')),
  'presets_sitework_entries', (select count(*) from public.base_models bm
                                 cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(bm.presets) = 'array' then bm.presets else '[]'::jsonb end) p(value)
                                 cross join lateral pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(p.value -> 'option_codes') = 'array' then p.value -> 'option_codes' else '[]'::jsonb end) oc(code)
                                 where oc.code like 'sw-%'),
  'presets_unknown_codes', (select count(*) from public.base_models bm
                              cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(bm.presets) = 'array' then bm.presets else '[]'::jsonb end) p(value)
                              cross join lateral pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(p.value -> 'option_codes') = 'array' then p.value -> 'option_codes' else '[]'::jsonb end) oc(code)
                              left join public.options o on o.code = oc.code where o.id is null),
  'initial_lines_active', (select count(*) from public.quote_initial_lines l where l.section_code = 'sitework' and l.is_active),
  'archive', pg_catalog.jsonb_build_object(
    'option_categories', (select count(*) from archive_a3_20261104.option_categories),
    'options', (select count(*) from archive_a3_20261104.options),
    'base_model_presets', (select count(*) from archive_a3_20261104.base_model_presets),
    'configurations', (select count(*) from archive_a3_20261104.configurations),
    'configuration_items', (select count(*) from archive_a3_20261104.configuration_items),
    'configuration_snapshots', (select count(*) from archive_a3_20261104.configuration_snapshots),
    'configuration_site_profiles', (select count(*) from archive_a3_20261104.configuration_site_profiles),
    'quote_requests', (select count(*) from archive_a3_20261104.quote_requests),
    'quote_request_preferences', (select count(*) from archive_a3_20261104.quote_request_preferences),
    'quotes', (select count(*) from archive_a3_20261104.quotes),
    'quote_items', (select count(*) from archive_a3_20261104.quote_items),
    'quote_documents', (select count(*) from archive_a3_20261104.quote_documents),
    -- 写しの照合値（適用前の照合と同じ集合が写ったか）
    'configurations_md5', pg_catalog.md5(coalesce((select pg_catalog.string_agg(a.id::text, ',' order by a.id) from archive_a3_20261104.configurations a), '')),
    'quote_requests_md5', pg_catalog.md5(coalesce((select pg_catalog.string_agg(a.id::text, ',' order by a.id) from archive_a3_20261104.quote_requests a), '')),
    'quotes_md5', pg_catalog.md5(coalesce((select pg_catalog.string_agg(a.id::text, ',' order by a.id) from archive_a3_20261104.quotes a), ''))),
  'kept', pg_catalog.jsonb_build_object(
    'configurations', (select count(*) from public.configurations),
    'quote_requests', (select count(*) from public.quote_requests),
    'quote_drafts', (select count(*) from public.quote_drafts),
    'quotes', (select count(*) from public.quotes),
    'notifications', (select count(*) from public.notifications)),
  'privileges', pg_catalog.jsonb_build_object(
    'archive_usage_by_api_roles', has_schema_privilege('anon', 'archive_a3_20261104', 'USAGE')
                                  or has_schema_privilege('authenticated', 'archive_a3_20261104', 'USAGE')
                                  or has_schema_privilege('service_role', 'archive_a3_20261104', 'USAGE'),
    'remove_executable_by_api_roles', has_function_privilege('anon', 'public.remove_sitework_catalog(jsonb)', 'EXECUTE')
                                      or has_function_privilege('authenticated', 'public.remove_sitework_catalog(jsonb)', 'EXECUTE')
                                      or has_function_privilege('service_role', 'public.remove_sitework_catalog(jsonb)', 'EXECUTE'),
    'restore_executable_by_api_roles', has_function_privilege('anon', 'archive_a3_20261104.restore_removed_rows()', 'EXECUTE')
                                       or has_function_privilege('authenticated', 'archive_a3_20261104.restore_removed_rows()', 'EXECUTE')
                                       or has_function_privilege('service_role', 'archive_a3_20261104.restore_removed_rows()', 'EXECUTE'),
    'initial_lines_readable_by_anon', has_table_privilege('anon', 'public.quote_initial_lines', 'SELECT'),
    'initial_lines_writable_by_authenticated', has_table_privilege('authenticated', 'public.quote_initial_lines', 'INSERT')
                                               or has_table_privilege('authenticated', 'public.quote_initial_lines', 'UPDATE')
                                               or has_table_privilege('authenticated', 'public.quote_initial_lines', 'DELETE'))
) as result;
