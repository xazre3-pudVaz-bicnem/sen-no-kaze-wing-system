-- 初期登録後の確認（統合版依頼書 §12）。読み取りだけ・件数と真偽だけを返す（本番でも使える）。
--   npx supabase db query --linked --output-format json -f scripts/initial-registration/postflight.sql
-- 結果の ok がすべて true なら合格。
with hq as (
  select id from public.organizations where organization_type = 'headquarters' and status = 'active'
),
bm as (
  select b.* from public.base_masters b join hq on hq.id = b.owner_organization_id
   where b.status = 'active' and b.matrix_row_id is not null
),
se as (
  select m.*, r.base_master_revision_id, r.status as revision_status, r.sales_fee_rate, r.expense_rate, r.markup_rate,
         r.total, r.cost_total, r.has_por, r.id as revision_id
    from public.standard_estimate_masters m
    join hq on hq.id = m.owner_organization_id
    left join public.standard_estimate_revisions r on r.id = m.current_published_revision_id
   where m.status = 'active'
),
checks as (
  select jsonb_build_object(
    -- Base Master
    'base_masters_10', (select count(*) = 10 from bm),
    'base_identity_unique', not exists (
      select 1 from bm group by owner_organization_id, matrix_row_id, fire_spec_code having count(*) > 1),
    'base_published', (select count(*) = 10 from bm b join public.base_master_revisions r on r.id = b.current_published_revision_id and r.status = 'published'),
    'base_direct_cost_only', not exists (
      select 1 from bm b join public.base_master_revisions r on r.id = b.current_published_revision_id
       where r.expense_method <> 'none'),
    'base_no_rate_expense_lines', not exists (
      select 1 from bm b join public.base_master_revision_lines l on l.revision_id = b.current_published_revision_id
       where l.name ~ '(諸費用|工事経費)'),
    'no_flat_fire', not exists (
      select 1 from bm b join public.base_models m on m.id = b.base_model_id where m.slug = 'flat' and b.fire_spec_code = 'fire'),
    -- Standard Estimate
    'estimates_10_published', (select count(*) = 10 from se where revision_status = 'published'),
    'estimate_exact_pin', not exists (
      select 1 from se join public.base_masters b on b.id = se.base_master_id
       where se.base_master_revision_id is distinct from b.current_published_revision_id),
    'estimate_no_base_copy', not exists (
      select 1 from se join public.standard_estimate_revision_lines l on l.revision_id = se.revision_id where l.section_code = 'base'),
    'estimate_initial_rates', not exists (
      select 1 from se where sales_fee_rate <> 1.0 or expense_rate <> 0.15 or markup_rate <> 1.5),
    'estimate_money_snapshot', not exists (select 1 from se where total <= 0 or cost_total <= 0 or total <= cost_total),
    -- 価格未確定（POR）は、型番のない設備機器（商品確定待ち）のオプションの行だけ
    'estimate_por_pending_products_only', not exists (
      select 1 from se join public.standard_estimate_revision_lines l on l.revision_id = se.revision_id
       where l.price_mode = 'por' and (l.section_code <> 'option' or coalesce(l.remark, '') not like '商品確定待ち：%')),
    'estimate_auto_trunc', not exists (
      select 1 from se join public.standard_estimate_revision_lines l on l.revision_id = se.revision_id
       where l.price_mode = 'auto' and l.unit_price <> trunc(l.cost_unit_price * se.markup_rate)::integer),
    -- Matrix
    'matrix_rows_6', (select count(*) = 6 from public.matrix_rows where status = 'active'),
    'matrix_items_15', (select count(*) = 15 from public.matrix_items where status = 'active'),
    'matrix_cells_90', (select count(*) = 90 from public.matrix_cells c join public.matrix_rows r on r.id = c.matrix_row_id where r.status = 'active'),
    'matrix_flat_not_fire', exists (
      select 1 from public.matrix_rows r join public.base_models m on m.id = r.base_model_id
       where m.slug = 'flat' and r.spec_code = 'office' and not r.fire_selectable),
    'matrix_no_hotel_single', not exists (select 1 from public.matrix_rows where spec_code = 'hotel-single')
  ) as j
)
select j || jsonb_build_object('ok', not exists (select 1 from jsonb_each(j) e where e.value <> 'true'::jsonb)) as j
  from checks;
