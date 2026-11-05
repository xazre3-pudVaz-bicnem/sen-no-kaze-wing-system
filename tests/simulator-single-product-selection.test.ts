import { describe, expect, it } from 'vitest';
import {
  isSimulatorSingleProductCategory,
  nextSimulatorSelectedProducts,
} from '@/lib/domain/simulator-single-product-selection';
import { equipmentCategoryPriceState } from '@/lib/domain/equipment-price-display';
import type { OptionCategory, ProductOption } from '@/lib/domain/types';

const category = (code: string, selection_mode: OptionCategory['selection_mode'] = 'multi') =>
  ({ code, selection_mode });

describe('シミュレーターの商品選択（DBのカテゴリー設定は変更しない）', () => {
  it.each(['toilet', 'kitchen'])('%s はDBのmulti設定でも商品を1つだけ選べる', (code) => {
    const cat = category(code);
    expect(isSimulatorSingleProductCategory(cat)).toBe(true);
    expect(nextSimulatorSelectedProducts(cat, ['standard'], 'upgrade', ['upgrade'])).toEqual(['upgrade']);
    expect(nextSimulatorSelectedProducts(cat, ['standard', 'legacy-extra'], 'upgrade', ['upgrade'])).toEqual(['upgrade']);
    expect(nextSimulatorSelectedProducts(cat, ['upgrade'], 'standard', ['standard'])).toEqual(['standard']);
  });

  it('既存の単一選択（UB/エアコン/給湯）はそのまま', () => {
    expect(isSimulatorSingleProductCategory(category('ub', 'single'))).toBe(true);
    expect(isSimulatorSingleProductCategory(category('boiler'))).toBe(true);
    expect(isSimulatorSingleProductCategory(category('aircon'))).toBe(true);
  });

  it('洗面の表示商品（器具＋水栓など）は一組として選択する', () => {
    expect(nextSimulatorSelectedProducts(category('washbasin'), ['old-basin'], 'new-basin', ['new-basin', 'new-faucet']))
      .toEqual(['new-basin', 'new-faucet']);
  });

  it('照明や家具は引き続き複数選択できる', () => {
    for (const code of ['lighting', 'furniture', 'bed']) {
      const cat = category(code);
      expect(isSimulatorSingleProductCategory(cat)).toBe(false);
      expect(nextSimulatorSelectedProducts(cat, ['light-1'], 'light-2', ['light-2']))
        .toEqual(['light-1', 'light-2']);
      expect(nextSimulatorSelectedProducts(cat, ['light-1'], 'light-1', ['light-1']))
        .toEqual(['light-1']);
    }
  });
});

// 商品の「標準との差額」も、新しい1商品だけで計算されることを確認する。
function product(id: string, price: number): ProductOption {
  return {
    id, base_model_id: null, category_id: 'toilet-category', code: id, name: id, description: null, price,
    image_url: null, selection_type: 'radio', is_required: false, is_default: false, is_installation: false,
    price_on_request: false, spec_codes: [], owner_id: null, manufacturer: null, model_no: null,
    size_note: null, list_price: null, highlight: null, preview_key: null, affects_views: [], sort_order: 1,
    status: 'published', created_at: '', updated_at: '',
  };
}

describe('トイレ交換の差額表示', () => {
  it('標準トイレを残して二重計上するのではなく、新商品との差額になる', () => {
    const options = [product('standard', 225000), product('upgrade', 274000)];
    const selectedIds = nextSimulatorSelectedProducts(category('toilet'), ['standard'], 'upgrade', ['upgrade']);
    expect(equipmentCategoryPriceState({
      categoryId: 'toilet-category', options, selectedIds, baselineIds: ['standard'],
      selectedVariantIds: [], baselineVariantIds: [], variantGroups: [], variantChoices: [],
    })).toEqual({ kind: 'delta', delta: 49000 });
  });
});
