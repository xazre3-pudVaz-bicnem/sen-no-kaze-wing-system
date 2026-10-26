import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canRestoreSimulatorDraft, canRestoreSimulatorSelection } from '../lib/domain/simulator-draft-ownership';

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

  it('新規入口では前回の保存IDを継承せず、ログイン再開では選択のみ復元可能', () => {
    const saved = { ownerId: 'customer-a', configId: 'previous-quoted-configuration' };
    expect(canRestoreSimulatorSelection(saved, 'customer-a', false)).toBe(false);
    expect(canRestoreSimulatorSelection(saved, 'customer-a', true)).toBe(true);
    expect(canRestoreSimulatorSelection(saved, 'customer-b', true)).toBe(false);
    expect(canRestoreSimulatorSelection(saved, null, true)).toBe(false);

    const unsaved = { ownerId: 'customer-a', configId: null };
    expect(canRestoreSimulatorSelection(unsaved, 'customer-a', false)).toBe(true);
    expect(canRestoreSimulatorSelection({ ownerId: null, configId: null }, 'customer-a', true)).toBe(true);
    expect(canRestoreSimulatorSelection({ configId: 'legacy-id' }, 'customer-a', true)).toBe(false);
  });

  it('画面側がアカウントを照合し、保存済みIDをブラウザから復元しない', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'components/simulator/simulator-app.tsx'), 'utf8');
    expect(app).toContain('canRestoreSimulatorSelection(draft, user?.id ?? null, resume)');
    expect(app).not.toContain('setConfigId(draft.configId)');
    expect(app).toContain('!loadError');
    expect(app).toContain('ownerId: user?.id ?? null,');
    // 未ログインの見積依頼→ログイン画面→ログイン後の再開は残す
    expect(app).toContain("persistDraft({ pending });");
    expect(app).toContain('if (resume && user && draft.pending && !resumed.current)');
    const page = fs.readFileSync(path.join(process.cwd(), 'app/(site)/simulator/[slug]/page.tsx'), 'utf8');
    expect(page).toContain("key={c ? `configuration:${c}`");
  });
});
