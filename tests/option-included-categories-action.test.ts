import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getStore: vi.fn(),
  isLocalMode: vi.fn(),
  readOptionIncludedCategories: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/data/store', () => ({ getStore: mocks.getStore, isLocalMode: mocks.isLocalMode }));
vi.mock('@/lib/data/option-included-categories', () => ({ readOptionIncludedCategories: mocks.readOptionIncludedCategories }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { saveIncludedCategoriesAction } from '@/lib/actions/option-included-categories';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const optionId = uuid(1);
const own = uuid(2);
const toilet = uuid(3);
const washbasin = uuid(4);
const invalidCandidate = uuid(5);

const input = (expectedCategoryIds: string[], nextCategoryIds: string[]) => ({
  optionId, expectedCategoryIds, nextCategoryIds,
});

describe('商品に含まれる設備：Server Actionの権限・競合・RPC境界', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isLocalMode.mockReturnValue(false);
    mocks.getSessionUser.mockResolvedValue({ id: uuid(9), role: 'admin' });
    mocks.getStore.mockResolvedValue({
      getOption: vi.fn(async () => ({ id: optionId, category_id: own, status: 'draft' })),
      listCategories: vi.fn(async () => [
        { id: own, code: 'ub', name: '浴室', status: 'published' },
        { id: toilet, code: 'toilet', name: 'トイレ', status: 'published' },
        { id: washbasin, code: 'washbasin', name: '洗面', status: 'published' },
      ]),
    });
    mocks.readOptionIncludedCategories.mockResolvedValue({ ok: true, ids: [] });
    mocks.rpc.mockImplementation(async (_name: string, params: { p_next_category_ids: string[] }) => ({
      data: params.p_next_category_ids, error: null,
    }));
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
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
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('本部でも浴室以外の商品は書き込めない', async () => {
    mocks.getStore.mockResolvedValue({
      getOption: vi.fn(async () => ({ id: optionId, category_id: own })),
      listCategories: vi.fn(async () => [
        { id: own, code: 'toilet', status: 'published' },
        { id: toilet, code: 'toilet', status: 'published' },
        { id: washbasin, code: 'washbasin', status: 'published' },
      ]),
    });
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('空集合も合法。ユーザーセッションRPCで更新して結果を照合', async () => {
    const result = await saveIncludedCategoriesAction(input([], []));
    expect(result).toEqual({ ok: true, savedIds: [] });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('set_option_included_categories', {
      p_option_id: optionId,
      p_expected_category_ids: [],
      p_next_category_ids: [],
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/options/' + optionId);
  });

  it('両方を保存するとカテゴリーID配列だけを渡す', async () => {
    const result = await saveIncludedCategoriesAction(input([], [washbasin, toilet]));
    expect(result).toEqual({ ok: true, savedIds: [toilet, washbasin] });
    expect(mocks.rpc).toHaveBeenCalledWith('set_option_included_categories', expect.objectContaining({
      p_expected_category_ids: [],
      p_next_category_ids: [toilet, washbasin],
    }));
  });

  it('画面を開いた後に別操作が先行したらCONFLICT、RPCは呼ばない', async () => {
    mocks.readOptionIncludedCategories.mockResolvedValue({ ok: true, ids: [toilet] });
    const result = await saveIncludedCategoriesAction(input([], [washbasin]));
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('サーバーにある候補外リンクは無理に保存せず停止', async () => {
    mocks.readOptionIncludedCategories.mockResolvedValue({ ok: true, ids: [invalidCandidate] });
    const result = await saveIncludedCategoriesAction(input([invalidCandidate], [invalidCandidate]));
    expect(result).toMatchObject({ ok: false, code: 'FAILED' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [[invalidCandidate], '候補外'],
    [[own], '自己カテゴリー'],
    [[toilet, toilet], '重複'],
    [['not-a-uuid'], '不正UUID'],
  ])('%s（%s）は入力検証で拒否', async (nextCategoryIds) => {
    const result = await saveIncludedCategoriesAction(input([], nextCategoryIds));
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('読込失敗ならRPCへ進まず停止', async () => {
    mocks.readOptionIncludedCategories.mockResolvedValue({ ok: false, error: '読込失敗' });
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'FAILED' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('DB RPCのCONFLICTも検出して上書きしない', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'CONFLICT: changed' } });
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('ロック超過は失敗として返し、自動リトライしない', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '55P03', message: 'canceling statement due to lock timeout' } });
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'TIMEOUT' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('RPCレスポンスが送信集合と合わなければ保存成功を返さない', async () => {
    mocks.rpc.mockResolvedValue({ data: [washbasin], error: null });
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'FAILED' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('ローカル検証モードで本番保存を模擬しない', async () => {
    mocks.isLocalMode.mockReturnValue(true);
    const result = await saveIncludedCategoriesAction(input([], [toilet]));
    expect(result).toMatchObject({ ok: false, code: 'FAILED' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
