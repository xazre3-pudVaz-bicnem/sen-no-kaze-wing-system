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
    expect(canRestoreSimulatorSelection(unsaved, 'customer-a', false)).toBe(false);
    expect(canRestoreSimulatorSelection({ ownerId: null, configId: null }, 'customer-a', true)).toBe(true);
    expect(canRestoreSimulatorSelection({ configId: 'legacy-id' }, 'customer-a', true)).toBe(false);
  });

  it('本部の新規価格プレビューは旧選択を自動復元しないが、お客様の通常再開は維持する', () => {
    const guest = { ownerId: null, configId: null };
    const saved = { ownerId: 'headquarters', configId: 'saved-configuration' };
    // 通常のプレビューは以前の未保存選択があっても標準構成から開始する。
    expect(canRestoreSimulatorSelection(guest, 'headquarters', false, true)).toBe(false);
    expect(canRestoreSimulatorSelection(saved, 'headquarters', false, true)).toBe(false);
    // 意図して ?resume=1 を指定した場合だけ選択の復元を許す（所有者検証は維持）。
    expect(canRestoreSimulatorSelection(saved, 'headquarters', true, true)).toBe(true);
    expect(canRestoreSimulatorSelection(saved, 'other-user', true, true)).toBe(false);
    // お客様の新規開始でも暗黙に復元しない。明示再開のみ維持。
    expect(canRestoreSimulatorSelection(guest, 'headquarters', false)).toBe(false);
    expect(canRestoreSimulatorSelection(saved, 'headquarters', true)).toBe(true);
  });

  it('本部プレビューはブラウザ下書きを上書きせず、通常の保存・再開は維持する', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'components/simulator/simulator-app.tsx'), 'utf8');
    const page = fs.readFileSync(path.join(process.cwd(), 'app/(site)/simulator/[slug]/page.tsx'), 'utf8');
    expect(page).toContain("const previewRequested = preview === 'standard' && user?.role === 'admin';");
    expect(page).toContain('standardPreview={previewRequested}');
    expect(page).toContain("key={`${previewRequested ? 'standard-preview:' : ''}${workRouteKey}`}");
    expect(app).toContain('canRestoreSimulatorSelection(workDraft, user?.id ?? null, true, standardPreview)');
    expect(app).toContain("if (typeof window === 'undefined' || standardPreview) return null;");
    expect(app).toContain('if (hydrated && dirty && !readOnly && !loadError && !standardPreview) persistDraft();');
    expect(app).toContain('if (resume && !standardPreview && user && draft.pending && !resumed.current)');
    expect(app).toContain('if (pricingPreview) return;');
    expect(app).toContain("pushToast('本部プレビュー中は見積依頼できません");
    // お客様が明示的に開く保存プラン (?c) / 一時保存 (?plan) は独立して扱う。
    expect(page).toContain('if (c) {');
    expect(page).toContain('} else if (plan) {');
    expect(page).toContain('} else if (spec) {');
  });

  it('画面側がアカウントを照合し、保存済みIDをブラウザから復元しない', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'components/simulator/simulator-app.tsx'), 'utf8');
    expect(app).toContain('canRestoreSimulatorSelection(legacyDraft, user?.id ?? null, true, standardPreview)');
    expect(app).not.toContain('setConfigId(draft.configId)');
    expect(app).toContain('!loadError');
    expect(app).toContain('ownerId: user?.id ?? null,');
    // 未ログインの見積依頼→ログイン画面→ログイン後の再開は残す
    expect(app).toContain("const id = persistDraft({ pending });");
    expect(app).toContain('if (resume && !standardPreview && user && draft.pending && !resumed.current)');
    const page = fs.readFileSync(path.join(process.cwd(), 'app/(site)/simulator/[slug]/page.tsx'), 'utf8');
    expect(page).toContain('const simulatorRouteKey = c ? `configuration:${c}`');
  });
});
