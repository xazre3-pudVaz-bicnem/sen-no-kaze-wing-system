-- =============================================================
-- 案件見積の編集権限
--
-- 標準見積テンプレートはExcel原本として固定する一方、
-- そこから作成された案件見積は代理店以上が管理画面で直接編集できる。
--   * 代理店: 自分に割り当てられた案件だけ
--   * 総代理店 / 管理者: 全案件
-- 編集時は元の版を上書きせず、次版を発行して履歴を残す。
-- =============================================================

create or replace function public.create_quote_revision(
  p_quote_id uuid,
  p_items jsonb,
  p_dealer_note text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  parent public.quotes;
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  v_can_any boolean;
  v_can_edit_all_lines boolean;
  v_new uuid;
  v_base integer := 0;
  v_base_exp integer := 0;
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
  v_can_edit_all_lines := v_rank >= 1;

  if not (v_can_any or (v_rank >= 1 and parent.dealer_id = v_uid)) then
    raise exception 'FORBIDDEN: この見積を編集できる権限がありません' using errcode = '42501';
  end if;
  if parent.status = 'superseded' then
    raise exception 'LOCKED: この版はすでに改訂されています。最新の版から作成してください' using errcode = 'P0001';
  end if;
  if not v_can_edit_all_lines then
    raise exception 'FORBIDDEN: 見積を編集できるのは代理店以上です' using errcode = '42501';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_kind := r ->> 'kind';
    if v_kind not in ('base', 'base_expense', 'option', 'option_expense', 'installation', 'free') then
      raise exception 'VALIDATION: 区分の指定が不正です（%）', v_kind using errcode = 'P0001';
    end if;
    v_qty := greatest(coalesce((r ->> 'quantity')::numeric, 1), 0.01);
    v_amount := round(coalesce((r ->> 'unit_price')::integer, 0) * v_qty)::integer;
    if v_amount < 0 then raise exception 'VALIDATION: 金額は 0 以上で入力してください' using errcode = 'P0001'; end if;

    if v_kind = 'base' then v_base := v_base + v_amount;
    elsif v_kind = 'base_expense' then v_base_exp := v_base_exp + v_amount;
    elsif v_kind = 'option' then v_opt := v_opt + v_amount;
    elsif v_kind = 'option_expense' then v_opt_exp := v_opt_exp + v_amount;
    else v_inst := v_inst + v_amount;
    end if;
  end loop;

  v_sub_raw := v_base + v_base_exp + v_opt + v_opt_exp + v_inst;
  v_sub := floor(v_sub_raw / 1000.0)::integer * 1000;
  v_tax := floor(v_sub * parent.tax_rate)::integer;

  insert into public.quotes (
    quote_no, quote_request_id, configuration_id, user_id, status, issued_at, valid_until,
    customer_no, customer_name, customer_company, base_model_name, finish_level,
    base_price, base_expense, option_subtotal, option_expense, installation_subtotal, adjustment,
    subtotal, tax_rate, tax, total, preview_image_url, notes,
    dealer_id, dealer_note, revision, parent_quote_id)
  values (
    parent.quote_no || '-' || (parent.revision + 1), parent.quote_request_id, parent.configuration_id, parent.user_id,
    'issued', now(), now() + interval '30 days',
    parent.customer_no, parent.customer_name, parent.customer_company, parent.base_model_name, parent.finish_level,
    v_base, v_base_exp, v_opt, v_opt_exp, v_inst,
    v_sub - v_sub_raw, v_sub, parent.tax_rate, v_tax, v_sub + v_tax, parent.preview_image_url,
    '本見積書は標準見積を基に、担当者が案件内容を反映して作成した確定見積です。',
    coalesce(parent.dealer_id, case when v_rank = 1 then v_uid else null end), p_dealer_note, parent.revision + 1, parent.id)
  returning id into v_new;

  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_sort := v_sort + 1;
    v_qty := greatest(coalesce((r ->> 'quantity')::numeric, 1), 0.01);
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, image_url, sort_order)
    values (
      v_new,
      r ->> 'kind',
      coalesce(nullif(r ->> 'name', ''), '（名称未設定）'),
      nullif(r ->> 'description', ''),
      coalesce(nullif(r ->> 'unit', ''), '式'),
      nullif(r ->> 'remark', ''),
      coalesce((r ->> 'unit_price')::integer, 0),
      v_qty,
      round(coalesce((r ->> 'unit_price')::integer, 0) * v_qty)::integer,
      nullif(r ->> 'image_url', ''),
      v_sort);
  end loop;

  update public.quotes set status = 'superseded' where id = parent.id;
  update public.quote_requests set quote_id = v_new, status = 'sent' where id = parent.quote_request_id;

  return v_new;
end $$;

revoke all on function public.create_quote_revision(uuid, jsonb, text) from public;
grant execute on function public.create_quote_revision(uuid, jsonb, text) to authenticated;
