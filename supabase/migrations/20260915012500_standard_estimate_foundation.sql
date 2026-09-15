-- =============================================================
-- Standard Estimate Master / Revision 基盤
--
-- 既存 estimate_templates / estimate_template_sections / estimate_template_lines /
-- base_breakdown_items および Simulator / Quote / Configuration は変更しない。
-- この migration は新しい標準見積の孤立した DB 基盤だけを追加する。
-- Draft/Save/Publish RPC、旧正本移行、UI接続は後続PRで実装する。
-- =============================================================

-- ---------- Standard Estimate Master ----------
-- base_model_idを検索用にStandard Estimate側へ重複保持するため、
-- (base_master_id, base_model_id)を複合FKで結び、参照元の後日変更もDB自身に防がせる。
create unique index if not exists base_masters_id_model_unique_idx
  on public.base_masters(id, base_model_id);

create table if not exists public.standard_estimate_masters (
  id uuid primary key default gen_random_uuid(),
  owner_organization_id uuid not null references public.organizations(id) on delete restrict,
  base_model_id uuid not null references public.base_models(id) on delete restrict,
  base_master_id uuid not null,
  spec_code text not null,
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  current_published_revision_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (base_master_id, base_model_id)
    references public.base_masters(id, base_model_id)
    on delete restrict,
  unique (owner_organization_id, base_master_id, spec_code),
  check (length(btrim(spec_code)) > 0),
  check (length(btrim(name)) > 0)
);

create index if not exists standard_estimate_masters_model_idx
  on public.standard_estimate_masters(base_model_id, spec_code, status);
create index if not exists standard_estimate_masters_base_master_idx
  on public.standard_estimate_masters(base_master_id, spec_code, status);
create index if not exists standard_estimate_masters_owner_idx
  on public.standard_estimate_masters(owner_organization_id, status);

drop trigger if exists trg_standard_estimate_masters_updated on public.standard_estimate_masters;
create trigger trg_standard_estimate_masters_updated
before update on public.standard_estimate_masters
for each row execute function public.set_updated_at();

create or replace function public.validate_standard_estimate_master_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_type text;
  v_base_model_id uuid;
begin
  select organization_type
    into v_owner_type
    from public.organizations
   where id = new.owner_organization_id
     and status = 'active';

  if v_owner_type is null then
    raise exception 'VALIDATION: 標準見積の所有組織が見つからないか、無効です'
      using errcode = 'P0001';
  end if;
  if v_owner_type <> 'headquarters' then
    raise exception 'VALIDATION: 標準見積を所有できるのは本部だけです'
      using errcode = 'P0001';
  end if;

  select base_model_id
    into v_base_model_id
    from public.base_masters
   where id = new.base_master_id;

  if v_base_model_id is null then
    raise exception 'VALIDATION: 参照する本体Masterが見つかりません'
      using errcode = 'P0001';
  end if;
  if v_base_model_id is distinct from new.base_model_id then
    raise exception 'VALIDATION: 標準見積の商品モデルと本体Masterの商品モデルが一致しません'
      using errcode = 'P0001';
  end if;

  -- 公開前でも既にRevisionがある場合、Masterだけを別Base Masterへ付け替えて
  -- pin済みBase Revisionとの整合を壊すことは許可しない。
  if tg_op = 'UPDATE'
     and new.base_master_id is distinct from old.base_master_id
     and exists (
       select 1
         from public.standard_estimate_revisions r
         join public.base_master_revisions br on br.id = r.base_master_revision_id
        where r.standard_estimate_master_id = old.id
          and br.base_master_id is distinct from new.base_master_id
     )
  then
    raise exception 'VALIDATION: Revision作成済みの標準見積は別の本体Masterへ付け替えできません'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists standard_estimate_masters_refs on public.standard_estimate_masters;
create trigger standard_estimate_masters_refs
before insert or update of owner_organization_id, base_model_id, base_master_id
on public.standard_estimate_masters
for each row execute function public.validate_standard_estimate_master_refs();

-- ---------- Standard Estimate Revision ----------
create table if not exists public.standard_estimate_revisions (
  id uuid primary key default gen_random_uuid(),
  standard_estimate_master_id uuid not null
    references public.standard_estimate_masters(id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'superseded')),
  base_master_revision_id uuid not null
    references public.base_master_revisions(id) on delete restrict,
  tax_rate numeric(8, 6) not null default 0.10
    check (tax_rate >= 0 and tax_rate <= 1),
  standard_adjustment_amount integer not null default 0,
  standard_adjustment_reason text,
  subtotal_raw integer not null default 0 check (subtotal_raw >= 0),
  subtotal integer not null default 0 check (subtotal >= 0),
  tax integer not null default 0 check (tax >= 0),
  total integer not null default 0 check (total >= 0),
  lock_version integer not null default 0 check (lock_version >= 0),
  source_kind text not null default 'ui'
    check (source_kind in ('ui', 'legacy_excel')),
  source_file_name text,
  source_sheet_name text,
  source_sha256 text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (standard_estimate_master_id, version),
  check (subtotal = subtotal_raw + standard_adjustment_amount),
  check (total = subtotal + tax),
  check (
    standard_adjustment_amount = 0
    or nullif(btrim(coalesce(standard_adjustment_reason, '')), '') is not null
  ),
  check (
    (status = 'draft' and published_at is null)
    or (status in ('published', 'superseded') and published_at is not null)
  )
);

create index if not exists standard_estimate_revisions_master_idx
  on public.standard_estimate_revisions(standard_estimate_master_id, version desc);
create index if not exists standard_estimate_revisions_base_revision_idx
  on public.standard_estimate_revisions(base_master_revision_id);
create unique index if not exists standard_estimate_revisions_one_draft_idx
  on public.standard_estimate_revisions(standard_estimate_master_id)
  where status = 'draft';
create unique index if not exists standard_estimate_revisions_one_published_idx
  on public.standard_estimate_revisions(standard_estimate_master_id)
  where status = 'published';

drop trigger if exists trg_standard_estimate_revisions_updated on public.standard_estimate_revisions;
create trigger trg_standard_estimate_revisions_updated
before update on public.standard_estimate_revisions
for each row execute function public.set_updated_at();

create or replace function public.validate_standard_estimate_base_revision_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_master_base_master_id uuid;
  v_master_base_model_id uuid;
  v_base_master_model_id uuid;
  v_revision_base_master_id uuid;
  v_revision_status text;
begin
  select m.base_master_id, m.base_model_id, b.base_model_id
    into v_master_base_master_id, v_master_base_model_id, v_base_master_model_id
    from public.standard_estimate_masters m
    join public.base_masters b on b.id = m.base_master_id
   where m.id = new.standard_estimate_master_id;

  if v_master_base_master_id is null then
    raise exception 'VALIDATION: Standard Estimate Masterが見つかりません'
      using errcode = 'P0001';
  end if;
  if v_base_master_model_id is distinct from v_master_base_model_id then
    raise exception 'VALIDATION: Standard Estimate Masterと本体Masterの商品モデルが一致しません'
      using errcode = 'P0001';
  end if;

  select base_master_id, status
    into v_revision_base_master_id, v_revision_status
    from public.base_master_revisions
   where id = new.base_master_revision_id;

  if v_revision_base_master_id is null then
    raise exception 'VALIDATION: 参照する本体Revisionが見つかりません'
      using errcode = 'P0001';
  end if;
  if v_revision_status not in ('published', 'superseded') then
    raise exception 'VALIDATION: 標準見積はpublishedまたはsupersededの本体Revisionだけを参照できます'
      using errcode = 'P0001';
  end if;
  if v_revision_base_master_id is distinct from v_master_base_master_id then
    raise exception 'VALIDATION: 標準見積Revisionは同じ本体MasterのRevisionを参照してください'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists standard_estimate_revisions_base_ref on public.standard_estimate_revisions;
create trigger standard_estimate_revisions_base_ref
before insert or update of standard_estimate_master_id, base_master_revision_id
on public.standard_estimate_revisions
for each row execute function public.validate_standard_estimate_base_revision_ref();

-- ---------- Sections ----------
create table if not exists public.standard_estimate_revision_sections (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null
    references public.standard_estimate_revisions(id) on delete cascade,
  section_code text not null
    check (section_code in ('interior_exterior', 'option', 'sitework')),
  expense_method text not null default 'none'
    check (expense_method in ('rate', 'fixed', 'none')),
  expense_rate numeric(8, 6),
  expense_amount integer not null default 0 check (expense_amount >= 0),
  line_subtotal integer not null default 0 check (line_subtotal >= 0),
  total integer not null default 0 check (total >= 0),
  unique (revision_id, section_code),
  check (
    (
      expense_method = 'rate'
      and expense_rate is not null
      and expense_rate >= 0
      and expense_rate <= 1
      and expense_amount = floor(line_subtotal::numeric * expense_rate)::integer
    )
    or (expense_method = 'fixed' and expense_rate is null)
    or (expense_method = 'none' and expense_rate is null and expense_amount = 0)
  ),
  check (total = line_subtotal + expense_amount)
);

create index if not exists standard_estimate_revision_sections_revision_idx
  on public.standard_estimate_revision_sections(revision_id, section_code);

-- ---------- Lines ----------
create table if not exists public.standard_estimate_revision_lines (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null,
  line_key uuid not null default gen_random_uuid(),
  section_code text not null
    check (section_code in ('interior_exterior', 'option', 'sitework')),
  group_label text,
  name text not null,
  quantity numeric(14, 4) not null default 1 check (quantity > 0),
  unit text,
  unit_price integer not null default 0 check (unit_price >= 0),
  amount integer not null default 0 check (amount >= 0),
  remark text,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id, line_key),
  foreign key (revision_id, section_code)
    references public.standard_estimate_revision_sections(revision_id, section_code)
    on delete cascade,
  check (amount = round(quantity * unit_price)::integer)
);

create index if not exists standard_estimate_revision_lines_order_idx
  on public.standard_estimate_revision_lines(revision_id, section_code, sort_order, id);

drop trigger if exists trg_standard_estimate_revision_lines_updated on public.standard_estimate_revision_lines;
create trigger trg_standard_estimate_revision_lines_updated
before update on public.standard_estimate_revision_lines
for each row execute function public.set_updated_at();

-- ---------- Baseline items ----------
create table if not exists public.standard_estimate_revision_baseline_items (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null
    references public.standard_estimate_revisions(id) on delete cascade,
  baseline_key uuid not null default gen_random_uuid(),
  option_id uuid not null references public.options(id) on delete restrict,
  option_category_id uuid not null references public.option_categories(id) on delete restrict,
  section_code text not null
    check (section_code in ('interior_exterior', 'option', 'sitework')),
  selection_target_code text not null,
  quantity numeric(14, 4) not null default 1 check (quantity > 0),
  option_code_snapshot text not null,
  option_name_snapshot text not null,
  category_code_snapshot text not null,
  category_name_snapshot text not null,
  unit_price_snapshot integer not null check (unit_price_snapshot >= 0),
  price_on_request_snapshot boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  unique (revision_id, baseline_key),
  unique (revision_id, selection_target_code, option_id),
  check (length(btrim(selection_target_code)) > 0),
  check (length(btrim(option_code_snapshot)) > 0),
  check (length(btrim(option_name_snapshot)) > 0),
  check (length(btrim(category_code_snapshot)) > 0),
  check (length(btrim(category_name_snapshot)) > 0)
);

create index if not exists standard_estimate_baseline_items_revision_idx
  on public.standard_estimate_revision_baseline_items(revision_id, section_code, sort_order, id);

-- 現行 exterior_faces は同じ商品を複数面へ割当可能だが、各面自体は1商品。
-- default等はsingle/multi category双方があるためtarget単独では一意にしない。
create unique index if not exists standard_estimate_baseline_items_one_exterior_face_idx
  on public.standard_estimate_revision_baseline_items(revision_id, selection_target_code)
  where selection_target_code in ('exterior_front', 'exterior_right', 'exterior_back', 'exterior_left');

-- option/categoryの現在の参照関係だけDBで保証する。
-- status/model/spec/dependency/required/section分類、snapshot値一致はPublish RPCで検証する。
create or replace function public.validate_standard_estimate_baseline_item_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_id uuid;
begin
  select category_id
    into v_category_id
    from public.options
   where id = new.option_id;

  if v_category_id is null then
    raise exception 'VALIDATION: baseline商品が見つかりません'
      using errcode = 'P0001';
  end if;
  if v_category_id is distinct from new.option_category_id then
    raise exception 'VALIDATION: baseline商品のcategoryが一致しません'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists standard_estimate_baseline_items_refs
on public.standard_estimate_revision_baseline_items;
create trigger standard_estimate_baseline_items_refs
before insert or update of option_id, option_category_id
on public.standard_estimate_revision_baseline_items
for each row execute function public.validate_standard_estimate_baseline_item_refs();

-- ---------- Baseline variants ----------
create table if not exists public.standard_estimate_revision_baseline_variants (
  id uuid primary key default gen_random_uuid(),
  baseline_item_id uuid not null
    references public.standard_estimate_revision_baseline_items(id) on delete cascade,
  variant_group_id uuid not null references public.option_variant_groups(id) on delete restrict,
  variant_choice_id uuid not null references public.option_variant_choices(id) on delete restrict,
  variant_group_code_snapshot text not null,
  variant_group_name_snapshot text not null,
  variant_choice_code_snapshot text not null,
  variant_choice_name_snapshot text not null,
  extra_price_snapshot integer not null,
  price_on_request_snapshot boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  unique (baseline_item_id, variant_group_id),
  unique (baseline_item_id, variant_choice_id),
  check (length(btrim(variant_group_code_snapshot)) > 0),
  check (length(btrim(variant_group_name_snapshot)) > 0),
  check (length(btrim(variant_choice_code_snapshot)) > 0),
  check (length(btrim(variant_choice_name_snapshot)) > 0)
);

create index if not exists standard_estimate_baseline_variants_item_idx
  on public.standard_estimate_revision_baseline_variants(baseline_item_id, sort_order, id);

create or replace function public.validate_standard_estimate_baseline_variant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_option_id uuid;
  v_group_option_id uuid;
  v_choice_group_id uuid;
begin
  select option_id
    into v_option_id
    from public.standard_estimate_revision_baseline_items
   where id = new.baseline_item_id;

  if v_option_id is null then
    raise exception 'VALIDATION: baseline itemが見つかりません'
      using errcode = 'P0001';
  end if;

  select option_id
    into v_group_option_id
    from public.option_variant_groups
   where id = new.variant_group_id;

  if v_group_option_id is null or v_group_option_id is distinct from v_option_id then
    raise exception 'VALIDATION: variant groupがbaseline商品に属していません'
      using errcode = 'P0001';
  end if;

  select group_id
    into v_choice_group_id
    from public.option_variant_choices
   where id = new.variant_choice_id;

  if v_choice_group_id is null or v_choice_group_id is distinct from new.variant_group_id then
    raise exception 'VALIDATION: variant choiceが指定groupに属していません'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists standard_estimate_baseline_variants_refs
on public.standard_estimate_revision_baseline_variants;
create trigger standard_estimate_baseline_variants_refs
before insert or update of baseline_item_id, variant_group_id, variant_choice_id
on public.standard_estimate_revision_baseline_variants
for each row execute function public.validate_standard_estimate_baseline_variant_refs();

-- ---------- Master identity immutable ----------
create or replace function public.prevent_standard_estimate_master_identity_change_after_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
      from public.standard_estimate_revisions r
     where r.standard_estimate_master_id = old.id
       and r.status in ('published', 'superseded')
  ) and (
    new.owner_organization_id is distinct from old.owner_organization_id
    or new.base_model_id is distinct from old.base_model_id
    or new.base_master_id is distinct from old.base_master_id
    or new.spec_code is distinct from old.spec_code
  ) then
    raise exception 'LOCKED: 公開履歴のある標準見積は所有組織・商品モデル・本体Master・用途区分を変更できません'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists standard_estimate_masters_identity_immutable
on public.standard_estimate_masters;
create trigger standard_estimate_masters_identity_immutable
before update of owner_organization_id, base_model_id, base_master_id, spec_code
on public.standard_estimate_masters
for each row execute function public.prevent_standard_estimate_master_identity_change_after_publish();

-- ---------- Published / superseded immutable ----------
create or replace function public.prevent_published_standard_estimate_revision_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'LOCKED: 公開済みStandard Estimate Revisionは削除できません'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.status = 'draft' then
    if new.status = 'superseded' then
      raise exception 'VALIDATION: draft Revisionを直接supersededにはできません'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if old.status = 'published'
     and new.status = 'superseded'
     and new.id is not distinct from old.id
     and new.standard_estimate_master_id is not distinct from old.standard_estimate_master_id
     and new.version is not distinct from old.version
     and new.base_master_revision_id is not distinct from old.base_master_revision_id
     and new.tax_rate is not distinct from old.tax_rate
     and new.standard_adjustment_amount is not distinct from old.standard_adjustment_amount
     and new.standard_adjustment_reason is not distinct from old.standard_adjustment_reason
     and new.subtotal_raw is not distinct from old.subtotal_raw
     and new.subtotal is not distinct from old.subtotal
     and new.tax is not distinct from old.tax
     and new.total is not distinct from old.total
     and new.lock_version is not distinct from old.lock_version
     and new.source_kind is not distinct from old.source_kind
     and new.source_file_name is not distinct from old.source_file_name
     and new.source_sheet_name is not distinct from old.source_sheet_name
     and new.source_sha256 is not distinct from old.source_sha256
     and new.created_by is not distinct from old.created_by
     and new.updated_by is not distinct from old.updated_by
     and new.published_by is not distinct from old.published_by
     and new.published_at is not distinct from old.published_at
     and new.created_at is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception 'LOCKED: 公開済みStandard Estimate Revisionの内容は変更できません'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists standard_estimate_revisions_immutable
on public.standard_estimate_revisions;
create trigger standard_estimate_revisions_immutable
before update or delete on public.standard_estimate_revisions
for each row execute function public.prevent_published_standard_estimate_revision_mutation();

create or replace function public.prevent_non_draft_standard_estimate_child_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
  v_new_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status
      into v_old_status
      from public.standard_estimate_revisions
     where id = old.revision_id;

    if tg_op = 'DELETE' and v_old_status is null then
      return old;
    end if;
    if v_old_status is null then
      raise exception 'VALIDATION: 変更元Standard Estimate Revisionが見つかりません'
        using errcode = 'P0001';
    end if;
    if v_old_status <> 'draft' then
      raise exception 'LOCKED: 公開済みStandard Estimate Revisionの子要素は変更できません'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select status
      into v_new_status
      from public.standard_estimate_revisions
     where id = new.revision_id;

    if v_new_status is null then
      raise exception 'VALIDATION: 変更先Standard Estimate Revisionが見つかりません'
        using errcode = 'P0001';
    end if;
    if v_new_status <> 'draft' then
      raise exception 'LOCKED: 公開済みStandard Estimate Revisionの子要素は変更できません'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists standard_estimate_revision_sections_draft_only
on public.standard_estimate_revision_sections;
create trigger standard_estimate_revision_sections_draft_only
before insert or update or delete on public.standard_estimate_revision_sections
for each row execute function public.prevent_non_draft_standard_estimate_child_write();

drop trigger if exists standard_estimate_revision_lines_draft_only
on public.standard_estimate_revision_lines;
create trigger standard_estimate_revision_lines_draft_only
before insert or update or delete on public.standard_estimate_revision_lines
for each row execute function public.prevent_non_draft_standard_estimate_child_write();

drop trigger if exists standard_estimate_revision_baseline_items_draft_only
on public.standard_estimate_revision_baseline_items;
create trigger standard_estimate_revision_baseline_items_draft_only
before insert or update or delete on public.standard_estimate_revision_baseline_items
for each row execute function public.prevent_non_draft_standard_estimate_child_write();

create or replace function public.prevent_non_draft_standard_estimate_variant_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
  v_new_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select r.status
      into v_old_status
      from public.standard_estimate_revision_baseline_items bi
      join public.standard_estimate_revisions r on r.id = bi.revision_id
     where bi.id = old.baseline_item_id;

    if tg_op = 'DELETE' and v_old_status is null then
      return old;
    end if;
    if v_old_status is null then
      raise exception 'VALIDATION: 変更元baseline itemのStandard Estimate Revisionが見つかりません'
        using errcode = 'P0001';
    end if;
    if v_old_status <> 'draft' then
      raise exception 'LOCKED: 公開済みStandard Estimate Revisionのbaseline variantは変更できません'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select r.status
      into v_new_status
      from public.standard_estimate_revision_baseline_items bi
      join public.standard_estimate_revisions r on r.id = bi.revision_id
     where bi.id = new.baseline_item_id;

    if v_new_status is null then
      raise exception 'VALIDATION: 変更先baseline itemのStandard Estimate Revisionが見つかりません'
        using errcode = 'P0001';
    end if;
    if v_new_status <> 'draft' then
      raise exception 'LOCKED: 公開済みStandard Estimate Revisionのbaseline variantは変更できません'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists standard_estimate_revision_baseline_variants_draft_only
on public.standard_estimate_revision_baseline_variants;
create trigger standard_estimate_revision_baseline_variants_draft_only
before insert or update or delete on public.standard_estimate_revision_baseline_variants
for each row execute function public.prevent_non_draft_standard_estimate_variant_write();

-- ---------- current Published pointer ----------
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'standard_estimate_masters_current_published_revision_fk'
  ) then
    alter table public.standard_estimate_masters
      add constraint standard_estimate_masters_current_published_revision_fk
      foreign key (current_published_revision_id)
      references public.standard_estimate_revisions(id)
      on delete set null;
  end if;
end
$$;

create or replace function public.validate_standard_estimate_current_pointer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.current_published_revision_id is not null
     and not exists (
       select 1
         from public.standard_estimate_revisions r
        where r.id = new.current_published_revision_id
          and r.standard_estimate_master_id = new.id
          and r.status = 'published'
     )
  then
    raise exception 'VALIDATION: 現在公開版は同じStandard Estimate Masterのpublished Revisionを指定してください'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists standard_estimate_masters_current_pointer
on public.standard_estimate_masters;
create trigger standard_estimate_masters_current_pointer
before insert or update of current_published_revision_id
on public.standard_estimate_masters
for each row execute function public.validate_standard_estimate_current_pointer();

create or replace function public.validate_standard_estimate_current_pointer_at_commit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_master_id uuid;
begin
  if tg_op = 'DELETE' then
    v_master_id := old.standard_estimate_master_id;
  else
    v_master_id := new.standard_estimate_master_id;
  end if;

  if exists (
    select 1
      from public.standard_estimate_masters m
      left join public.standard_estimate_revisions r
        on r.id = m.current_published_revision_id
     where m.id = v_master_id
       and m.current_published_revision_id is not null
       and (
         r.id is null
         or r.standard_estimate_master_id <> m.id
         or r.status <> 'published'
       )
  ) then
    raise exception 'VALIDATION: Standard Estimateの現在公開版ポインタはtransaction完了時に自分自身のpublished Revisionを指す必要があります'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

drop trigger if exists standard_estimate_current_pointer_consistency
on public.standard_estimate_revisions;
create constraint trigger standard_estimate_current_pointer_consistency
after insert or update or delete on public.standard_estimate_revisions
deferrable initially deferred
for each row execute function public.validate_standard_estimate_current_pointer_at_commit();

-- ---------- 権限判定 ----------
create or replace function public.is_active_standard_estimate_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
         or exists (
           select 1
             from public.organization_memberships m
             join public.organizations o on o.id = m.organization_id
            where m.profile_id = auth.uid()
              and m.status = 'active'
              and o.status = 'active'
              and o.organization_type in ('headquarters', 'master_dealer', 'dealer')
         );
$$;

create or replace function public.can_create_standard_estimate_master_for_org(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.organizations o
     where o.id = p_organization_id
       and o.status = 'active'
       and o.organization_type = 'headquarters'
       and (
         public.is_admin()
         or public.current_organization_member_rank(o.id) >= 1
       )
  );
$$;

create or replace function public.can_edit_standard_estimate_master(p_standard_estimate_master_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.standard_estimate_masters m
      join public.organizations o on o.id = m.owner_organization_id
     where m.id = p_standard_estimate_master_id
       and m.status = 'active'
       and o.status = 'active'
       and o.organization_type = 'headquarters'
       and (
         public.is_admin()
         or public.current_organization_member_rank(o.id) >= 1
       )
  );
$$;

create or replace function public.can_view_standard_estimate_master(p_standard_estimate_master_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
         or exists (
           select 1
             from public.standard_estimate_masters m
             join public.organizations owner_org on owner_org.id = m.owner_organization_id
            where m.id = p_standard_estimate_master_id
              and owner_org.status = 'active'
              and owner_org.organization_type = 'headquarters'
              and (
                public.current_organization_member_rank(owner_org.id) >= 1
                or (
                  public.is_active_standard_estimate_staff()
                  and exists (
                    select 1
                      from public.standard_estimate_revisions r
                     where r.standard_estimate_master_id = m.id
                       and r.status in ('published', 'superseded')
                  )
                )
              )
         );
$$;

create or replace function public.can_view_standard_estimate_revision(p_standard_estimate_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
         or exists (
           select 1
             from public.standard_estimate_revisions r
             join public.standard_estimate_masters m on m.id = r.standard_estimate_master_id
             join public.organizations owner_org on owner_org.id = m.owner_organization_id
            where r.id = p_standard_estimate_revision_id
              and owner_org.status = 'active'
              and owner_org.organization_type = 'headquarters'
              and (
                public.current_organization_member_rank(owner_org.id) >= 1
                or (
                  r.status in ('published', 'superseded')
                  and public.is_active_standard_estimate_staff()
                )
              )
         );
$$;

-- ---------- RLS ----------
alter table public.standard_estimate_masters enable row level security;
alter table public.standard_estimate_revisions enable row level security;
alter table public.standard_estimate_revision_sections enable row level security;
alter table public.standard_estimate_revision_lines enable row level security;
alter table public.standard_estimate_revision_baseline_items enable row level security;
alter table public.standard_estimate_revision_baseline_variants enable row level security;

drop policy if exists standard_estimate_masters_read on public.standard_estimate_masters;
create policy standard_estimate_masters_read
on public.standard_estimate_masters
for select
to authenticated
using (public.can_view_standard_estimate_master(id));

drop policy if exists standard_estimate_revisions_read on public.standard_estimate_revisions;
create policy standard_estimate_revisions_read
on public.standard_estimate_revisions
for select
to authenticated
using (public.can_view_standard_estimate_revision(id));

drop policy if exists standard_estimate_revision_sections_read
on public.standard_estimate_revision_sections;
create policy standard_estimate_revision_sections_read
on public.standard_estimate_revision_sections
for select
to authenticated
using (public.can_view_standard_estimate_revision(revision_id));

drop policy if exists standard_estimate_revision_lines_read
on public.standard_estimate_revision_lines;
create policy standard_estimate_revision_lines_read
on public.standard_estimate_revision_lines
for select
to authenticated
using (public.can_view_standard_estimate_revision(revision_id));

drop policy if exists standard_estimate_revision_baseline_items_read
on public.standard_estimate_revision_baseline_items;
create policy standard_estimate_revision_baseline_items_read
on public.standard_estimate_revision_baseline_items
for select
to authenticated
using (public.can_view_standard_estimate_revision(revision_id));

drop policy if exists standard_estimate_revision_baseline_variants_read
on public.standard_estimate_revision_baseline_variants;
create policy standard_estimate_revision_baseline_variants_read
on public.standard_estimate_revision_baseline_variants
for select
to authenticated
using (
  exists (
    select 1
      from public.standard_estimate_revision_baseline_items bi
     where bi.id = baseline_item_id
       and public.can_view_standard_estimate_revision(bi.revision_id)
  )
);

revoke all privileges on table public.standard_estimate_masters,
                                public.standard_estimate_revisions,
                                public.standard_estimate_revision_sections,
                                public.standard_estimate_revision_lines,
                                public.standard_estimate_revision_baseline_items,
                                public.standard_estimate_revision_baseline_variants
from public, anon, authenticated;

grant select on public.standard_estimate_masters,
                public.standard_estimate_revisions,
                public.standard_estimate_revision_sections,
                public.standard_estimate_revision_lines,
                public.standard_estimate_revision_baseline_items,
                public.standard_estimate_revision_baseline_variants
to authenticated;

grant all privileges on table public.standard_estimate_masters,
                               public.standard_estimate_revisions,
                               public.standard_estimate_revision_sections,
                               public.standard_estimate_revision_lines,
                               public.standard_estimate_revision_baseline_items,
                               public.standard_estimate_revision_baseline_variants
to service_role;

revoke all on function public.validate_standard_estimate_master_refs() from public, anon, authenticated;
revoke all on function public.validate_standard_estimate_base_revision_ref() from public, anon, authenticated;
revoke all on function public.validate_standard_estimate_baseline_item_refs() from public, anon, authenticated;
revoke all on function public.validate_standard_estimate_baseline_variant_refs() from public, anon, authenticated;
revoke all on function public.prevent_standard_estimate_master_identity_change_after_publish() from public, anon, authenticated;
revoke all on function public.prevent_published_standard_estimate_revision_mutation() from public, anon, authenticated;
revoke all on function public.prevent_non_draft_standard_estimate_child_write() from public, anon, authenticated;
revoke all on function public.prevent_non_draft_standard_estimate_variant_write() from public, anon, authenticated;
revoke all on function public.validate_standard_estimate_current_pointer() from public, anon, authenticated;
revoke all on function public.validate_standard_estimate_current_pointer_at_commit() from public, anon, authenticated;
revoke all on function public.is_active_standard_estimate_staff() from public, anon, authenticated;
revoke all on function public.can_create_standard_estimate_master_for_org(uuid) from public, anon, authenticated;
revoke all on function public.can_edit_standard_estimate_master(uuid) from public, anon, authenticated;
revoke all on function public.can_view_standard_estimate_master(uuid) from public, anon, authenticated;
revoke all on function public.can_view_standard_estimate_revision(uuid) from public, anon, authenticated;

grant execute on function public.can_create_standard_estimate_master_for_org(uuid),
                          public.can_edit_standard_estimate_master(uuid),
                          public.can_view_standard_estimate_master(uuid),
                          public.can_view_standard_estimate_revision(uuid)
to authenticated, service_role;

grant execute on function public.validate_standard_estimate_master_refs(),
                          public.validate_standard_estimate_base_revision_ref(),
                          public.validate_standard_estimate_baseline_item_refs(),
                          public.validate_standard_estimate_baseline_variant_refs(),
                          public.prevent_standard_estimate_master_identity_change_after_publish(),
                          public.prevent_published_standard_estimate_revision_mutation(),
                          public.prevent_non_draft_standard_estimate_child_write(),
                          public.prevent_non_draft_standard_estimate_variant_write(),
                          public.validate_standard_estimate_current_pointer(),
                          public.validate_standard_estimate_current_pointer_at_commit(),
                          public.is_active_standard_estimate_staff()
to service_role;

comment on table public.standard_estimate_masters is
  '標準見積の論理Master。初期版はHQ所有のみ。価格・明細はRevisionに保持する。';
comment on table public.standard_estimate_revisions is
  '標準見積の版。公開済み版は本体Revision・税率・調整・金額・baseline snapshotを固定する。';
comment on table public.standard_estimate_revision_sections is
  '標準見積Revisionの内外装工事・オプション・別途の3分類と分類別諸費用。baseは保持しない。';
comment on table public.standard_estimate_revision_lines is
  '標準見積Revisionの非base明細。line_keyでRevision間の同一明細を追跡する。';
comment on table public.standard_estimate_revision_baseline_items is
  '標準状態の商品ID・表示情報・基準単価snapshot。変更後商品の将来価格は保持しない。';
comment on table public.standard_estimate_revision_baseline_variants is
  '標準状態のvariant ID・表示情報・追加価格snapshot。公開後はlive catalogで再解決しない。';
