import { describe, expect, it } from 'vitest';
import {
  equipmentCategoryPriceBreakdown,
  equipmentCategoryPriceState,
} from '@/lib/domain/equipment-price-display';
import type { OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';

const option = (id: string, price: number, priceOnRequest = false): ProductOption => ({
  id,
  base_model_id: null,
  category_id: 'ub-category',
  code: id,
  name: id,
  description: null,
  price,
  image_url: null,
  selection_type: 'radio',
  is_required: false,
  is_default: false,
  is_installation: false,
  price_on_request: priceOnRequest,
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
  created_at: '2026-09-14T00:00:00.000Z',
  updated_at: '2026-09-14T00:00:00.000Z',
});

const group: OptionVariantGroup = {
  id: 'variant-group',
  option_id: 'ub-standard',
  code: 'grade',
  name: 'グレード',
  note: null,
  depends_on_group_code: null,
  depends_on_choice_codes: [],
  sort_order: 1,
  is_required: true,
  status: 'published',
};

const standardChoice: OptionVariantChoice = {
  id: 'variant-standard',
  group_id: group.id,
  code: 'standard',
  name: '標準',
  kind: 'standard',
  extra_price: 0,
  price_on_request: false,
  image_url: null,
  note: null,
  sort_order: 1,
  status: 'published',
};

const upgradeChoice: OptionVariantChoice = {
  ...standardChoice,
  id: 'variant-upgrade',
  code: 'upgrade',
  name: '上位仕様',
  kind: 'option',
  extra_price: 50000,
  sort_order: 2,
};

const upgradeGroup: OptionVariantGroup = {
  ...group,
  id: 'variant-group-upgrade',
  option_id: 'ub-upgrade',
};

const upgradedProductChoice: OptionVariantChoice = {
  ...upgradeChoice,
  id: 'variant-upgrade-product',
  group_id: upgradeGroup.id,
};

const options = [
  option('ub-standard', 570000),
  option('ub-upgrade', 650000),
  option('ub-cheaper', 500000),
];

describe('設備カードの標準・差額表示', () => {
  it('標準見積に含まれる商品は商品価格が0円でなくても標準とする', () => {
    expect(
      equipmentCategoryPriceState({
        categoryId: 'ub-category',
        options,
        selectedIds: ['ub-standard'],
        baselineIds: ['ub-standard'],
        selectedVariantIds: [],
        baselineVariantIds: [],
        variantGroups: [],
        variantChoices: [],
      })
    ).toEqual({ kind: 'standard' });
  });

  it('上位商品へ変更したときは標準商品との差額だけを返す', () => {
    expect(
      equipmentCategoryPriceState({
        categoryId: 'ub-category',
        options,
        selectedIds: ['ub-upgrade'],
        baselineIds: ['ub-standard'],
        selectedVariantIds: [],
        baselineVariantIds: [],
        variantGroups: [],
        variantChoices: [],
      })
    ).toEqual({ kind: 'delta', delta: 80000 });
  });

  it('安い商品へ変更した場合はマイナス差額を返す', () => {
    expect(
      equipmentCategoryPriceState({
        categoryId: 'ub-category',
        options,
        selectedIds: ['ub-cheaper'],
        baselineIds: ['ub-standard'],
        selectedVariantIds: [],
        baselineVariantIds: [],
        variantGroups: [],
        variantChoices: [],
      })
    ).toEqual({ kind: 'delta', delta: -70000 });
  });

  it('同じ商品でもバリエーション変更分だけ差額にする', () => {
    expect(
      equipmentCategoryPriceState({
        categoryId: 'ub-category',
        options,
        selectedIds: ['ub-standard'],
        baselineIds: ['ub-standard'],
        selectedVariantIds: ['variant-upgrade'],
        baselineVariantIds: ['variant-standard'],
        variantGroups: [group],
        variantChoices: [standardChoice, upgradeChoice],
      })
    ).toEqual({ kind: 'delta', delta: 50000 });
  });

  it('商品差額と仕様差額を分けて返す', () => {
    expect(
      equipmentCategoryPriceBreakdown({
        categoryId: 'ub-category',
        options,
        selectedIds: ['ub-upgrade'],
        baselineIds: ['ub-standard'],
        selectedVariantIds: ['variant-upgrade-product'],
        baselineVariantIds: ['variant-standard'],
        variantGroups: [group, upgradeGroup],
        variantChoices: [standardChoice, upgradeChoice, upgradedProductChoice],
      })
    ).toMatchObject({
      state: { kind: 'delta', delta: 130000 },
      productDelta: 80000,
      variantDelta: 50000,
      productPriceOnRequest: false,
      variantPriceOnRequest: false,
    });
  });

  it('価格未確定商品へ変更した場合は別途見積にする', () => {
    const requestOptions = [...options, option('ub-request', 0, true)];
    expect(
      equipmentCategoryPriceState({
        categoryId: 'ub-category',
        options: requestOptions,
        selectedIds: ['ub-request'],
        baselineIds: ['ub-standard'],
        selectedVariantIds: [],
        baselineVariantIds: [],
        variantGroups: [],
        variantChoices: [],
      })
    ).toEqual({ kind: 'price-on-request' });
  });
});
