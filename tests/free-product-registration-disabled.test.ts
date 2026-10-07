import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStore } from '@/lib/data/store';
import type { ProductOption } from '@/lib/domain/types';
import type { ImportPlan } from '@/lib/import/catalog-import';
import { seedCategories } from '@/lib/seed/catalog';

const mocks = vi.hoisted(() => ({
  getStore: vi.fn(),
  requireAdmin: vi.fn(),
  requireCatalogEditor: vi.fn(),
  requireStaff: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
  updateTag: mocks.updateTag,
}));
vi.mock('@/lib/auth/session', () => ({
  requireAdmin: mocks.requireAdmin,
  requireCatalogEditor: mocks.requireCatalogEditor,
  requireStaff: mocks.requireStaff,
}));
vi.mock('@/lib/data/public-catalog', () => ({ CATALOG_TAG: 'catalog' }));
vi.mock('@/lib/mail/send', () => ({ flushNotificationsSafely: vi.fn() }));
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

import { saveOptionAction } from '@/lib/actions/admin';
import { applyImportPlan } from '@/lib/import/apply';

const freeCategory = seedCategories.find((category) => category.code === 'free-product')!;
const normalCategory = seedCategories.find((category) => category.code === 'toilet')!;

function importPlan(categoryName: string): ImportPlan {
  return {
    categories: [],
    products: [
      {
        code: 'new-import-product',
        categoryName,
        name: '取込商品',
        manufacturer: null,
        modelNo: null,
        sizeNote: null,
        listPrice: null,
        price: 100_000,
        description: null,
        highlight: null,
        imageFile: null,
        sortOrder: 1,
      },
    ],
    choices: [],
    images: [],
    warnings: [],
  };
}

function legacyFreeOption(): ProductOption {
  return {
    id: '90000000-0000-4000-8000-000000000001',
    base_model_id: null,
    category_id: freeCategory.id,
    code: 'new-import-product',
    name: '旧フリー商品',
    description: null,
    price: 100_000,
    image_url: null,
    selection_type: 'checkbox',
    is_required: false,
    is_default: false,
    is_installation: true,
    price_on_request: false,
    spec_codes: [],
    owner_id: 'dealer-1',
    manufacturer: null,
    model_no: null,
    size_note: null,
    list_price: null,
    highlight: null,
    preview_key: null,
    affects_views: [],
    sort_order: 1,
    status: 'published',
    created_at: '',
    updated_at: '',
  };
}

function newOptionForm(categoryId: string) {
  const fd = new FormData();
  fd.set('id', '');
  fd.set('base_model_id', '');
  fd.set('category_id', categoryId);
  fd.set('name', '新規商品');
  fd.set('description', '');
  fd.set('price', '100000');
  fd.set('image_url', '');
  fd.set('selection_type', 'radio');
  fd.set('preview_key', '');
  fd.set('sort_order', '0');
  fd.set('status', 'draft');
  fd.set('owner_id', '');
  fd.set('manufacturer', '');
  fd.set('model_no', '');
  fd.set('size_note', '');
  fd.set('list_price', '');
  fd.set('highlight', '');
  return fd;
}

describe('free-product新規登録停止', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireStaff.mockResolvedValue({ id: 'admin', role: 'admin' });
    mocks.requireCatalogEditor.mockResolvedValue({ id: 'admin', role: 'admin' });
    mocks.requireAdmin.mockResolvedValue({ id: 'admin', role: 'admin' });
    mocks.redirect.mockImplementation((url: string) => {
      throw new Error('REDIRECT:' + url);
    });
  });

  it('フリー商品一覧から新規登録導線を出さない', () => {
    const page = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/free-products/page.tsx'), 'utf8');
    expect(page).toContain('フリー商品の新規登録は終了しました');
    expect(page).not.toContain('フリー商品を追加');
    expect(page).not.toContain('/admin/options/new?category=');
    expect(page).toContain('/admin/options/${o.id}');
  });

  it('URL直打ちを含めfree-product指定ではOptionFormへ進めない', () => {
    const page = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/options/new/page.tsx'), 'utf8');
    expect(page).toContain('const freeRegistrationBlocked = requestedFreeCategory || !catalogEditor;');
    expect(page).toContain("registrationCategories.filter((c) => c.code !== FREE_PRODUCT_CATEGORY_CODE)");
    expect(page).toContain('title="フリー商品の新規登録は終了しました"');
    expect(page.indexOf('if (freeRegistrationBlocked)')).toBeLessThan(page.indexOf('<OptionForm'));
  });

  it('saveOptionActionを直接呼んでも新規free-productを作成しない', async () => {
    const store = {
      listCategories: vi.fn(async () => seedCategories),
      upsertOption: vi.fn(),
      uploadImage: vi.fn(),
    };
    mocks.getStore.mockResolvedValue(store);

    const result = await saveOptionAction({ ok: false }, newOptionForm(freeCategory.id));

    expect(result).toEqual({ ok: false, error: 'フリー商品の新規登録は終了しました。' });
    expect(store.listCategories).toHaveBeenCalledTimes(1);
    expect(store.upsertOption).not.toHaveBeenCalled();
    expect(store.uploadImage).not.toHaveBeenCalled();
  });

  it('通常商品の新規登録は従来どおり保存できる', async () => {
    const store = {
      listCategories: vi.fn(async () => seedCategories),
      upsertOption: vi.fn(async (value: unknown) => ({
        ...(value as object),
        id: '11111111-1111-4111-8111-111111111111',
      })),
      setOptionRelations: vi.fn(async () => undefined),
    };
    mocks.getStore.mockResolvedValue(store);

    await expect(saveOptionAction({ ok: false }, newOptionForm(normalCategory.id))).rejects.toThrow('REDIRECT:');
    expect(store.upsertOption).toHaveBeenCalledWith(expect.objectContaining({
      id: null,
      category_id: normalCategory.id,
      status: 'draft',
    }));
  });

  it('Importから新規free-productを作成せず、書込み前に明確なエラーで止める', async () => {
    const store = {
      listCategories: vi.fn(async () => seedCategories),
      listOptions: vi.fn(async () => []),
      applyCatalogImport: vi.fn(),
    };
    mocks.getStore.mockResolvedValue(store as unknown as DataStore);

    await expect(applyImportPlan(importPlan('フリー商品'), new Map())).rejects.toThrow(
      'フリー商品の新規登録は終了しました'
    );
    expect(store.applyCatalogImport).not.toHaveBeenCalled();
  });

  it('Importは既存free-productのUPDATE互換を残す', async () => {
    const existing = legacyFreeOption();
    const store = {
      listCategories: vi.fn(async () => seedCategories),
      listOptions: vi.fn(async () => [existing]),
      applyCatalogImport: vi.fn(async () => undefined),
    };
    mocks.getStore.mockResolvedValue(store as unknown as DataStore);

    const result = await applyImportPlan(importPlan('フリー商品'), new Map());

    expect(result).toMatchObject({ createdProducts: 0, updatedProducts: 1 });
    expect(store.applyCatalogImport).toHaveBeenCalledWith(expect.objectContaining({
      options: [expect.objectContaining({
        id: existing.id,
        category_id: freeCategory.id,
        import_operation: 'UPDATE',
      })],
    }));
  });

  it('商品台帳は引き続きfree-productを正式台帳から分離する', () => {
    const ledger = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');
    expect(ledger).toContain('FREE_PRODUCT_CATEGORY_CODE');
    expect(ledger).toContain('catalogOptions');
  });
});
