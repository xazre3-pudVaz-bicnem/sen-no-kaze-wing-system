import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { computePricing } from '@/lib/domain/pricing';
import { simulatePickerCategoryCandidate, simulatorCandidatePriceDelta } from '@/lib/domain/simulator-candidate-price-delta';
import { computeStandardEstimatePricing } from '@/lib/domain/standard-estimate-pricing';
import {
  computeSaleViewPricing,
  v25UnitKey,
  withoutCatalogCosts,
  type StandardEstimateSaleView,
} from '@/lib/domain/standard-estimate-sale-view';
import {
  createSimulatorCardDeltaEvaluator,
  simulatorCardDelta,
  type SimulatorCardPlanSelection,
  type SimulatorCardPriceInput,
} from '@/lib/domain/simulator-card-price-delta';
import type {
  CatalogBundle, EstimateTemplateBundle, OptionCategory,
  OptionVariantChoice, OptionVariantGroup, ProductOption,
} from '@/lib/domain/types';

const category = (id: string, code = id) => ({
  id, code, name: id, finish_level: 'full', selection_mode: 'single',
  is_required: false, status: 'published',
}) as unknown as OptionCategory;

const option = (id: string, categoryId: string, price: number, priceUnit: string | null = '式', extra: Record<string, unknown> = {}) => ({
  id, code: id, name: id, category_id: categoryId, base_model_id: null,
  price, price_unit: priceUnit, price_on_request: false,
  is_installation: false, status: 'published', selection_type: 'radio',
  spec_codes: [], is_required: false, is_default: false, sort_order: 1,
  ...extra,
}) as unknown as ProductOption;

function bundle(categories: OptionCategory[], options: ProductOption[], groups: OptionVariantGroup[] = [], choices: OptionVariantChoice[] = []): CatalogBundle {
  return {
    model: { id: 'model', slug: 'runtime-delta-model', base_price: 0, expense_rate: 0.15, presets: [] },
    categories, options, variantGroups: groups, variantChoices: choices,
    dependencies: [], conflicts: [], images: [], previewRules: [], hotspots: [], baseBreakdowns: [],
  } as unknown as CatalogBundle;
}

const plan = (
  optionIds: string[],
  variantChoiceIds: string[] = [],
  exteriorFaces: SimulatorCardPlanSelection['exteriorFaces'] = [],
  slotSelections: NonNullable<SimulatorCardPlanSelection['slotSelections']> = []
): SimulatorCardPlanSelection => ({ optionIds, variantChoiceIds, exteriorFaces, slotSelections });

const legacy = (data: CatalogBundle, current: SimulatorCardPlanSelection, standard: SimulatorCardPlanSelection): SimulatorCardPriceInput => ({
  bundle: data, source: { kind: 'legacy', baseOverride: null }, current, standard,
});

const categoryTarget = (categoryId: string) => ({ kind: 'category' as const, categoryId });

describe('商品カード：見積総額の税込差額（表示専用）', () => {
  it('標準を表示し、追加・減額・同額変更は現在総額から対象だけ標準に戻した総額を引く', () => {
    const data = bundle([category('door')], [
      option('normal', 'door', 10_000), option('upgrade', 'door', 12_000),
      option('economy', 'door', 8_000), option('equal', 'door', 10_000),
    ]);
    const standard = plan(['normal']);
    expect(simulatorCardDelta(legacy(data, standard, standard), categoryTarget('door'))).toEqual({ kind: 'standard' });

    for (const id of ['upgrade', 'economy', 'equal']) {
      const current = plan([id]);
      const actual = simulatorCardDelta(legacy(data, current, standard), categoryTarget('door'));
      const now = computePricing(data.model, data.options, data.categories, [{ option_id: id }]).total;
      const back = computePricing(data.model, data.options, data.categories, [{ option_id: 'normal' }]).total;
      expect(actual).toEqual({ kind: 'changed', deltaIncludingTax: now - back });
    }
    expect(simulatorCardDelta(legacy(data, plan(['economy']), standard), categoryTarget('door'))).toEqual({
      kind: 'changed', deltaIncludingTax: -2_200,
    });
    expect(simulatorCardDelta(legacy(data, plan(['equal']), standard), categoryTarget('door'))).toEqual({
      kind: 'changed', deltaIncludingTax: 0,
    });
  });

  it('ほかの変更を維持し、商品別の差額は合計に合わせて配分しない（1,000円未満調整の非加算性）', () => {
    const data = bundle([category('a'), category('b')], [option('a1', 'a', 600), option('b1', 'b', 600)]);
    const current = plan(['a1', 'b1']);
    const standard = plan([]);
    const evaluator = createSimulatorCardDeltaEvaluator(legacy(data, current, standard));
    const a = evaluator.evaluate(categoryTarget('a'));
    const b = evaluator.evaluate(categoryTarget('b'));
    expect(a).toEqual({ kind: 'changed', deltaIncludingTax: 1_100 });
    expect(b).toEqual({ kind: 'changed', deltaIncludingTax: 1_100 });
    expect(computePricing(data.model, data.options, data.categories,
      current.optionIds.map((option_id) => ({ option_id }))).total).toBe(1_100);
    // 1,100 + 1,100 !== 1,100。税込額を無理に一致させる配分は禁止。
    expect((a.kind === 'changed' ? a.deltaIncludingTax : 0) +
      (b.kind === 'changed' ? b.deltaIncludingTax : 0)).toBe(2_200);
  });

  it('同じ商品の色・仕様変更、複数商品を変更中でも対象のみに戻す', () => {
    const groups = [{ id: 'color', option_id: 'a', name: '色', code: 'color', status: 'published', sort_order: 1 }] as OptionVariantGroup[];
    const choices = [
      { id: 'white', group_id: 'color', extra_price: 0, price_on_request: false },
      { id: 'black', group_id: 'color', extra_price: 2_000, price_on_request: false },
    ] as OptionVariantChoice[];
    const data = bundle([category('door'), category('aircon')], [
      option('a', 'door', 10_000), option('b', 'aircon', 3_000),
    ], groups, choices);
    const current = plan(['a', 'b'], ['black']);
    const standard = plan(['a'], ['white']);
    const actual = simulatorCardDelta(legacy(data, current, standard), categoryTarget('door'));
    const price = (variantIds: string[]) => computePricing(
      data.model, data.options, data.categories,
      [{ option_id: 'a', variant_choice_ids: variantIds }, { option_id: 'b' }],
      undefined, { groups, choices }
    ).total;
    expect(actual).toEqual({ kind: 'changed', deltaIncludingTax: price(['black']) - price(['white']) });
    // 選択肢が標準なら、別カテゴリーだけ変更中でも「標準」。
    expect(simulatorCardDelta(legacy(data, plan(['a', 'b'], ['white']), standard), categoryTarget('door'))).toEqual({
      kind: 'standard',
    });
  });

  it('現行Excel標準見積は標準原本・経費・1,000円未満調整・税込の正式経路を使う', () => {
    const data = bundle([category('door', 'interior-door')], [
      option('normal', 'door', 2_000), option('upgrade', 'door', 3_500),
    ]);
    const sections = [
      { code: 'base', line_subtotal: 500_000, expense_amount: 75_000, total: 575_000 },
      { code: 'interior_exterior', line_subtotal: 250_000, expense_amount: 37_500, total: 287_500 },
      { code: 'option', line_subtotal: 120_000, expense_amount: 18_000, total: 138_000 },
      { code: 'sitework', line_subtotal: 50, expense_amount: 0, total: 50 },
    ].map((item, index) => ({
      id: String(index), template_id: 'template', label: item.code, sort_order: index,
      expense_rate: item.code === 'sitework' ? null : 0.15,
      expense_label: item.code === 'sitework' ? null : '経費', ...item,
    }));
    const template = {
      template: { id: 'template', spec_code: 'residence', base_model_id: 'model',
        tax_rate: 0.1, subtotal_raw: 1_000_550, adjustment: -550, subtotal: 1_000_000,
        tax: 100_000, total: 1_100_000, baseline_option_ids: ['normal'] },
      sections, lines: [], base_breakdown_items: [], baseline_option_ids: ['normal'],
    } as unknown as EstimateTemplateBundle;
    const current = plan(['upgrade']);
    const standard = plan(['normal']);
    const official = computeStandardEstimatePricing(data, template, ['upgrade'], [], [], 'full');
    const baseline = computeStandardEstimatePricing(data, template, ['normal'], [], [], 'full');
    expect(baseline.pricing.total).toBe(1_100_000);
    expect(official.pricing.total).toBe(1_102_200);
    expect(simulatorCardDelta({
      bundle: data, source: { kind: 'legacy-template', template, finishLevel: 'full' },
      current, standard,
    }, categoryTarget('door'))).toEqual({
      kind: 'changed', deltaIncludingTax: official.pricing.total - baseline.pricing.total,
    });
  });

  it('外壁4面は対象の1面だけ標準に戻し、同じ商品選択との二重計上をしない', () => {
    const data = bundle([category('wall', 'exterior-wall')], [
      option('wall-standard', 'wall', 0), option('wall-upgrade', 'wall', 2_000),
    ]);
    const standardFaces = (['front', 'right', 'back', 'left'] as const).map((face_code) => ({
      face_code, option_id: 'wall-standard', variant_choice_ids: [],
    }));
    const currentFaces = standardFaces.map((face) => face.face_code === 'right'
      ? { ...face, option_id: 'wall-upgrade' } : face);
    const input = legacy(data, plan(['wall-standard'], [], currentFaces), plan(['wall-standard'], [], standardFaces));
    expect(simulatorCardDelta(input, { kind: 'exterior-face', faceCode: 'right' })).toEqual({
      kind: 'changed', deltaIncludingTax: 2_200,
    });
    expect(simulatorCardDelta(input, { kind: 'exterior-face', faceCode: 'front' })).toEqual({ kind: 'standard' });
    expect(simulatorCardDelta(input, categoryTarget('wall'))).toEqual({
      kind: 'changed', deltaIncludingTax: 2_200,
    });
    expect(simulatorCardDelta(legacy(data, plan(['wall-standard'], [], currentFaces), plan(['wall-standard'])),
      { kind: 'exterior-face', faceCode: 'right' })).toEqual({
      kind: 'pending', reason: 'incomplete-selection',
    });
  });
});

// v2.5：既存 tests/v25-slot-quantity.test.ts の数量23.5㎡と位置の枠の構造に合わせた縮約データ。
const v25View: StandardEstimateSaleView = {
  pricing_model: 'v2.5', revision_id: 'rev-v25-card', version: 1,
  base_model_id: 'model', spec_code: 'office', size_code: '2100x4550',
  fire_spec_code: 'non_fire', tax_rate: '0.1000', expense_rate: '0.1500',
  subtotal_raw: 288_937, adjustment: 0, subtotal: 288_937, tax: 28_893,
  total: 317_830, has_por: false,
  sections: [
    { code: 'base', expense_method: 'rate', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
    { code: 'interior_exterior', expense_method: 'rate', line_subtotal: 251_250, expense_amount: 37_687, total: 288_937, has_por: false },
    { code: 'option', expense_method: 'rate', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
    { code: 'sitework', expense_method: 'none', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
  ],
  base_lines: [],
  lines: [],
  baseline: [
    { option_id: 'roof1', section_code: 'interior_exterior', selection_target_code: 'roof',
      quantity: '23.5000', unit_price: 10_500, amount: 246_750,
      price_on_request: false, variant_choice_ids: ['white'], variant_extra: 0,
      unit: '㎡', measured: true, slot_code: null, category_id: 'roof', selectable_option_ids: null },
    { option_id: 'sash1', section_code: 'interior_exterior', selection_target_code: 'sash',
      quantity: '1', unit_price: 4_500, amount: 4_500,
      price_on_request: false, variant_choice_ids: [], variant_extra: 0,
      unit: '式', measured: true, slot_code: 'window-1', slot_label: '窓①', category_id: 'sash',
      selectable_option_ids: ['sash1', 'sash2'] },
  ],
  prices: {
    roof1: { groups: [['white', 'black']], units: { '0': 10_500, '1': 11_250 } },
    roof2: { groups: [], units: { '': 12_000 } },
    roofBadUnit: { groups: [], units: { '': 7_500 } },
    sash1: { groups: [], units: { '': 4_500 } },
    sash2: { groups: [], units: { '': 6_000 } },
  },
};
const v25Groups = [{ id: 'roof-color', option_id: 'roof1', code: 'color', name: '色',
  sort_order: 1, is_required: true, status: 'published' }] as OptionVariantGroup[];
const v25Choices = [
  { id: 'white', group_id: 'roof-color', code: 'white', extra_price: 0, price_on_request: false },
  { id: 'black', group_id: 'roof-color', code: 'black', extra_price: 0, price_on_request: false },
] as OptionVariantChoice[];
const v25Bundle = bundle([category('roof'), category('sash')], [
  option('roof1', 'roof', 0, '㎡'), option('roof2', 'roof', 0, '㎡'),
  option('roofBadUnit', 'roof', 0, '式'),
  option('sash1', 'sash', 0, '式'), option('sash2', 'sash', 0, '式'),
], v25Groups, v25Choices);
const v25Slots = [{ slot_code: 'window-1', option_id: 'sash1', variant_choice_ids: [] }];
const v25Standard = plan(['roof1'], ['white'], [], v25Slots);
const v25Input = (
  current: SimulatorCardPlanSelection,
  view: StandardEstimateSaleView = v25View,
  lookup?: ReadonlyMap<string, number | null>,
  data: CatalogBundle = v25Bundle
): SimulatorCardPriceInput => ({
  bundle: withoutCatalogCosts(data),
  source: { kind: 'sale-view', view, unitLookup: lookup },
  current, standard: v25Standard,
});

describe('商品カード：v2.5売価・数量・位置別の安全性', () => {
  it('標準は差額0、屋根23.5㎡の変更は同じ正本経路の税込総額差', () => {
    expect(simulatorCardDelta(v25Input(v25Standard), categoryTarget('roof'))).toEqual({ kind: 'standard' });
    const changed = plan(['roof2'], [], [], v25Slots);
    const officialChanged = computeSaleViewPricing(withoutCatalogCosts(v25Bundle), v25View, ['roof2'], [], [], undefined, v25Slots);
    const officialBack = computeSaleViewPricing(withoutCatalogCosts(v25Bundle), v25View, ['roof1'], ['white'], [], undefined, v25Slots);
    expect(officialChanged.sections.find((section) => section.code === 'interior_exterior')?.delta_line).toBe(35_250);
    expect(simulatorCardDelta(v25Input(changed), categoryTarget('roof'))).toEqual({
      kind: 'changed', deltaIncludingTax: officialChanged.pricing.total - officialBack.pricing.total,
    });
    const color = plan(['roof1'], ['black'], [], v25Slots);
    const colorChanged = computeSaleViewPricing(withoutCatalogCosts(v25Bundle), v25View, ['roof1'], ['black'], [], undefined, v25Slots);
    expect(simulatorCardDelta(v25Input(color), categoryTarget('roof'))).toEqual({
      kind: 'changed', deltaIncludingTax: colorChanged.pricing.total - officialBack.pricing.total,
    });
  });

  it('位置別サッシは指定した枠のみ戻し、同カテゴリー全体を戻さない', () => {
    const swapped = [{ slot_code: 'window-1', option_id: 'sash2', variant_choice_ids: [] }];
    const changed = plan(['roof2'], [], [], swapped);
    const input = v25Input(changed);
    const official = computeSaleViewPricing(withoutCatalogCosts(v25Bundle), v25View, ['roof2'], [], [], undefined, swapped);
    const reverted = computeSaleViewPricing(withoutCatalogCosts(v25Bundle), v25View, ['roof2'], [], [], undefined, v25Slots);
    expect(simulatorCardDelta(input, { kind: 'slot', slotCode: 'window-1' })).toEqual({
      kind: 'changed', deltaIncludingTax: official.pricing.total - reverted.pricing.total,
    });
    expect(simulatorCardDelta(input, categoryTarget('sash'))).toEqual({
      kind: 'pending', reason: 'incomplete-selection',
    });
    expect(simulatorCardDelta(v25Input(v25Standard), { kind: 'slot', slotCode: 'window-1' })).toEqual({ kind: 'standard' });
  });

  it('公開版にある別の位置の欠落は、対象商品の税込差額にも「標準」の表示にも使わせない', () => {
    const second = {
      ...v25View.baseline[1],
      slot_code: 'window-2',
      slot_label: '窓②',
    };
    const view: StandardEstimateSaleView = { ...v25View, baseline: [...v25View.baseline, second] };
    const current = plan(['roof2'], [], [], v25Slots);
    const input = v25Input(current, view);
    // 価格計算自体は欠落した枠を黙って無視できる。表示層で先に遮断する。
    expect(computeSaleViewPricing(withoutCatalogCosts(v25Bundle), view,
      current.optionIds, [], [], undefined, v25Slots).pricing.has_price_on_request).toBe(false);
    expect(simulatorCardDelta(input, categoryTarget('roof'))).toEqual({
      kind: 'pending', reason: 'incomplete-selection',
    });
    expect(simulatorCardDelta(input, { kind: 'slot', slotCode: 'window-1' })).toEqual({
      kind: 'pending', reason: 'incomplete-selection',
    });
    expect(simulatorCardDelta(v25Input(v25Standard, view), categoryTarget('roof'))).toEqual({
      kind: 'pending', reason: 'incomplete-selection',
    });
    const allSlots = [...v25Slots, { slot_code: 'window-2', option_id: 'sash1', variant_choice_ids: [] }];
    expect(simulatorCardDelta(v25Input(plan(['roof2'], [], [], allSlots), view), categoryTarget('roof')).kind).toBe('changed');
    expect(simulatorCardDelta(v25Input(plan(['roof1'], ['white'], [], allSlots), view), categoryTarget('roof'))).toEqual({
      kind: 'standard',
    });
  });

  it('公開版・現在の枠コードの重複、未知の位置、公開版にない位置を遮断する', () => {
    const duplicatedView: StandardEstimateSaleView = {
      ...v25View,
      baseline: [...v25View.baseline, { ...v25View.baseline[1], option_id: 'sash2' }],
    };
    expect(simulatorCardDelta(v25Input(plan(['roof2'], [], [], v25Slots), duplicatedView), categoryTarget('roof'))).toEqual({
      kind: 'pending', reason: 'incomplete-selection',
    });
    for (const slots of [
      [...v25Slots, v25Slots[0]],
      [{ slot_code: 'unknown-window', option_id: 'sash1', variant_choice_ids: [] }],
      [...v25Slots, { slot_code: 'unknown-window', option_id: 'sash1', variant_choice_ids: [] }],
    ]) {
      expect(simulatorCardDelta(v25Input(plan(['roof2'], [], [], slots)), categoryTarget('roof'))).toEqual({
        kind: 'pending', reason: 'incomplete-selection',
      });
    }
  });

  it('指定枠で選べない商品・カテゴリー違い・不正な仕様・二重計上の状態を遮断する', () => {
    const invalidSelections = [
      { slot_code: 'window-1', option_id: 'roof2', variant_choice_ids: [] }, // カテゴリー違い
      { slot_code: 'window-1', option_id: 'sash1', variant_choice_ids: ['white'] }, // 別商品の選択肢
      { slot_code: 'window-1', option_id: 'sash2', variant_choice_ids: ['white', 'white'] }, // 重複・不適切な選択肢
      { slot_code: 'window-1', option_id: 'unknown', variant_choice_ids: [] }, // 不明な商品
    ];
    for (const selection of invalidSelections) {
      const input = v25Input(plan(['roof2'], [], [], [selection]));
      expect(simulatorCardDelta(input, categoryTarget('roof'))).toEqual({
        kind: 'pending', reason: 'incomplete-selection',
      });
      expect(simulatorCardDelta(input, { kind: 'slot', slotCode: 'window-1' })).toEqual({
        kind: 'pending', reason: 'incomplete-selection',
      });
    }
    // 版の対象位置を持つカテゴリーを、カテゴリー単位でも選んではいけない。
    expect(simulatorCardDelta(v25Input(plan(['roof2', 'sash1'], [], [], v25Slots)), categoryTarget('roof'))).toEqual({
      kind: 'pending', reason: 'incomplete-selection',
    });
    const restrictedView: StandardEstimateSaleView = {
      ...v25View,
      baseline: v25View.baseline.map((item) => item.slot_code === 'window-1'
        ? { ...item, selectable_option_ids: ['sash1'] } : item),
    };
    expect(simulatorCardDelta(v25Input(
      plan(['roof2'], [], [], [{ slot_code: 'window-1', option_id: 'sash2', variant_choice_ids: [] }]), restrictedView
    ), categoryTarget('roof'))).toEqual({ kind: 'pending', reason: 'incomplete-selection' });
  });

  it('注文範囲の外の枠は、公開版から作成した activeSlotCodes に限り除外できる', () => {
    const view: StandardEstimateSaleView = {
      ...v25View,
      baseline: [...v25View.baseline, { ...v25View.baseline[1], slot_code: 'window-2' }],
    };
    const changed = plan(['roof2'], [], [], v25Slots);
    const source = { kind: 'sale-view' as const, view, activeSlotCodes: ['window-1'] };
    expect(simulatorCardDelta({ ...v25Input(changed, view), source }, categoryTarget('roof')).kind).toBe('changed');
    expect(simulatorCardDelta({
      ...v25Input(changed, view),
      source: { ...source, activeSlotCodes: ['window-1', 'unknown'] },
    }, categoryTarget('roof'))).toEqual({ kind: 'pending', reason: 'incomplete-selection' });
    expect(simulatorCardDelta({
      ...v25Input(changed, view),
      source: { ...source, activeSlotCodes: ['window-1', 'window-1'] },
    }, categoryTarget('roof'))).toEqual({ kind: 'pending', reason: 'incomplete-selection' });
  });

  it('数量の販売単位相違では価格未確定とし、数値を返さない', () => {
    const changed = plan(['roofBadUnit'], [], [], v25Slots);
    const official = computeSaleViewPricing(withoutCatalogCosts(v25Bundle), v25View, changed.optionIds, [], [], undefined, v25Slots);
    expect(official.pricing.has_price_on_request).toBe(true);
    expect(simulatorCardDelta(v25Input(changed), categoryTarget('roof'))).toEqual({
      kind: 'pending', reason: 'price-on-request',
    });
  });

  it('売価テーブルにない部分組合せは近似額を採用せず、正確な売価lookupが取得できた場合だけ表示する', () => {
    const view: StandardEstimateSaleView = {
      ...v25View,
      baseline: v25View.baseline.map((row) => row.option_id === 'roof1'
        ? { ...row, variant_choice_ids: ['white', 'matte'] } : row),
      prices: {
        ...v25View.prices,
        roof1: {
          groups: [['white', 'black'], ['matte', 'gloss']],
          default_key: '0.0', partial: true,
          units: { '0.0': 10_500, '1.0': 11_250, '0.1': 11_000 },
        },
      },
    };
    const data = bundle(v25Bundle.categories, v25Bundle.options, [
      ...v25Groups, { id: 'roof-finish', option_id: 'roof1', code: 'finish', name: '仕上げ',
        status: 'published', is_required: true, sort_order: 2 } as OptionVariantGroup,
    ], [
      ...v25Choices,
      { id: 'matte', group_id: 'roof-finish', extra_price: 0, price_on_request: false } as OptionVariantChoice,
      { id: 'gloss', group_id: 'roof-finish', extra_price: 0, price_on_request: false } as OptionVariantChoice,
    ]);
    const current = plan(['roof1'], ['black', 'gloss'], [], v25Slots);
    const standard = plan(['roof1'], ['white', 'matte'], [], v25Slots);
    const input: SimulatorCardPriceInput = {
      ...v25Input(current, view, undefined, data), standard,
    };
    expect(simulatorCardDelta(input, categoryTarget('roof'))).toEqual({
      kind: 'pending', reason: 'unresolved-unit',
    });
    const lookup = new Map([[v25UnitKey(view.revision_id, 'roof1', ['black', 'gloss']), 11_888]]);
    const resolved = { ...input, source: { kind: 'sale-view' as const, view, unitLookup: lookup } };
    const official = computeSaleViewPricing(withoutCatalogCosts(data), view, current.optionIds, current.variantChoiceIds, [], lookup, v25Slots);
    const back = computeSaleViewPricing(withoutCatalogCosts(data), view, standard.optionIds, standard.variantChoiceIds, [], lookup, v25Slots);
    expect(official.missing_units).toHaveLength(0);
    expect(simulatorCardDelta(resolved, categoryTarget('roof'))).toEqual({
      kind: 'changed', deltaIncludingTax: official.pricing.total - back.pricing.total,
    });
  });

  it('公開価格なし・別途見積・標準baseline不整合・位置の枠欠落で誤った金額を出さない', () => {
    const changed = plan(['roof2'], [], [], v25Slots);
    expect(simulatorCardDelta({ ...v25Input(changed), source: { kind: 'v25-pending' } }, categoryTarget('roof'))).toEqual({
      kind: 'pending', reason: 'no-published-price',
    });
    const porView = { ...v25View, has_por: true };
    expect(simulatorCardDelta(v25Input(changed, porView), categoryTarget('roof'))).toEqual({
      kind: 'pending', reason: 'price-on-request',
    });
    expect(simulatorCardDelta({ ...v25Input(changed), standard: plan(['roof2'], [], [], v25Slots) },
      categoryTarget('roof'))).toEqual({ kind: 'pending', reason: 'incomplete-selection' });
    expect(simulatorCardDelta(v25Input(plan(['roof2'])), { kind: 'slot', slotCode: 'window-1' })).toEqual({
      kind: 'pending', reason: 'incomplete-selection',
    });
  });

  it('多数のカードを評価しても同じ画面状態の計算結果を再利用する（性能スモーク）', () => {
    const count = 40;
    const categories = Array.from({ length: count }, (_, i) => category('cat' + i));
    const options = Array.from({ length: count }, (_, i) => option('o' + i, 'cat' + i, 2_000 + i));
    const current = plan(options.map((row) => row.id));
    const evaluator = createSimulatorCardDeltaEvaluator(legacy(bundle(categories, options), current, plan([])));
    const start = performance.now();
    const first = categories.map((row) => evaluator.evaluate(categoryTarget(row.id)));
    for (let repeat = 0; repeat < 100; repeat++) {
      categories.forEach((row, index) => expect(evaluator.evaluate(categoryTarget(row.id))).toBe(first[index]));
    }
    const elapsedMs = performance.now() - start;
    expect(first.every((row) => row.kind === 'changed')).toBe(true);
    // CI の処理能力による揺れを考慮した緩い上限。計算結果のキャッシュを検査する。
    expect(elapsedMs).toBeLessThan(10_000);
    console.info('simulator-card-delta: 40 categories + 4,000 cached reads = ' + Math.round(elapsedMs) + 'ms');
  });
});


describe('統合ポップアップ：候補を選んだ仮プランの正式税込総額差', () => {
  it('v2.5 屋根23.5㎡の候補は実際の税込見積総額で比較し、数量1に縮めない', () => {
    const data = withoutCatalogCosts(v25Bundle);
    const candidate = plan(['roof2'], [], [], v25Slots);
    const current = computeSaleViewPricing(data, v25View, candidate.optionIds, candidate.variantChoiceIds, [], undefined, v25Slots);
    const standard = computeSaleViewPricing(data, v25View, v25Standard.optionIds, v25Standard.variantChoiceIds, [], undefined, v25Slots);
    expect(current.missing_units).toHaveLength(0);
    expect(standard.missing_units).toHaveLength(0);
    expect(simulatorCandidatePriceDelta(v25Input(v25Standard), categoryTarget('roof'), candidate)).toEqual({
      kind: 'changed', deltaIncludingTax: current.pricing.total - standard.pricing.total,
    });
  });

  it('v2.5 位置別サッシの候補はその枠だけ変更し、他の数量・枠を保つ', () => {
    const data = withoutCatalogCosts(v25Bundle);
    const candidateSlot = [{ slot_code: 'window-1', option_id: 'sash2', variant_choice_ids: [] }];
    const candidate = plan(['roof1'], ['white'], [], candidateSlot);
    const current = computeSaleViewPricing(data, v25View, candidate.optionIds, candidate.variantChoiceIds, [], undefined, candidateSlot);
    const standard = computeSaleViewPricing(data, v25View, v25Standard.optionIds, v25Standard.variantChoiceIds, [], undefined, v25Slots);
    expect(current.missing_units).toHaveLength(0);
    expect(simulatorCandidatePriceDelta(v25Input(v25Standard), { kind: 'slot', slotCode: 'window-1' }, candidate)).toEqual({
      kind: 'changed', deltaIncludingTax: current.pricing.total - standard.pricing.total,
    });
  });

  it('位置候補の別途見積・必要単価未取得は数値を出さない', () => {
    const candidate = plan(['roof1'], ['white'], [], [
      { slot_code: 'window-1', option_id: 'sash2', variant_choice_ids: [] },
    ]);
    const pendingView: StandardEstimateSaleView = {
      ...v25View, prices: { ...v25View.prices, sash2: { por: true } },
    };
    expect(simulatorCandidatePriceDelta(v25Input(v25Standard, pendingView),
      { kind: 'slot', slotCode: 'window-1' }, candidate).kind).toBe('pending');
  });

  it('外壁4面の候補は対象面だけ標準と比較し、他面は変更したまま保持', () => {
    const data = bundle([category('wall', 'exterior-wall')], [
      option('wall-standard', 'wall', 0), option('wall-up', 'wall', 2000),
    ]);
    const standardFaces = (['front', 'right', 'back', 'left'] as const).map((face_code) => ({
      face_code, option_id: 'wall-standard', variant_choice_ids: [],
    }));
    const candidateFaces = standardFaces.map((face) =>
      face.face_code === 'right' ? { ...face, option_id: 'wall-up' } : face);
    const input = legacy(data, plan(['wall-standard'], [], standardFaces), plan(['wall-standard'], [], standardFaces));
    expect(simulatorCandidatePriceDelta(input, { kind: 'exterior-face', faceCode: 'right' },
      plan(['wall-standard'], [], candidateFaces))).toEqual({ kind: 'changed', deltaIncludingTax: 2200 });
  });

  it('選択依存で対象外の商品の変更が必要な候補は未確定にし、保存しない', () => {
    const c = category('toilet');
    const other = category('supply');
    const o = [option('standard', 'toilet', 10000), option('candidate', 'toilet', 12000), option('supply', 'supply', 3000)];
    const data = bundle([c, other], o);
    const context = { options: o, categories: [c, other],
      dependencies: [{ option_id: 'candidate', requires_option_id: 'supply' }],
      conflicts: [], canSelectNew: () => true };
    const start = plan(['standard']);
    const candidate = simulatePickerCategoryCandidate({
      bundle: data, ruleContext: context, current: start,
      categoryId: 'toilet', nextInCategory: ['candidate'],
      nextVariants: [], positionCategoryIds: new Set(),
    });
    expect(candidate).toBeNull();
    expect(start.optionIds).toEqual(['standard']);
  });
});
