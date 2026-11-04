-- v2.5 の一式（A1〜C1b）・#603・S1・D1・D1c・S2b の 11 本を本番に適用する前の確認。読み取りだけ・件数だけ（表の中身は返さない）。
--   npx supabase db query --linked --output-format json -f scripts/db-rehearsal/preflight-v25-apply.sql
-- 期待（docs/v25-switch-readiness.md の「1.」）：
--   migrations_applied = 93・last_migration = 20261016114000・pending_objects_absent = true・
--   contact_status_outside_new_check = 0・switch_enabled = false
-- counts は適用の後に postflight-v25-apply.sql と見比べる（適用でデータが変わらないこと。足すのは初期値だけ）。
select pg_catalog.jsonb_build_object(
  'migrations_applied', (select count(*) from supabase_migrations.schema_migrations),
  'last_migration', (select max(version) from supabase_migrations.schema_migrations),
  -- 11 本が作る表・列・関数がまだ無い（あれば適用の途中か、想定と違う状態。適用せずに止める）
  'pending_objects_absent',
    to_regclass('public.option_standard_cost_versions') is null
    and to_regclass('public.pricing_calculation_rule_versions') is null
    and to_regclass('public.tax_rule_versions') is null
    and to_regclass('public.standard_estimate_revision_v25_lines') is null
    and to_regclass('public.window_types') is null
    and to_regclass('public.standard_estimate_revision_slot_options') is null
    and to_regclass('public.quote_item_cost_pins') is null
    and to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid, boolean)') is null
    and not exists (select 1 from pg_catalog.pg_attribute
                     where attrelid = 'public.standard_estimate_revisions'::regclass and attname = 'pricing_model' and not attisdropped)
    and not exists (select 1 from pg_catalog.pg_attribute
                     where attrelid = 'public.contact_messages'::regclass and attname = 'classification' and not attisdropped)
    and not exists (select 1 from pg_catalog.pg_attribute
                     where attrelid = 'public.configuration_items'::regclass and attname = 'slot_code' and not attisdropped)
    and not exists (select 1 from pg_catalog.pg_attribute
                     where attrelid = 'public.quotes'::regclass and attname = 'pricing_model' and not attisdropped),
  -- #603 の新しい状態の制約（new・in_progress・handled）に合わない問い合わせ（0 でなければ適用で失敗する）
  'contact_status_outside_new_check', (select count(*) from public.contact_messages where status not in ('new', 'in_progress', 'handled')),
  'switch_enabled', coalesce((select (s.value ->> 'enabled')::boolean from public.app_settings s where s.key = 'simulator_standard_pricing'), false),
  'counts', pg_catalog.jsonb_build_object(
    'options', (select count(*) from public.options),
    'option_variant_choices', (select count(*) from public.option_variant_choices),
    'option_categories', (select count(*) from public.option_categories),
    'option_categories_sash', (select count(*) from public.option_categories where code = 'sash'),
    -- A1 は既存の本部商品基準原価を Version 1 へ写す（この件数だけ原価の Version ができる）
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
