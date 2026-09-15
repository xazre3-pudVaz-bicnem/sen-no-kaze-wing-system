-- =============================================================
-- 旧本体移行Draft: 防火確認・最終検算・一括Publish
-- PR #111 の移行Draftを監査済みのままPublishする専用工程。
-- Standard Estimate / Quote / Configuration / Simulator は変更しない。
-- =============================================================

-- ---------- 監査列 ----------
alter table public.legacy_base_migration_batches
  add column if not exists validated_by uuid references public.profiles(id) on delete set null,
  add column if not exists validated_at timestamptz,
  add column if not exists completed_by uuid references public.profiles(id) on delete set null;

alter table public.legacy_base_migration_draft_outputs
  add column if not exists confirmed_fire_spec_code text,
  add column if not exists fire_spec_review_note text,
  add column if not exists fire_spec_reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists fire_spec_reviewed_at timestamptz,
  add column if not exists fire_spec_review_version integer not null default 0;

alter table public.legacy_base_migration_draft_outputs
  add constraint legacy_base_migration_confirmed_fire_spec_chk
    check (confirmed_fire_spec_code is null or confirmed_fire_spec_code in ('non_fire', 'fire')),
  add constraint legacy_base_migration_fire_review_note_chk
    check (fire_spec_review_note is null or nullif(btrim(fire_spec_review_note), '') is not null),
  add constraint legacy_base_migration_fire_review_version_chk
    check (fire_spec_review_version >= 0);

-- ---------- 移行Draft共通判定 ----------
create or replace function public.is_legacy_base_migration_draft(p_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
     where o.revision_id = p_revision_id
  );
$$;

-- ---------- 通常save/discardを移行Draftから隔離 ----------
-- 既存実装は内部化し、公開名のwrapperで移行Draftだけを拒否する。
alter function public.save_base_master_draft(uuid, text, text, text, numeric, integer, jsonb)
  rename to save_base_master_draft_regular_internal;

alter function public.discard_base_master_draft(uuid)
  rename to discard_base_master_draft_regular_internal;

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
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if public.is_legacy_base_migration_draft(p_revision_id) then
    raise exception 'LOCKED: 旧本体移行Draftは移行監査画面から確認してください'
      using errcode = 'P0001';
  end if;

  return public.save_base_master_draft_regular_internal(
    p_revision_id,
    p_name,
    p_fire_spec_code,
    p_expense_method,
    p_expense_rate,
    p_expense_amount,
    p_lines
  );
end;
$$;

create or replace function public.discard_base_master_draft(p_revision_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if public.is_legacy_base_migration_draft(p_revision_id) then
    raise exception 'LOCKED: 旧本体移行Draftは移行監査画面から確認してください'
      using errcode = 'P0001';
  end if;

  return public.discard_base_master_draft_regular_internal(p_revision_id);
end;
$$;

-- ---------- Publish共通内部helper ----------
-- regular: 従来どおり数量×単価を再計算して正式値へ揃える。
-- migration: 保存値を書き換えず、再計算結果との完全一致だけを確認する。
create or replace function public.publish_base_master_draft_internal(
  p_revision_id uuid,
  p_actor uuid,
  p_mode text
)
returns public.base_master_revisions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision public.base_master_revisions;
  v_master public.base_masters;
  v_old_revision_id uuid;
  v_count integer;
  v_line_subtotal integer;
  v_expense_amount integer;
begin
  if p_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if p_mode not in ('regular', 'migration') then
    raise exception 'VALIDATION: Publish modeが不正です' using errcode = 'P0001';
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

  if not found then
    raise exception 'NOT_FOUND: 本体マスターが見つかりません' using errcode = 'P0002';
  end if;

  if p_mode = 'regular' and not public.can_edit_base_master(v_master.id) then
    raise exception 'FORBIDDEN: この本体を公開できません' using errcode = '42501';
  end if;

  select count(*)
    into v_count
    from public.base_master_revision_lines
   where revision_id = v_revision.id;

  if v_count = 0 then
    raise exception 'VALIDATION: 本体明細を1行以上登録してください' using errcode = 'P0001';
  end if;

  if p_mode = 'regular' then
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
     where id = v_revision.id
     returning * into v_revision;
  else
    if exists (
      select 1
        from public.base_master_revision_lines l
       where l.revision_id = v_revision.id
         and l.amount is distinct from round(l.unit_price::numeric * l.quantity)::integer
    ) then
      raise exception 'VALIDATION: 移行Draftの金額が監査済み値と一致しません'
        using errcode = 'P0001';
    end if;

    select coalesce(sum(amount), 0)::integer
      into v_line_subtotal
      from public.base_master_revision_lines
     where revision_id = v_revision.id;

    if v_line_subtotal is distinct from v_revision.line_subtotal then
      raise exception 'VALIDATION: 移行Draftの金額が監査済み値と一致しません'
        using errcode = 'P0001';
    end if;

    if v_revision.expense_method = 'rate' then
      if v_revision.expense_rate is null or v_revision.expense_rate < 0 or v_revision.expense_rate > 1 then
        raise exception 'VALIDATION: 移行Draftの諸費用率が不正です' using errcode = 'P0001';
      end if;
      v_expense_amount := floor(v_line_subtotal::numeric * v_revision.expense_rate)::integer;
    elsif v_revision.expense_method = 'fixed' then
      if v_revision.expense_rate is not null or v_revision.expense_amount < 0 then
        raise exception 'VALIDATION: 移行Draftの固定諸費用が不正です' using errcode = 'P0001';
      end if;
      v_expense_amount := v_revision.expense_amount;
    elsif v_revision.expense_method = 'none' then
      if v_revision.expense_rate is not null then
        raise exception 'VALIDATION: 移行Draftの諸費用設定が不正です' using errcode = 'P0001';
      end if;
      v_expense_amount := 0;
    else
      raise exception 'VALIDATION: 移行Draftの諸費用計算方法が不正です' using errcode = 'P0001';
    end if;

    if v_expense_amount is distinct from v_revision.expense_amount
       or v_revision.total is distinct from v_revision.line_subtotal + v_revision.expense_amount
    then
      raise exception 'VALIDATION: 移行Draftの金額が監査済み値と一致しません'
        using errcode = 'P0001';
    end if;
  end if;

  v_old_revision_id := v_master.current_published_revision_id;

  if p_mode = 'migration' and v_old_revision_id is not null then
    raise exception 'VALIDATION: 移行Draftの本体に既存Published Revisionがあります'
      using errcode = 'P0001';
  end if;

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
         published_by = p_actor,
         published_at = now()
   where id = v_revision.id
   returning * into v_revision;

  update public.base_masters
     set current_published_revision_id = v_revision.id,
         updated_by = p_actor
   where id = v_master.id;

  return v_revision;
end;
$$;

create or replace function public.publish_base_master_draft(p_revision_id uuid)
returns public.base_master_revisions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if public.is_legacy_base_migration_draft(p_revision_id) then
    raise exception 'LOCKED: 旧本体移行Draftは移行batch専用Publishから公開してください'
      using errcode = 'P0001';
  end if;

  return public.publish_base_master_draft_internal(p_revision_id, v_uid, 'regular');
end;
$$;

-- ---------- PR #111 Publish trigger強化 ----------
create or replace function public.prevent_unreviewed_legacy_base_migration_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guard record;
begin
  if old.status = 'draft' and new.status = 'published' then
    select
      o.fire_spec_review_required,
      o.confirmed_fire_spec_code,
      o.fire_spec_review_note,
      o.fire_spec_reviewed_by,
      o.fire_spec_reviewed_at,
      b.status as batch_status,
      bm.fire_spec_code
      into v_guard
      from public.legacy_base_migration_draft_outputs o
      join public.legacy_base_migration_batches b on b.id = o.migration_batch_id
      join public.base_masters bm on bm.id = o.base_master_id
     where o.revision_id = old.id;

    if found and (
      v_guard.fire_spec_review_required
      or v_guard.confirmed_fire_spec_code is null
      or nullif(btrim(coalesce(v_guard.fire_spec_review_note, '')), '') is null
      or v_guard.fire_spec_reviewed_by is null
      or v_guard.fire_spec_reviewed_at is null
      or v_guard.fire_spec_code is distinct from v_guard.confirmed_fire_spec_code
      or v_guard.batch_status <> 'validated'
    ) then
      raise exception 'LOCKED: 旧本体移行Draftは防火確認と最終検算完了後に専用Publishしてください'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- ---------- 移行Draft完全性検算 ----------
create or replace function public.validate_legacy_base_draft_materialization(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $validate$
declare
  v_group_count integer;
  v_output_count integer;
  v_line_count integer;
  v_link_count integer;
begin
  select count(*)
    into v_group_count
    from (
      select s.base_model_id, s.proposed_group_key
        from public.legacy_base_spec_mappings s
       where s.migration_batch_id = p_batch_id
         and s.decision_status = 'approved'
         and nullif(btrim(coalesce(s.proposed_group_key, '')), '') is not null
       group by s.base_model_id, s.proposed_group_key
    ) g;

  select count(*)
    into v_output_count
    from public.legacy_base_migration_draft_outputs o
   where o.migration_batch_id = p_batch_id;

  if v_group_count <> v_output_count then
    raise exception 'VALIDATION: 新本体Draft数が監査済みgroup数と一致しません'
      using errcode = 'P0001';
  end if;

  if v_output_count = 0 then
    raise exception 'VALIDATION: 検算対象の新本体Draftがありません'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
     where o.migration_batch_id = p_batch_id
       and not exists (
         select 1
           from public.legacy_base_spec_mappings s
          where s.migration_batch_id = p_batch_id
            and s.base_model_id = o.base_model_id
            and s.proposed_group_key = o.proposed_group_key
            and s.decision_status = 'approved'
       )
  ) then
    raise exception 'VALIDATION: 新本体Draftに監査済みgroupと対応しない出力があります'
      using errcode = 'P0001';
  end if;

  -- 旧base行 -> 新line
  if exists (
    select 1
      from public.legacy_base_breakdown_mappings m
      join public.legacy_base_spec_mappings s
        on s.migration_batch_id = m.migration_batch_id
       and s.base_model_id = m.base_model_id
       and s.legacy_spec_code = m.legacy_spec_code
     where m.migration_batch_id = p_batch_id
       and m.review_status = 'approved'
       and m.target_classification = 'base'
       and s.decision_status = 'approved'
       and not exists (
         select 1
           from public.legacy_base_migration_line_links l
           join public.legacy_base_migration_draft_outputs o on o.id = l.draft_output_id
          where l.migration_batch_id = p_batch_id
            and l.mapping_id = m.id
            and o.migration_batch_id = p_batch_id
            and o.base_model_id = m.base_model_id
            and o.proposed_group_key = s.proposed_group_key
       )
  ) then
    raise exception 'VALIDATION: 新lineへ追跡できない旧本体行があります'
      using errcode = 'P0001';
  end if;

  -- linkそのものの所属・追跡先整合性
  if exists (
    select 1
      from public.legacy_base_migration_line_links l
      join public.legacy_base_breakdown_mappings m on m.id = l.mapping_id
      join public.legacy_base_migration_draft_outputs o on o.id = l.draft_output_id
      left join public.legacy_base_spec_mappings s
        on s.migration_batch_id = m.migration_batch_id
       and s.base_model_id = m.base_model_id
       and s.legacy_spec_code = m.legacy_spec_code
      left join public.base_master_revision_lines nl on nl.id = l.revision_line_id
     where l.migration_batch_id = p_batch_id
       and (
         m.migration_batch_id <> p_batch_id
         or o.migration_batch_id <> p_batch_id
         or m.review_status <> 'approved'
         or m.target_classification <> 'base'
         or s.id is null
         or s.decision_status <> 'approved'
         or s.proposed_group_key is distinct from o.proposed_group_key
         or s.base_model_id <> o.base_model_id
         or l.revision_line_id is null
         or nl.id is null
         or nl.revision_id <> o.revision_id
         or nl.line_key <> l.revision_line_key
       )
  ) then
    raise exception 'VALIDATION: 旧行から新lineへのprovenanceが不整合です'
      using errcode = 'P0001';
  end if;

  -- 新line -> 旧base行。後から追加された余計な明細もここで検出する。
  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
      join public.base_master_revision_lines nl on nl.revision_id = o.revision_id
     where o.migration_batch_id = p_batch_id
       and not exists (
         select 1
           from public.legacy_base_migration_line_links l
           join public.legacy_base_breakdown_mappings m on m.id = l.mapping_id
          where l.migration_batch_id = p_batch_id
            and l.draft_output_id = o.id
            and l.revision_line_id = nl.id
            and l.revision_line_key = nl.line_key
            and m.review_status = 'approved'
            and m.target_classification = 'base'
       )
  ) then
    raise exception 'VALIDATION: 旧本体行へ追跡できない余計な新lineがあります'
      using errcode = 'P0001';
  end if;

  -- 新line数は全旧mapping総数ではなく、代表旧specのapproved + base行数と一致させる。
  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
     where o.migration_batch_id = p_batch_id
       and (
         select count(*)
           from public.base_master_revision_lines nl
          where nl.revision_id = o.revision_id
       ) <> (
         select count(*)
           from public.legacy_base_breakdown_mappings m
          where m.migration_batch_id = p_batch_id
            and m.base_model_id = o.base_model_id
            and m.legacy_spec_code = o.representative_legacy_spec_code
            and m.review_status = 'approved'
            and m.target_classification = 'base'
       )
  ) then
    raise exception 'VALIDATION: 新line数が代表旧specのapproved + base行数と一致しません'
      using errcode = 'P0001';
  end if;

  -- link先明細は旧mappingと全項目を完全一致させる。
  if exists (
    select 1
      from public.legacy_base_migration_line_links l
      join public.legacy_base_breakdown_mappings m on m.id = l.mapping_id
      join public.base_master_revision_lines nl on nl.id = l.revision_line_id
     where l.migration_batch_id = p_batch_id
       and (
         m.legacy_section is distinct from nl.section
         or m.legacy_name is distinct from nl.name
         or m.legacy_quantity is distinct from nl.quantity
         or m.legacy_unit is distinct from nl.unit
         or m.legacy_unit_price is distinct from nl.unit_price
         or m.legacy_amount is distinct from nl.amount
         or m.legacy_remark is distinct from nl.remark
       )
  ) then
    raise exception 'VALIDATION: 旧本体行と新lineの明細内容が完全一致しません'
      using errcode = 'P0001';
  end if;

  -- line amount = round(unit_price * quantity)
  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
      join public.base_master_revision_lines nl on nl.revision_id = o.revision_id
     where o.migration_batch_id = p_batch_id
       and nl.amount is distinct from round(nl.unit_price::numeric * nl.quantity)::integer
  ) then
    raise exception 'VALIDATION: 新本体lineのamountが数量×単価の1円計算と一致しません'
      using errcode = 'P0001';
  end if;

  -- 代表旧spec合計・新line合計・Revision・outputを1円単位で一致させる。
  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
      join public.base_master_revisions r on r.id = o.revision_id
     where o.migration_batch_id = p_batch_id
       and (
         coalesce((
           select sum(m.legacy_amount)::integer
             from public.legacy_base_breakdown_mappings m
            where m.migration_batch_id = p_batch_id
              and m.base_model_id = o.base_model_id
              and m.legacy_spec_code = o.representative_legacy_spec_code
              and m.review_status = 'approved'
              and m.target_classification = 'base'
         ), 0) <> o.source_classified_base_line_total
         or coalesce((
           select sum(nl.amount)::integer
             from public.base_master_revision_lines nl
            where nl.revision_id = o.revision_id
         ), 0) <> r.line_subtotal
         or r.line_subtotal <> o.target_line_subtotal
         or o.target_line_subtotal <> o.source_classified_base_line_total
       )
  ) then
    raise exception 'VALIDATION: 旧base判定行合計と新Draft line_subtotalが1円単位で一致しません'
      using errcode = 'P0001';
  end if;

  -- 諸費用の方式・率・額をoutputと一致させ、方式ごとの計算式も再検証する。
  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
      join public.base_master_revisions r on r.id = o.revision_id
     where o.migration_batch_id = p_batch_id
       and (
         r.expense_method is distinct from o.target_expense_method
         or r.expense_rate is distinct from o.target_expense_rate
         or r.expense_amount is distinct from o.target_expense_amount
         or (
           r.expense_method = 'rate'
           and (
             r.expense_rate is null
             or r.expense_rate < 0
             or r.expense_rate > 1
             or r.expense_amount is distinct from floor(r.line_subtotal::numeric * r.expense_rate)::integer
           )
         )
         or (
           r.expense_method = 'fixed'
           and (
             r.expense_rate is not null
             or r.expense_amount is distinct from o.legacy_base_expense
           )
         )
         or (
           r.expense_method = 'none'
           and (r.expense_rate is not null or r.expense_amount <> 0)
         )
       )
  ) then
    raise exception 'VALIDATION: 移行Draftの諸費用が監査済み値または計算式と一致しません'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
      join public.base_master_revisions r on r.id = o.revision_id
     where o.migration_batch_id = p_batch_id
       and (
         r.total is distinct from r.line_subtotal + r.expense_amount
         or r.total is distinct from o.target_total
       )
  ) then
    raise exception 'VALIDATION: 移行Draftのtotalが監査済み値と一致しません'
      using errcode = 'P0001';
  end if;

  -- HQ所有・未Publish・Draft v1・名称固定を再確認する。
  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
      join public.base_masters b on b.id = o.base_master_id
      join public.base_models bm on bm.id = o.base_model_id
      join public.organizations owner_org on owner_org.id = b.owner_organization_id
      join public.base_master_revisions r on r.id = o.revision_id
     where o.migration_batch_id = p_batch_id
       and (
         b.base_model_id <> o.base_model_id
         or b.name is distinct from format('%s / %s', bm.name, o.proposed_group_key)
         or b.status <> 'active'
         or b.current_published_revision_id is not null
         or owner_org.code <> 'gijutsu-no-mori'
         or owner_org.organization_type <> 'headquarters'
         or owner_org.status <> 'active'
         or r.base_master_id <> o.base_master_id
         or r.status <> 'draft'
         or r.version <> 1
         or exists (
           select 1
             from public.base_master_revisions h
            where h.base_master_id = b.id
              and h.id <> r.id
         )
       )
  ) then
    raise exception 'VALIDATION: HQ所有の移行Draft状態が不正です'
      using errcode = 'P0001';
  end if;

  -- 防火確認前/後の2状態だけを許可する。
  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
      join public.base_masters b on b.id = o.base_master_id
     where o.migration_batch_id = p_batch_id
       and not (
         (
           o.fire_spec_review_required = true
           and o.confirmed_fire_spec_code is null
           and o.fire_spec_review_note is null
           and o.fire_spec_reviewed_by is null
           and o.fire_spec_reviewed_at is null
           and o.fire_spec_review_version = 0
           and b.fire_spec_code = o.initial_fire_spec_code
         )
         or
         (
           o.fire_spec_review_required = false
           and o.confirmed_fire_spec_code in ('non_fire', 'fire')
           and nullif(btrim(coalesce(o.fire_spec_review_note, '')), '') is not null
           and o.fire_spec_reviewed_by is not null
           and o.fire_spec_reviewed_at is not null
           and o.fire_spec_review_version > 0
           and b.fire_spec_code = o.confirmed_fire_spec_code
         )
       )
  ) then
    raise exception 'VALIDATION: 移行Draftの防火確認状態が不整合です'
      using errcode = 'P0001';
  end if;

  select count(*)
    into v_line_count
    from public.base_master_revision_lines nl
    join public.legacy_base_migration_draft_outputs o on o.revision_id = nl.revision_id
   where o.migration_batch_id = p_batch_id;

  select count(*)
    into v_link_count
    from public.legacy_base_migration_line_links l
   where l.migration_batch_id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'base_master_count', v_output_count,
    'revision_line_count', v_line_count,
    'line_link_count', v_link_count,
    'provenance', 'ok',
    'money_validation', 'ok'
  );
end;
$validate$;

-- ---------- 防火区分確認 ----------
create or replace function public.confirm_legacy_base_migration_fire_spec(
  p_draft_output_id uuid,
  p_expected_review_version integer,
  p_fire_spec_code text,
  p_review_note text
)
returns public.legacy_base_migration_draft_outputs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_output public.legacy_base_migration_draft_outputs;
  v_batch public.legacy_base_migration_batches;
  v_revision public.base_master_revisions;
  v_master public.base_masters;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if not public.can_manage_legacy_base_migration() then
    raise exception 'FORBIDDEN: 防火区分を確認する権限がありません'
      using errcode = '42501';
  end if;

  if p_expected_review_version is null or p_expected_review_version < 0 then
    raise exception 'VALIDATION: 防火確認versionが不正です' using errcode = 'P0001';
  end if;

  if p_fire_spec_code not in ('non_fire', 'fire') then
    raise exception 'VALIDATION: 防火区分が不正です' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_review_note, '')), '') is null then
    raise exception 'VALIDATION: 防火区分の確認根拠を入力してください' using errcode = 'P0001';
  end if;

  select *
    into v_output
    from public.legacy_base_migration_draft_outputs
   where id = p_draft_output_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: 移行Draftが見つかりません' using errcode = 'P0002';
  end if;

  select *
    into v_batch
    from public.legacy_base_migration_batches
   where id = v_output.migration_batch_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: 移行バッチが見つかりません' using errcode = 'P0002';
  end if;

  if v_batch.status <> 'migrated' then
    raise exception 'LOCKED: migratedの移行Draftだけ防火区分を確認できます'
      using errcode = 'P0001';
  end if;

  select *
    into v_revision
    from public.base_master_revisions
   where id = v_output.revision_id
   for update;

  if not found or v_revision.status <> 'draft' then
    raise exception 'LOCKED: 移行RevisionがDraftではありません' using errcode = 'P0001';
  end if;

  select *
    into v_master
    from public.base_masters
   where id = v_output.base_master_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: 移行本体が見つかりません' using errcode = 'P0002';
  end if;

  if v_master.current_published_revision_id is not null
     or exists (
       select 1
         from public.base_master_revisions r
        where r.base_master_id = v_master.id
          and r.status in ('published', 'superseded')
     )
  then
    raise exception 'LOCKED: すでにPublished履歴のある本体は防火区分を変更できません'
      using errcode = 'P0001';
  end if;

  if v_output.fire_spec_review_version <> p_expected_review_version then
    raise exception 'CONFLICT: 防火区分は他のユーザーによって更新されています。画面を再読込してください'
      using errcode = '40001';
  end if;

  perform public.validate_legacy_base_draft_materialization(v_output.migration_batch_id);

  update public.base_masters
     set fire_spec_code = p_fire_spec_code,
         updated_by = v_uid
   where id = v_master.id;

  update public.legacy_base_migration_draft_outputs
     set confirmed_fire_spec_code = p_fire_spec_code,
         fire_spec_review_note = btrim(p_review_note),
         fire_spec_reviewed_by = v_uid,
         fire_spec_reviewed_at = now(),
         fire_spec_review_required = false,
         fire_spec_review_version = fire_spec_review_version + 1
   where id = v_output.id
     and fire_spec_review_version = p_expected_review_version
  returning * into v_output;

  if not found then
    raise exception 'CONFLICT: 防火区分は他のユーザーによって更新されています。画面を再読込してください'
      using errcode = '40001';
  end if;

  perform public.validate_legacy_base_draft_materialization(v_output.migration_batch_id);

  return v_output;
end;
$$;

-- ---------- 最終検算 ----------
create or replace function public.finalize_legacy_base_migration_draft_validation(p_batch_id uuid)
returns public.legacy_base_migration_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.legacy_base_migration_batches;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if not public.can_manage_legacy_base_migration() then
    raise exception 'FORBIDDEN: 移行Draftを最終検算する権限がありません'
      using errcode = '42501';
  end if;

  select *
    into v_batch
    from public.legacy_base_migration_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: 移行バッチが見つかりません' using errcode = 'P0002';
  end if;

  if v_batch.status = 'validated' then
    perform public.validate_legacy_base_draft_materialization(p_batch_id);

    if exists (
      select 1
        from public.legacy_base_migration_draft_outputs o
       where o.migration_batch_id = p_batch_id
         and (
           o.fire_spec_review_required
           or o.confirmed_fire_spec_code is null
           or nullif(btrim(coalesce(o.fire_spec_review_note, '')), '') is null
           or o.fire_spec_reviewed_by is null
           or o.fire_spec_reviewed_at is null
         )
    ) then
      raise exception 'VALIDATION: 防火区分が未確認の移行Draftがあります'
        using errcode = 'P0001';
    end if;

    return v_batch;
  end if;

  if v_batch.status <> 'migrated' then
    raise exception 'LOCKED: migratedの移行バッチだけ最終検算できます'
      using errcode = 'P0001';
  end if;

  perform public.validate_legacy_base_draft_materialization(p_batch_id);

  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
      join public.base_masters b on b.id = o.base_master_id
     where o.migration_batch_id = p_batch_id
       and (
         o.fire_spec_review_required
         or o.confirmed_fire_spec_code is null
         or nullif(btrim(coalesce(o.fire_spec_review_note, '')), '') is null
         or o.fire_spec_reviewed_by is null
         or o.fire_spec_reviewed_at is null
         or b.fire_spec_code is distinct from o.confirmed_fire_spec_code
       )
  ) then
    raise exception 'VALIDATION: 防火区分が未確認の移行Draftがあります'
      using errcode = 'P0001';
  end if;

  update public.legacy_base_migration_batches
     set status = 'validated',
         validated_by = v_uid,
         validated_at = now()
   where id = p_batch_id
   returning * into v_batch;

  return v_batch;
end;
$$;

-- ---------- Publish後整合確認 ----------
create or replace function public.validate_legacy_base_migration_published_outputs(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_output_count integer;
begin
  select count(*)
    into v_output_count
    from public.legacy_base_migration_draft_outputs o
   where o.migration_batch_id = p_batch_id;

  if v_output_count = 0 then
    raise exception 'VALIDATION: Publish済み出力がありません' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
      join public.base_master_revisions r on r.id = o.revision_id
      join public.base_masters b on b.id = o.base_master_id
     where o.migration_batch_id = p_batch_id
       and (
         r.status <> 'published'
         or b.current_published_revision_id is distinct from o.revision_id
         or r.line_subtotal is distinct from o.target_line_subtotal
         or r.expense_amount is distinct from o.target_expense_amount
         or r.total is distinct from o.target_total
         or b.fire_spec_code is distinct from o.confirmed_fire_spec_code
       )
  ) then
    raise exception 'VALIDATION: Publish後の本体Revisionまたは監査済み値が一致しません'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'published_base_master_count', v_output_count,
    'post_publish_validation', 'ok'
  );
end;
$$;

-- ---------- batch一括Publish ----------
create or replace function public.publish_legacy_base_migration_batch(p_batch_id uuid)
returns public.legacy_base_migration_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.legacy_base_migration_batches;
  v_output public.legacy_base_migration_draft_outputs;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if not public.can_manage_legacy_base_migration() then
    raise exception 'FORBIDDEN: 検算済み新本体をPublishする権限がありません'
      using errcode = '42501';
  end if;

  select *
    into v_batch
    from public.legacy_base_migration_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: 移行バッチが見つかりません' using errcode = 'P0002';
  end if;

  if v_batch.status = 'completed' then
    perform public.validate_legacy_base_migration_published_outputs(p_batch_id);
    return v_batch;
  end if;

  if v_batch.status <> 'validated' then
    raise exception 'LOCKED: validatedの移行バッチだけ一括Publishできます'
      using errcode = 'P0001';
  end if;

  -- Publish直前に、provenance・明細・1円・諸費用・防火を全件再検算する。
  perform public.validate_legacy_base_draft_materialization(p_batch_id);

  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
     where o.migration_batch_id = p_batch_id
       and (
         o.fire_spec_review_required
         or o.confirmed_fire_spec_code is null
         or nullif(btrim(coalesce(o.fire_spec_review_note, '')), '') is null
         or o.fire_spec_reviewed_by is null
         or o.fire_spec_reviewed_at is null
       )
  ) then
    raise exception 'VALIDATION: 防火区分が未確認の移行Draftがあります'
      using errcode = 'P0001';
  end if;

  -- 1回のRPC = 1 transaction。途中1件でも例外なら全件rollbackされる。
  for v_output in
    select o.*
      from public.legacy_base_migration_draft_outputs o
     where o.migration_batch_id = p_batch_id
     order by o.base_model_id::text, o.proposed_group_key, o.id::text
  loop
    perform public.publish_base_master_draft_internal(
      v_output.revision_id,
      v_uid,
      'migration'
    );
  end loop;

  perform public.validate_legacy_base_migration_published_outputs(p_batch_id);

  update public.legacy_base_migration_batches
     set status = 'completed',
         completed_by = v_uid,
         completed_at = now()
   where id = p_batch_id
   returning * into v_batch;

  return v_batch;
end;
$$;

-- ---------- 権限 ----------
-- renameした既存内部実装は外部から直接実行させない。
revoke all on function public.save_base_master_draft_regular_internal(uuid, text, text, text, numeric, integer, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.discard_base_master_draft_regular_internal(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.is_legacy_base_migration_draft(uuid)
  from public, anon, authenticated;
revoke all on function public.publish_base_master_draft_internal(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_unreviewed_legacy_base_migration_publish()
  from public, anon, authenticated;
revoke all on function public.validate_legacy_base_draft_materialization(uuid)
  from public, anon, authenticated;
revoke all on function public.validate_legacy_base_migration_published_outputs(uuid)
  from public, anon, authenticated;
revoke all on function public.confirm_legacy_base_migration_fire_spec(uuid, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.finalize_legacy_base_migration_draft_validation(uuid)
  from public, anon, authenticated;
revoke all on function public.publish_legacy_base_migration_batch(uuid)
  from public, anon, authenticated;

revoke all on function public.save_base_master_draft(uuid, text, text, text, numeric, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.discard_base_master_draft(uuid)
  from public, anon, authenticated;
revoke all on function public.publish_base_master_draft(uuid)
  from public, anon, authenticated;

grant execute on function public.save_base_master_draft(uuid, text, text, text, numeric, integer, jsonb),
                          public.discard_base_master_draft(uuid),
                          public.publish_base_master_draft(uuid),
                          public.confirm_legacy_base_migration_fire_spec(uuid, integer, text, text),
                          public.finalize_legacy_base_migration_draft_validation(uuid),
                          public.publish_legacy_base_migration_batch(uuid)
to authenticated, service_role;

grant execute on function public.is_legacy_base_migration_draft(uuid),
                          public.validate_legacy_base_draft_materialization(uuid),
                          public.validate_legacy_base_migration_published_outputs(uuid),
                          public.prevent_unreviewed_legacy_base_migration_publish()
to service_role;

comment on function public.confirm_legacy_base_migration_fire_spec(uuid, integer, text, text) is
  '旧本体移行Draftの防火区分を楽観ロックで確定する。initial_fire_spec_codeは履歴として保持する。';

comment on function public.finalize_legacy_base_migration_draft_validation(uuid) is
  'migrated移行Draftを双方向provenance・1円・諸費用・HQ所有・防火確認まで最終検算してvalidatedへ進める。';

comment on function public.publish_legacy_base_migration_batch(uuid) is
  'validated batch内の全移行Draftを1 transactionで一括Publishし、全成功後だけcompletedへ進める。';
