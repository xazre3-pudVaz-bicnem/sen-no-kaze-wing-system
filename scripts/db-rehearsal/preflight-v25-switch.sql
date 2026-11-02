-- v2.5 の価格の切り替え（シミュレーターのスイッチ）の前の確認。読み取りだけ・集計だけ（表の中身・名前・金額は返さない）。
-- v2.5 の一式（A1〜C1b）・S1・D1・D1c を本番に適用した後、スイッチを入れる前に流す：
--   npx supabase db query --linked --output-format json -f scripts/db-rehearsal/preflight-v25-switch.sql
-- migration が足りないときは、列・関数が無いためエラーで止まる（＝まだ切り替えられない）。
-- 判定は docs/v25-switch-readiness.md。ready_for_switch が true でなければスイッチを入れない。
select pg_catalog.jsonb_build_object(
  'switch_enabled', coalesce((select (s.value ->> 'enabled')::boolean from public.app_settings s where s.key = 'simulator_standard_pricing'), false),
  'standard_quote_drafts_applied', to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid)') is not null,
  'active_masters', x.active_masters,
  'masters_without_published', x.masters_without_published,
  'masters_published_not_v25', x.masters_published_not_v25,
  'masters_published_v25', x.masters_published_v25,
  'v25_slot_rule_issue_masters', x.slot_rule_issue_masters,
  'v25_incomplete_masters', x.incomplete_masters,
  'v25_base_por_masters', x.base_por_masters,
  'v25_stopped_product_masters', x.stopped_product_masters,
  'v25_position_slots', x.position_slots,
  'v25_quotes', (select count(*) from public.quotes q where q.pricing_model = 'v2.5'),
  'legacy_price_readable_by_users', has_column_privilege('authenticated', 'public.options', 'price', 'SELECT')
                                    or has_column_privilege('anon', 'public.options', 'price', 'SELECT'),
  -- スイッチの関数と同じ条件（有効な標準見積の公開中の版がすべて v2.5、選択枠の決まりに合う）に、
  -- D1c の適用・原価のそろい・本体の価格未確定・販売停止の商品・旧価格の列の保護を足したもの
  'ready_for_switch', to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid)') is not null
                      and x.active_masters > 0
                      and x.masters_without_published = 0
                      and x.masters_published_not_v25 = 0
                      and x.slot_rule_issue_masters = 0
                      and x.incomplete_masters = 0
                      and x.base_por_masters = 0
                      and x.stopped_product_masters = 0
                      and not has_column_privilege('authenticated', 'public.options', 'price', 'SELECT')
                      and not has_column_privilege('anon', 'public.options', 'price', 'SELECT'),
  'checked_at', now()
) as result
from (
  select count(*) as active_masters,
         count(*) filter (where r.id is null) as masters_without_published,
         count(*) filter (where r.id is not null and r.pricing_model is distinct from 'v2.5') as masters_published_not_v25,
         count(*) filter (where r.pricing_model = 'v2.5') as masters_published_v25,
         count(*) filter (where r.pricing_model = 'v2.5' and public.standard_estimate_v25_slot_rule_issues(r.id) is not null) as slot_rule_issue_masters,
         count(*) filter (where r.pricing_model = 'v2.5' and r.v25_pricing_complete is not true) as incomplete_masters,
         count(*) filter (where r.pricing_model = 'v2.5' and exists (
           select 1 from public.standard_estimate_revision_sections s
            where s.revision_id = r.id and s.section_code = 'base' and s.has_por)) as base_por_masters,
         count(*) filter (where r.pricing_model = 'v2.5'
                            and pg_catalog.cardinality(public.standard_estimate_stopped_baseline_names(r.id)) > 0) as stopped_product_masters,
         coalesce(sum((select count(*) from public.standard_estimate_revision_baseline_items bi
                         where bi.revision_id = r.id and bi.slot_code is not null)) filter (where r.pricing_model = 'v2.5'), 0) as position_slots
    from public.standard_estimate_masters m
    left join public.standard_estimate_revisions r on r.id = m.current_published_revision_id and r.status = 'published'
   where m.status = 'active'
) x;
