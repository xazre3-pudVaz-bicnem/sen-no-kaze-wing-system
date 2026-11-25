import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  legacySimulatorDraftKey,
  workSimulatorDraftKey,
  latestResumableBrowserDraft,
  readBrowserDraft,
  restoredDraftFinishLevel,
  writeBrowserWorkDraft,
  validSimulatorDraftId,
  type DraftStorageReader,
} from '@/lib/domain/simulator-browser-drafts';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const legacy = legacySimulatorDraftKey('wing-01');
const workA = workSimulatorDraftKey('wing-01', first);
const workB = workSimulatorDraftKey('wing-01', second);

function storage(entries: Record<string, string>): DraftStorageReader {
  return {
    get length() { return Object.keys(entries).length; },
    key(index: number) { return Object.keys(entries)[index] ?? null; },
    getItem(key: string) { return entries[key] ?? null; },
  };
}
const record = (ownerId: string | null, savedAt: number, configId: string | null = null) =>
  JSON.stringify({ selected: ['window-a'], ownerId, configId, name: '作業中', pending: null, savedAt });

describe('お客様向けシミュレーター：下書きの独立と明示再開', () => {
  it('過去の旧形式キーを維持し、編集作業は異なるキーで保管する', () => {
    expect(legacy).toBe('wing:sim:wing-01');
    expect(workA).not.toBe(legacy);
    expect(workA).not.toBe(workB);
    expect(validSimulatorDraftId(first)).toBe(true);
    expect(validSimulatorDraftId('other-account/../../')).toBe(false);
  });

  it('復元可能な以前の下書きを選べるが、保存済みDBプランは候補にしない', () => {
    const store = storage({
      [legacy]: record('user-a', 100),
      [workA]: record('user-a', 250),
      [workB]: record('user-a', 900, 'already-saved-id'),
    });
    expect(latestResumableBrowserDraft(store, 'wing-01', 'user-a')).toEqual({ kind: 'work', id: first, savedAt: 250 });
    expect(latestResumableBrowserDraft(store, 'wing-01', 'user-b')).toBeNull();
    expect(latestResumableBrowserDraft(store, 'box-01', 'user-a')).toBeNull();
  });

  it('匿名下書きを別ログインユーザーへ自動表示しないが、明示URLの読取はできる', () => {
    const store = storage({ [workA]: record(null, 101) });
    expect(latestResumableBrowserDraft(store, 'wing-01', null)?.id).toBe(first);
    expect(latestResumableBrowserDraft(store, 'wing-01', 'signed-in-customer')).toBeNull();
    expect(readBrowserDraft(store, workA)?.selected).toEqual(['window-a']);
  });

  it('旧形式の未保存データは候補になるが、所有者不明の保存済みIDは候補にしない', () => {
    expect(latestResumableBrowserDraft(storage({ [legacy]: record(null, 100) }), 'wing-01', null)).toEqual({ kind: 'legacy', id: null, savedAt: 100 });
    expect(latestResumableBrowserDraft(storage({ [legacy]: record(null, 100, 'old-id') }), 'wing-01', null)).toBeNull();
  });

  it('破損JSON・不正な選択形式・保存先の読取失敗は安全に無視する', () => {
    const store = storage({ [legacy]: '{broken', [workA]: '{"selected":"invalid"}', [workB]: record('user-a', 120) });
    expect(latestResumableBrowserDraft(store, 'wing-01', 'user-a')?.id).toBe(second);
    expect(readBrowserDraft(store, legacy)).toBeNull();
    expect(readBrowserDraft({ getItem() { throw new Error('storage disabled'); } }, workA)).toBeNull();
  });

  it('ブラウザの別タブ・複製タブは同じ読取元を持てても、書込み対象IDを引き継がない', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'components/simulator/simulator-app.tsx'), 'utf8');
    expect(app).toContain('const activeWorkDraftId = useRef<string | null>(null)');
    expect(app).toContain('activeWorkDraftId.current ?? window.crypto.randomUUID()');
    expect(app).not.toContain('activeWorkDraftId.current = draftId');
    expect(app).not.toContain('sessionStorage.getItem(');
    const records = new Map([[workA, record('user-a', 100)]]);
    const store = { setItem(key: string, value: string) { records.set(key, value); } };
    const original = records.get(workA);
    expect(writeBrowserWorkDraft(store, 'wing-01', second, { selected: ['tab-two'], ownerId: 'user-a' })).toBe(true);
    const otherId = '33333333-3333-4333-8333-333333333333';
    expect(writeBrowserWorkDraft(store, 'wing-01', otherId, { selected: ['tab-three'], ownerId: 'user-a' })).toBe(true);
    expect(records.get(workA)).toBe(original);
    expect(JSON.parse(records.get(workB) ?? '{}').selected).toEqual(['tab-two']);
    expect(JSON.parse(records.get(workSimulatorDraftKey('wing-01', otherId)) ?? '{}').selected).toEqual(['tab-three']);
  });

  it('注文範囲を以前の下書きどおり復元し、未知の値だけ現在の既定値へ戻す', () => {
    expect(restoredDraftFinishLevel('shell', 'full')).toBe('shell');
    expect(restoredDraftFinishLevel('equipment', 'full')).toBe('equipment');
    expect(restoredDraftFinishLevel('full', 'equipment')).toBe('full');
    expect(restoredDraftFinishLevel('removed-scope', 'full')).toBe('full');
    expect(restoredDraftFinishLevel(undefined, 'equipment')).toBe('equipment');
    const app = fs.readFileSync(path.join(process.cwd(), 'components/simulator/simulator-app.tsx'), 'utf8');
    expect(app).toContain('restoredDraftFinishLevel(draft.finishLevel, finishLevelForEstimateSpec(restoredSpec))');
  });

  it('最新の編集スナップショットを新しい保存先へ書き、旧形式と再開元を変更しない', () => {
    const original = record('user-a', 100);
    const former = record('user-a', 200);
    const records = new Map([[legacy, original], [workA, former]]);
    const store = { setItem(key: string, value: string) { records.set(key, value); } };
    const fresh = (option: string) => ({ selected: [option], ownerId: 'user-a', configId: null, savedAt: 300 });
    expect(writeBrowserWorkDraft(store, 'wing-01', second, fresh('changed-first'))).toBe(true);
    expect(writeBrowserWorkDraft(store, 'wing-01', second, fresh('changed-latest'))).toBe(true);
    expect(records.get(legacy)).toBe(original);
    expect(records.get(workA)).toBe(former);
    expect(JSON.parse(records.get(workB) ?? '{}').selected).toEqual(['changed-latest']);
  });

  it('ブラウザ保存失敗・不正作業IDの際、旧データを変更しない', () => {
    const original = record('user-a', 100);
    const records = new Map([[legacy, original]]);
    const rejected = { setItem() { throw new Error('QuotaExceededError'); } };
    expect(writeBrowserWorkDraft(rejected, 'wing-01', first, { selected: ['new'] })).toBe(false);
    expect(writeBrowserWorkDraft({ setItem() { throw new Error('unexpected call'); } }, 'wing-01', 'bad-id', { selected: ['new'] })).toBe(false);
    expect(records.get(legacy)).toBe(original);
  });

  it('新規開始・仕様指定・保存プラン表示は旧保存先へ書かない', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'components/simulator/simulator-app.tsx'), 'utf8');
    const page = fs.readFileSync(path.join(process.cwd(), 'app/(site)/simulator/[slug]/page.tsx'), 'utf8');
    expect(app).toContain('writeBrowserWorkDraft(window.localStorage, model.slug, id, draft)');
    expect(app).toContain('activeWorkDraftId.current ?? window.crypto.randomUUID()');
    expect(app).toContain('useLayoutEffect(() => {');
    expect(app).toContain('if (hydrated && dirty && !readOnly && !loadError && !standardPreview) persistDraft();');
    expect(app).not.toContain('localStorage.setItem(legacySimulatorDraftKey');
    expect(app).toContain('data-testid="previous-draft-banner"');
    expect(app).toContain('data-testid="resume-previous-draft"');
    expect(app).toContain("const legacyDraft = resume && !draftId");
    expect(page).toContain('draftId={draft ?? null}');
    expect(page).toContain('explicitEntry={Boolean(c || plan)}');
    expect(page).toContain('key={`${previewRequested ? \'standard-preview:\' : \'\'}${workRouteKey}`}');
  });

  it('ログイン経由の再開IDと既存プランのサーバー所有者検査を維持する', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'components/simulator/simulator-app.tsx'), 'utf8');
    const page = fs.readFileSync(path.join(process.cwd(), 'app/(site)/simulator/[slug]/page.tsx'), 'utf8');
    expect(app).toContain('resume=1&draft=${id}');
    expect(app).toContain('(initial.id ?? null) === (workDraft.configId ?? null)');
    expect(app).toContain('if (pricingPreview) return;');
    expect(app).toContain('setRestoreNotice(true)');
    expect(app).toContain('window.confirm(');
    expect(page).toContain('store.getConfiguration(c, user)');
    expect(page).toContain('getGuestPlan(plan)');
    expect(page).toContain('buildSimulatorEntryState(');
    expect(page).toContain('standardPreview={previewRequested}');
  });
});
