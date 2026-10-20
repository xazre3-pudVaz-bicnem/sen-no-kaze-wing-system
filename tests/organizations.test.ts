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
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261016120000_organization_accounts.sql'), 'utf8');
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

describe('組織とアカウント：DB の取り決め（migration 20261016120000）', () => {
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

  it('招待を受けるときは、本人が変えられないログインのメールアドレス（auth.users）と照合する', () => {
    expect(migration).toContain('select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v_actor;');
    expect(migration).toContain("message = 'FORBIDDEN: 招待されたメールアドレスでログインしてください'");
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

  it('招待を受けられなかったときは、理由を付けて招待の画面へ戻す', async () => {
    const { StoreError } = await import('@/lib/data/store');
    store.acceptInvitation.mockRejectedValue(new StoreError('FORBIDDEN', '招待されたメールアドレスでログインしてください'));
    await expect(acceptInvitationAction(form({ token: TOKEN }))).rejects.toThrow(
      `REDIRECT:/invite/${TOKEN}?error=${encodeURIComponent('招待されたメールアドレスでログインしてください')}`
    );
  });

  it('参加できたら、自社の組織の画面へ進む', async () => {
    store.acceptInvitation.mockResolvedValue(ORG_ID);
    await expect(acceptInvitationAction(form({ token: TOKEN }))).rejects.toThrow('REDIRECT:/admin/organization?joined=1');
  });
});
