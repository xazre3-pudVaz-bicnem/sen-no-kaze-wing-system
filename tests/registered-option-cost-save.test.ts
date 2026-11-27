import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductOption } from '@/lib/domain/types';

const mocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  requireAdmin: vi.fn(),
  requireCatalogEditor: vi.fn(),
  requireStaff: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  costFailure: false,
  costThrows: false,
  choiceMode: 'success',
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
  updateTag: mocks.updateTag,
}));
vi.mock('@/lib/auth/session', () => ({
  requireAdmin: mocks.requireAdmin,
  requireCatalogEditor: mocks.requireCatalogEditor,
  requireStaff: mocks.requireStaff,
}));
vi.mock('@/lib/data/public-catalog', () => ({
  CATALOG_TAG: 'catalog',
}));
vi.mock('@/lib/mail/send', () => ({
  flushNotificationsSafely: vi.fn(),
}));
// 原価の Version の記録（v2.5 PR-A3）は、このテストでは「仕組みが無い」扱い（従来どおりの保存）
vi.mock('@/lib/data/option-cost-recording', () => ({
  getCostRecordingAccess: vi.fn(async () => ({ available: false, canManage: false })),
  getCostAccessForProduct: vi.fn(async () => ({ available: true, canManage: true })),
  NO_COST_RECORDING: { available: false, canManage: false },
  canEditCostField: (access: { available: boolean; canManage: boolean; error?: boolean }) => !access.error && (!access.available || access.canManage),
  COST_ACCESS_ERROR_MESSAGE: '原価の権限を確認できませんでした。',
  recordPublishedOptionCost: vi.fn(async () => {
    if (mocks.costThrows) throw new Error('price read failed');
    return mocks.costFailure ? { status: 'error', message: 'conflict' } : { status: 'recorded' };
  }),
  recordPublishedChoiceCosts: vi.fn(async () => { if (mocks.choiceMode === 'throw' || mocks.costThrows) throw new Error('choice read failed'); return mocks.choiceMode === 'error' || mocks.costFailure ? { status: 'error', message: 'conflict' } : { status: 'recorded' }; }),
  costRecordingNotice: (result: {status: string}) => result.status === 'error' ? '商品は保存しましたが、原価の Version を記録できませんでした' : null,
}));
vi.mock('@/lib/data/store', () => ({
  getStore: mocks.getStore,
  isLocalMode: vi.fn(() => false),
  StoreError: class StoreError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import {
  saveOptionAction,
  saveVariantChoiceAction,
  publishOptionAction,
} from '@/lib/actions/admin';

const OPTION_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';

const option = (patch: Partial<ProductOption> = {}): ProductOption => ({
  id: OPTION_ID,
  base_model_id: null,
  category_id: CATEGORY_ID,
  code: 'opt-test',
  name: 'テスト商品',
  description: null,
  price: 100_000,
  image_url: 'https://example.invalid/main.png',
  selection_type: 'radio',
  is_required: false,
  is_default: false,
  is_installation: false,
  price_on_request: false,
  spec_codes: [],
  owner_id: null,
  manufacturer: null,
  model_no: null,
  size_note: null,
  list_price: null,
  highlight: null,
  preview_key: null,
  affects_views: [],
  sort_order: 0,
  status: 'published',
  created_at: '',
  updated_at: '',
  ...patch,
});

function validOptionForm() {
  const fd = new FormData();
  fd.set('id', OPTION_ID);
  fd.set('base_model_id', '');
  fd.set('category_id', CATEGORY_ID);
  fd.set('name', 'テスト商品');
  fd.set('description', '');
  fd.set('price', '0');
  fd.set('image_url', '');
  fd.set('selection_type', 'radio');
  fd.set('preview_key', '');
  fd.set('sort_order', '0');
  fd.set('status', 'published');
  fd.set('owner_id', '');
  fd.set('manufacturer', '');
  fd.set('model_no', '');
  fd.set('size_note', '');
  fd.set('list_price', '');
  fd.set('highlight', '');
  return fd;
}

describe('登録済み商品の保存と原価Version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.costThrows = false;
    mocks.requireStaff.mockResolvedValue({ id: 'admin', role: 'admin' });
  });
  it('商品保存後に原価読取が例外を投げても保存済みの警告を返す', async () => {
    mocks.costFailure = false;
    mocks.costThrows = true;
    const store = {
      getOption: vi.fn(async () => option()),
      upsertOption: vi.fn(async (value: unknown) => value),
      setOptionRelations: vi.fn(async () => undefined),
    };
    mocks.getStore.mockResolvedValue(store);
    const form = validOptionForm();
    form.set('price', '100000');
    form.set('image_url', 'https://example.invalid/main.png');
    const result = await saveOptionAction({ ok: false }, form);
    expect(store.upsertOption).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.costRecordingFailed).toBe(true);
    expect(result.message).toContain('商品は保存しましたが');
  });
  it('商品情報保存後に関連設定が失敗したら保存済みを通知する', async () => {
    const store = { getOption: vi.fn(async () => option()), upsertOption: vi.fn(async (value: unknown) => value), setOptionRelations: vi.fn(async () => { throw new Error('relations'); }) };
    mocks.getStore.mockResolvedValue(store);
    const form = validOptionForm(); form.set('price', '100000'); form.set('image_url', 'https://example.invalid/main.png');
    const result = await saveOptionAction({ ok: false }, form);
    expect(store.upsertOption).toHaveBeenCalledOnce(); expect(result.ok).toBe(false);
    expect(result.costRecordingFailed).toBe(true); expect(result.error).toContain('商品情報は保存されました');
  });
  it.each([false, true])('記録失敗=%s を保存成功と分けて返す', async (failed) => {
    mocks.costFailure = failed;
    const store = {
      getOption: vi.fn(async () => option()),
      upsertOption: vi.fn(async (value: unknown) => value),
      setOptionRelations: vi.fn(async () => undefined),
    };
    mocks.getStore.mockResolvedValue(store);
    const form = validOptionForm();
    form.set('price', '100000');
    form.set('image_url', 'https://example.invalid/main.png');
    const result = await saveOptionAction({ ok: false }, form);
    expect(store.upsertOption).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    expect(result.costRecordingFailed).toBe(failed);
    if (failed) expect(result.message).toContain('商品は保存しましたが');
  });
});


describe('選択肢保存と公開の部分成功', () => {
  const groupId = '33333333-3333-4333-8333-333333333333';
  beforeEach(() => {
    vi.clearAllMocks(); mocks.costThrows = false; mocks.costFailure = false; mocks.choiceMode = 'success';
    mocks.requireStaff.mockResolvedValue({ id: 'admin', role: 'admin' });
    mocks.requireCatalogEditor.mockResolvedValue({ id: 'admin', role: 'admin' });
    mocks.redirect.mockImplementation((url: string) => { throw new Error('REDIRECT:' + url); });
  });
  function choiceForm(name = '白') {
    const form = new FormData();
    form.set('option_id', OPTION_ID); form.set('group_id', groupId); form.set('name', name);
    form.set('kind', 'option'); form.set('extra_price', '0'); form.set('status', 'published');
    form.set('image_file', new File(['image'], 'a.png', { type: 'image/png' }));
    return form;
  }
  function choiceStore() {
    return {
      getOption: vi.fn(async () => option()),
      getOptionVariants: vi.fn(async () => ({ groups: [{ id: groupId, code: 'color' }], choices: [] })),
      uploadImage: vi.fn(async () => 'https://example.invalid/upload.png'),
      deleteUploadedImage: vi.fn(async () => undefined),
      upsertVariantChoice: vi.fn(async () => undefined),
    };
  }
  const TOILET_ID = '55555555-5555-4555-8555-555555555555';
  const WASHBASIN_ID = '66666666-6666-4666-8666-666666666666';
  // 公開（本部）は、商品のカテゴリーが浴室（ub）なら含まれる設備（#631）を DataStore から読み直して確かめる
  function publishStore(categoryCode = 'kitchen', includedIds: string[] = [], categoryStatus = 'published') {
    return {
      getOption: vi.fn(async () => option({ status: 'draft' })),
      upsertOption: vi.fn(async (x: unknown) => x),
      listCategories: vi.fn(async () => [
        { id: CATEGORY_ID, code: categoryCode, status: categoryStatus },
        { id: TOILET_ID, code: 'toilet', status: 'published' },
        { id: WASHBASIN_ID, code: 'washbasin', status: 'published' },
      ]),
      listOptionIncludedCategoryIds: vi.fn(async () => includedIds),
    };
  }
  it.each(['success', 'error', 'throw'])('保存後の原価記録 %s は画像を保持する', async (mode) => {
    const store = choiceStore(); mocks.getStore.mockResolvedValue(store);
    mocks.costFailure = mode === 'error'; mocks.costThrows = mode === 'throw';
    const result = await saveVariantChoiceAction({ ok: false }, choiceForm());
    expect(store.upsertVariantChoice).toHaveBeenCalledOnce();
    expect(store.deleteUploadedImage).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.costRecordingFailed).toBe(mode !== 'success');
  });
  it('保存前の入力エラーは未参照画像を削除する', async () => {
    const store = choiceStore(); mocks.getStore.mockResolvedValue(store);
    const result = await saveVariantChoiceAction({ ok: false }, choiceForm(''));
    expect(result.ok).toBe(false); expect(store.upsertVariantChoice).not.toHaveBeenCalled();
    expect(store.deleteUploadedImage).toHaveBeenCalledWith('https://example.invalid/upload.png');
  });
  it('書込み結果が不明なとき画像を残し再操作前の確認を促す', async () => {
    const store = choiceStore(); store.upsertVariantChoice.mockRejectedValue(new Error('connection lost'));
    mocks.getStore.mockResolvedValue(store);
    const result = await saveVariantChoiceAction({ ok: false }, choiceForm());
    expect(result.ok).toBe(false); expect(result.error).toContain('保存結果を確認できません');
    expect(result.costRecordingFailed).toBe(true);
    expect(store.deleteUploadedImage).not.toHaveBeenCalled();
  });
  it.each(['/admin/ledger', '/admin/estimate-templates/legacy', '/admin/estimate-templates/44444444-4444-4444-8444-444444444444'])('公開後の記録失敗を %s に引き継ぐ', async (returnTo) => {
    const store = publishStore();
    mocks.getStore.mockResolvedValue(store); mocks.costFailure = true;
    const form = new FormData(); form.set('id', OPTION_ID); form.set('return_to', returnTo);
    await expect(publishOptionAction(form)).rejects.toThrow('REDIRECT:');
    const url = new URL(String(mocks.redirect.mock.calls[0][0]), 'https://wing.invalid');
    expect(url.pathname).toBe(returnTo); expect(url.searchParams.get('cost_warning')).toContain('商品は公開済みです');
    expect(store.upsertOption).toHaveBeenCalledOnce();
  });
  it.each(['error', 'throw'])('公開時に商品Version成功後の選択肢Version %s 失敗を警告する', async (mode) => {
    const store = publishStore();
    mocks.getStore.mockResolvedValue(store); mocks.choiceMode = mode;
    const form = new FormData(); form.set('id', OPTION_ID); form.set('return_to', '/admin/ledger');
    await expect(publishOptionAction(form)).rejects.toThrow('REDIRECT:');
    const url = new URL(String(mocks.redirect.mock.calls[0][0]), 'https://wing.invalid');
    expect(url.searchParams.get('cost_warning')).toContain('商品は公開済みです');
    expect(store.upsertOption).toHaveBeenCalledOnce();
  });
  it('公開後のキャッシュ更新エラーでも公開済み警告を返す', async () => {
    const store = publishStore();
    mocks.getStore.mockResolvedValue(store); mocks.revalidatePath.mockImplementationOnce(() => { throw new Error('cache'); });
    const form = new FormData(); form.set('id', OPTION_ID); form.set('return_to', '/admin/ledger');
    await expect(publishOptionAction(form)).rejects.toThrow('REDIRECT:');
    const url = new URL(String(mocks.redirect.mock.calls[0][0]), 'https://wing.invalid');
    expect(url.searchParams.get('cost_warning')).toContain('商品は公開済みです');
  });
  it('公開後の例外と未対応の戻り先は商品画面で警告する', async () => {
    const store = publishStore();
    mocks.getStore.mockResolvedValue(store); mocks.costThrows = true;
    const form = new FormData(); form.set('id', OPTION_ID); form.set('return_to', '/admin/estimate-templates/new');
    await expect(publishOptionAction(form)).rejects.toThrow('REDIRECT:');
    const url = new URL(String(mocks.redirect.mock.calls[0][0]), 'https://wing.invalid');
    expect(url.pathname).toBe('/admin/options/' + OPTION_ID); expect(url.searchParams.get('cost_warning')).toContain('商品は公開済みです');
  });
  it('浴室の商品：STEP 2 で確かめた含まれる設備と、今の保存内容が違えば公開しない', async () => {
    const store = publishStore('ub', [TOILET_ID]); mocks.getStore.mockResolvedValue(store);
    const form = new FormData(); form.set('id', OPTION_ID); form.set('return_to', '/admin/ledger');
    form.set('included_categories_expected_ids', JSON.stringify([]));
    await expect(publishOptionAction(form)).rejects.toThrow('REDIRECT:');
    const url = new URL(String(mocks.redirect.mock.calls[0][0]), 'https://wing.invalid');
    expect(url.pathname).toBe('/admin/options/' + OPTION_ID);
    expect(url.searchParams.get('error')).toContain('設備包含設定が確認後に変更された');
    expect(store.listOptionIncludedCategoryIds).toHaveBeenCalledWith({ id: 'admin', role: 'admin' }, OPTION_ID);
    expect(store.upsertOption).not.toHaveBeenCalled();
  });
  it('浴室の商品：含まれる設備を読めなければ公開しない', async () => {
    const store = publishStore('ub'); store.listOptionIncludedCategoryIds.mockRejectedValue(new Error('read failed'));
    mocks.getStore.mockResolvedValue(store);
    const form = new FormData(); form.set('id', OPTION_ID); form.set('return_to', '/admin/ledger');
    form.set('included_categories_expected_ids', JSON.stringify([]));
    await expect(publishOptionAction(form)).rejects.toThrow('REDIRECT:');
    const url = new URL(String(mocks.redirect.mock.calls[0][0]), 'https://wing.invalid');
    expect(url.pathname).toBe('/admin/options/' + OPTION_ID);
    expect(url.searchParams.get('error')).toContain('設備包含設定を確認できません');
    expect(store.upsertOption).not.toHaveBeenCalled();
  });
  it('浴室の商品：STEP 2 の集合が今の保存内容と同じなら（並びは問わない）公開へ進む', async () => {
    const store = publishStore('ub', [TOILET_ID, WASHBASIN_ID]); mocks.getStore.mockResolvedValue(store);
    const form = new FormData(); form.set('id', OPTION_ID); form.set('return_to', '/admin/ledger');
    form.set('included_categories_expected_ids', JSON.stringify([WASHBASIN_ID, TOILET_ID]));
    await expect(publishOptionAction(form)).rejects.toThrow('REDIRECT:');
    const url = new URL(String(mocks.redirect.mock.calls[0][0]), 'https://wing.invalid');
    expect(url.pathname).toBe('/admin/ledger');
    expect(url.searchParams.get('created_option')).toBe(OPTION_ID);
    expect(store.upsertOption).toHaveBeenCalledOnce();
  });
  it('浴室のカテゴリーが非公開なら、画面と同じく含まれる設備の確認なしで公開へ進む（確認情報が無くても止めない）', async () => {
    const store = publishStore('ub', [], 'draft'); mocks.getStore.mockResolvedValue(store);
    const form = new FormData(); form.set('id', OPTION_ID); form.set('return_to', '/admin/ledger');
    await expect(publishOptionAction(form)).rejects.toThrow('REDIRECT:');
    const url = new URL(String(mocks.redirect.mock.calls[0][0]), 'https://wing.invalid');
    expect(url.pathname).toBe('/admin/ledger');
    expect(url.searchParams.get('created_option')).toBe(OPTION_ID);
    expect(store.listOptionIncludedCategoryIds).not.toHaveBeenCalled();
    expect(store.upsertOption).toHaveBeenCalledOnce();
  });
});
