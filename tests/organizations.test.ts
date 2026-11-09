import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVITATION_TOKEN,
  invitationState,
  isManagerRole,
  isValidEmail,
  maskEmail,
  memberRoleLabel,
  normalizeEmail,
} from '@/lib/domain/organizations';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireStaff: vi.fn(),
  requireUser: vi.fn(),
  getOrganizationStore: vi.fn(),
  sendDirectEmail: vi.fn(),
  getSiteUrl: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  cookieGet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  requireAdmin: mocks.requireAdmin,
  requireStaff: mocks.requireStaff,
  requireUser: mocks.requireUser,
}));
vi.mock('@/lib/data/organizations/store', () => ({ getOrganizationStore: mocks.getOrganizationStore }));
vi.mock('@/lib/mail/send', () => ({ sendDirectEmail: mocks.sendDirectEmail }));
vi.mock('@/lib/site', () => ({ getSiteUrl: mocks.getSiteUrl }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mocks.cookieGet, delete: mocks.cookieDelete }),
}));
vi.mock('@/lib/data/store', () => ({
  StoreError: class StoreError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { acceptInvitationAction, inviteMemberAction } from '@/lib/actions/organizations';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261104120000_organization_accounts.sql'), 'utf8');
const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(64);

describe('組織とアカウント：表示と判定', () => {
  it('管理者は admin と従来の owner、担当者は editor', () => {
    expect(isManagerRole('admin')).toBe(true);
    expect(isManagerRole('owner')).toBe(true);
    expect(isManagerRole('editor')).toBe(false);
    expect(memberRoleLabel('owner')).toBe('管理者');
    expect(memberRoleLabel('editor')).toBe('担当者');
  });

  it('招待の状態は、取り消し → 参加済み → 期限切れ → 未使用 の順に判定する', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    const future = '2026-10-20T00:00:00Z';
    expect(invitationState({ accepted_at: null, revoked_at: null, expires_at: future }, now)).toBe('open');
    expect(invitationState({ accepted_at: null, revoked_at: null, expires_at: '2026-10-14T00:00:00Z' }, now)).toBe('expired');
    expect(invitationState({ accepted_at: '2026-10-15T00:00:00Z', revoked_at: null, expires_at: future }, now)).toBe('accepted');
    expect(invitationState({ accepted_at: null, revoked_at: '2026-10-15T00:00:00Z', expires_at: future }, now)).toBe('revoked');
  });

  it('メールアドレスは小文字にそろえて扱い、招待先は伏せて見せる', () => {
    expect(normalizeEmail('  Tanaka@Example.COM ')).toBe('tanaka@example.com');
    expect(isValidEmail('tanaka@example.com')).toBe(true);
    expect(isValidEmail('tanaka example.com')).toBe(false);
    expect(maskEmail('tanaka@example.com')).toBe('t…@example.com');
    expect(INVITATION_TOKEN.test(TOKEN)).toBe(true);
    expect(INVITATION_TOKEN.test('A'.repeat(64))).toBe(false);
  });
});

describe('組織とアカウント：DB の取り決め（migration 20261104120000）', () => {
  it('代理店の直属は総代理店だけ（トリガーで表を直接書き換えても守る）', () => {
    expect(migration).toContain('add column parent_organization_id uuid references public.organizations(id) on delete restrict');
    expect(migration).toContain("if new.organization_type <> 'dealer' then");
    expect(migration).toContain("if v_parent_type is distinct from 'master_dealer' then");
    expect(migration).toContain('before insert or update of organization_type, parent_organization_id on public.organizations');
  });

  it('有効な所属は 1 人 1 つ、本部の管理者は代理店・総代理店に所属させない', () => {
    expect(migration).toContain("create unique index organization_memberships_one_active_idx\n  on public.organization_memberships(profile_id)\n  where status = 'active';");
    expect(migration).toContain("if v_role_code = 'admin' then");
  });

  it('招待の鍵は発行時に一度だけ返し、DB には SHA-256 のハッシュだけを残す。表は直接読めない', () => {
    expect(migration).toContain('token_hash text not null unique');
    const tableDdl = sqlOnly.slice(
      sqlOnly.indexOf('create table public.organization_invitations ('),
      sqlOnly.indexOf('comment on table public.organization_invitations')
    );
    expect(tableDdl).toContain('token_hash text');
    expect(tableDdl).not.toMatch(/\btoken\s+text/);
    expect(migration).toContain("pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')), 'hex')");
    expect(migration).toContain('revoke all on table public.organization_invitations from public, anon, authenticated, service_role;');
  });

  it('招待を受けるときは、本人が変えられないログインのメールアドレス（auth.users）と照合し、確認済みのアカウントに限る', () => {
    expect(migration).toContain(
      'select pg_catalog.lower(u.email), u.email_confirmed_at into v_email, v_email_confirmed_at from auth.users u where u.id = v_actor;'
    );
    expect(migration).toContain("message = 'FORBIDDEN: 招待されたメールアドレスでログインしてください'");
    expect(migration).toContain('if v_email_confirmed_at is null then');
  });

  it('招待メールの送りすぎを防ぐ：同じメールアドレスへ 24 時間に 3 回、管理者からは 1 つの組織で 20 件まで', () => {
    const fn = sqlOnly.slice(
      sqlOnly.indexOf('create function public.invite_organization_member('),
      sqlOnly.indexOf('create function public.revoke_organization_invitation(')
    );
    expect(fn).toContain("and i.created_at > pg_catalog.clock_timestamp() - interval '24 hours') >= 3 then");
    expect(fn).toContain("if not public.is_admin() and (select count(*) from public.organization_invitations i");
    expect(fn).toContain("and i.created_at > pg_catalog.clock_timestamp() - interval '24 hours') >= 20 then");
    // 組織の行をロックしてから数える（同時の発行・停止との順番をそろえる）
    expect(fn).toContain('select * into v_org from public.organizations o where o.id = p_organization_id for update;');
  });

  it('組織を停止すると、メンバーを会員に戻し（所属は残す）、未使用の招待を取り消す。再開すると戻す', () => {
    const fn = sqlOnly.slice(
      sqlOnly.indexOf('create function public.update_organization('),
      sqlOnly.indexOf('create function public.invite_organization_member(')
    );
    expect(fn).toContain("if v_org.status = 'active' and p_status = 'inactive' then");
    expect(fn).toContain("set role_code = 'customer'");
    expect(fn).toContain('set revoked_at = pg_catalog.clock_timestamp(), revoked_by = auth.uid()');
    expect(fn).toContain("elsif v_org.status = 'inactive' and p_status = 'active' then");
    expect(fn).toContain('set role_code = v_member_role_code');
    // 有効のまま・再開するときも、直属の総代理店が有効であること（親の行を共有ロック）
    expect(fn).toContain("and (p_parent_organization_id is distinct from v_org.parent_organization_id or p_status = 'active') then");
    expect(fn).toMatch(/o\.status = 'active'\n\s+for share;/);
    // 組織の状態を変えてから利用者の種類を変える（トリガーが変えた後の状態で確かめる）
    expect(fn.indexOf('update public.organizations o')).toBeLessThan(fn.indexOf('update public.profiles p'));
  });

  it('所属している人の利用者の種類は所属に合わせる（本部の会員一覧から変えられない）', () => {
    expect(migration).toContain('create trigger trg_profiles_role_matches_organization\nbefore update of role_code on public.profiles');
    const fn = sqlOnly.slice(
      sqlOnly.indexOf('create function public.enforce_profile_role_matches_organization()'),
      sqlOnly.indexOf('create trigger trg_profiles_role_matches_organization')
    );
    expect(fn).toContain("when o.status <> 'active' then 'customer'");
    expect(fn).toContain("and o.organization_type in ('master_dealer', 'dealer')");
    expect(migration).toContain(
      'revoke all on function public.enforce_profile_role_matches_organization() from public, anon, authenticated, service_role;'
    );
    // 画面の文言は DB と同じ
    const domain = fs.readFileSync(path.join(root, 'lib/domain/organizations.ts'), 'utf8');
    const message = /ORGANIZATION_ROLE_LOCKED_MESSAGE =\n\s+'([^']+)'/.exec(domain)?.[1];
    expect(message).toBeTruthy();
    expect(migration).toContain(`message = 'VALIDATION: ${message}'`);
  });

  it('本体マスターの登録・編集は本部の組織だけ（B-2）、組織の表は必要な範囲だけ読める', () => {
    const baseMaster = sqlOnly.slice(
      sqlOnly.indexOf('create or replace function public.can_create_base_master_for_org(p_organization_id uuid)'),
      sqlOnly.indexOf('comment on function public.can_create_base_master_for_org(uuid)')
    );
    expect(baseMaster).toContain("and o.organization_type = 'headquarters'");
    expect(baseMaster).not.toContain('master_dealer');
    expect(migration).toContain('create policy organizations_staff_read on public.organizations\nfor select using (public.can_read_organization(id));');
    const read = sqlOnly.slice(
      sqlOnly.indexOf('create function public.can_read_organization(p_organization_id uuid)'),
      sqlOnly.indexOf('comment on function public.can_read_organization(uuid)')
    );
    expect(read).toContain('(mine.id = p_organization_id or mine.parent_organization_id = p_organization_id)');
    expect(read).toContain("t.organization_type = 'headquarters'");
    expect(migration).toContain('grant execute on function public.can_read_organization(uuid) to authenticated;');
  });

  it('管理者が 0 人にならないよう、管理者の行をロックしてから数え、ロック後にも権限を確かめ直す', () => {
    const lockCount = migration.split("m.member_role in ('owner', 'admin')\n   for update;").length - 1;
    expect(lockCount).toBe(2);
    expect(migration.split("FORBIDDEN: 管理者ではなくなったため、この操作はできません").length - 1).toBe(2);
    expect(migration).toContain('管理者が 1 人もいなくなるため');
  });

  it('組織の登録・変更は本部だけ、招待・役割の変更は本部とその組織の管理者だけ', () => {
    expect(migration).toContain("FORBIDDEN: 組織を登録できるのは本部の管理者だけです");
    expect(migration).toContain("FORBIDDEN: 組織を変更できるのは本部の管理者だけです");
    expect(migration).toContain('if not (public.is_admin() or public.is_organization_manager(v_org.id)) then');
  });

  it('書き込みの関数はすべて postgres 所有・SECURITY DEFINER・空の search_path で、内部の関数は利用者から呼べない', () => {
    expect(migration).toContain("if v_fn.prosecdef is distinct from true or v_fn.owner_name <> 'postgres' then");
    expect(migration).toContain('revoke all on function public.write_organization_audit(text, text, uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;');
    expect(sqlOnly).not.toMatch(/grant execute on function public\.write_organization_audit/);
    expect(sqlOnly).not.toMatch(/grant execute on function public\.validate_organization_parent/);
  });

  it('案件・見積の権限（営業担当組織・主担当者・製造担当組織）はこの migration では変えない', () => {
    expect(sqlOnly).not.toMatch(/case_access|quote_requests|quotes\b|case_workflows/);
  });

  it('商品台帳の編集は本部だけ（2026-11-04 の先方回答 B-2）：DB の can_edit_catalog と画面の判定をそろえる', () => {
    const fn = sqlOnly.slice(sqlOnly.indexOf('create or replace function public.can_edit_catalog()'), sqlOnly.indexOf("comment on function public.can_edit_catalog()"));
    expect(fn).toContain('select public.current_role_rank() >= 3;');
    // RLS から呼ぶので、実行権限は外さない（postconditions でも確かめる）
    expect(sqlOnly).not.toMatch(/revoke [^;]*public\.can_edit_catalog\(\)/);
    expect(migration).toContain("raise exception 'POSTCONDITION: can_edit_catalog() must allow headquarters only and stay executable for RLS';");
    const types = fs.readFileSync(path.join(process.cwd(), 'lib/domain/types.ts'), 'utf8');
    expect(types).toMatch(/export function canEditCatalog\(role: RoleCode \| undefined \| null\): boolean \{\n  return hasRoleAtLeast\(role, 'admin'\);/);
    const session = fs.readFileSync(path.join(process.cwd(), 'lib/auth/session.ts'), 'utf8');
    expect(session).toContain("export const requireCatalogEditor = (nextPath = '/admin') => requireRole('admin', nextPath);");
  });
});

describe('組織とアカウント：招待の Server Action', () => {
  const store = {
    getOrganization: vi.fn(),
    inviteMember: vi.fn(),
    acceptInvitation: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireStaff.mockResolvedValue({ id: 'manager', role: 'dealer', email: 'm@example.com', full_name: '管理者' });
    mocks.requireUser.mockResolvedValue({ id: 'invitee', role: 'customer', email: 'i@example.com', full_name: '招待' });
    mocks.getOrganizationStore.mockResolvedValue(store);
    store.getOrganization.mockResolvedValue({ id: ORG_ID, name: '検査代理店', organization_type: 'dealer' });
    store.inviteMember.mockResolvedValue({ invitation_id: 'inv', token: TOKEN, expires_at: '2026-10-22T00:00:00Z' });
    mocks.redirect.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
  });

  const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [key, value] of Object.entries(entries)) fd.set(key, value);
    return fd;
  };

  it('サイトの URL が無い環境（ローカル検証）ではメールを送らず、画面にリンクを出す', async () => {
    mocks.getSiteUrl.mockReturnValue(null);
    const result = await inviteMemberAction({ ok: false }, form({ organization_id: ORG_ID, email: ' Staff@Example.com ', member_role: 'editor' }));
    expect(result).toMatchObject({ ok: true, inviteUrl: `/invite/${TOKEN}`, emailStatus: 'skipped' });
    expect(store.inviteMember).toHaveBeenCalledWith(expect.objectContaining({ id: 'manager' }), ORG_ID, 'staff@example.com', 'editor');
    expect(mocks.sendDirectEmail).not.toHaveBeenCalled();
  });

  it('サイトの URL があれば、招待のリンクをメールで送る', async () => {
    mocks.getSiteUrl.mockReturnValue('https://www.example.com');
    mocks.sendDirectEmail.mockResolvedValue('sent');
    const result = await inviteMemberAction({ ok: false }, form({ organization_id: ORG_ID, email: 'staff@example.com', member_role: 'admin' }));
    expect(result).toMatchObject({ ok: true, inviteUrl: `https://www.example.com/invite/${TOKEN}`, emailStatus: 'sent' });
    const [to, subject, body] = mocks.sendDirectEmail.mock.calls[0];
    expect(to).toBe('staff@example.com');
    expect(subject).toContain('検査代理店');
    expect(body).toContain(`https://www.example.com/invite/${TOKEN}`);
    expect(body).toContain('役割：管理者');
  });

  it('形式の誤ったメールアドレス・役割は DB を呼ぶ前に断る', async () => {
    expect(await inviteMemberAction({ ok: false }, form({ organization_id: ORG_ID, email: 'x', member_role: 'editor' }))).toMatchObject({ ok: false });
    expect(await inviteMemberAction({ ok: false }, form({ organization_id: ORG_ID, email: 'a@b.c', member_role: 'owner' }))).toMatchObject({ ok: false });
    expect(store.inviteMember).not.toHaveBeenCalled();
  });

  it('招待を受けられなかったときは、理由を付けて招待の画面へ戻す（鍵は URL に載せない）', async () => {
    const { StoreError } = await import('@/lib/data/store');
    mocks.cookieGet.mockReturnValue({ value: TOKEN });
    store.acceptInvitation.mockRejectedValue(new StoreError('FORBIDDEN', '招待されたメールアドレスでログインしてください'));
    await expect(acceptInvitationAction()).rejects.toThrow(
      `REDIRECT:/invite?error=${encodeURIComponent('招待されたメールアドレスでログインしてください')}`
    );
    expect(store.acceptInvitation).toHaveBeenCalledWith(expect.objectContaining({ id: 'invitee' }), TOKEN);
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it('招待のリンクを開いていない（Cookie に鍵が無い）ときは、DB を呼ばずにリンクを開き直してもらう', async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    await expect(acceptInvitationAction()).rejects.toThrow(
      `REDIRECT:/invite?error=${encodeURIComponent('招待のリンクをもう一度開いてください')}`
    );
    expect(store.acceptInvitation).not.toHaveBeenCalled();
  });

  it('参加できたら、鍵の Cookie を消して自社の組織の画面へ進む', async () => {
    mocks.cookieGet.mockReturnValue({ value: TOKEN });
    store.acceptInvitation.mockResolvedValue(ORG_ID);
    await expect(acceptInvitationAction()).rejects.toThrow('REDIRECT:/admin/organization?joined=1');
    expect(mocks.cookieDelete).toHaveBeenCalledWith({ name: 'wing_invitation', path: '/invite' });
  });
});

describe('組織とアカウント：招待のリンク（/invite/鍵）', () => {
  it('鍵を Cookie（/invite だけ・JavaScript から読めない）に移し、鍵の無い /invite へ進める', async () => {
    const { GET } = await import('@/app/(site)/invite/[token]/route');
    const { NextRequest } = await import('next/server');
    const response = await GET(new NextRequest(`https://www.example.com/invite/${TOKEN}`), { params: Promise.resolve({ token: TOKEN }) });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://www.example.com/invite');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`wing_invitation=${TOKEN}`);
    expect(cookie).toMatch(/Path=\/invite/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });

  it('形の違うリンクでは鍵を持たず、前に開いた招待の Cookie も消す', async () => {
    const { GET } = await import('@/app/(site)/invite/[token]/route');
    const { NextRequest } = await import('next/server');
    const response = await GET(new NextRequest('https://www.example.com/invite/not-a-token'), { params: Promise.resolve({ token: 'not-a-token' }) });
    expect(response.headers.get('location')).toBe('https://www.example.com/invite');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).not.toContain('not-a-token');
    expect(cookie).toMatch(/wing_invitation=;/);
  });
});
