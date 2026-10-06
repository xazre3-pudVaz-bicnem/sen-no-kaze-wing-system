-- 本体分類表 1シート目の「モデル × 仕様 × 項目 = 選択 / ×」を
-- お客様向けカテゴリー可否へ反映する corrective。
--
-- 正本の分担:
--   * 本体分類表: カテゴリー自体を選べるか（選択 / ×）
--   * option_categories.customer_visible: お客様画面へ公開し得るカテゴリーかという全体ゲート
--   * options.base_model_id / options.spec_codes: 個別商品のモデル・仕様適合
--
-- 分類表から個々のサッシ・窓位置・商品適合は推測しない。
-- 発行済み Quote / Revision / Snapshot / Configuration の保存値・金額は更新しない。
-- 既存 migration は編集せず、本 corrective は backlog の末尾で適用する。

begin;

-- ---------- preflight / fail closed ----------

do $$
declare
  v_code text;
begin
  foreach v_code in array array['roof', 'exterior-wall', 'sash', 'interior-door', 'entrance-door']::text[]
  loop
    if not exists (select 1 from public.option_categories where code = v_code) then
      raise exception 'PRECONDITION: required category % is missing', v_code;
    end if;
  end loop;

  foreach v_code in array array[
    'door-glass',
    'sash-lixil-prose-kamachi',
    'sash-door-katteguchi',
    'sash-door-katteguchi-koshi-panel',
    'sash-door-katteguchi-zen-panel'
  ]::text[]
  loop
    if not exists (select 1 from public.options where code = v_code) then
      raise exception 'PRECONDITION: audited product % is missing', v_code;
    end if;
  end loop;

  if exists (
    select 1
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where o.code = 'door-glass'
       and c.code not in ('interior-door', 'entrance-door')
  ) then
    raise exception 'PRECONDITION: door-glass belongs to an unexpected category';
  end if;

  if exists (
    select 1
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where o.code = 'sash-lixil-prose-kamachi'
       and c.code not in ('sash', 'entrance-door')
  ) then
    raise exception 'PRECONDITION: sash-lixil-prose-kamachi belongs to an unexpected category';
  end if;

  if exists (
    select 1
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where o.code in (
       'sash-door-katteguchi',
       'sash-door-katteguchi-koshi-panel',
       'sash-door-katteguchi-zen-panel'
     )
       and c.code not in ('sash', 'service-door')
  ) then
    raise exception 'PRECONDITION: a service-door candidate belongs to an unexpected category';
  end if;

  if exists (
    select 1
      from public.options
     where code = 'sash-standard'
       and description is distinct from '玄関ドア・引違い窓・押出窓・縦辷り窓の一式。'
       and description is distinct from '引違い窓・押出窓・縦辷り窓の標準一式。'
  ) then
    raise exception 'PRECONDITION: sash-standard description has changed; review before applying corrective';
  end if;
end;
$$;

-- ---------- category semantics ----------

insert into public.option_categories (
  code,
  name,
  description,
  selection_mode,
  is_required,
  customer_visible,
  sort_order,
  status,
  group_code,
  group_name,
  group_sort,
  finish_level
)
values (
  'service-door',
  '勝手口ドア',
  '勝手口ドア。対象モデル・仕様で選択可能な場合に表示します',
  'single',
  false,
  true,
  2,
  'published',
  'service-door',
  '建具・開口',
  3,
  'shell'
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    selection_mode = excluded.selection_mode,
    is_required = excluded.is_required,
    customer_visible = excluded.customer_visible,
    status = excluded.status,
    group_code = excluded.group_code,
    group_name = excluded.group_name,
    group_sort = excluded.group_sort,
    finish_level = excluded.finish_level;

update public.option_categories
   set customer_visible = true,
       description = 'サッシ・窓。対象モデル・仕様で選択可能な場合に表示します'
 where code = 'sash';

update public.option_categories
   set customer_visible = true,
       description = '玄関ドア。対象モデル・仕様で選択可能な場合に表示します'
 where code = 'entrance-door';

comment on column public.option_categories.customer_visible is
  'お客様画面へ公開し得るカテゴリーかの全体ゲート。モデル・仕様別の選択 / ×は本体分類表由来の別判定を重ねる。';

comment on column public.options.spec_codes is
  '個別商品を選択できる仕様コードのホワイトリスト。空配列は商品側では全仕様共通。カテゴリーの選択 / ×とは独立。';

-- ---------- explicit product classification ----------
-- 分類表から個別商品適合は推測しない。
-- 名称・説明から役割を明示できた既存商品のカテゴリーだけを是正する。

update public.options
   set category_id = (select id from public.option_categories where code = 'entrance-door')
 where code in ('door-glass', 'sash-lixil-prose-kamachi');

update public.options
   set category_id = (select id from public.option_categories where code = 'service-door')
 where code in (
   'sash-door-katteguchi',
   'sash-door-katteguchi-koshi-panel',
   'sash-door-katteguchi-zen-panel'
 );

-- legacy aggregateのカテゴリー・価格・codeは履歴互換のため変えない。
-- ただし玄関ドアを含むという旧説明だけを、現在の分類責務に合わせて訂正する。
update public.options
   set description = '引違い窓・押出窓・縦辷り窓の標準一式。'
 where code = 'sash-standard'
   and description = '玄関ドア・引違い窓・押出窓・縦辷り窓の一式。';

-- ---------- DB-side category applicability ----------
-- UIだけではなく、新しく保存されるConfigurationでも本体分類表の × を拒否する。
-- 未知のmodel/specは、確定表にないカテゴリーを勝手に公開しないため controlled categoryをfail closed。
-- spec_code NULLは既存legacy互換のためこのcorrectiveでは制限しない。
-- BOX hotel-singleは旧「ホテル・単身者用」互換コードで分類表に同名行がないため、
-- 確定hotel/residenceの和集合（residenceと同じ）を互換範囲として扱う。

create or replace function public.customer_category_selectable(
  p_model_slug text,
  p_spec_code text,
  p_category_code text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_category_code not in (
      'roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry',
      'entrance-door', 'service-door', 'sash', 'interior-door',
      'ub', 'kitchen', 'washbasin', 'toilet'
    ) then true
    when p_spec_code is null then true

    when p_model_slug = 'wing-01' and p_spec_code = 'base' then
      p_category_code = any(array['roof', 'exterior-wall', 'entrance-door', 'service-door', 'sash']::text[])
    when p_model_slug = 'wing-01' and p_spec_code = 'hotel' then
      p_category_code = any(array['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry', 'entrance-door', 'service-door', 'sash', 'interior-door', 'ub', 'washbasin', 'toilet']::text[])
    when p_model_slug = 'wing-01' and p_spec_code = 'residence' then
      p_category_code = any(array['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry', 'entrance-door', 'service-door', 'sash', 'interior-door', 'ub', 'kitchen', 'washbasin', 'toilet']::text[])
    when p_model_slug = 'wing-01' and p_spec_code = 'room' then
      p_category_code = any(array['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry', 'interior-door']::text[])
    when p_model_slug = 'wing-01' and p_spec_code = 'office' then
      p_category_code = any(array['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry', 'entrance-door', 'service-door', 'sash', 'ub', 'kitchen', 'toilet']::text[])

    when p_model_slug = 'box' and p_spec_code = 'base' then
      p_category_code = any(array['roof', 'exterior-wall', 'entrance-door', 'service-door', 'sash']::text[])
    when p_model_slug = 'box' and p_spec_code = 'hotel' then
      p_category_code = any(array['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry', 'entrance-door', 'service-door', 'sash', 'interior-door', 'ub', 'washbasin', 'toilet']::text[])
    when p_model_slug = 'box' and p_spec_code in ('residence', 'hotel-single') then
      p_category_code = any(array['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry', 'entrance-door', 'service-door', 'sash', 'interior-door', 'ub', 'kitchen', 'washbasin', 'toilet']::text[])
    when p_model_slug = 'box' and p_spec_code = 'room' then
      p_category_code = any(array['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry', 'interior-door']::text[])
    when p_model_slug = 'box' and p_spec_code = 'office' then
      p_category_code = any(array['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry', 'entrance-door', 'service-door', 'sash', 'ub', 'kitchen', 'toilet']::text[])
    when p_model_slug = 'box' and p_spec_code = 'water-kit' then
      p_category_code = any(array['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry', 'entrance-door', 'service-door', 'sash', 'ub', 'kitchen', 'washbasin', 'toilet']::text[])
    when p_model_slug = 'box' and p_spec_code = 'storage' then
      p_category_code = any(array['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry', 'entrance-door', 'service-door', 'sash']::text[])

    when p_model_slug = 'flat' and p_spec_code = 'base' then
      p_category_code = any(array['roof', 'exterior-wall', 'entrance-door', 'service-door', 'sash']::text[])
    when p_model_slug = 'flat' and p_spec_code = 'office' then
      p_category_code = any(array['roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry', 'entrance-door', 'service-door', 'sash']::text[])

    else false
  end;
$$;

alter function public.customer_category_selectable(text, text, text) owner to postgres;
revoke all on function public.customer_category_selectable(text, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.enforce_configuration_item_customer_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model_slug text;
  v_spec_code text;
  v_category_code text;
begin
  select m.slug, cfg.spec_code, cat.code
    into v_model_slug, v_spec_code, v_category_code
    from public.configurations cfg
    join public.base_models m on m.id = cfg.base_model_id
    join public.options o on o.id = new.option_id
    join public.option_categories cat on cat.id = o.category_id
   where cfg.id = new.configuration_id;

  if not found then
    raise exception 'VALIDATION: Configurationまたは商品カテゴリーを確認できません'
      using errcode = 'P0001';
  end if;

  if not public.customer_category_selectable(v_model_slug, v_spec_code, v_category_code) then
    raise exception 'VALIDATION: このモデル・仕様ではカテゴリー「%」を選択できません', v_category_code
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

alter function public.enforce_configuration_item_customer_category() owner to postgres;
revoke all on function public.enforce_configuration_item_customer_category()
  from public, anon, authenticated, service_role;

drop trigger if exists configuration_items_customer_category_guard on public.configuration_items;
create trigger configuration_items_customer_category_guard
before insert or update of configuration_id, option_id on public.configuration_items
for each row execute function public.enforce_configuration_item_customer_category();

-- ---------- standard-estimate baseline ----------
-- baseline_option_ids自体は履歴・取込結果として書き換えない。
-- 差額計算時に、個別商品適合 + 本体分類表のカテゴリー可否を同時に適用する。

create or replace function public.estimate_baseline_master_section_total(
  p_template_id uuid,
  p_section text
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    (case when o.price_on_request then 0 else o.price end)
    * case when cat.code = 'exterior-wall' then 4 else 1 end
  ), 0)
  from public.estimate_templates t
  join public.base_models m on m.id = t.base_model_id
  join public.options o on o.id = any(t.baseline_option_ids)
  join public.option_categories cat on cat.id = o.category_id
  where t.id = p_template_id
    and o.status = 'published'
    and (o.base_model_id is null or o.base_model_id = t.base_model_id)
    and (
      cardinality(coalesce(o.spec_codes, '{}'::text[])) = 0
      or t.spec_code = any(o.spec_codes)
    )
    and public.customer_category_selectable(m.slug, t.spec_code, cat.code)
    and public.estimate_section_for_option(cat.code, o.is_installation) = p_section;
$$;

alter function public.estimate_baseline_master_section_total(uuid, text) owner to postgres;

-- ---------- postconditions ----------

do $$
begin
  if exists (
    select 1
      from public.option_categories
     where code in ('sash', 'entrance-door', 'service-door')
       and customer_visible is not true
  ) then
    raise exception 'POSTCONDITION: customer-facing opening category is still globally hidden';
  end if;

  if exists (
    select 1
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where o.code in ('door-glass', 'sash-lixil-prose-kamachi')
       and c.code <> 'entrance-door'
  ) then
    raise exception 'POSTCONDITION: entrance-door product classification is incomplete';
  end if;

  if exists (
    select 1
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where o.code in (
       'sash-door-katteguchi',
       'sash-door-katteguchi-koshi-panel',
       'sash-door-katteguchi-zen-panel'
     )
       and c.code <> 'service-door'
  ) then
    raise exception 'POSTCONDITION: service-door product classification is incomplete';
  end if;

  if public.customer_category_selectable('wing-01', 'room', 'sash')
     or not public.customer_category_selectable('wing-01', 'room', 'interior-door')
     or public.customer_category_selectable('wing-01', 'hotel', 'kitchen')
     or not public.customer_category_selectable('wing-01', 'residence', 'kitchen')
     or public.customer_category_selectable('box', 'storage', 'ub')
     or not public.customer_category_selectable('box', 'storage', 'sash')
     or public.customer_category_selectable('flat', 'office', 'toilet')
     or not public.customer_category_selectable('flat', 'office', 'sash')
  then
    raise exception 'POSTCONDITION: customer category matrix does not match the confirmed classification sheet';
  end if;
end;
$$;

commit;
