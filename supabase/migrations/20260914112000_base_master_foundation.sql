-- =============================================================
-- 本体マスター基盤（組織所有 + Revision）
--
-- 新しい標準見積設計の第1段階。
-- 既存 base_models / base_breakdown_items / estimate_templates の挙動は変更しない。
--
-- 方針:
--   * base_models = Wing / BOX / PLUS などの商品モデル
--   * base_masters = 組織が所有する「本体」という論理マスター
--   * base_master_revisions = 本体の版。公開済み版は内容を固定する
--   * base_master_revision_lines = 本体Revisionの明細
--   * 本体の所有者はユーザー個人ではなく organization
--   * ユーザー権限と会社種別を分離し、organization_memberships を権限判定の正本にする
--   * 標準見積からは将来 base_master_id ではなく base_master_revision_id を参照する
--
-- このmigrationでは新テーブルを既存価格計算へ接続しない。
-- 既存データのコピー移行・Draft/Publish RPC・標準見積Revision化は後続PRで行う。
-- =============================================================

-- ---------- 組織 ----------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  organization_type text not null
    check (organization_type in ('headquarters', 'master_dealer', 'dealer')),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_organizations_updated on public.organizations;
create trigger trg_organizations_updated
before update on public.organizations
for each row execute function public.set_updated_at();

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'viewer'
    check (member_role in ('owner', 'admin', 'editor', 'viewer')),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);

create index if not exists organization_memberships_profile_idx
  on public.organization_memberships(profile_id, status);
create unique index if not exists organization_memberships_one_primary_idx
  on public.organization_memberships(profile_id)
  where is_primary = true and status = 'active';

drop trigger if exists trg_organization_memberships_updated on public.organization_memberships;
create trigger trg_organization_memberships_updated
before update on public.organization_memberships
for each row execute function public.set_updated_at();

-- 技術の杜（本部）を作り、既存 admin を本部 owner として移行する。
-- 総代理店・代理店は同一会社に複数ユーザーが存在し得るため、自動で1人1社を作らない。
insert into public.organizations (code, name, organization_type, status)
values ('gijutsu-no-mori', '株式会社 技術の杜', 'headquarters', 'active')
on conflict (code) do update
set name = excluded.name,
    organization_type = excluded.organization_type,
    status = excluded.status,
    updated_at = now();

insert into public.organization_memberships (
  organization_id, profile_id, member_role, status, is_primary
)
select o.id, p.id, 'owner', 'active', true
  from public.organizations o
  join public.profiles p on p.role_code = 'admin'
 where o.code = 'gijutsu-no-mori'
on conflict (organization_id, profile_id) do update
set member_role = 'owner',
    status = 'active',
    is_primary = true,
    updated_at = now();

-- ---------- 組織内権限 ----------
create or replace function public.organization_member_role_rank(p_role text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_role
           when 'owner' then 3
           when 'admin' then 2
           when 'editor' then 1
           else 0
         end;
$$;

create or replace function public.current_organization_member_rank(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(public.organization_member_role_rank(m.member_role)), -1)
    from public.organization_memberships m
   where m.organization_id = p_organization_id
     and m.profile_id = auth.uid()
     and m.status = 'active';
$$;

create or replace function public.can_create_base_master_for_org(p_organization_id uuid)
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
       and o.organization_type in ('headquarters', 'master_dealer')
       and public.current_organization_member_rank(o.id) >= 1
  );
$$;

revoke all on function public.organization_member_role_rank(text) from public;
revoke all on function public.current_organization_member_rank(uuid) from public;
revoke all on function public.can_create_base_master_for_org(uuid) from public;
grant execute on function public.organization_member_role_rank(text),
                          public.current_organization_member_rank(uuid),
                          public.can_create_base_master_for_org(uuid)
to authenticated, service_role;

-- ---------- 本体の論理マスター ----------
create table if not exists public.base_masters (
  id uuid primary key default gen_random_uuid(),
  base_model_id uuid not null references public.base_models(id) on delete restrict,
  owner_organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  fire_spec_code text not null default 'non_fire'
    check (fire_spec_code in ('non_fire', 'fire')),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists base_masters_model_idx
  on public.base_masters(base_model_id, status);
create index if not exists base_masters_owner_idx
  on public.base_masters(owner_organization_id, status);

drop trigger if exists trg_base_masters_updated on public.base_masters;
create trigger trg_base_masters_updated
before update on public.base_masters
for each row execute function public.set_updated_at();

-- dealer 組織を本体所有者にできないよう、DBでも保証する。
create or replace function public.enforce_base_master_owner_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  select organization_type into v_type
    from public.organizations
   where id = new.owner_organization_id
     and status = 'active';

  if v_type is null then
    raise exception 'VALIDATION: 本体所有組織が見つからないか、無効です'
      using errcode = 'P0001';
  end if;
  if v_type not in ('headquarters', 'master_dealer') then
    raise exception 'VALIDATION: 本体を所有できるのは本部または総代理店です'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists base_masters_owner_type on public.base_masters;
create trigger base_masters_owner_type
before insert or update of owner_organization_id on public.base_masters
for each row execute function public.enforce_base_master_owner_type();


-- 公開履歴ができた後は「何の本体か」を表す識別情報を変更しない。
-- 名称変更・アーカイブ・公開版ポインタ更新は許可するが、
-- 商品モデル / 所有組織 / 防火区分 / 複製元の付け替えは履歴の意味を壊すため禁止する。
create or replace function public.prevent_base_master_identity_change_after_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $
begin
  if exists (
    select 1
      from public.base_master_revisions r
     where r.base_master_id = old.id
       and r.status in ('published', 'superseded')
  ) and (
    new.base_model_id is distinct from old.base_model_id
    or new.owner_organization_id is distinct from old.owner_organization_id
    or new.fire_spec_code is distinct from old.fire_spec_code
    or new.cloned_from_revision_id is distinct from old.cloned_from_revision_id
  ) then
    raise exception 'LOCKED: 公開履歴のある本体は商品モデル・所有組織・防火区分・複製元を変更できません'
      using errcode = 'P0001';
  end if;
  return new;
end;
$;

-- ---------- 本体Revision ----------
create table if not exists public.base_master_revisions (
  id uuid primary key default gen_random_uuid(),
  base_master_id uuid not null references public.base_masters(id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'superseded')),
  expense_method text not null default 'rate'
    check (expense_method in ('rate', 'fixed', 'none')),
  expense_rate numeric(8, 6),
  -- rate の場合はサーバー計算後の実額、fixed の場合は入力された固定額。
  expense_amount integer not null default 0 check (expense_amount >= 0),
  line_subtotal integer not null default 0 check (line_subtotal >= 0),
  total integer not null default 0 check (total >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (base_master_id, version),
  check (
    (expense_method = 'rate' and expense_rate is not null and expense_rate >= 0 and expense_rate <= 1)
    or (expense_method in ('fixed', 'none') and expense_rate is null)
  ),
  check (expense_method <> 'none' or expense_amount = 0),
  check (total = line_subtotal + expense_amount),
  check (
    (status = 'draft' and published_at is null)
    or (status in ('published', 'superseded') and published_at is not null)
  )
);

create index if not exists base_master_revisions_master_idx
  on public.base_master_revisions(base_master_id, version desc);
create unique index if not exists base_master_revisions_one_draft_idx
  on public.base_master_revisions(base_master_id)
  where status = 'draft';
create unique index if not exists base_master_revisions_one_published_idx
  on public.base_master_revisions(base_master_id)
  where status = 'published';

drop trigger if exists trg_base_master_revisions_updated on public.base_master_revisions;
create trigger trg_base_master_revisions_updated
before update on public.base_master_revisions
for each row execute function public.set_updated_at();

create table if not exists public.base_master_revision_lines (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.base_master_revisions(id) on delete cascade,
  -- Revisionを跨いで同じ明細を追跡するための安定キー。
  -- 新版作成時、継続する明細は同じ line_key を引き継ぐ。
  line_key uuid not null default gen_random_uuid(),
  section text not null,
  name text not null,
  quantity numeric not null default 1 check (quantity > 0),
  unit text,
  unit_price integer not null default 0 check (unit_price >= 0),
  amount integer not null default 0 check (amount >= 0),
  remark text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id, line_key)
);

create index if not exists base_master_revision_lines_idx
  on public.base_master_revision_lines(revision_id, sort_order, id);

drop trigger if exists trg_base_master_revision_lines_updated on public.base_master_revision_lines;
create trigger trg_base_master_revision_lines_updated
before update on public.base_master_revision_lines
for each row execute function public.set_updated_at();

-- base_masters → Revision のポインタはRevision作成後に追加する。
alter table public.base_masters
  add column if not exists current_published_revision_id uuid,
  add column if not exists cloned_from_revision_id uuid;


drop trigger if exists base_masters_identity_immutable on public.base_masters;
create trigger base_masters_identity_immutable
before update of base_model_id, owner_organization_id, fire_spec_code, cloned_from_revision_id
on public.base_masters
for each row execute function public.prevent_base_master_identity_change_after_publish();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'base_masters_current_published_revision_fk'
  ) then
    alter table public.base_masters
      add constraint base_masters_current_published_revision_fk
      foreign key (current_published_revision_id)
      references public.base_master_revisions(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'base_masters_cloned_from_revision_fk'
  ) then
    alter table public.base_masters
      add constraint base_masters_cloned_from_revision_fk
      foreign key (cloned_from_revision_id)
      references public.base_master_revisions(id)
      on delete set null;
  end if;
end
$$;

-- current_published_revision_id は「自分自身の published Revision」だけを指せる。
create or replace function public.validate_base_master_revision_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.current_published_revision_id is not null
     and not exists (
       select 1
         from public.base_master_revisions r
        where r.id = new.current_published_revision_id
          and r.base_master_id = new.id
          and r.status = 'published'
     ) then
    raise exception 'VALIDATION: 現在公開版は同じ本体のpublished Revisionを指定してください'
      using errcode = 'P0001';
  end if;

  if new.cloned_from_revision_id is not null
     and not exists (
       select 1
         from public.base_master_revisions r
         join public.base_masters source_master on source_master.id = r.base_master_id
        where r.id = new.cloned_from_revision_id
          and r.status in ('published', 'superseded')
          and source_master.base_model_id = new.base_model_id
     ) then
    raise exception 'VALIDATION: 複製元は同じ商品モデルの公開済み本体Revisionを指定してください'
      using errcode = 'P0001';
  end if;

  return new;
end;
$;

drop trigger if exists base_masters_revision_refs on public.base_masters;
create trigger base_masters_revision_refs
before insert or update of current_published_revision_id, cloned_from_revision_id, base_model_id
on public.base_masters
for each row execute function public.validate_base_master_revision_refs();

-- ---------- 本体アクセス判定 ----------
create or replace function public.can_edit_base_master(p_base_master_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $
  select exists (
    select 1
      from public.base_masters b
     where b.id = p_base_master_id
       and b.status = 'active'
       and public.can_create_base_master_for_org(b.owner_organization_id)
  );
$;


-- 所有組織のメンバー（viewer含む）またはシステム管理者は、
-- archivedを含めて本体とその履歴を閲覧できる。
create or replace function public.can_view_owned_base_master(p_base_master_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $
  select public.is_admin()
         or exists (
           select 1
             from public.base_masters b
             join public.organizations o on o.id = b.owner_organization_id
            where b.id = p_base_master_id
              and o.status = 'active'
              and public.current_organization_member_rank(o.id) >= 0
         );
$;

-- 本体を「利用できるか」の判定は必ずこの関数へ集約する。
-- 初期ルール:
--   * 本部所有本体: activeな組織に所属するスタッフが利用可能
--   * 総代理店所有本体: その所有組織のメンバーだけ利用可能
-- 将来「所属総代理店の本体を代理店へ共有」等へ変更する場合も、この関数を差し替える。
create or replace function public.can_use_base_master(p_base_master_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.base_masters b
      join public.organizations owner_org on owner_org.id = b.owner_organization_id
     where b.id = p_base_master_id
       and b.status = 'active'
       and owner_org.status = 'active'
       and (
         (
           owner_org.organization_type = 'headquarters'
           and exists (
             select 1
               from public.organization_memberships m
               join public.organizations my_org on my_org.id = m.organization_id
              where m.profile_id = auth.uid()
                and m.status = 'active'
                and my_org.status = 'active'
                and my_org.organization_type in ('headquarters', 'master_dealer', 'dealer')
           )
         )
         or
         (
           owner_org.organization_type = 'master_dealer'
           and exists (
             select 1
               from public.organization_memberships m
              where m.organization_id = owner_org.id
                and m.profile_id = auth.uid()
                and m.status = 'active'
           )
         )
       )
  );
$$;

revoke all on function public.enforce_base_master_owner_type() from public;
revoke all on function public.validate_base_master_revision_refs() from public;
revoke all on function public.can_edit_base_master(uuid) from public;
revoke all on function public.can_view_owned_base_master(uuid) from public;
revoke all on function public.can_use_base_master(uuid) from public;
grant execute on function public.can_edit_base_master(uuid),
                          public.can_view_owned_base_master(uuid),
                          public.can_use_base_master(uuid)
to authenticated, service_role;

-- ---------- 公開済みRevisionの不変性 ----------
-- 明細はdraft Revisionだけ編集できる。published/supersededの内容を後から書き換えない。
create or replace function public.prevent_non_draft_base_master_line_write()
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
    select status into v_old_status
      from public.base_master_revisions
     where id = old.revision_id;

    -- FK cascadeでdraft Revision自体を削除する場合、親行は既に見えない。
    -- 親RevisionのDELETEは別triggerでpublished/supersededを拒否しているため、
    -- 親が見つからないDELETEは許可してよい。
    if tg_op = 'DELETE' and v_old_status is null then
      return old;
    end if;

    if v_old_status is null then
      raise exception 'VALIDATION: 変更元の本体Revisionが見つかりません'
        using errcode = 'P0001';
    end if;
    if v_old_status <> 'draft' then
      raise exception 'LOCKED: 公開済み本体Revisionの明細は変更できません'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select status into v_new_status
      from public.base_master_revisions
     where id = new.revision_id;

    if v_new_status is null then
      raise exception 'VALIDATION: 変更先の本体Revisionが見つかりません'
        using errcode = 'P0001';
    end if;
    if v_new_status <> 'draft' then
      raise exception 'LOCKED: 公開済み本体Revisionの明細は変更できません'
        using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists base_master_revision_lines_draft_only on public.base_master_revision_lines;
create trigger base_master_revision_lines_draft_only
before insert or update or delete on public.base_master_revision_lines
for each row execute function public.prevent_non_draft_base_master_line_write();

-- Revision本体も、公開後は「published → superseded」の状態変更以外を禁止する。
create or replace function public.prevent_published_base_master_revision_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'LOCKED: 公開済み本体Revisionは削除できません'
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
     and new.base_master_id is not distinct from old.base_master_id
     and new.version is not distinct from old.version
     and new.expense_method is not distinct from old.expense_method
     and new.expense_rate is not distinct from old.expense_rate
     and new.expense_amount is not distinct from old.expense_amount
     and new.line_subtotal is not distinct from old.line_subtotal
     and new.total is not distinct from old.total
     and new.created_by is not distinct from old.created_by
     and new.published_by is not distinct from old.published_by
     and new.published_at is not distinct from old.published_at
     and new.created_at is not distinct from old.created_at
  then
    return new;
  end if;

  raise exception 'LOCKED: 公開済み本体Revisionの内容は変更できません'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists base_master_revisions_immutable on public.base_master_revisions;
create trigger base_master_revisions_immutable
before update or delete on public.base_master_revisions
for each row execute function public.prevent_published_base_master_revision_mutation();

revoke all on function public.prevent_base_master_identity_change_after_publish() from public;
revoke all on function public.prevent_non_draft_base_master_line_write() from public;
revoke all on function public.prevent_published_base_master_revision_mutation() from public;

-- ---------- RLS / grants ----------
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.base_masters enable row level security;
alter table public.base_master_revisions enable row level security;
alter table public.base_master_revision_lines enable row level security;

drop policy if exists organizations_staff_read on public.organizations;
create policy organizations_staff_read on public.organizations
for select using (
  public.current_role_rank() >= 1
  or exists (
    select 1
      from public.organization_memberships m
     where m.profile_id = auth.uid()
       and m.status = 'active'
  )
);

drop policy if exists organization_memberships_read on public.organization_memberships;
create policy organization_memberships_read on public.organization_memberships
for select using (
  profile_id = auth.uid()
  or public.is_admin()
);

drop policy if exists base_masters_read on public.base_masters;
create policy base_masters_read on public.base_masters
for select using (
  public.can_view_owned_base_master(id)
  or public.can_use_base_master(id)
);

drop policy if exists base_master_revisions_read on public.base_master_revisions;
create policy base_master_revisions_read on public.base_master_revisions
for select using (
  public.can_view_owned_base_master(base_master_id)
  or (status <> 'draft' and public.can_use_base_master(base_master_id))
);

drop policy if exists base_master_revision_lines_read on public.base_master_revision_lines;
create policy base_master_revision_lines_read on public.base_master_revision_lines
for select using (
  exists (
    select 1
      from public.base_master_revisions r
     where r.id = revision_id
       and (
         public.can_view_owned_base_master(r.base_master_id)
         or (r.status <> 'draft' and public.can_use_base_master(r.base_master_id))
       )
  )
);

-- 第1段階ではauthenticatedからの直接書込みを許可しない。
-- 後続PRで所有権検証付きDraft/Publish RPCを追加する。
grant select on public.organizations,
                public.organization_memberships,
                public.base_masters,
                public.base_master_revisions,
                public.base_master_revision_lines
to authenticated;

revoke insert, update, delete on public.organizations,
                                public.organization_memberships,
                                public.base_masters,
                                public.base_master_revisions,
                                public.base_master_revision_lines
from authenticated;

grant all on public.organizations,
             public.organization_memberships,
             public.base_masters,
             public.base_master_revisions,
             public.base_master_revision_lines
to service_role;

comment on table public.organizations is
  '会社単位の権限・所有者。ユーザー個人ではなく本体所有組織を表す。';
comment on table public.organization_memberships is
  'ユーザーと組織の所属。会社種別とユーザー権限を分離するための正本。';
comment on table public.base_masters is
  '本体の論理マスター。金額・明細はRevision側に保持する。';
comment on table public.base_master_revisions is
  '本体の版。標準見積は将来このRevision IDを固定参照する。';
comment on table public.base_master_revision_lines is
  '本体Revisionの明細。公開済みRevisionの明細は不変。';
