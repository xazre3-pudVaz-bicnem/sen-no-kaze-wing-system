-- =============================================================
-- Production compatibility / security corrective
--
-- 前提:
--   production は 20260829040000 まで適用済み。
--   その後の main migration をすべて順番に適用した直後に、本 migration を適用する。
--
-- 目的:
--   1. 既存 Wing Draft の required 断熱を、金額を触らず互換補完する
--   2. 既存の1商品外壁を、同一商品・同一variantのまま4面へ互換展開する
--   3. SECURITY DEFINER の search_path / EXECUTE ACL を最小権限化する
--   4. Quote Revision を issued のみに限定する
--
-- Quote / quote_items の既存行、Configuration の金額列は更新しない。
-- =============================================================

begin;

-- -----------------------------------------------------------------
-- 1. Wing既存Draft: required断熱の互換補完
-- -----------------------------------------------------------------

-- Wing 本体の identity が想定どおりでなければ、誤ったモデルへ補完しない。
do $$
begin
  if not exists (
    select 1
      from public.base_models b
     where b.id = '10000000-0000-4000-8000-000000000001'::uuid
       and b.slug = 'wing-01'
  ) then
    raise exception 'MIGRATION_GUARD: Wing base model identity is not the expected wing-01';
  end if;
end
$$;

-- 補完に使う標準断熱 option が、適用後DBで安全な0円標準として存在することを先に検証する。
-- category 自体も published / required を要求する。
do $$
declare
  v_invalid text;
begin
  with expected(option_code, category_code, required_spec_codes) as (
    values
      ('insulation-floor-mirafoam-90', 'insulation-floor', '{}'::text[]),
      ('insulation-wall-styrofoam-90-hotel-base', 'insulation-wall', array['hotel']::text[]),
      ('insulation-wall-glasswool-90-standard', 'insulation-wall', array['residence','office']::text[]),
      ('insulation-ceiling-styrofoam-90-hotel-base', 'insulation-ceiling', array['hotel']::text[]),
      ('insulation-ceiling-glasswool-90-standard', 'insulation-ceiling', array['residence','office']::text[])
  ),
  invalid as (
    select e.option_code
      from expected e
     where not exists (
       select 1
         from public.options o
         join public.option_categories c on c.id = o.category_id
        where o.code = e.option_code
          and o.status = 'published'
          and o.price = 0
          and o.price_on_request = false
          and c.code = e.category_code
          and c.status = 'published'
          and c.is_required = true
          and (o.base_model_id is null or o.base_model_id = '10000000-0000-4000-8000-000000000001'::uuid)
          and (
            cardinality(e.required_spec_codes) = 0
            or o.spec_codes @> e.required_spec_codes
          )
     )
  )
  select string_agg(option_code, ', ' order by option_code)
    into v_invalid
    from invalid;

  if v_invalid is not null then
    raise exception 'MIGRATION_GUARD: standard Wing insulation option is missing or unsafe: %', v_invalid;
  end if;
end
$$;

-- 未知 spec の Draft に必要断熱が欠けている場合、勝手に hotel 等へ読み替えず停止する。
-- null だけは現行UI互換として hotel fallback を許可する。
do $$
declare
  v_count integer;
begin
  select count(*)
    into v_count
    from public.configurations cfg
   where cfg.base_model_id = '10000000-0000-4000-8000-000000000001'::uuid
     and cfg.status = 'draft'
     and cfg.spec_code is not null
     and cfg.spec_code not in ('hotel', 'residence', 'office')
     and exists (
       select 1
         from (values ('insulation-floor'), ('insulation-wall'), ('insulation-ceiling')) as required(category_code)
        where not exists (
          select 1
            from public.configuration_items ci
            join public.options o on o.id = ci.option_id
            join public.option_categories c on c.id = o.category_id
           where ci.configuration_id = cfg.id
             and c.code = required.category_code
        )
     );

  if v_count > 0 then
    raise exception 'MIGRATION_GUARD: % Wing draft configuration(s) have an unsupported spec_code and missing required insulation', v_count;
  end if;
end
$$;

-- 既存Draftに、そのcategoryの商品が1件もない場合だけ標準0円optionを追加する。
-- configuration の金額列・spec_codeは変更せず、recalculate_configuration() も呼ばない。
insert into public.configuration_items (configuration_id, option_id, quantity)
select
  cfg.id,
  standard_option.id,
  1
from public.configurations cfg
cross join lateral (
  values
    ('insulation-floor'::text, 'insulation-floor-mirafoam-90'::text),
    (
      'insulation-wall'::text,
      case coalesce(cfg.spec_code, 'hotel')
        when 'hotel' then 'insulation-wall-styrofoam-90-hotel-base'
        when 'residence' then 'insulation-wall-glasswool-90-standard'
        when 'office' then 'insulation-wall-glasswool-90-standard'
        else null
      end
    ),
    (
      'insulation-ceiling'::text,
      case coalesce(cfg.spec_code, 'hotel')
        when 'hotel' then 'insulation-ceiling-styrofoam-90-hotel-base'
        when 'residence' then 'insulation-ceiling-glasswool-90-standard'
        when 'office' then 'insulation-ceiling-glasswool-90-standard'
        else null
      end
    )
) as wanted(category_code, option_code)
join public.options standard_option
  on standard_option.code = wanted.option_code
where cfg.base_model_id = '10000000-0000-4000-8000-000000000001'::uuid
  and cfg.status = 'draft'
  and wanted.option_code is not null
  and not exists (
    select 1
      from public.configuration_items existing_item
      join public.options existing_option on existing_option.id = existing_item.option_id
      join public.option_categories existing_category on existing_category.id = existing_option.category_id
     where existing_item.configuration_id = cfg.id
       and existing_category.code = wanted.category_code
  )
on conflict (configuration_id, option_id) do nothing;

-- -----------------------------------------------------------------
-- 2. 既存外壁1商品 -> 4面互換
-- -----------------------------------------------------------------

-- backfill対象は「exterior_facesが空」かつ「configuration_itemsの外壁がちょうど1件」。
-- その保存済みoption + variantの実効数値価格が0円でないものが1件でもあれば、
-- 自動4面化は行わず migration 全体を停止する。
do $$
declare
  v_nonzero_count integer;
begin
  with wall_items as (
    select
      ci.configuration_id,
      ci.option_id,
      ci.variant_choice_ids,
      count(*) over (partition by ci.configuration_id) as wall_count
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories c on c.id = o.category_id
    where c.code = 'exterior-wall'
  ),
  targets as (
    select
      cfg.id as configuration_id,
      wi.option_id,
      wi.variant_choice_ids
    from public.configurations cfg
    join wall_items wi
      on wi.configuration_id = cfg.id
     and wi.wall_count = 1
    where coalesce(cfg.exterior_faces, '[]'::jsonb) = '[]'::jsonb
  )
  select count(*)
    into v_nonzero_count
    from targets t
    join public.options o on o.id = t.option_id
    left join lateral (
      select coalesce(sum(
        case when vc.price_on_request then 0 else vc.extra_price end
      ), 0)::numeric as variant_extra
      from unnest(coalesce(t.variant_choice_ids, '{}'::uuid[])) as selected(choice_id)
      join public.option_variant_choices vc on vc.id = selected.choice_id
      join public.option_variant_groups vg
        on vg.id = vc.group_id
       and vg.option_id = t.option_id
    ) v on true
   where (
     case when o.price_on_request then 0 else o.price end
     + coalesce(v.variant_extra, 0)
   ) <> 0;

  if v_nonzero_count > 0 then
    raise exception 'MIGRATION_GUARD: % legacy exterior-wall configuration(s) have non-zero effective price; 4-face backfill aborted', v_nonzero_count;
  end if;
end
$$;

-- 代表行は削除せず、同じoption_id / variant_choice_idsを4面へ複製する。
-- exterior_faces が空のものだけが対象なので再実行時は0件になる。
with wall_items as (
  select
    ci.configuration_id,
    ci.option_id,
    ci.variant_choice_ids,
    count(*) over (partition by ci.configuration_id) as wall_count
  from public.configuration_items ci
  join public.options o on o.id = ci.option_id
  join public.option_categories c on c.id = o.category_id
  where c.code = 'exterior-wall'
),
targets as (
  select
    cfg.id as configuration_id,
    wi.option_id,
    wi.variant_choice_ids
  from public.configurations cfg
  join wall_items wi
    on wi.configuration_id = cfg.id
   and wi.wall_count = 1
  where coalesce(cfg.exterior_faces, '[]'::jsonb) = '[]'::jsonb
)
update public.configurations cfg
   set exterior_faces = jsonb_build_array(
     jsonb_build_object(
       'face_code', 'front',
       'option_id', t.option_id::text,
       'variant_choice_ids', coalesce(to_jsonb(t.variant_choice_ids), '[]'::jsonb)
     ),
     jsonb_build_object(
       'face_code', 'right',
       'option_id', t.option_id::text,
       'variant_choice_ids', coalesce(to_jsonb(t.variant_choice_ids), '[]'::jsonb)
     ),
     jsonb_build_object(
       'face_code', 'back',
       'option_id', t.option_id::text,
       'variant_choice_ids', coalesce(to_jsonb(t.variant_choice_ids), '[]'::jsonb)
     ),
     jsonb_build_object(
       'face_code', 'left',
       'option_id', t.option_id::text,
       'variant_choice_ids', coalesce(to_jsonb(t.variant_choice_ids), '[]'::jsonb)
     )
   )
  from targets t
 where cfg.id = t.configuration_id
   and coalesce(cfg.exterior_faces, '[]'::jsonb) = '[]'::jsonb;

-- -----------------------------------------------------------------
-- 3. SECURITY DEFINER hardening
-- -----------------------------------------------------------------

-- Excel取込の公開wrapper自身でも権限を検証する。
create or replace function public.replace_estimate_templates_with_baselines(p_templates jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t jsonb;
begin
  if not public.can_edit_catalog() then
    raise exception 'FORBIDDEN: 標準見積を更新する権限がありません' using errcode = '42501';
  end if;

  perform public.replace_estimate_templates(p_templates);

  for t in
    select value from jsonb_array_elements(coalesce(p_templates, '[]'::jsonb))
  loop
    update public.estimate_templates
       set baseline_option_ids = coalesce((
         select array_agg(value::uuid)
           from jsonb_array_elements_text(coalesce(t -> 'baseline_option_ids', '[]'::jsonb))
       ), '{}')
     where base_model_id = (t ->> 'base_model_id')::uuid
       and spec_code = t ->> 'spec_code';
  end loop;
end;
$$;

-- 内部helper / 外部RPCの定義本体はschema-qualified済みなので、runtime search_pathを空に固定する。
alter function public.replace_estimate_templates(jsonb) set search_path = '';
alter function public.configuration_master_section_total(uuid, text) set search_path = '';
alter function public.estimate_baseline_master_section_total(uuid, text) set search_path = '';
alter function public.recalculate_configuration(uuid) set search_path = '';
alter function public.create_quote_from_configuration(uuid, jsonb, text) set search_path = '';
alter function public.respond_to_quote(uuid, text) set search_path = '';

-- -----------------------------------------------------------------
-- 4. Quote Revision lifecycle: issued のみ改訂可能
-- -----------------------------------------------------------------

create or replace function public.create_quote_revision(
  p_quote_id uuid,
  p_items jsonb,
  p_dealer_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.quotes;
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  v_can_any boolean;
  v_can_edit_base boolean;
  v_new uuid;
  v_base integer := 0;
  v_base_exp integer := 0;
  v_int integer := 0;
  v_int_exp integer := 0;
  v_opt integer := 0;
  v_opt_exp integer := 0;
  v_inst integer := 0;
  v_sub_raw integer;
  v_sub integer;
  v_tax integer;
  v_sort integer := 0;
  r jsonb;
  v_kind text;
  v_qty numeric;
  v_amount integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  -- respond_to_quote() も同じ quotes 行を FOR UPDATE する。
  -- 先にlockを取得した側だけが issued を見られ、後続側はstatus変化を見て拒否される。
  select * into parent
    from public.quotes
   where id = p_quote_id
   for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_can_any := v_rank >= 2;
  v_can_edit_base := v_rank >= 2;

  if not (v_can_any or (v_rank >= 1 and parent.dealer_id = v_uid)) then
    raise exception 'FORBIDDEN: この見積を編集できる権限がありません' using errcode = '42501';
  end if;

  -- allowlist: issued 以外（accepted / declined / expired / cancelled /
  -- superseded / 将来追加される未知status）はすべて拒否する。
  if parent.status <> 'issued' then
    raise exception 'LOCKED: 改訂できるのは発行中（issued）の見積だけです' using errcode = 'P0001';
  end if;

  if v_rank < 1 then
    raise exception 'FORBIDDEN: 見積を編集できるのは代理店以上です' using errcode = '42501';
  end if;

  for r in
    select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_kind := r ->> 'kind';
    if v_kind not in (
      'base', 'base_expense',
      'interior_exterior', 'interior_exterior_expense',
      'option', 'option_expense',
      'installation', 'free'
    ) then
      raise exception 'VALIDATION: 区分の指定が不正です（%）', v_kind using errcode = 'P0001';
    end if;
    if not v_can_edit_base and v_kind in ('base', 'base_expense') then
      raise exception 'FORBIDDEN: 本体を編集できるのは総代理店・本部だけです' using errcode = '42501';
    end if;

    v_qty := greatest(coalesce((r ->> 'quantity')::numeric, 1), 0.01);
    v_amount := round(coalesce((r ->> 'unit_price')::numeric, 0) * v_qty)::integer;
    if v_amount < 0 and coalesce(r ->> 'name', '') <> '選択商品の変更差額' then
      raise exception 'VALIDATION: 通常明細の金額は0円以上で入力してください' using errcode = 'P0001';
    end if;

    if v_kind = 'base' then
      v_base := v_base + v_amount;
    elsif v_kind = 'base_expense' then
      v_base_exp := v_base_exp + v_amount;
    elsif v_kind = 'interior_exterior' then
      v_int := v_int + v_amount;
    elsif v_kind = 'interior_exterior_expense' then
      v_int_exp := v_int_exp + v_amount;
    elsif v_kind = 'option' then
      v_opt := v_opt + v_amount;
    elsif v_kind = 'option_expense' then
      v_opt_exp := v_opt_exp + v_amount;
    else
      v_inst := v_inst + v_amount;
    end if;
  end loop;

  if not v_can_edit_base then
    v_base := parent.base_price;
    v_base_exp := parent.base_expense;
  end if;

  v_sub_raw := v_base + v_base_exp + v_int + v_int_exp + v_opt + v_opt_exp + v_inst;
  v_sub := floor(v_sub_raw / 1000.0)::integer * 1000;
  v_tax := floor(v_sub * parent.tax_rate)::integer;

  insert into public.quotes(
    quote_no, quote_request_id, configuration_id, user_id, status, issued_at, valid_until,
    customer_no, customer_name, customer_company, base_model_name, finish_level,
    base_price, base_expense, option_subtotal, option_expense, installation_subtotal, adjustment,
    subtotal, tax_rate, tax, total, preview_image_url, notes,
    dealer_id, dealer_note, revision, parent_quote_id
  )
  values(
    parent.quote_no || '-' || (parent.revision + 1), parent.quote_request_id,
    parent.configuration_id, parent.user_id, 'issued', now(), now() + interval '30 days',
    parent.customer_no, parent.customer_name, parent.customer_company, parent.base_model_name,
    parent.finish_level,
    v_base, v_base_exp, v_int + v_opt, v_int_exp + v_opt_exp, v_inst,
    v_sub - v_sub_raw, v_sub, parent.tax_rate, v_tax, v_sub + v_tax,
    parent.preview_image_url,
    '本見積書は標準見積を基に、担当者が案件内容を反映して作成した確定見積です。',
    coalesce(parent.dealer_id, case when v_rank = 1 then v_uid else null end),
    p_dealer_note, parent.revision + 1, parent.id
  )
  returning id into v_new;

  if not v_can_edit_base then
    insert into public.quote_items(
      quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, image_url, sort_order
    )
    select
      v_new, kind, name, description, unit, remark, unit_price, quantity, amount, image_url, sort_order
      from public.quote_items
     where quote_id = parent.id
       and kind in ('base', 'base_expense');

    select coalesce(max(sort_order), 0)
      into v_sort
      from public.quote_items
     where quote_id = v_new;
  end if;

  for r in
    select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if not v_can_edit_base and (r ->> 'kind') in ('base', 'base_expense') then
      continue;
    end if;

    v_sort := v_sort + 1;
    v_qty := greatest(coalesce((r ->> 'quantity')::numeric, 1), 0.01);

    insert into public.quote_items(
      quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, image_url, sort_order
    )
    values(
      v_new,
      r ->> 'kind',
      coalesce(nullif(r ->> 'name', ''), '（名称未設定）'),
      nullif(r ->> 'description', ''),
      coalesce(nullif(r ->> 'unit', ''), '式'),
      nullif(r ->> 'remark', ''),
      round(coalesce((r ->> 'unit_price')::numeric, 0))::integer,
      v_qty,
      round(coalesce((r ->> 'unit_price')::numeric, 0) * v_qty)::integer,
      nullif(r ->> 'image_url', ''),
      v_sort
    );
  end loop;

  update public.quotes
     set status = 'superseded'
   where id = parent.id;

  update public.quote_requests
     set quote_id = v_new,
         status = 'sent'
   where id = parent.quote_request_id;

  return v_new;
end;
$$;

-- ---------- EXECUTE ACL ----------
-- まず全対象を PUBLIC / API roles / service_role から剥がし、外部RPCだけauthenticatedへ戻す。

revoke execute on function public.replace_estimate_templates(jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.replace_estimate_templates_with_baselines(jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.configuration_master_section_total(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.estimate_baseline_master_section_total(uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.recalculate_configuration(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_quote_from_configuration(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_quote_revision(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.respond_to_quote(uuid, text)
  from public, anon, authenticated, service_role;

-- internal helper はregrantしない:
--   replace_estimate_templates
--   configuration_master_section_total
--   estimate_baseline_master_section_total
grant execute on function public.replace_estimate_templates_with_baselines(jsonb) to authenticated;
grant execute on function public.recalculate_configuration(uuid) to authenticated;
grant execute on function public.create_quote_from_configuration(uuid, jsonb, text) to authenticated;
grant execute on function public.create_quote_revision(uuid, jsonb, text) to authenticated;
grant execute on function public.respond_to_quote(uuid, text) to authenticated;

commit;
