-- 代理店・総代理店の組織とアカウント（20261111110000）の実行時検査。使い捨て DB 専用。最後に rollback する。
begin;

create temp table _org_result (seq serial, step text, expected text, actual text, ok boolean) on commit drop;
grant all on _org_result to public;
create temp table _org_token (name text primary key, token text) on commit drop;
grant all on _org_token to public;

create function pg_temp.org_run_as(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $fn$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims',
    case when p_sub is null then json_build_object('role', p_role)::text
         else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v_out, '(null)');
end;
$fn$;

create function pg_temp.org_try_super(p_sql text) returns text
language plpgsql as $fn$
declare
  v_out text;
begin
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := format('ERROR %s: %s', sqlstate, sqlerrm);
  end;
  return coalesce(v_out, '(null)');
end;
$fn$;

create function pg_temp.org_expect_eq(p_step text, p_expected text, p_actual text) returns void
language sql as $fn$
  insert into _org_result (step, expected, actual, ok) values (p_step, p_expected, p_actual, p_actual = p_expected);
$fn$;

create function pg_temp.org_expect_denied(p_step text, p_code text, p_actual text) returns void
language sql as $fn$
  insert into _org_result (step, expected, actual, ok)
  values (p_step, '拒否（' || p_code || '）', p_actual, p_actual like 'ERROR ' || p_code || ':%');
$fn$;

-- 招待を発行して鍵を控える（鍵は発行時にしか返らない）
create function pg_temp.org_invite(p_name text, p_actor uuid, p_org uuid, p_email text, p_role text) returns text
language plpgsql as $fn$
declare
  v_out text;
begin
  v_out := pg_temp.org_run_as('authenticated', p_actor,
    format('select token from public.invite_organization_member(%L, %L, %L)', p_org, p_email, p_role));
  if v_out ~ '^[0-9a-f]{64}$' then
    insert into _org_token (name, token) values (p_name, v_out)
    on conflict (name) do update set token = excluded.token;
    return 'token';
  end if;
  return v_out;
end;
$fn$;

create function pg_temp.org_token(p_name text) returns text
language sql as $fn$ select token from _org_token where name = p_name $fn$;

do $test$
declare
  u_admin constant uuid := '20000000-0000-4000-8000-000000000001';
  u_mgr constant uuid := '20000000-0000-4000-8000-000000000002';
  u_staff constant uuid := '20000000-0000-4000-8000-000000000003';
  u_other constant uuid := '20000000-0000-4000-8000-000000000004';
  u_mgr2 constant uuid := '20000000-0000-4000-8000-000000000005';
  u_admin2 constant uuid := '20000000-0000-4000-8000-000000000006';
  u_md_mgr constant uuid := '20000000-0000-4000-8000-000000000007';
  u_later constant uuid := '20000000-0000-4000-8000-000000000008';
  u_unconfirmed constant uuid := '20000000-0000-4000-8000-000000000009';
  v_md uuid;
  v_dealer uuid;
  v_dealer2 uuid;
  v_out text;
  v_membership uuid;
  v_audit_before bigint;
  i integer;
begin
  set local session_replication_role = replica;
  -- 招待を受けられるのはメールアドレスの確認が済んだアカウントだけ（u_unconfirmed は確認前）
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
  values
    (u_admin, 'org-admin@runtime.invalid', '{}'::jsonb, now()),
    (u_mgr, 'org-manager@runtime.invalid', '{}'::jsonb, now()),
    (u_staff, 'org-staff@runtime.invalid', '{}'::jsonb, now()),
    (u_other, 'org-other@runtime.invalid', '{}'::jsonb, now()),
    (u_mgr2, 'org-manager2@runtime.invalid', '{}'::jsonb, now()),
    (u_admin2, 'org-admin2@runtime.invalid', '{}'::jsonb, now()),
    (u_md_mgr, 'org-md-manager@runtime.invalid', '{}'::jsonb, now()),
    (u_later, 'org-later@runtime.invalid', '{}'::jsonb, now()),
    (u_unconfirmed, 'org-unconfirmed@runtime.invalid', '{}'::jsonb, null);
  insert into public.profiles (id, email, full_name, role_code)
  values
    (u_admin, 'org-admin@runtime.invalid', '本部 管理者', 'admin'),
    (u_mgr, 'org-manager@runtime.invalid', '代理店 管理者', 'customer'),
    (u_staff, 'org-staff@runtime.invalid', '代理店 担当者', 'customer'),
    (u_other, 'org-other@runtime.invalid', '別の 会員', 'customer'),
    (u_mgr2, 'org-manager2@runtime.invalid', '代理店 管理者2', 'customer'),
    (u_admin2, 'org-admin2@runtime.invalid', '本部 管理者2', 'admin'),
    (u_md_mgr, 'org-md-manager@runtime.invalid', '総代理店 管理者', 'customer'),
    (u_later, 'org-later@runtime.invalid', '停止後 招待', 'customer'),
    (u_unconfirmed, 'org-unconfirmed@runtime.invalid', '確認前 会員', 'customer');
  set local session_replication_role = origin;

  select count(*) into v_audit_before from public.audit_logs where entity = 'organization';

  -- ---------- 組織の登録（本部だけ） ----------
  perform pg_temp.org_expect_denied('24-1 未ログインは組織を登録できない', '42501',
    pg_temp.org_run_as('anon', null, $q$ select public.create_organization('dealer', '検査代理店', null)::text $q$));
  perform pg_temp.org_expect_denied('24-2 会員は組織を登録できない', '42501',
    pg_temp.org_run_as('authenticated', u_other, $q$ select public.create_organization('dealer', '検査代理店', null)::text $q$));

  v_out := pg_temp.org_run_as('authenticated', u_admin, $q$ select public.create_organization('master_dealer', '検査総代理店', null)::text $q$);
  perform pg_temp.org_expect_eq('24-3 本部は総代理店を登録できる', 'uuid', case when v_out ~ '^[0-9a-f-]{36}$' then 'uuid' else v_out end);
  v_md := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;

  v_out := pg_temp.org_run_as('authenticated', u_admin, format($q$ select public.create_organization('dealer', '検査代理店', %L)::text $q$, v_md));
  perform pg_temp.org_expect_eq('24-4 本部は直属の総代理店つきで代理店を登録できる', 'uuid', case when v_out ~ '^[0-9a-f-]{36}$' then 'uuid' else v_out end);
  v_dealer := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;
  perform pg_temp.org_expect_eq('24-5 代理店の直属の総代理店と組織コードが保存される', 'true/D-',
    (select (o.parent_organization_id = v_md)::text || '/' || left(o.code, 2) from public.organizations o where o.id = v_dealer));

  perform pg_temp.org_expect_denied('24-6 代理店の直属には代理店を選べない', 'P0001',
    pg_temp.org_run_as('authenticated', u_admin, format($q$ select public.create_organization('dealer', '検査代理店B', %L)::text $q$, v_dealer)));
  perform pg_temp.org_expect_denied('24-7 総代理店には直属の組織を設定できない', 'P0001',
    pg_temp.org_run_as('authenticated', u_admin, format($q$ select public.create_organization('master_dealer', '検査総代理店B', %L)::text $q$, v_md)));
  perform pg_temp.org_expect_denied('24-8 表を直接書き換えても、代理店の直属に代理店は入らない（トリガー）', 'P0001',
    pg_temp.org_try_super(format($q$ update public.organizations set parent_organization_id = %L where id = %L returning id::text $q$, v_dealer, v_dealer)));

  v_out := pg_temp.org_run_as('authenticated', u_admin, $q$ select public.create_organization('dealer', '検査代理店2', null)::text $q$);
  v_dealer2 := case when v_out ~ '^[0-9a-f-]{36}$' then v_out::uuid end;

  -- ---------- 招待と参加 ----------
  perform pg_temp.org_expect_eq('24-9 本部は代理店の最初の管理者を招待できる（鍵は 64 桁）', 'token',
    pg_temp.org_invite('mgr', u_admin, v_dealer, 'Org-Manager@Runtime.invalid', 'admin'));
  perform pg_temp.org_expect_eq('24-10 招待には鍵そのものは残らず、ハッシュだけが残る', '0/1',
    (select count(*)::text from public.organization_invitations i where i.token_hash = pg_temp.org_token('mgr')) || '/' ||
    (select count(*)::text from public.organization_invitations i where i.token_hash = encode(sha256(convert_to(pg_temp.org_token('mgr'), 'UTF8')), 'hex')));
  perform pg_temp.org_expect_denied('24-11 管理者でない会員は招待できない', '42501',
    pg_temp.org_run_as('authenticated', u_other, format($q$ select token from public.invite_organization_member(%L, 'x@runtime.invalid', 'editor') $q$, v_dealer)));
  perform pg_temp.org_expect_denied('24-12 招待されたメールアドレスと違う人は受けられない', '42501',
    pg_temp.org_run_as('authenticated', u_other, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('mgr'))));
  perform pg_temp.org_expect_eq('24-13 招待の確認では組織名と状態を返し、メールアドレスは伏せる', '検査代理店/admin/o…@runtime.invalid/open',
    pg_temp.org_run_as('authenticated', u_mgr, format($q$ select organization_name || '/' || member_role || '/' || email_hint || '/' || state from public.get_organization_invitation(%L) $q$, pg_temp.org_token('mgr'))));

  v_out := pg_temp.org_run_as('authenticated', u_mgr, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('mgr')));
  perform pg_temp.org_expect_eq('24-14 招待されたメールアドレスの本人は参加でき、代理店の管理者になる', v_dealer::text || '/admin/dealer',
    v_out || '/' || coalesce((select m.member_role from public.organization_memberships m where m.profile_id = u_mgr and m.status = 'active'), '-')
      || '/' || (select p.role_code from public.profiles p where p.id = u_mgr));
  perform pg_temp.org_expect_denied('24-15 同じ招待は 2 回使えない', 'P0001',
    pg_temp.org_run_as('authenticated', u_mgr, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('mgr'))));

  perform pg_temp.org_expect_eq('24-16 代理店の管理者は自社に担当者を招待できる', 'token',
    pg_temp.org_invite('staff', u_mgr, v_dealer, 'org-staff@runtime.invalid', 'editor'));
  perform pg_temp.org_expect_denied('24-17 代理店の管理者は、ほかの組織には招待できない', '42501',
    pg_temp.org_run_as('authenticated', u_mgr, format($q$ select token from public.invite_organization_member(%L, 'y@runtime.invalid', 'editor') $q$, v_md)));
  -- 呼び出しと確認は別の文にする（同じ文の中では、関数を呼ぶ前の状態が見えるため）
  v_out := pg_temp.org_run_as('authenticated', u_staff, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('staff')));
  perform pg_temp.org_expect_eq('24-18 担当者として参加すると、利用者の種類は代理店・役割は担当者', v_dealer::text || '/editor/dealer',
    v_out || '/' || coalesce((select m.member_role from public.organization_memberships m where m.profile_id = u_staff and m.status = 'active'), '-')
      || '/' || (select p.role_code from public.profiles p where p.id = u_staff));
  perform pg_temp.org_expect_denied('24-19 担当者は招待できない', '42501',
    pg_temp.org_run_as('authenticated', u_staff, format($q$ select token from public.invite_organization_member(%L, 'z@runtime.invalid', 'editor') $q$, v_dealer)));
  perform pg_temp.org_expect_eq('24-20 担当者にはメンバーのメールアドレスを見せず、管理者には見せる', '0/2',
    pg_temp.org_run_as('authenticated', u_staff, format($q$ select count(email)::text from public.list_organization_members(%L) $q$, v_dealer))
      || '/' || pg_temp.org_run_as('authenticated', u_mgr, format($q$ select count(email)::text from public.list_organization_members(%L) $q$, v_dealer)));
  perform pg_temp.org_expect_denied('24-21 担当者は招待の一覧を見られない', '42501',
    pg_temp.org_run_as('authenticated', u_staff, format($q$ select count(*)::text from public.list_organization_invitations(%L) $q$, v_dealer)));
  perform pg_temp.org_expect_denied('24-22 ほかの組織の人は、メンバーを見られない', '42501',
    pg_temp.org_run_as('authenticated', u_other, format($q$ select count(*)::text from public.list_organization_members(%L) $q$, v_dealer)));
  perform pg_temp.org_expect_eq('24-23 自分の所属（組織・直属の総代理店・役割）を確認できる', '検査代理店/検査総代理店/admin',
    pg_temp.org_run_as('authenticated', u_mgr, $q$ select name || '/' || coalesce(parent_name, '-') || '/' || member_role from public.get_my_organization() $q$));

  -- ---------- 管理者が 0 人にならない ----------
  select m.id into v_membership from public.organization_memberships m where m.profile_id = u_mgr and m.status = 'active';
  perform pg_temp.org_expect_denied('24-24 最後の管理者を担当者にはできない', 'P0001',
    pg_temp.org_run_as('authenticated', u_mgr, format($q$ select public.set_organization_member_role(%L, 'editor')::text $q$, v_membership)));
  perform pg_temp.org_expect_denied('24-25 最後の管理者の所属は外せない', 'P0001',
    pg_temp.org_run_as('authenticated', u_mgr, format($q$ select public.deactivate_organization_member(%L)::text $q$, v_membership)));
  perform pg_temp.org_invite('mgr2', u_mgr, v_dealer, 'org-manager2@runtime.invalid', 'admin');
  perform pg_temp.org_run_as('authenticated', u_mgr2, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('mgr2')));
  v_out := pg_temp.org_run_as('authenticated', u_mgr2, format($q$ select public.set_organization_member_role(%L, 'editor')::text $q$, v_membership));
  perform pg_temp.org_expect_eq('24-26 管理者は複数人にでき、管理者が 2 人なら 1 人を担当者にできる', 'ok/editor',
    coalesce(nullif(v_out, ''), 'ok') || '/' || (select m.member_role from public.organization_memberships m where m.id = v_membership));
  perform pg_temp.org_run_as('authenticated', u_mgr2, format($q$ select public.set_organization_member_role(%L, 'admin')::text $q$, v_membership));

  select m.id into v_membership from public.organization_memberships m where m.profile_id = u_staff and m.status = 'active';
  v_out := pg_temp.org_run_as('authenticated', u_mgr, format($q$ select public.deactivate_organization_member(%L)::text $q$, v_membership));
  perform pg_temp.org_expect_eq('24-27 管理者は担当者の所属を外せ、外れた人は通常の会員に戻る', 'ok/inactive/customer',
    coalesce(nullif(v_out, ''), 'ok') || '/' || (select m.status from public.organization_memberships m where m.id = v_membership)
      || '/' || (select p.role_code from public.profiles p where p.id = u_staff));

  -- ---------- 所属は 1 人 1 つ・本部の管理者は所属しない ----------
  perform pg_temp.org_invite('mgr-to-dealer2', u_admin, v_dealer2, 'org-manager@runtime.invalid', 'editor');
  perform pg_temp.org_expect_denied('24-28 ほかの組織に所属している人は、別の組織の招待を受けられない', 'P0001',
    pg_temp.org_run_as('authenticated', u_mgr, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('mgr-to-dealer2'))));
  perform pg_temp.org_invite('admin2', u_admin, v_dealer2, 'org-admin2@runtime.invalid', 'admin');
  perform pg_temp.org_expect_denied('24-29 本部の管理者は代理店に所属できない', 'P0001',
    pg_temp.org_run_as('authenticated', u_admin2, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('admin2'))));

  -- ---------- 期限切れ・取り消し・発行し直し ----------
  perform pg_temp.org_invite('expired', u_admin, v_dealer2, 'org-other@runtime.invalid', 'editor');
  update public.organization_invitations i
     set created_at = clock_timestamp() - interval '8 days', expires_at = clock_timestamp() - interval '1 day'
   where i.token_hash = encode(sha256(convert_to(pg_temp.org_token('expired'), 'UTF8')), 'hex');
  perform pg_temp.org_expect_denied('24-30 期限切れの招待は受けられない', 'P0001',
    pg_temp.org_run_as('authenticated', u_other, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('expired'))));
  perform pg_temp.org_invite('reissue-1', u_admin, v_md, 'org-md-manager@runtime.invalid', 'admin');
  perform pg_temp.org_invite('reissue-2', u_admin, v_md, 'org-md-manager@runtime.invalid', 'admin');
  perform pg_temp.org_expect_denied('24-31 発行し直すと、前の招待は使えなくなる', 'P0001',
    pg_temp.org_run_as('authenticated', u_md_mgr, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('reissue-1'))));
  v_out := pg_temp.org_run_as('authenticated', u_md_mgr, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('reissue-2')));
  perform pg_temp.org_expect_eq('24-32 総代理店の管理者として参加すると、利用者の種類は総代理店', v_md::text || '/master_dealer',
    v_out || '/' || (select p.role_code from public.profiles p where p.id = u_md_mgr));
  perform pg_temp.org_invite('revoked', u_admin, v_dealer2, 'org-other@runtime.invalid', 'editor');
  perform pg_temp.org_run_as('authenticated', u_admin, format($q$ select public.revoke_organization_invitation(%L)::text $q$,
    (select i.id from public.organization_invitations i where i.token_hash = encode(sha256(convert_to(pg_temp.org_token('revoked'), 'UTF8')), 'hex'))));
  perform pg_temp.org_expect_denied('24-33 取り消した招待は受けられない', 'P0001',
    pg_temp.org_run_as('authenticated', u_other, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('revoked'))));

  -- ---------- 組織の停止 ----------
  perform pg_temp.org_expect_denied('24-34 有効な配下の代理店がある総代理店は停止できない', 'P0001',
    pg_temp.org_run_as('authenticated', u_admin, format($q$ select public.update_organization(%L, '検査総代理店', null, 'inactive')::text $q$, v_md)));
  -- 停止の前に、未使用の招待を 1 件残しておく（停止で取り消されることを 24-43・24-49 で確かめる）
  perform pg_temp.org_invite('before-suspend', u_mgr, v_dealer, 'org-later@runtime.invalid', 'editor');
  perform pg_temp.org_run_as('authenticated', u_admin, format($q$ select public.update_organization(%L, '検査代理店', %L, 'inactive')::text $q$, v_dealer, v_md));
  perform pg_temp.org_expect_denied('24-35 停止中の組織では、管理者も招待できない', '42501',
    pg_temp.org_run_as('authenticated', u_mgr, format($q$ select token from public.invite_organization_member(%L, 'w@runtime.invalid', 'editor') $q$, v_dealer)));
  perform pg_temp.org_expect_denied('24-36 組織の変更は本部だけ', '42501',
    pg_temp.org_run_as('authenticated', u_mgr, format($q$ select public.update_organization(%L, '名前変更', %L, 'active')::text $q$, v_dealer, v_md)));

  -- ---------- 表を直接読み書きできない ----------
  perform pg_temp.org_expect_denied('24-37 招待の表は直接読めない', '42501',
    pg_temp.org_run_as('authenticated', u_admin, $q$ select count(*)::text from public.organization_invitations $q$));
  perform pg_temp.org_expect_denied('24-38 所属の表に直接追加できない', '42501',
    pg_temp.org_run_as('authenticated', u_mgr, format($q$ insert into public.organization_memberships (organization_id, profile_id, member_role) values (%L, %L, 'admin') returning id::text $q$, v_dealer2, u_mgr)));
  perform pg_temp.org_expect_denied('24-39 内部の関数（監査ログの書き込み）は利用者から呼べない', '42501',
    pg_temp.org_run_as('authenticated', u_admin, $q$ select public.write_organization_audit('x', 'organization', null, 'x', null, null)::text $q$));

  perform pg_temp.org_expect_eq('24-40 組織・招待・参加・役割・所属の変更は監査ログに残る', 'true',
    ((select count(*) from public.audit_logs where entity = 'organization') - v_audit_before >= 12)::text);

  -- ---------- 組織の停止と再開（2026-11-09 の独立レビューの指摘への対応） ----------
  perform pg_temp.org_expect_eq('24-43 組織を停止すると、メンバーは会員に戻り（所属は残る）、未使用の招待は取り消される',
    'customer/customer/active/revoked',
    (select p.role_code from public.profiles p where p.id = u_mgr) || '/' ||
    (select p.role_code from public.profiles p where p.id = u_mgr2) || '/' ||
    (select m.status from public.organization_memberships m where m.profile_id = u_mgr and m.organization_id = v_dealer) || '/' ||
    (select case when i.revoked_at is not null then 'revoked' else 'open' end from public.organization_invitations i
      where i.token_hash = encode(sha256(convert_to(pg_temp.org_token('before-suspend'), 'UTF8')), 'hex')));
  perform pg_temp.org_expect_denied('24-44 停止中の組織のメンバーは、メンバーの一覧を見られない', '42501',
    pg_temp.org_run_as('authenticated', u_mgr, format($q$ select count(*)::text from public.list_organization_members(%L) $q$, v_dealer)));
  perform pg_temp.org_expect_denied('24-45 停止中の組織のメンバーを、本部の会員一覧から代理店に戻すことはできない', 'P0001',
    pg_temp.org_run_as('authenticated', u_admin, format($q$ update public.profiles set role_code = 'dealer' where id = %L returning role_code $q$, u_mgr)));
  v_out := pg_temp.org_run_as('authenticated', u_admin, format($q$ select public.update_organization(%L, '検査総代理店', null, 'inactive')::text $q$, v_md));
  perform pg_temp.org_expect_eq('24-46 配下の代理店がすべて停止中なら総代理店を停止でき、そのメンバーも会員に戻る', 'ok/customer',
    coalesce(nullif(v_out, ''), 'ok') || '/' || (select p.role_code from public.profiles p where p.id = u_md_mgr));
  perform pg_temp.org_expect_denied('24-47 停止中の総代理店の配下の代理店は、親を変えずに再開できない', 'P0001',
    pg_temp.org_run_as('authenticated', u_admin, format($q$ select public.update_organization(%L, '検査代理店', %L, 'active')::text $q$, v_dealer, v_md)));
  perform pg_temp.org_run_as('authenticated', u_admin, format($q$ select public.update_organization(%L, '検査総代理店', null, 'active')::text $q$, v_md));
  v_out := pg_temp.org_run_as('authenticated', u_admin, format($q$ select public.update_organization(%L, '検査代理店', %L, 'active')::text $q$, v_dealer, v_md));
  perform pg_temp.org_expect_eq('24-48 総代理店・代理店の順に再開すると、メンバーの利用者の種類が戻る', 'ok/dealer/dealer/master_dealer',
    coalesce(nullif(v_out, ''), 'ok') || '/' || (select p.role_code from public.profiles p where p.id = u_mgr)
      || '/' || (select p.role_code from public.profiles p where p.id = u_mgr2)
      || '/' || (select p.role_code from public.profiles p where p.id = u_md_mgr));
  perform pg_temp.org_expect_denied('24-49 停止の前に発行した招待は、再開しても使えない', 'P0001',
    pg_temp.org_run_as('authenticated', u_later, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('before-suspend'))));

  -- ---------- 所属と利用者の種類を合わせる ----------
  perform pg_temp.org_expect_eq('24-50 所属しているメンバーを、本部の会員一覧から会員・本部の管理者に変えることはできない', 'P0001/P0001',
    substr(pg_temp.org_run_as('authenticated', u_admin, format($q$ update public.profiles set role_code = 'customer' where id = %L returning role_code $q$, u_mgr)), 7, 5)
      || '/' || substr(pg_temp.org_run_as('authenticated', u_admin, format($q$ update public.profiles set role_code = 'admin' where id = %L returning role_code $q$, u_mgr)), 7, 5));
  perform pg_temp.org_expect_eq('24-51 所属を外れた人の権限は、これまでどおり本部の会員一覧から変えられる', 'dealer',
    pg_temp.org_run_as('authenticated', u_admin, format($q$ update public.profiles set role_code = 'dealer' where id = %L returning role_code $q$, u_staff)));
  update public.profiles set role_code = 'customer' where id = u_staff;

  -- ---------- 招待：メールアドレスの確認・送りすぎの上限 ----------
  perform pg_temp.org_invite('unconfirmed', u_admin, v_dealer2, 'org-unconfirmed@runtime.invalid', 'editor');
  perform pg_temp.org_expect_denied('24-52 メールアドレスの確認が済んでいないアカウントは、招待を受けられない', '42501',
    pg_temp.org_run_as('authenticated', u_unconfirmed, format($q$ select public.accept_organization_invitation(%L)::text $q$, pg_temp.org_token('unconfirmed'))));
  perform pg_temp.org_invite('rate', u_admin, v_dealer2, 'org-rate@runtime.invalid', 'editor');
  perform pg_temp.org_invite('rate', u_admin, v_dealer2, 'org-rate@runtime.invalid', 'editor');
  perform pg_temp.org_invite('rate', u_admin, v_dealer2, 'org-rate@runtime.invalid', 'editor');
  perform pg_temp.org_expect_denied('24-53 同じメールアドレスへの招待は 24 時間に 3 回まで（本部も同じ）', 'P0001',
    pg_temp.org_invite('rate', u_admin, v_dealer2, 'org-rate@runtime.invalid', 'editor'));
  for i in 1..25 loop
    v_out := pg_temp.org_invite('bulk-' || i, u_mgr, v_dealer, 'org-bulk-' || i || '@runtime.invalid', 'editor');
    exit when v_out <> 'token';
  end loop;
  perform pg_temp.org_expect_eq('24-54 組織の管理者からの招待は、1 つの組織から 24 時間に 20 件まで', 'P0001/20',
    substr(v_out, 7, 5) || '/' || (select count(*)::text from public.organization_invitations i
      where i.organization_id = v_dealer and i.created_at > clock_timestamp() - interval '24 hours'));
  perform pg_temp.org_expect_eq('24-55 本部は、組織ごとの件数の上限に関係なく招待できる', 'token',
    pg_temp.org_invite('bulk-hq', u_admin, v_dealer, 'org-bulk-hq@runtime.invalid', 'editor'));

  -- ---------- 本体マスターの登録・編集は本部の組織だけ（B-2） ----------
  insert into public.organization_memberships (organization_id, profile_id, member_role, status, is_primary)
  select o.id, u_admin2, 'owner', 'active', true
    from public.organizations o
   where o.organization_type = 'headquarters' and o.status = 'active'
   order by o.created_at
   limit 1;
  perform pg_temp.org_expect_eq('24-56 本体マスターを登録・編集できるのは本部の組織だけ（総代理店の管理者は不可）', 'false/42501/true',
    pg_temp.org_run_as('authenticated', u_md_mgr, format($q$ select public.can_create_base_master_for_org(%L)::text $q$, v_md))
      || '/' || substr(pg_temp.org_run_as('authenticated', u_md_mgr,
           format($q$ select public.create_base_master_draft(gen_random_uuid(), %L, '検査本体')::text $q$, v_md)), 7, 5)
      || '/' || pg_temp.org_run_as('authenticated', u_admin2, $q$
           select public.can_create_base_master_for_org(m.organization_id)::text
             from public.organization_memberships m where m.profile_id = auth.uid() and m.status = 'active' $q$));

  -- ---------- 組織の表を読める範囲 ----------
  -- 結果：代理店の行/総代理店の行/別の代理店の行/本部の行があるか/それ以外の行の数
  perform pg_temp.org_expect_eq('24-57 代理店のメンバーが読める組織は、自社・直属の総代理店・本部だけ', '1/1/0/true/0',
    pg_temp.org_run_as('authenticated', u_mgr, format($q$
      select count(*) filter (where id = %1$L)::text || '/' || count(*) filter (where id = %2$L)::text || '/'
             || count(*) filter (where id = %3$L)::text || '/' || (count(*) filter (where organization_type = 'headquarters') > 0)::text
             || '/' || count(*) filter (where organization_type <> 'headquarters' and id not in (%1$L, %2$L, %3$L))::text
        from public.organizations $q$, v_dealer, v_md, v_dealer2)));
  perform pg_temp.org_expect_eq('24-58 総代理店のメンバーは配下の代理店の行を直接読めず、会員はどの組織も読めない', '0/1/0/true/0|0',
    pg_temp.org_run_as('authenticated', u_md_mgr, format($q$
      select count(*) filter (where id = %1$L)::text || '/' || count(*) filter (where id = %2$L)::text || '/'
             || count(*) filter (where id = %3$L)::text || '/' || (count(*) filter (where organization_type = 'headquarters') > 0)::text
             || '/' || count(*) filter (where organization_type <> 'headquarters' and id not in (%1$L, %2$L, %3$L))::text
        from public.organizations $q$, v_dealer, v_md, v_dealer2))
      || '|' || pg_temp.org_run_as('authenticated', u_other, $q$ select count(*)::text from public.organizations $q$));
end;
$test$;

select jsonb_agg(jsonb_build_object('step', step, 'expected', expected, 'actual', actual, 'ok', ok) order by seq) as j
from _org_result;

rollback;
