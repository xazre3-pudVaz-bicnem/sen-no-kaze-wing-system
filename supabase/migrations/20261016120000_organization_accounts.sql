-- 代理店・総代理店の組織とアカウント（2026-10-15 先方確定）。
--
-- 先方の決まり：1 代理店＝1 組織、担当者ごとの個別アカウント。代理店・総代理店とも、本部が組織と最初の管理者を登録し、
-- その後の担当者は、その組織の管理者が追加する。管理者は複数人でよい。代理店には直属の総代理店がある。
--
-- * organizations.parent_organization_id：代理店の直属の総代理店（総代理店・本部は親を持たない）
-- * 代理店・総代理店での役割は「管理者」（member_role = admin。従来の owner も管理者として扱う）と「担当者」（editor）
-- * 有効な所属は 1 人 1 つ。代理店・総代理店に所属すると利用者の種類（role_code）を dealer／master_dealer にし、
--   所属を外すと customer に戻す。本部の管理者（role_code = admin）は代理店・総代理店に所属させない
-- * 招待：本部はどの代理店・総代理店にも、管理者は自分の組織に、メールアドレスと役割を決めて招待する。
--   同じメールアドレスでログインした本人だけが、7 日以内に 1 回だけ受けられる。DB には鍵のハッシュだけを残す
-- * 書き込みは SECURITY DEFINER の RPC だけ。変更は audit_logs に残す
-- * 案件・見積の権限（営業担当組織・主担当者・製造担当組織）は、この migration では変えない

begin;

-- ---------- preflight ----------

do $preflight$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.audit_logs') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception 'PRECONDITION: organizations / memberships / audit_logs / is_admin() are required';
  end if;
  if exists (
    select 1 from public.organization_memberships
     where status = 'active'
     group by profile_id
    having count(*) > 1
  ) then
    raise exception 'PRECONDITION: a profile has more than one active organization membership; resolve before applying';
  end if;
  if exists (
    select 1
      from public.organization_memberships m
      join public.profiles p on p.id = m.profile_id
      join public.organizations o on o.id = m.organization_id
     where m.status = 'active'
       and o.organization_type in ('master_dealer', 'dealer')
       and p.role_code = 'admin'
  ) then
    raise exception 'PRECONDITION: a global admin is an active member of a dealer organization; resolve before applying';
  end if;
end;
$preflight$;

-- ---------- 直属の総代理店 ----------

alter table public.organizations
  add column parent_organization_id uuid references public.organizations(id) on delete restrict;

create index organizations_parent_idx
  on public.organizations(parent_organization_id)
  where parent_organization_id is not null;

comment on column public.organizations.parent_organization_id is
  '代理店の直属の総代理店。総代理店・本部は親を持たない。製造依頼の送り先（案件の所属総代理店）の初期値になる。';

create function public.validate_organization_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_type text;
begin
  if new.parent_organization_id is not null then
    if new.organization_type <> 'dealer' then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 直属の総代理店を設定できるのは代理店だけです';
    end if;
    if new.parent_organization_id = new.id then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 自分自身を直属の総代理店にはできません';
    end if;
    select o.organization_type into v_parent_type
      from public.organizations o
     where o.id = new.parent_organization_id;
    if v_parent_type is distinct from 'master_dealer' then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 直属の組織には総代理店を選んでください';
    end if;
  end if;
  if tg_op = 'UPDATE'
     and old.organization_type = 'master_dealer'
     and new.organization_type <> 'master_dealer'
     and exists (select 1 from public.organizations c where c.parent_organization_id = new.id) then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 配下の代理店がある総代理店は、種類を変えられません';
  end if;
  return new;
end;
$$;

create trigger organizations_parent_validate
before insert or update of organization_type, parent_organization_id on public.organizations
for each row execute function public.validate_organization_parent();

-- ---------- 所属：有効な所属は 1 人 1 つ ----------

create unique index organization_memberships_one_active_idx
  on public.organization_memberships(profile_id)
  where status = 'active';

create sequence public.organization_code_seq;

-- ---------- 招待 ----------

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (
    email = lower(btrim(email))
    and length(email) between 3 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  member_role text not null check (member_role in ('admin', 'editor')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  check (accepted_at is null or revoked_at is null),
  check (expires_at > created_at)
);

comment on table public.organization_invitations is
  '代理店・総代理店への招待。鍵は発行時に一度だけ返し、DB には SHA-256 のハッシュだけを残す。読み書きは RPC だけ。';

create unique index organization_invitations_open_idx
  on public.organization_invitations(organization_id, email)
  where accepted_at is null and revoked_at is null;
create index organization_invitations_org_idx
  on public.organization_invitations(organization_id, created_at desc);

alter table public.organization_invitations enable row level security;
revoke all on table public.organization_invitations from public, anon, authenticated, service_role;
revoke all on sequence public.organization_code_seq from public, anon, authenticated, service_role;

-- ---------- 判定 ----------

-- 自分がその組織の管理者か（従来の owner も管理者）。停止中の組織では管理者として扱わない
create function public.is_organization_manager(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.organization_memberships m
      join public.organizations o on o.id = m.organization_id
     where m.organization_id = p_organization_id
       and m.profile_id = auth.uid()
       and m.status = 'active'
       and m.member_role in ('owner', 'admin')
       and o.status = 'active'
  );
$$;

comment on function public.is_organization_manager(uuid) is
  '自分がその組織の管理者か（member_role が owner／admin、所属・組織とも有効）。';

-- 監査ログ（実行者は auth.uid()）
create function public.write_organization_audit(
  p_action text,
  p_entity text,
  p_entity_id uuid,
  p_summary text,
  p_before jsonb,
  p_after jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (actor_id, actor_email, action, entity, entity_id, summary, before, after)
  select auth.uid(), (select p.email from public.profiles p where p.id = auth.uid()),
         p_action, p_entity, p_entity_id, p_summary, p_before, p_after;
$$;

-- ---------- 組織（本部だけ） ----------

create function public.create_organization(p_organization_type text, p_name text, p_parent_organization_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_code text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 組織を登録できるのは本部の管理者だけです';
  end if;
  if p_organization_type is null or p_organization_type not in ('master_dealer', 'dealer') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 組織の種類は「総代理店」か「代理店」を選んでください';
  end if;
  if pg_catalog.char_length(v_name) not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 組織名は 1〜100 文字で入力してください';
  end if;
  if p_organization_type = 'master_dealer' and p_parent_organization_id is not null then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 総代理店には直属の組織を設定できません';
  end if;
  if p_parent_organization_id is not null and not exists (
    select 1 from public.organizations o
     where o.id = p_parent_organization_id and o.organization_type = 'master_dealer' and o.status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 直属の総代理店が見つかりません（停止中の総代理店は選べません）';
  end if;

  loop
    v_code := case p_organization_type when 'master_dealer' then 'MD-' else 'D-' end
      || pg_catalog.lpad(pg_catalog.nextval('public.organization_code_seq')::text, 4, '0');
    exit when not exists (select 1 from public.organizations o where o.code = v_code);
  end loop;

  insert into public.organizations (code, name, organization_type, parent_organization_id)
  values (v_code, v_name, p_organization_type, p_parent_organization_id)
  returning id into v_id;

  perform public.write_organization_audit('organization_create', 'organization', v_id,
    '組織を登録：' || v_name,
    null,
    pg_catalog.jsonb_build_object('code', v_code, 'name', v_name, 'organization_type', p_organization_type,
      'parent_organization_id', p_parent_organization_id));
  return v_id;
end;
$$;

create function public.update_organization(
  p_organization_id uuid,
  p_name text,
  p_parent_organization_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations%rowtype;
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 組織を変更できるのは本部の管理者だけです';
  end if;
  select * into v_org from public.organizations o where o.id = p_organization_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 組織が見つかりません';
  end if;
  if v_org.organization_type not in ('master_dealer', 'dealer') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 本部の組織はここでは変更できません';
  end if;
  if pg_catalog.char_length(v_name) not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 組織名は 1〜100 文字で入力してください';
  end if;
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 状態は「有効」か「停止」を選んでください';
  end if;
  if v_org.organization_type = 'master_dealer' and p_parent_organization_id is not null then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 総代理店には直属の組織を設定できません';
  end if;
  if p_parent_organization_id is not null
     and p_parent_organization_id is distinct from v_org.parent_organization_id
     and not exists (
       select 1 from public.organizations o
        where o.id = p_parent_organization_id and o.organization_type = 'master_dealer' and o.status = 'active'
     ) then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 直属の総代理店が見つかりません（停止中の総代理店は選べません）';
  end if;
  if v_org.organization_type = 'master_dealer' and p_status = 'inactive' and v_org.status = 'active' and exists (
    select 1 from public.organizations c where c.parent_organization_id = v_org.id and c.status = 'active'
  ) then
    raise exception using errcode = 'P0001',
      message = 'VALIDATION: 有効な配下の代理店がある総代理店は停止できません（先に代理店の直属の総代理店を変えてください）';
  end if;

  update public.organizations o
     set name = v_name,
         parent_organization_id = p_parent_organization_id,
         status = p_status,
         updated_at = now()
   where o.id = v_org.id;

  perform public.write_organization_audit('organization_update', 'organization', v_org.id,
    '組織を変更：' || v_name,
    pg_catalog.jsonb_build_object('name', v_org.name, 'parent_organization_id', v_org.parent_organization_id, 'status', v_org.status),
    pg_catalog.jsonb_build_object('name', v_name, 'parent_organization_id', p_parent_organization_id, 'status', p_status));
end;
$$;

-- ---------- 招待（本部、またはその組織の管理者） ----------

create function public.invite_organization_member(p_organization_id uuid, p_email text, p_member_role text)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_org public.organizations%rowtype;
  v_token text;
  v_id uuid;
  v_expires timestamptz := pg_catalog.clock_timestamp() + interval '7 days';
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  select * into v_org from public.organizations o where o.id = p_organization_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 組織が見つかりません';
  end if;
  if not (public.is_admin() or public.is_organization_manager(v_org.id)) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 招待できるのは、本部とその組織の管理者だけです';
  end if;
  if v_org.organization_type not in ('master_dealer', 'dealer') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 招待できるのは総代理店・代理店の組織だけです';
  end if;
  if v_org.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 停止中の組織には招待できません';
  end if;
  if p_member_role is null or p_member_role not in ('admin', 'editor') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 役割は「管理者」か「担当者」を選んでください';
  end if;
  if pg_catalog.length(v_email) not between 3 and 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: メールアドレスの形式を確かめてください';
  end if;
  if exists (
    select 1
      from public.organization_memberships m
      join public.profiles p on p.id = m.profile_id
     where m.organization_id = v_org.id and m.status = 'active' and pg_catalog.lower(p.email) = v_email
  ) then
    raise exception using errcode = 'P0001', message = 'CONFLICT: このメールアドレスの方は、すでにこの組織に所属しています';
  end if;

  -- 同じ組織・メールアドレスの未使用の招待は取り消して、新しく発行し直す（リンクを紛失したときなど）
  update public.organization_invitations i
     set revoked_at = pg_catalog.clock_timestamp(), revoked_by = v_actor
   where i.organization_id = v_org.id and i.email = v_email and i.accepted_at is null and i.revoked_at is null;

  -- gen_random_uuid() は暗号論的な乱数（2 つで 244 ビット）
  v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', '');
  insert into public.organization_invitations (organization_id, email, member_role, token_hash, invited_by, expires_at)
  values (v_org.id, v_email, p_member_role,
          pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')), 'hex'),
          v_actor, v_expires)
  returning id into v_id;

  perform public.write_organization_audit('organization_invite', 'organization', v_org.id,
    '組織へ招待：' || v_org.name || '（' || case p_member_role when 'admin' then '管理者' else '担当者' end || '）',
    null,
    pg_catalog.jsonb_build_object('invitation_id', v_id, 'email', v_email, 'member_role', p_member_role, 'expires_at', v_expires));

  return query select v_id, v_token, v_expires;
end;
$$;

create function public.revoke_organization_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.organization_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  select * into v_inv from public.organization_invitations i where i.id = p_invitation_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 招待が見つかりません';
  end if;
  if not (public.is_admin() or public.is_organization_manager(v_inv.organization_id)) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 招待を取り消せるのは、本部とその組織の管理者だけです';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'VALIDATION: この招待はすでに使われたか、取り消されています';
  end if;
  update public.organization_invitations i
     set revoked_at = pg_catalog.clock_timestamp(), revoked_by = auth.uid()
   where i.id = v_inv.id;
  perform public.write_organization_audit('organization_invite_revoke', 'organization', v_inv.organization_id,
    '組織への招待を取り消し', pg_catalog.jsonb_build_object('invitation_id', v_inv.id, 'email', v_inv.email), null);
end;
$$;

-- ---------- 招待を受ける（招待されたメールアドレスでログインした本人だけ） ----------

create function public.accept_organization_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_inv public.organization_invitations%rowtype;
  v_org public.organizations%rowtype;
  v_email text;
  v_role_code text;
  v_new_role_code text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 招待のリンクが正しくありません';
  end if;
  select * into v_inv
    from public.organization_invitations i
   where i.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: 招待が見つかりません。リンクを確かめてください';
  end if;
  if v_inv.revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'VALIDATION: この招待は取り消されています';
  end if;
  if v_inv.accepted_at is not null then
    raise exception using errcode = 'P0001', message = 'VALIDATION: この招待はすでに使われています';
  end if;
  if v_inv.expires_at < pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 招待の有効期限が切れています。招待した方に、もう一度送ってもらってください';
  end if;

  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v_actor;
  if v_email is distinct from v_inv.email then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 招待されたメールアドレスでログインしてください';
  end if;

  select * into v_org from public.organizations o where o.id = v_inv.organization_id for share;
  if v_org.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 組織が停止中のため参加できません';
  end if;

  select p.role_code into v_role_code from public.profiles p where p.id = v_actor for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: アカウントが見つかりません';
  end if;
  if v_role_code = 'admin' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 本部の管理者は、代理店・総代理店に所属できません';
  end if;
  if exists (
    select 1 from public.organization_memberships m
     where m.profile_id = v_actor and m.status = 'active' and m.organization_id = v_org.id
  ) then
    raise exception using errcode = 'P0001', message = 'CONFLICT: すでにこの組織に所属しています';
  end if;
  if exists (
    select 1 from public.organization_memberships m where m.profile_id = v_actor and m.status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'CONFLICT: ほかの組織に所属しています。本部にご相談ください';
  end if;

  insert into public.organization_memberships (organization_id, profile_id, member_role, status, is_primary)
  values (v_org.id, v_actor, v_inv.member_role, 'active', true)
  on conflict (organization_id, profile_id) do update
     set member_role = excluded.member_role, status = 'active', is_primary = true, updated_at = now();

  v_new_role_code := case v_org.organization_type when 'master_dealer' then 'master_dealer' else 'dealer' end;
  update public.profiles p set role_code = v_new_role_code where p.id = v_actor and p.role_code is distinct from v_new_role_code;

  update public.organization_invitations i
     set accepted_at = pg_catalog.clock_timestamp(), accepted_by = v_actor
   where i.id = v_inv.id;

  perform public.write_organization_audit('organization_join', 'organization', v_org.id,
    '組織に参加：' || v_org.name || '（' || case v_inv.member_role when 'admin' then '管理者' else '担当者' end || '）',
    pg_catalog.jsonb_build_object('role_code', v_role_code),
    pg_catalog.jsonb_build_object('invitation_id', v_inv.id, 'member_role', v_inv.member_role, 'role_code', v_new_role_code));
  return v_org.id;
end;
$$;

-- ---------- メンバーの役割・所属（本部、またはその組織の管理者） ----------

create function public.set_organization_member_role(p_membership_id uuid, p_member_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.organization_memberships%rowtype;
  v_org public.organizations%rowtype;
  v_managers integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  select * into v_member from public.organization_memberships m where m.id = p_membership_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: メンバーが見つかりません';
  end if;
  select * into v_org from public.organizations o where o.id = v_member.organization_id;
  if v_org.organization_type not in ('master_dealer', 'dealer') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 本部の組織の役割はここでは変更できません';
  end if;
  if not (public.is_admin() or public.is_organization_manager(v_org.id)) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 役割を変更できるのは、本部とその組織の管理者だけです';
  end if;
  if p_member_role is null or p_member_role not in ('admin', 'editor') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 役割は「管理者」か「担当者」を選んでください';
  end if;

  -- 管理者が 0 人になる変更を、同時に実行されても防ぐため、その組織の有効な管理者の行をまとめてロックする
  perform 1 from public.organization_memberships m
   where m.organization_id = v_org.id and m.status = 'active' and m.member_role in ('owner', 'admin')
   for update;
  select * into v_member from public.organization_memberships m where m.id = p_membership_id for update;
  -- ロックを待つ間に自分が管理者でなくなった場合も止める（同時に担当者へ変えられたときなど）
  if not (public.is_admin() or public.is_organization_manager(v_org.id)) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 管理者ではなくなったため、この操作はできません';
  end if;
  if v_member.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 所属を外れているメンバーの役割は変えられません';
  end if;
  if v_member.member_role in ('owner', 'admin') and p_member_role = 'editor' then
    select count(*) into v_managers from public.organization_memberships m
     where m.organization_id = v_org.id and m.status = 'active' and m.member_role in ('owner', 'admin');
    if v_managers <= 1 then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 管理者が 1 人もいなくなるため、この変更はできません';
    end if;
  end if;
  if v_member.member_role = p_member_role then
    return;
  end if;

  update public.organization_memberships m set member_role = p_member_role, updated_at = now() where m.id = v_member.id;
  perform public.write_organization_audit('organization_member_role', 'organization', v_org.id,
    '組織のメンバーの役割を変更：' || v_org.name,
    pg_catalog.jsonb_build_object('membership_id', v_member.id, 'profile_id', v_member.profile_id, 'member_role', v_member.member_role),
    pg_catalog.jsonb_build_object('membership_id', v_member.id, 'profile_id', v_member.profile_id, 'member_role', p_member_role));
end;
$$;

create function public.deactivate_organization_member(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.organization_memberships%rowtype;
  v_org public.organizations%rowtype;
  v_managers integer;
  v_role_code text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  select * into v_member from public.organization_memberships m where m.id = p_membership_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'NOT_FOUND: メンバーが見つかりません';
  end if;
  select * into v_org from public.organizations o where o.id = v_member.organization_id;
  if v_org.organization_type not in ('master_dealer', 'dealer') then
    raise exception using errcode = 'P0001', message = 'VALIDATION: 本部の組織の所属はここでは変更できません';
  end if;
  if not (public.is_admin() or public.is_organization_manager(v_org.id)) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 所属を外せるのは、本部とその組織の管理者だけです';
  end if;

  perform 1 from public.organization_memberships m
   where m.organization_id = v_org.id and m.status = 'active' and m.member_role in ('owner', 'admin')
   for update;
  select * into v_member from public.organization_memberships m where m.id = p_membership_id for update;
  -- ロックを待つ間に自分が管理者でなくなった場合も止める（同時に担当者へ変えられたときなど）
  if not (public.is_admin() or public.is_organization_manager(v_org.id)) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 管理者ではなくなったため、この操作はできません';
  end if;
  if v_member.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'VALIDATION: このメンバーはすでに所属を外れています';
  end if;
  if v_member.member_role in ('owner', 'admin') then
    select count(*) into v_managers from public.organization_memberships m
     where m.organization_id = v_org.id and m.status = 'active' and m.member_role in ('owner', 'admin');
    if v_managers <= 1 then
      raise exception using errcode = 'P0001', message = 'VALIDATION: 管理者が 1 人もいなくなるため、所属を外せません';
    end if;
  end if;

  update public.organization_memberships m
     set status = 'inactive', is_primary = false, updated_at = now()
   where m.id = v_member.id;
  -- 代理店・総代理店の利用者は、所属を外れたら通常の会員に戻す（本部の管理者には触れない）
  select p.role_code into v_role_code from public.profiles p where p.id = v_member.profile_id for update;
  update public.profiles p set role_code = 'customer'
   where p.id = v_member.profile_id and p.role_code in ('dealer', 'master_dealer');

  perform public.write_organization_audit('organization_member_remove', 'organization', v_org.id,
    '組織のメンバーの所属を外す：' || v_org.name,
    pg_catalog.jsonb_build_object('membership_id', v_member.id, 'profile_id', v_member.profile_id,
      'member_role', v_member.member_role, 'role_code', v_role_code),
    pg_catalog.jsonb_build_object('membership_id', v_member.id, 'status', 'inactive'));
end;
$$;

-- ---------- 読み取り ----------

-- 組織の一覧（本部だけ。有効なメンバー数・管理者数・未使用の招待数つき）
create function public.list_organizations_for_admin()
returns table (
  id uuid,
  code text,
  name text,
  organization_type text,
  status text,
  parent_organization_id uuid,
  parent_name text,
  active_members integer,
  active_managers integer,
  open_invitations integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 組織の一覧は本部だけが見られます';
  end if;
  return query
    select o.id, o.code, o.name, o.organization_type, o.status, o.parent_organization_id, p.name,
           (select count(*)::integer from public.organization_memberships m where m.organization_id = o.id and m.status = 'active'),
           (select count(*)::integer from public.organization_memberships m
             where m.organization_id = o.id and m.status = 'active' and m.member_role in ('owner', 'admin')),
           (select count(*)::integer from public.organization_invitations i
             where i.organization_id = o.id and i.accepted_at is null and i.revoked_at is null
               and i.expires_at > pg_catalog.clock_timestamp()),
           o.created_at
      from public.organizations o
      left join public.organizations p on p.id = o.parent_organization_id
     order by case o.organization_type when 'headquarters' then 0 when 'master_dealer' then 1 else 2 end,
              coalesce(p.name, o.name), o.organization_type desc, o.name;
end;
$$;

-- 自分の所属（有効な所属は 1 つ）
create function public.get_my_organization()
returns table (
  organization_id uuid,
  code text,
  name text,
  organization_type text,
  status text,
  parent_organization_id uuid,
  parent_name text,
  membership_id uuid,
  member_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.code, o.name, o.organization_type, o.status, o.parent_organization_id, p.name, m.id, m.member_role
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    left join public.organizations p on p.id = o.parent_organization_id
   where m.profile_id = auth.uid() and m.status = 'active'
   limit 1;
$$;

-- 組織のメンバー（本部と、その組織の有効なメンバー。メールアドレスは本部と管理者にだけ返す）
create function public.list_organization_members(p_organization_id uuid)
returns table (
  membership_id uuid,
  profile_id uuid,
  full_name text,
  email text,
  member_role text,
  status text,
  joined_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_see_email boolean := public.is_admin() or public.is_organization_manager(p_organization_id);
begin
  if not (
    v_can_see_email
    or exists (
      select 1 from public.organization_memberships m
       where m.organization_id = p_organization_id and m.profile_id = auth.uid() and m.status = 'active'
    )
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: この組織のメンバーは見られません';
  end if;
  return query
    select m.id, m.profile_id, p.full_name, case when v_can_see_email then p.email end,
           m.member_role, m.status, m.created_at, m.updated_at
      from public.organization_memberships m
      join public.profiles p on p.id = m.profile_id
     where m.organization_id = p_organization_id
       and (v_can_see_email or m.status = 'active')
     order by case m.status when 'active' then 0 else 1 end,
              case when m.member_role in ('owner', 'admin') then 0 else 1 end,
              p.full_name, m.created_at;
end;
$$;

-- 組織への招待（本部と、その組織の管理者。鍵は返さない）
create function public.list_organization_invitations(p_organization_id uuid)
returns table (
  invitation_id uuid,
  email text,
  member_role text,
  invited_by_name text,
  created_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.is_organization_manager(p_organization_id)) then
    raise exception using errcode = '42501', message = 'FORBIDDEN: 招待は、本部とその組織の管理者だけが見られます';
  end if;
  return query
    select i.id, i.email, i.member_role, p.full_name, i.created_at, i.expires_at, i.accepted_at, i.revoked_at
      from public.organization_invitations i
      left join public.profiles p on p.id = i.invited_by
     where i.organization_id = p_organization_id
     order by i.created_at desc
     limit 50;
end;
$$;

-- 招待のリンクを開いた人に、どの組織への招待かを見せる（受ける前の確認。招待先のメールアドレスは伏せる）
create function public.get_organization_invitation(p_token text)
returns table (
  organization_name text,
  organization_type text,
  member_role text,
  email_hint text,
  expires_at timestamptz,
  state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.organization_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED: ログインが必要です';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  select * into v_inv
    from public.organization_invitations i
   where i.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    return;
  end if;
  return query
    select o.name, o.organization_type, v_inv.member_role,
           pg_catalog.left(v_inv.email, 1) || '…@' || pg_catalog.split_part(v_inv.email, '@', 2),
           v_inv.expires_at,
           case
             when v_inv.revoked_at is not null then 'revoked'
             when v_inv.accepted_at is not null then 'accepted'
             when v_inv.expires_at < pg_catalog.clock_timestamp() then 'expired'
             when o.status <> 'active' then 'organization_inactive'
             else 'open'
           end
      from public.organizations o
     where o.id = v_inv.organization_id;
end;
$$;

-- ---------- 所有者と実行権限 ----------

alter function public.validate_organization_parent() owner to postgres;
alter function public.is_organization_manager(uuid) owner to postgres;
alter function public.write_organization_audit(text, text, uuid, text, jsonb, jsonb) owner to postgres;
alter function public.create_organization(text, text, uuid) owner to postgres;
alter function public.update_organization(uuid, text, uuid, text) owner to postgres;
alter function public.invite_organization_member(uuid, text, text) owner to postgres;
alter function public.revoke_organization_invitation(uuid) owner to postgres;
alter function public.accept_organization_invitation(text) owner to postgres;
alter function public.set_organization_member_role(uuid, text) owner to postgres;
alter function public.deactivate_organization_member(uuid) owner to postgres;
alter function public.list_organizations_for_admin() owner to postgres;
alter function public.get_my_organization() owner to postgres;
alter function public.list_organization_members(uuid) owner to postgres;
alter function public.list_organization_invitations(uuid) owner to postgres;
alter function public.get_organization_invitation(text) owner to postgres;

revoke all on function public.validate_organization_parent() from public, anon, authenticated, service_role;
revoke all on function public.write_organization_audit(text, text, uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.is_organization_manager(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_organization(text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_organization(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.invite_organization_member(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.revoke_organization_invitation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.accept_organization_invitation(text) from public, anon, authenticated, service_role;
revoke all on function public.set_organization_member_role(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.deactivate_organization_member(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_organizations_for_admin() from public, anon, authenticated, service_role;
revoke all on function public.get_my_organization() from public, anon, authenticated, service_role;
revoke all on function public.list_organization_members(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_organization_invitations(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_organization_invitation(text) from public, anon, authenticated, service_role;

grant execute on function public.is_organization_manager(uuid) to authenticated;
grant execute on function public.create_organization(text, text, uuid) to authenticated;
grant execute on function public.update_organization(uuid, text, uuid, text) to authenticated;
grant execute on function public.invite_organization_member(uuid, text, text) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid) to authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
grant execute on function public.set_organization_member_role(uuid, text) to authenticated;
grant execute on function public.deactivate_organization_member(uuid) to authenticated;
grant execute on function public.list_organizations_for_admin() to authenticated;
grant execute on function public.get_my_organization() to authenticated;
grant execute on function public.list_organization_members(uuid) to authenticated;
grant execute on function public.list_organization_invitations(uuid) to authenticated;
grant execute on function public.get_organization_invitation(text) to authenticated;

-- ---------- postconditions ----------

do $postcondition$
declare
  v_fn record;
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.organizations'::regclass and tgname = 'organizations_parent_validate' and not tgisinternal) then
    raise exception 'POSTCONDITION: organizations_parent_validate trigger is missing';
  end if;
  if to_regclass('public.organization_memberships_one_active_idx') is null then
    raise exception 'POSTCONDITION: one active membership per profile is not enforced';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.organization_invitations'::regclass) then
    raise exception 'POSTCONDITION: organization_invitations RLS is not enabled';
  end if;
  if has_table_privilege('anon', 'public.organization_invitations', 'SELECT')
     or has_table_privilege('authenticated', 'public.organization_invitations', 'SELECT')
     or has_table_privilege('authenticated', 'public.organization_invitations', 'INSERT')
     or has_table_privilege('authenticated', 'public.organization_invitations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.organization_invitations', 'DELETE')
     or has_table_privilege('service_role', 'public.organization_invitations', 'SELECT') then
    raise exception 'POSTCONDITION: application roles must not access organization_invitations directly';
  end if;
  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner_name, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'validate_organization_parent', 'is_organization_manager', 'write_organization_audit',
         'create_organization', 'update_organization', 'invite_organization_member', 'revoke_organization_invitation',
         'accept_organization_invitation', 'set_organization_member_role', 'deactivate_organization_member',
         'list_organizations_for_admin', 'get_my_organization', 'list_organization_members',
         'list_organization_invitations', 'get_organization_invitation'
       )
  loop
    if v_fn.prosecdef is distinct from true or v_fn.owner_name <> 'postgres' then
      raise exception 'POSTCONDITION: % must be postgres-owned SECURITY DEFINER', v_fn.proname;
    end if;
    if not coalesce(v_fn.proconfig, '{}'::text[]) @> array['search_path=""']::text[] then
      raise exception 'POSTCONDITION: % search_path must be empty', v_fn.proname;
    end if;
    if has_function_privilege('anon', v_fn.oid, 'EXECUTE') or has_function_privilege('service_role', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must not be executable by anon / service_role', v_fn.proname;
    end if;
    if v_fn.proname in ('validate_organization_parent', 'write_organization_audit') then
      if has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'POSTCONDITION: % must not be executable by authenticated', v_fn.proname;
      end if;
    elsif not has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception 'POSTCONDITION: % must be executable by authenticated', v_fn.proname;
    end if;
  end loop;
end;
$postcondition$;

commit;
