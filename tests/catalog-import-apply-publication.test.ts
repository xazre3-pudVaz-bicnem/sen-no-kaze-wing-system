import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportPlan } from '@/lib/import/catalog-import';
import type { CatalogImportBatch } from '@/lib/data/store';
import type { ProductOption } from '@/lib/domain/types';

const mocks = vi.hoisted(() => ({
  getStore: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/store', () => ({
  getStore: mocks.getStore,
  StoreError: class StoreError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { applyImportPlan } from '@/lib/import/apply';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';

const product = (price: number | null): ImportPlan['products'][number] => ({
  code: 'PROD-1',
  categoryName: 'ユニットバス',
  name: 'テスト商品',
  manufacturer: null,
  modelNo: null,
  sizeNote: null,
  listPrice: null,
  price,
  description: null,
  highlight: null,
  imageFile: null,
  sortOrder: 1,
});

const plan = (price: number | null): ImportPlan => ({
  categories: [],
  products: [product(price)],
  choices: [],
  images: [],
  warnings: [],
});

const existingOption = (patch: Partial<ProductOption> = {}): ProductOption => ({
  id: PRODUCT_ID,
  base_model_id: null,
  category_id: CATEGORY_ID,
  code: 'prod-1',
  name: '既存商品',
  description: null,
  price: 100_000,
  price_on_request: false,
  image_url: null,
  selection_type: 'radio',
  is_required: false,
  is_default: false,
  is_installation: false,
  spec_codes: [],
  owner_id: null,
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
  ...patch,
});

function setupStore(existing: ProductOption[] = []) {
  let appliedBatch: CatalogImportBatch | null = null;
  const store = {
    listCategories: vi.fn(async () => [
      {
        id: CATEGORY_ID,
        code: 'ub',
        name: 'ユニットバス',
        selection_mode: 'single',
      },
    ]),
    listOptions: vi.fn(async () => existing),
    applyCatalogImport: vi.fn(async (batch: CatalogImportBatch) => {
      appliedBatch = batch;
    }),
    listReferencedCatalogImportImageUrls: vi.fn(async () => []),
    deleteUnreferencedCatalogImportImages: vi.fn(async () => 0),
  };
  mocks.getStore.mockResolvedValue(store);
  return {
    store,
    getBatch: (): CatalogImportBatch => {
      if (!appliedBatch) throw new Error('Import batch was not applied');
      return appliedBatch;
    },
  };
}

describe('Excel一括登録の0円公開ガード', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('新規の通常価格0円はPublishedにせずDraftで登録する', async () => {
    const { getBatch } = setupStore();

    const result = await applyImportPlan(plan(0), new Map());

    expect(getBatch().options[0]).toMatchObject({
      price: 0,
      price_on_request: false,
      status: 'draft',
    });
    expect(result.warnings.some((message) => message.includes('通常価格0円のため下書き'))).toBe(true);
  });

  it('価格空欄は別途見積として従来どおりPublishedにできる', async () => {
    const { getBatch } = setupStore();

    await applyImportPlan(plan(null), new Map());

    expect(getBatch().options[0]).toMatchObject({
      price: 0,
      price_on_request: true,
      status: 'published',
    });
  });

  it('Published正価格の商品をImportから通常価格0円へ変更する場合は一括登録を中止する', async () => {
    const { store } = setupStore([existingOption()]);

    await expect(applyImportPlan(plan(0), new Map())).rejects.toThrow(
      'Excel一括登録から通常価格0円へ変更することはできません'
    );
    expect(store.applyCatalogImport).not.toHaveBeenCalled();
  });

  it('既に通常価格0円でPublishedの商品は互換性を維持する', async () => {
    const { getBatch } = setupStore([
      existingOption({ price: 0, price_on_request: false, status: 'published' }),
    ]);

    await applyImportPlan(plan(0), new Map());

    expect(getBatch().options[0]).toMatchObject({
      price: 0,
      price_on_request: false,
      status: 'published',
    });
  });
});
