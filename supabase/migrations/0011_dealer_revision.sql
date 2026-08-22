-- =============================================================
-- 代理店による確定見積（改訂版）の発行
--
--   顧客の見積依頼 → 概算見積（第1版・技術の杜の工場生産分）
--     → 管理者が代理店を割り当て
--       → 代理店が別途工事・その他・フリー商品を入力して「確定見積（第2版）」を発行
--
-- 発行済みの見積は金額を書き換えない。改訂版は必ず新しい行として作り、
-- 元の版は status='superseded' にして履歴として残す。
-- =============================================================

alter table public.quotes
  add column if not exists revision integer not null default 1,
  add column if not exists parent_quote_id uuid references public.quotes (id) on delete set null,
  add column if not exists dealer_note text;

alter table public.quotes add column if not exists dealer_id uuid references public.profiles (id) on delete set null;

alter table public.quotes drop constraint if exists quotes_status_check;
alter table public.quotes add constraint quotes_status_check
  check (status in ('issued', 'expired', 'accepted', 'declined', 'cancelled', 'superseded'));

create index if not exists quotes_dealer_idx on public.quotes (dealer_id, issued_at desc);
create index if not exists quotes_parent_idx on public.quotes (parent_quote_id);

-- ---------- 閲覧権限 ----------
-- 顧客は自分の見積、管理者は全件、代理店は自分に割り当てられた見積
drop policy if exists quotes_select on public.quotes;
create policy quotes_select on public.quotes for select
  using (user_id = auth.uid() or public.is_admin() or (public.is_dealer() and dealer_id = auth.uid()));

drop policy if exists quote_items_select on public.quote_items;
create policy quote_items_select on public.quote_items for select
  using (exists (
    select 1 from public.quotes q
     where q.id = quote_id
       and (q.user_id = auth.uid() or public.is_admin() or (public.is_dealer() and q.dealer_id = auth.uid()))
  ));

-- ---------- 代理店の割り当て（管理者のみ） ----------
create or replace function public.assign_quote_dealer(p_quote_id uuid, p_dealer_id uuid)
returns public.quotes language plpgsql security definer set search_path = public as $$
declare
  q public.quotes;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_dealer_id is not null
     and not exists (select 1 from public.profiles p where p.id = p_dealer_id and public.role_rank(p.role_code) >= 1) then
    raise exception 'VALIDATION: 代理店以上の権限を持つユーザーを指定してください' using errcode = 'P0001';
  end if;
  update public.quotes set dealer_id = p_dealer_id where id = p_quote_id returning * into q;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return q;
end $$;

-- ---------- 確定見積（改訂版）の発行 ----------
-- p_items: [{ "kind": "installation"|"free", "name": text, "description": text, "unit_price": int, "quantity": int }]
-- 本体・オプションの明細は親の版からそのまま引き継ぐ（スナップショットを崩さない）。
create or replace function public.create_dealer_revision(
  p_quote_id uuid,
  p_items jsonb,
  p_dealer_note text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  parent public.quotes;
  v_uid uuid := auth.uid();
  v_new uuid;
  v_inst integer := 0;
  v_free integer := 0;
  v_base_total integer;
  v_option_total integer;
  v_sub_raw integer;
  v_sub integer;
  v_tax integer;
  v_sort integer := 1000;
  r jsonb;
  v_amount integer;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  select * into parent from public.quotes where id = p_quote_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or (public.is_dealer() and parent.dealer_id = v_uid)) then
    raise exception 'FORBIDDEN: この見積の担当代理店ではありません' using errcode = '42501';
  end if;
  if parent.status = 'superseded' then
    raise exception 'LOCKED: この版はすでに改訂されています。最新の版から作成してください' using errcode = 'P0001';
  end if;

  -- 入力された別途工事・フリー商品の合計
  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if (r ->> 'kind') not in ('installation', 'free') then
      raise exception 'VALIDATION: 代理店が入力できるのは別途工事とフリー商品だけです' using errcode = 'P0001';
    end if;
    v_amount := coalesce((r ->> 'unit_price')::integer, 0) * greatest(coalesce((r ->> 'quantity')::integer, 1), 1);
    if v_amount < 0 then raise exception 'VALIDATION: 金額は 0 以上で入力してください' using errcode = 'P0001'; end if;
    if (r ->> 'kind') = 'free' then v_free := v_free + v_amount; else v_inst := v_inst + v_amount; end if;
  end loop;

  v_base_total := parent.base_price + parent.base_expense;
  v_option_total := parent.option_subtotal + parent.option_expense;
  v_sub_raw := v_base_total + v_option_total + v_inst + v_free;
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
    parent.base_price, parent.base_expense, parent.option_subtotal, parent.option_expense, v_inst + v_free,
    v_sub - v_sub_raw, v_sub, parent.tax_rate, v_tax, v_sub + v_tax, parent.preview_image_url,
    '本見積書は現地の代理店・工務店が別途工事を確認したうえで作成した確定見積です。',
    coalesce(parent.dealer_id, v_uid), p_dealer_note, parent.revision + 1, parent.id)
  returning id into v_new;

  -- 本体・オプションの明細は親からそのまま複製
  insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, amount, image_url, sort_order)
  select v_new, qi.kind, qi.name, qi.description, qi.unit_price, qi.quantity, qi.amount, qi.image_url, qi.sort_order
    from public.quote_items qi
   where qi.quote_id = parent.id and qi.kind in ('base', 'base_expense', 'option', 'option_expense');

  -- 別途工事・フリー商品は代理店の入力で置き換える
  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_sort := v_sort + 1;
    insert into public.quote_items (quote_id, kind, name, description, unit_price, quantity, amount, sort_order)
    values (
      v_new,
      r ->> 'kind',
      coalesce(nullif(r ->> 'name', ''), '（名称未設定）'),
      nullif(r ->> 'description', ''),
      coalesce((r ->> 'unit_price')::integer, 0),
      greatest(coalesce((r ->> 'quantity')::integer, 1), 1),
      coalesce((r ->> 'unit_price')::integer, 0) * greatest(coalesce((r ->> 'quantity')::integer, 1), 1),
      v_sort);
  end loop;

  update public.quotes set status = 'superseded' where id = parent.id;
  update public.quote_requests set quote_id = v_new, status = 'sent' where id = parent.quote_request_id;

  return v_new;
end $$;

revoke all on function public.assign_quote_dealer(uuid, uuid) from public;
revoke all on function public.create_dealer_revision(uuid, jsonb, text) from public;
grant execute on function public.assign_quote_dealer(uuid, uuid) to authenticated;
grant execute on function public.create_dealer_revision(uuid, jsonb, text) to authenticated;

-- 明細の直接書き換えは禁止する。代理店の入力は create_dealer_revision（改訂版の発行）だけを通す。
-- 発行済みの版を書き換えると合計が再計算されず、スナップショットが崩れるため。
drop policy if exists quote_items_dealer_write on public.quote_items;
