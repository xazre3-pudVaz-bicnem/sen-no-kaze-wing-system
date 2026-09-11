-- =============================================================
-- 標準見積テンプレートをシミュレーター・案件見積の価格基準へ接続
--
-- * Excel標準見積を価格の正本とする
-- * 商品マスターは標準状態からの変更差額だけに使う
-- * Wing / BOX / Flat 共通
-- * 防火標準見積は今回対象外
-- =============================================================

alter table public.estimate_templates
  add column if not exists baseline_option_ids uuid[] not null default '{}';

comment on column public.estimate_templates.baseline_option_ids is
  '標準見積に含まれる商品マスターの標準選択。標準価格の再計算には使わず、商品変更差額の基準だけに使う。';

-- 既存のWing / Flatテンプレートは base_models.presets の option_codes から基準商品を復元する。
update public.estimate_templates t
set baseline_option_ids = coalesce((
  select array_agg(o.id order by o.sort_order, o.id)
  from public.base_models m
  cross join lateral jsonb_array_elements(coalesce(m.presets, '[]'::jsonb)) p
  cross join lateral jsonb_array_elements_text(coalesce(p -> 'option_codes', '[]'::jsonb)) c(code)
  join public.options o
    on o.code = c.code
   and (o.base_model_id is null or o.base_model_id = m.id)
  where m.id = t.base_model_id
    and p ->> 'code' = t.spec_code
), '{}')
where t.spec_code <> 'base'
  and cardinality(t.baseline_option_ids) = 0;

-- BOXは実物Excelの仕様体系が旧presetと異なるため明示的に復元する。
update public.estimate_templates t
set baseline_option_ids = coalesce((
  select array_agg(o.id order by o.sort_order, o.id)
  from public.base_models m
  join public.options o
    on (o.base_model_id is null or o.base_model_id = m.id)
  where m.id = t.base_model_id
    and m.slug = 'box'
    and o.code = any(
      case t.spec_code
        when 'hotel-single' then array[
          'interior-standard-box',
          'carpentry-box',
          'shower-unit-1116',
          'mini-kitchen',
          'folding-bed'
        ]::text[]
        when 'water-kit' then array[
          'interior-standard-box',
          'carpentry-box',
          'ub-1216',
          'toilet-washlet',
          'mini-kitchen',
          'gas-boiler-16',
          'aircon'
        ]::text[]
        else '{}'::text[]
      end
    )
), '{}')
where exists (
  select 1 from public.base_models m
  where m.id = t.base_model_id and m.slug = 'box'
)
and cardinality(t.baseline_option_ids) = 0;

-- Excel再取込時、既存の検算付きRPCをそのまま利用した後に基準商品IDだけ保存する。
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

revoke all on function public.replace_estimate_templates_with_baselines(jsonb) from public;
grant execute on function public.replace_estimate_templates_with_baselines(jsonb) to authenticated, service_role;

-- 標準見積の4分類を発行済み見積にも保持する。
alter table public.quote_items drop constraint if exists quote_items_kind_check;
alter table public.quote_items add constraint quote_items_kind_check
  check (kind in (
    'base',
    'base_expense',
    'interior_exterior',
    'interior_exterior_expense',
    'option',
    'option_expense',
    'installation',
    'free',
    'discount'
  ));

-- 商品マスターのカテゴリーを標準見積4分類へ割り当てる。
create or replace function public.estimate_section_for_option(
  p_category_code text,
  p_is_installation boolean
)
returns text
language sql
immutable
as $$
  select case
    when p_is_installation or p_category_code = 'free-product' then 'sitework'
    when p_category_code in (
      'floor',
      'flooring',
      'wall-ceiling',
      'interior-door',
      'exterior-wall',
      'roof',
      'sash',
      'entrance-door',
      'service-door',
      'carpentry'
    ) then 'interior_exterior'
    else 'option'
  end;
$$;

-- 保存中の仕様について、商品マスター価格で各分類の現在値を求める。
-- 標準見積の金額そのものはここから作らず、差額の算出だけに使う。
create or replace function public.configuration_master_section_total(
  p_configuration_id uuid,
  p_section text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg public.configurations;
  v_total numeric := 0;
  v_faces numeric := 0;
  v_has_faces boolean := false;
begin
  select * into cfg from public.configurations where id = p_configuration_id;
  if not found then return 0; end if;

  v_has_faces :=
    jsonb_typeof(cfg.exterior_faces) = 'array'
    and jsonb_array_length(cfg.exterior_faces) = 4;

  select coalesce(sum(
    (
      case when o.price_on_request then 0 else o.price end
      + coalesce((
          select sum(case when vc.price_on_request then 0 else vc.extra_price end)
          from public.option_variant_choices vc
          join public.option_variant_groups vg on vg.id = vc.group_id
          where vc.id = any(ci.variant_choice_ids)
            and vg.option_id = o.id
        ), 0)
    ) * ci.quantity
  ), 0)
  into v_total
  from public.configuration_items ci
  join public.options o on o.id = ci.option_id
  join public.option_categories cat on cat.id = o.category_id
  where ci.configuration_id = cfg.id
    and o.status = 'published'
    and public.estimate_section_for_option(cat.code, o.is_installation) = p_section
    and not (v_has_faces and cat.code = 'exterior-wall');

  if p_section = 'interior_exterior' and v_has_faces then
    select coalesce(sum(
      (case when o.price_on_request then 0 else o.price end)
      + coalesce(v.extra, 0)
    ), 0)
    into v_faces
    from (
      select
        (value ->> 'option_id')::uuid as option_id,
        coalesce(value -> 'variant_choice_ids', '[]'::jsonb) as variant_choice_ids
      from jsonb_array_elements(cfg.exterior_faces)
    ) f
    join public.options o on o.id = f.option_id
    join public.option_categories cat
      on cat.id = o.category_id
     and cat.code = 'exterior-wall'
    left join lateral (
      select coalesce(sum(case when vc.price_on_request then 0 else vc.extra_price end), 0) as extra
      from jsonb_array_elements_text(f.variant_choice_ids) j(choice_id)
      join public.option_variant_choices vc on vc.id = j.choice_id::uuid
      join public.option_variant_groups vg on vg.id = vc.group_id and vg.option_id = o.id
    ) v on true
    where o.status = 'published';

    v_total := v_total + v_faces;
  end if;

  return coalesce(v_total, 0);
end;
$$;

-- 標準状態の商品マスター価格。差額比較だけに使う。
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
    and public.estimate_section_for_option(cat.code, o.is_installation) = p_section;
$$;

-- 標準見積が登録されている仕様は、Excel金額 + 商品変更差額で再計算する。
-- 未登録の仕様は従来計算を維持する。
create or replace function public.recalculate_configuration(p_configuration_id uuid)
returns public.configurations
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.configurations;
  v_model public.base_models;
  v_template public.estimate_templates;
  v_rate numeric;

  v_base_line numeric := 0;
  v_base_exp numeric := 0;
  v_int_line numeric := 0;
  v_int_exp numeric := 0;
  v_opt_line numeric := 0;
  v_opt_exp numeric := 0;
  v_site_total numeric := 0;

  v_cur_int numeric := 0;
  v_base_int numeric := 0;
  v_cur_opt numeric := 0;
  v_base_opt numeric := 0;
  v_cur_site numeric := 0;
  v_base_site numeric := 0;
  v_delta_int numeric := 0;
  v_delta_opt numeric := 0;
  v_delta_site numeric := 0;
  v_delta_int_exp numeric := 0;
  v_delta_opt_exp numeric := 0;
  v_changed boolean := false;

  v_sub_raw numeric := 0;
  v_sub numeric := 0;
  v_adjust numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;

  -- legacy fallback
  v_bb integer;
  v_legacy_base integer;
  v_legacy_base_exp integer;
  v_legacy_opt integer;
  v_legacy_face_opt integer := 0;
  v_legacy_opt_exp integer;
  v_legacy_inst integer;
  v_has_faces boolean := false;
begin
  select * into cfg from public.configurations where id = p_configuration_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or cfg.user_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_model from public.base_models where id = cfg.base_model_id;
  v_rate := coalesce(v_model.expense_rate, 0.15);

  select * into v_template
    from public.estimate_templates
   where base_model_id = cfg.base_model_id
     and spec_code = coalesce(cfg.spec_code, '')
   limit 1;

  if found then
    select line_subtotal, expense_amount
      into v_base_line, v_base_exp
      from public.estimate_template_sections
     where template_id = v_template.id and code = 'base';

    select line_subtotal, expense_amount
      into v_int_line, v_int_exp
      from public.estimate_template_sections
     where template_id = v_template.id and code = 'interior_exterior';

    select line_subtotal, expense_amount
      into v_opt_line, v_opt_exp
      from public.estimate_template_sections
     where template_id = v_template.id and code = 'option';

    select total
      into v_site_total
      from public.estimate_template_sections
     where template_id = v_template.id and code = 'sitework';

    v_cur_int := public.configuration_master_section_total(cfg.id, 'interior_exterior');
    v_base_int := public.estimate_baseline_master_section_total(v_template.id, 'interior_exterior');
    v_cur_opt := public.configuration_master_section_total(cfg.id, 'option');
    v_base_opt := public.estimate_baseline_master_section_total(v_template.id, 'option');
    v_cur_site := public.configuration_master_section_total(cfg.id, 'sitework');
    v_base_site := public.estimate_baseline_master_section_total(v_template.id, 'sitework');

    v_delta_int := v_cur_int - v_base_int;
    v_delta_opt := v_cur_opt - v_base_opt;
    v_delta_site := v_cur_site - v_base_site;
    v_delta_int_exp := floor(v_cur_int * v_rate) - floor(v_base_int * v_rate);
    v_delta_opt_exp := floor(v_cur_opt * v_rate) - floor(v_base_opt * v_rate);
    v_changed :=
      v_delta_int <> 0 or v_delta_opt <> 0 or v_delta_site <> 0
      or v_delta_int_exp <> 0 or v_delta_opt_exp <> 0;

    v_int_line := v_int_line + v_delta_int;
    v_int_exp := v_int_exp + v_delta_int_exp;
    v_opt_line := v_opt_line + v_delta_opt;
    v_opt_exp := v_opt_exp + v_delta_opt_exp;
    v_site_total := v_site_total + v_delta_site;

    v_sub_raw :=
      v_base_line + v_base_exp
      + v_int_line + v_int_exp
      + v_opt_line + v_opt_exp
      + v_site_total;

    if v_changed then
      v_sub := floor(v_sub_raw / 1000.0) * 1000;
      v_adjust := v_sub - v_sub_raw;
      v_tax := floor(v_sub * v_template.tax_rate);
      v_total := v_sub + v_tax;
    else
      -- 標準状態はExcel記載値をそのまま使う。
      v_sub := v_template.subtotal;
      v_adjust := v_template.adjustment;
      v_tax := v_template.tax;
      v_total := v_template.total;
    end if;

    update public.configurations
       set base_price = round(v_base_line)::integer,
           base_expense = round(v_base_exp)::integer,
           option_subtotal = round(v_int_line + v_opt_line)::integer,
           option_expense = round(v_int_exp + v_opt_exp)::integer,
           installation_subtotal = round(v_site_total)::integer,
           adjustment = round(v_adjust)::integer,
           subtotal = round(v_sub)::integer,
           tax = round(v_tax)::integer,
           total = round(v_total)::integer
     where id = cfg.id
     returning * into cfg;

    return cfg;
  end if;

  -- ----- 従来計算（標準見積がない旧仕様用） -----
  v_bb := public.base_breakdown_total(cfg.base_model_id, cfg.spec_code);
  v_legacy_base := coalesce(nullif(v_bb, 0), v_model.base_price);
  v_legacy_base_exp := floor(v_legacy_base * v_rate);
  v_has_faces := jsonb_typeof(cfg.exterior_faces) = 'array' and jsonb_array_length(cfg.exterior_faces) = 4;

  select coalesce(sum(
           (case when o.price_on_request then 0 else o.price end
            + coalesce((
                select sum(case when vc.price_on_request then 0 else vc.extra_price end)
                from public.option_variant_choices vc
                where vc.id = any(ci.variant_choice_ids)
              ), 0)
           ) * ci.quantity), 0)::integer
    into v_legacy_opt
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
   where ci.configuration_id = cfg.id and o.status = 'published'
     and not o.is_installation and cat.code <> 'free-product'
     and (o.base_model_id is null or o.base_model_id = cfg.base_model_id)
     and not (v_has_faces and cat.code = 'exterior-wall');

  if v_has_faces then
    select coalesce(sum(
      (case when o.price_on_request then 0 else o.price end)
      + coalesce(v.extra, 0)
    ), 0)::integer
    into v_legacy_face_opt
    from (
      select
        (value ->> 'option_id')::uuid as option_id,
        coalesce(value -> 'variant_choice_ids', '[]'::jsonb) as variant_choice_ids
      from jsonb_array_elements(cfg.exterior_faces)
    ) f
    join public.options o on o.id = f.option_id
    join public.option_categories cat on cat.id = o.category_id and cat.code = 'exterior-wall'
    left join lateral (
      select coalesce(sum(case when vc.price_on_request then 0 else vc.extra_price end), 0)::integer as extra
      from jsonb_array_elements_text(f.variant_choice_ids) j(choice_id)
      join public.option_variant_choices vc on vc.id = j.choice_id::uuid
      join public.option_variant_groups vg on vg.id = vc.group_id and vg.option_id = o.id
    ) v on true
    where o.status = 'published';
    v_legacy_opt := v_legacy_opt + v_legacy_face_opt;
  end if;

  v_legacy_opt_exp := floor(v_legacy_opt * v_rate);

  select coalesce(sum(
           (case when o.price_on_request then 0 else o.price end
            + coalesce((
                select sum(case when vc.price_on_request then 0 else vc.extra_price end)
                from public.option_variant_choices vc
                where vc.id = any(ci.variant_choice_ids)
              ), 0)
           ) * ci.quantity), 0)::integer
    into v_legacy_inst
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
   where ci.configuration_id = cfg.id and o.status = 'published'
     and (o.is_installation or cat.code = 'free-product')
     and (o.base_model_id is null or o.base_model_id = cfg.base_model_id);

  v_sub_raw := v_legacy_base + v_legacy_base_exp + v_legacy_opt + v_legacy_opt_exp + v_legacy_inst;
  v_sub := floor(v_sub_raw / 1000.0) * 1000;
  v_tax := floor(v_sub * 0.10);

  update public.configurations
     set base_price = v_legacy_base,
         base_expense = v_legacy_base_exp,
         option_subtotal = v_legacy_opt,
         option_expense = v_legacy_opt_exp,
         installation_subtotal = v_legacy_inst,
         adjustment = round(v_sub - v_sub_raw)::integer,
         subtotal = round(v_sub)::integer,
         tax = round(v_tax)::integer,
         total = round(v_sub + v_tax)::integer
   where id = p_configuration_id
   returning * into cfg;

  return cfg;
end;
$$;

revoke all on function public.recalculate_configuration(uuid) from public;
grant execute on function public.recalculate_configuration(uuid) to authenticated, service_role;

-- 見積発行時は標準テンプレートの4分類をスナップショットする。
create or replace function public.create_quote_from_configuration(
  p_configuration_id uuid,
  p_contact jsonb,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.configurations;
  v_uid uuid := auth.uid();
  v_req uuid;
  v_quote uuid;
  v_no text;
  v_model public.base_models;
  v_template public.estimate_templates;
  v_customer_no text;
  v_dealer uuid;
  v_rate numeric;

  v_cur_int numeric := 0;
  v_base_int numeric := 0;
  v_cur_opt numeric := 0;
  v_base_opt numeric := 0;
  v_cur_site numeric := 0;
  v_base_site numeric := 0;
  v_delta_int numeric := 0;
  v_delta_opt numeric := 0;
  v_delta_site numeric := 0;
  v_int_exp numeric := 0;
  v_opt_exp numeric := 0;
  v_sort integer := 0;
  s record;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into cfg from public.configurations where id = p_configuration_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if cfg.user_id <> v_uid then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  perform public.validate_configuration_items(
    cfg.base_model_id,
    coalesce((select array_agg(option_id) from public.configuration_items where configuration_id = cfg.id), '{}'),
    cfg.finish_level
  );

  cfg := public.recalculate_configuration(cfg.id);
  select * into v_model from public.base_models where id = cfg.base_model_id;
  select * into v_template
    from public.estimate_templates
   where base_model_id = cfg.base_model_id and spec_code = coalesce(cfg.spec_code, '')
   limit 1;
  select customer_no into v_customer_no from public.profiles where id = v_uid;
  v_dealer := case when public.current_role_rank() between 1 and 2 then v_uid else null end;
  v_rate := coalesce(v_model.expense_rate, 0.15);

  insert into public.quote_requests(configuration_id, user_id, status, message, contact)
  values(cfg.id, v_uid, 'new', p_message, coalesce(p_contact, '{}'::jsonb))
  returning id into v_req;

  v_no := public.next_quote_no();

  insert into public.quotes(
    quote_no, quote_request_id, configuration_id, user_id, status, issued_at, valid_until,
    customer_no, customer_name, customer_company, base_model_name, finish_level,
    base_price, base_expense, option_subtotal, option_expense, installation_subtotal, adjustment,
    subtotal, tax_rate, tax, total, preview_image_url, notes, dealer_id
  )
  values(
    v_no, v_req, cfg.id, v_uid, 'issued', now(), now() + interval '30 days',
    v_customer_no, coalesce(p_contact ->> 'full_name', ''), nullif(p_contact ->> 'company_name', ''),
    v_model.name, cfg.finish_level,
    cfg.base_price, cfg.base_expense, cfg.option_subtotal, cfg.option_expense,
    cfg.installation_subtotal, cfg.adjustment,
    cfg.subtotal, coalesce(v_template.tax_rate, 0.10), cfg.tax, cfg.total, cfg.preview_image_url,
    case when v_template.id is not null
      then '本見積書はExcel標準見積を基準に、選択商品の変更差額を反映した概算です。'
      else '本見積書は概算です。別途工事は設置場所の確認後に確定します。'
    end,
    v_dealer
  )
  returning id into v_quote;

  if v_template.id is null then
    -- 標準見積がない旧仕様は、既存と同じ明細作成へフォールバック。
    insert into public.quote_items(
      quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order
    )
    select
      v_quote, 'base', b.name, b.section, b.unit, b.unit_price, b.quantity, b.amount, b.sort_order
    from public.base_breakdown_items b
    where b.base_model_id = cfg.base_model_id
      and b.spec_code = coalesce(cfg.spec_code, '')
    order by b.sort_order;

    if not found then
      insert into public.quote_items(
        quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order
      )
      values(
        v_quote, 'base', v_model.name || ' 本体一式',
        '工場生産分（躯体・金物・断熱・屋根外壁・サッシ建具）',
        '式', cfg.base_price, 1, cfg.base_price, 0
      );
    end if;

    insert into public.quote_items(
      quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order
    )
    values(
      v_quote, 'base_expense', '本体諸費用',
      '交通費、労災、安全管理費等', '式',
      cfg.base_expense, 1, cfg.base_expense, 900
    );

    insert into public.quote_items(
      quote_id, kind, name, description, unit, unit_price, quantity, amount, image_url, sort_order
    )
    select
      v_quote,
      case when cat.code = 'free-product' then 'free'
           when o.is_installation then 'installation'
           else 'option' end,
      o.name || coalesce(v.label, ''),
      case when o.price_on_request then '設置場所確認後に別途お見積り' else cat.name end,
      '式',
      case when o.price_on_request then 0 else o.price end + coalesce(v.extra, 0),
      ci.quantity,
      (case when o.price_on_request then 0 else o.price end + coalesce(v.extra, 0)) * ci.quantity,
      o.image_url,
      1000 + row_number() over(order by o.is_installation, cat.sort_order, o.sort_order)
    from public.configuration_items ci
    join public.options o on o.id = ci.option_id
    join public.option_categories cat on cat.id = o.category_id
    left join lateral (
      select
        '（' || string_agg(vg.name || '：' || vc.name, '／' order by vg.sort_order, vc.sort_order) || '）' label,
        sum(case when vc.price_on_request then 0 else vc.extra_price end) extra
      from public.option_variant_choices vc
      join public.option_variant_groups vg on vg.id = vc.group_id
      where vc.id = any(ci.variant_choice_ids)
    ) v on true
    where ci.configuration_id = cfg.id;

    insert into public.quote_items(
      quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order
    )
    values(
      v_quote, 'option_expense', 'オプション諸費用',
      '交通費、労災、安全管理費等', '式',
      cfg.option_expense, 1, cfg.option_expense, 9000
    );
  else
    -- 本体は既存の詳細マスターをそのままスナップショットする。
    insert into public.quote_items(
      quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order
    )
    select
      v_quote, 'base', b.name, b.section, b.unit, b.remark,
      b.unit_price, b.quantity, b.amount, b.sort_order
    from public.base_breakdown_items b
    where b.base_model_id = cfg.base_model_id
      and b.spec_code = v_template.spec_code
    order by b.sort_order;

    insert into public.quote_items(
      quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order
    )
    values(
      v_quote, 'base_expense', '本体諸費用',
      'Excel標準見積', '式',
      cfg.base_expense, 1, cfg.base_expense, 900
    );

    v_cur_int := public.configuration_master_section_total(cfg.id, 'interior_exterior');
    v_base_int := public.estimate_baseline_master_section_total(v_template.id, 'interior_exterior');
    v_cur_opt := public.configuration_master_section_total(cfg.id, 'option');
    v_base_opt := public.estimate_baseline_master_section_total(v_template.id, 'option');
    v_cur_site := public.configuration_master_section_total(cfg.id, 'sitework');
    v_base_site := public.estimate_baseline_master_section_total(v_template.id, 'sitework');

    v_delta_int := v_cur_int - v_base_int;
    v_delta_opt := v_cur_opt - v_base_opt;
    v_delta_site := v_cur_site - v_base_site;

    select expense_amount + (floor(v_cur_int * v_rate) - floor(v_base_int * v_rate))
      into v_int_exp
      from public.estimate_template_sections
     where template_id = v_template.id and code = 'interior_exterior';

    select expense_amount + (floor(v_cur_opt * v_rate) - floor(v_base_opt * v_rate))
      into v_opt_exp
      from public.estimate_template_sections
     where template_id = v_template.id and code = 'option';

    -- 内外装工事
    insert into public.quote_items(
      quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order
    )
    select
      v_quote,
      'interior_exterior',
      l.name,
      l.group_label,
      coalesce(l.unit, ''),
      l.remark,
      round(coalesce(l.unit_price, case when coalesce(l.quantity, 0) <> 0 then l.amount / l.quantity else l.amount end))::integer,
      coalesce(l.quantity, 1),
      round(l.amount)::integer,
      1000 + row_number() over(order by l.sort_order)
    from public.estimate_template_lines l
    where l.template_id = v_template.id and l.section_code = 'interior_exterior';

    if v_delta_int <> 0 then
      insert into public.quote_items(
        quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order
      )
      values(
        v_quote, 'interior_exterior', '選択商品の変更差額',
        '商品マスターとの差額', '式',
        round(v_delta_int)::integer, 1, round(v_delta_int)::integer, 1900
      );
    end if;

    insert into public.quote_items(
      quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order
    )
    values(
      v_quote, 'interior_exterior_expense', '内外装工事経費',
      '交通費、労災、安全管理費等', '式',
      round(v_int_exp)::integer, 1, round(v_int_exp)::integer, 1950
    );

    -- オプション
    insert into public.quote_items(
      quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order
    )
    select
      v_quote,
      'option',
      l.name,
      l.group_label,
      coalesce(l.unit, ''),
      l.remark,
      round(coalesce(l.unit_price, case when coalesce(l.quantity, 0) <> 0 then l.amount / l.quantity else l.amount end))::integer,
      coalesce(l.quantity, 1),
      round(l.amount)::integer,
      2000 + row_number() over(order by l.sort_order)
    from public.estimate_template_lines l
    where l.template_id = v_template.id and l.section_code = 'option';

    if v_delta_opt <> 0 then
      insert into public.quote_items(
        quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order
      )
      values(
        v_quote, 'option', '選択商品の変更差額',
        '商品マスターとの差額', '式',
        round(v_delta_opt)::integer, 1, round(v_delta_opt)::integer, 2900
      );
    end if;

    insert into public.quote_items(
      quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order
    )
    values(
      v_quote, 'option_expense', 'オプション諸費用',
      '交通費、労災、安全管理費等', '式',
      round(v_opt_exp)::integer, 1, round(v_opt_exp)::integer, 2950
    );

    -- 別途
    insert into public.quote_items(
      quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order
    )
    select
      v_quote,
      'installation',
      l.name,
      l.group_label,
      coalesce(l.unit, ''),
      l.remark,
      round(coalesce(l.unit_price, case when coalesce(l.quantity, 0) <> 0 then l.amount / l.quantity else l.amount end))::integer,
      coalesce(l.quantity, 1),
      round(l.amount)::integer,
      3000 + row_number() over(order by l.sort_order)
    from public.estimate_template_lines l
    where l.template_id = v_template.id and l.section_code = 'sitework';

    if v_delta_site <> 0 then
      insert into public.quote_items(
        quote_id, kind, name, description, unit, unit_price, quantity, amount, sort_order
      )
      values(
        v_quote, 'installation', '選択商品の変更差額',
        '商品マスターとの差額', '式',
        round(v_delta_site)::integer, 1, round(v_delta_site)::integer, 3900
      );
    end if;
  end if;

  update public.quote_requests set quote_id = v_quote where id = v_req;
  update public.configurations set status = 'quote_requested' where id = cfg.id;
  insert into public.configuration_snapshots(configuration_id, reason, snapshot)
  values(cfg.id, 'quote_requested', public.configuration_pricing_json(cfg.id));

  return v_quote;
end;
$$;

revoke all on function public.create_quote_from_configuration(uuid, jsonb, text) from public;
grant execute on function public.create_quote_from_configuration(uuid, jsonb, text) to authenticated;

-- 案件見積の改訂でも内外装工事を独立区分として保持する。
create or replace function public.create_quote_revision(
  p_quote_id uuid,
  p_items jsonb,
  p_dealer_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
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
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into parent from public.quotes where id = p_quote_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  v_can_any := v_rank >= 2;
  v_can_edit_base := v_rank >= 2;

  if not (v_can_any or (v_rank >= 1 and parent.dealer_id = v_uid)) then
    raise exception 'FORBIDDEN: この見積を編集できる権限がありません' using errcode = '42501';
  end if;
  if parent.status = 'superseded' then
    raise exception 'LOCKED: この版はすでに改訂されています。最新の版から作成してください' using errcode = 'P0001';
  end if;
  if v_rank < 1 then
    raise exception 'FORBIDDEN: 見積を編集できるのは代理店以上です' using errcode = '42501';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
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

    if v_kind = 'base' then v_base := v_base + v_amount;
    elsif v_kind = 'base_expense' then v_base_exp := v_base_exp + v_amount;
    elsif v_kind = 'interior_exterior' then v_int := v_int + v_amount;
    elsif v_kind = 'interior_exterior_expense' then v_int_exp := v_int_exp + v_amount;
    elsif v_kind = 'option' then v_opt := v_opt + v_amount;
    elsif v_kind = 'option_expense' then v_opt_exp := v_opt_exp + v_amount;
    else v_inst := v_inst + v_amount;
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
    where quote_id = parent.id and kind in ('base', 'base_expense');

    select coalesce(max(sort_order), 0) into v_sort
    from public.quote_items
    where quote_id = v_new;
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
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

  update public.quotes set status = 'superseded' where id = parent.id;
  update public.quote_requests set quote_id = v_new, status = 'sent'
  where id = parent.quote_request_id;

  return v_new;
end;
$$;

revoke all on function public.create_quote_revision(uuid, jsonb, text) from public;
grant execute on function public.create_quote_revision(uuid, jsonb, text) to authenticated;
