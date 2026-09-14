-- =============================================================
-- 本体マスター Draft / Publish RPC
--
-- base_master_foundation の次段階。
-- authenticated から新テーブルへ直接書き込ませず、所有権検証付きRPCだけで
-- Draft作成・編集・公開・破棄を行う。
--
-- このmigrationでは既存 base_breakdown_items / estimate_templates /
-- simulator の参照先は変更しない。
-- =============================================================

-- ---------- 新規本体 + Draft作成 ----------
create or replace function public.create_base_master_draft(
  p_base_model_id uuid,
  p_owner_organization_id uuid,
  p_name text,
  p_fire_spec_code text default 'non_fire',
  p_cloned_from_revision_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_master_id uuid;
  v_revision_id uuid;
  v_default_rate numeric(8, 6);
  v_source public.base_master_revisions;
  v_source_master public.base_masters;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if not public.can_create_base_master_for_org(p_owner_organization_id) then
    raise exception 'FORBIDDEN: この組織では本体を作成できません' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'VALIDATION: 本体名を入力してください' using errcode = 'P0001';
  end if;

  if p_fire_spec_code not in ('non_fire', 'fire') then
    raise exception 'VALIDATION: 防火区分が不正です' using errcode = 'P0001';
  end if;

  select coalesce(expense_rate, 0.15)::numeric(8, 6)
    into v_default_rate
    from public.base_models
   where id = p_base_model_id;

  if not found then
    raise exception 'VALIDATION: 商品モデルが見つかりません' using errcode = 'P0001';
  end if;

  if p_cloned_from_revision_id is not null then
    select *
      into v_source
      from public.base_master_revisions
     where id = p_cloned_from_revision_id
       and status in ('published', 'superseded')
     for share;

    if not found then
      raise exception 'VALIDATION: 複製元の公開済み本体Revisionが見つかりません' using errcode = 'P0001';
    end if;

    select *
      into v_source_master
      from public.base_masters
     where id = v_source.base_master_id
     for share;

    if not found then
      raise exception 'VALIDATION: 複製元の本体が見つかりません' using errcode = 'P0001';
    end if;

    if v_source_master.base_model_id <> p_base_model_id then
      raise exception 'VALIDATION: 複製元は同じ商品モデルの本体を指定してください' using errcode = 'P0001';
    end if;

    if not (
      public.can_use_base_master(v_source_master.id)
      or public.can_view_owned_base_master(v_source_master.id)
    ) then
      raise exception 'FORBIDDEN: この本体を複製する権限がありません' using errcode = '42501';
    end if;
  end if;

  insert into public.base_masters (
    base_model_id,
    owner_organization_id,
    name,
    fire_spec_code,
    status,
    cloned_from_revision_id,
    created_by,
    updated_by
  )
  values (
    p_base_model_id,
    p_owner_organization_id,
    btrim(p_name),
    p_fire_spec_code,
    'active',
    p_cloned_from_revision_id,
    v_uid,
    v_uid
  )
  returning id into v_master_id;

  if p_cloned_from_revision_id is null then
    insert into public.base_master_revisions (
      base_master_id,
      version,
      status,
      expense_method,
      expense_rate,
      expense_amount,
      line_subtotal,
      total,
      created_by
    )
    values (
      v_master_id,
      1,
      'draft',
      'rate',
      v_default_rate,
      0,
      0,
      0,
      v_uid
    )
    returning id into v_revision_id;
  else
    insert into public.base_master_revisions (
      base_master_id,
      version,
      status,
      expense_method,
      expense_rate,
      expense_amount,
      line_subtotal,
      total,
      created_by
    )
    values (
      v_master_id,
      1,
      'draft',
      v_source.expense_method,
      v_source.expense_rate,
      v_source.expense_amount,
      v_source.line_subtotal,
      v_source.total,
      v_uid
    )
    returning id into v_revision_id;

    -- 別本体へ複製するため、line_key は新しく採番する。
    -- 以後この新本体のRevision間では同じline_keyを引き継ぐ。
    insert into public.base_master_revision_lines (
      revision_id,
      line_key,
      section,
      name,
      quantity,
      unit,
      unit_price,
      amount,
      remark,
      sort_order
    )
    select
      v_revision_id,
      gen_random_uuid(),
      l.section,
      l.name,
      l.quantity,
      l.unit,
      l.unit_price,
      l.amount,
      l.remark,
      l.sort_order
    from public.base_master_revision_lines l
    where l.revision_id = p_cloned_from_revision_id
    order by l.sort_order, l.id;
  end if;

  return v_revision_id;
end;
$$;

-- ---------- 公開版から次Draftを開始 ----------
create or replace function public.start_base_master_draft(
  p_base_master_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_master public.base_masters;
  v_source public.base_master_revisions;
  v_existing uuid;
  v_revision_id uuid;
  v_next_version integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  select *
    into v_master
    from public.base_masters
   where id = p_base_master_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: 本体が見つかりません' using errcode = 'P0002';
  end if;

  if not public.can_edit_base_master(v_master.id) then
    raise exception 'FORBIDDEN: この本体を編集できません' using errcode = '42501';
  end if;

  select id
    into v_existing
    from public.base_master_revisions
   where base_master_id = v_master.id
     and status = 'draft'
   limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  if v_master.current_published_revision_id is null then
    raise exception 'VALIDATION: 公開版がありません。新規本体のDraftを使用してください' using errcode = 'P0001';
  end if;

  select *
    into v_source
    from public.base_master_revisions
   where id = v_master.current_published_revision_id
     and base_master_id = v_master.id
     and status = 'published'
   for share;

  if not found then
    raise exception 'VALIDATION: 現在公開版が不正です' using errcode = 'P0001';
  end if;

  select coalesce(max(version), 0) + 1
    into v_next_version
    from public.base_master_revisions
   where base_master_id = v_master.id;

  insert into public.base_master_revisions (
    base_master_id,
    version,
    status,
    expense_method,
    expense_rate,
    expense_amount,
    line_subtotal,
    total,
    created_by
  )
  values (
    v_master.id,
    v_next_version,
    'draft',
    v_source.expense_method,
    v_source.expense_rate,
    v_source.expense_amount,
    v_source.line_subtotal,
    v_source.total,
    v_uid
  )
  returning id into v_revision_id;

  insert into public.base_master_revision_lines (
    revision_id,
    line_key,
    section,
    name,
    quantity,
    unit,
    unit_price,
    amount,
    remark,
    sort_order
  )
  select
    v_revision_id,
    l.line_key,
    l.section,
    l.name,
    l.quantity,
    l.unit,
    l.unit_price,
    l.amount,
    l.remark,
    l.sort_order
  from public.base_master_revision_lines l
  where l.revision_id = v_source.id
  order by l.sort_order, l.id;

  return v_revision_id;
end;
$$;

-- ---------- Draft保存 ----------
create or replace function public.save_base_master_draft(
  p_revision_id uuid,
  p_name text,
  p_fire_spec_code text,
  p_expense_method text,
  p_expense_rate numeric,
  p_expense_amount integer,
  p_lines jsonb
)
returns public.base_master_revisions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_revision public.base_master_revisions;
  v_master public.base_masters;
  v_row jsonb;
  v_line_key uuid;
  v_seen uuid[] := '{}';
  v_sort integer := 0;
  v_section text;
  v_name text;
  v_quantity numeric;
  v_unit text;
  v_unit_price integer;
  v_amount integer;
  v_line_subtotal integer := 0;
  v_expense_rate numeric(8, 6);
  v_expense_amount integer;
  v_total integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  select *
    into v_revision
    from public.base_master_revisions
   where id = p_revision_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: 本体Draftが見つかりません' using errcode = 'P0002';
  end if;

  if v_revision.status <> 'draft' then
    raise exception 'LOCKED: 公開済みRevisionは編集できません' using errcode = 'P0001';
  end if;

  select *
    into v_master
    from public.base_masters
   where id = v_revision.base_master_id
   for update;

  if not public.can_edit_base_master(v_master.id) then
    raise exception 'FORBIDDEN: この本体を編集できません' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'VALIDATION: 本体名を入力してください' using errcode = 'P0001';
  end if;

  if p_fire_spec_code not in ('non_fire', 'fire') then
    raise exception 'VALIDATION: 防火区分が不正です' using errcode = 'P0001';
  end if;

  if p_expense_method not in ('rate', 'fixed', 'none') then
    raise exception 'VALIDATION: 諸費用の計算方法が不正です' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'VALIDATION: 明細形式が不正です' using errcode = 'P0001';
  end if;

  if p_expense_method = 'rate' then
    if p_expense_rate is null or p_expense_rate < 0 or p_expense_rate > 1 then
      raise exception 'VALIDATION: 諸費用率は0以上1以下で入力してください' using errcode = 'P0001';
    end if;
    v_expense_rate := p_expense_rate::numeric(8, 6);
  else
    v_expense_rate := null;
  end if;

  if p_expense_method = 'fixed' and coalesce(p_expense_amount, -1) < 0 then
    raise exception 'VALIDATION: 固定諸費用は0円以上で入力してください' using errcode = 'P0001';
  end if;

  update public.base_masters
     set name = btrim(p_name),
         fire_spec_code = p_fire_spec_code,
         updated_by = v_uid
   where id = v_master.id;

  for v_row in
    select value
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_sort := v_sort + 1;
    v_section := btrim(coalesce(v_row ->> 'section', ''));
    v_name := btrim(coalesce(v_row ->> 'name', ''));
    v_unit := nullif(btrim(coalesce(v_row ->> 'unit', '')), '');
    v_quantity := coalesce(nullif(v_row ->> 'quantity', '')::numeric, 1);
    v_unit_price := coalesce(nullif(v_row ->> 'unit_price', '')::integer, 0);

    if v_section = '' then
      raise exception 'VALIDATION: %行目の工事区分を入力してください', v_sort using errcode = 'P0001';
    end if;
    if v_name = '' then
      raise exception 'VALIDATION: %行目の項目名を入力してください', v_sort using errcode = 'P0001';
    end if;
    if v_quantity <= 0 then
      raise exception 'VALIDATION: %行目の数量は0より大きい値にしてください', v_sort using errcode = 'P0001';
    end if;
    if v_unit_price < 0 then
      raise exception 'VALIDATION: %行目の単価は0円以上にしてください', v_sort using errcode = 'P0001';
    end if;

    begin
      v_line_key := nullif(v_row ->> 'line_key', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'VALIDATION: %行目のline_keyが不正です', v_sort using errcode = 'P0001';
    end;

    if v_line_key is null then
      v_line_key := gen_random_uuid();
    end if;

    if v_line_key = any(v_seen) then
      raise exception 'VALIDATION: 明細line_keyが重複しています' using errcode = 'P0001';
    end if;
    v_seen := array_append(v_seen, v_line_key);

    v_amount := round(v_unit_price::numeric * v_quantity)::integer;
    v_line_subtotal := v_line_subtotal + v_amount;

    insert into public.base_master_revision_lines (
      revision_id,
      line_key,
      section,
      name,
      quantity,
      unit,
      unit_price,
      amount,
      remark,
      sort_order
    )
    values (
      v_revision.id,
      v_line_key,
      v_section,
      v_name,
      v_quantity,
      v_unit,
      v_unit_price,
      v_amount,
      nullif(btrim(coalesce(v_row ->> 'remark', '')), ''),
      v_sort
    )
    on conflict (revision_id, line_key) do update
      set section = excluded.section,
          name = excluded.name,
          quantity = excluded.quantity,
          unit = excluded.unit,
          unit_price = excluded.unit_price,
          amount = excluded.amount,
          remark = excluded.remark,
          sort_order = excluded.sort_order;
  end loop;

  if cardinality(v_seen) = 0 then
    delete from public.base_master_revision_lines
     where revision_id = v_revision.id;
  else
    delete from public.base_master_revision_lines
     where revision_id = v_revision.id
       and not (line_key = any(v_seen));
  end if;

  if p_expense_method = 'rate' then
    v_expense_amount := floor(v_line_subtotal::numeric * v_expense_rate)::integer;
  elsif p_expense_method = 'fixed' then
    v_expense_amount := p_expense_amount;
  else
    v_expense_amount := 0;
  end if;

  v_total := v_line_subtotal + v_expense_amount;

  update public.base_master_revisions
     set expense_method = p_expense_method,
         expense_rate = v_expense_rate,
         expense_amount = v_expense_amount,
         line_subtotal = v_line_subtotal,
         total = v_total
   where id = v_revision.id
   returning * into v_revision;

  return v_revision;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'VALIDATION: 数量・単価の入力形式を確認してください' using errcode = 'P0001';
end;
$$;

-- ---------- Draft公開 ----------
create or replace function public.publish_base_master_draft(
  p_revision_id uuid
)
returns public.base_master_revisions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_revision public.base_master_revisions;
  v_master public.base_masters;
  v_old_revision_id uuid;
  v_count integer;
  v_line_subtotal integer;
  v_expense_amount integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  select *
    into v_revision
    from public.base_master_revisions
   where id = p_revision_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: 本体Draftが見つかりません' using errcode = 'P0002';
  end if;

  if v_revision.status <> 'draft' then
    raise exception 'LOCKED: Draftだけ公開できます' using errcode = 'P0001';
  end if;

  select *
    into v_master
    from public.base_masters
   where id = v_revision.base_master_id
   for update;

  if not public.can_edit_base_master(v_master.id) then
    raise exception 'FORBIDDEN: この本体を公開できません' using errcode = '42501';
  end if;

  select count(*)
    into v_count
    from public.base_master_revision_lines
   where revision_id = v_revision.id;

  if v_count = 0 then
    raise exception 'VALIDATION: 本体明細を1行以上登録してください' using errcode = 'P0001';
  end if;

  -- amountを入力値として信用せず、公開直前に数量×単価で再計算する。
  update public.base_master_revision_lines
     set amount = round(unit_price::numeric * quantity)::integer
   where revision_id = v_revision.id
     and amount is distinct from round(unit_price::numeric * quantity)::integer;

  select coalesce(sum(amount), 0)::integer
    into v_line_subtotal
    from public.base_master_revision_lines
   where revision_id = v_revision.id;

  if v_revision.expense_method = 'rate' then
    if v_revision.expense_rate is null or v_revision.expense_rate < 0 or v_revision.expense_rate > 1 then
      raise exception 'VALIDATION: 諸費用率が不正です' using errcode = 'P0001';
    end if;
    v_expense_amount := floor(v_line_subtotal::numeric * v_revision.expense_rate)::integer;
  elsif v_revision.expense_method = 'fixed' then
    if v_revision.expense_amount < 0 then
      raise exception 'VALIDATION: 固定諸費用が不正です' using errcode = 'P0001';
    end if;
    v_expense_amount := v_revision.expense_amount;
  elsif v_revision.expense_method = 'none' then
    v_expense_amount := 0;
  else
    raise exception 'VALIDATION: 諸費用の計算方法が不正です' using errcode = 'P0001';
  end if;

  update public.base_master_revisions
     set line_subtotal = v_line_subtotal,
         expense_amount = v_expense_amount,
         total = v_line_subtotal + v_expense_amount
   where id = v_revision.id;

  v_old_revision_id := v_master.current_published_revision_id;

  if v_old_revision_id is not null then
    update public.base_master_revisions
       set status = 'superseded'
     where id = v_old_revision_id
       and base_master_id = v_master.id
       and status = 'published';

    if not found then
      raise exception 'VALIDATION: 現在公開版が不正です' using errcode = 'P0001';
    end if;
  end if;

  update public.base_master_revisions
     set status = 'published',
         published_by = v_uid,
         published_at = now()
   where id = v_revision.id
   returning * into v_revision;

  update public.base_masters
     set current_published_revision_id = v_revision.id,
         updated_by = v_uid
   where id = v_master.id;

  return v_revision;
end;
$$;

-- ---------- Draft破棄 ----------
create or replace function public.discard_base_master_draft(
  p_revision_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_revision public.base_master_revisions;
  v_master public.base_masters;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  select *
    into v_revision
    from public.base_master_revisions
   where id = p_revision_id
   for update;

  if not found then
    return true;
  end if;

  if v_revision.status <> 'draft' then
    raise exception 'LOCKED: Draftだけ破棄できます' using errcode = 'P0001';
  end if;

  select *
    into v_master
    from public.base_masters
   where id = v_revision.base_master_id
   for update;

  if not public.can_edit_base_master(v_master.id) then
    raise exception 'FORBIDDEN: この本体Draftを破棄できません' using errcode = '42501';
  end if;

  if v_master.current_published_revision_id is null
     and not exists (
       select 1
         from public.base_master_revisions r
        where r.base_master_id = v_master.id
          and r.status in ('published', 'superseded')
     )
  then
    -- 一度も公開していない新規本体なら論理マスターごと取り消す。
    delete from public.base_masters where id = v_master.id;
  else
    delete from public.base_master_revisions where id = v_revision.id;
  end if;

  return true;
end;
$$;

-- 0006_api_grants.sql のdefault EXECUTEを明示的に剥がす。
revoke all on function public.create_base_master_draft(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.start_base_master_draft(uuid)
  from public, anon, authenticated;
revoke all on function public.save_base_master_draft(uuid, text, text, text, numeric, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.publish_base_master_draft(uuid)
  from public, anon, authenticated;
revoke all on function public.discard_base_master_draft(uuid)
  from public, anon, authenticated;

grant execute on function public.create_base_master_draft(uuid, uuid, text, text, uuid),
                          public.start_base_master_draft(uuid),
                          public.save_base_master_draft(uuid, text, text, text, numeric, integer, jsonb),
                          public.publish_base_master_draft(uuid),
                          public.discard_base_master_draft(uuid)
to authenticated, service_role;
