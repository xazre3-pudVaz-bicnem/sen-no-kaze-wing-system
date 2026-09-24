-- =============================================================
-- Quote revision adjustment carry-forward corrective
--
-- Depends on 20260923080000_quote_revision_prod_compat.sql.
--
-- An issued Quote's adjustment is part of that Revision snapshot. Creating
-- the next Revision must carry the parent's adjustment forward instead of
-- silently replacing it with the generic thousand-yen rounding rule.
--
-- This migration changes only the RPC definition. It does not update any
-- existing Quote or QuoteItem rows.
-- =============================================================

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
  v_unit_price_raw numeric;
  v_unit_price integer;
  v_amount integer;
  v_source_id uuid;
  v_source_kind text;
  v_source_name text;
  v_source_unit text;
  v_source_unit_price integer;
  v_source_quantity numeric;
  v_source_amount integer;
  v_seen_source_ids uuid[] := '{}'::uuid[];
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

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

    v_qty := coalesce((r ->> 'quantity')::numeric, 1);
    if v_qty < 0.01 or v_qty > 99999 then
      raise exception 'VALIDATION: 数量は0.01以上99999以下で入力してください' using errcode = 'P0001';
    end if;

    v_unit_price_raw := coalesce((r ->> 'unit_price')::numeric, 0);
    if v_unit_price_raw <> trunc(v_unit_price_raw)
       or v_unit_price_raw < -100000000
       or v_unit_price_raw > 100000000 then
      raise exception 'VALIDATION: 単価は整数かつ-100000000以上100000000以下で入力してください' using errcode = 'P0001';
    end if;

    v_unit_price := v_unit_price_raw::integer;

    v_source_id := null;
    v_source_kind := null;
    v_source_name := null;
    v_source_unit := null;
    v_source_unit_price := null;
    v_source_quantity := null;
    v_source_amount := null;

    if coalesce(r ->> 'source_item_id', '') <> '' then
      begin
        v_source_id := (r ->> 'source_item_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'VALIDATION: 親明細IDが不正です' using errcode = 'P0001';
      end;

      if v_source_id = any(v_seen_source_ids) then
        raise exception 'VALIDATION: 同じ親見積明細を複数行へ再利用することはできません' using errcode = 'P0001';
      end if;
      v_seen_source_ids := array_append(v_seen_source_ids, v_source_id);

      select
        qi.kind,
        qi.name,
        coalesce(nullif(qi.unit, ''), '式'),
        qi.unit_price,
        qi.quantity,
        qi.amount
      into
        v_source_kind,
        v_source_name,
        v_source_unit,
        v_source_unit_price,
        v_source_quantity,
        v_source_amount
      from public.quote_items qi
      where qi.id = v_source_id
        and qi.quote_id = parent.id;

      if not found then
        raise exception 'VALIDATION: 親見積に存在しない明細が指定されています' using errcode = 'P0001';
      end if;
    end if;

    if v_source_id is not null
       and v_source_kind = v_kind
       and v_source_name = coalesce(nullif(r ->> 'name', ''), '（名称未設定）')
       and v_source_unit = coalesce(nullif(r ->> 'unit', ''), '式')
       and v_source_unit_price = v_unit_price
       and v_source_quantity = v_qty then
      v_amount := v_source_amount;
    else
      v_amount := round(v_unit_price * v_qty)::integer;
    end if;

    if v_unit_price < 0 and coalesce(r ->> 'name', '') <> '選択商品の変更差額' then
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

  -- adjustment is part of the issued Quote snapshot.
  -- A revision must not silently replace it with another rounding rule.
  v_sub := v_sub_raw + parent.adjustment;
  if v_sub < 0 then
    raise exception 'VALIDATION: 調整額を引き継ぐと税抜請負額が0円未満になります。明細を確認してください'
      using errcode = 'P0001';
  end if;
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
    parent.adjustment, v_sub, parent.tax_rate, v_tax, v_sub + v_tax,
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
    v_qty := coalesce((r ->> 'quantity')::numeric, 1);
    v_unit_price := coalesce((r ->> 'unit_price')::numeric, 0)::integer;

    v_source_id := nullif(r ->> 'source_item_id', '')::uuid;
    v_source_kind := null;
    v_source_name := null;
    v_source_unit := null;
    v_source_unit_price := null;
    v_source_quantity := null;
    v_source_amount := null;

    if v_source_id is not null then
      select
        qi.kind,
        qi.name,
        coalesce(nullif(qi.unit, ''), '式'),
        qi.unit_price,
        qi.quantity,
        qi.amount
      into
        v_source_kind,
        v_source_name,
        v_source_unit,
        v_source_unit_price,
        v_source_quantity,
        v_source_amount
      from public.quote_items qi
      where qi.id = v_source_id
        and qi.quote_id = parent.id;
    end if;

    if v_source_id is not null
       and v_source_kind = (r ->> 'kind')
       and v_source_name = coalesce(nullif(r ->> 'name', ''), '（名称未設定）')
       and v_source_unit = coalesce(nullif(r ->> 'unit', ''), '式')
       and v_source_unit_price = v_unit_price
       and v_source_quantity = v_qty then
      v_amount := v_source_amount;
    else
      v_amount := round(v_unit_price * v_qty)::integer;
    end if;

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
      v_unit_price,
      v_qty,
      v_amount,
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

revoke execute on function public.create_quote_revision(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_quote_revision(uuid, jsonb, text) to authenticated;

