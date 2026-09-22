-- =============================================================
-- Quote revision production compatibility corrective
--
-- Production can be behind later estimate-template migrations while the
-- current application already emits interior/exterior quote item kinds.
-- Keep this migration standalone: only widen the deployed quote_items kind
-- constraint and replace create_quote_revision with the current contract.
-- =============================================================

begin;

-- Preserve every kind already accepted by production and add the two kinds
-- emitted by the current estimate editor.
alter table public.quote_items
  drop constraint if exists quote_items_kind_check;

alter table public.quote_items
  add constraint quote_items_kind_check
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

revoke execute on function public.create_quote_revision(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_quote_revision(uuid, jsonb, text) to authenticated;

commit;
