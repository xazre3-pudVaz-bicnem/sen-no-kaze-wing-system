-- PR #389 final corrective:
-- BOX `hotel-single` の商品technical aliasと業務カテゴリー可否を分離する。
--
-- 確定仕様:
--   * BOX（ホテル単身者）は業務上 BOX / ホテル仕様として扱う。
--   * BOX / ホテル仕様 / キッチンは選択不可。
--   * `hotel-single ↔ residence` は個別商品のtechnical aliasとしてのみ維持する。
--   * 既存Standard Estimateのbaseline_option_ids 5商品、master合計1,518,904円、
--     Excel税込3,812,600円はlegacy baselineとして変更しない。
--
-- Quote / Revision / Snapshot / Configuration / estimate_templates の保存値は更新しない。

-- ---------- preflight ----------

do $$
begin
  if to_regprocedure('public.customer_business_item_for_category(text)') is null
     or to_regprocedure('public.customer_product_spec_selectable(text,text,text[])') is null
     or to_regprocedure('public.customer_category_selectable(text,text,text)') is null
     or to_regprocedure('public.estimate_baseline_master_section_total(uuid,text)') is null
  then
    raise exception 'PRECONDITION: preceding customer-spec corrective functions are missing';
  end if;

  -- 商品technical aliasはこのcorrectiveでも維持されることを先に確認する。
  if not public.customer_product_spec_selectable('box', 'hotel-single', array['residence']::text[])
     or not public.customer_product_spec_selectable('box', 'hotel-single', array['hotel-single']::text[])
     or public.customer_product_spec_selectable('box', 'hotel-single', array['hotel']::text[])
  then
    raise exception 'PRECONDITION: hotel-single product technical alias contract is unexpected';
  end if;
end;
$$;

-- ---------- business category matrix ----------
-- hotel-singleは商品technical aliasではresidence互換だが、
-- 業務カテゴリー可否はBOXホテル仕様と同じ行を使う。

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
        ('box', 'hotel-single', array['roof-exterior','interior','entrance-door','sash','bath','washbasin','toilet','boiler','entrance-storage','interior-door','bed','furnishings','other']::text[]),
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

-- ---------- postconditions / legacy baseline audit ----------

do $$
declare
  v_code text;
  v_template public.estimate_templates%rowtype;
  v_expected_ids uuid[];
  v_actual_ids uuid[];
  v_legacy_master_total numeric;
  v_customer_filtered_total numeric;
begin
  -- business rowはBOX hotelと完全一致し、kitchenだけresidenceとの差分になる。
  foreach v_code in array array[
    'roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash','service-door',
    'ub','kitchen','washbasin','toilet','boiler','entrance-storage','interior-door','closet','bed',
    'furniture','appliances','office-supplies','aircon','lighting','smartlock','exterior-parts'
  ]::text[]
  loop
    if public.customer_category_selectable('box', 'hotel-single', v_code)
       is distinct from public.customer_category_selectable('box', 'hotel', v_code)
    then
      raise exception 'POSTCONDITION: BOX hotel-single business row differs from BOX hotel for category %', v_code;
    end if;
  end loop;

  if public.customer_category_selectable('box', 'hotel-single', 'kitchen') then
    raise exception 'POSTCONDITION: BOX hotel-single kitchen must be unselectable';
  end if;

  if not public.customer_product_spec_selectable('box', 'hotel-single', array['residence']::text[])
     or not public.customer_product_spec_selectable('box', 'hotel-single', array['hotel-single']::text[])
     or public.customer_product_spec_selectable('box', 'hotel-single', array['hotel']::text[])
  then
    raise exception 'POSTCONDITION: hotel-single product technical alias was changed';
  end if;

  -- Standard Estimateが存在する環境では、legacy baselineを生データとして固定したまま、
  -- お客様の新規選択集合だけが現在のbusiness matrixへ投影されることを検算する。
  select t.*
    into v_template
    from public.estimate_templates t
    join public.base_models m on m.id = t.base_model_id
   where m.slug = 'box'
     and t.spec_code = 'hotel-single';

  if found then
    select array_agg(o.id order by o.id)
      into v_expected_ids
      from public.options o
     where o.code in (
       'interior-standard-box',
       'carpentry-box',
       'shower-unit-1116',
       'mini-kitchen',
       'folding-bed'
     );

    select array_agg(x.option_id order by x.option_id)
      into v_actual_ids
      from unnest(v_template.baseline_option_ids) as x(option_id);

    if v_actual_ids is distinct from v_expected_ids then
      raise exception 'POSTCONDITION: BOX hotel-single baseline_option_ids changed from the audited five products';
    end if;

    if v_template.total <> 3812600 then
      raise exception 'POSTCONDITION: BOX hotel-single Excel total is not 3,812,600 yen';
    end if;

    select coalesce(sum(case when o.price_on_request then 0 else o.price end), 0)
      into v_legacy_master_total
      from public.options o
     where o.id = any(v_template.baseline_option_ids);

    if v_legacy_master_total <> 1518904 then
      raise exception 'POSTCONDITION: BOX hotel-single legacy five-product master total is not 1,518,904 yen';
    end if;

    select sum(public.estimate_baseline_master_section_total(v_template.id, s.section_code))
      into v_customer_filtered_total
      from unnest(array['interior_exterior','option','sitework']::text[]) as s(section_code);

    -- mini-kitchen 187,500円はlegacy baselineには残るが、BOXホテル仕様では新規選択不可。
    if coalesce(v_customer_filtered_total, -1) <> 1331404 then
      raise exception 'POSTCONDITION: BOX hotel-single customer-selectable baseline total is not 1,331,404 yen';
    end if;
  end if;
end;
$$;
