-- 本体分類表 1シート目の「モデル × 仕様 × 項目 = 選択 / ×」を
-- お客様向けカテゴリー可否へ反映する corrective。
--
-- 正本の分担:
--   * 本体分類表: 業務項目自体を選べるか（選択 / ×）
--   * option_categories.customer_visible: お客様画面へ公開し得るカテゴリーかという全体ゲート
--   * options.base_model_id / options.spec_codes: 個別商品のモデル・仕様適合
--
-- 分類表から個々のサッシ・窓位置・商品適合は推測しない。
-- 発行済み Quote / Revision / Snapshot / Configuration の保存値・金額は更新しない。
-- 既存 migration は編集せず、本 corrective は backlog の末尾で適用する。

-- ---------- preflight / fail closed ----------

do $$
declare
  v_code text;
begin
  -- 商品マスターが空の新規DB（CI・新規環境での全migration再現）には、是正対象のデータが存在しない。
  -- データ前提の検査は、商品マスターが投入済みの環境（本番）でだけ行う。本番の検査内容は変えない。
  if not exists (select 1 from public.options) then
    raise notice 'customer_spec_category_applicability: product master is empty, data preconditions skipped';
    return;
  end if;

  foreach v_code in array array['roof', 'exterior-wall', 'sash', 'interior-door', 'entrance-door', 'furniture']::text[]
  loop
    if not exists (
      select 1 from public.option_categories where code = v_code and status = 'published'
    ) then
      raise exception 'PRECONDITION: required published category % is missing', v_code;
    end if;
  end loop;

  foreach v_code in array array[
    'door-glass',
    'sash-lixil-prose-kamachi',
    'sash-door-katteguchi',
    'sash-door-katteguchi-koshi-panel',
    'sash-door-katteguchi-zen-panel',
    'shoe-box',
    'shoebox-daiken-ieria-low800',
    'shoebox-lixil-lasissa-s-low',
    'shoebox-pana-comporia-low',
    'hanger-pipe',
    'folding-bed',
    'interior-standard-box',
    'carpentry-box',
    'shower-unit-1116',
    'mini-kitchen'
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
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where o.code in (
       'shoe-box',
       'shoebox-daiken-ieria-low800',
       'shoebox-lixil-lasissa-s-low',
       'shoebox-pana-comporia-low'
     )
       and c.code not in ('furniture', 'entrance-storage')
  ) then
    raise exception 'PRECONDITION: an entrance-storage candidate belongs to an unexpected category';
  end if;

  if exists (
    select 1
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where o.code = 'hanger-pipe'
       and c.code not in ('furniture', 'closet')
  ) then
    raise exception 'PRECONDITION: hanger-pipe belongs to an unexpected category';
  end if;

  if exists (
    select 1
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where o.code = 'folding-bed'
       and c.code not in ('furniture', 'bed')
  ) then
    raise exception 'PRECONDITION: folding-bed belongs to an unexpected category';
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

  if coalesce((
    select sum(case when price_on_request then 0 else price end)
      from public.options
     where code in (
       'interior-standard-box',
       'carpentry-box',
       'shower-unit-1116',
       'mini-kitchen',
       'folding-bed'
     )
  ), -1) <> 1518904 then
    raise exception 'PRECONDITION: BOX hotel-single curated baseline master total changed; independent review required';
  end if;

  -- 他のmigration/手作業ですでに追加カテゴリーが作られている場合、意味が一致しなければ上書きしない。
  if exists (
    select 1
      from public.option_categories
     where code = 'service-door'
       and (
         name is distinct from '勝手口ドア'
         or selection_mode is distinct from 'single'
         or is_required is distinct from false
         or customer_visible is distinct from true
         or status is distinct from 'published'
         or finish_level is distinct from 'shell'
       )
  ) then
    raise exception 'PRECONDITION: existing service-door category has unexpected semantics';
  end if;

  if exists (
    select 1
      from public.option_categories
     where code = 'entrance-storage'
       and (
         name is distinct from '玄関収納'
         or selection_mode is distinct from 'multi'
         or is_required is distinct from false
         or customer_visible is distinct from true
         or status is distinct from 'published'
         or finish_level is distinct from 'equipment'
       )
  ) then
    raise exception 'PRECONDITION: existing entrance-storage category has unexpected semantics';
  end if;

  if exists (
    select 1
      from public.option_categories
     where code = 'closet'
       and (
         name is distinct from 'クローゼット'
         or selection_mode is distinct from 'multi'
         or is_required is distinct from false
         or customer_visible is distinct from true
         or status is distinct from 'published'
         or finish_level is distinct from 'equipment'
       )
  ) then
    raise exception 'PRECONDITION: existing closet category has unexpected semantics';
  end if;

  if exists (
    select 1
      from public.option_categories
     where code = 'bed'
       and (
         name is distinct from 'ベッド'
         or selection_mode is distinct from 'multi'
         or is_required is distinct from false
         or customer_visible is distinct from true
         or status is distinct from 'published'
         or finish_level is distinct from 'equipment'
       )
  ) then
    raise exception 'PRECONDITION: existing bed category has unexpected semantics';
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
values
  (
    'service-door',
    '勝手口ドア',
    '勝手口ドア。対象モデル・仕様で選択可能な場合に表示します',
    'single', false, true, 2, 'published', 'service-door', '建具・開口', 3, 'shell'
  ),
  (
    'entrance-storage',
    '玄関収納',
    '玄関収納。対象モデル・仕様で選択可能な場合に表示します',
    'multi', false, true, 1, 'published', 'furniture', '家具', 7, 'equipment'
  ),
  (
    'closet',
    'クローゼット',
    'クローゼット関連商品。対象モデル・仕様で選択可能な場合に表示します',
    'multi', false, true, 2, 'published', 'furniture', '家具', 7, 'equipment'
  ),
  (
    'bed',
    'ベッド',
    'ベッド。対象モデル・仕様で選択可能な場合に表示します',
    'multi', false, true, 3, 'published', 'furniture', '家具', 7, 'equipment'
  )
on conflict (code) do nothing;

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
  '個別商品を選択できる仕様コードのホワイトリスト。空配列は商品側では全仕様共通。hotel-single等のtechnical aliasを含む場合がある。カテゴリーの選択 / ×とは独立。';

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

update public.options
   set category_id = (select id from public.option_categories where code = 'entrance-storage')
 where code in (
   'shoe-box',
   'shoebox-daiken-ieria-low800',
   'shoebox-lixil-lasissa-s-low',
   'shoebox-pana-comporia-low'
 );

update public.options
   set category_id = (select id from public.option_categories where code = 'closet')
 where code = 'hanger-pipe';

update public.options
   set category_id = (select id from public.option_categories where code = 'bed')
 where code = 'folding-bed';

-- legacy aggregateのカテゴリー・価格・codeは履歴互換のため変えない。
-- ただし玄関ドアを含むという旧説明だけを、現在の分類責務に合わせて訂正する。
update public.options
   set description = '引違い窓・押出窓・縦辷り窓の標準一式。'
 where code = 'sash-standard'
   and description = '玄関ドア・引違い窓・押出窓・縦辷り窓の一式。';

-- BOX hotel-single は既存Standard Estimateのlegacy identity。
-- 商品適合は residence をtechnical aliasとして扱う。分類表から適合性を推測するのではなく、
-- 既に residence 適合と明示された商品にだけ alias を追加する。
-- これにより、既存save_configuration_atomic()のliteral spec_codes検証とも互換を保つ。
update public.options
   set spec_codes = array_append(spec_codes, 'hotel-single')
 where 'residence' = any(spec_codes)
   and not ('hotel-single' = any(spec_codes));

-- ---------- DB-side applicability helpers ----------

create or replace function public.customer_business_item_for_category(p_category_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_category_code
    when 'roof' then 'roof-exterior'
    when 'exterior-wall' then 'roof-exterior'
    when 'floor' then 'interior'
    when 'wall-ceiling' then 'interior'
    when 'carpentry' then 'interior'
    when 'entrance-door' then 'entrance-door'
    when 'sash' then 'sash'
    when 'service-door' then 'sash'
    when 'ub' then 'bath'
    when 'kitchen' then 'kitchen'
    when 'washbasin' then 'washbasin'
    when 'toilet' then 'toilet'
    when 'boiler' then 'boiler'
    when 'entrance-storage' then 'entrance-storage'
    when 'interior-door' then 'interior-door'
    when 'closet' then 'closet'
    when 'bed' then 'bed'
    when 'furniture' then 'furnishings'
    when 'appliances' then 'furnishings'
    when 'office-supplies' then 'furnishings'
    when 'aircon' then 'other'
    when 'lighting' then 'other'
    when 'smartlock' then 'other'
    when 'exterior-parts' then 'other'
    else null
  end;
$$;

alter function public.customer_business_item_for_category(text) owner to postgres;
revoke all on function public.customer_business_item_for_category(text)
  from public, anon, authenticated, service_role;

create or replace function public.customer_product_spec_selectable(
  p_model_slug text,
  p_spec_code text,
  p_product_spec_codes text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_spec_code is null then true
    when cardinality(coalesce(p_product_spec_codes, '{}'::text[])) = 0 then true
    when p_spec_code = any(coalesce(p_product_spec_codes, '{}'::text[])) then true
    when p_model_slug = 'box'
      and p_spec_code = 'hotel-single'
      and 'residence' = any(coalesce(p_product_spec_codes, '{}'::text[])) then true
    else false
  end;
$$;

alter function public.customer_product_spec_selectable(text, text, text[]) owner to postgres;
revoke all on function public.customer_product_spec_selectable(text, text, text[])
  from public, anon, authenticated, service_role;

-- 業務項目は15項目。給湯器（boiler）は独立した項目で、選択 / ×は UB/SWR（bath）と同じ可否とする。
-- UIだけではなく、新しく保存されるConfigurationでも本体分類表の × を拒否する。
-- 未知のmodel/specは、確定表にない業務項目を勝手に公開しないためfail closed。
-- spec_code NULLは既存non-draft履歴の読取互換だけを残し、draft保存は後段triggerで拒否する。
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
    when public.customer_business_item_for_category(p_category_code) is null then true
    when p_spec_code is null then true
    else coalesce((
      select public.customer_business_item_for_category(p_category_code) = any(v.business_items)
      from (values
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
      ) as v(model_slug, spec_code, business_items)
      where v.model_slug = p_model_slug and v.spec_code = p_spec_code
    ), false)
  end;
$$;

alter function public.customer_category_selectable(text, text, text) owner to postgres;
revoke all on function public.customer_category_selectable(text, text, text)
  from public, anon, authenticated, service_role;

-- ---------- Configuration guards ----------

-- Configuration item単体の直接DMLでも、商品側適合と分類表の×を迂回させない。
create or replace function public.enforce_configuration_item_customer_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model_id uuid;
  v_model_slug text;
  v_spec_code text;
  v_status text;
  v_category_code text;
  v_option_model_id uuid;
  v_option_spec_codes text[];
begin
  select m.id, m.slug, cfg.spec_code, cfg.status, cat.code, o.base_model_id, coalesce(o.spec_codes, '{}'::text[])
    into v_model_id, v_model_slug, v_spec_code, v_status, v_category_code, v_option_model_id, v_option_spec_codes
    from public.configurations cfg
    join public.base_models m on m.id = cfg.base_model_id
    join public.options o on o.id = new.option_id
    join public.option_categories cat on cat.id = o.category_id
   where cfg.id = new.configuration_id;

  if not found then
    raise exception 'VALIDATION: Configurationまたは商品カテゴリーを確認できません'
      using errcode = 'P0001';
  end if;

  if v_status = 'draft' and v_spec_code is null then
    raise exception 'VALIDATION: 編集可能なConfigurationには仕様を指定してください'
      using errcode = 'P0001';
  end if;

  if v_option_model_id is not null and v_option_model_id <> v_model_id then
    raise exception 'VALIDATION: この商品は選択中のモデルでは使用できません'
      using errcode = 'P0001';
  end if;

  if not public.customer_product_spec_selectable(v_model_slug, v_spec_code, v_option_spec_codes) then
    raise exception 'VALIDATION: この商品は選択中の仕様では使用できません'
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

-- Configuration側のspec/model/statusだけを変更して既存itemsを不整合にする経路も、
-- transaction終端でfinal stateを検証して拒否する。save_configuration_atomicの
-- 「header更新→items入替」を妨げないようDEFERRABLEにする。
create or replace function public.enforce_configuration_customer_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model_slug text;
  v_bad record;
begin
  if new.status = 'draft' and new.spec_code is null then
    raise exception 'VALIDATION: 編集可能なConfigurationには仕様を指定してください'
      using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE'
     and new.base_model_id is not distinct from old.base_model_id
     and new.spec_code is not distinct from old.spec_code
     and new.status is not distinct from old.status then
    return new;
  end if;

  select m.slug into v_model_slug
    from public.base_models m
   where m.id = new.base_model_id;

  if v_model_slug is null then
    raise exception 'VALIDATION: Configurationのモデルを確認できません'
      using errcode = 'P0001';
  end if;

  select o.code as option_code, cat.code as category_code
    into v_bad
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
   where ci.configuration_id = new.id
     and (
       (o.base_model_id is not null and o.base_model_id <> new.base_model_id)
       or not public.customer_product_spec_selectable(v_model_slug, new.spec_code, coalesce(o.spec_codes, '{}'::text[]))
       or not public.customer_category_selectable(v_model_slug, new.spec_code, cat.code)
     )
   limit 1;

  if found then
    raise exception 'VALIDATION: 仕様変更後に選択不可の商品 %（カテゴリー %）が残っています',
      v_bad.option_code, v_bad.category_code
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

alter function public.enforce_configuration_customer_categories() owner to postgres;
revoke all on function public.enforce_configuration_customer_categories()
  from public, anon, authenticated, service_role;

drop trigger if exists configurations_customer_category_guard on public.configurations;
create constraint trigger configurations_customer_category_guard
after insert or update on public.configurations
deferrable initially deferred
for each row execute function public.enforce_configuration_customer_categories();

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
    and public.customer_product_spec_selectable(m.slug, t.spec_code, coalesce(o.spec_codes, '{}'::text[]))
    and public.customer_category_selectable(m.slug, t.spec_code, cat.code)
    and public.estimate_section_for_option(cat.code, o.is_installation) = p_section;
$$;

alter function public.estimate_baseline_master_section_total(uuid, text) owner to postgres;
revoke all on function public.estimate_baseline_master_section_total(uuid, text)
  from public, anon, authenticated, service_role;

-- ---------- postconditions ----------

do $$
begin
  if exists (
    select 1
      from public.option_categories
     where code in ('sash', 'entrance-door', 'service-door', 'entrance-storage', 'closet', 'bed')
       and customer_visible is not true
  ) then
    raise exception 'POSTCONDITION: a customer-facing category is still globally hidden';
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

  if exists (
    select 1
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where o.code in (
       'shoe-box',
       'shoebox-daiken-ieria-low800',
       'shoebox-lixil-lasissa-s-low',
       'shoebox-pana-comporia-low'
     )
       and c.code <> 'entrance-storage'
  ) then
    raise exception 'POSTCONDITION: entrance-storage classification is incomplete';
  end if;

  if exists (
    select 1
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where o.code = 'hanger-pipe' and c.code <> 'closet'
  ) then
    raise exception 'POSTCONDITION: closet classification is incomplete';
  end if;

  if exists (
    select 1
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where o.code = 'folding-bed' and c.code <> 'bed'
  ) then
    raise exception 'POSTCONDITION: bed classification is incomplete';
  end if;

  if exists (
    select 1 from public.options
     where 'residence' = any(spec_codes)
       and not ('hotel-single' = any(spec_codes))
  ) then
    raise exception 'POSTCONDITION: hotel-single technical aliases are incomplete';
  end if;

  if not public.customer_product_spec_selectable('box', 'hotel-single', array['residence']::text[])
     or not public.customer_product_spec_selectable('box', 'hotel-single', array['hotel-single']::text[])
     or public.customer_product_spec_selectable('box', 'hotel-single', array['hotel']::text[])
  then
    raise exception 'POSTCONDITION: hotel-single product compatibility resolver is incorrect';
  end if;

  -- 商品マスターが空の新規DBでは検算対象が存在しない（preflight と同じ扱い）
  if exists (select 1 from public.options)
     and coalesce((
    select sum(case when price_on_request then 0 else price end)
      from public.options
     where code in (
       'interior-standard-box',
       'carpentry-box',
       'shower-unit-1116',
       'mini-kitchen',
       'folding-bed'
     )
  ), -1) <> 1518904 then
    raise exception 'POSTCONDITION: BOX hotel-single curated baseline master total changed';
  end if;

  if public.customer_category_selectable('wing-01', 'room', 'sash')
     or not public.customer_category_selectable('wing-01', 'room', 'interior-door')
     or public.customer_category_selectable('wing-01', 'room', 'entrance-storage')
     or not public.customer_category_selectable('wing-01', 'room', 'closet')
     or not public.customer_category_selectable('wing-01', 'room', 'bed')
     or public.customer_category_selectable('wing-01', 'hotel', 'kitchen')
     or not public.customer_category_selectable('wing-01', 'hotel', 'entrance-storage')
     or not public.customer_category_selectable('wing-01', 'residence', 'kitchen')
     or public.customer_category_selectable('wing-01', 'office', 'bed')
     or public.customer_category_selectable('box', 'water-kit', 'furniture')
     or public.customer_category_selectable('box', 'storage', 'ub')
     or not public.customer_category_selectable('box', 'storage', 'sash')
     or public.customer_category_selectable('flat', 'office', 'toilet')
     or public.customer_category_selectable('flat', 'office', 'lighting')
     or not public.customer_category_selectable('flat', 'office', 'sash')
     or not public.customer_category_selectable('wing-01', 'base', 'sash')
  then
    raise exception 'POSTCONDITION: customer category matrix does not match the confirmed classification sheet / compatibility rows';
  end if;

  -- 確定仕様（2026-10-07）：業務項目は15項目、給湯器は独立項目
  if public.customer_business_item_for_category('boiler') is distinct from 'boiler'
     or (
       select count(distinct public.customer_business_item_for_category(c.code))
         from unnest(array[
           'roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash','service-door',
           'ub','kitchen','washbasin','toilet','boiler','entrance-storage','interior-door','closet','bed',
           'furniture','appliances','office-supplies','aircon','lighting','smartlock','exterior-parts'
         ]::text[]) as c(code)
     ) <> 15
  then
    raise exception 'POSTCONDITION: customer business items must be 15 with boiler as an independent item';
  end if;

  -- 給湯器の選択 / ×は、全てのモデル・仕様行で UB/SWR と同じ
  if exists (
    select 1
      from (values
        ('wing-01', 'base'), ('wing-01', 'hotel'), ('wing-01', 'residence'), ('wing-01', 'room'), ('wing-01', 'office'),
        ('box', 'base'), ('box', 'hotel'), ('box', 'residence'), ('box', 'room'), ('box', 'office'),
        ('box', 'hotel-single'), ('box', 'water-kit'), ('box', 'storage'),
        ('flat', 'base'), ('flat', 'office')
      ) as r(model_slug, spec_code)
     where public.customer_category_selectable(r.model_slug, r.spec_code, 'boiler')
           is distinct from public.customer_category_selectable(r.model_slug, r.spec_code, 'ub')
  ) then
    raise exception 'POSTCONDITION: boiler selectability must equal UB/SWR on every model/spec row';
  end if;

  if not public.customer_category_selectable('wing-01', 'hotel', 'boiler')
     or public.customer_category_selectable('wing-01', 'room', 'boiler')
     or not public.customer_category_selectable('wing-01', 'room', 'aircon')
     or not public.customer_category_selectable('box', 'water-kit', 'boiler')
     or public.customer_category_selectable('box', 'water-kit', 'aircon')
     or public.customer_category_selectable('box', 'storage', 'boiler')
     or public.customer_category_selectable('flat', 'office', 'boiler')
  then
    raise exception 'POSTCONDITION: boiler must follow UB/SWR and must not follow the other-items column';
  end if;
end;
$$;