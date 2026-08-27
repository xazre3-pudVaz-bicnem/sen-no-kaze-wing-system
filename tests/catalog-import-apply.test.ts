import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogImportBatch, DataStore } from '@/lib/data/store';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';
import { seedCategories, seedOptions } from '@/lib/seed/catalog';
import type { ImportPlan } from '@/lib/import/catalog-import';

const state = vi.hoisted(() => ({ store: null as DataStore | null }));
vi.mock('@/lib/data/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/store')>();
  return { ...actual, getStore: async () => state.store };
});

import { applyImportPlan } from '@/lib/import/apply';
import { LocalStore } from '@/lib/data/local-store';
import { loadDb } from '@/lib/data/local-db';

const clone = <T>(value: T): T => structuredClone(value);

/** 実商品Excelをリポジトリへ置かず、48商品・64グループ・119選択肢を再現する。 */
function largeSyntheticPlan(): ImportPlan {
  const existing = seedOptions.slice(0, 7).map((option) => option.code);
  const codes = [...existing, ...Array.from({ length: 41 }, (_, i) => `synthetic-product-${i + 1}`)];
  const products: ImportPlan['products'] = codes.map((code, i) => ({
    code,
    categoryName: 'トイレ',
    name: `合成商品 ${i + 1}`,
    manufacturer: null,
    modelNo: null,
    sizeNote: null,
    listPrice: null,
    price: i * 1000,
    description: null,
    highlight: null,
    imageFile: null,
    sortOrder: i + 1,
  }));
  const groups = Array.from({ length: 64 }, (_, i) => ({ productCode: codes[i % codes.length], groupName: `選択項目 ${i + 1}` }));
  const choices: ImportPlan['choices'] = Array.from({ length: 119 }, (_, i) => ({
    ...groups[i % groups.length],
    choiceName: `選択肢 ${i + 1}`,
    kind: 'option' as const,
    extraPrice: i * 100,
    priceOnRequest: false,
    imageFile: null,
    note: null,
    sortOrder: i + 1,
  }));
  return { categories: [], products, choices, images: [], warnings: [] };
}

const fullPlan = largeSyntheticPlan();

class AtomicCatalogStore {
  categories: OptionCategory[];
  options: ProductOption[];
  groups: OptionVariantGroup[] = [];
  choices: OptionVariantChoice[] = [];
  fail = false;
  calls = 0;

  constructor(options: ProductOption[] = []) {
    this.categories = clone(seedCategories);
    this.options = clone(options);
  }

  async listCategories() { return clone(this.categories); }
  async listOptions() { return clone(this.options); }
  async applyCatalogImport(batch: CatalogImportBatch) {
    this.calls++;
    const next = {
      options: clone(this.options),
      groups: clone(this.groups),
      choices: clone(this.choices),
    };
    for (const row of batch.options) {
      const i = next.options.findIndex((o) => o.code === row.code);
      const complete = { ...row, created_at: '', updated_at: '' } as ProductOption;
      if (i >= 0) next.options[i] = { ...next.options[i], ...complete, id: next.options[i].id };
      else next.options.push(complete);
    }
    for (const row of batch.variantGroups) {
      const i = next.groups.findIndex((g) => g.id === row.id);
      if (i >= 0) next.groups[i] = row;
      else next.groups.push(row);
    }
    if (this.fail) throw new Error('意図的な選択肢エラー');
    for (const row of batch.variantChoices) {
      const i = next.choices.findIndex((c) => c.id === row.id);
      if (i >= 0) next.choices[i] = row;
      else next.choices.push(row);
    }
    this.options = next.options;
    this.groups = next.groups;
    this.choices = next.choices;
  }
}

function useStore(store: AtomicCatalogStore) {
  state.store = store as unknown as DataStore;
  return store;
}

function oneProductPlan(): ImportPlan {
  const code = 'NEW-IMPORT-PRODUCT';
  return {
    categories: [],
    products: [{
      code,
      categoryName: 'トイレ',
      name: '新規商品',
      manufacturer: null,
      modelNo: null,
      sizeNote: null,
      listPrice: null,
      price: null,
      description: null,
      highlight: null,
      imageFile: 'missing.jpg',
      sortOrder: 1,
    }],
    choices: [{
      productCode: code,
      groupName: '色',
      choiceName: '白',
      kind: 'standard',
      extraPrice: 0,
      priceOnRequest: false,
      imageFile: null,
      note: null,
      sortOrder: 1,
    }],
    images: [],
    warnings: [],
  };
}

describe('商品マスターの原子的な一括登録', () => {
  beforeEach(() => { state.store = null; });

  it('新規商品・選択項目・選択肢を追加し、画像不足は警告だけにする', async () => {
    const store = useStore(new AtomicCatalogStore());
    const result = await applyImportPlan(oneProductPlan(), new Map());

    expect(result.createdProducts).toBe(1);
    expect(result.updatedProducts).toBe(0);
    expect(result.variantGroups).toBe(1);
    expect(result.variantChoices).toBe(1);
    expect(result.warnings).toContain('画像「missing.jpg」が見つかりませんでした（新規商品）。');
    expect(store.options).toHaveLength(1);
    expect(store.groups).toHaveLength(1);
    expect(store.choices).toHaveLength(1);
    expect(store.options[0]).toMatchObject({ code: 'new-import-product', price: 0, price_on_request: true, image_url: null });
  });

  it('既存商品はコードで更新し、二重登録しない', async () => {
    const first = oneProductPlan();
    const store = useStore(new AtomicCatalogStore());
    await applyImportPlan(first, new Map());
    const id = store.options[0].id;
    first.products[0].name = '更新後商品';
    const result = await applyImportPlan(first, new Map());

    expect(result).toMatchObject({ createdProducts: 0, updatedProducts: 1 });
    expect(store.options).toHaveLength(1);
    expect(store.options[0]).toMatchObject({ id, name: '更新後商品' });
    expect(store.groups).toHaveLength(1);
    expect(store.choices).toHaveLength(1);
  });

  it('不足カテゴリーを全件まとめて検出し、書き込みを開始しない', async () => {
    const store = useStore(new AtomicCatalogStore());
    const plan = oneProductPlan();
    plan.products[0].categoryName = '存在しない分類';

    await expect(applyImportPlan(plan, new Map())).rejects.toThrow('カテゴリー「存在しない分類」');
    expect(store.calls).toBe(0);
    expect(store.options).toHaveLength(0);
  });

  it('途中失敗時は商品・グループ・選択肢を一件も反映しない', async () => {
    const store = useStore(new AtomicCatalogStore());
    store.fail = true;

    await expect(applyImportPlan(oneProductPlan(), new Map())).rejects.toThrow('商品・選択項目・選択肢は反映されませんでした');
    expect(store.options).toHaveLength(0);
    expect(store.groups).toHaveLength(0);
    expect(store.choices).toHaveLength(0);
  });

  it('48商品Excelを新規・既存混在で最後まで処理し、再Importでも増殖しない', async () => {
    const existingCodes = new Set(fullPlan.products.map((p) => p.code.toLowerCase()));
    const existing = seedOptions.filter((o) => existingCodes.has(o.code));
    const store = useStore(new AtomicCatalogStore(existing));

    const first = await applyImportPlan(clone(fullPlan), new Map());
    expect(first).toMatchObject({
      createdProducts: 41,
      updatedProducts: 7,
      variantGroups: 64,
      variantChoices: 119,
    });
    expect(store.options.filter((o) => fullPlan.products.some((p) => p.code.toLowerCase() === o.code))).toHaveLength(48);
    expect(store.groups).toHaveLength(64);
    expect(store.choices).toHaveLength(119);

    const second = await applyImportPlan(clone(fullPlan), new Map());
    expect(second).toMatchObject({ createdProducts: 0, updatedProducts: 48, variantGroups: 64, variantChoices: 119 });
    expect(store.options.filter((o) => fullPlan.products.some((p) => p.code.toLowerCase() === o.code))).toHaveLength(48);
    expect(store.groups).toHaveLength(64);
    expect(store.choices).toHaveLength(119);
  });
});

describe('LocalStore の一括登録 transaction', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-import-test-'));
    process.env.WING_LOCAL_DIR = dir;
  });
  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('新規と更新をcodeでupsertし、後段失敗時はファイルを置換しない', async () => {
    const store = new LocalStore();
    const category = (await store.listCategories()).find((c) => c.code === 'toilet')!;
    const optionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const base = {
      id: optionId,
      base_model_id: null,
      category_id: category.id,
      code: 'atomic-import-test',
      name: '初回',
      description: null,
      price: 0,
      image_url: null,
      selection_type: 'checkbox' as const,
      is_required: false,
      is_default: false,
      is_installation: false,
      price_on_request: true,
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
      status: 'published' as const,
    };
    await store.applyCatalogImport({ options: [{ ...base, import_operation: 'INSERT' }], variantGroups: [], variantChoices: [] });
    await store.applyCatalogImport({ options: [{ ...base, name: '更新後', import_operation: 'UPDATE' }], variantGroups: [], variantChoices: [] });
    expect(loadDb().options.filter((o) => o.code === base.code)).toEqual([expect.objectContaining({ id: optionId, name: '更新後' })]);

    const before = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
    await expect(store.applyCatalogImport({
      options: [{ ...base, name: '残ってはいけない', import_operation: 'UPDATE' }],
      variantGroups: [{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        option_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        code: 'invalid-group',
        name: '不正',
        note: null,
        sort_order: 1,
        is_required: true,
        status: 'published',
      }],
      variantChoices: [],
    })).rejects.toThrow('商品が見つかりません');
    expect(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).toBe(before);
  });
});
