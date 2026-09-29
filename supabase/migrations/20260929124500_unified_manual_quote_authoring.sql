-- =============================================================
-- Unified manual Quote authoring
--
-- 案件管理の「見積書を作成」から、案件情報とExcel型見積明細を
-- 同一画面で入力し、初回下書き保存時に quote_request + Draft +
-- Draft明細を1 transactionで作成する。
-- =============================================================

begin;

alter table public.quote_requests
  add column if not exists case_name text;

do $case_name_constraint$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.quote_requests'::regclass
       and conname = 'quote_requests_case_name_length'
  ) then
    alter table public.quote_requests
      add constraint quote_requests_case_name_length
      check (
        case_name is null
        or (
          length(btrim(case_name)) between 1 and 120
          and case_name = btrim(case_name)
        )
      );
  end if;
end;
$case_name_constraint$;

comment on column public.quote_requests.case_name is
  '案件管理で使う案件名。顧客名・会社名とは別の業務上の案件タイトル。';

-- Draft再表示でも案件名を同じ編集画面に返す。
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
  parent public.quotes;
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

  if d.parent_quote_id is null then
    if v_rank < 3 then
      raise exception 'FORBIDDEN: 初回見積Draftの作成・編集は現在本部管理者のみ利用できます'
        using errcode = '42501';
    end if;
  else
    select * into parent
      from public.quotes
     where id = d.parent_quote_id
       and quote_request_id = d.quote_request_id;

    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_rank < 3 and parent.dealer_id is distinct from v_uid then
      raise exception 'FORBIDDEN: このDraftを編集できません' using errcode = '42501';
    end if;
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
      'case_name', r.case_name,
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
         and rev.status in ('published', 'superseded')
         and (
           rev.id = d.base_master_revision_id
           or (
             master.status = 'active'
             and rev.id = master.current_published_revision_id
             and public.can_use_base_master(master.id)
           )
         )
    ), '[]'::jsonb)
  );
end;
$get_draft$;

alter function public.get_quote_draft(uuid) owner to postgres;
revoke execute on function public.get_quote_draft(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_quote_draft(uuid) to authenticated;

-- 初回Draftでも本体明細の編集権限をDB側で統一する。
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
  v_can_edit_base boolean;
  d public.quote_drafts;
  parent public.quotes;
  r public.quote_requests;
  v_parent_item public.quote_items;
  v_existing_item public.quote_draft_items;
  v_has_parent_item boolean;
  v_has_existing_item boolean;
  v_lock_parent_base boolean := false;
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
  v_can_edit_base := v_rank >= 2;

  select * into d
    from public.quote_drafts
   where id = p_draft_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if d.parent_quote_id is null then
    if v_rank < 3 then
      raise exception 'FORBIDDEN: 初回見積Draftの作成・編集は現在本部管理者のみ利用できます'
        using errcode = '42501';
    end if;
  else
    select * into parent
      from public.quotes
     where id = d.parent_quote_id
       and quote_request_id = d.quote_request_id
     for update;

    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_rank < 3 and parent.dealer_id is distinct from v_uid then
      raise exception 'FORBIDDEN: この見積を改訂できません' using errcode = '42501';
    end if;
  end if;

  if d.lock_version is distinct from p_expected_lock_version then
    raise exception 'LOCKED: 他の画面でDraftが更新されています。再読み込みしてください'
      using errcode = 'P0001';
  end if;

  if d.parent_quote_id is not null then
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
    if not v_can_edit_base
       and p_base_master_revision_id is distinct from parent.base_master_revision_id then
      raise exception 'FORBIDDEN: 本体Revisionを変更できるのは総代理店・本部だけです'
        using errcode = '42501';
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
    if p_base_master_revision_id is not distinct from d.base_master_revision_id then
      -- すでにこのDraftへpin済みの同一Revisionは、後からsuperseded/archivedになっても維持できる。
      select rev.base_master_id into v_base_master_id
        from public.base_master_revisions rev
        join public.base_masters master on master.id = rev.base_master_id
       where rev.id = p_base_master_revision_id
         and rev.status in ('published', 'superseded')
         and master.base_model_id = d.base_model_id;

      if not found then
        raise exception 'VALIDATION: 既存の本体Revision pinが不正です'
          using errcode = 'P0001';
      end if;
    else
      -- 新規pin/変更先はactive masterのcurrent publishedだけを許可する。
      select rev.base_master_id into v_base_master_id
        from public.base_master_revisions rev
        join public.base_masters master on master.id = rev.base_master_id
       where rev.id = p_base_master_revision_id
         and rev.status = 'published'
         and master.status = 'active'
         and rev.id = master.current_published_revision_id
         and master.base_model_id = d.base_model_id;

      if not found then
        raise exception 'VALIDATION: 新しく選べるのは現在公開中の本体Revisionだけです'
          using errcode = 'P0001';
      end if;
      if not public.can_use_base_master(v_base_master_id) then
        raise exception 'FORBIDDEN: この本体Revisionは案件に使用できません'
          using errcode = '42501';
      end if;
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

    if d.parent_quote_id is null
       and not v_can_edit_base
       and v_kind in ('base', 'base_expense') then
      raise exception 'FORBIDDEN: 本体明細を編集できるのは総代理店・本部だけです'
        using errcode = '42501';
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

    v_lock_parent_base :=
      d.parent_quote_id is not null
      and not v_can_edit_base
      and v_has_parent_item
      and v_parent_item.kind in ('base', 'base_expense');

    if d.parent_quote_id is not null and not v_can_edit_base then
      if v_lock_parent_base
         and (
           v_parent_item.kind is distinct from v_kind
           or v_parent_item.option_id is distinct from v_option_id
           or v_parent_item.unit_price is distinct from v_unit_price
           or v_parent_item.quantity is distinct from v_qty
         ) then
        raise exception 'FORBIDDEN: 本体明細を変更できるのは総代理店・本部だけです'
          using errcode = '42501';
      elsif not v_lock_parent_base and v_kind in ('base', 'base_expense') then
        raise exception 'FORBIDDEN: 本体明細を追加できるのは総代理店・本部だけです'
          using errcode = '42501';
      end if;
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
      d.id,
      v_line_key,
      case when v_lock_parent_base then v_parent_item.kind else v_kind end,
      case when v_lock_parent_base then v_parent_item.option_id else v_option_id end,
      case when v_lock_parent_base then v_parent_item.name else v_name end,
      case when v_lock_parent_base
        then v_parent_item.description
        else nullif(btrim(coalesce(row_json ->> 'description', '')), '')
      end,
      case when v_lock_parent_base
        then v_parent_item.unit
        else nullif(btrim(coalesce(row_json ->> 'unit', '')), '')
      end,
      case when v_lock_parent_base
        then v_parent_item.remark
        else nullif(btrim(coalesce(row_json ->> 'remark', '')), '')
      end,
      case when v_lock_parent_base then v_parent_item.unit_price else v_unit_price end,
      case when v_lock_parent_base then v_parent_item.quantity else v_qty end,
      case when v_lock_parent_base then v_parent_item.amount else v_amount end,
      case when v_lock_parent_base
        then v_parent_item.image_url
        else nullif(btrim(coalesce(row_json ->> 'image_url', '')), '')
      end,
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

  if d.parent_quote_id is not null
     and not v_can_edit_base
     and exists (
       select 1
         from public.quote_items item
        where item.quote_id = parent.id
          and item.kind in ('base', 'base_expense')
          and not (item.line_key = any(v_seen_line_keys))
     ) then
    raise exception 'FORBIDDEN: 本体明細を削除できるのは総代理店・本部だけです'
      using errcode = '42501';
  end if;

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

alter function public.save_quote_draft(
  uuid, integer, uuid, jsonb, integer, text, text, text
) owner to postgres;
revoke execute on function public.save_quote_draft(
  uuid, integer, uuid, jsonb, integer, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_quote_draft(
  uuid, integer, uuid, jsonb, integer, text, text, text
) to authenticated;

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
  if v_rank < 3 then
    raise exception 'FORBIDDEN: 初回Revision 1の正式保存は現在本部管理者のみ利用できます'
      using errcode = '42501';
  end if;

  select * into d
    from public.quote_drafts
   where id = p_draft_id
   for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_rank < 3 and d.created_by is distinct from v_uid then
    raise exception 'FORBIDDEN: このDraftを正式保存できません' using errcode = '42501';
  end if;
  if d.lock_version is distinct from p_expected_lock_version then
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

  if not found then
    raise exception 'VALIDATION: Draftにpinされた本体Revisionが不正です' using errcode = 'P0001';
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

alter function public.finalize_quote_draft(uuid, integer) owner to postgres;
revoke execute on function public.finalize_quote_draft(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_quote_draft(uuid, integer) to authenticated;

-- 旧「案件だけ作成」経路は統合RPCの内部helperとしてのみ利用する。
alter function public.create_manual_quote_case(jsonb, text, uuid, text, text) owner to postgres;
revoke execute on function public.create_manual_quote_case(jsonb, text, uuid, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.create_manual_quote_draft_with_items(
  p_case_name text,
  p_contact jsonb,
  p_message text,
  p_base_model_id uuid,
  p_spec_code text,
  p_finish_level text,
  p_base_master_revision_id uuid,
  p_items jsonb,
  p_adjustment integer,
  p_adjustment_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $unified_manual_quote$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
  v_case_name text := nullif(btrim(coalesce(p_case_name, '')), '');
  v_draft_id uuid;
  v_request_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 3 then
    raise exception 'FORBIDDEN: 初回見積書作成は現在本部管理者のみ利用できます'
      using errcode = '42501';
  end if;

  if v_case_name is not null and length(v_case_name) > 120 then
    raise exception 'VALIDATION: 案件名は120文字以内で入力してください'
      using errcode = 'P0001';
  end if;

  -- 同じDB transaction内で既存の案件作成RPCとDraft保存RPCを呼ぶ。
  -- 後段の明細検証・金額再計算に失敗した場合、案件作成もまとめてrollbackされる。
  v_draft_id := public.create_manual_quote_case(
    p_contact,
    p_message,
    p_base_model_id,
    p_spec_code,
    p_finish_level
  );

  select d.quote_request_id
    into v_request_id
    from public.quote_drafts d
   where d.id = v_draft_id;

  if not found then
    raise exception 'INTERNAL: 作成したDraftの案件を取得できません'
      using errcode = 'P0001';
  end if;

  update public.quote_requests
     set case_name = v_case_name
   where id = v_request_id;

  perform public.save_quote_draft(
    v_draft_id,
    0,
    p_base_master_revision_id,
    p_items,
    p_adjustment,
    p_adjustment_reason,
    null,
    p_message
  );

  return v_draft_id;
end;
$unified_manual_quote$;

alter function public.create_manual_quote_draft_with_items(
  text, jsonb, text, uuid, text, text, uuid, jsonb, integer, text
) owner to postgres;

do $owner_check$
begin
  if pg_catalog.pg_get_userbyid(
       (
         select p.proowner
           from pg_catalog.pg_proc p
          where p.oid =
            'public.create_manual_quote_draft_with_items(text,jsonb,text,uuid,text,text,uuid,jsonb,integer,text)'::regprocedure
       )
     ) <> 'postgres'
  then
    raise exception 'UNIFIED_MANUAL_QUOTE_OWNER_INVALID: RPC owner must be postgres'
      using errcode = 'P0001';
  end if;
end;
$owner_check$;

revoke execute on function public.create_manual_quote_draft_with_items(
  text, jsonb, text, uuid, text, text, uuid, jsonb, integer, text
) from public, anon, authenticated, service_role;

grant execute on function public.create_manual_quote_draft_with_items(
  text, jsonb, text, uuid, text, text, uuid, jsonb, integer, text
) to authenticated;

comment on function public.create_manual_quote_draft_with_items(
  text, jsonb, text, uuid, text, text, uuid, jsonb, integer, text
) is
  '案件情報と見積Draft明細を初回下書き保存時に同一transactionで作成する。正式Quote Revisionは発行しない。';

-- 案件管理から、まだ正式Quoteを発行していない初回Draftだけを再開するための
-- admin限定read boundary。quote_draftsテーブル自体のSELECT権限は開放しない。
create or replace function public.list_initial_quote_draft_resumes()
returns table (
  quote_request_id uuid,
  draft_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $initial_draft_resumes$
declare
  v_uid uuid := auth.uid();
  v_rank integer := public.current_role_rank();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if v_rank < 3 then
    raise exception 'FORBIDDEN: 初回見積Draft一覧を取得できるのは本部管理者だけです'
      using errcode = '42501';
  end if;

  return query
  select d.quote_request_id, d.id, d.updated_at
    from public.quote_drafts d
    join public.quote_requests r on r.id = d.quote_request_id
   where d.parent_quote_id is null
     and r.quote_id is null
   order by d.updated_at desc;
end;
$initial_draft_resumes$;

alter function public.list_initial_quote_draft_resumes() owner to postgres;

revoke execute on function public.list_initial_quote_draft_resumes()
  from public, anon, authenticated, service_role;
grant execute on function public.list_initial_quote_draft_resumes()
  to authenticated;

comment on function public.list_initial_quote_draft_resumes() is
  '本部管理者向け。正式Quote未発行の初回Draftを案件管理から再開するため、案件ID・Draft ID・更新日時だけを返す。';

commit;
