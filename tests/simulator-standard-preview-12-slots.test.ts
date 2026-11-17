import { describe, expect, it } from 'vitest';
import { buildV25SpecSelection } from '@/lib/domain/estimate-template';
import { activeV25SlotSelections } from '@/lib/domain/simulator-position-slots';
import { v25SimulatorStandardState } from '@/lib/domain/simulator-standard-state';
import {
  computeSaleViewPricing,
  pickSaleView,
  v25PositionSlotCategoryIds,
  v25PositionSlots,
  v25SlotOptionIds,
  type StandardEstimateSaleView,
} from '@/lib/domain/standard-estimate-sale-view';
import type { RuleContext } from '@/lib/domain/rules';
import type { CatalogBundle } from '@/lib/domain/types';

// 2026-11-17 に確認した Wing ホテル非防火 v2.5 第2版の金額・12 枠の「検査用の縮約データ」。
// 価格計算・DB の実データや本番ブラウザとは独立。商品ID・仕様選択肢は検査専用の値。
// 公開版：本体 1,352,439、内外装 2,641,090、オプション 2,315,525、税込 6,939,959 円。
type FixtureItem = {
  id: string;
  category: string;
  section: 'interior_exterior' | 'option';
  amount: number;
  position?: string;
};
const items: FixtureItem[] = [
  { id: 'entrance', category: 'entrance-door', section: 'interior_exterior', amount: 237000 },
  { id: 'service', category: 'service-door', section: 'interior_exterior', amount: 153000 },
  { id: 'window-1', category: 'sash', section: 'interior_exterior', amount: 186000, position: 'window-1' },
  { id: 'window-2', category: 'sash', section: 'interior_exterior', amount: 111000, position: 'window-2' },
  { id: 'window-3', category: 'sash', section: 'interior_exterior', amount: 78000, position: 'window-3' },
  { id: 'bath', category: 'ub', section: 'option', amount: 540000 },
  { id: 'toilet', category: 'toilet', section: 'option', amount: 294000 },
  { id: 'washbasin', category: 'washbasin', section: 'option', amount: 204000 },
  { id: 'aircon', category: 'aircon', section: 'option', amount: 315000 },
  { id: 'boiler', category: 'boiler', section: 'option', amount: 123000 },
  { id: 'storage', category: 'entrance-storage', section: 'option', amount: 90000 },
  { id: 'bed', category: 'bed', section: 'option', amount: 90000 },
];
const option = (id: string, category: string) => ({
  id,
  code: `fixture-${id}`,
  name: id,
  category_id: `cat-${category}`,
  base_model_id: null,
  price: 0,
  price_unit: '式',
  price_on_request: false,
  is_installation: false,
  is_required: false,
  is_default: false,
  simulator_visible: true,
  spec_codes: [],
  status: 'published',
  sort_order: 1,
  image_url: null,
});
const categories = [...new Set(items.map((item) => item.category))].map((code) => ({
  id: `cat-${code}`,
  code,
  name: code,
  finish_level: ['entrance-door', 'service-door', 'sash'].includes(code) ? 'shell' : 'equipment',
  selection_mode: code === 'sash' ? 'multi' : 'single',
  status: 'published',
  is_required: false,
  customer_visible: true,
  sort_order: 1,
}));
const bundle = {
  model: {
    id: 'wing-model',
    slug: 'wing-01',
    base_price: 0,
    presets: [{ code: 'hotel', name: 'ホテル', option_codes: [], description: '' }],
  },
  options: [
    ...items.map((item) => option(item.id, item.category)),
    option('alternate-window', 'sash'),
  ],
  categories,
  dependencies: [],
  conflicts: [],
  customerCategoryMatrix: null,
  variantGroups: [],
  variantChoices: [],
} as unknown as CatalogBundle;

const view = {
  pricing_model: 'v2.5',
  revision_id: 'wing-hotel-non-fire-v2',
  version: 2,
  base_model_id: 'wing-model',
  spec_code: 'hotel',
  size_code: '3640x4550',
  fire_spec_code: 'non_fire',
  tax_rate: '0.1',
  expense_rate: '0.15',
  subtotal_raw: 6309054,
  adjustment: 0,
  subtotal: 6309054,
  tax: 630905,
  total: 6939959,
  has_por: false,
  sections: [
    { code: 'base', expense_method: 'rate', line_subtotal: 1176034, expense_amount: 176405, total: 1352439, has_por: false },
    { code: 'interior_exterior', expense_method: 'rate', line_subtotal: 2296600, expense_amount: 344490, total: 2641090, has_por: false },
    { code: 'option', expense_method: 'rate', line_subtotal: 2013500, expense_amount: 302025, total: 2315525, has_por: false },
    { code: 'sitework', expense_method: 'none', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
  ],
  base_lines: [],
  lines: [],
  baseline: items.map((item) => ({
    option_id: item.id,
    section_code: item.section,
    selection_target_code: item.category,
    quantity: '1',
    unit_price: item.amount,
    price_on_request: false,
    variant_choice_ids: [],
    variant_extra: 0,
    amount: item.amount,
    slot_code: item.position ?? null,
    slot_label: item.position ? `窓${item.position}` : null,
    category_id: `cat-${item.category}`,
    selectable_option_ids: item.position === 'window-1' ? ['window-1', 'alternate-window'] : item.position ? [item.id] : null,
  })),
  prices: Object.fromEntries([
    ...items.map((item) => [item.id, { groups: [], units: { '': item.amount } }]),
    ['alternate-window', { groups: [], units: { '': 200000 } }],
  ]),
} as unknown as StandardEstimateSaleView;

const ctx: RuleContext = {
  options: bundle.options,
  categories: bundle.categories,
  dependencies: [],
  conflicts: [],
  customerCategoryMatrix: null,
};

function standardSelections() {
  const ids = v25SlotOptionIds(view) ?? [];
  const optionIds = buildV25SpecSelection(
    ctx, bundle.model, 'hotel', ids, null, v25PositionSlotCategoryIds(view, bundle.options)
  );
  const state = v25SimulatorStandardState(bundle, 'hotel', optionIds, () => []);
  const slots = v25PositionSlots(view);
  const selections = activeV25SlotSelections(slots, [], {
    inScope: () => true,
    canSelect: () => true,
    variantGroups: bundle.variantGroups,
    variantChoices: bundle.variantChoices,
  }).selections;
  return { state, slots, selections };
}

describe('本部標準プレビュー：Wingホテル仕様・非防火 第2版（縮約データ）', () => {
  it('公開済み12商品枠（カテゴリー9・位置3）から開始し、差額0で税込6,939,959円', () => {
    const { state, slots, selections } = standardSelections();
    expect(view.baseline).toHaveLength(12);
    expect(state.optionIds).toHaveLength(9);
    expect(state.finishLevel).toBe('full');
    expect(slots).toHaveLength(3);
    expect(selections).toHaveLength(3);
    expect(selections.map((slot) => slot.option_id)).toEqual(['window-1', 'window-2', 'window-3']);
    const result = computeSaleViewPricing(bundle, view, state.optionIds, state.variantChoiceIds, state.exteriorFaces, undefined, selections);
    expect(result.pricing.total).toBe(6939959);
    expect(result.has_changes).toBe(false);
    expect(result.sections.find((section) => section.code === 'interior_exterior')?.delta_line).toBe(0);
    expect(result.sections.find((section) => section.code === 'option')?.delta_line).toBe(0);
  });

  it('標準オプションを外すと変更差額が発生し、価格は変更に応じて下がる', () => {
    const { state, selections } = standardSelections();
    const reduced = computeSaleViewPricing(bundle, view, state.optionIds.filter((id) => id !== 'bed'), [], [], undefined, selections);
    expect(reduced.sections.find((section) => section.code === 'option')?.delta_line).toBe(-90000);
    expect(reduced.pricing.total).toBe(6826109);
    expect(reduced.has_changes).toBe(true);
  });

  it('窓の位置を1つだけ変更すると、その位置だけが差額計算される', () => {
    const { state, slots } = standardSelections();
    const selections = activeV25SlotSelections(slots, [
      { slot_code: 'window-1', option_id: 'alternate-window', variant_choice_ids: [] },
    ], {
      inScope: () => true,
      canSelect: () => true,
      variantGroups: [],
      variantChoices: [],
    }).selections;
    expect(selections.map((slot) => slot.option_id)).toEqual(['alternate-window', 'window-2', 'window-3']);
    const changed = computeSaleViewPricing(bundle, view, state.optionIds, [], [], undefined, selections);
    expect(changed.sections.find((section) => section.code === 'interior_exterior')?.delta_line).toBe(14000);
    expect(changed.has_changes).toBe(true);
  });

  it('ホテル非防火の版を取得し、防火版が無い場合は既存のフォールバックを維持する', () => {
    expect(pickSaleView([view], 'wing-01', 'hotel', false)?.revision_id).toBe(view.revision_id);
    expect(pickSaleView([view], 'wing-01', 'hotel', true)?.revision_id).toBe(view.revision_id);
  });
});
