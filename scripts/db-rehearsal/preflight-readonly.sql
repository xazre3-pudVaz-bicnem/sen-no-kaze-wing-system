-- 本番適用前の read-only data preflight（件数・真偽・商品コードだけを返す。個人情報・明細は返さない）。
--
--   npx supabase db query --linked --output-format json -f scripts/db-rehearsal/preflight-readonly.sql
--
-- 本番に適用済みの 20 本（末尾 20260829040000）のスキーマだけを参照する。SELECT のみで、何も変更しない。
-- 未適用 migration の「データ前提で停止する条件」と、最終完全版 12 章の確認項目のうち、
-- 適用前のスキーマで判定できるものをまとめている。値が stop に該当したら、その場で直さず報告する。
--
-- 本体分類表（11 パターン × 15 業務項目）は、20261006183000 の関数と同じ内容を CTE に展開している。

with
business_item(category_code, item) as (
  values
    ('roof', 'roof-exterior'), ('exterior-wall', 'roof-exterior'),
    ('floor', 'interior'), ('wall-ceiling', 'interior'), ('carpentry', 'interior'),
    ('entrance-door', 'entrance-door'), ('sash', 'sash'), ('service-door', 'sash'),
    ('ub', 'bath'), ('kitchen', 'kitchen'), ('washbasin', 'washbasin'), ('toilet', 'toilet'), ('boiler', 'boiler'),
    ('entrance-storage', 'entrance-storage'), ('interior-door', 'interior-door'), ('closet', 'closet'), ('bed', 'bed'),
    ('furniture', 'furnishings'), ('appliances', 'furnishings'), ('office-supplies', 'furnishings'),
    ('aircon', 'other'), ('lighting', 'other'), ('smartlock', 'other'), ('exterior-parts', 'other')
),
matrix(model_slug, spec_code, items) as (
  values
    ('wing-01', 'base', array['roof-exterior','entrance-door','sash']::text[]),
    ('wing-01', 'hotel', array['roof-exterior','interior','entrance-door','sash','bath','washbasin','toilet','boiler','entrance-storage','interior-door','bed','furnishings','other']::text[]),
    ('wing-01', 'residence', array['roof-exterior','interior','entrance-door','sash','bath','kitchen','washbasin','toilet','boiler','entrance-storage','interior-door','bed','furnishings','other']::text[]),
    ('wing-01', 'room', array['roof-exterior','interior','interior-door','closet','bed','furnishings','other']::text[]),
    ('wing-01', 'office', array['roof-exterior','interior','entrance-door','sash','bath','kitchen','toilet','boiler','furnishings','other']::text[]),
    ('box', 'base', array['roof-exterior','entrance-door','sash']::text[]),
    ('box', 'hotel', array['roof-exterior','interior','entrance-door','sash','bath','washbasin','toilet','boiler','entrance-storage','interior-door','bed','furnishings','other']::text[]),
    ('box', 'residence', array['roof-exterior','interior','entrance-door','sash','bath','kitchen','washbasin','toilet','boiler','entrance-storage','interior-door','bed','furnishings','other']::text[]),
    ('box', 'room', array['roof-exterior','interior','interior-door','closet','bed','furnishings','other']::text[]),
    ('box', 'office', array['roof-exterior','interior','entrance-door','sash','bath','kitchen','toilet','boiler','furnishings','other']::text[]),
    ('box', 'hotel-single', array['roof-exterior','interior','entrance-door','sash','bath','kitchen','washbasin','toilet','boiler','entrance-storage','interior-door','bed','furnishings','other']::text[]),
    ('box', 'water-kit', array['roof-exterior','interior','entrance-door','sash','bath','kitchen','washbasin','toilet','boiler']::text[]),
    ('box', 'storage', array['roof-exterior','interior','entrance-door','sash']::text[]),
    ('flat', 'base', array['roof-exterior','entrance-door','sash']::text[]),
    ('flat', 'office', array['roof-exterior','interior','entrance-door','sash']::text[])
),
-- 保存済みプランの明細を、モデル・仕様・カテゴリー・商品の適合つきで展開する（仕様 NULL は判定対象外）
cfg_item as (
  select cfg.id as configuration_id, cfg.status, m.slug as model_slug, cfg.spec_code, cat.code as category_code, o.code as option_code,
         bi.item,
         (bi.item is null or exists (select 1 from matrix x where x.model_slug = m.slug and x.spec_code = cfg.spec_code and bi.item = any(x.items))) as category_ok,
         (cardinality(coalesce(o.spec_codes, '{}'::text[])) = 0
          or cfg.spec_code = any(o.spec_codes)
          or (m.slug = 'box' and cfg.spec_code = 'hotel-single' and 'residence' = any(o.spec_codes))) as product_ok
    from public.configurations cfg
    join public.base_models m on m.id = cfg.base_model_id
    join public.configuration_items ci on ci.configuration_id = cfg.id
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
    left join business_item bi on bi.category_code = cat.code
   where cfg.spec_code is not null
),
rows_ as (
  select r.model_slug, r.spec_code from matrix r where r.spec_code <> 'base'
)
select jsonb_build_object(
  'checked_at', now(),
  'migration_tail', (select max(version) from supabase_migrations.schema_migrations),

  -- プランの全体像（件数のみ）
  'configurations', (select jsonb_object_agg(k, n) from (
      select status || case when spec_code is null then ' / spec なし' else '' end as k, count(*) as n
        from public.configurations group by 1) s),

  -- 20260830041000 の停止条件（どちらも 0 でなければ適用が止まる）
  'stop_20260830041000', jsonb_build_object(
    'wing_draft_with_old_paid_insulation', (
      select count(distinct cfg.id)
        from public.configurations cfg
        join public.base_models b on b.id = cfg.base_model_id
        join public.configuration_items ci on ci.configuration_id = cfg.id
        join public.options o on o.id = ci.option_id
       where b.slug = 'wing-01' and cfg.status = 'draft' and o.code = 'insulation-upgrade-wing'),
    'wing_draft_with_undeterminable_spec', (
      select count(*)
        from public.configurations cfg
        join public.base_models b on b.id = cfg.base_model_id
       where b.slug = 'wing-01' and cfg.status = 'draft'
         and coalesce(nullif(cfg.spec_code, ''), b.presets -> 0 ->> 'code', '') not in ('hotel', 'residence', 'office'))
  ),

  -- 20261006183000（本体分類表 corrective）の precondition
  'stop_20261006183000', jsonb_build_object(
    'missing_or_unpublished_required_categories', (
      select coalesce(jsonb_agg(c), '[]'::jsonb) from unnest(array['exterior-wall','sash','interior-door','furniture']::text[]) c
       where not exists (select 1 from public.option_categories oc where oc.code = c and oc.status = 'published')),
    'note_roof_and_entrance_door', 'roof / entrance-door カテゴリーは未適用の 20260924085700 / 20260924092000 が作成する',
    'missing_audited_products', (
      select coalesce(jsonb_agg(c), '[]'::jsonb) from unnest(array[
        'door-glass','sash-lixil-prose-kamachi','sash-door-katteguchi','sash-door-katteguchi-koshi-panel','sash-door-katteguchi-zen-panel',
        'shoe-box','shoebox-daiken-ieria-low800','shoebox-lixil-lasissa-s-low','shoebox-pana-comporia-low',
        'hanger-pipe','folding-bed','interior-standard-box','carpentry-box','shower-unit-1116','mini-kitchen']::text[]) c
       where not exists (select 1 from public.options o where o.code = c)),
    'audited_products_in_unexpected_category', (
      select coalesce(jsonb_agg(jsonb_build_object('option', o.code, 'category', c.code)), '[]'::jsonb)
        from public.options o join public.option_categories c on c.id = o.category_id
       where (o.code = 'door-glass' and c.code not in ('interior-door', 'entrance-door'))
          or (o.code = 'sash-lixil-prose-kamachi' and c.code not in ('sash', 'entrance-door'))
          or (o.code in ('sash-door-katteguchi','sash-door-katteguchi-koshi-panel','sash-door-katteguchi-zen-panel') and c.code not in ('sash', 'service-door'))
          or (o.code in ('shoe-box','shoebox-daiken-ieria-low800','shoebox-lixil-lasissa-s-low','shoebox-pana-comporia-low') and c.code not in ('furniture', 'entrance-storage'))
          or (o.code = 'hanger-pipe' and c.code not in ('furniture', 'closet'))
          or (o.code = 'folding-bed' and c.code not in ('furniture', 'bed'))),
    'sash_standard_description_unexpected', exists (
      select 1 from public.options
       where code = 'sash-standard'
         and description is distinct from '玄関ドア・引違い窓・押出窓・縦辷り窓の一式。'
         and description is distinct from '引違い窓・押出窓・縦辷り窓の標準一式。'),
    'box_hotel_single_baseline_total', (
      select sum(case when price_on_request then 0 else price end) from public.options
       where code in ('interior-standard-box','carpentry-box','shower-unit-1116','mini-kitchen','folding-bed')),
    'box_hotel_single_baseline_total_expected', 1518904,
    'existing_new_categories', (
      select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'mode', selection_mode, 'required', is_required, 'visible', customer_visible, 'status', status, 'finish_level', finish_level)), '[]'::jsonb)
        from public.option_categories where code in ('service-door', 'entrance-storage', 'closet', 'bed'))
  ),

  -- 分類表で × になる商品・仕様不適合の商品を含むプラン（件数のみ）
  'matrix_violations', jsonb_build_object(
    'draft_configurations', (select count(distinct configuration_id) from cfg_item where status = 'draft' and not (category_ok and product_ok)),
    'non_draft_configurations', (select count(distinct configuration_id) from cfg_item where status <> 'draft' and not (category_ok and product_ok)),
    'by_combination', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'model', model_slug, 'spec', spec_code, 'category', category_code, 'option', option_code,
                                                   'reason', case when not category_ok then 'カテゴリーが ×' else '商品が仕様に不適合' end, 'configurations', n)
                                order by status, model_slug, spec_code, category_code), '[]'::jsonb)
        from (select status, model_slug, spec_code, category_code, option_code, category_ok, count(distinct configuration_id) as n
                from cfg_item where not (category_ok and product_ok) group by 1, 2, 3, 4, 5, 6) v)
  ),

  -- 必須カテゴリーと分類表の × の衝突（20261006230000 で保存不能を解消する対象）
  'required_vs_matrix', (
    select coalesce(jsonb_agg(jsonb_build_object('model', r.model_slug, 'spec', r.spec_code, 'category', c.code) order by r.model_slug, r.spec_code, c.code), '[]'::jsonb)
      from rows_ r
      join public.option_categories c on c.is_required and c.status = 'published'
      join business_item bi on bi.category_code = c.code
     where not exists (select 1 from matrix x where x.model_slug = r.model_slug and x.spec_code = r.spec_code and bi.item = any(x.items))),

  -- 依存の前提商品が、依存元を選べるモデル・仕様で選べない組み合わせ（0 件であるべき）
  'unsatisfiable_dependencies', (
    select coalesce(jsonb_agg(jsonb_build_object('model', r.model_slug, 'spec', r.spec_code, 'option', o.code, 'requires', ro.code) order by r.model_slug, r.spec_code, o.code), '[]'::jsonb)
      from rows_ r
      join public.base_models m on m.slug = r.model_slug
      join public.option_dependencies d on true
      join public.options o on o.id = d.option_id
      join public.option_categories oc on oc.id = o.category_id
      left join business_item obi on obi.category_code = oc.code
      join public.options ro on ro.id = d.requires_option_id
      join public.option_categories rc on rc.id = ro.category_id
      left join business_item rbi on rbi.category_code = rc.code
     where o.status = 'published'
       and (o.base_model_id is null or o.base_model_id = m.id)
       and (cardinality(coalesce(o.spec_codes, '{}'::text[])) = 0 or r.spec_code = any(o.spec_codes) or (r.model_slug = 'box' and r.spec_code = 'hotel-single' and 'residence' = any(o.spec_codes)))
       and (obi.item is null or exists (select 1 from matrix x where x.model_slug = r.model_slug and x.spec_code = r.spec_code and obi.item = any(x.items)))
       and not (
         ro.status = 'published'
         and (ro.base_model_id is null or ro.base_model_id = m.id)
         and (cardinality(coalesce(ro.spec_codes, '{}'::text[])) = 0 or r.spec_code = any(ro.spec_codes) or (r.model_slug = 'box' and r.spec_code = 'hotel-single' and 'residence' = any(ro.spec_codes)))
         and (rbi.item is null or exists (select 1 from matrix x where x.model_slug = r.model_slug and x.spec_code = r.spec_code and rbi.item = any(x.items)))
       )),
  'dependencies_total', (select count(*) from public.option_dependencies),

  -- エアコンを複数選択しているプラン（20260914153000 で単一選択になる）
  'aircon_multi_selection', (
    select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
      select t.status, count(*) as n from (
        select cfg.id, cfg.status
          from public.configurations cfg
          join public.configuration_items ci on ci.configuration_id = cfg.id
          join public.options o on o.id = ci.option_id
          join public.option_categories cat on cat.id = o.category_id
         where cat.code = 'aircon'
         group by cfg.id, cfg.status having count(*) > 1) t group by t.status) s),

  -- 未適用 migration が固定 ID・code で作るカテゴリーとの衝突
  'category_code_collisions', (
    select coalesce(jsonb_agg(jsonb_build_object('code', code, 'id', id)), '[]'::jsonb)
      from public.option_categories
     where code in ('roof', 'entrance-door', 'insulation-floor', 'insulation-wall', 'insulation-ceiling', 'service-door', 'entrance-storage', 'closet', 'bed')),

  -- 見積の系譜（件数のみ）
  'quotes', jsonb_build_object(
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) as n from public.quotes group by 1) s),
    'revision_null_or_below_1', (select count(*) from public.quotes where revision is null or revision < 1),
    'request_pointer_to_other_request', (
      select count(*) from public.quote_requests r join public.quotes q on q.id = r.quote_id where q.quote_request_id is distinct from r.id),
    'parent_in_other_request', (
      select count(*) from public.quotes q join public.quotes p on p.id = q.parent_quote_id where p.quote_request_id is distinct from q.quote_request_id),
    'requests_without_current_quote', (select count(*) from public.quote_requests where quote_id is null),
    'accepted_quotes', (select count(*) from public.quotes where status = 'accepted')
  )
) as j;
