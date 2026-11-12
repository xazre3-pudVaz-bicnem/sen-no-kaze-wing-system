import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDb, saveDb } from '@/lib/data/local-db';
import { LocalStore } from '@/lib/data/local-store';
import { LocalOrganizationStore } from '@/lib/data/organizations/local';
import type { SessionUser } from '@/lib/data/store';
import { MASTER_DEALER_VIA_ORGANIZATION_MESSAGE, ORGANIZATION_ROLE_LOCKED_MESSAGE } from '@/lib/domain/organizations';
import type { RoleCode } from '@/lib/domain/types';

// 2026-11-09 の独立レビュー（#502）への対応：ローカル検証モードも DB（20261111110000）と同じ決まりにする。
// 組織の停止・再開、停止中の総代理店の配下の再開、招待の送りすぎの上限、所属と利用者の種類

describe.sequential('組織とアカウント：ローカル検証モード（DB と同じ決まり）', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-organizations-'));
    process.env.WING_LOCAL_DIR = dir;
    process.env.WING_LOCAL_MODE = '1';
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    delete process.env.WING_LOCAL_MODE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function addUser(id: string, email: string, role: RoleCode): SessionUser {
    const db = loadDb();
    const at = new Date().toISOString();
    db.users.push({ id, email, password_hash: 'x', salt: 'x', created_at: at });
    db.profiles.push({
      id,
      customer_no: null,
      email,
      full_name: id,
      company_name: null,
      phone: null,
      postal_code: null,
      address: null,
      role_code: role,
      created_at: at,
      updated_at: at,
    });
    saveDb(db);
    return { id, email, role, full_name: id };
  }

  const roleOf = (id: string) => loadDb().profiles.find((p) => p.id === id)?.role_code;

  /** 総代理店とその配下の代理店を登録し、代理店の最初の管理者を参加させる */
  async function setupDealer() {
    const store = new LocalOrganizationStore();
    const admin = addUser('hq', 'hq@example.com', 'admin');
    const manager = addUser('mgr', 'mgr@example.com', 'customer');
    const md = await store.createOrganization(admin, { organization_type: 'master_dealer', name: '検査総代理店', parent_organization_id: null });
    const dealer = await store.createOrganization(admin, { organization_type: 'dealer', name: '検査代理店', parent_organization_id: md });
    const issued = await store.inviteMember(admin, dealer, manager.email, 'admin');
    await store.acceptInvitation(manager, issued.token);
    return { store, admin, manager: { ...manager, role: 'dealer' as RoleCode }, md, dealer };
  }

  it('停止するとメンバーは会員に戻り（所属は残る）、未使用の招待は取り消される。再開すると戻る', async () => {
    const { store, admin, manager, md, dealer } = await setupDealer();
    const pending = await store.inviteMember(manager, dealer, 'later@example.com', 'editor');

    await store.updateOrganization(admin, dealer, { name: '検査代理店', parent_organization_id: md, status: 'inactive' });
    expect(roleOf(manager.id)).toBe('customer');
    expect((await store.getMyOrganization(manager))?.status).toBe('inactive');
    await expect(store.listMembers(manager, dealer)).rejects.toThrow('この組織のメンバーは見られません');

    await store.updateOrganization(admin, dealer, { name: '検査代理店', parent_organization_id: md, status: 'active' });
    expect(roleOf(manager.id)).toBe('dealer');
    const later = addUser('later', 'later@example.com', 'customer');
    await expect(store.acceptInvitation(later, pending.token)).rejects.toThrow('この招待は取り消されています');
  });

  it('停止中の総代理店の配下の代理店は、親を変えずに再開できない', async () => {
    const { store, admin, md, dealer } = await setupDealer();
    await store.updateOrganization(admin, dealer, { name: '検査代理店', parent_organization_id: md, status: 'inactive' });
    await store.updateOrganization(admin, md, { name: '検査総代理店', parent_organization_id: null, status: 'inactive' });
    await expect(
      store.updateOrganization(admin, dealer, { name: '検査代理店', parent_organization_id: md, status: 'active' })
    ).rejects.toThrow('直属の総代理店が停止中です');
    // 停止中のままなら名前は変えられる
    await expect(
      store.updateOrganization(admin, dealer, { name: '検査代理店（改）', parent_organization_id: md, status: 'inactive' })
    ).resolves.toBeUndefined();
  });

  it('招待は同じメールアドレスへ 24 時間に 3 回、管理者からは 1 つの組織で 20 件まで（本部は組織の件数を数えない）', async () => {
    const { store, admin, manager, dealer } = await setupDealer();
    for (let i = 0; i < 3; i++) await store.inviteMember(admin, dealer, 'again@example.com', 'editor');
    await expect(store.inviteMember(admin, dealer, 'again@example.com', 'editor')).rejects.toThrow('24 時間に 3 回まで');
    // ここまでの招待は 4 件（最初の管理者 1・同じメールアドレス 3）
    for (let i = 0; i < 16; i++) await store.inviteMember(manager, dealer, `bulk${i}@example.com`, 'editor');
    await expect(store.inviteMember(manager, dealer, 'bulk-over@example.com', 'editor')).rejects.toThrow('24 時間に 20 件まで');
    await expect(store.inviteMember(admin, dealer, 'bulk-hq@example.com', 'editor')).resolves.toMatchObject({
      token: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('所属している人の権限は会員一覧から変えられず、会員一覧から総代理店にもできない', async () => {
    const { admin, manager } = await setupDealer();
    const local = new LocalStore();
    await expect(local.updateUserRole(manager.id, 'customer', admin)).rejects.toThrow(ORGANIZATION_ROLE_LOCKED_MESSAGE);
    await expect(local.updateUserRole(manager.id, 'admin', admin)).rejects.toThrow(ORGANIZATION_ROLE_LOCKED_MESSAGE);
    const someone = addUser('someone', 'someone@example.com', 'customer');
    await expect(local.updateUserRole(someone.id, 'master_dealer', admin)).rejects.toThrow(MASTER_DEALER_VIA_ORGANIZATION_MESSAGE);
    // 組織に入らない代理店（これまでの形）は残す
    await expect(local.updateUserRole(someone.id, 'dealer', admin)).resolves.toMatchObject({ role_code: 'dealer' });
  });
});
