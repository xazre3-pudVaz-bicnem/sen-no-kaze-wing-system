-- =============================================================
-- Non-Web Quote Revision 2+ Draft lifecycle
--
-- Responsibility:
--   current formal non-Web Revision -> editable Draft
--   repeated Draft saves with stable line identity
--   Draft finalize -> immutable formal Revision N+1
--
-- Existing Web Configuration-based revision flow is intentionally unchanged.
-- =============================================================

begin;

create unique index if not exists quotes_non_web_request_revision_uidx
  on public.quotes(quote_request_id, revision)
  where configuration_id is null;

create or replace function public.create_quote_revision_draft(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $create_revision_draft$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  parent public.quotes;
  r public.quote_requests;
  v_existing public.quote_drafts;
  v_draft_id uuid;
  v_item_sum numeric;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 1 then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into parent
    from public.quotes
   where id = p_quote_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if parent.configuration_id is not null
     or parent.user_id is not null
     or parent.quote_kind is distinct from 'formal' then
    raise exception 'VALIDATION: このDraft lifecycleは非Web formal Quote専用です'
      using errcode = 'P0001';
  end if;
  if parent.base_model_id is null
     or parent.base_master_revision_id is null
     or parent.spec_code is null then
    raise exception 'VALIDATION: 親Revisionのsnapshot情報が不足しています'
      using errcode = 'P0001';
  end if;
  if parent.status <> 'issued' then
    raise exception 'LOCKED: 改訂できるのは現在発行中の見積だけです'
      using errcode = 'P0001';
  end if;
  if v_rank < 3 and parent.dealer_id is distinct from v_uid then
    raise exception 'FORBIDDEN: この見積を改訂できません' using errcode = '42501';
  end if;

  select * into r
    from public.quote_requests
   where id = parent.quote_request_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.quote_id is distinct from parent.id then
    raise exception 'LOCKED: 最新Revisionから改訂してください' using errcode = 'P0001';
  end if;

  -- The QuoteRequest lock above serializes Draft creation. Do not lock an
  -- existing Draft here: save/finalize lock Draft -> parent Quote -> Request,
  -- so taking parent/request -> Draft would introduce a lock-order inversion.
  select * into v_existing
    from public.quote_drafts
   where quote_request_id = r.id;

  if found then
    if v_existing.parent_quote_id is distinct from parent.id then
      raise exception 'LOCKED: この案件には別Revisionを親にしたDraftがあります'
        using errcode = 'P0001';
    end if;
    if v_rank < 3 and v_existing.created_by is distinct from v_uid then
      raise exception 'FORBIDDEN: このDraftを編集できません' using errcode = '42501';
    end if;
    return v_existing.id;
  end if;

  if not exists (
    select 1 from public.quote_items item where item.quote_id = parent.id
  ) then
    raise exception 'VALIDATION: 親Revisionに明細がありません' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.quote_items item
     where item.quote_id = parent.id
       and item.line_key is null
  ) then
    raise exception 'VALIDATION: 親Revisionにline_key未設定の明細があります'
      using errcode = 'P0001';
  end if;
  if exists (
    select item.line_key
      from public.quote_items item
     where item.quote_id = parent.id
     group by item.line_key
    having count(*) > 1
  ) then
    raise exception 'VALIDATION: 親Revisionのline_keyが重複しています'
      using errcode = 'P0001';
  end if;

  select coalesce(sum(item.amount), 0)
    into v_item_sum
    from public.quote_items item
   where item.quote_id = parent.id;

  if v_item_sum <> parent.subtotal - parent.adjustment then
    raise exception 'VALIDATION: 親Revisionの明細合計と保存済み金額が一致しません'
      using errcode = 'P0001';
  end if;

  insert into public.quote_drafts(
    quote_request_id, parent_quote_id, base_model_id, base_master_revision_id,
    spec_code, quote_kind, finish_level, tax_rate, adjustment, adjustment_reason,
    subtotal_raw, subtotal, tax, total, lock_version, dealer_note, notes,
    created_by, updated_by
  )
  values(
    parent.quote_request_id, parent.id, parent.base_model_id,
    parent.base_master_revision_id, parent.spec_code, 'formal',
    parent.finish_level, parent.tax_rate, parent.adjustment,
    parent.adjustment_reason, v_item_sum::integer, parent.subtotal,
    parent.tax, parent.total, 0, parent.dealer_note, parent.notes, v_uid, v_uid
  )
  returning id into v_draft_id;

  insert into public.quote_draft_items(
    draft_id, line_key, kind, option_id, name, description, unit, remark,
    unit_price, quantity, amount, image_url, sort_order
  )
  select
    v_draft_id, item.line_key, item.kind, item.option_id, item.name,
    item.description, item.unit, item.remark, item.unit_price, item.quantity,
    item.amount, item.image_url, item.sort_order
  from public.quote_items item
  where item.quote_id = parent.id
  order by item.sort_order, item.id;

  return v_draft_id;
end;
$create_revision_draft$;

create or replace function public.save_quote_draft(
  p_draft_id uuid,
  p_expected_lock_version integer,
  p_base_master_revision_id uuid,
  p_items jsonb,
  p_adjustment integer,
  p_adjustment_reason text,
  p_dealer_note text,
  p_notes text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $save_draft$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  d public.quote_drafts;
  parent public.quotes;
  r public.quote_requests;
  v_parent_item public.quote_items;
  v_existing_item public.quote_draft_items;
  v_has_parent_item boolean;
  v_has_existing_item boolean;
  v_base_master_id uuid;
  v_count integer := 0;
  v_sort integer := 0;
  v_seen_line_keys uuid[] := '{}'::uuid[];
  row_json jsonb;
  v_line_key uuid;
  v_option_id uuid;
  v_kind text;
  v_name text;
  v_qty numeric;
  v_unit_price_raw numeric;
  v_unit_price integer;
  v_amount_numeric numeric;
  v_amount integer;
  v_subtotal_raw numeric := 0;
  v_subtotal numeric;
  v_tax numeric;
  v_total numeric;
  v_adjustment integer := coalesce(p_adjustment, 0);
  v_reason text := nullif(btrim(coalesce(p_adjustment_reason, '')), '');
  v_new_lock_version integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 1 then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into d
    from public.quote_drafts
   where id = p_draft_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_rank < 3 and d.created_by is distinct from v_uid then
    raise exception 'FORBIDDEN: このDraftを編集できません' using errcode = '42501';
  end if;
  if d.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でDraftが更新されています。再読み込みしてください'
      using errcode = 'P0001';
  end if;

  if d.parent_quote_id is not null then
    select * into parent
      from public.quotes
     where id = d.parent_quote_id
       and quote_request_id = d.quote_request_id
     for update;

    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if parent.configuration_id is not null
       or parent.user_id is not null
       or parent.quote_kind is distinct from 'formal' then
      raise exception 'VALIDATION: Revision Draftの親Quoteが不正です'
        using errcode = 'P0001';
    end if;
    if parent.status <> 'issued' then
      raise exception 'LOCKED: 親Revisionはすでに発行中ではありません'
        using errcode = 'P0001';
    end if;
    if v_rank < 3 and parent.dealer_id is distinct from v_uid then
      raise exception 'FORBIDDEN: この見積を改訂できません' using errcode = '42501';
    end if;

    select * into r
      from public.quote_requests
     where id = d.quote_request_id
     for update;

    if not found or r.quote_id is distinct from parent.id then
      raise exception 'LOCKED: 最新Revisionから改訂してください' using errcode = 'P0001';
    end if;
  end if;

  if p_base_master_revision_id is not null then
    select rev.base_master_id into v_base_master_id
      from public.base_master_revisions rev
      join public.base_masters master on master.id = rev.base_master_id
     where rev.id = p_base_master_revision_id
       and rev.status in ('published', 'superseded')
       and master.base_model_id = d.base_model_id;

    if not found then
      raise exception 'VALIDATION: この本体Revisionは案件に使用できません'
        using errcode = 'P0001';
    end if;

    if not (
      d.parent_quote_id is not null
      and p_base_master_revision_id is not distinct from parent.base_master_revision_id
    ) and not public.can_use_base_master(v_base_master_id) then
      raise exception 'FORBIDDEN: この本体Revisionは案件に使用できません'
        using errcode = '42501';
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'VALIDATION: 明細データが不正です' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 300 then
    raise exception 'VALIDATION: 明細は300行以内にしてください' using errcode = 'P0001';
  end if;

  update public.quote_draft_items
     set sort_order = sort_order + 1000
   where draft_id = d.id;

  for row_json in
    select item.value
      from jsonb_array_elements(p_items) as item(value)
  loop
    v_sort := v_sort + 1;
    v_kind := row_json ->> 'kind';
    if v_kind not in (
      'base', 'base_expense',
      'interior_exterior', 'interior_exterior_expense',
      'option', 'option_expense',
      'installation', 'free'
    ) then
      raise exception 'VALIDATION: 明細区分が不正です（%）', v_kind using errcode = 'P0001';
    end if;

    v_name := nullif(btrim(coalesce(row_json ->> 'name', '')), '');
    if v_name is null or length(v_name) > 120 then
      raise exception 'VALIDATION: 品名は1〜120文字で入力してください' using errcode = 'P0001';
    end if;
    if length(coalesce(row_json ->> 'description', '')) > 200
       or length(coalesce(row_json ->> 'remark', '')) > 200
       or length(coalesce(row_json ->> 'unit', '')) > 12
       or length(coalesce(row_json ->> 'image_url', '')) > 500 then
      raise exception 'VALIDATION: 明細の説明・単位・備考・画像URLが長すぎます'
        using errcode = 'P0001';
    end if;

    begin
      v_line_key := coalesce(nullif(row_json ->> 'line_key', '')::uuid, gen_random_uuid());
      v_option_id := nullif(row_json ->> 'option_id', '')::uuid;
      v_qty := coalesce((row_json ->> 'quantity')::numeric, 1);
      v_unit_price_raw := coalesce((row_json ->> 'unit_price')::numeric, 0);
    exception
      when invalid_text_representation then
        raise exception 'VALIDATION: 明細ID・商品ID・数量・単価の形式が不正です'
          using errcode = 'P0001';
    end;

    if v_line_key = any(v_seen_line_keys) then
      raise exception 'VALIDATION: 同じline_keyの明細が重複しています'
        using errcode = 'P0001';
    end if;
    v_seen_line_keys := array_append(v_seen_line_keys, v_line_key);

    if v_qty::text in ('NaN', 'Infinity', '-Infinity')
       or v_qty < 0.01 or v_qty > 99999 or v_qty <> round(v_qty, 4) then
      raise exception 'VALIDATION: 数量は0.01以上99999以下・小数4桁以内で入力してください'
        using errcode = 'P0001';
    end if;
    if v_unit_price_raw::text in ('NaN', 'Infinity', '-Infinity')
       or v_unit_price_raw <> trunc(v_unit_price_raw)
       or v_unit_price_raw < -100000000
       or v_unit_price_raw > 100000000 then
      raise exception 'VALIDATION: 単価は整数かつ-100000000以上100000000以下で入力してください'
        using errcode = 'P0001';
    end if;

    v_unit_price := v_unit_price_raw::integer;
    if v_unit_price < 0 then
      raise exception 'VALIDATION: 明細単価は0円以上で入力し、値引きは調整額を使用してください'
        using errcode = 'P0001';
    end if;

    v_has_parent_item := false;
    if d.parent_quote_id is not null then
      select * into v_parent_item
        from public.quote_items item
       where item.quote_id = parent.id
         and item.line_key = v_line_key;
      v_has_parent_item := found;
    end if;

    select * into v_existing_item
      from public.quote_draft_items item
     where item.draft_id = d.id
       and item.line_key = v_line_key;
    v_has_existing_item := found;

    if not v_has_parent_item
       and not v_has_existing_item
       and (
         exists (select 1 from public.quote_items item where item.line_key = v_line_key)
         or exists (
           select 1 from public.quote_draft_items item
            where item.line_key = v_line_key
              and item.draft_id <> d.id
         )
       ) then
      raise exception 'VALIDATION: 他の見積系列のline_keyは使用できません'
        using errcode = 'P0001';
    end if;

    if v_option_id is not null
       and not (
         v_has_parent_item
         and v_parent_item.option_id is not distinct from v_option_id
       )
       and not exists (
         select 1
           from public.options o
          where o.id = v_option_id
            and o.status = 'published'
            and (o.base_model_id is null or o.base_model_id = d.base_model_id)
       ) then
      raise exception 'VALIDATION: この商品モデルで利用できる公開商品を指定してください'
        using errcode = 'P0001';
    end if;

    if v_has_parent_item
       and v_parent_item.unit_price = v_unit_price
       and v_parent_item.quantity = v_qty then
      v_amount := v_parent_item.amount;
    else
      v_amount_numeric := round(v_unit_price_raw * v_qty);
      if v_amount_numeric < -2147483648 or v_amount_numeric > 2147483647 then
        raise exception 'VALIDATION: 明細金額が保存可能範囲を超えています'
          using errcode = 'P0001';
      end if;
      v_amount := v_amount_numeric::integer;
    end if;

    v_subtotal_raw := v_subtotal_raw + v_amount;

    insert into public.quote_draft_items(
      draft_id, line_key, kind, option_id, name, description, unit, remark,
      unit_price, quantity, amount, image_url, sort_order
    )
    values(
      d.id, v_line_key, v_kind, v_option_id, v_name,
      nullif(btrim(coalesce(row_json ->> 'description', '')), ''),
      nullif(btrim(coalesce(row_json ->> 'unit', '')), ''),
      nullif(btrim(coalesce(row_json ->> 'remark', '')), ''),
      v_unit_price, v_qty, v_amount,
      nullif(btrim(coalesce(row_json ->> 'image_url', '')), ''),
      v_sort
    )
    on conflict (draft_id, line_key) do update
      set kind = excluded.kind,
          option_id = excluded.option_id,
          name = excluded.name,
          description = excluded.description,
          unit = excluded.unit,
          remark = excluded.remark,
          unit_price = excluded.unit_price,
          quantity = excluded.quantity,
          amount = excluded.amount,
          image_url = excluded.image_url,
          sort_order = excluded.sort_order;
  end loop;

  if array_length(v_seen_line_keys, 1) is null then
    delete from public.quote_draft_items where draft_id = d.id;
  else
    delete from public.quote_draft_items
     where draft_id = d.id
       and not (line_key = any(v_seen_line_keys));
  end if;

  if v_adjustment <> 0 and v_reason is null then
    raise exception 'VALIDATION: 調整額を設定する場合は理由を入力してください'
      using errcode = 'P0001';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'VALIDATION: 調整理由は500文字以内で入力してください' using errcode = 'P0001';
  end if;
  if length(coalesce(p_dealer_note, '')) > 1000
     or length(coalesce(p_notes, '')) > 1000 then
    raise exception 'VALIDATION: メモは1000文字以内で入力してください' using errcode = 'P0001';
  end if;

  v_subtotal := v_subtotal_raw + v_adjustment;
  if v_subtotal_raw < 0 or v_subtotal_raw > 2147483647
     or v_subtotal < 0 or v_subtotal > 2147483647 then
    raise exception 'VALIDATION: 見積金額が保存可能範囲を超えています'
      using errcode = 'P0001';
  end if;

  v_tax := floor(v_subtotal * d.tax_rate);
  v_total := v_subtotal + v_tax;
  if v_tax < 0 or v_tax > 2147483647
     or v_total < 0 or v_total > 2147483647 then
    raise exception 'VALIDATION: 税額または税込金額が保存可能範囲を超えています'
      using errcode = 'P0001';
  end if;

  update public.quote_drafts
     set base_master_revision_id = p_base_master_revision_id,
         adjustment = v_adjustment,
         adjustment_reason = v_reason,
         subtotal_raw = v_subtotal_raw::integer,
         subtotal = v_subtotal::integer,
         tax = v_tax::integer,
         total = v_total::integer,
         dealer_note = nullif(btrim(coalesce(p_dealer_note, '')), ''),
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         lock_version = lock_version + 1,
         updated_by = v_uid
   where id = d.id
  returning lock_version into v_new_lock_version;

  return v_new_lock_version;
end;
$save_draft$;

create or replace function public.guard_non_web_revision_path()
returns trigger
language plpgsql
set search_path = ''
as $non_web_revision_guard$
declare
  parent public.quotes;
begin
  if new.parent_quote_id is null then
    return new;
  end if;

  select * into parent
    from public.quotes
   where id = new.parent_quote_id;

  if found and parent.configuration_id is null then
    if new.configuration_id is not null
       or new.user_id is not null
       or new.quote_request_id is distinct from parent.quote_request_id
       or new.revision is distinct from parent.revision + 1
       or new.quote_kind is distinct from 'formal'
       or new.base_model_id is distinct from parent.base_model_id
       or new.base_master_revision_id is null
       or new.spec_code is distinct from parent.spec_code
       or new.created_by is null then
      raise exception 'LOCKED: 非Web案件の改訂はRevision Draft lifecycleから行ってください'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$non_web_revision_guard$;

create or replace function public.finalize_quote_revision_draft(
  p_draft_id uuid,
  p_expected_lock_version integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $finalize_revision_draft$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  d public.quote_drafts;
  parent public.quotes;
  r public.quote_requests;
  v_parent_item public.quote_items;
  v_has_parent_item boolean;
  v_base_master_id uuid;
  v_quote_id uuid;
  v_root_quote_no text;
  v_next_revision integer;
  v_quote_no text;
  v_base numeric := 0;
  v_base_exp numeric := 0;
  v_int numeric := 0;
  v_int_exp numeric := 0;
  v_opt numeric := 0;
  v_opt_exp numeric := 0;
  v_inst numeric := 0;
  v_subtotal_raw numeric := 0;
  v_subtotal numeric;
  v_tax numeric;
  v_total numeric;
  i public.quote_draft_items;
  v_expected_amount numeric;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 1 then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into d
    from public.quote_drafts
   where id = p_draft_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if d.parent_quote_id is null then
    raise exception 'VALIDATION: このRPCはRevision 2以降のDraft専用です'
      using errcode = 'P0001';
  end if;
  if v_rank < 3 and d.created_by is distinct from v_uid then
    raise exception 'FORBIDDEN: このDraftを正式保存できません' using errcode = '42501';
  end if;
  if d.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でDraftが更新されています。再読み込みしてください'
      using errcode = 'P0001';
  end if;
  if d.quote_kind <> 'formal' then
    raise exception 'VALIDATION: 改訂見積はformalとして保存してください'
      using errcode = 'P0001';
  end if;
  if d.base_master_revision_id is null then
    raise exception 'VALIDATION: 正式保存前に基準本体Revisionを選択してください'
      using errcode = 'P0001';
  end if;

  select * into parent
    from public.quotes
   where id = d.parent_quote_id
     and quote_request_id = d.quote_request_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if parent.configuration_id is not null
     or parent.user_id is not null
     or parent.quote_kind is distinct from 'formal' then
    raise exception 'VALIDATION: Revision Draftの親Quoteが不正です'
      using errcode = 'P0001';
  end if;
  if parent.status <> 'issued' then
    raise exception 'LOCKED: 親Revisionはすでに発行中ではありません'
      using errcode = 'P0001';
  end if;
  if d.base_model_id is distinct from parent.base_model_id
     or d.spec_code is distinct from parent.spec_code then
    raise exception 'VALIDATION: Draftと親Revisionのモデル・仕様が一致しません'
      using errcode = 'P0001';
  end if;
  if v_rank < 3 and parent.dealer_id is distinct from v_uid then
    raise exception 'FORBIDDEN: この見積を改訂できません' using errcode = '42501';
  end if;

  select * into r
    from public.quote_requests
   where id = d.quote_request_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.quote_id is distinct from parent.id then
    raise exception 'LOCKED: 最新Revisionから改訂してください' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.quotes child where child.parent_quote_id = parent.id
  ) then
    raise exception 'LOCKED: 親Revisionにはすでに次のRevisionがあります'
      using errcode = 'P0001';
  end if;

  select rev.base_master_id into v_base_master_id
    from public.base_master_revisions rev
    join public.base_masters master on master.id = rev.base_master_id
   where rev.id = d.base_master_revision_id
     and rev.status in ('published', 'superseded')
     and master.base_model_id = d.base_model_id;

  if not found then
    raise exception 'VALIDATION: この本体Revisionは案件に使用できません'
      using errcode = 'P0001';
  end if;
  if d.base_master_revision_id is distinct from parent.base_master_revision_id
     and not public.can_use_base_master(v_base_master_id) then
    raise exception 'FORBIDDEN: この本体Revisionは案件に使用できません'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.quote_draft_items item where item.draft_id = d.id
  ) then
    raise exception 'VALIDATION: 明細を1行以上保存してから正式保存してください'
      using errcode = 'P0001';
  end if;

  for i in
    select * from public.quote_draft_items
     where draft_id = d.id
     order by sort_order, id
  loop
    if i.quantity < 0.01 or i.quantity > 99999 or i.quantity <> round(i.quantity, 4) then
      raise exception 'VALIDATION: Draftに不正な数量があります' using errcode = 'P0001';
    end if;

    select * into v_parent_item
      from public.quote_items item
     where item.quote_id = parent.id
       and item.line_key = i.line_key;
    v_has_parent_item := found;

    if v_has_parent_item
       and v_parent_item.unit_price = i.unit_price
       and v_parent_item.quantity = i.quantity then
      v_expected_amount := v_parent_item.amount;
    else
      v_expected_amount := round(i.unit_price::numeric * i.quantity);
    end if;

    if v_expected_amount <> i.amount then
      raise exception 'VALIDATION: Draft明細金額がDB検証値と一致しません'
        using errcode = 'P0001';
    end if;

    if i.kind = 'base' then
      v_base := v_base + i.amount;
    elsif i.kind = 'base_expense' then
      v_base_exp := v_base_exp + i.amount;
    elsif i.kind = 'interior_exterior' then
      v_int := v_int + i.amount;
    elsif i.kind = 'interior_exterior_expense' then
      v_int_exp := v_int_exp + i.amount;
    elsif i.kind = 'option' then
      v_opt := v_opt + i.amount;
    elsif i.kind = 'option_expense' then
      v_opt_exp := v_opt_exp + i.amount;
    else
      v_inst := v_inst + i.amount;
    end if;
  end loop;

  if greatest(
       abs(v_base), abs(v_base_exp), abs(v_int), abs(v_int_exp),
       abs(v_opt), abs(v_opt_exp), abs(v_inst)
     ) > 2147483647 then
    raise exception 'VALIDATION: 区分別金額が保存可能範囲を超えています'
      using errcode = 'P0001';
  end if;

  v_subtotal_raw := v_base + v_base_exp + v_int + v_int_exp + v_opt + v_opt_exp + v_inst;
  v_subtotal := v_subtotal_raw + d.adjustment;
  v_tax := floor(v_subtotal * d.tax_rate);
  v_total := v_subtotal + v_tax;

  if v_subtotal_raw <> d.subtotal_raw
     or v_subtotal <> d.subtotal
     or v_tax <> d.tax
     or v_total <> d.total then
    raise exception 'VALIDATION: Draft合計がDB再計算値と一致しません'
      using errcode = 'P0001';
  end if;

  v_next_revision := parent.revision + 1;

  select root.quote_no into v_root_quote_no
    from public.quotes root
   where root.quote_request_id = r.id
     and root.configuration_id is null
     and root.revision = 1;

  if not found then
    raise exception 'VALIDATION: Revision 1が見つかりません' using errcode = 'P0001';
  end if;

  v_quote_no := v_root_quote_no || '-' || v_next_revision::text;

  insert into public.quotes(
    quote_no, quote_request_id, configuration_id, user_id, status, issued_at,
    valid_until, customer_no, customer_name, customer_company, base_model_name,
    finish_level, base_price, base_expense, option_subtotal, option_expense,
    installation_subtotal, adjustment, subtotal, tax_rate, tax, total,
    preview_image_url, notes, dealer_id, dealer_note, revision, parent_quote_id,
    quote_kind, base_model_id, base_master_revision_id, spec_code,
    adjustment_reason, created_by
  )
  values(
    v_quote_no, r.id, null, null, 'issued', now(), now() + interval '30 days',
    parent.customer_no, parent.customer_name, parent.customer_company,
    parent.base_model_name, d.finish_level, v_base::integer, v_base_exp::integer,
    (v_int + v_opt)::integer, (v_int_exp + v_opt_exp)::integer, v_inst::integer,
    d.adjustment, v_subtotal::integer, d.tax_rate, v_tax::integer,
    v_total::integer, parent.preview_image_url, d.notes, parent.dealer_id,
    d.dealer_note, v_next_revision, parent.id, 'formal', d.base_model_id,
    d.base_master_revision_id, d.spec_code, d.adjustment_reason, v_uid
  )
  returning id into v_quote_id;

  insert into public.quote_items(
    quote_id, line_key, kind, option_id, name, description, unit, remark,
    unit_price, quantity, amount, image_url, sort_order
  )
  select
    v_quote_id, item.line_key, item.kind, item.option_id, item.name,
    item.description, item.unit, item.remark, item.unit_price, item.quantity,
    item.amount, item.image_url, item.sort_order
  from public.quote_draft_items item
  where item.draft_id = d.id
  order by item.sort_order, item.id;

  update public.quotes
     set status = 'superseded'
   where id = parent.id;

  update public.quote_requests
     set quote_id = v_quote_id,
         status = 'reviewing'
   where id = r.id;

  delete from public.quote_drafts
   where id = d.id;

  return v_quote_id;
end;
$finalize_revision_draft$;

alter function public.create_quote_revision_draft(uuid) owner to postgres;
alter function public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text) owner to postgres;
alter function public.finalize_quote_revision_draft(uuid, integer) owner to postgres;

do $owner_check$
begin
  if exists (
    select 1
      from pg_catalog.pg_proc p
     where p.oid in (
       'public.create_quote_revision_draft(uuid)'::regprocedure,
       'public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text)'::regprocedure,
       'public.finalize_quote_revision_draft(uuid, integer)'::regprocedure
     )
       and pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
  ) then
    raise exception 'QUOTE_REVISION_DRAFT_OWNER_INVALID: RPC owner must be postgres'
      using errcode = 'P0001';
  end if;
end;
$owner_check$;

revoke execute on function public.create_quote_revision_draft(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.finalize_quote_revision_draft(uuid, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.guard_non_web_revision_path()
  from public, anon, authenticated, service_role;

grant execute on function public.create_quote_revision_draft(uuid) to authenticated;
grant execute on function public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text) to authenticated;
grant execute on function public.finalize_quote_revision_draft(uuid, integer) to authenticated;

comment on function public.create_quote_revision_draft(uuid) is
  '現在の非Web formal Quote Revisionを親に、line_keyと保存済みamountを保持した編集Draftを作成・再開する。';
comment on function public.finalize_quote_revision_draft(uuid, integer) is
  '非Web Revision Draftを親Revision Nからformal Revision N+1へtransaction内で確定する。';

commit;
