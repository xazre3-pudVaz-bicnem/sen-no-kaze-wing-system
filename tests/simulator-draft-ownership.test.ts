import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canRestoreSimulatorDraft } from '../lib/domain/simulator-draft-ownership';

describe('シミュレーターの保存下書き・アカウント分離', () => {
  it('保存済みのプランは同じアカウントにだけ復元する', () => {
    const saved = { ownerId: 'customer-a', configId: 'configuration-a' };
    expect(canRestoreSimulatorDraft(saved, 'customer-a')).toBe(true);
    expect(canRestoreSimulatorDraft(saved, 'customer-b')).toBe(false);
    expect(canRestoreSimulatorDraft(saved, null)).toBe(false);
  });

  it('旧形式の保存済みプランは所有者を確認できないので復元しない', () => {
    expect(canRestoreSimulatorDraft({ configId: 'old-configuration' }, 'customer-a')).toBe(false);
    expect(canRestoreSimulatorDraft({ configId: 'old-configuration' }, null)).toBe(false);
  });

  it('ログイン前に選択した未保存プランはログイン後も復元する', () => {
    const guestDraft = { ownerId: null, configId: null };
    expect(canRestoreSimulatorDraft(guestDraft, null)).toBe(true);
    expect(canRestoreSimulatorDraft(guestDraft, 'new-customer')).toBe(true);
    expect(canRestoreSimulatorDraft({ configId: null }, 'new-customer')).toBe(true);
  });

  it('他のログインユーザーの未保存プランも引き継がない', () => {
    const draft = { ownerId: 'customer-a', configId: null };
    expect(canRestoreSimulatorDraft(draft, 'customer-b')).toBe(false);
    expect(canRestoreSimulatorDraft(draft, null)).toBe(false);
  });

  it('画面側が復元可否・保存ID・書込者を照合している', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'components/simulator/simulator-app.tsx'), 'utf8');
    expect(app).toContain('canRestoreSimulatorDraft(draft, user?.id ?? null)');
    expect(app).toContain('draft.configId && user && draft.ownerId === user.id && !hasInvalidSpec');
    expect(app).toContain('ownerId: user?.id ?? null,');
    // 未ログインの見積依頼→ログイン画面→ログイン後の再開は残す
    expect(app).toContain("persistDraft({ pending });");
    expect(app).toContain('if (resume && user && draft.pending && !resumed.current)');
  });
});
