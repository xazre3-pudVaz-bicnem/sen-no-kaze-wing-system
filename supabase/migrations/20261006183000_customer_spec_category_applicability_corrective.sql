-- 本体分類表の「選択 / ×」を既存の商品マスター構造で保証する corrective。
--
-- 正本の分担:
--   * option_categories.customer_visible = お客様画面へカテゴリーを公開するかという全体スイッチ
--   * options.base_model_id              = 対象モデル
--   * options.spec_codes                 = 対象仕様（空配列は全仕様共通）
--
-- この migration は商品候補・カテゴリー分類・標準見積の差額基準だけを整合させる。
-- 発行済み Quote / Revision / Snapshot / Configuration の保存値や金額は更新しない。
-- 既存 migration は編集せず、本 corrective を migration backlog の末尾で適用する。

begin;

-- ---------- preflight / fail closed ----------

do $$
begin
  if not exists (select 1 from public.option_categories where code = 'sash') then
    raise exception 'PRECONDITION: sash category is missing';
  end if;
  if not exists (select 1 from public.option_categories where code = 'interior-door') then
    raise exception 'PRECONDITION: interior-door category is missing';
  end if;
  if not exists (select 1 from public.option_categories where code = 'entrance-door') then
    raise exception 'PRECONDITION: entrance-door category is missing; apply 20260924092000 first';
  end if;

  if exists (
    select 1
      from public.option_categories
     where id = '20000000-0000-4000-8000-000000000025'::uuid
       and code <> 'service-door'
  ) then
    raise exception 'PRECONDITION: category UUID ...0025 is already used by another category';
  end if;

  if (
    select count(*)
      from public.options
     where code in (
       'door-glass',
       'sash-lixil-prose-kamachi',
       'sash-door-katteguchi',
       'sash-door-katteguchi-koshi-panel',
       'sash-door-katteguchi-zen-panel'
     )
  ) <> 5 then
    raise exception 'PRECONDITION: expected entrance/service door product set is incomplete';
  end if;

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
    raise exception 'PRECONDITION: service-door candidate belongs to an unexpected category';
  end if;
end;
$$;

-- ---------- category semantics ----------

insert into public.option_categories (
  id,
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
  '20000000-0000-4000-8000-000000000025'::uuid,
  'service-door',
  '勝手口ドア',
  '勝手口ドア。対象モデル・仕様で使用する場合に1つ選択します',
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
       description = 'サッシ・窓。対象モデル・仕様で選択可能な場合にお客様画面へ表示します'
 where code = 'sash';

update public.option_categories
   set customer_visible = true,
       description = '玄関ドア。対象モデル・仕様で使用する場合に1つ選択します'
 where code = 'entrance-door';

comment on column public.option_categories.customer_visible is
  'お客様画面にカテゴリーを公開する全体スイッチ。モデル・仕様別の選択可否は options.base_model_id / options.spec_codes で判定する。';

comment on column public.options.spec_codes is
  '商品を選択できる仕様コードのホワイトリスト。空配列は全仕様共通。カテゴリー公開可否とは独立。';

-- ---------- product classification ----------
-- 既存発行履歴を持つ sash-standard / door-standard は code・category・価格を変更しない。
-- 明示的に意味を判定でき、production 参照がないことを事前監査した商品だけを再分類する。

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

-- ---------- spec applicability ----------
-- 本体分類表の確定行列:
--   玄関ドア / サッシ / 勝手口: room は ×、その他の現行・確定対象仕様は選択。
--   室内建具: hotel / residence / room / BOX hotel-single は選択、office / water-kit / storage は ×。
-- base はシミュレーターの「本体のみ」互換仕様。shell の建具候補は選択可能とする。
--
-- 既に空でない spec_codes は、確定ホワイトリストの部分集合ならその狭い指定を尊重する。
-- 確定範囲外を含む場合は勝手に交差集合へ直さず fail closed する。

do $$
declare
  r record;
  allowed text[];
begin
  for r in
    select o.id, o.code, o.spec_codes, c.code as category_code
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where c.code in ('entrance-door', 'service-door', 'sash', 'interior-door')
  loop
    allowed := case
      when r.category_code in ('entrance-door', 'service-door', 'sash') then
        array['base', 'hotel', 'residence', 'office', 'hotel-single', 'water-kit', 'storage']::text[]
      when r.category_code = 'interior-door' then
        array['hotel', 'residence', 'room', 'hotel-single']::text[]
      else '{}'::text[]
    end;

    if cardinality(coalesce(r.spec_codes, '{}'::text[])) = 0 then
      update public.options
         set spec_codes = allowed
       where id = r.id;
    elsif not (r.spec_codes <@ allowed) then
      raise exception 'PRECONDITION: option % has spec_codes outside confirmed matrix: %', r.code, r.spec_codes;
    end if;
  end loop;
end;
$$;

-- ---------- standard-estimate baseline integrity ----------
-- baseline_option_ids は標準価格そのものではなく商品マスター差額の基準。
-- spec_codes で選択不可になった商品を baseline に残すと、UI と DB 再計算で偽の差額が出るため、
-- 既存 baseline と今後の Excel 再取込の双方を同じ eligibility で絞る。

update public.estimate_templates t
   set baseline_option_ids = coalesce((
     select array_agg(o.id order by o.sort_order, o.id)
       from unnest(coalesce(t.baseline_option_ids, '{}'::uuid[])) input(option_id)
       join public.options o on o.id = input.option_id
      where o.status = 'published'
        and (o.base_model_id is null or o.base_model_id = t.base_model_id)
        and (
          cardinality(coalesce(o.spec_codes, '{}'::text[])) = 0
          or t.spec_code = any(o.spec_codes)
        )
   ), '{}'::uuid[])
 where coalesce(t.baseline_option_ids, '{}'::uuid[]) is distinct from coalesce((
     select array_agg(o.id order by o.sort_order, o.id)
       from unnest(coalesce(t.baseline_option_ids, '{}'::uuid[])) input(option_id)
       join public.options o on o.id = input.option_id
      where o.status = 'published'
        and (o.base_model_id is null or o.base_model_id = t.base_model_id)
        and (
          cardinality(coalesce(o.spec_codes, '{}'::text[])) = 0
          or t.spec_code = any(o.spec_codes)
        )
   ), '{}'::uuid[]);

create or replace function public.replace_estimate_templates_with_baselines(p_templates jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t jsonb;
begin
  perform public.replace_estimate_templates(p_templates);

  for t in
    select value from jsonb_array_elements(coalesce(p_templates, '[]'::jsonb))
  loop
    update public.estimate_templates et
       set baseline_option_ids = coalesce((
         select array_agg(o.id order by o.sort_order, o.id)
           from jsonb_array_elements_text(coalesce(t -> 'baseline_option_ids', '[]'::jsonb)) input(value)
           join public.options o on o.id = input.value::uuid
          where o.status = 'published'
            and (o.base_model_id is null or o.base_model_id = et.base_model_id)
            and (
              cardinality(coalesce(o.spec_codes, '{}'::text[])) = 0
              or et.spec_code = any(o.spec_codes)
            )
       ), '{}'::uuid[])
     where et.base_model_id = (t ->> 'base_model_id')::uuid
       and et.spec_code = t ->> 'spec_code';
  end loop;
end;
$$;

create or replace function public.estimate_baseline_master_section_total(
  p_template_id uuid,
  p_section text
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    (case when o.price_on_request then 0 else o.price end)
    * case when cat.code = 'exterior-wall' then 4 else 1 end
  ), 0)
  from public.estimate_templates t
  join public.options o on o.id = any(t.baseline_option_ids)
  join public.option_categories cat on cat.id = o.category_id
  where t.id = p_template_id
    and o.status = 'published'
    and (o.base_model_id is null or o.base_model_id = t.base_model_id)
    and (
      cardinality(coalesce(o.spec_codes, '{}'::text[])) = 0
      or t.spec_code = any(o.spec_codes)
    )
    and public.estimate_section_for_option(cat.code, o.is_installation) = p_section;
$$;

-- ---------- postcondition ----------

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
     where c.code in ('entrance-door', 'service-door', 'sash')
       and 'room' = any(coalesce(o.spec_codes, '{}'::text[]))
  ) then
    raise exception 'POSTCONDITION: room must not expose entrance/service/sash products';
  end if;

  if exists (
    select 1
      from public.options o
      join public.option_categories c on c.id = o.category_id
     where c.code = 'interior-door'
       and coalesce(o.spec_codes, '{}'::text[]) && array['office', 'water-kit', 'storage', 'base']::text[]
  ) then
    raise exception 'POSTCONDITION: interior-door contains a spec confirmed as ×';
  end if;
end;
$$;

commit;
