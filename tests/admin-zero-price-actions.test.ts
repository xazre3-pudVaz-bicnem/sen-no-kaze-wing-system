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
  bulkUpdateOptionPricesAction,
  publishOptionAction,
  saveOptionAction,
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
  image_url: null,
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

function redirectAsThrow() {
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error('REDIRECT:' + url);
  });
}

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

describe('0円商品のServer Actionガード', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireStaff.mockResolvedValue({ id: 'admin', role: 'admin' });
    mocks.requireCatalogEditor.mockResolvedValue({ id: 'admin', role: 'admin' });
    mocks.requireAdmin.mockResolvedValue({ id: 'admin', role: 'admin' });
    redirectAsThrow();
  });

  it('publishOptionActionは通常価格0円を確認なしでPublishedにしない', async () => {
    const store = {
      getOption: vi.fn(async () => option({ status: 'draft', price: 0 })),
      upsertOption: vi.fn(),
    };
    mocks.getStore.mockResolvedValue(store);
    const fd = new FormData();
    fd.set('id', OPTION_ID);

    await expect(publishOptionAction(fd)).rejects.toThrow('REDIRECT:');
    expect(store.upsertOption).not.toHaveBeenCalled();
    const redirectUrl = String(mocks.redirect.mock.calls[0]?.[0] ?? '');
    expect(decodeURIComponent(redirectUrl)).toContain('商品価格が0円です');
  });

  it('publishOptionActionは明示確認済みの通常価格0円をPublishedにできる', async () => {
    const store = {
      getOption: vi.fn(async () => option({ status: 'draft', price: 0 })),
      upsertOption: vi.fn(async (value: unknown) => value),
    };
    mocks.getStore.mockResolvedValue(store);
    const fd = new FormData();
    fd.set('id', OPTION_ID);
    fd.set('confirm_zero_price', 'on');

    await expect(publishOptionAction(fd)).rejects.toThrow('REDIRECT:');
    expect(store.upsertOption).toHaveBeenCalledWith(expect.objectContaining({
      id: OPTION_ID,
      status: 'published',
      price: 0,
      price_on_request: false,
    }));
  });

  it('publishOptionActionは別途見積なら0円確認なしでPublishedにできる', async () => {
    const store = {
      getOption: vi.fn(async () => option({ status: 'draft', price: 0, price_on_request: true })),
      upsertOption: vi.fn(async (value: unknown) => value),
    };
    mocks.getStore.mockResolvedValue(store);
    const fd = new FormData();
    fd.set('id', OPTION_ID);

    await expect(publishOptionAction(fd)).rejects.toThrow('REDIRECT:');
    expect(store.upsertOption).toHaveBeenCalledWith(expect.objectContaining({
      status: 'published',
      price_on_request: true,
    }));
  });

  it('基本情報だけの初回入力からDraftを作成し画像登録位置へ進める', async () => {
    const store = {
      upsertOption: vi.fn(async (value: unknown) => ({
        ...option({ status: 'draft', price: 0 }),
        ...(value as object),
        id: OPTION_ID,
      })),
      setOptionRelations: vi.fn(async () => undefined),
    };
    mocks.getStore.mockResolvedValue(store);

    const fd = new FormData();
    fd.set('id', '');
    fd.set('owner_id', '');
    fd.set('base_model_id', '');
    fd.set('category_id', CATEGORY_ID);
    fd.set('manufacturer', 'TOTO');
    fd.set('name', 'サザナ');
    fd.set('model_no', 'HTV1616USX5');
    fd.set('size_note', '1616');
    fd.set('description', '');
    fd.set('highlight', '');
    fd.set('image_url', '');
    fd.set('price', '0');
    fd.set('selection_type', 'radio');
    fd.set('preview_key', '');
    fd.set('list_price', '');
    fd.set('sort_order', '0');
    fd.set('status', 'draft');

    await expect(saveOptionAction({ ok: false }, fd)).rejects.toThrow('REDIRECT:');

    expect(store.upsertOption).toHaveBeenCalledWith(expect.objectContaining({
      id: null,
      category_id: CATEGORY_ID,
      manufacturer: 'TOTO',
      name: 'サザナ',
      model_no: 'HTV1616USX5',
      size_note: '1616',
      price: 0,
      status: 'draft',
    }));
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/admin/options/' + OPTION_ID + '?step=info&created=1'
    );
  });

  it('見積からの新規商品は下書き作成後も商品登録STEP1を継続する', async () => {
    const store = {
      upsertOption: vi.fn(async (value: unknown) => ({
        ...option({ status: 'draft', price: 100_000 }),
        ...(value as object),
        id: OPTION_ID,
      })),
      setOptionRelations: vi.fn(async () => undefined),
    };
    mocks.getStore.mockResolvedValue(store);
    const fd = validOptionForm();
    fd.set('id', '');
    fd.set('price', '100000');
    fd.set('return_to', '/admin/estimate-templates/template-1?return_section=option');

    await expect(saveOptionAction({ ok: false }, fd)).rejects.toThrow('REDIRECT:');

    expect(store.upsertOption).toHaveBeenCalledWith(expect.objectContaining({
      id: null,
      price: 100_000,
      status: 'draft',
    }));
    const redirectUrl = decodeURIComponent(String(mocks.redirect.mock.calls[0]?.[0] ?? ''));
    expect(redirectUrl).toContain('/admin/options/' + OPTION_ID + '?step=info&created=1&return_to=');
    expect(redirectUrl).toContain('/admin/estimate-templates/template-1?return_section=option');
    expect(redirectUrl).not.toContain('#product-main-media');
    expect(redirectUrl).not.toContain('created_option=');
  });

  it('見積からの商品はPublished化した後にcreated_option付きで元の見積へ戻る', async () => {
    const store = {
      getOption: vi.fn(async () => option({ status: 'draft', price: 100_000 })),
      upsertOption: vi.fn(async (value: unknown) => value),
    };
    mocks.getStore.mockResolvedValue(store);
    const fd = new FormData();
    fd.set('id', OPTION_ID);
    fd.set('return_to', '/admin/estimate-templates/template-1?return_section=option');

    await expect(publishOptionAction(fd)).rejects.toThrow('REDIRECT:');

    expect(store.upsertOption).toHaveBeenCalledWith(expect.objectContaining({
      status: 'published',
    }));
    expect(mocks.redirect).toHaveBeenCalledWith(
      '/admin/estimate-templates/template-1?return_section=option&created_option=' + OPTION_ID
    );
  });

  it('saveOptionActionはPublished正価格→通常価格0円を拒否し、新規アップロード画像だけ後始末する', async () => {
    const store = {
      getOption: vi.fn(async () => option()),
      uploadImage: vi.fn(async () => 'https://example.invalid/new.png'),
      deleteUploadedImage: vi.fn(async () => undefined),
      upsertOption: vi.fn(),
    };
    mocks.getStore.mockResolvedValue(store);
    const fd = validOptionForm();
    fd.set('image_file', new File(['image'], 'new.png', { type: 'image/png' }));

    const result = await saveOptionAction({ ok: false }, fd);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('いったん「下書きへ戻す」');
    expect(store.upsertOption).not.toHaveBeenCalled();
    expect(store.deleteUploadedImage).toHaveBeenCalledTimes(1);
    expect(store.deleteUploadedImage).toHaveBeenCalledWith('https://example.invalid/new.png');
  });

  it('saveOptionActionはURL入力だけなら既存画像を削除しない', async () => {
    const store = {
      getOption: vi.fn(async () => option()),
      deleteUploadedImage: vi.fn(async () => undefined),
      upsertOption: vi.fn(),
    };
    mocks.getStore.mockResolvedValue(store);
    const fd = validOptionForm();
    fd.set('image_url', 'https://example.invalid/existing.png');

    const result = await saveOptionAction({ ok: false }, fd);

    expect(result.ok).toBe(false);
    expect(store.deleteUploadedImage).not.toHaveBeenCalled();
  });

  it('bulkUpdateOptionPricesActionはPublished正価格→通常価格0円を拒否する', async () => {
    const store = {
      listOptions: vi.fn(async () => [option()]),
      updateOptionPrices: vi.fn(),
    };
    mocks.getStore.mockResolvedValue(store);
    const fd = new FormData();
    fd.set('prices.' + OPTION_ID, '0');

    const result = await bulkUpdateOptionPricesAction({ ok: false }, fd);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('一括価格更新から通常価格0円へ変更することはできません');
    expect(store.updateOptionPrices).not.toHaveBeenCalled();
  });

  it('bulkUpdateOptionPricesActionはDraft商品の0円保存と既存Published 0円の0→0を許可する', async () => {
    for (const existing of [
      option({ status: 'draft', price: 100_000 }),
      option({ status: 'published', price: 0, price_on_request: false }),
    ]) {
      const store = {
        listOptions: vi.fn(async () => [existing]),
        updateOptionPrices: vi.fn(async () => undefined),
      };
      mocks.getStore.mockResolvedValue(store);
      const fd = new FormData();
      fd.set('prices.' + OPTION_ID, '0');

      const result = await bulkUpdateOptionPricesAction({ ok: false }, fd);

      expect(result.ok).toBe(true);
      expect(store.updateOptionPrices).toHaveBeenCalledWith([{ id: OPTION_ID, price: 0 }]);
    }
  });
});
