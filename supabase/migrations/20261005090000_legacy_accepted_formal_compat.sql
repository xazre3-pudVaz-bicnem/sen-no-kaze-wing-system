-- =============================================================
-- Legacy accepted preliminary -> formal Quote compatibility bridge
--
-- Purpose:
-- - recover only the historical Web dead-end where a preliminary Quote was
--   already accepted before acceptance eligibility was hardened;
-- - keep the accepted parent immutable;
-- - create a new formal / issued child Quote in one locked transaction;
-- - keep the normal issued -> revision lifecycle unchanged.
-- =============================================================

begin;

-- Read-only state used by the admin UI. It deliberately authorizes against
-- the Quote being viewed, and against the current Quote before exposing a
-- historical current_quote_id to a dealer.
create or replace function public.get_legacy_accepted_formalization_state(p_quote_id uuid)
returns table (
  state text,
  current_quote_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $formalization_state$
declare
  q public.quotes;
  r public.quote_requests;
  current_q public.quotes;
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  v_candidate boolean := false;
  v_web_consistent boolean := false;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  select * into q
    from public.quotes
   where id = p_quote_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if not (v_rank >= 3 or (v_rank >= 1 and q.dealer_id = v_uid)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into r
    from public.quote_requests
   where id = q.quote_request_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  v_candidate :=
    q.status = 'accepted'
    and (
      q.quote_kind = 'preliminary'
      or (q.quote_kind is null and q.parent_quote_id is null)
    );

  v_web_consistent :=
    q.configuration_id is not null
    and q.user_id is not null
    and q.dealer_id is not null
    and r.user_id is not distinct from q.user_id
    and r.configuration_id is not distinct from q.configuration_id
    and exists (
      select 1
        from public.configurations c
       where c.id = q.configuration_id
         and c.user_id = q.user_id
    );

  if r.quote_id is not distinct from q.id then
    if v_candidate and v_web_consistent then
      return query select 'eligible'::text, q.id;
    else
      return query select 'ineligible'::text, null::uuid;
    end if;
    return;
  end if;

  -- Historical label/link applies only to an accepted preliminary parent.
  if not v_candidate then
    return query select 'ineligible'::text, null::uuid;
    return;
  end if;

  select * into current_q
    from public.quotes
   where id = r.quote_id
     and quote_request_id = q.quote_request_id;

  if not found then
    return query select 'historical'::text, null::uuid;
    return;
  end if;

  -- Do not leak the next assignee's Quote ID to a former dealer.
  if v_rank < 3 and current_q.dealer_id is distinct from v_uid then
    return query select 'historical'::text, null::uuid;
    return;
  end if;

  if current_q.quote_kind = 'formal'
     or (current_q.quote_kind is null and current_q.parent_quote_id is not null) then
    return query select 'historical'::text, current_q.id;
  else
    return query select 'historical'::text, null::uuid;
  end if;
end;
$formalization_state$;

-- Dedicated compatibility RPC. Do not fold this behavior into the ordinary
-- create_quote_revision RPC: the parent here is accepted and must remain so.
create or replace function public.create_formal_quote_from_accepted_preliminary(
  p_quote_id uuid,
  p_installation_items jsonb,
  p_dealer_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $formalize_legacy_accepted$
declare
  parent public.quotes;
  req public.quote_requests;
  source_item public.quote_items;
  parent_item public.quote_items;
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  v_new uuid;
  v_sort integer := 0;
  v_seen_source_ids uuid[] := '{}'::uuid[];
  row_json jsonb;
  v_source_item_id uuid;
  v_name text;
  v_unit text;
  v_remark text;
  v_qty numeric;
  v_unit_price_raw numeric;
  v_unit_price integer;
  v_amount_numeric numeric;
  v_amount integer;
  v_base numeric := 0;
  v_base_exp numeric := 0;
  v_int numeric := 0;
  v_int_exp numeric := 0;
  v_opt numeric := 0;
  v_opt_exp numeric := 0;
  v_inst numeric := 0;
  v_sub_raw numeric;
  v_sub numeric;
  v_adjustment numeric;
  v_tax numeric;
  v_total numeric;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  -- Lock order is part of the concurrency contract: Quote first, then request.
  select * into parent
    from public.quotes
   where id = p_quote_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into req
    from public.quote_requests
   where id = parent.quote_request_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Re-check every eligibility condition after both locks are held.
  if parent.status <> 'accepted' then
    raise exception 'LOCKED: 対象は承諾済みの概算見積ではありません' using errcode = 'P0001';
  end if;

  if not (
    parent.quote_kind = 'preliminary'
    or (parent.quote_kind is null and parent.parent_quote_id is null)
  ) then
    raise exception 'LOCKED: 対象は互換処理できる概算見積ではありません' using errcode = 'P0001';
  end if;

  if req.quote_id is distinct from parent.id then
    raise exception 'LOCKED: この概算見積は現在の見積ではありません' using errcode = 'P0001';
  end if;

  if parent.configuration_id is null
     or parent.user_id is null
     or parent.dealer_id is null
     or req.user_id is distinct from parent.user_id
     or req.configuration_id is distinct from parent.configuration_id
     or not exists (
       select 1
         from public.configurations c
        where c.id = parent.configuration_id
          and c.user_id = parent.user_id
     ) then
    raise exception 'VALIDATION: QuoteRequest・顧客・Configurationの整合を確認できません'
      using errcode = 'P0001';
  end if;

  if not (v_rank >= 3 or (v_rank >= 1 and parent.dealer_id = v_uid)) then
    raise exception 'FORBIDDEN: この案件の確定見積を発行できません' using errcode = '42501';
  end if;

  if p_installation_items is null or jsonb_typeof(p_installation_items) <> 'array' then
    raise exception 'VALIDATION: 施工金額明細の形式が不正です' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_installation_items) > 100 then
    raise exception 'VALIDATION: 施工金額明細は100行以内にしてください' using errcode = 'P0001';
  end if;
  if length(coalesce(p_dealer_note, '')) > 1000 then
    raise exception 'VALIDATION: 申し送りは1000文字以内で入力してください' using errcode = 'P0001';
  end if;

  -- Recompute every carried line from the immutable parent values. Existing
  -- line_key (including NULL) and option_id are copied later without guessing.
  for parent_item in
    select *
      from public.quote_items item
     where item.quote_id = parent.id
     order by item.sort_order, item.id
  loop
    if parent_item.kind not in (
      'base', 'base_expense',
      'interior_exterior', 'interior_exterior_expense',
      'option', 'option_expense',
      'installation', 'free'
    ) then
      raise exception 'VALIDATION: 互換処理できない既存明細区分があります（%）', parent_item.kind
        using errcode = 'P0001';
    end if;

    if parent_item.kind = 'installation' then
      continue;
    end if;

    v_amount_numeric := round(parent_item.unit_price::numeric * parent_item.quantity);
    if v_amount_numeric < -2147483648 or v_amount_numeric > 2147483647 then
      raise exception 'VALIDATION: 既存明細金額が保存可能範囲を超えています' using errcode = 'P0001';
    end if;
    v_amount := v_amount_numeric::integer;

    if parent_item.kind = 'base' then
      v_base := v_base + v_amount;
    elsif parent_item.kind = 'base_expense' then
      v_base_exp := v_base_exp + v_amount;
    elsif parent_item.kind = 'interior_exterior' then
      v_int := v_int + v_amount;
    elsif parent_item.kind = 'interior_exterior_expense' then
      v_int_exp := v_int_exp + v_amount;
    elsif parent_item.kind = 'option' then
      v_opt := v_opt + v_amount;
    elsif parent_item.kind = 'option_expense' then
      v_opt_exp := v_opt_exp + v_amount;
    else
      -- free is part of the existing Web installation_subtotal contract.
      v_inst := v_inst + v_amount;
    end if;
  end loop;

  -- Validate and price the installation rows supplied by the site-check UI.
  for row_json in
    select item.value
      from jsonb_array_elements(p_installation_items) as item(value)
  loop
    begin
      v_source_item_id := nullif(row_json ->> 'source_item_id', '')::uuid;
      v_qty := coalesce((row_json ->> 'quantity')::numeric, 1);
      v_unit_price_raw := coalesce((row_json ->> 'unit_price')::numeric, 0);
    exception
      when invalid_text_representation then
        raise exception 'VALIDATION: 施工明細ID・数量・単価の形式が不正です' using errcode = 'P0001';
    end;

    if v_source_item_id is not null then
      if v_source_item_id = any(v_seen_source_ids) then
        raise exception 'VALIDATION: 同じ既存施工明細が重複しています' using errcode = 'P0001';
      end if;
      v_seen_source_ids := array_append(v_seen_source_ids, v_source_item_id);

      select * into source_item
        from public.quote_items item
       where item.id = v_source_item_id
         and item.quote_id = parent.id
         and item.kind = 'installation';
      if not found then
        raise exception 'VALIDATION: 既存施工明細の参照が不正です' using errcode = 'P0001';
      end if;
    end if;

    v_name := nullif(btrim(coalesce(row_json ->> 'name', '')), '');
    v_unit := nullif(btrim(coalesce(row_json ->> 'unit', '')), '');
    v_remark := nullif(btrim(coalesce(row_json ->> 'remark', '')), '');

    if v_name is null or length(v_name) > 120 then
      raise exception 'VALIDATION: 施工明細の品名は1〜120文字で入力してください' using errcode = 'P0001';
    end if;
    if length(coalesce(v_unit, '')) > 12 or length(coalesce(v_remark, '')) > 200 then
      raise exception 'VALIDATION: 施工明細の単位・備考が長すぎます' using errcode = 'P0001';
    end if;
    if v_qty::text in ('NaN', 'Infinity', '-Infinity')
       or v_qty < 0.01 or v_qty > 99999 or v_qty <> round(v_qty, 4) then
      raise exception 'VALIDATION: 数量は0.01以上99999以下・小数4桁以内で入力してください'
        using errcode = 'P0001';
    end if;
    if v_unit_price_raw::text in ('NaN', 'Infinity', '-Infinity')
       or v_unit_price_raw <> trunc(v_unit_price_raw)
       or v_unit_price_raw < 0
       or v_unit_price_raw > 100000000 then
      raise exception 'VALIDATION: 施工単価は0以上100000000以下の整数で入力してください'
        using errcode = 'P0001';
    end if;

    v_unit_price := v_unit_price_raw::integer;
    v_amount_numeric := round(v_unit_price_raw * v_qty);
    if v_amount_numeric < 0 or v_amount_numeric > 2147483647 then
      raise exception 'VALIDATION: 施工明細金額が保存可能範囲を超えています' using errcode = 'P0001';
    end if;
    v_inst := v_inst + v_amount_numeric;
  end loop;

  v_sub_raw := v_base + v_base_exp + v_int + v_int_exp + v_opt + v_opt_exp + v_inst;
  v_sub := floor(v_sub_raw / 1000.0) * 1000;
  v_adjustment := v_sub - v_sub_raw;
  v_tax := floor(v_sub * parent.tax_rate);
  v_total := v_sub + v_tax;

  if v_sub_raw < 0 or v_sub_raw > 2147483647
     or v_sub < 0 or v_sub > 2147483647
     or v_adjustment < -2147483648 or v_adjustment > 2147483647
     or v_tax < 0 or v_tax > 2147483647
     or v_total < 0 or v_total > 2147483647 then
    raise exception 'VALIDATION: 見積金額が保存可能範囲を超えています' using errcode = 'P0001';
  end if;

  insert into public.quotes(
    quote_no, quote_request_id, configuration_id, user_id,
    status, quote_kind, base_model_id, base_master_revision_id, spec_code,
    issued_at, valid_until,
    customer_no, customer_name, customer_company, base_model_name, finish_level,
    base_price, base_expense, option_subtotal, option_expense,
    installation_subtotal, adjustment, adjustment_reason,
    subtotal, tax_rate, tax, total,
    dealer_id, dealer_note, revision, parent_quote_id,
    preview_image_url, notes, created_by
  )
  values(
    parent.quote_no || '-' || (parent.revision + 1),
    parent.quote_request_id, parent.configuration_id, parent.user_id,
    'issued', 'formal', parent.base_model_id, parent.base_master_revision_id, parent.spec_code,
    now(), now() + interval '30 days',
    parent.customer_no, parent.customer_name, parent.customer_company,
    parent.base_model_name, parent.finish_level,
    v_base::integer, v_base_exp::integer,
    (v_int + v_opt)::integer, (v_int_exp + v_opt_exp)::integer,
    v_inst::integer, v_adjustment::integer, null,
    v_sub::integer, parent.tax_rate, v_tax::integer, v_total::integer,
    parent.dealer_id, nullif(btrim(coalesce(p_dealer_note, '')), ''),
    parent.revision + 1, parent.id,
    parent.preview_image_url,
    '本見積書は承諾済み概算見積を基に、現地確認後の施工金額を反映して作成した確定見積です。',
    v_uid
  )
  returning id into v_new;

  -- Carry every non-installation snapshot row with identity intact. Legacy
  -- NULL line_key stays NULL; existing non-NULL keys are copied as-is.
  insert into public.quote_items(
    quote_id, line_key, kind, option_id,
    name, description, unit, remark,
    unit_price, quantity, amount, image_url, sort_order
  )
  select
    v_new, item.line_key, item.kind, item.option_id,
    item.name, item.description, item.unit, item.remark,
    item.unit_price, item.quantity,
    round(item.unit_price::numeric * item.quantity)::integer,
    item.image_url, item.sort_order
    from public.quote_items item
   where item.quote_id = parent.id
     and item.kind <> 'installation';

  select coalesce(max(item.sort_order), 0)
    into v_sort
    from public.quote_items item
   where item.quote_id = v_new;

  -- Existing installation rows preserve their source identity; newly added
  -- rows get a new line_key. No name matching/backfill is performed.
  for row_json in
    select item.value
      from jsonb_array_elements(p_installation_items) as item(value)
  loop
    v_sort := v_sort + 1;
    v_source_item_id := nullif(row_json ->> 'source_item_id', '')::uuid;
    v_qty := coalesce((row_json ->> 'quantity')::numeric, 1);
    v_unit_price := coalesce((row_json ->> 'unit_price')::numeric, 0)::integer;
    v_name := btrim(row_json ->> 'name');
    v_unit := nullif(btrim(coalesce(row_json ->> 'unit', '')), '');
    v_remark := nullif(btrim(coalesce(row_json ->> 'remark', '')), '');

    if v_source_item_id is not null then
      select * into source_item
        from public.quote_items item
       where item.id = v_source_item_id
         and item.quote_id = parent.id
         and item.kind = 'installation';
    else
      source_item := null;
    end if;

    insert into public.quote_items(
      quote_id, line_key, kind, option_id,
      name, description, unit, remark,
      unit_price, quantity, amount, image_url, sort_order
    )
    values(
      v_new,
      case when v_source_item_id is not null then source_item.line_key else gen_random_uuid() end,
      'installation',
      case when v_source_item_id is not null then source_item.option_id else null end,
      v_name,
      case when v_source_item_id is not null then source_item.description else null end,
      coalesce(v_unit, '式'),
      v_remark,
      v_unit_price,
      v_qty,
      round(v_unit_price::numeric * v_qty)::integer,
      case when v_source_item_id is not null then source_item.image_url else null end,
      v_sort
    );
  end loop;

  -- Parent Quote remains accepted and immutable. Only the case current pointer
  -- moves to the new formal Quote. Configuration is deliberately not reopened.
  update public.quote_requests
     set quote_id = v_new,
         status = 'sent'
   where id = req.id;

  return v_new;
end;
$formalize_legacy_accepted$;

-- Align customer acceptance with the TypeScript domain rule:
-- explicit formal OR legacy NULL + valid parent lineage. Decline behavior is
-- intentionally unchanged.
create or replace function public.respond_to_quote(p_quote_id uuid, p_status text)
returns public.quotes
language plpgsql
security definer
set search_path = ''
as $respond_to_quote$
declare
  q public.quotes;
  v_current_quote_id uuid;
begin
  if p_status not in ('accepted', 'declined') then
    raise exception 'VALIDATION: 回答が不正です' using errcode = 'P0001';
  end if;

  select * into q
    from public.quotes
   where id = p_quote_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if q.user_id <> auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if q.status <> 'issued' then
    raise exception 'LOCKED: この見積にはすでに回答済みです（または改訂されています）' using errcode = 'P0001';
  end if;

  select quote_id into v_current_quote_id
    from public.quote_requests
   where id = q.quote_request_id
     and user_id = q.user_id
   for update;

  if not found or v_current_quote_id is distinct from q.id then
    raise exception 'LOCKED: この見積は最新の版ではありません' using errcode = 'P0001';
  end if;

  if p_status = 'accepted' and not (
    q.quote_kind = 'formal'
    or (
      q.quote_kind is null
      and q.parent_quote_id is not null
      and exists (
        select 1
          from public.quotes parent
         where parent.id = q.parent_quote_id
           and parent.quote_request_id = q.quote_request_id
           and parent.user_id = q.user_id
      )
    )
  ) then
    raise exception 'LOCKED: 現地条件と施工金額を反映した確定見積の発行後に承諾できます'
      using errcode = 'P0001';
  end if;

  update public.quotes set status = p_status where id = p_quote_id returning * into q;
  update public.configurations set status = 'closed' where id = q.configuration_id;
  return q;
end;
$respond_to_quote$;

alter function public.get_legacy_accepted_formalization_state(uuid) owner to postgres;
alter function public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text) owner to postgres;
alter function public.respond_to_quote(uuid, text) owner to postgres;

do $owner_check$
begin
  if exists (
    select 1
      from pg_catalog.pg_proc p
     where p.oid in (
       'public.get_legacy_accepted_formalization_state(uuid)'::regprocedure,
       'public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)'::regprocedure,
       'public.respond_to_quote(uuid, text)'::regprocedure
     )
       and pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
  ) then
    raise exception 'LEGACY_ACCEPTED_FORMAL_COMPAT_OWNER_INVALID: RPC owner must be postgres'
      using errcode = 'P0001';
  end if;
end;
$owner_check$;

revoke execute on function public.get_legacy_accepted_formalization_state(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_legacy_accepted_formalization_state(uuid) to authenticated;

revoke execute on function public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text) to authenticated;

revoke execute on function public.respond_to_quote(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.respond_to_quote(uuid, text) to authenticated;

comment on function public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text) is
  'Compatibility-only bridge: current accepted Web preliminary -> new formal issued Quote. Parent remains unchanged.';

commit;
