-- =============================================================
-- 見積書をエクセル表のように編集する
--
-- 先方の要望：
--   「本部・総代理店IDで本体工事の見積も変更可能にするため、
--     エクセルのような見積り画面で操作するようにしたい」
--   「項目、数量、単位、単価（売価）金額、備考ら欄を記載し、行を追加できるように。
--     本体は本部と総代理店のみ変更可能とする」
--
-- 明細に「単位」「備考」を足し、改訂版の発行で本体・オプションの行も
-- 入れ替えられるようにする（本部・総代理店のみ。代理店は別途工事とフリー商品だけ）。
-- 発行済みの版は書き換えず、新しい版を作るのは今までどおり。
-- =============================================================

alter table public.quote_items
  add column if not exists unit text,
  add column if not exists remark text;

comment on column public.quote_items.unit is '単位（式・台・㎡・人工 など）';
comment on column public.quote_items.remark is '備考';

-- 既存の明細に既定の単位を入れておく
update public.quote_items set unit = '式' where unit is null;

/**
 * 改訂版の発行。
 *   代理店            … installation / free の行だけ
 *   本部・総代理店     … base / base_expense / option / option_expense も含めて全行
 * 合計は入力された行から作り直す（千円未満切捨て → 消費税）。
 */
create or replace function public.create_quote_revision(
  p_quote_id uuid,
  p_items jsonb,
  p_dealer_note text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  parent public.quotes;
  v_uid uuid := auth.uid();
  v_full boolean;
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
  v_amount integer;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into parent from public.quotes where id = p_quote_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;

  -- 本体まで触れるのは総代理店以上
  v_full := public.current_role_rank() >= 2;
  if not (v_full or (public.is_dealer() and parent.dealer_id = v_uid)) then
    raise exception 'FORBIDDEN: この見積を編集できる権限がありません' using errcode = '42501';
  end if;
  if parent.status = 'superseded' then
    raise exception 'LOCKED: この版はすでに改訂されています。最新の版から作成してください' using errcode = 'P0001';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_kind := r ->> 'kind';
    if v_kind not in ('base', 'base_expense', 'option', 'option_expense', 'installation', 'free') then
      raise exception 'VALIDATION: 区分の指定が不正です（%）', v_kind using errcode = 'P0001';
    end if;
    if not v_full and v_kind not in ('installation', 'free') then
      raise exception 'FORBIDDEN: 本体・オプションを変更できるのは本部と総代理店だけです' using errcode = '42501';
    end if;
    v_amount := coalesce((r ->> 'unit_price')::integer, 0) * greatest(coalesce((r ->> 'quantity')::integer, 1), 1);
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
    case when v_full then '本見積書は最新の内容で作成した確定見積です。'
         else '本見積書は現地の代理店・工務店が別途工事を確認したうえで作成した確定見積です。' end,
    coalesce(parent.dealer_id, case when v_full then null else v_uid end), p_dealer_note, parent.revision + 1, parent.id)
  returning id into v_new;

  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_sort := v_sort + 1;
    insert into public.quote_items (quote_id, kind, name, description, unit, remark, unit_price, quantity, amount, sort_order)
    values (
      v_new,
      r ->> 'kind',
      coalesce(nullif(r ->> 'name', ''), '（名称未設定）'),
      nullif(r ->> 'description', ''),
      coalesce(nullif(r ->> 'unit', ''), '式'),
      nullif(r ->> 'remark', ''),
      coalesce((r ->> 'unit_price')::integer, 0),
      greatest(coalesce((r ->> 'quantity')::integer, 1), 1),
      coalesce((r ->> 'unit_price')::integer, 0) * greatest(coalesce((r ->> 'quantity')::integer, 1), 1),
      v_sort);
  end loop;

  update public.quotes set status = 'superseded' where id = parent.id;
  update public.quote_requests set quote_id = v_new, status = 'sent' where id = parent.quote_request_id;

  return v_new;
end $$;

revoke all on function public.create_quote_revision(uuid, jsonb, text) from public;
grant execute on function public.create_quote_revision(uuid, jsonb, text) to authenticated;

-- 旧名は残しておく（呼び出し元の入れ替えが済んだら削除してよい）
drop function if exists public.create_dealer_revision(uuid, jsonb, text);
