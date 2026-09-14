-- =============================================================
-- 旧「本体内訳」→ 新本体マスター移行の監査基盤
--
-- このmigrationの目的は「移行前の固定・分類・レビュー・重複検査・金額スナップショット」まで。
-- 実データを base_masters / base_master_revisions へコピーしない。
-- estimate_templates / base_breakdown_items / シミュレーターの既存計算も変更しない。
-- =============================================================

-- ---------- HQ限定の移行監査権限 ----------
create or replace function public.can_view_legacy_base_migration()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1
             from public.organization_memberships m
             join public.organizations o on o.id = m.organization_id
            where m.profile_id = auth.uid()
              and m.status = 'active'
              and o.status = 'active'
              and o.organization_type = 'headquarters'
              and public.organization_member_role_rank(m.member_role) >= 0
         );
$$;

create or replace function public.can_manage_legacy_base_migration()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1
             from public.organization_memberships m
             join public.organizations o on o.id = m.organization_id
            where m.profile_id = auth.uid()
              and m.status = 'active'
              and o.status = 'active'
              and o.organization_type = 'headquarters'
              and public.organization_member_role_rank(m.member_role) >= 1
         );
$$;

-- ---------- 移行バッチ ----------
create table if not exists public.legacy_base_migration_batches (
  id uuid primary key default gen_random_uuid(),
  migration_type text not null default 'legacy_base_breakdown'
    check (migration_type = 'legacy_base_breakdown'),
  status text not null default 'draft'
    check (status in ('draft', 'reviewing', 'ready', 'migrated', 'validated', 'completed', 'cancelled')),
  source_snapshot_hash text not null,
  source_description text,
  source_item_count integer not null default 0 check (source_item_count >= 0),
  source_template_count integer not null default 0 check (source_template_count >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists legacy_base_migration_active_source_idx
  on public.legacy_base_migration_batches(source_snapshot_hash)
  where status not in ('completed', 'cancelled');

drop trigger if exists trg_legacy_base_migration_batches_updated
  on public.legacy_base_migration_batches;
create trigger trg_legacy_base_migration_batches_updated
before update on public.legacy_base_migration_batches
for each row execute function public.set_updated_at();

-- ---------- 旧本体明細の1行ごとのスナップショット＋判定 ----------
create table if not exists public.legacy_base_breakdown_mappings (
  id uuid primary key default gen_random_uuid(),
  migration_batch_id uuid not null references public.legacy_base_migration_batches(id) on delete cascade,
  legacy_item_id uuid not null,
  base_model_id uuid not null references public.base_models(id) on delete restrict,
  legacy_spec_code text not null,
  legacy_section text not null,
  legacy_name text not null,
  legacy_quantity numeric not null,
  legacy_unit text,
  legacy_unit_price integer not null,
  legacy_amount integer not null,
  legacy_remark text,
  legacy_sort_order integer not null,
  legacy_updated_at timestamptz,
  target_classification text not null default 'review'
    check (target_classification in ('base', 'interior_exterior', 'option', 'sitework', 'review')),
  decision_type text not null default 'human'
    check (decision_type in ('automatic', 'explicit', 'human')),
  decision_reason text,
  target_group_label text,
  target_base_master_id uuid references public.base_masters(id) on delete set null,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  decision_version integer not null default 0 check (decision_version >= 0),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (migration_batch_id, legacy_item_id)
);

create index if not exists legacy_base_breakdown_mappings_review_idx
  on public.legacy_base_breakdown_mappings(migration_batch_id, review_status, target_classification);
create index if not exists legacy_base_breakdown_mappings_source_idx
  on public.legacy_base_breakdown_mappings(base_model_id, legacy_spec_code, legacy_sort_order);

-- ---------- 旧 spec_code を新しい「本体の実仕様」へまとめる判断 ----------
create table if not exists public.legacy_base_spec_mappings (
  id uuid primary key default gen_random_uuid(),
  migration_batch_id uuid not null references public.legacy_base_migration_batches(id) on delete cascade,
  base_model_id uuid not null references public.base_models(id) on delete restrict,
  legacy_spec_code text not null,
  proposed_group_key text,
  target_base_master_id uuid references public.base_masters(id) on delete set null,
  decision_status text not null default 'pending'
    check (decision_status in ('pending', 'approved', 'rejected')),
  decision_version integer not null default 0 check (decision_version >= 0),
  reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (migration_batch_id, base_model_id, legacy_spec_code)
);

-- ---------- 既存 estimate_template_lines との二重計上候補 ----------
create table if not exists public.legacy_estimate_duplicate_checks (
  id uuid primary key default gen_random_uuid(),
  migration_batch_id uuid not null references public.legacy_base_migration_batches(id) on delete cascade,
  mapping_id uuid not null references public.legacy_base_breakdown_mappings(id) on delete cascade,
  candidate_template_line_id uuid not null,
  match_type text not null check (match_type in ('exact', 'candidate')),
  candidate_section_code text not null,
  candidate_group_label text,
  candidate_name text not null,
  candidate_quantity numeric,
  candidate_unit text,
  candidate_unit_price numeric,
  candidate_amount numeric not null,
  candidate_remark text,
  resolution text not null default 'pending'
    check (resolution in ('pending', 'use_legacy', 'use_existing', 'keep_both', 'not_duplicate')),
  decision_version integer not null default 0 check (decision_version >= 0),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (migration_batch_id, mapping_id, candidate_template_line_id)
);

create index if not exists legacy_estimate_duplicate_checks_pending_idx
  on public.legacy_estimate_duplicate_checks(migration_batch_id, resolution);

-- ---------- 移行前金額の固定スナップショット ----------
create table if not exists public.legacy_migration_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  migration_batch_id uuid not null references public.legacy_base_migration_batches(id) on delete cascade,
  base_model_id uuid not null references public.base_models(id) on delete restrict,
  legacy_spec_code text not null,
  legacy_template_id uuid,
  legacy_baseline_option_ids uuid[] not null default '{}',
  legacy_base_line_total numeric not null default 0,
  legacy_base_expense_rate numeric,
  legacy_base_expense numeric,
  legacy_base_total numeric,
  legacy_interior_line_total numeric,
  legacy_interior_expense_rate numeric,
  legacy_interior_expense numeric,
  legacy_interior_total numeric,
  legacy_option_line_total numeric,
  legacy_option_expense_rate numeric,
  legacy_option_expense numeric,
  legacy_option_total numeric,
  legacy_sitework_line_total numeric,
  legacy_sitework_expense_rate numeric,
  legacy_sitework_expense numeric,
  legacy_sitework_total numeric,
  subtotal_raw numeric,
  adjustment numeric,
  subtotal numeric,
  tax_rate numeric,
  tax numeric,
  total numeric,
  source_file_name text,
  source_sheet_name text,
  source_sha256 text,
  source_imported_at timestamptz,
  created_at timestamptz not null default now(),
  unique (migration_batch_id, base_model_id, legacy_spec_code)
);

-- ---------- 旧見積正本の読取ロック ----------
-- 既存Excel取込は estimate_templates から更新を始めるため、
-- 監査側も同じ先頭順序でロックし、deadlockを避ける。
create or replace function public.lock_legacy_estimate_source()
returns void
language plpgsql
security definer
set search_path = public
as $locksrc$
begin
  lock table public.estimate_templates,
             public.estimate_template_sections,
             public.estimate_template_lines,
             public.base_breakdown_items
    in share mode;
end;
$locksrc$;

-- ---------- 移行元全体の決定論的SHA-256 ----------
create or replace function public.legacy_base_migration_source_hash()
returns text
language sql
stable
security definer
set search_path = public
as $hashfn$
  select encode(
    digest(
      jsonb_build_object(
        'base_breakdown_items',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', b.id,
              'base_model_id', b.base_model_id,
              'spec_code', b.spec_code,
              'section', b.section,
              'name', b.name,
              'quantity', b.quantity,
              'unit', b.unit,
              'unit_price', b.unit_price,
              'amount', b.amount,
              'remark', b.remark,
              'sort_order', b.sort_order,
              'created_at', b.created_at,
              'updated_at', b.updated_at
            )
            order by b.base_model_id::text, b.spec_code, b.sort_order, b.id::text
          )
          from public.base_breakdown_items b
        ), '[]'::jsonb),
        'estimate_templates',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', t.id,
              'base_model_id', t.base_model_id,
              'spec_code', t.spec_code,
              'name', t.name,
              'source_file_name', t.source_file_name,
              'source_sheet_name', t.source_sheet_name,
              'source_sha256', t.source_sha256,
              'baseline_option_ids', t.baseline_option_ids,
              'tax_rate', t.tax_rate,
              'subtotal_raw', t.subtotal_raw,
              'adjustment', t.adjustment,
              'subtotal', t.subtotal,
              'tax', t.tax,
              'total', t.total,
              'imported_at', t.imported_at,
              'updated_at', t.updated_at
            )
            order by t.base_model_id::text, t.spec_code, t.id::text
          )
          from public.estimate_templates t
        ), '[]'::jsonb),
        'estimate_template_sections',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'template_id', s.template_id,
              'code', s.code,
              'label', s.label,
              'line_subtotal', s.line_subtotal,
              'expense_label', s.expense_label,
              'expense_rate', s.expense_rate,
              'expense_amount', s.expense_amount,
              'total', s.total,
              'sort_order', s.sort_order
            )
            order by s.template_id::text, s.sort_order, s.id::text
          )
          from public.estimate_template_sections s
        ), '[]'::jsonb),
        'estimate_template_lines',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', l.id,
              'template_id', l.template_id,
              'section_code', l.section_code,
              'group_label', l.group_label,
              'name', l.name,
              'quantity', l.quantity,
              'unit', l.unit,
              'unit_price', l.unit_price,
              'amount', l.amount,
              'remark', l.remark,
              'sort_order', l.sort_order
            )
            order by l.template_id::text, l.section_code, l.sort_order, l.id::text
          )
          from public.estimate_template_lines l
        ), '[]'::jsonb)
      )::text,
      'sha256'
    ),
    'hex'
  );
$hashfn$;

create or replace function public.assert_legacy_base_migration_source_current(p_batch_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $assertfn$
declare
  v_expected_hash text;
  v_current_hash text;
begin
  select source_snapshot_hash into v_expected_hash
    from public.legacy_base_migration_batches
   where id = p_batch_id;

  if not found then
    raise exception 'NOT_FOUND: 移行バッチが見つかりません'
      using errcode = 'P0002';
  end if;

  v_current_hash := public.legacy_base_migration_source_hash();
  if v_current_hash <> v_expected_hash then
    raise exception 'STALE: 移行元データがレビュー開始後に変更されています。新しいバッチを作成してください'
      using errcode = 'P0001';
  end if;
end;
$assertfn$;

-- ---------- 安全側のホワイトリスト分類 ----------
-- 名称に「屋根」が含まれるだけで内外装へ移す等の広いキーワード判定は禁止する。
create or replace function public.classify_legacy_base_breakdown_item(
  p_section text,
  p_name text,
  p_remark text
)
returns table (
  target_classification text,
  decision_type text,
  review_status text,
  decision_reason text
)
language plpgsql
immutable
set search_path = public
as $classifier$
declare
  v_section text := regexp_replace(lower(btrim(coalesce(p_section, ''))), '\s+', '', 'g');
  v_name text := regexp_replace(lower(btrim(coalesce(p_name, ''))), '\s+', '', 'g');
  v_remark text := regexp_replace(lower(btrim(coalesce(p_remark, ''))), '\s+', '', 'g');
begin
  -- 自動確定は、既知seedで検証済みの section + name + remark 完全一致だけに限定する。
  -- 同じ品名でも備考が未知ならreviewへ落とす。
  if (
       v_section = '１．金物関係費用'
       and (
         (v_name in ('・単管パイプ2.5m', '・単管パイプ3m', '・単管パイプ1m', '・タルキ止めクランプ', '・床用補強金物') and v_remark = '')
         or (v_name = '・ステンレス長ビス' and v_remark = 'alc用皿頭6×65')
       )
     )
     or (
       v_section = '２．プレカット'
       and (
         (v_name = '・204材l=6f' and v_remark = '床天井根太')
         or (v_name = '・204材l=8f' and v_remark = '壁用')
         or (v_name = '・204材l=12f' and v_remark in ('上下枠根太破風', '屋根タルキ'))
         or (v_name = '・204材l=16f' and v_remark = '同上')
         or (v_name = '・本体組立費' and v_remark = '')
       )
     )
     or (
       v_section in ('３．構造用面材等', '３．外部面材等')
       and (
         (v_name in ('・osb合板9×910×2,420', '・osb合板9×910×1,820') and v_remark = '')
         or (v_name in ('・天井ラワンべニア4㎜', '・天井ラワンベニア4㎜', '・天井ラワンべニア', '・天井ラワンベニア') and v_remark = '910×1,820')
       )
     )
     or (
       v_section in ('４．断熱材', '５．断熱材')
       and (
         (v_name = '・床用ミラフォーム90㎜' and v_remark in ('', '発砲5,273円'))
         or (v_name in (
           '・壁用スタイロフォーム90㎜',
           '・天井用スタイロフォーム90㎜',
           '・壁グラスウール90㎜',
           '・天井グラスウール90㎜',
           '・壁グラスウール91㎜',
           '・天井グラスウール92㎜'
         ) and v_remark = '')
       )
     )
  then
    return query select
      'base'::text,
      'automatic'::text,
      'approved'::text,
      '検証済みの旧section＋品名＋備考と完全一致した本体ホワイトリスト'::text;
    return;
  end if;

  if (
       v_section = '５．屋根外壁工事'
       and v_name = '・外壁角スパンガルバ鋼板'
       and v_remark = 'l=2,300㎜'
     )
     or (
       v_section in ('５．サッシ木製建具工事', '６．サッシ木製建具工事')
       and v_name in ('引違、押出、縦辷り窓', '引違')
       and v_remark = ''
     )
  then
    return query select
      'interior_exterior'::text,
      'automatic'::text,
      'approved'::text,
      '検証済みの旧section＋品名＋備考と完全一致した内外装ホワイトリスト'::text;
    return;
  end if;

  return query select
    'review'::text,
    'human'::text,
    'pending'::text,
    '自動判定対象外。section・品名・備考を人間が確認する'::text;
end;
$classifier$;

create or replace function public.legacy_base_spec_body_signature(
  p_batch_id uuid,
  p_base_model_id uuid,
  p_spec_code text
)
returns text
language sql
stable
security definer
set search_path = public
as $sig$
  select encode(
    digest(
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'section', lower(btrim(m.legacy_section)),
            'name', lower(btrim(m.legacy_name)),
            'quantity', m.legacy_quantity,
            'unit', lower(btrim(coalesce(m.legacy_unit, ''))),
            'unit_price', m.legacy_unit_price,
            'amount', m.legacy_amount,
            'remark', lower(btrim(coalesce(m.legacy_remark, ''))),
            'target_group_label', lower(btrim(coalesce(m.target_group_label, '')))
          )
          order by
            lower(btrim(m.legacy_section)),
            lower(btrim(m.legacy_name)),
            m.legacy_quantity,
            lower(btrim(coalesce(m.legacy_unit, ''))),
            m.legacy_unit_price,
            m.legacy_amount,
            lower(btrim(coalesce(m.legacy_remark, ''))),
            lower(btrim(coalesce(m.target_group_label, '')))
        ),
        '[]'::jsonb
      )::text,
      'sha256'
    ),
    'hex'
  )
  from public.legacy_base_breakdown_mappings m
 where m.migration_batch_id = p_batch_id
   and m.base_model_id = p_base_model_id
   and m.legacy_spec_code = p_spec_code
   and m.review_status = 'approved'
   and m.target_classification = 'base';
$sig$;

-- ---------- 二重計上候補を再構築 ----------
create or replace function public.refresh_legacy_estimate_duplicate_checks(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_legacy_base_migration() then
    raise exception 'FORBIDDEN: 移行監査を更新する権限がありません'
      using errcode = '42501';
  end if;

  perform 1
    from public.legacy_base_migration_batches b
   where b.id = p_batch_id
     and b.status in ('draft', 'reviewing', 'ready')
   for update;
  if not found then
    raise exception 'LOCKED: 更新可能な移行バッチではありません'
      using errcode = 'P0001';
  end if;

  perform public.lock_legacy_estimate_source();
  perform public.assert_legacy_base_migration_source_current(p_batch_id);

  -- 現在も候補である組合せはupsertで既存resolutionを保持する。
  insert into public.legacy_estimate_duplicate_checks (
    migration_batch_id,
    mapping_id,
    candidate_template_line_id,
    match_type,
    candidate_section_code,
    candidate_group_label,
    candidate_name,
    candidate_quantity,
    candidate_unit,
    candidate_unit_price,
    candidate_amount,
    candidate_remark
  )
  select
    p_batch_id,
    m.id,
    l.id,
    case
      when regexp_replace(lower(btrim(m.legacy_name)), '\s+', '', 'g')
           = regexp_replace(lower(btrim(l.name)), '\s+', '', 'g')
       and m.legacy_quantity::numeric = l.quantity
       and coalesce(lower(btrim(m.legacy_unit)), '') = coalesce(lower(btrim(l.unit)), '')
       and m.legacy_unit_price::numeric = l.unit_price
       and m.legacy_amount::numeric = l.amount
       and coalesce(regexp_replace(lower(btrim(m.legacy_remark)), '\s+', '', 'g'), '')
           = coalesce(regexp_replace(lower(btrim(l.remark)), '\s+', '', 'g'), '')
        then 'exact'
      else 'candidate'
    end,
    l.section_code,
    l.group_label,
    l.name,
    l.quantity,
    l.unit,
    l.unit_price,
    l.amount,
    l.remark
  from public.legacy_base_breakdown_mappings m
  join public.estimate_templates t
    on t.base_model_id = m.base_model_id
   and t.spec_code = m.legacy_spec_code
  join public.estimate_template_lines l
    on l.template_id = t.id
   and l.section_code = m.target_classification
  where m.migration_batch_id = p_batch_id
    and m.review_status = 'approved'
    and m.target_classification in ('interior_exterior', 'option', 'sitework')
    and (
      regexp_replace(lower(btrim(m.legacy_name)), '\s+', '', 'g')
        = regexp_replace(lower(btrim(l.name)), '\s+', '', 'g')
      or (
        length(regexp_replace(lower(btrim(m.legacy_name)), '\s+', '', 'g')) >= 4
        and length(regexp_replace(lower(btrim(l.name)), '\s+', '', 'g')) >= 4
        and (
          regexp_replace(lower(btrim(m.legacy_name)), '\s+', '', 'g')
            like '%' || regexp_replace(lower(btrim(l.name)), '\s+', '', 'g') || '%'
          or regexp_replace(lower(btrim(l.name)), '\s+', '', 'g')
            like '%' || regexp_replace(lower(btrim(m.legacy_name)), '\s+', '', 'g') || '%'
        )
      )
    )
  on conflict (migration_batch_id, mapping_id, candidate_template_line_id)
  do update set
    match_type = excluded.match_type,
    candidate_section_code = excluded.candidate_section_code,
    candidate_group_label = excluded.candidate_group_label,
    candidate_name = excluded.candidate_name,
    candidate_quantity = excluded.candidate_quantity,
    candidate_unit = excluded.candidate_unit,
    candidate_unit_price = excluded.candidate_unit_price,
    candidate_amount = excluded.candidate_amount,
    candidate_remark = excluded.candidate_remark;

  -- 判定変更等で候補ではなくなった古いチェックだけ除去する。
  delete from public.legacy_estimate_duplicate_checks d
   where d.migration_batch_id = p_batch_id
     and not exists (
       select 1
         from public.legacy_base_breakdown_mappings m
         join public.estimate_templates t
           on t.base_model_id = m.base_model_id
          and t.spec_code = m.legacy_spec_code
         join public.estimate_template_lines l
           on l.template_id = t.id
          and l.id = d.candidate_template_line_id
          and l.section_code = m.target_classification
        where m.id = d.mapping_id
          and m.migration_batch_id = p_batch_id
          and m.review_status = 'approved'
          and m.target_classification in ('interior_exterior', 'option', 'sitework')
          and (
            regexp_replace(lower(btrim(m.legacy_name)), '\s+', '', 'g')
              = regexp_replace(lower(btrim(l.name)), '\s+', '', 'g')
            or (
              length(regexp_replace(lower(btrim(m.legacy_name)), '\s+', '', 'g')) >= 4
              and length(regexp_replace(lower(btrim(l.name)), '\s+', '', 'g')) >= 4
              and (
                regexp_replace(lower(btrim(m.legacy_name)), '\s+', '', 'g')
                  like '%' || regexp_replace(lower(btrim(l.name)), '\s+', '', 'g') || '%'
                or regexp_replace(lower(btrim(l.name)), '\s+', '', 'g')
                  like '%' || regexp_replace(lower(btrim(m.legacy_name)), '\s+', '', 'g') || '%'
              )
            )
          )
     );
end;
$$;

-- ---------- バッチ作成 ----------
create or replace function public.create_legacy_base_migration_batch(p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_batch_id uuid;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if not public.can_manage_legacy_base_migration() then
    raise exception 'FORBIDDEN: 移行監査を作成する権限がありません'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(2147483001);
  perform public.lock_legacy_estimate_source();

  v_hash := public.legacy_base_migration_source_hash();

  select id into v_existing
    from public.legacy_base_migration_batches
   where source_snapshot_hash = v_hash
     and status not in ('completed', 'cancelled')
   order by created_at desc
   limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.legacy_base_migration_batches (
    status,
    source_snapshot_hash,
    source_description,
    source_item_count,
    source_template_count,
    created_by
  )
  values (
    'draft',
    v_hash,
    nullif(btrim(coalesce(p_description, '')), ''),
    (select count(*) from public.base_breakdown_items),
    (select count(*) from public.estimate_templates),
    v_uid
  )
  returning id into v_batch_id;

  insert into public.legacy_base_breakdown_mappings (
    migration_batch_id,
    legacy_item_id,
    base_model_id,
    legacy_spec_code,
    legacy_section,
    legacy_name,
    legacy_quantity,
    legacy_unit,
    legacy_unit_price,
    legacy_amount,
    legacy_remark,
    legacy_sort_order,
    legacy_updated_at,
    target_classification,
    decision_type,
    decision_reason,
    review_status
  )
  select
    v_batch_id,
    b.id,
    b.base_model_id,
    b.spec_code,
    b.section,
    b.name,
    b.quantity,
    b.unit,
    b.unit_price,
    b.amount,
    b.remark,
    b.sort_order,
    b.updated_at,
    c.target_classification,
    c.decision_type,
    c.decision_reason,
    c.review_status
  from public.base_breakdown_items b
  cross join lateral public.classify_legacy_base_breakdown_item(b.section, b.name, b.remark) c;

  insert into public.legacy_base_spec_mappings (
    migration_batch_id,
    base_model_id,
    legacy_spec_code
  )
  select distinct
    v_batch_id,
    s.base_model_id,
    s.spec_code
  from (
    select base_model_id, spec_code from public.base_breakdown_items
    union
    select base_model_id, spec_code from public.estimate_templates
  ) s;

  insert into public.legacy_migration_financial_snapshots (
    migration_batch_id,
    base_model_id,
    legacy_spec_code,
    legacy_template_id,
    legacy_baseline_option_ids,
    legacy_base_line_total,
    legacy_base_expense_rate,
    legacy_base_expense,
    legacy_base_total,
    legacy_interior_line_total,
    legacy_interior_expense_rate,
    legacy_interior_expense,
    legacy_interior_total,
    legacy_option_line_total,
    legacy_option_expense_rate,
    legacy_option_expense,
    legacy_option_total,
    legacy_sitework_line_total,
    legacy_sitework_expense_rate,
    legacy_sitework_expense,
    legacy_sitework_total,
    subtotal_raw,
    adjustment,
    subtotal,
    tax_rate,
    tax,
    total,
    source_file_name,
    source_sheet_name,
    source_sha256,
    source_imported_at
  )
  select
    v_batch_id,
    src.base_model_id,
    src.spec_code,
    t.id,
    coalesce(t.baseline_option_ids, '{}'),
    coalesce((
      select sum(b.amount)::numeric
        from public.base_breakdown_items b
       where b.base_model_id = src.base_model_id
         and b.spec_code = src.spec_code
    ), 0),
    (select s.expense_rate from public.estimate_template_sections s where s.template_id = t.id and s.code = 'base'),
    (select s.expense_amount from public.estimate_template_sections s where s.template_id = t.id and s.code = 'base'),
    (select s.total from public.estimate_template_sections s where s.template_id = t.id and s.code = 'base'),
    (select s.line_subtotal from public.estimate_template_sections s where s.template_id = t.id and s.code = 'interior_exterior'),
    (select s.expense_rate from public.estimate_template_sections s where s.template_id = t.id and s.code = 'interior_exterior'),
    (select s.expense_amount from public.estimate_template_sections s where s.template_id = t.id and s.code = 'interior_exterior'),
    (select s.total from public.estimate_template_sections s where s.template_id = t.id and s.code = 'interior_exterior'),
    (select s.line_subtotal from public.estimate_template_sections s where s.template_id = t.id and s.code = 'option'),
    (select s.expense_rate from public.estimate_template_sections s where s.template_id = t.id and s.code = 'option'),
    (select s.expense_amount from public.estimate_template_sections s where s.template_id = t.id and s.code = 'option'),
    (select s.total from public.estimate_template_sections s where s.template_id = t.id and s.code = 'option'),
    (select s.line_subtotal from public.estimate_template_sections s where s.template_id = t.id and s.code = 'sitework'),
    (select s.expense_rate from public.estimate_template_sections s where s.template_id = t.id and s.code = 'sitework'),
    (select s.expense_amount from public.estimate_template_sections s where s.template_id = t.id and s.code = 'sitework'),
    (select s.total from public.estimate_template_sections s where s.template_id = t.id and s.code = 'sitework'),
    t.subtotal_raw,
    t.adjustment,
    t.subtotal,
    t.tax_rate,
    t.tax,
    t.total,
    t.source_file_name,
    t.source_sheet_name,
    t.source_sha256,
    t.imported_at
  from (
    select base_model_id, spec_code from public.base_breakdown_items
    union
    select base_model_id, spec_code from public.estimate_templates
  ) src
  left join public.estimate_templates t
    on t.base_model_id = src.base_model_id
   and t.spec_code = src.spec_code;

  update public.legacy_base_migration_batches
     set status = 'reviewing'
   where id = v_batch_id;

  perform public.refresh_legacy_estimate_duplicate_checks(v_batch_id);

  return v_batch_id;
end;
$$;

-- ---------- 1行の分類判断 ----------
create or replace function public.set_legacy_base_mapping_decision(
  p_batch_id uuid,
  p_mapping_id uuid,
  p_expected_version integer,
  p_target_classification text,
  p_target_group_label text default null,
  p_note text default null
)
returns public.legacy_base_breakdown_mappings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.legacy_base_breakdown_mappings;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if not public.can_manage_legacy_base_migration() then
    raise exception 'FORBIDDEN: 移行監査を更新する権限がありません'
      using errcode = '42501';
  end if;
  if p_target_classification not in ('base', 'interior_exterior', 'option', 'sitework', 'review') then
    raise exception 'VALIDATION: 移行先分類が不正です' using errcode = 'P0001';
  end if;
  perform 1
    from public.legacy_base_migration_batches
   where id = p_batch_id
     and status in ('draft', 'reviewing')
   for update;
  if not found then
    raise exception 'LOCKED: レビュー中のバッチだけ変更できます' using errcode = 'P0001';
  end if;

  perform public.lock_legacy_estimate_source();
  perform public.assert_legacy_base_migration_source_current(p_batch_id);

  update public.legacy_base_breakdown_mappings
     set target_classification = p_target_classification,
         decision_type = 'human',
         decision_reason = nullif(btrim(coalesce(p_note, '')), ''),
         target_group_label = nullif(btrim(coalesce(p_target_group_label, '')), ''),
         review_status = case when p_target_classification = 'review' then 'pending' else 'approved' end,
         reviewed_by = case when p_target_classification = 'review' then null else v_uid end,
         reviewed_at = case when p_target_classification = 'review' then null else now() end,
         decision_version = decision_version + 1
   where id = p_mapping_id
     and migration_batch_id = p_batch_id
     and decision_version = p_expected_version
  returning * into v_row;

  if not found then
    if exists (
      select 1 from public.legacy_base_breakdown_mappings
       where id = p_mapping_id and migration_batch_id = p_batch_id
    ) then
      raise exception 'CONFLICT: この分類判断は他のユーザーに更新されました。画面を再読込してください'
        using errcode = '40001';
    end if;
    raise exception 'NOT_FOUND: 移行判定行が見つかりません' using errcode = 'P0002';
  end if;

  perform public.refresh_legacy_estimate_duplicate_checks(p_batch_id);
  return v_row;
end;
$$;

-- ---------- spec_code → 本体実仕様グループの判断 ----------
create or replace function public.set_legacy_base_spec_mapping(
  p_batch_id uuid,
  p_base_model_id uuid,
  p_legacy_spec_code text,
  p_expected_version integer,
  p_proposed_group_key text,
  p_reason text default null
)
returns public.legacy_base_spec_mappings
language plpgsql
security definer
set search_path = public
as $specmap$
declare
  v_uid uuid := auth.uid();
  v_row public.legacy_base_spec_mappings;
  v_group text := lower(nullif(btrim(coalesce(p_proposed_group_key, '')), ''));
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if not public.can_manage_legacy_base_migration() then
    raise exception 'FORBIDDEN: 移行監査を更新する権限がありません'
      using errcode = '42501';
  end if;
  if v_group is null then
    raise exception 'VALIDATION: 新本体のグループキーを入力してください'
      using errcode = 'P0001';
  end if;
  perform 1
    from public.legacy_base_migration_batches
   where id = p_batch_id
     and status in ('draft', 'reviewing')
   for update;
  if not found then
    raise exception 'LOCKED: レビュー中のバッチだけ変更できます' using errcode = 'P0001';
  end if;

  perform public.lock_legacy_estimate_source();
  perform public.assert_legacy_base_migration_source_current(p_batch_id);

  update public.legacy_base_spec_mappings
     set proposed_group_key = v_group,
         decision_status = 'approved',
         reason = nullif(btrim(coalesce(p_reason, '')), ''),
         reviewed_by = v_uid,
         reviewed_at = now(),
         decision_version = decision_version + 1
   where migration_batch_id = p_batch_id
     and base_model_id = p_base_model_id
     and legacy_spec_code = p_legacy_spec_code
     and decision_version = p_expected_version
  returning * into v_row;

  if not found then
    if exists (
      select 1 from public.legacy_base_spec_mappings
       where migration_batch_id = p_batch_id
         and base_model_id = p_base_model_id
         and legacy_spec_code = p_legacy_spec_code
    ) then
      raise exception 'CONFLICT: この仕様対応は他のユーザーに更新されました。画面を再読込してください'
        using errcode = '40001';
    end if;
    raise exception 'NOT_FOUND: 旧仕様の移行判断が見つかりません'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$specmap$;
-- ---------- 重複候補の解決 ----------
create or replace function public.resolve_legacy_estimate_duplicate(
  p_batch_id uuid,
  p_check_id uuid,
  p_expected_version integer,
  p_resolution text
)
returns public.legacy_estimate_duplicate_checks
language plpgsql
security definer
set search_path = public
as $dupresolve$
declare
  v_uid uuid := auth.uid();
  v_row public.legacy_estimate_duplicate_checks;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if not public.can_manage_legacy_base_migration() then
    raise exception 'FORBIDDEN: 移行監査を更新する権限がありません'
      using errcode = '42501';
  end if;
  if p_resolution not in ('use_legacy', 'use_existing', 'keep_both', 'not_duplicate') then
    raise exception 'VALIDATION: 重複候補の解決方法が不正です' using errcode = 'P0001';
  end if;
  perform 1
    from public.legacy_base_migration_batches
   where id = p_batch_id
     and status in ('draft', 'reviewing')
   for update;
  if not found then
    raise exception 'LOCKED: レビュー中のバッチだけ変更できます' using errcode = 'P0001';
  end if;

  perform public.lock_legacy_estimate_source();
  perform public.assert_legacy_base_migration_source_current(p_batch_id);

  update public.legacy_estimate_duplicate_checks
     set resolution = p_resolution,
         resolved_by = v_uid,
         resolved_at = now(),
         decision_version = decision_version + 1
   where id = p_check_id
     and migration_batch_id = p_batch_id
     and decision_version = p_expected_version
  returning * into v_row;

  if not found then
    if exists (
      select 1 from public.legacy_estimate_duplicate_checks
       where id = p_check_id and migration_batch_id = p_batch_id
    ) then
      raise exception 'CONFLICT: この重複判断は他のユーザーに更新されました。画面を再読込してください'
        using errcode = '40001';
    end if;
    raise exception 'NOT_FOUND: 重複候補が見つかりません' using errcode = 'P0002';
  end if;

  return v_row;
end;
$dupresolve$;
-- ---------- レビュー完了（まだ移行はしない） ----------
create or replace function public.finalize_legacy_base_migration_review(p_batch_id uuid)
returns public.legacy_base_migration_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.legacy_base_migration_batches;
  v_source_specs integer;
  v_snapshot_specs integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if not public.can_manage_legacy_base_migration() then
    raise exception 'FORBIDDEN: 移行監査を確定する権限がありません'
      using errcode = '42501';
  end if;

  select * into v_batch
    from public.legacy_base_migration_batches
   where id = p_batch_id
   for update;

  if not found then
    raise exception 'NOT_FOUND: 移行バッチが見つかりません' using errcode = 'P0002';
  end if;
  if v_batch.status not in ('draft', 'reviewing') then
    raise exception 'LOCKED: レビュー中のバッチだけ確定できます' using errcode = 'P0001';
  end if;

  perform public.lock_legacy_estimate_source();

  perform public.assert_legacy_base_migration_source_current(p_batch_id);
  perform public.refresh_legacy_estimate_duplicate_checks(p_batch_id);

  if exists (
    select 1
      from public.legacy_base_breakdown_mappings m
     where m.migration_batch_id = p_batch_id
       and (m.review_status <> 'approved' or m.target_classification = 'review')
  ) then
    raise exception 'VALIDATION: 未確認の旧本体明細があります'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_spec_mappings s
     where s.migration_batch_id = p_batch_id
       and (s.decision_status <> 'approved' or nullif(btrim(coalesce(s.proposed_group_key, '')), '') is null)
  ) then
    raise exception 'VALIDATION: 旧仕様から新本体への対応が未確認です'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_spec_mappings s
     where s.migration_batch_id = p_batch_id
       and not exists (
         select 1
           from public.legacy_base_breakdown_mappings m
          where m.migration_batch_id = s.migration_batch_id
            and m.base_model_id = s.base_model_id
            and m.legacy_spec_code = s.legacy_spec_code
            and m.review_status = 'approved'
            and m.target_classification = 'base'
       )
  ) then
    raise exception 'VALIDATION: 本体に残る明細が0件の旧仕様があります'
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
     where a.migration_batch_id = p_batch_id
       and a.decision_status = 'approved'
       and b.decision_status = 'approved'
       and public.legacy_base_spec_body_signature(a.migration_batch_id, a.base_model_id, a.legacy_spec_code)
           <> public.legacy_base_spec_body_signature(b.migration_batch_id, b.base_model_id, b.legacy_spec_code)
  ) then
    raise exception 'VALIDATION: 同じ新本体グループに、内容の異なる本体明細をまとめることはできません'
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
       and a.decision_status = 'approved'
       and b.decision_status = 'approved'
       and (
         fa.legacy_base_expense_rate is distinct from fb.legacy_base_expense_rate
         or fa.legacy_base_expense is distinct from fb.legacy_base_expense
         or fa.legacy_base_total is distinct from fb.legacy_base_total
       )
  ) then
    raise exception 'VALIDATION: 同じ新本体グループに、本体諸費用条件の異なる旧仕様をまとめることはできません'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_estimate_duplicate_checks d
     where d.migration_batch_id = p_batch_id
       and d.resolution = 'pending'
  ) then
    raise exception 'VALIDATION: 未解決の二重計上候補があります'
      using errcode = 'P0001';
  end if;

  select count(*) into v_source_specs
    from (
      select base_model_id, spec_code from public.base_breakdown_items
      union
      select base_model_id, spec_code from public.estimate_templates
    ) s;

  select count(*) into v_snapshot_specs
    from public.legacy_migration_financial_snapshots
   where migration_batch_id = p_batch_id;

  if v_snapshot_specs <> v_source_specs then
    raise exception 'VALIDATION: 金額スナップショットが移行元仕様数と一致しません'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_migration_financial_snapshots s
     where s.migration_batch_id = p_batch_id
       and (
         s.legacy_template_id is null
         or s.legacy_base_expense is null
         or s.legacy_base_total is null
         or s.legacy_interior_line_total is null
         or s.legacy_interior_expense is null
         or s.legacy_interior_total is null
         or s.legacy_option_line_total is null
         or s.legacy_option_expense is null
         or s.legacy_option_total is null
         or s.legacy_sitework_line_total is null
         or s.legacy_sitework_expense is null
         or s.legacy_sitework_total is null
         or s.subtotal_raw is null
         or s.adjustment is null
         or s.subtotal is null
         or s.tax_rate is null
         or s.tax is null
         or s.total is null
         or s.source_file_name is null
         or s.source_sheet_name is null
         or s.source_sha256 is null
         or s.source_imported_at is null
       )
  ) then
    raise exception 'VALIDATION: 標準見積または移行前金額が不足している旧仕様があります'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_migration_financial_snapshots s
     where s.migration_batch_id = p_batch_id
       and (
         s.legacy_base_expense <> round(s.legacy_base_expense)
         or s.legacy_base_total <> round(s.legacy_base_total)
       )
  ) then
    raise exception 'VALIDATION: 新本体Revisionで1円単位に完全保存できない旧本体諸費用があります'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.legacy_base_breakdown_mappings m
     where m.migration_batch_id = p_batch_id
       and m.review_status = 'approved'
       and m.target_classification = 'base'
       and m.legacy_amount::numeric <> round(m.legacy_unit_price::numeric * m.legacy_quantity)
  ) then
    raise exception 'VALIDATION: 本体に残す旧明細の金額が単価×数量の再計算結果と一致しません'
      using errcode = 'P0001';
  end if;

  -- 移行前に、旧標準見積そのものが現在も内部整合していることを再確認する。
  if exists (
    select 1
      from public.estimate_templates t
     where (
       select count(*)
         from public.estimate_template_sections s
        where s.template_id = t.id
     ) <> 4
        or exists (
          select 1
            from public.estimate_template_sections s
           where s.template_id = t.id
             and (
               (
                 s.code = 'base'
                 and s.line_subtotal <> coalesce((
                   select sum(b.amount)::numeric
                     from public.base_breakdown_items b
                    where b.base_model_id = t.base_model_id
                      and b.spec_code = t.spec_code
                 ), 0)
               )
               or
               (
                 s.code <> 'base'
                 and s.line_subtotal <> coalesce((
                   select sum(l.amount)::numeric
                     from public.estimate_template_lines l
                    where l.template_id = t.id
                      and l.section_code = s.code
                 ), 0)
               )
               or s.total <> s.line_subtotal + s.expense_amount
             )
        )
        or t.subtotal_raw <> coalesce((
          select sum(s.total)::numeric
            from public.estimate_template_sections s
           where s.template_id = t.id
        ), 0)
        or t.subtotal <> t.subtotal_raw + t.adjustment
        or abs(t.subtotal * t.tax_rate - t.tax) >= 1
        or t.total <> t.subtotal + t.tax
  ) then
    raise exception 'VALIDATION: 旧標準見積の内部金額に不整合があります。移行前に旧データを確認してください'
      using errcode = 'P0001';
  end if;

  update public.legacy_base_migration_batches
     set status = 'ready',
         reviewed_by = v_uid,
         reviewed_at = now()
   where id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

create or replace function public.cancel_legacy_base_migration_batch(p_batch_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if not public.can_manage_legacy_base_migration() then
    raise exception 'FORBIDDEN: 移行監査を更新する権限がありません'
      using errcode = '42501';
  end if;

  update public.legacy_base_migration_batches
     set status = 'cancelled'
   where id = p_batch_id
     and status in ('draft', 'reviewing', 'ready');

  return found;
end;
$$;

-- ---------- RLS / grants ----------
alter table public.legacy_base_migration_batches enable row level security;
alter table public.legacy_base_breakdown_mappings enable row level security;
alter table public.legacy_base_spec_mappings enable row level security;
alter table public.legacy_estimate_duplicate_checks enable row level security;
alter table public.legacy_migration_financial_snapshots enable row level security;

drop policy if exists legacy_base_migration_batches_read on public.legacy_base_migration_batches;
create policy legacy_base_migration_batches_read
on public.legacy_base_migration_batches
for select using (public.can_view_legacy_base_migration());

drop policy if exists legacy_base_breakdown_mappings_read on public.legacy_base_breakdown_mappings;
create policy legacy_base_breakdown_mappings_read
on public.legacy_base_breakdown_mappings
for select using (public.can_view_legacy_base_migration());

drop policy if exists legacy_base_spec_mappings_read on public.legacy_base_spec_mappings;
create policy legacy_base_spec_mappings_read
on public.legacy_base_spec_mappings
for select using (public.can_view_legacy_base_migration());

drop policy if exists legacy_estimate_duplicate_checks_read on public.legacy_estimate_duplicate_checks;
create policy legacy_estimate_duplicate_checks_read
on public.legacy_estimate_duplicate_checks
for select using (public.can_view_legacy_base_migration());

drop policy if exists legacy_migration_financial_snapshots_read on public.legacy_migration_financial_snapshots;
create policy legacy_migration_financial_snapshots_read
on public.legacy_migration_financial_snapshots
for select using (public.can_view_legacy_base_migration());

revoke all privileges on table public.legacy_base_migration_batches,
                                public.legacy_base_breakdown_mappings,
                                public.legacy_base_spec_mappings,
                                public.legacy_estimate_duplicate_checks,
                                public.legacy_migration_financial_snapshots
from public, anon, authenticated;

grant select on public.legacy_base_migration_batches,
                public.legacy_base_breakdown_mappings,
                public.legacy_base_spec_mappings,
                public.legacy_estimate_duplicate_checks,
                public.legacy_migration_financial_snapshots
to authenticated;

grant all privileges on table public.legacy_base_migration_batches,
                               public.legacy_base_breakdown_mappings,
                               public.legacy_base_spec_mappings,
                               public.legacy_estimate_duplicate_checks,
                               public.legacy_migration_financial_snapshots
to service_role;

revoke all on function public.can_view_legacy_base_migration() from public, anon, authenticated;
revoke all on function public.can_manage_legacy_base_migration() from public, anon, authenticated;
revoke all on function public.lock_legacy_estimate_source() from public, anon, authenticated;
revoke all on function public.legacy_base_migration_source_hash() from public, anon, authenticated;
revoke all on function public.assert_legacy_base_migration_source_current(uuid) from public, anon, authenticated;
revoke all on function public.classify_legacy_base_breakdown_item(text, text, text) from public, anon, authenticated;
revoke all on function public.legacy_base_spec_body_signature(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.refresh_legacy_estimate_duplicate_checks(uuid) from public, anon, authenticated;
revoke all on function public.create_legacy_base_migration_batch(text) from public, anon, authenticated;
revoke all on function public.set_legacy_base_mapping_decision(uuid, uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.set_legacy_base_spec_mapping(uuid, uuid, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.resolve_legacy_estimate_duplicate(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.finalize_legacy_base_migration_review(uuid) from public, anon, authenticated;
revoke all on function public.cancel_legacy_base_migration_batch(uuid) from public, anon, authenticated;

grant execute on function public.can_view_legacy_base_migration(),
                          public.can_manage_legacy_base_migration(),
                          public.create_legacy_base_migration_batch(text),
                          public.set_legacy_base_mapping_decision(uuid, uuid, integer, text, text, text),
                          public.set_legacy_base_spec_mapping(uuid, uuid, text, integer, text, text),
                          public.resolve_legacy_estimate_duplicate(uuid, uuid, integer, text),
                          public.finalize_legacy_base_migration_review(uuid),
                          public.cancel_legacy_base_migration_batch(uuid)
to authenticated, service_role;

grant execute on function public.lock_legacy_estimate_source(),
                          public.legacy_base_migration_source_hash(),
                          public.assert_legacy_base_migration_source_current(uuid),
                          public.classify_legacy_base_breakdown_item(text, text, text),
                          public.legacy_base_spec_body_signature(uuid, uuid, text),
                          public.refresh_legacy_estimate_duplicate_checks(uuid)
to service_role;

comment on table public.legacy_base_migration_batches is
  '旧本体内訳から新設計へ移す前の監査バッチ。readyでも実移行はまだ行わない。';
comment on table public.legacy_base_breakdown_mappings is
  '旧base_breakdown_itemsを行単位で固定し、本体/内外装/オプション/別途/要確認の判断履歴を保持する。';
comment on table public.legacy_base_spec_mappings is
  '旧hotel/residence/office等を用途名ではなく実際の本体仕様差でまとめる判断を保持する。';
comment on table public.legacy_estimate_duplicate_checks is
  '旧本体から移す行と既存estimate_template_linesの二重計上候補を保持する。';
comment on table public.legacy_migration_financial_snapshots is
  '移行前の分類別金額・調整・税・総額を固定し、後続PRの1円単位検算基準とする。';
