import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportPlan } from '@/lib/import/catalog-import';
import type { CatalogImportBatch } from '@/lib/data/store';
import type { OptionVariantChoice, ProductOption } from '@/lib/domain/types';

/**
 * v2.5 PR-A3 の原価の決まりは「本部商品の原価」だけに掛ける（2026-10-29 先方の回答）。
 * 本部商品の外（いまの作りでは旧フリー商品）と、商品の一括登録そのものは今までどおり。
 */

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
import { canEditProductCost, isHqCostProduct, withoutHqOptionCosts } from '@/lib/domain/option-cost-access';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

const HQ_CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const FREE_CATEGORY_ID = '33333333-3333-4333-8333-333333333333';
const EXISTING_ID = '11111111-1111-4111-8111-111111111111';

/** lib/import/apply.ts と同じ決まりの ID（同じ Excel の行は同じ ID） */
function stableId(prefix: string, key: string): string {
  const h = createHash('sha256').update(`${prefix}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const product = (code: string, categoryName: string, price: number | null): ImportPlan['products'][number] => ({
  code,
  categoryName,
  name: `商品 ${code}`,
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

const choice = (productCode: string, choiceName: string, extraPrice: number | null): ImportPlan['choices'][number] => ({
  productCode,
  groupName: 'サイズ',
  choiceName,
  kind: 'option',
  extraPrice,
  priceOnRequest: false,
  imageFile: null,
  note: null,
  sortOrder: 1,
});

const existingOption = (patch: Partial<ProductOption> = {}): ProductOption => ({
  id: EXISTING_ID,
  base_model_id: null,
  category_id: HQ_CATEGORY_ID,
  code: 'hq-1',
  name: '既存の本部商品',
  description: null,
  price: 120_000,
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

function setupStore(existing: ProductOption[], existingChoices: OptionVariantChoice[] = []) {
  let appliedBatch: CatalogImportBatch | null = null;
  const store = {
    listCategories: vi.fn(async () => [
      { id: HQ_CATEGORY_ID, code: 'ub', name: 'ユニットバス', selection_mode: 'single' },
      { id: FREE_CATEGORY_ID, code: 'free-product', name: 'フリー商品', selection_mode: 'multi' },
    ]),
    listOptions: vi.fn(async () => existing),
    getOptionVariants: vi.fn(async () => ({ groups: [], choices: existingChoices })),
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

describe('本部商品の判定（原価の決まりを掛ける範囲）', () => {
  it('旧フリー商品は本部商品の外。カテゴリーが分からない商品は本部商品として扱う（原価を見せない側）', () => {
    expect(isHqCostProduct('ub')).toBe(true);
    expect(isHqCostProduct('free-product')).toBe(false);
    expect(isHqCostProduct(undefined)).toBe(true);
    expect(isHqCostProduct(null)).toBe(true);
  });

  it('本部以外でも、本部商品の外の金額の欄は今までどおり出す', () => {
    const notHq = { available: true, canManage: false };
    expect(canEditProductCost(notHq, 'ub')).toBe(false);
    expect(canEditProductCost(notHq, 'free-product')).toBe(true);
    expect(canEditProductCost({ available: true, canManage: true }, 'ub')).toBe(true);
    // 仕組みが無い間（ローカル・未適用）は誰でも
    expect(canEditProductCost({ available: false, canManage: false }, 'ub')).toBe(true);
    // 権限の確認に失敗したら本部商品は隠す（旧フリー商品は今までどおり）
    expect(canEditProductCost({ available: true, canManage: false, error: true }, 'ub')).toBe(false);
    expect(canEditProductCost({ available: true, canManage: false, error: true }, 'free-product')).toBe(true);
  });

  it('一覧をクライアントへ渡すとき、本部以外には本部商品の原価だけを外す', () => {
    const codes = new Map([
      [HQ_CATEGORY_ID, 'ub'],
      [FREE_CATEGORY_ID, 'free-product'],
    ]);
    const rows = [
      { id: 'a', category_id: HQ_CATEGORY_ID, price: 100 },
      { id: 'b', category_id: FREE_CATEGORY_ID, price: 200 },
    ];
    expect(withoutHqOptionCosts(rows, { available: true, canManage: false }, codes)).toEqual([
      { id: 'a', category_id: HQ_CATEGORY_ID, price: 0 },
      { id: 'b', category_id: FREE_CATEGORY_ID, price: 200 },
    ]);
    expect(withoutHqOptionCosts(rows, { available: true, canManage: true }, codes)).toBe(rows);
  });
});

describe('商品の一括登録（Excel）：本部以外は本部商品の金額を反映しない', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('既存の本部商品と選択肢は今の金額のまま、新しい本部商品は金額未登録の下書き、新しい追加の選択肢は別途見積（原価差額が未登録）', async () => {
    const keptChoiceId = stableId('vchoice', 'HQ-1::サイズ::大');
    const existingChoice: OptionVariantChoice = {
      id: keptChoiceId,
      group_id: stableId('vgroup', 'HQ-1::サイズ'),
      code: '大',
      name: '大',
      kind: 'option',
      extra_price: 8_000,
      price_on_request: false,
      image_url: null,
      note: null,
      sort_order: 1,
      status: 'published',
    };
    const { getBatch, store } = setupStore([existingOption()], [existingChoice]);
    const result = await applyImportPlan(
      {
        categories: [],
        products: [product('HQ-1', 'ユニットバス', 999_999), product('HQ-NEW', 'ユニットバス', 50_000)],
        choices: [choice('HQ-1', '大', 1), choice('HQ-1', '特大', 30_000), choice('HQ-NEW', '小', 5_000)],
        images: [],
        warnings: [],
      },
      new Map(),
      { protectHqCost: true }
    );

    const batch = getBatch();
    const kept = batch.options.find((row) => row.id === EXISTING_ID);
    expect(kept).toMatchObject({ price: 120_000, price_on_request: false, status: 'published' });
    const created = batch.options.find((row) => row.id !== EXISTING_ID);
    expect(created).toMatchObject({ price: 0, price_on_request: false, status: 'draft' });
    expect(result.warnings.some((w) => w.includes('商品標準原価が未登録のため下書きで登録しました'))).toBe(true);

    const big = batch.variantChoices.find((row) => row.id === keptChoiceId);
    expect(big).toMatchObject({ extra_price: 8_000, price_on_request: false });
    const others = batch.variantChoices.filter((row) => row.id !== keptChoiceId);
    // 0 円で公開すると旧シミュレーターで追加料金なしで選べてしまうので、原価差額が未登録＝別途見積にする
    expect(others.every((row) => row.extra_price === 0 && row.price_on_request === true)).toBe(true);
    // 今の選択肢の金額は、既存の本部商品だけ読む
    expect(store.getOptionVariants).toHaveBeenCalledTimes(1);
    expect(store.getOptionVariants).toHaveBeenCalledWith(EXISTING_ID);
  });

  it('本部（または原価の仕組みが無い間）は今までどおり Excel の金額を反映する', async () => {
    const { getBatch, store } = setupStore([existingOption()]);
    await applyImportPlan(
      {
        categories: [],
        products: [product('HQ-1', 'ユニットバス', 150_000)],
        choices: [choice('HQ-1', '大', 9_000)],
        images: [],
        warnings: [],
      },
      new Map()
    );
    const batch = getBatch();
    expect(batch.options[0]).toMatchObject({ price: 150_000, status: 'published' });
    expect(batch.variantChoices[0]).toMatchObject({ extra_price: 9_000 });
    expect(store.getOptionVariants).not.toHaveBeenCalled();
  });

  it('本部商品の外（既存の旧フリー商品）は、本部以外の一括登録でも Excel の金額を反映する', async () => {
    const { getBatch } = setupStore([existingOption({ id: EXISTING_ID, code: 'free-1', category_id: FREE_CATEGORY_ID, price: 3_000 })]);
    await applyImportPlan(
      {
        categories: [],
        products: [product('FREE-1', 'フリー商品', 4_500)],
        choices: [],
        images: [],
        warnings: [],
      },
      new Map(),
      { protectHqCost: true }
    );
    expect(getBatch().options[0]).toMatchObject({ id: EXISTING_ID, price: 4_500 });
  });
});

describe('原価 Version の取り込み：本部商品だけ', () => {
  it('DB の関数は本部商品の外（旧フリー商品）の商品・選択肢を取り込まない', () => {
    const migration = read('supabase/migrations/20261027100000_v25_initial_cost_import.sql');
    // 本部商品かどうかは A1 の option_is_hq_cost_product（RPC と同じ判定）
    expect(migration).toContain('if not public.option_is_hq_cost_product(v_id) then');
    expect(migration).toContain('if not public.option_is_hq_cost_product(v_choice.option_id) then');
    expect(migration).toContain("to_regprocedure('public.option_is_hq_cost_product(uuid)') is null");
  });

  it('取り込みの一覧にも本部商品の外を出さない', () => {
    const loader = read('lib/data/option-cost-import.ts');
    expect(loader).toContain('const optionRows = allOptionRows.filter((row) => isHqCostProduct(categoryCode.get(row.category_id)));');
    expect(read('app/admin/options/cost-import/page.tsx')).toContain('本部商品の外（旧フリー商品）は対象にしません。');
  });
});
