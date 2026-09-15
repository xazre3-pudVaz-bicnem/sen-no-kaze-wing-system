-- Wing の断熱を「床・壁・天井」の独立選択に分離する。
-- 現在の本体内訳に含まれる標準材は 0 円、標準からの変更で価格差が未確定の候補は別途見積とする。

-- 既存Draftに旧有料断熱が選ばれている場合は、0円標準断熱へ自動変換せず停止する。
-- spec_code が空の旧Draftは、現行シミュレーターと同じく先頭presetを有効仕様として扱う。
do $migration$
begin
  if exists (
    select 1
    from public.configurations cfg
    join public.base_models b on b.id = cfg.base_model_id
    join public.configuration_items ci on ci.configuration_id = cfg.id
    join public.options o on o.id = ci.option_id
    where b.slug = 'wing-01'
      and cfg.status = 'draft'
      and o.code = 'insulation-upgrade-wing'
  ) then
    raise exception
      'MIGRATION_BLOCKED: Wing Draftに旧有料断熱 insulation-upgrade-wing が選択されています。手動確認後に移行してください'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.configurations cfg
    join public.base_models b on b.id = cfg.base_model_id
    where b.slug = 'wing-01'
      and cfg.status = 'draft'
      and coalesce(nullif(cfg.spec_code, ''), b.presets -> 0 ->> 'code', '') not in ('hotel', 'residence', 'office')
  ) then
    raise exception
      'MIGRATION_BLOCKED: Wing Draftに断熱標準を自動判定できないspec_codeがあります'
      using errcode = 'P0001';
  end if;
end
$migration$;

-- 旧「断熱仕様（3部位一括）」は互換用に残すが、お客様向け公開対象から外す。
update public.option_categories
set status = 'draft'
where code = 'insulation';

update public.options
set status = 'draft', updated_at = now()
where code = 'insulation-upgrade-wing';

insert into public.option_categories
  (id, code, name, description, selection_mode, is_required, sort_order, status, group_code, group_name, group_sort, finish_level)
values
  ('29000000-0000-4000-8000-000000000001', 'insulation-floor', '床断熱', '床断熱を個別に選択します。', 'single', true, 4, 'published', 'finish', '内外装仕上げ', 2, 'shell'),
  ('29000000-0000-4000-8000-000000000002', 'insulation-wall', '壁断熱', '壁断熱を個別に選択します。', 'single', true, 5, 'published', 'finish', '内外装仕上げ', 2, 'shell'),
  ('29000000-0000-4000-8000-000000000003', 'insulation-ceiling', '天井断熱', '天井断熱を個別に選択します。', 'single', true, 6, 'published', 'finish', '内外装仕上げ', 2, 'shell')
on conflict (id) do update set
  code = excluded.code,
  name = excluded.name,
  description = excluded.description,
  selection_mode = excluded.selection_mode,
  is_required = excluded.is_required,
  sort_order = excluded.sort_order,
  status = excluded.status,
  group_code = excluded.group_code,
  group_name = excluded.group_name,
  group_sort = excluded.group_sort,
  finish_level = excluded.finish_level;

-- 接続先に Wing 本体が存在する場合だけ商品を追加する。
insert into public.options
  (id, base_model_id, category_id, code, name, description, price, image_url, selection_type,
   is_required, is_default, is_installation, price_on_request, preview_key, affects_views, sort_order,
   status, spec_codes, owner_id, manufacturer, model_no, size_note, list_price, highlight)
select * from (values
  ('39000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '29000000-0000-4000-8000-000000000001'::uuid,
   'insulation-floor-mirafoam-90', '床用ミラフォーム 90mm', '現在の仕様に含まれる断熱材です。', 0, null::text, 'radio', false, false, false, false, null::text, '{}'::text[], 1, 'published', '{}'::text[], null::uuid, null::text, null::text, '90mm', null::integer, '標準'),

  ('39000000-0000-4000-8000-000000000002'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '29000000-0000-4000-8000-000000000002'::uuid,
   'insulation-wall-styrofoam-90-hotel-base', '壁用スタイロフォーム 90mm', 'ホテル仕様の本体内訳に含まれる断熱材です。', 0, null::text, 'radio', false, false, false, false, null::text, '{}'::text[], 1, 'published', array['hotel']::text[], null::uuid, null::text, null::text, '90mm', null::integer, '標準'),
  ('39000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '29000000-0000-4000-8000-000000000002'::uuid,
   'insulation-wall-glasswool-90-hotel-change', '壁グラスウール 90mm', 'ホテル仕様から変更する場合の差額は正式見積で確認します。', 0, null::text, 'radio', false, false, false, true, null::text, '{}'::text[], 2, 'published', array['hotel']::text[], null::uuid, null::text, null::text, '90mm', null::integer, '仕様変更'),
  ('39000000-0000-4000-8000-000000000004'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '29000000-0000-4000-8000-000000000002'::uuid,
   'insulation-wall-glasswool-90-standard', '壁グラスウール 90mm', '住宅・事務所仕様の本体内訳に含まれる断熱材です。', 0, null::text, 'radio', false, false, false, false, null::text, '{}'::text[], 1, 'published', array['residence','office']::text[], null::uuid, null::text, null::text, '90mm', null::integer, '標準'),
  ('39000000-0000-4000-8000-000000000005'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '29000000-0000-4000-8000-000000000002'::uuid,
   'insulation-wall-styrofoam-90-change', '壁用スタイロフォーム 90mm', '住宅・事務所仕様から変更する場合の差額は正式見積で確認します。', 0, null::text, 'radio', false, false, false, true, null::text, '{}'::text[], 2, 'published', array['residence','office']::text[], null::uuid, null::text, null::text, '90mm', null::integer, '仕様変更'),

  ('39000000-0000-4000-8000-000000000006'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '29000000-0000-4000-8000-000000000003'::uuid,
   'insulation-ceiling-styrofoam-90-hotel-base', '天井用スタイロフォーム 90mm', 'ホテル仕様の本体内訳に含まれる断熱材です。', 0, null::text, 'radio', false, false, false, false, null::text, '{}'::text[], 1, 'published', array['hotel']::text[], null::uuid, null::text, null::text, '90mm', null::integer, '標準'),
  ('39000000-0000-4000-8000-000000000007'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '29000000-0000-4000-8000-000000000003'::uuid,
   'insulation-ceiling-glasswool-90-hotel-change', '天井グラスウール 90mm', 'ホテル仕様から変更する場合の差額は正式見積で確認します。', 0, null::text, 'radio', false, false, false, true, null::text, '{}'::text[], 2, 'published', array['hotel']::text[], null::uuid, null::text, null::text, '90mm', null::integer, '仕様変更'),
  ('39000000-0000-4000-8000-000000000008'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '29000000-0000-4000-8000-000000000003'::uuid,
   'insulation-ceiling-glasswool-90-standard', '天井グラスウール 90mm', '住宅・事務所仕様の本体内訳に含まれる断熱材です。', 0, null::text, 'radio', false, false, false, false, null::text, '{}'::text[], 1, 'published', array['residence','office']::text[], null::uuid, null::text, null::text, '90mm', null::integer, '標準'),
  ('39000000-0000-4000-8000-000000000009'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, '29000000-0000-4000-8000-000000000003'::uuid,
   'insulation-ceiling-styrofoam-90-change', '天井用スタイロフォーム 90mm', '住宅・事務所仕様から変更する場合の差額は正式見積で確認します。', 0, null::text, 'radio', false, false, false, true, null::text, '{}'::text[], 2, 'published', array['residence','office']::text[], null::uuid, null::text, null::text, '90mm', null::integer, '仕様変更')
) as v(id, base_model_id, category_id, code, name, description, price, image_url, selection_type,
       is_required, is_default, is_installation, price_on_request, preview_key, affects_views, sort_order,
       status, spec_codes, owner_id, manufacturer, model_no, size_note, list_price, highlight)
where exists (
  select 1 from public.base_models b where b.id = '10000000-0000-4000-8000-000000000001'::uuid
)
on conflict (id) do update set
  category_id = excluded.category_id,
  code = excluded.code,
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  selection_type = excluded.selection_type,
  price_on_request = excluded.price_on_request,
  spec_codes = excluded.spec_codes,
  sort_order = excluded.sort_order,
  status = excluded.status,
  size_note = excluded.size_note,
  highlight = excluded.highlight,
  updated_at = now();

-- 既存Wing Draftだけに、現在の仕様に対応する標準0円断熱3項目を補完する。
-- quote_requested / closed と既存snapshot・金額は変更しない。
with draft_specs as (
  select
    cfg.id as configuration_id,
    coalesce(nullif(cfg.spec_code, ''), b.presets -> 0 ->> 'code', '') as effective_spec
  from public.configurations cfg
  join public.base_models b on b.id = cfg.base_model_id
  where b.slug = 'wing-01'
    and cfg.status = 'draft'
),
wanted as (
  select configuration_id, 'insulation-floor-mirafoam-90'::text as option_code
  from draft_specs
  union all
  select
    configuration_id,
    case
      when effective_spec = 'hotel' then 'insulation-wall-styrofoam-90-hotel-base'
      else 'insulation-wall-glasswool-90-standard'
    end
  from draft_specs
  union all
  select
    configuration_id,
    case
      when effective_spec = 'hotel' then 'insulation-ceiling-styrofoam-90-hotel-base'
      else 'insulation-ceiling-glasswool-90-standard'
    end
  from draft_specs
)
insert into public.configuration_items (
  configuration_id,
  option_id,
  quantity,
  variant_choice_ids
)
select
  w.configuration_id,
  o.id,
  1,
  '{}'::uuid[]
from wanted w
join public.options o on o.code = w.option_code
where not exists (
  select 1
  from public.configuration_items ci
  where ci.configuration_id = w.configuration_id
    and ci.option_id = o.id
);

-- Wing のプリセットに、各仕様の標準断熱3項目を追加する。
update public.base_models b
set presets = (
  select coalesce(jsonb_agg(
    case p->>'code'
      when 'hotel' then jsonb_set(
        p,
        '{option_codes}',
        coalesce(p->'option_codes', '[]'::jsonb)
          || '["insulation-floor-mirafoam-90","insulation-wall-styrofoam-90-hotel-base","insulation-ceiling-styrofoam-90-hotel-base"]'::jsonb
      )
      when 'residence' then jsonb_set(
        p,
        '{option_codes}',
        coalesce(p->'option_codes', '[]'::jsonb)
          || '["insulation-floor-mirafoam-90","insulation-wall-glasswool-90-standard","insulation-ceiling-glasswool-90-standard"]'::jsonb
      )
      when 'office' then jsonb_set(
        p,
        '{option_codes}',
        coalesce(p->'option_codes', '[]'::jsonb)
          || '["insulation-floor-mirafoam-90","insulation-wall-glasswool-90-standard","insulation-ceiling-glasswool-90-standard"]'::jsonb
      )
      else p
    end
    order by ord
  ), '[]'::jsonb)
  from jsonb_array_elements(b.presets) with ordinality as x(p, ord)
), updated_at = now()
where b.id = '10000000-0000-4000-8000-000000000001'::uuid;
