-- A-3（20261111100000）の適用の直前の照合（読み取りだけ。件数・照合値・状態ごとの件数・見積番号だけを返し、お客様の情報は返さない）。
-- remove_sitework_catalog と同じ集合・同じ止める条件を数える。stop_reasons が空で、matches_migration_expected が true のときだけ適用する。
-- 使い方：npx supabase db query --linked --read-only --output-format json -f scripts/db-rehearsal/preflight-a3-remove-sitework.sql
with cat as (
  select c.id from public.option_categories c where c.code = 'sitework'
), sw as (
  select o.id, o.code from public.options o where o.category_id in (select id from cat)
), cfg as (
  select distinct ci.configuration_id as id from public.configuration_items ci where ci.option_id in (select id from sw)
), req as (
  select r.id from public.quote_requests r where r.configuration_id in (select id from cfg)
), qt as (
  select q.id from public.quotes q where q.quote_request_id in (select id from req) or q.configuration_id in (select id from cfg)
), actual as (
  select pg_catalog.jsonb_build_object(
    'configurations', pg_catalog.jsonb_build_object(
      'count', (select count(*) from cfg),
      'md5', pg_catalog.md5(coalesce((select pg_catalog.string_agg(id::text, ',' order by id) from cfg), '')),
      'by_status', (select coalesce(pg_catalog.jsonb_object_agg(s.status, s.n), '{}'::jsonb)
                      from (select c.status::text as status, count(*) as n from public.configurations c where c.id in (select id from cfg) group by 1) s)),
    'quote_requests', pg_catalog.jsonb_build_object(
      'count', (select count(*) from req),
      'md5', pg_catalog.md5(coalesce((select pg_catalog.string_agg(id::text, ',' order by id) from req), '')),
      'by_status', (select coalesce(pg_catalog.jsonb_object_agg(s.status, s.n), '{}'::jsonb)
                      from (select r.status::text as status, count(*) as n from public.quote_requests r where r.id in (select id from req) group by 1) s)),
    'quotes', pg_catalog.jsonb_build_object(
      'count', (select count(*) from qt),
      'md5', pg_catalog.md5(coalesce((select pg_catalog.string_agg(id::text, ',' order by id) from qt), '')),
      'by_status', (select coalesce(pg_catalog.jsonb_object_agg(s.status, s.n), '{}'::jsonb)
                      from (select q.status::text as status, count(*) as n from public.quotes q where q.id in (select id from qt) group by 1) s))) as v
), expected as (
  -- migration（20261111100000）の照合値と同じ
  select pg_catalog.jsonb_build_object(
    'configurations', pg_catalog.jsonb_build_object('count', 18, 'md5', '052ab4ee62f1a393d616a2e759c200c5',
      'by_status', pg_catalog.jsonb_build_object('closed', 3, 'draft', 8, 'quote_requested', 6, 'quoted', 1)),
    'quote_requests', pg_catalog.jsonb_build_object('count', 10, 'md5', 'c26addc61c32672f79dc7ddf8089aa56',
      'by_status', pg_catalog.jsonb_build_object('new', 10)),
    'quotes', pg_catalog.jsonb_build_object('count', 10, 'md5', '7640ea6300fe17b4b8b996e8c8c52284',
      'by_status', pg_catalog.jsonb_build_object('accepted', 3, 'issued', 7))) as v
), checks as (
  select pg_catalog.jsonb_build_object(
    -- 削除の対象につながる記録（どれかあれば止める）
    'linked_contracts', (select count(*) from public.contracts x where x.quote_id in (select id from qt) or x.quote_request_id in (select id from req)),
    'linked_manufacturing_orders', (select count(*) from public.manufacturing_orders x where x.quote_id in (select id from qt) or x.quote_request_id in (select id from req)),
    'linked_quote_por_confirmations', (select count(*) from public.quote_por_confirmations x where x.quote_id in (select id from qt)),
    'linked_quote_drafts', (select count(*) from public.quote_drafts x where x.parent_quote_id in (select id from qt) or x.quote_request_id in (select id from req)),
    'linked_quote_change_requests', (select count(*) from public.quote_change_requests x where x.quote_id in (select id from qt) or x.quote_request_id in (select id from req)),
    'linked_quote_internal_snapshots', (select count(*) from public.quote_internal_snapshots x where x.quote_id in (select id from qt)),
    'linked_quote_item_cost_pins', (select count(*) from public.quote_item_cost_pins x where x.quote_id in (select id from qt)),
    'linked_case_records', (select count(*) from public.case_workflows x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.case_notes x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.case_files x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.case_appointments x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.case_schedule_items x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.case_progress_reports x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.case_handovers x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.case_punch_items x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.site_surveys x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.disaster_consents x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.after_service_requests x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.manufacturing_units x where x.quote_request_id in (select id from req))
                          + (select count(*) from public.stock_ledger_entries x where x.quote_request_id in (select id from req)),
    -- 9 品目が削除の対象の外から使われている（どれかあれば止める）
    'outside_quote_items', (select count(*) from public.quote_items qi where qi.option_id in (select id from sw) and qi.quote_id not in (select id from qt)),
    'outside_quote_draft_items', (select count(*) from public.quote_draft_items di where di.option_id in (select id from sw)),
    'outside_standard_estimate_baseline_items', (select count(*) from public.standard_estimate_revision_baseline_items bi
                                                   where bi.option_category_id in (select id from cat) or bi.option_id in (select id from sw)),
    'outside_slot_options', (select count(*) from public.standard_estimate_revision_slot_options so where so.option_id in (select id from sw)),
    'outside_cost_versions', (select count(*) from public.option_standard_cost_versions cv where cv.option_id in (select id from sw))
                           + (select count(*) from public.option_hq_standard_costs hc where hc.option_id in (select id from sw)),
    'outside_estimate_templates', (select count(*) from public.estimate_templates et
                                    where et.baseline_option_ids && (select coalesce(array_agg(id), '{}'::uuid[]) from sw)),
    'outside_legacy_snapshots', (select count(*) from public.legacy_migration_financial_snapshots ls
                                  where ls.legacy_baseline_option_ids && (select coalesce(array_agg(id), '{}'::uuid[]) from sw)),
    'outside_quote_internal_snapshot_lines', (select count(*) from public.quote_internal_snapshots qis
                                               cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(qis.lines) = 'array' then qis.lines else '[]'::jsonb end) l(value)
                                               where (l.value ->> 'option_id') in (select id::text from sw)),
    'outside_configuration_snapshot_lines', (select count(*) from public.configuration_snapshots cs
                                              cross join lateral pg_catalog.jsonb_array_elements(
                                                case when pg_catalog.jsonb_typeof(cs.snapshot -> 'lines') = 'array' then cs.snapshot -> 'lines' else '[]'::jsonb end) l(value)
                                              where cs.configuration_id not in (select id from cfg) and (l.value ->> 'option_id') in (select id::text from sw)),
    'outside_exterior_faces', (select count(*) from public.configurations c
                                cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(c.exterior_faces) = 'array' then c.exterior_faces else '[]'::jsonb end) f(value)
                                where c.id not in (select id from cfg) and (f.value ->> 'option_id') in (select id::text from sw)),
    'outside_guest_plans_unexpired', (select count(*) from public.guest_plans g
                                       where g.expires_at > now() and exists (select 1 from sw where pg_catalog.strpos(g.plan::text, sw.id::text) > 0)),
    -- 一緒に消える行（写しを取らない）。どれかあれば止める
    'cascade_option_images', (select count(*) from public.option_images x where x.option_id in (select id from sw)),
    'cascade_option_variant_groups', (select count(*) from public.option_variant_groups x where x.option_id in (select id from sw)),
    'cascade_option_rules', (select count(*) from public.option_dependencies x where x.option_id in (select id from sw) or x.requires_option_id in (select id from sw))
                          + (select count(*) from public.option_conflicts x where x.option_id in (select id from sw) or x.conflicts_with_option_id in (select id from sw)),
    'cascade_preview_hotspots', (select count(*) from public.preview_hotspots x where x.category_id in (select id from cat)),
    'cascade_category_matrix_items', (select count(*) from public.option_category_matrix_items x where x.category_id in (select id from cat)),
    -- 削除する見積を参照する残す見積・見積依頼（参照が空になる）。どれかあれば止める
    'set_null_child_quotes', (select count(*) from public.quotes q where q.parent_quote_id in (select id from qt) and q.id not in (select id from qt)),
    'set_null_quote_requests', (select count(*) from public.quote_requests r where r.quote_id in (select id from qt) and r.id not in (select id from req)),
    -- カテゴリーのほかの商品（9 品目以外があれば止める）
    'other_products_in_category', (select count(*) from sw where sw.code not in ('sw-transport', 'sw-design-permit', 'sw-packing', 'sw-site-install', 'sw-electric',
                                                                                 'sw-plumbing', 'sw-foundation', 'sw-disposal', 'sw-site-expense')),
    -- 商品の削除の保護（assert_option_unreferenced）が、どの商品の削除も止める状態（標準構成のどの商品にも無いコード）
    'guard_presets_unknown_codes', (select count(*) from public.base_models bm
                                     cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(bm.presets) = 'array' then bm.presets else '[]'::jsonb end) p(value)
                                     cross join lateral pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(p.value -> 'option_codes') = 'array' then p.value -> 'option_codes' else '[]'::jsonb end) oc(code)
                                     left join public.options o on o.code = oc.code where o.id is null)) as v
)
select pg_catalog.jsonb_build_object(
  'checked_at', now(),
  'migration_applied', exists (select 1 from supabase_migrations.schema_migrations m where m.version = '20261111100000'),
  'category', (select count(*) from cat),
  'products', (select coalesce(pg_catalog.jsonb_agg(sw.code order by sw.code), '[]'::jsonb) from sw),
  'targets', (select v from actual),
  'matches_migration_expected', (select a.v = e.v from actual a, expected e),
  'checks', (select v from checks),
  'stop_reasons', (select coalesce(pg_catalog.jsonb_agg(k.key order by k.key), '[]'::jsonb)
                     from checks, pg_catalog.jsonb_each(checks.v) k where (k.value #>> '{}')::bigint <> 0),
  -- 消えるもの（外部キーで一緒に消える行の件数）
  'removed_with_targets', pg_catalog.jsonb_build_object(
    'configuration_items', (select count(*) from public.configuration_items x where x.configuration_id in (select id from cfg)),
    'configuration_snapshots', (select count(*) from public.configuration_snapshots x where x.configuration_id in (select id from cfg)),
    'configuration_site_profiles', (select count(*) from public.configuration_site_profiles x where x.configuration_id in (select id from cfg)),
    'quote_request_preferences', (select count(*) from public.quote_request_preferences x where x.quote_request_id in (select id from req)),
    'quote_items', (select count(*) from public.quote_items x where x.quote_id in (select id from qt)),
    'quote_documents', (select count(*) from public.quote_documents x where x.quote_id in (select id from qt))),
  -- 発行済みの見積（承諾・発行中）の見積番号（お客様の情報は返さない）
  'quotes_issued_or_accepted', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('quote_no', q.quote_no, 'status', q.status, 'revision', q.revision)
                                                                     order by q.quote_no), '[]'::jsonb)
                                  from public.quotes q where q.id in (select id from qt)),
  -- 残すもの
  'kept', pg_catalog.jsonb_build_object(
    'quote_requests', (select count(*) from public.quote_requests r where r.id not in (select id from req)),
    'quote_requests_without_configuration', (select count(*) from public.quote_requests r where r.configuration_id is null),
    'quote_drafts', (select count(*) from public.quote_drafts),
    'quotes', (select count(*) from public.quotes q where q.id not in (select id from qt)),
    'configurations', (select count(*) from public.configurations c where c.id not in (select id from cfg)),
    'notifications', (select count(*) from public.notifications)),
  -- 標準構成から外すもの
  'presets', pg_catalog.jsonb_build_object(
    'models_with_sitework', (select count(distinct bm.id) from public.base_models bm
                               cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(bm.presets) = 'array' then bm.presets else '[]'::jsonb end) p(value)
                               cross join lateral pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(p.value -> 'option_codes') = 'array' then p.value -> 'option_codes' else '[]'::jsonb end) oc(code)
                               where oc.code in (select code from sw)),
    'sitework_entries', (select count(*) from public.base_models bm
                           cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(bm.presets) = 'array' then bm.presets else '[]'::jsonb end) p(value)
                           cross join lateral pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(p.value -> 'option_codes') = 'array' then p.value -> 'option_codes' else '[]'::jsonb end) oc(code)
                           where oc.code in (select code from sw)))
) as result;
