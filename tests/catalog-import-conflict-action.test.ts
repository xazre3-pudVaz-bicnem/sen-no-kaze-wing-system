import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OptionCategory } from '@/lib/domain/types';

/**
 * 商品台帳の一括登録：DB の競合・想定外のエラーが、管理画面の操作（importCatalogAction）の結果の文言まで
 * どう届くか（商品公開原子性 v6.1 の V6-B07 に当たる、画面に届くまでの試験）。
 * 一括登録の部品（Excel の読み取り・取り込みの計画・反映）は本物を使い、DB の手前（ストア）だけを差し替える。
 */

const mocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  requireCatalogEditor: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({
  requireAdmin: vi.fn(),
  requireCatalogEditor: mocks.requireCatalogEditor,
  requireStaff: vi.fn(),
}));
vi.mock('@/lib/data/public-catalog', () => ({ CATALOG_TAG: 'catalog' }));
vi.mock('@/lib/mail/send', () => ({ flushNotificationsSafely: vi.fn() }));
// 原価の Version の記録は「仕組みが無い」扱い（一括登録の金額はそのまま反映する）
vi.mock('@/lib/data/option-cost-recording', () => ({
  getCostRecordingAccess: vi.fn(async () => ({ available: false, canManage: false })),
  getCostAccessForProduct: vi.fn(async () => ({ available: false, canManage: false })),
  NO_COST_RECORDING: { available: false, canManage: false },
  canEditCostField: () => true,
  COST_ACCESS_ERROR_MESSAGE: '原価の権限を確認できませんでした。',
  recordPublishedOptionCost: vi.fn(async () => ({ status: 'unavailable' })),
  recordPublishedChoiceCosts: vi.fn(async () => ({ status: 'unavailable' })),
  costRecordingNotice: () => null,
}));
vi.mock('@/lib/data/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/store')>()),
  getStore: mocks.getStore,
  isLocalMode: vi.fn(() => false),
}));

import { StoreError } from '@/lib/data/store';
import { importCatalogAction } from '@/lib/actions/admin';
import { IMPORT_CONFLICT_MESSAGE, IMPORT_FAILED, IMPORT_UNEXPECTED } from '@/lib/import/errors';

const category: OptionCategory = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'unit-bath',
  name: 'ユニットバス',
  description: null,
  sort_order: 1,
  is_required: false,
  selection_type: 'radio',
} as unknown as OptionCategory;

/** 1 商品だけの「商品一覧」（CSV） */
function applyForm(): FormData {
  const fd = new FormData();
  fd.set('mode', 'apply');
  fd.set('imageMetadata', '[]');
  fd.set('sheet', new File(['商品ID,カテゴリー,商品名,Wing表示価格\nPROD-1,ユニットバス,テスト商品,100000\n'], '商品一覧.csv', { type: 'text/csv' }));
  return fd;
}

function storeFailingWith(error: unknown) {
  const applyCatalogImport = vi.fn(async () => {
    throw error;
  });
  mocks.getStore.mockResolvedValue({
    listReferencedCatalogImportImageUrls: vi.fn(async () => []),
    listCategories: vi.fn(async () => [category]),
    listOptions: vi.fn(async () => []),
    applyCatalogImport,
  });
  return applyCatalogImport;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCatalogEditor.mockResolvedValue({ id: 'admin-1', role: 'admin' });
});

describe('一括登録の失敗が、画面の文言まで届く', () => {
  it('競合は「最新の状態を読み込んで、もう一度」の決まった文言で届く（DB の文は届かない）', async () => {
    // ストアが決まった文言の CONFLICT にしたもの（包まれずに返った競合）
    const apply = storeFailingWith(new StoreError('CONFLICT', IMPORT_CONFLICT_MESSAGE));
    const state = await importCatalogAction({ ok: false }, applyForm());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(state).toEqual({ ok: false, error: IMPORT_CONFLICT_MESSAGE });
    // 行の処理の中で起きて包まれた競合（ストアは INTERNAL で、DB の文のまま渡す）
    storeFailingWith(new StoreError('INTERNAL', 'IMPORT_VARIANT_CHOICE UPSERT prod-1-color-white: IMPORT_CONFLICT: expected id mismatch (select 1)'));
    const wrapped = await importCatalogAction({ ok: false }, applyForm());
    expect(wrapped).toEqual({ ok: false, error: IMPORT_CONFLICT_MESSAGE });
  });

  it('Excel の値が DB の決まりに合わないときは、SQL の文を出さずに、直す行が届く', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storeFailingWith(new StoreError('INTERNAL', 'IMPORT_OPTION UPSERT prod-1: null value in column "category_id" violates not-null constraint'));
    const state = await importCatalogAction({ ok: false }, applyForm());
    expect(state.ok).toBe(false);
    expect(state.error).toContain(IMPORT_FAILED);
    expect(state.error).toContain('Excel の商品コード「prod-1」の行');
    expect(state.error).not.toMatch(/null value|category_id|constraint|IMPORT_OPTION/);
  });

  it('想定外の DB のエラーは、SQL の文を出さずに、止まった行と「時間をおいて」の案内が届く', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    storeFailingWith(new StoreError('INTERNAL', 'IMPORT_OPTION UPSERT prod-1: could not serialize access due to concurrent update'));
    const state = await importCatalogAction({ ok: false }, applyForm());
    expect(state.error).toBe(`${IMPORT_FAILED}。商品コード「prod-1」の登録で止まりました。${IMPORT_UNEXPECTED}`);
  });

  it('入力の誤り（DB の関数が書いた文）は、その文言が届く', async () => {
    storeFailingWith(new StoreError('INTERNAL', 'IMPORT_OPTION UPSERT prod-1: VALIDATION: 価格は 0 以上で入力してください'));
    const state = await importCatalogAction({ ok: false }, applyForm());
    expect(state).toEqual({ ok: false, error: `${IMPORT_FAILED}。価格は 0 以上で入力してください（商品コード「prod-1」）` });
  });
});
