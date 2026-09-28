-- =============================================================
-- Standard Estimate Draft 作成 / 保存
--
-- standard_estimate_foundation の Draft 保存接続。
-- Publish はこの migration では実装しない。
-- authenticated からテーブルへ直接書き込ませず、SECURITY DEFINER RPC だけで
-- 新規 Draft 作成と既存 Draft 保存を原子的に行う。
-- =============================================================

-- ---------- Draft明細の編集メタデータ ----------
alter table public.standard_estimate_revision_lines
  add column if not exists source_kind text not null default 'free',
  add column if not exists option_id uuid,
  add column if not exists customer_selection text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'standard_estimate_revision_lines_source_kind_check'
       and conrelid = 'public.standard_estimate_revision_lines'::regclass
  ) then
    alter table public.standard_estimate_revision_lines
      add constraint standard_estimate_revision_lines_source_kind_check
      check (source_kind in ('product', 'free'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'standard_estimate_revision_lines_customer_selection_check'
       and conrelid = 'public.standard_estimate_revision_lines'::regclass
  ) then
    alter table public.standard_estimate_revision_lines
      add constraint standard_estimate_revision_lines_customer_selection_check
      check (
        customer_selection in (
          'standard_changeable',
          'standard_fixed',
          'optional',
          'hidden',
          'none'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'standard_estimate_revision_lines_option_fk'
       and conrelid = 'public.standard_estimate_revision_lines'::regclass
  ) then
    alter table public.standard_estimate_revision_lines
      add constraint standard_estimate_revision_lines_option_fk
      foreign key (option_id)
      references public.options(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'standard_estimate_revision_lines_source_consistency_check'
       and conrelid = 'public.standard_estimate_revision_lines'::regclass
  ) then
    alter table public.standard_estimate_revision_lines
      add constraint standard_estimate_revision_lines_source_consistency_check
      check (
        (
          source_kind = 'product'
          and option_id is not null
          and customer_selection in (
            'standard_changeable',
            'standard_fixed',
            'optional',
            'hidden'
          )
        )
        or (
          source_kind = 'free'
          and option_id is null
          and customer_selection = 'none'
        )
      );
  end if;
end
$$;

create index if not exists standard_estimate_revision_lines_option_idx
  on public.standard_estimate_revision_lines(option_id)
  where option_id is not null;

-- ---------- Draft内容適用（内部） ----------
create or replace function public.apply_standard_estimate_draft_contents_internal(
  p_revision_id uuid,
  p_expected_lock_version integer,
  p_name text,
  p_tax_rate numeric,
  p_standard_adjustment_amount integer,
  p_standard_adjustment_reason text,
  p_lines jsonb
)
returns public.standard_estimate_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_revision public.standard_estimate_revisions;
  v_master public.standard_estimate_masters;
  v_base_revision public.base_master_revisions;
  v_row jsonb;
  v_line_no integer := 0;
  v_line_key uuid;
  v_seen_keys uuid[] := '{}';
  v_section text;
  v_group_label text;
  v_name text;
  v_quantity numeric;
  v_unit text;
  v_unit_price integer;
  v_amount integer;
  v_source_kind text;
  v_option_id uuid;
  v_customer_selection text;
  v_interior_exterior_subtotal integer := 0;
  v_option_subtotal integer := 0;
  v_sitework_subtotal integer := 0;
  v_subtotal_raw integer;
  v_subtotal integer;
  v_tax integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if p_expected_lock_version is null or p_expected_lock_version < 0 then
    raise exception 'VALIDATION: lock_versionが不正です' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'VALIDATION: 標準見積名を入力してください' using errcode = 'P0001';
  end if;

  if p_tax_rate is null or p_tax_rate < 0 or p_tax_rate > 1 then
    raise exception 'VALIDATION: 税率は0以上1以下で入力してください' using errcode = 'P0001';
  end if;

  if p_standard_adjustment_amount is null then
    raise exception 'VALIDATION: 調整額が不正です' using errcode = 'P0001';
  end if;

  if p_standard_adjustment_amount <> 0
     and nullif(btrim(coalesce(p_standard_adjustment_reason, '')), '') is null
  then
    raise exception 'VALIDATION: 調整額がある場合は理由を入力してください' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'VALIDATION: 明細形式が不正です' using errcode = 'P0001';
  end if;

  select *
    into v_revision
    from public.standard_estimate_revisions
   where id = p_revision_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: 標準見積Draftが見つかりません' using errcode = 'P0002';
  end if;

  if v_revision.status <> 'draft' then
    raise exception 'LOCKED: Draftだけ保存できます' using errcode = 'P0001';
  end if;

  if v_revision.lock_version <> p_expected_lock_version then
    raise exception 'CONFLICT: 他のユーザーが更新しています。画面を再読込してください'
      using errcode = '40001';
  end if;

  select *
    into v_master
    from public.standard_estimate_masters
   where id = v_revision.standard_estimate_master_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: Standard Estimate Masterが見つかりません' using errcode = 'P0002';
  end if;

  if not public.can_edit_standard_estimate_master(v_master.id) then
    raise exception 'FORBIDDEN: この標準見積を編集できません' using errcode = '42501';
  end if;

  select *
    into v_base_revision
    from public.base_master_revisions
   where id = v_revision.base_master_revision_id
     and base_master_id = v_master.base_master_id
     and status in ('published', 'superseded')
   for share;

  if not found then
    raise exception 'VALIDATION: pinされた本体Revisionが見つからないか、利用できません'
      using errcode = 'P0001';
  end if;

  -- linesは(revision_id, section_code)でsectionsを参照するため、
  -- 新規Draftでも先に3区分を用意してから明細を全置換する。
  insert into public.standard_estimate_revision_sections (
    revision_id,
    section_code,
    expense_method,
    expense_rate,
    expense_amount,
    line_subtotal,
    total
  )
  values
    (v_revision.id, 'interior_exterior', 'none', null, 0, 0, 0),
    (v_revision.id, 'option', 'none', null, 0, 0, 0),
    (v_revision.id, 'sitework', 'none', null, 0, 0, 0)
  on conflict (revision_id, section_code) do nothing;

  -- 入力のどこかで失敗した場合はRPC transaction全体がrollbackされるため、
  -- Draft行は全置換してsort_orderと金額をDB側で正規化する。
  delete from public.standard_estimate_revision_lines
   where revision_id = v_revision.id;

  for v_row in
    select value
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_line_no := v_line_no + 1;
    v_section := btrim(coalesce(v_row ->> 'section_code', ''));
    v_group_label := nullif(btrim(coalesce(v_row ->> 'group_label', '')), '');
    v_name := btrim(coalesce(v_row ->> 'name', ''));
    v_unit := nullif(btrim(coalesce(v_row ->> 'unit', '')), '');
    v_source_kind := btrim(coalesce(v_row ->> 'source_kind', 'free'));
    v_customer_selection := btrim(coalesce(v_row ->> 'customer_selection', 'none'));

    if v_section not in ('interior_exterior', 'option', 'sitework') then
      raise exception 'VALIDATION: %行目の区分が不正です', v_line_no using errcode = 'P0001';
    end if;
    if v_name = '' then
      raise exception 'VALIDATION: %行目の品名を入力してください', v_line_no using errcode = 'P0001';
    end if;

    begin
      v_quantity := coalesce(nullif(v_row ->> 'quantity', '')::numeric, 1);
      v_unit_price := coalesce(nullif(v_row ->> 'unit_price', '')::integer, 0);
      v_line_key := nullif(v_row ->> 'line_key', '')::uuid;
      v_option_id := nullif(v_row ->> 'option_id', '')::uuid;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'VALIDATION: %行目の数量・単価・ID形式を確認してください', v_line_no
          using errcode = 'P0001';
    end;

    if v_quantity <= 0 then
      raise exception 'VALIDATION: %行目の数量は0より大きい値にしてください', v_line_no
        using errcode = 'P0001';
    end if;
    if v_unit_price < 0 then
      raise exception 'VALIDATION: %行目の単価は0円以上にしてください', v_line_no
        using errcode = 'P0001';
    end if;

    if v_line_key is null then
      v_line_key := gen_random_uuid();
    end if;
    if v_line_key = any(v_seen_keys) then
      raise exception 'VALIDATION: 明細line_keyが重複しています' using errcode = 'P0001';
    end if;
    v_seen_keys := array_append(v_seen_keys, v_line_key);

    if v_source_kind = 'product' then
      if v_option_id is null then
        raise exception 'VALIDATION: %行目の商品IDがありません', v_line_no using errcode = 'P0001';
      end if;
      if v_customer_selection not in (
        'standard_changeable',
        'standard_fixed',
        'optional',
        'hidden'
      ) then
        raise exception 'VALIDATION: %行目のお客様選択区分が不正です', v_line_no
          using errcode = 'P0001';
      end if;
      if not exists (select 1 from public.options o where o.id = v_option_id) then
        raise exception 'VALIDATION: %行目の商品が見つかりません', v_line_no using errcode = 'P0001';
      end if;
    elsif v_source_kind = 'free' then
      v_option_id := null;
      v_customer_selection := 'none';
    else
      raise exception 'VALIDATION: %行目の明細種別が不正です', v_line_no using errcode = 'P0001';
    end if;

    v_amount := round(v_quantity * v_unit_price)::integer;

    if v_section = 'interior_exterior' then
      v_interior_exterior_subtotal := v_interior_exterior_subtotal + v_amount;
    elsif v_section = 'option' then
      v_option_subtotal := v_option_subtotal + v_amount;
    else
      v_sitework_subtotal := v_sitework_subtotal + v_amount;
    end if;

    insert into public.standard_estimate_revision_lines (
      revision_id,
      line_key,
      section_code,
      group_label,
      name,
      quantity,
      unit,
      unit_price,
      amount,
      remark,
      sort_order,
      source_kind,
      option_id,
      customer_selection
    )
    values (
      v_revision.id,
      v_line_key,
      v_section,
      v_group_label,
      v_name,
      v_quantity,
      v_unit,
      v_unit_price,
      v_amount,
      nullif(btrim(coalesce(v_row ->> 'remark', '')), ''),
      v_line_no,
      v_source_kind,
      v_option_id,
      v_customer_selection
    );
  end loop;

  insert into public.standard_estimate_revision_sections (
    revision_id,
    section_code,
    expense_method,
    expense_rate,
    expense_amount,
    line_subtotal,
    total
  )
  values
    (v_revision.id, 'interior_exterior', 'none', null, 0, v_interior_exterior_subtotal, v_interior_exterior_subtotal),
    (v_revision.id, 'option', 'none', null, 0, v_option_subtotal, v_option_subtotal),
    (v_revision.id, 'sitework', 'none', null, 0, v_sitework_subtotal, v_sitework_subtotal)
  on conflict (revision_id, section_code) do update
    set expense_method = excluded.expense_method,
        expense_rate = excluded.expense_rate,
        expense_amount = excluded.expense_amount,
        line_subtotal = excluded.line_subtotal,
        total = excluded.total;

  v_subtotal_raw :=
    v_base_revision.total
    + v_interior_exterior_subtotal
    + v_option_subtotal
    + v_sitework_subtotal;
  v_subtotal := v_subtotal_raw + p_standard_adjustment_amount;

  if v_subtotal < 0 then
    raise exception 'VALIDATION: 調整後の税抜金額を0円未満にはできません'
      using errcode = 'P0001';
  end if;

  v_tax := floor(v_subtotal::numeric * p_tax_rate)::integer;

  update public.standard_estimate_masters
     set name = btrim(p_name),
         updated_by = v_uid
   where id = v_master.id;

  update public.standard_estimate_revisions
     set tax_rate = p_tax_rate::numeric(8, 6),
         standard_adjustment_amount = p_standard_adjustment_amount,
         standard_adjustment_reason =
           case
             when p_standard_adjustment_amount = 0 then null
             else btrim(p_standard_adjustment_reason)
           end,
         subtotal_raw = v_subtotal_raw,
         subtotal = v_subtotal,
         tax = v_tax,
         total = v_subtotal + v_tax,
         lock_version = lock_version + 1,
         updated_by = v_uid
   where id = v_revision.id
     and lock_version = p_expected_lock_version
  returning * into v_revision;

  if not found then
    raise exception 'CONFLICT: 他のユーザーが更新しています。画面を再読込してください'
      using errcode = '40001';
  end if;

  return v_revision;
end;
$$;

-- ---------- 新規Master + Draft作成 ----------
create or replace function public.create_standard_estimate_draft(
  p_base_model_id uuid,
  p_base_master_id uuid,
  p_base_master_revision_id uuid,
  p_spec_code text,
  p_name text,
  p_tax_rate numeric,
  p_standard_adjustment_amount integer,
  p_standard_adjustment_reason text,
  p_lines jsonb
)
returns public.standard_estimate_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_base_master public.base_masters;
  v_owner_type text;
  v_revision_status text;
  v_master_id uuid;
  v_revision_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_spec_code, '')), '') is null
     or p_spec_code <> lower(p_spec_code)
     or p_spec_code <> btrim(p_spec_code)
     or p_spec_code ~ '[[:space:]]'
  then
    raise exception 'VALIDATION: 用途区分が不正です' using errcode = 'P0001';
  end if;

  -- Standard Estimateの仕様identityは旧Excel取込ではなく、
  -- 公開中の商品モデルの「base + presets」を正式なallow-listとする。
  if not exists (
    select 1
      from public.base_models m
     where m.id = p_base_model_id
       and m.status = 'published'
       and (
         p_spec_code = 'base'
         or exists (
           select 1
             from jsonb_array_elements(coalesce(m.presets, '[]'::jsonb)) preset
            where preset ->> 'code' = p_spec_code
         )
       )
  ) then
    raise exception 'VALIDATION: このモデルでは指定された仕様を選べません'
      using errcode = 'P0001';
  end if;

  select *
    into v_base_master
    from public.base_masters
   where id = p_base_master_id
     and status = 'active'
   for share;

  if not found then
    raise exception 'NOT_FOUND: 基準本体が見つかりません' using errcode = 'P0002';
  end if;

  if v_base_master.base_model_id is distinct from p_base_model_id then
    raise exception 'VALIDATION: 商品モデルと基準本体が一致しません' using errcode = 'P0001';
  end if;

  select organization_type
    into v_owner_type
    from public.organizations
   where id = v_base_master.owner_organization_id
     and status = 'active';

  if v_owner_type is distinct from 'headquarters' then
    raise exception 'VALIDATION: 標準見積は本部所有の基準本体から作成してください'
      using errcode = 'P0001';
  end if;

  if not public.can_create_standard_estimate_master_for_org(v_base_master.owner_organization_id) then
    raise exception 'FORBIDDEN: この組織では標準見積を作成できません'
      using errcode = '42501';
  end if;

  -- 一覧の14件枠とDB Masterの論理identityを一致させる。
  -- 同一HQ + model + spec + fireSpec は、異なるBase Masterを選んでも1 Masterだけ。
  -- advisory xact lockで異なるBase Master間の同時作成も直列化する。
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      v_base_master.owner_organization_id::text || ':' || p_base_model_id::text
    ),
    pg_catalog.hashtext(
      p_spec_code || ':' || v_base_master.fire_spec_code
    )
  );

  if exists (
    select 1
      from public.standard_estimate_masters existing_master
      join public.base_masters existing_base
        on existing_base.id = existing_master.base_master_id
     where existing_master.owner_organization_id = v_base_master.owner_organization_id
       and existing_master.base_model_id = p_base_model_id
       and existing_master.spec_code = p_spec_code
       and existing_base.fire_spec_code = v_base_master.fire_spec_code
  ) then
    raise exception 'CONFLICT: この商品モデル・用途・防火仕様の標準見積は既に作成されています。画面を再読込してください'
      using errcode = '40001';
  end if;

  select status
    into v_revision_status
    from public.base_master_revisions
   where id = p_base_master_revision_id
     and base_master_id = v_base_master.id
   for share;

  if v_revision_status is null or v_revision_status not in ('published', 'superseded') then
    raise exception 'VALIDATION: publishedまたはsupersededの基準本体Revisionを指定してください'
      using errcode = 'P0001';
  end if;

  begin
    insert into public.standard_estimate_masters (
      owner_organization_id,
      base_model_id,
      base_master_id,
      spec_code,
      name,
      status,
      created_by,
      updated_by
    )
    values (
      v_base_master.owner_organization_id,
      p_base_model_id,
      v_base_master.id,
      p_spec_code,
      btrim(p_name),
      'active',
      v_uid,
      v_uid
    )
    returning id into v_master_id;
  exception
    when unique_violation then
      raise exception 'CONFLICT: この商品モデル・用途・防火仕様の標準見積は既に作成されています。画面を再読込してください'
        using errcode = '40001';
  end;

  insert into public.standard_estimate_revisions (
    standard_estimate_master_id,
    version,
    status,
    base_master_revision_id,
    tax_rate,
    standard_adjustment_amount,
    standard_adjustment_reason,
    subtotal_raw,
    subtotal,
    tax,
    total,
    lock_version,
    source_kind,
    created_by,
    updated_by
  )
  values (
    v_master_id,
    1,
    'draft',
    p_base_master_revision_id,
    0.10,
    0,
    null,
    0,
    0,
    0,
    0,
    0,
    'ui',
    v_uid,
    v_uid
  )
  returning id into v_revision_id;

  return public.apply_standard_estimate_draft_contents_internal(
    v_revision_id,
    0,
    p_name,
    p_tax_rate,
    p_standard_adjustment_amount,
    p_standard_adjustment_reason,
    p_lines
  );
end;
$$;

-- ---------- 既存Draft保存 ----------
create or replace function public.save_standard_estimate_draft(
  p_revision_id uuid,
  p_expected_lock_version integer,
  p_name text,
  p_tax_rate numeric,
  p_standard_adjustment_amount integer,
  p_standard_adjustment_reason text,
  p_lines jsonb
)
returns public.standard_estimate_revisions
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.apply_standard_estimate_draft_contents_internal(
    p_revision_id,
    p_expected_lock_version,
    p_name,
    p_tax_rate,
    p_standard_adjustment_amount,
    p_standard_adjustment_reason,
    p_lines
  );
end;
$$;

-- ---------- EXECUTE境界 ----------
revoke all on function public.apply_standard_estimate_draft_contents_internal(
  uuid, integer, text, numeric, integer, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.create_standard_estimate_draft(
  uuid, uuid, uuid, text, text, numeric, integer, text, jsonb
) from public, anon, authenticated;

revoke all on function public.save_standard_estimate_draft(
  uuid, integer, text, numeric, integer, text, jsonb
) from public, anon, authenticated;

grant execute on function public.create_standard_estimate_draft(
  uuid, uuid, uuid, text, text, numeric, integer, text, jsonb
) to authenticated, service_role;

grant execute on function public.save_standard_estimate_draft(
  uuid, integer, text, numeric, integer, text, jsonb
) to authenticated, service_role;

comment on function public.create_standard_estimate_draft(
  uuid, uuid, uuid, text, text, numeric, integer, text, jsonb
) is '本部所有の基準本体Revisionをpinし、Standard Estimate Master + Draft v1を1 transactionで作成する。';

comment on function public.save_standard_estimate_draft(
  uuid, integer, text, numeric, integer, text, jsonb
) is 'Standard Estimate Draftを楽観ロックで保存する。金額は本体Revision + Draft明細 + 調整額からDB側で再計算する。';
