-- =============================================================
-- Non-Web Quote Draft lifecycle
--
-- Responsibility:
--   manual case -> quote_request + empty Draft
--   Draft save (optimistic lock + DB money authority)
--   Draft finalize -> immutable formal Quote Revision 1
--
-- Existing Web Configuration -> preliminary Quote flow is intentionally
-- unchanged in this migration.
-- Draft access follows the current staff boundary:
--   admin: all Drafts / master_dealer+dealer: only Drafts they created.
-- =============================================================

begin;

-- Non-Web cases do not have a customer account or Configuration.
alter table public.quote_requests
  alter column configuration_id drop not null,
  alter column user_id drop not null,
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.quotes
  alter column configuration_id drop not null,
  alter column user_id drop not null;

alter table public.quote_drafts
  add column if not exists finish_level text not null default 'full'
    check (finish_level in ('shell', 'equipment', 'full'));

create index if not exists quote_requests_created_by_idx
  on public.quote_requests(created_by, created_at desc)
  where created_by is not null;

comment on column public.quote_requests.created_by is
  '非Web案件を登録したスタッフ。customer user_idとは別の監査・Draft権限用identity。';

-- -------------------------------------------------------------
-- Manual case creation: request + empty Draft, no Configuration / Quote.
-- -------------------------------------------------------------
create or replace function public.create_manual_quote_case(
  p_contact jsonb,
  p_message text,
  p_base_model_id uuid,
  p_spec_code text,
  p_finish_level text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $manual_case$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  v_model public.base_models;
  v_request_id uuid;
  v_draft_id uuid;
  v_full_name text;
  v_company_name text;
  v_site_address text;
  v_message text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 1 then
    raise exception 'FORBIDDEN: 案件を登録できるのは代理店以上です' using errcode = '42501';
  end if;

  if p_contact is null or jsonb_typeof(p_contact) <> 'object' then
    raise exception 'VALIDATION: お客様情報が不正です' using errcode = 'P0001';
  end if;

  v_full_name := nullif(btrim(coalesce(p_contact ->> 'full_name', '')), '');
  v_company_name := nullif(btrim(coalesce(p_contact ->> 'company_name', '')), '');
  v_site_address := nullif(btrim(coalesce(p_contact ->> 'site_address', '')), '');
  v_message := nullif(btrim(coalesce(p_message, '')), '');

  if v_full_name is null or length(v_full_name) > 60 then
    raise exception 'VALIDATION: お客様名は1〜60文字で入力してください' using errcode = 'P0001';
  end if;
  if v_company_name is not null and length(v_company_name) > 100 then
    raise exception 'VALIDATION: 会社名は100文字以内で入力してください' using errcode = 'P0001';
  end if;
  if v_site_address is not null and length(v_site_address) > 200 then
    raise exception 'VALIDATION: 設置予定地は200文字以内で入力してください' using errcode = 'P0001';
  end if;
  if v_message is not null and length(v_message) > 1000 then
    raise exception 'VALIDATION: メモは1000文字以内で入力してください' using errcode = 'P0001';
  end if;

  if p_finish_level not in ('shell', 'equipment', 'full') then
    raise exception 'VALIDATION: 注文範囲が不正です' using errcode = 'P0001';
  end if;
  if p_spec_code is null
     or p_spec_code = ''
     or p_spec_code <> lower(p_spec_code)
     or p_spec_code <> btrim(p_spec_code)
     or p_spec_code ~ '[[:space:]]' then
    raise exception 'VALIDATION: 仕様コードが不正です' using errcode = 'P0001';
  end if;

  select * into v_model
    from public.base_models
   where id = p_base_model_id
     and status = 'published';

  if not found then
    raise exception 'VALIDATION: 公開中の商品モデルを指定してください' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from jsonb_array_elements(coalesce(v_model.presets, '[]'::jsonb)) as preset(value)
     where preset.value ->> 'code' = p_spec_code
  ) then
    raise exception 'VALIDATION: 選択した商品モデルに存在しない仕様です' using errcode = 'P0001';
  end if;

  insert into public.quote_requests(
    configuration_id,
    user_id,
    quote_id,
    status,
    message,
    contact,
    created_by
  )
  values(
    null,
    null,
    null,
    'reviewing',
    v_message,
    jsonb_build_object(
      'full_name', v_full_name,
      'company_name', v_company_name,
      'email', '',
      'phone', '',
      'address', '',
      'site_address', v_site_address
    ),
    v_uid
  )
  returning id into v_request_id;

  insert into public.quote_drafts(
    quote_request_id,
    parent_quote_id,
    base_model_id,
    base_master_revision_id,
    spec_code,
    quote_kind,
    finish_level,
    tax_rate,
    adjustment,
    subtotal_raw,
    subtotal,
    tax,
    total,
    lock_version,
    dealer_note,
    notes,
    created_by,
    updated_by
  )
  values(
    v_request_id,
    null,
    p_base_model_id,
    null,
    p_spec_code,
    'formal',
    p_finish_level,
    0.10,
    0,
    0,
    0,
    0,
    0,
    0,
    null,
    v_message,
    v_uid,
    v_uid
  )
  returning id into v_draft_id;

  return v_draft_id;
end;
$manual_case$;

-- -------------------------------------------------------------
-- Read Draft through the same authorization boundary as writes.
-- Direct table SELECT remains closed by PR #275.
-- -------------------------------------------------------------
create or replace function public.get_quote_draft(p_draft_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $get_draft$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  d public.quote_drafts;
  r public.quote_requests;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 1 then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into d
    from public.quote_drafts
   where id = p_draft_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if not (v_rank >= 3 or d.created_by = v_uid) then
    raise exception 'FORBIDDEN: このDraftを編集できません' using errcode = '42501';
  end if;

  select * into r
    from public.quote_requests
   where id = d.quote_request_id;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'draft', to_jsonb(d),
    'request', jsonb_build_object(
      'id', r.id,
      'status', r.status,
      'message', r.message,
      'contact', r.contact,
      'created_by', r.created_by,
      'created_at', r.created_at,
      'updated_at', r.updated_at
    ),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.sort_order, i.id)
        from public.quote_draft_items i
       where i.draft_id = d.id
    ), '[]'::jsonb),
    'base_revisions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', rev.id,
          'base_master_id', master.id,
          'master_name', master.name,
          'fire_spec_code', master.fire_spec_code,
          'version', rev.version,
          'total', rev.total
        )
        order by
          case master.fire_spec_code when 'non_fire' then 0 else 1 end,
          master.name,
          rev.version desc
      )
        from public.base_masters master
        join public.base_master_revisions rev
          on rev.base_master_id = master.id
       where master.base_model_id = d.base_model_id
         and master.status = 'active'
         and rev.status in ('published', 'superseded')
         and (
           rev.id = master.current_published_revision_id
           or rev.id = d.base_master_revision_id
         )
         and public.can_use_base_master(master.id)
    ), '[]'::jsonb)
  );
end;
$get_draft$;

-- -------------------------------------------------------------
-- Save Draft.
-- Whole-line replacement and all money arithmetic happen in one transaction.
-- -------------------------------------------------------------
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
  v_base_master_id uuid;
  v_count integer := 0;
  v_sort integer := 0;
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
  if not (v_rank >= 3 or d.created_by = v_uid) then
    raise exception 'FORBIDDEN: このDraftを編集できません' using errcode = '42501';
  end if;
  if d.lock_version <> p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でDraftが更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if d.parent_quote_id is not null then
    raise exception 'LOCKED: Revision改訂Draftは次工程のlifecycleから保存してください' using errcode = 'P0001';
  end if;

  if p_base_master_revision_id is not null then
    select rev.base_master_id into v_base_master_id
      from public.base_master_revisions rev
      join public.base_masters master on master.id = rev.base_master_id
     where rev.id = p_base_master_revision_id
       and rev.status in ('published', 'superseded')
       and master.base_model_id = d.base_model_id;

    if not found or not public.can_use_base_master(v_base_master_id) then
      raise exception 'FORBIDDEN: この本体Revisionは案件に使用できません' using errcode = '42501';
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'VALIDATION: 明細データが不正です' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 300 then
    raise exception 'VALIDATION: 明細は300行以内にしてください' using errcode = 'P0001';
  end if;

  delete from public.quote_draft_items
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
        raise exception 'VALIDATION: 明細ID・商品ID・数量・単価の形式が不正です' using errcode = 'P0001';
    end;

    if v_qty::text in ('NaN', 'Infinity', '-Infinity')
       or v_qty < 0.01 or v_qty > 99999 or v_qty <> round(v_qty, 4) then
      raise exception 'VALIDATION: 数量は0.01以上99999以下・小数4桁以内で入力してください' using errcode = 'P0001';
    end if;

    if v_unit_price_raw::text in ('NaN', 'Infinity', '-Infinity')
       or v_unit_price_raw <> trunc(v_unit_price_raw)
       or v_unit_price_raw < -100000000
       or v_unit_price_raw > 100000000 then
      raise exception 'VALIDATION: 単価は整数かつ-100000000以上100000000以下で入力してください' using errcode = 'P0001';
    end if;

    v_unit_price := v_unit_price_raw::integer;
    if v_unit_price < 0 then
      raise exception 'VALIDATION: 明細単価は0円以上で入力し、値引きは調整額を使用してください'
        using errcode = 'P0001';
    end if;

    if v_option_id is not null
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

    v_amount_numeric := round(v_unit_price_raw * v_qty);
    if v_amount_numeric < -2147483648 or v_amount_numeric > 2147483647 then
      raise exception 'VALIDATION: 明細金額が保存可能範囲を超えています' using errcode = 'P0001';
    end if;
    v_amount := v_amount_numeric::integer;
    v_subtotal_raw := v_subtotal_raw + v_amount;

    insert into public.quote_draft_items(
      draft_id,
      line_key,
      kind,
      option_id,
      name,
      description,
      unit,
      remark,
      unit_price,
      quantity,
      amount,
      image_url,
      sort_order
    )
    values(
      d.id,
      v_line_key,
      v_kind,
      v_option_id,
      v_name,
      nullif(btrim(coalesce(row_json ->> 'description', '')), ''),
      nullif(btrim(coalesce(row_json ->> 'unit', '')), ''),
      nullif(btrim(coalesce(row_json ->> 'remark', '')), ''),
      v_unit_price,
      v_qty,
      v_amount,
      nullif(btrim(coalesce(row_json ->> 'image_url', '')), ''),
      v_sort
    );
  end loop;

  if v_adjustment <> 0 and v_reason is null then
    raise exception 'VALIDATION: 調整額を設定する場合は理由を入力してください' using errcode = 'P0001';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'VALIDATION: 調整理由は500文字以内で入力してください' using errcode = 'P0001';
  end if;
  if length(coalesce(p_dealer_note, '')) > 1000
     or length(coalesce(p_notes, '')) > 1000 then
    raise exception 'VALIDATION: メモは1000文字以内で入力してください' using errcode = 'P0001';
  end if;

  v_subtotal := v_subtotal_raw + v_adjustment;
  if v_subtotal < 0 or v_subtotal > 2147483647 then
    raise exception 'VALIDATION: 税抜金額が保存可能範囲を超えています' using errcode = 'P0001';
  end if;
  if v_subtotal_raw < 0 or v_subtotal_raw > 2147483647 then
    raise exception 'VALIDATION: 明細合計が保存可能範囲を超えています' using errcode = 'P0001';
  end if;

  v_tax := floor(v_subtotal * d.tax_rate);
  v_total := v_subtotal + v_tax;
  if v_tax < 0 or v_tax > 2147483647
     or v_total < 0 or v_total > 2147483647 then
    raise exception 'VALIDATION: 税額または税込金額が保存可能範囲を超えています' using errcode = 'P0001';
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
  returning lock_version into p_expected_lock_version;

  return p_expected_lock_version;
end;
$save_draft$;

-- -------------------------------------------------------------
-- Finalize an initial Non-Web Draft as immutable formal Revision 1.
-- No email/PDF delivery happens here.
-- -------------------------------------------------------------
create or replace function public.finalize_quote_draft(
  p_draft_id uuid,
  p_expected_lock_version integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $finalize_draft$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  d public.quote_drafts;
  r public.quote_requests;
  v_model public.base_models;
  v_base_master_id uuid;
  v_quote_id uuid;
  v_quote_no text;
  v_customer_name text;
  v_customer_company text;
  v_dealer_id uuid;
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
  if not (v_rank >= 3 or d.created_by = v_uid) then
    raise exception 'FORBIDDEN: このDraftを正式保存できません' using errcode = '42501';
  end if;
  if d.lock_version <> p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でDraftが更新されています。再読み込みしてください' using errcode = 'P0001';
  end if;
  if d.parent_quote_id is not null then
    raise exception 'LOCKED: このRPCは初回Revision 1専用です' using errcode = 'P0001';
  end if;
  if d.quote_kind <> 'formal' then
    raise exception 'VALIDATION: 非Web初回見積はformalとして正式保存してください' using errcode = 'P0001';
  end if;
  if d.base_master_revision_id is null then
    raise exception 'VALIDATION: 正式保存前に基準本体Revisionを選択してください' using errcode = 'P0001';
  end if;

  select rev.base_master_id into v_base_master_id
    from public.base_master_revisions rev
    join public.base_masters master on master.id = rev.base_master_id
   where rev.id = d.base_master_revision_id
     and rev.status in ('published', 'superseded')
     and master.base_model_id = d.base_model_id;

  if not found or not public.can_use_base_master(v_base_master_id) then
    raise exception 'FORBIDDEN: この本体Revisionは案件に使用できません' using errcode = '42501';
  end if;

  select * into r
    from public.quote_requests
   where id = d.quote_request_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if r.quote_id is not null
     or exists (select 1 from public.quotes q where q.quote_request_id = r.id) then
    raise exception 'LOCKED: この案件にはすでに正式Revisionがあります' using errcode = 'P0001';
  end if;

  select * into v_model
    from public.base_models
   where id = d.base_model_id;

  if not found then
    raise exception 'VALIDATION: 商品モデルが見つかりません' using errcode = 'P0001';
  end if;

  v_customer_name := nullif(btrim(coalesce(r.contact ->> 'full_name', '')), '');
  v_customer_company := nullif(btrim(coalesce(r.contact ->> 'company_name', '')), '');
  if v_customer_name is null then
    raise exception 'VALIDATION: お客様名がありません' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.quote_draft_items item where item.draft_id = d.id
  ) then
    raise exception 'VALIDATION: 明細を1行以上保存してから正式保存してください' using errcode = 'P0001';
  end if;

  for i in
    select * from public.quote_draft_items
     where draft_id = d.id
     order by sort_order, id
  loop
    if i.quantity < 0.01 or i.quantity > 99999 or i.quantity <> round(i.quantity, 4) then
      raise exception 'VALIDATION: Draftに不正な数量があります' using errcode = 'P0001';
    end if;
    v_expected_amount := round(i.unit_price::numeric * i.quantity);
    if v_expected_amount <> i.amount then
      raise exception 'VALIDATION: Draft明細金額がDB再計算値と一致しません' using errcode = 'P0001';
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
       abs(v_base), abs(v_base_exp),
       abs(v_int), abs(v_int_exp),
       abs(v_opt), abs(v_opt_exp),
       abs(v_inst)
     ) > 2147483647 then
    raise exception 'VALIDATION: 区分別金額が保存可能範囲を超えています'
      using errcode = 'P0001';
  end if;

  v_subtotal_raw := v_base + v_base_exp + v_int + v_int_exp + v_opt + v_opt_exp + v_inst;
  if v_subtotal_raw <> d.subtotal_raw then
    raise exception 'VALIDATION: Draft明細合計がDB保存値と一致しません' using errcode = 'P0001';
  end if;

  v_subtotal := v_subtotal_raw + d.adjustment;
  v_tax := floor(v_subtotal * d.tax_rate);
  v_total := v_subtotal + v_tax;

  if v_subtotal <> d.subtotal or v_tax <> d.tax or v_total <> d.total then
    raise exception 'VALIDATION: Draft合計がDB再計算値と一致しません' using errcode = 'P0001';
  end if;

  v_quote_no := public.next_quote_no();
  v_dealer_id := case when v_rank between 1 and 2 then v_uid else null end;

  insert into public.quotes(
    quote_no,
    quote_request_id,
    configuration_id,
    user_id,
    status,
    issued_at,
    valid_until,
    customer_no,
    customer_name,
    customer_company,
    base_model_name,
    finish_level,
    base_price,
    base_expense,
    option_subtotal,
    option_expense,
    installation_subtotal,
    adjustment,
    subtotal,
    tax_rate,
    tax,
    total,
    preview_image_url,
    notes,
    dealer_id,
    dealer_note,
    revision,
    parent_quote_id,
    quote_kind,
    base_model_id,
    base_master_revision_id,
    spec_code,
    adjustment_reason,
    created_by
  )
  values(
    v_quote_no,
    r.id,
    null,
    null,
    'issued',
    now(),
    now() + interval '30 days',
    null,
    v_customer_name,
    v_customer_company,
    v_model.name,
    d.finish_level,
    v_base::integer,
    v_base_exp::integer,
    (v_int + v_opt)::integer,
    (v_int_exp + v_opt_exp)::integer,
    v_inst::integer,
    d.adjustment,
    v_subtotal::integer,
    d.tax_rate,
    v_tax::integer,
    v_total::integer,
    null,
    d.notes,
    v_dealer_id,
    d.dealer_note,
    1,
    null,
    'formal',
    d.base_model_id,
    d.base_master_revision_id,
    d.spec_code,
    d.adjustment_reason,
    v_uid
  )
  returning id into v_quote_id;

  insert into public.quote_items(
    quote_id,
    line_key,
    kind,
    option_id,
    name,
    description,
    unit,
    remark,
    unit_price,
    quantity,
    amount,
    image_url,
    sort_order
  )
  select
    v_quote_id,
    item.line_key,
    item.kind,
    item.option_id,
    item.name,
    item.description,
    item.unit,
    item.remark,
    item.unit_price,
    item.quantity,
    round(item.unit_price::numeric * item.quantity)::integer,
    item.image_url,
    item.sort_order
  from public.quote_draft_items item
  where item.draft_id = d.id
  order by item.sort_order, item.id;

  update public.quote_requests
     set quote_id = v_quote_id,
         status = 'reviewing'
   where id = r.id;

  delete from public.quote_drafts
   where id = d.id;

  return v_quote_id;
end;
$finalize_draft$;

-- Explicit ownership / EXECUTE boundary.
alter function public.create_manual_quote_case(jsonb, text, uuid, text, text) owner to postgres;
alter function public.get_quote_draft(uuid) owner to postgres;
alter function public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text) owner to postgres;
alter function public.finalize_quote_draft(uuid, integer) owner to postgres;

do $owner_check$
begin
  if exists (
    select 1
      from pg_catalog.pg_proc p
     where p.oid in (
       'public.create_manual_quote_case(jsonb, text, uuid, text, text)'::regprocedure,
       'public.get_quote_draft(uuid)'::regprocedure,
       'public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text)'::regprocedure,
       'public.finalize_quote_draft(uuid, integer)'::regprocedure
     )
       and pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
  ) then
    raise exception 'QUOTE_DRAFT_LIFECYCLE_OWNER_INVALID: RPC owner must be postgres'
      using errcode = 'P0001';
  end if;
end;
$owner_check$;

revoke execute on function public.create_manual_quote_case(jsonb, text, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.get_quote_draft(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.finalize_quote_draft(uuid, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.create_manual_quote_case(jsonb, text, uuid, text, text) to authenticated;
grant execute on function public.get_quote_draft(uuid) to authenticated;
grant execute on function public.save_quote_draft(uuid, integer, uuid, jsonb, integer, text, text, text) to authenticated;
grant execute on function public.finalize_quote_draft(uuid, integer) to authenticated;

commit;
