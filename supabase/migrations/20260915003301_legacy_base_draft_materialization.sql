-- =============================================================
-- 監査済み旧本体 -> 新本体Draft作成
--
-- PR #106 で ready になった監査バッチだけを対象に、
-- approved + base の旧行を proposed_group_key 単位で
-- HQ所有の base_masters / base_master_revisions / revision_lines へ
-- Draftとして複製する。
--
-- このmigrationでは Publish / Simulator / Quote / 旧正本を変更しない。
-- =============================================================

alter table public.legacy_base_migration_batches
  add column if not exists migrated_by uuid references public.profiles(id) on delete set null,
  add column if not exists migrated_at timestamptz;

create table if not exists public.legacy_base_migration_draft_outputs (
  id uuid primary key default gen_random_uuid(),
  migration_batch_id uuid not null references public.legacy_base_migration_batches(id) on delete cascade,
  base_model_id uuid not null references public.base_models(id) on delete restrict,
  proposed_group_key text not null,
  representative_legacy_spec_code text not null,
  base_master_id uuid not null references public.base_masters(id) on delete restrict,
  revision_id uuid not null references public.base_master_revisions(id) on delete restrict,
  -- 旧spec_codeは hotel/residence/office という用途区分で、防火区分を保持していない。
  -- Draft作成時はnon_fireを仮置きし、Publish工程で明示確認する。
  initial_fire_spec_code text not null default 'non_fire'
    check (initial_fire_spec_code in ('non_fire', 'fire')),
  fire_spec_review_required boolean not null default true,
  source_classified_base_line_total integer not null check (source_classified_base_line_total >= 0),
  legacy_base_section_line_total numeric not null,
  legacy_base_expense_rate numeric,
  legacy_base_expense integer not null check (legacy_base_expense >= 0),
  legacy_base_total integer not null check (legacy_base_total >= 0),
  target_expense_method text not null check (target_expense_method in ('rate', 'fixed', 'none')),
  target_expense_rate numeric(8, 6),
  target_expense_amount integer not null check (target_expense_amount >= 0),
  target_line_subtotal integer not null check (target_line_subtotal >= 0),
  target_total integer not null check (target_total >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (migration_batch_id, base_model_id, proposed_group_key),
  unique (base_master_id),
  unique (revision_id),
  check (source_classified_base_line_total = target_line_subtotal),
  check (target_total = target_line_subtotal + target_expense_amount)
);

create table if not exists public.legacy_base_migration_line_links (
  id uuid primary key default gen_random_uuid(),
  migration_batch_id uuid not null references public.legacy_base_migration_batches(id) on delete cascade,
  draft_output_id uuid not null references public.legacy_base_migration_draft_outputs(id) on delete cascade,
  mapping_id uuid not null references public.legacy_base_breakdown_mappings(id) on delete cascade,
  legacy_item_id uuid not null,
  revision_line_id uuid references public.base_master_revision_lines(id) on delete set null,
  revision_line_key uuid not null,
  created_at timestamptz not null default now(),
  unique (migration_batch_id, mapping_id)
);

create index if not exists legacy_base_migration_draft_outputs_batch_idx
  on public.legacy_base_migration_draft_outputs(migration_batch_id, base_model_id, proposed_group_key);

create index if not exists legacy_base_migration_line_links_output_idx
  on public.legacy_base_migration_line_links(draft_output_id, mapping_id);

create or replace function public.legacy_base_migration_line_signature(
  p_section text,
  p_name text,
  p_quantity numeric,
  p_unit text,
  p_unit_price integer,
  p_amount integer,
  p_remark text,
  p_group_label text
)
returns text
language sql
immutable
set search_path = public
as $sig$
  select jsonb_build_array(
    lower(btrim(coalesce(p_section, ''))),
    lower(btrim(coalesce(p_name, ''))),
    p_quantity,
    lower(btrim(coalesce(p_unit, ''))),
    p_unit_price,
    p_amount,
    lower(btrim(coalesce(p_remark, ''))),
    lower(btrim(coalesce(p_group_label, '')))
  )::text;
$sig$;

create or replace function public.validate_legacy_base_draft_materialization(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $validate$
declare
  v_group_count integer;
  v_output_count integer;
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

  select count(*) into v_output_count
    from public.legacy_base_migration_draft_outputs o
   where o.migration_batch_id = p_batch_id;

  if v_group_count <> v_output_count then
    raise exception 'VALIDATION: 新本体Draft数が監査済みgroup数と一致しません'
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

  if exists (
    select 1
      from public.legacy_base_breakdown_mappings m
     where m.migration_batch_id = p_batch_id
       and m.review_status = 'approved'
       and m.target_classification = 'base'
       and not exists (
         select 1
           from public.legacy_base_migration_line_links l
          where l.migration_batch_id = p_batch_id
            and l.mapping_id = m.id
       )
  ) then
    raise exception 'VALIDATION: 新lineへ追跡できない旧本体行があります'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_migration_line_links l
      join public.legacy_base_breakdown_mappings m on m.id = l.mapping_id
      join public.legacy_base_migration_draft_outputs o on o.id = l.draft_output_id
      left join public.legacy_base_spec_mappings s
        on s.migration_batch_id = m.migration_batch_id
       and s.base_model_id = m.base_model_id
       and s.legacy_spec_code = m.legacy_spec_code
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
       )
  ) then
    raise exception 'VALIDATION: 本体以外または別groupの旧行が新本体Draftへ紐付いています'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_migration_line_links l
      join public.legacy_base_migration_draft_outputs o on o.id = l.draft_output_id
      left join public.base_master_revision_lines nl on nl.id = l.revision_line_id
     where l.migration_batch_id = p_batch_id
       and (
         l.revision_line_id is null
         or nl.id is null
         or nl.revision_id <> o.revision_id
         or nl.line_key <> l.revision_line_key
       )
  ) then
    raise exception 'VALIDATION: 旧行から新lineへの追跡先が不整合です'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_migration_line_links l
      join public.legacy_base_breakdown_mappings m on m.id = l.mapping_id
      join public.base_master_revision_lines nl on nl.id = l.revision_line_id
     where l.migration_batch_id = p_batch_id
       and (
         lower(btrim(m.legacy_section)) <> lower(btrim(nl.section))
         or lower(btrim(m.legacy_name)) <> lower(btrim(nl.name))
         or m.legacy_quantity <> nl.quantity
         or lower(btrim(coalesce(m.legacy_unit, ''))) <> lower(btrim(coalesce(nl.unit, '')))
         or m.legacy_unit_price <> nl.unit_price
         or m.legacy_amount <> nl.amount
         or lower(btrim(coalesce(m.legacy_remark, ''))) <> lower(btrim(coalesce(nl.remark, '')))
       )
  ) then
    raise exception 'VALIDATION: 旧本体行と新lineが1円単位または明細内容で一致しません'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
      join public.base_masters b on b.id = o.base_master_id
      join public.organizations owner_org on owner_org.id = b.owner_organization_id
      join public.base_master_revisions r on r.id = o.revision_id
     where o.migration_batch_id = p_batch_id
       and (
         b.base_model_id <> o.base_model_id
         or b.status <> 'active'
         or b.current_published_revision_id is not null
         or b.fire_spec_code <> o.initial_fire_spec_code
         or not o.fire_spec_review_required
         or owner_org.code <> 'gijutsu-no-mori'
         or owner_org.organization_type <> 'headquarters'
         or owner_org.status <> 'active'
         or r.base_master_id <> o.base_master_id
         or r.status <> 'draft'
         or r.line_subtotal <> o.target_line_subtotal
         or r.expense_method <> o.target_expense_method
         or r.expense_rate is distinct from o.target_expense_rate
         or r.expense_amount <> o.target_expense_amount
         or r.total <> o.target_total
         or r.line_subtotal <> coalesce((
           select sum(nl.amount)::integer
             from public.base_master_revision_lines nl
            where nl.revision_id = r.id
         ), 0)
       )
  ) then
    raise exception 'VALIDATION: 作成したHQ所有の新本体Draftまたは金額が移行記録と一致しません'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_migration_draft_outputs o
     where o.migration_batch_id = p_batch_id
       and o.source_classified_base_line_total <> o.target_line_subtotal
  ) then
    raise exception 'VALIDATION: 旧base判定行合計と新Draft line_subtotalが1円単位で一致しません'
      using errcode = 'P0001';
  end if;

  select count(*) into v_link_count
    from public.legacy_base_migration_line_links l
   where l.migration_batch_id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'base_master_count', v_output_count,
    'line_link_count', v_link_count
  );
end;
$validate$;

create or replace function public.materialize_legacy_base_migration_drafts(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $materialize$
declare
  v_uid uuid := auth.uid();
  v_batch public.legacy_base_migration_batches;
  v_hq_id uuid;
  v_group record;
  v_rep_spec text;
  v_snapshot public.legacy_migration_financial_snapshots;
  v_model_name text;
  v_master_id uuid;
  v_revision_id uuid;
  v_output_id uuid;
  v_mapping public.legacy_base_breakdown_mappings;
  v_line_id uuid;
  v_line_key uuid;
  v_source_total_numeric numeric;
  v_source_total integer;
  v_expense_method text;
  v_expense_rate numeric(8, 6);
  v_expense_amount integer;
  v_target_total integer;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;

  if not public.can_manage_legacy_base_migration() then
    raise exception 'FORBIDDEN: 新本体Draftを作成する権限がありません'
      using errcode = '42501';
  end if;

  select *
    into v_batch
    from public.legacy_base_migration_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: 移行バッチが見つかりません'
      using errcode = 'P0002';
  end if;

  if v_batch.status not in ('ready', 'migrated') then
    raise exception 'LOCKED: readyの監査バッチだけ新本体Draftを作成できます'
      using errcode = 'P0001';
  end if;

  -- migrated後の再実行は、固定済み監査snapshotと作成済みDraftだけを再検証する。
  -- 後日旧正本が更新されても、新規作成はせず同じ出力を返す。
  if v_batch.status = 'migrated' then
    return public.validate_legacy_base_draft_materialization(p_batch_id)
      || jsonb_build_object('status', 'migrated', 'idempotent_replay', true);
  end if;

  -- 初回作成時だけPR #106と同じ順序で旧正本を固定し、
  -- ready後に元データが変わっていないことを再確認する。
  perform public.lock_legacy_estimate_source();
  perform public.assert_legacy_base_migration_source_current(p_batch_id);

  if exists (
    select 1 from public.legacy_base_migration_draft_outputs o
     where o.migration_batch_id = p_batch_id
  ) or exists (
    select 1 from public.legacy_base_migration_line_links l
     where l.migration_batch_id = p_batch_id
  ) then
    raise exception 'CONFLICT: readyバッチに既存のDraft移行記録があります'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_spec_mappings s
     where s.migration_batch_id = p_batch_id
       and (s.decision_status <> 'approved' or nullif(btrim(coalesce(s.proposed_group_key, '')), '') is null)
  ) then
    raise exception 'VALIDATION: readyバッチのspec groupingが不完全です'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_breakdown_mappings m
     where m.migration_batch_id = p_batch_id
       and (m.review_status <> 'approved' or m.target_classification = 'review')
  ) then
    raise exception 'VALIDATION: readyバッチに未確定の旧行があります'
      using errcode = 'P0001';
  end if;

  -- ready判定後も、同一groupのBOMと本体諸費用条件を移行直前に再検査する。
  if exists (
    select 1
      from public.legacy_base_spec_mappings a
      join public.legacy_base_spec_mappings b
        on b.migration_batch_id = a.migration_batch_id
       and b.base_model_id = a.base_model_id
       and b.proposed_group_key = a.proposed_group_key
       and b.id::text > a.id::text
     where a.migration_batch_id = p_batch_id
       and public.legacy_base_spec_body_signature(a.migration_batch_id, a.base_model_id, a.legacy_spec_code)
           <> public.legacy_base_spec_body_signature(b.migration_batch_id, b.base_model_id, b.legacy_spec_code)
  ) then
    raise exception 'VALIDATION: 同一group内の本体BOMが一致しません'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_spec_mappings a
      join public.legacy_base_spec_mappings b
        on b.migration_batch_id = a.migration_batch_id
       and b.base_model_id = a.base_model_id
       and b.proposed_group_key = a.proposed_group_key
       and b.id::text > a.id::text
      join public.legacy_migration_financial_snapshots fa
        on fa.migration_batch_id = a.migration_batch_id
       and fa.base_model_id = a.base_model_id
       and fa.legacy_spec_code = a.legacy_spec_code
      join public.legacy_migration_financial_snapshots fb
        on fb.migration_batch_id = b.migration_batch_id
       and fb.base_model_id = b.base_model_id
       and fb.legacy_spec_code = b.legacy_spec_code
     where a.migration_batch_id = p_batch_id
       and (
         fa.legacy_base_expense_rate is distinct from fb.legacy_base_expense_rate
         or fa.legacy_base_expense is distinct from fb.legacy_base_expense
         or fa.legacy_base_total is distinct from fb.legacy_base_total
       )
  ) then
    raise exception 'VALIDATION: 同一group内の本体諸費用条件が一致しません'
      using errcode = 'P0001';
  end if;

  select o.id
    into v_hq_id
    from public.organizations o
   where o.code = 'gijutsu-no-mori'
     and o.organization_type = 'headquarters'
     and o.status = 'active'
   for share;

  if not found then
    raise exception 'VALIDATION: 本部組織が見つかりません'
      using errcode = 'P0001';
  end if;

  for v_group in
    select s.base_model_id, s.proposed_group_key
      from public.legacy_base_spec_mappings s
     where s.migration_batch_id = p_batch_id
       and s.decision_status = 'approved'
     group by s.base_model_id, s.proposed_group_key
     order by s.base_model_id::text, s.proposed_group_key
  loop
    select min(s.legacy_spec_code)
      into v_rep_spec
      from public.legacy_base_spec_mappings s
     where s.migration_batch_id = p_batch_id
       and s.base_model_id = v_group.base_model_id
       and s.proposed_group_key = v_group.proposed_group_key
       and s.decision_status = 'approved';

    select *
      into v_snapshot
      from public.legacy_migration_financial_snapshots f
     where f.migration_batch_id = p_batch_id
       and f.base_model_id = v_group.base_model_id
       and f.legacy_spec_code = v_rep_spec;

    if not found then
      raise exception 'VALIDATION: group代表specの金額snapshotがありません'
        using errcode = 'P0001';
    end if;

    select sum(m.legacy_amount)::numeric
      into v_source_total_numeric
      from public.legacy_base_breakdown_mappings m
     where m.migration_batch_id = p_batch_id
       and m.base_model_id = v_group.base_model_id
       and m.legacy_spec_code = v_rep_spec
       and m.review_status = 'approved'
       and m.target_classification = 'base';

    if v_source_total_numeric is null or v_source_total_numeric < 0 or v_source_total_numeric > 2147483647 then
      raise exception 'VALIDATION: 本体Draftへ保存できないline_subtotalです'
        using errcode = 'P0001';
    end if;
    v_source_total := v_source_total_numeric::integer;

    if v_snapshot.legacy_base_expense is null
       or v_snapshot.legacy_base_expense <> round(v_snapshot.legacy_base_expense)
       or v_snapshot.legacy_base_total is null
       or v_snapshot.legacy_base_total <> round(v_snapshot.legacy_base_total)
    then
      raise exception 'VALIDATION: 旧本体諸費用を1円単位で保存できません'
        using errcode = 'P0001';
    end if;

    if v_snapshot.legacy_base_expense_rate is not null then
      if v_snapshot.legacy_base_expense_rate < 0 or v_snapshot.legacy_base_expense_rate > 1 then
        raise exception 'VALIDATION: 旧本体諸費用率が不正です'
          using errcode = 'P0001';
      end if;
      v_expense_method := 'rate';
      v_expense_rate := v_snapshot.legacy_base_expense_rate::numeric(8, 6);
      v_expense_amount := floor(v_source_total::numeric * v_expense_rate)::integer;
    else
      v_expense_method := 'fixed';
      v_expense_rate := null;
      v_expense_amount := v_snapshot.legacy_base_expense::integer;
    end if;
    v_target_total := v_source_total + v_expense_amount;

    select bm.name into v_model_name
      from public.base_models bm
     where bm.id = v_group.base_model_id;

    if not found then
      raise exception 'VALIDATION: 商品モデルが見つかりません'
        using errcode = 'P0001';
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
      v_group.base_model_id,
      v_hq_id,
      format('%s / %s', v_model_name, v_group.proposed_group_key),
      'non_fire',
      'active',
      null,
      v_uid,
      v_uid
    )
    returning id into v_master_id;

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
      v_expense_method,
      v_expense_rate,
      v_expense_amount,
      v_source_total,
      v_target_total,
      v_uid
    )
    returning id into v_revision_id;

    insert into public.legacy_base_migration_draft_outputs (
      migration_batch_id,
      base_model_id,
      proposed_group_key,
      representative_legacy_spec_code,
      base_master_id,
      revision_id,
      initial_fire_spec_code,
      fire_spec_review_required,
      source_classified_base_line_total,
      legacy_base_section_line_total,
      legacy_base_expense_rate,
      legacy_base_expense,
      legacy_base_total,
      target_expense_method,
      target_expense_rate,
      target_expense_amount,
      target_line_subtotal,
      target_total,
      created_by
    )
    values (
      p_batch_id,
      v_group.base_model_id,
      v_group.proposed_group_key,
      v_rep_spec,
      v_master_id,
      v_revision_id,
      'non_fire',
      true,
      v_source_total,
      v_snapshot.legacy_base_line_total,
      v_snapshot.legacy_base_expense_rate,
      v_snapshot.legacy_base_expense::integer,
      v_snapshot.legacy_base_total::integer,
      v_expense_method,
      v_expense_rate,
      v_expense_amount,
      v_source_total,
      v_target_total,
      v_uid
    )
    returning id into v_output_id;

    -- 代表specのbase行だけを1回だけ新Revisionへ作る。
    for v_mapping in
      select *
        from public.legacy_base_breakdown_mappings m
       where m.migration_batch_id = p_batch_id
         and m.base_model_id = v_group.base_model_id
         and m.legacy_spec_code = v_rep_spec
         and m.review_status = 'approved'
         and m.target_classification = 'base'
       order by m.legacy_sort_order, m.legacy_item_id
    loop
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
        v_revision_id,
        gen_random_uuid(),
        v_mapping.legacy_section,
        v_mapping.legacy_name,
        v_mapping.legacy_quantity,
        v_mapping.legacy_unit,
        v_mapping.legacy_unit_price,
        v_mapping.legacy_amount,
        v_mapping.legacy_remark,
        v_mapping.legacy_sort_order
      )
      returning id, line_key into v_line_id, v_line_key;

      insert into public.legacy_base_migration_line_links (
        migration_batch_id,
        draft_output_id,
        mapping_id,
        legacy_item_id,
        revision_line_id,
        revision_line_key
      )
      values (
        p_batch_id,
        v_output_id,
        v_mapping.id,
        v_mapping.legacy_item_id,
        v_line_id,
        v_line_key
      );
    end loop;

    -- 同じgroupにまとめた他specの旧行は、内容署名＋同一内容内のordinalで
    -- 代表specの同じ新lineへ追跡する。BOM一致はready時と上で再検証済み。
    with rep_base as (
      select
        m.id as mapping_id,
        public.legacy_base_migration_line_signature(
          m.legacy_section, m.legacy_name, m.legacy_quantity, m.legacy_unit,
          m.legacy_unit_price, m.legacy_amount, m.legacy_remark, m.target_group_label
        ) as line_signature,
        row_number() over (
          partition by public.legacy_base_migration_line_signature(
            m.legacy_section, m.legacy_name, m.legacy_quantity, m.legacy_unit,
            m.legacy_unit_price, m.legacy_amount, m.legacy_remark, m.target_group_label
          )
          order by m.legacy_sort_order, m.legacy_item_id
        ) as occurrence_no
      from public.legacy_base_breakdown_mappings m
      where m.migration_batch_id = p_batch_id
        and m.base_model_id = v_group.base_model_id
        and m.legacy_spec_code = v_rep_spec
        and m.review_status = 'approved'
        and m.target_classification = 'base'
    ),
    rep_linked as (
      select r.line_signature, r.occurrence_no, l.revision_line_id, l.revision_line_key
        from rep_base r
        join public.legacy_base_migration_line_links l
          on l.migration_batch_id = p_batch_id
         and l.mapping_id = r.mapping_id
    ),
    source_base as (
      select
        m.id as mapping_id,
        m.legacy_item_id,
        public.legacy_base_migration_line_signature(
          m.legacy_section, m.legacy_name, m.legacy_quantity, m.legacy_unit,
          m.legacy_unit_price, m.legacy_amount, m.legacy_remark, m.target_group_label
        ) as line_signature,
        row_number() over (
          partition by m.legacy_spec_code, public.legacy_base_migration_line_signature(
            m.legacy_section, m.legacy_name, m.legacy_quantity, m.legacy_unit,
            m.legacy_unit_price, m.legacy_amount, m.legacy_remark, m.target_group_label
          )
          order by m.legacy_sort_order, m.legacy_item_id
        ) as occurrence_no
      from public.legacy_base_breakdown_mappings m
      join public.legacy_base_spec_mappings s
        on s.migration_batch_id = m.migration_batch_id
       and s.base_model_id = m.base_model_id
       and s.legacy_spec_code = m.legacy_spec_code
      where m.migration_batch_id = p_batch_id
        and m.base_model_id = v_group.base_model_id
        and s.proposed_group_key = v_group.proposed_group_key
        and s.decision_status = 'approved'
        and m.legacy_spec_code <> v_rep_spec
        and m.review_status = 'approved'
        and m.target_classification = 'base'
    )
    insert into public.legacy_base_migration_line_links (
      migration_batch_id,
      draft_output_id,
      mapping_id,
      legacy_item_id,
      revision_line_id,
      revision_line_key
    )
    select
      p_batch_id,
      v_output_id,
      s.mapping_id,
      s.legacy_item_id,
      r.revision_line_id,
      r.revision_line_key
    from source_base s
    join rep_linked r
      on r.line_signature = s.line_signature
     and r.occurrence_no = s.occurrence_no;

    if exists (
      select 1
        from public.legacy_base_breakdown_mappings m
        join public.legacy_base_spec_mappings s
          on s.migration_batch_id = m.migration_batch_id
         and s.base_model_id = m.base_model_id
         and s.legacy_spec_code = m.legacy_spec_code
       where m.migration_batch_id = p_batch_id
         and m.base_model_id = v_group.base_model_id
         and s.proposed_group_key = v_group.proposed_group_key
         and m.review_status = 'approved'
         and m.target_classification = 'base'
         and not exists (
           select 1
             from public.legacy_base_migration_line_links l
            where l.migration_batch_id = p_batch_id
              and l.mapping_id = m.id
         )
    ) then
      raise exception 'VALIDATION: 同一groupの旧行を新lineへ完全追跡できません'
        using errcode = 'P0001';
    end if;

    update public.legacy_base_spec_mappings s
       set target_base_master_id = v_master_id
     where s.migration_batch_id = p_batch_id
       and s.base_model_id = v_group.base_model_id
       and s.proposed_group_key = v_group.proposed_group_key
       and s.decision_status = 'approved';

    update public.legacy_base_breakdown_mappings m
       set target_base_master_id = v_master_id
      from public.legacy_base_spec_mappings s
     where m.migration_batch_id = p_batch_id
       and m.review_status = 'approved'
       and m.target_classification = 'base'
       and s.migration_batch_id = m.migration_batch_id
       and s.base_model_id = m.base_model_id
       and s.legacy_spec_code = m.legacy_spec_code
       and s.base_model_id = v_group.base_model_id
       and s.proposed_group_key = v_group.proposed_group_key
       and s.decision_status = 'approved';
  end loop;

  v_result := public.validate_legacy_base_draft_materialization(p_batch_id);

  update public.legacy_base_migration_batches
     set status = 'migrated',
         migrated_by = v_uid,
         migrated_at = now()
   where id = p_batch_id;

  return v_result || jsonb_build_object('status', 'migrated', 'idempotent_replay', false);
end;
$materialize$;

alter table public.legacy_base_migration_draft_outputs enable row level security;
alter table public.legacy_base_migration_line_links enable row level security;

drop policy if exists legacy_base_migration_draft_outputs_read
  on public.legacy_base_migration_draft_outputs;
create policy legacy_base_migration_draft_outputs_read
on public.legacy_base_migration_draft_outputs
for select
to authenticated
using (public.can_view_legacy_base_migration());

drop policy if exists legacy_base_migration_line_links_read
  on public.legacy_base_migration_line_links;
create policy legacy_base_migration_line_links_read
on public.legacy_base_migration_line_links
for select
to authenticated
using (public.can_view_legacy_base_migration());

revoke all privileges on table public.legacy_base_migration_draft_outputs,
                                public.legacy_base_migration_line_links
from public, anon, authenticated;

grant select on public.legacy_base_migration_draft_outputs,
                public.legacy_base_migration_line_links
to authenticated;

grant all privileges on table public.legacy_base_migration_draft_outputs,
                               public.legacy_base_migration_line_links
to service_role;

revoke all on function public.legacy_base_migration_line_signature(text, text, numeric, text, integer, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.validate_legacy_base_draft_materialization(uuid)
  from public, anon, authenticated;
revoke all on function public.materialize_legacy_base_migration_drafts(uuid)
  from public, anon, authenticated;

grant execute on function public.materialize_legacy_base_migration_drafts(uuid)
  to authenticated, service_role;
grant execute on function public.legacy_base_migration_line_signature(text, text, numeric, text, integer, integer, text, text),
                          public.validate_legacy_base_draft_materialization(uuid)
  to service_role;

comment on table public.legacy_base_migration_draft_outputs is
  'ready監査バッチからproposed_group_key単位で作成した新本体Draftと1円検算値の追跡。Publishは行わない。';

comment on table public.legacy_base_migration_line_links is
  '旧base_breakdown 1行から、新本体Draft revision lineへの追跡。複数旧specが同一groupなら同じ新lineを参照できる。';
