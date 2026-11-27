import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class StoreError extends Error {
    constructor(public code: string, message: string) {
      super(message);
      this.name = 'StoreError';
    }
  }
  return {
    StoreError,
    getSessionUser: vi.fn(),
    getStore: vi.fn(),
    readOptionIncludedCategories: vi.fn(),
    save: vi.fn(),
    revalidatePath: vi.fn(),
    updateTag: vi.fn(),
  };
});

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath, updateTag: mocks.updateTag }));
// 保存できたらシミュレーターの公開カタログのキャッシュを捨てる（#628 の続き）。公開カタログの読み込み自体は使わない
vi.mock('@/lib/data/public-catalog', () => ({ CATALOG_TAG: 'catalog' }));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/data/store', () => ({ getStore: mocks.getStore, StoreError: mocks.StoreError }));
vi.mock('@/lib/data/option-included-categories', () => ({ readOptionIncludedCategories: mocks.readOptionIncludedCategories }));

import { saveIncludedCategoriesAction } from '@/lib/actions/option-included-categories';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const optionId = uuid(1);
const own = uuid(2);
const toilet = uuid(3);
const washbasin = uuid(4);
const invalidCandidate = uuid(5);
const admin = { id: uuid(9), role: 'admin' };

const input = (expectedCategoryIds: string[], nextCategoryIds: string[]) => ({
  optionId, expectedCategoryIds, nextCategoryIds,
});

const storeWith = (categories: { id: string; code: string; name?: string; status: string }[]) => ({
  getOption: vi.fn(async () => ({ id: optionId, category_id: own, status: 'draft' })),
  listCategories: vi.fn(async () => categories),
  setOptionIncludedCategories: mocks.save,
});

describe('商品に含まれる設備：Server Actionの権限・競合・DataStore の境界', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSessionUser.mockResolvedValue(admin);
    mocks.getStore.mockResolvedValue(storeWith([
      { id: own, code: 'ub', name: '浴室', status: 'published' },
      { id: toilet, code: 'toilet', name: 'トイレ', status: 'published' },
      { id: washbasin, code: 'washbasin', name: '洗面', status: 'published' },
    ]));
    mocks.readOptionIncludedCategories.mockResolvedValue({ ok: true, ids: [] });
    mocks.save.mockImplementation(async (_actor: unknown, _optionId: string, _expected: string[], next: string[]) => [...next].sort());
  });

  it.each([
    [null, '未ログイン'],
    [{ role: 'dealer' }, '代理店'],
    [{ role: 'master_dealer' }, '総代理店'],
    [{ role: 'customer' }, '顧客'],
  ])('%s（%s）はActionでも書込み拒否', async (actor, _roleLabel) => {
    mocks.getSessionUser.mockResolvedValue(actor);
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(mocks.getStore).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('本部でも浴室以外の商品は書き込めない', async () => {
    mocks.getStore.mockResolvedValue(storeWith([
      { id: own, code: 'toilet', status: 'published' },
      { id: toilet, code: 'toilet', status: 'published' },
      { id: washbasin, code: 'washbasin', status: 'published' },
    ]));
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('空集合も合法。ログインした本部の利用者として DataStore で保存し、結果を照合', async () => {
    const result = await saveIncludedCategoriesAction(input([], []));
    expect(result).toEqual({ ok: true, savedIds: [] });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith(admin, optionId, [], []);
    expect(mocks.readOptionIncludedCategories).toHaveBeenCalledWith(admin, optionId);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/options/' + optionId);
    // シミュレーターの公開カタログ（含まれる設備の表示・二重の選択の防止）にすぐ出す（#628 の続き）
    expect(mocks.updateTag).toHaveBeenCalledWith('catalog');
  });

  it('両方を保存するとカテゴリーID配列だけを渡す', async () => {
    const result = await saveIncludedCategoriesAction(input([], [washbasin, toilet]));
    expect(result).toEqual({ ok: true, savedIds: [toilet, washbasin] });
    expect(mocks.save).toHaveBeenCalledWith(admin, optionId, [], [toilet, washbasin]);
  });

  it('画面から届いた開いた時点の集合を、今の値に置き換えずに渡す', async () => {
    mocks.readOptionIncludedCategories.mockResolvedValue({ ok: true, ids: [toilet] });
    const result = await saveIncludedCategoriesAction(input([toilet], [toilet, washbasin]));
    expect(result).toEqual({ ok: true, savedIds: [toilet, washbasin] });
    expect(mocks.save).toHaveBeenCalledWith(admin, optionId, [toilet], [toilet, washbasin]);
  });

  it('画面を開いた後に別操作が先行したらCONFLICT、保存は呼ばない', async () => {
    mocks.readOptionIncludedCategories.mockResolvedValue({ ok: true, ids: [toilet] });
    const result = await saveIncludedCategoriesAction(input([], [washbasin]));
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('サーバーにある候補外リンクは無理に保存せず停止', async () => {
    mocks.readOptionIncludedCategories.mockResolvedValue({ ok: true, ids: [invalidCandidate] });
    const result = await saveIncludedCategoriesAction(input([invalidCandidate], [invalidCandidate]));
    expect(result).toMatchObject({ ok: false, code: 'FAILED' });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    [[invalidCandidate], '候補外'],
    [[own], '自己カテゴリー'],
    [[toilet, toilet], '重複'],
    [['not-a-uuid'], '不正UUID'],
  ])('%s（%s）は入力検証で拒否', async (nextCategoryIds, _label) => {
    const result = await saveIncludedCategoriesAction(input([], nextCategoryIds));
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('読込失敗なら保存へ進まず停止', async () => {
    mocks.readOptionIncludedCategories.mockResolvedValue({ ok: false, error: '読込失敗' });
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'FAILED' });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('保存側（DB の関数・ローカル）のCONFLICTも検出して上書きしない', async () => {
    mocks.save.mockRejectedValue(new mocks.StoreError('CONFLICT', 'この商品の包含設備設定は別の操作で更新されました'));
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('ロック超過（LOCKED）は失敗として返し、自動リトライしない', async () => {
    mocks.save.mockRejectedValue(new mocks.StoreError('LOCKED', '現在ほかの処理で使用中です'));
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'TIMEOUT' });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ['FORBIDDEN', 'FORBIDDEN'],
    ['UNAUTHENTICATED', 'FORBIDDEN'],
    ['VALIDATION', 'FAILED'],
    ['NOT_FOUND', 'FAILED'],
    ['INTERNAL', 'FAILED'],
  ])('保存側の %s は %s として返す（DB の文は画面に出さない）', async (storeCode, resultCode) => {
    mocks.save.mockRejectedValue(new mocks.StoreError(storeCode, 'raw database text'));
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: resultCode });
    expect(result.ok ? '' : result.error).not.toContain('raw database text');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('想定外の例外も失敗として返す', async () => {
    mocks.save.mockRejectedValue(new Error('network down'));
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'FAILED' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('保存結果が送信集合と合わなければ保存成功を返さない', async () => {
    mocks.save.mockResolvedValue([washbasin]);
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'FAILED' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
