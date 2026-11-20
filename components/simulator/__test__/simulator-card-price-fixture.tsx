'use client';

import { EquipmentBoard, type EquipmentSlotTile } from '@/components/simulator/equipment-board';
import { createSimulatorCardDeltaEvaluator } from '@/lib/domain/simulator-card-price-delta';
import { computePricing } from '@/lib/domain/pricing';
import { computeSaleViewPricing, type StandardEstimateSaleView } from '@/lib/domain/standard-estimate-sale-view';
import type { CatalogBundle, OptionCategory, ProductOption } from '@/lib/domain/types';

/**
 * Synthetic, nonpersistent browser-only fixtures. No DB, sales data, auth or
 * feature switches. The real pricing functions calculate the displayed total.
 */
const cat = (id: string) => ({
  id, code: id, name: id, group_sort: 1, sort_order: 1, status: 'published',
  finish_level: 'full', selection_mode: 'single', customer_visible: true,
}) as unknown as OptionCategory;

const product = (id: string, categoryId: string, amount: number, unit = '式') => ({
  id, code: id, name: id, category_id: categoryId, price: amount, price_unit: unit,
  status: 'published', base_model_id: null, price_on_request: false,
  is_installation: false, is_default: false, is_required: false,
  sort_order: 1, selection_type: 'radio', image_url: null, description: null,
}) as unknown as ProductOption;

const bundle = (categories: OptionCategory[], options: ProductOption[]) => ({
  model: { id: 'model', slug: 'model', base_price: 0, expense_rate: 0.15, presets: [] },
  categories, options, variantGroups: [], variantChoices: [],
  dependencies: [], conflicts: [], images: [], hotspots: [], previewRules: [],
  baseBreakdowns: [],
}) as unknown as CatalogBundle;

const money = (delta: number) =>
  (delta >= 0 ? '＋' : '−') + Math.abs(delta).toLocaleString('ja-JP') + '円（税込）';

const legacyCats = [cat('roof'), cat('toilet'), cat('bed'), cat('kitchen')];
const legacyOptions = [
  product('roof-standard', 'roof', 10000),
  product('roof-upgrade', 'roof', 30000),
  product('toilet-standard', 'toilet', 20000),
  product('toilet-economy', 'toilet', 15000),
  product('bed-standard', 'bed', 6000),
  product('kitchen-standard', 'kitchen', 18000),
  product('kitchen-equal', 'kitchen', 18000),
];
const legacyBundle = bundle(legacyCats, legacyOptions);
const legacyCurrent = ['roof-upgrade', 'toilet-economy', 'bed-standard', 'kitchen-equal'];
const legacyStandard = ['roof-standard', 'toilet-standard', 'bed-standard', 'kitchen-standard'];
const legacyEvaluator = createSimulatorCardDeltaEvaluator({
  bundle: legacyBundle, source: { kind: 'legacy', baseOverride: null },
  current: { optionIds: legacyCurrent, variantChoiceIds: [], exteriorFaces: [] },
  standard: { optionIds: legacyStandard, variantChoiceIds: [], exteriorFaces: [] },
});
const legacyTotal = (ids: string[]) => computePricing(
  legacyBundle.model, legacyBundle.options, legacyBundle.categories,
  ids.map((option_id) => ({ option_id }))
).total;

const v25View: StandardEstimateSaleView = {
  pricing_model: 'v2.5', revision_id: 'local-synthetic-only', version: 1,
  base_model_id: 'model', spec_code: 'hotel', size_code: 'test', fire_spec_code: 'non_fire',
  tax_rate: '0.1000', expense_rate: '0.1500', subtotal_raw: 288937,
  adjustment: 0, subtotal: 288937, tax: 28893, total: 317830, has_por: false,
  sections: [
    { code: 'base', expense_method: 'rate', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
    { code: 'interior_exterior', expense_method: 'rate', line_subtotal: 251250, expense_amount: 37687, total: 288937, has_por: false },
    { code: 'option', expense_method: 'rate', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
    { code: 'sitework', expense_method: 'none', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
  ],
  base_lines: [], lines: [],
  baseline: [
    { option_id: 'roof1', section_code: 'interior_exterior', selection_target_code: 'roof',
      quantity: '23.5000', unit_price: 10500, amount: 246750,
      price_on_request: false, variant_choice_ids: [], variant_extra: 0,
      unit: '㎡', measured: true, slot_code: null, category_id: 'roof', selectable_option_ids: null },
    { option_id: 'sash1', section_code: 'interior_exterior', selection_target_code: 'sash',
      quantity: '1', unit_price: 4500, amount: 4500,
      price_on_request: false, variant_choice_ids: [], variant_extra: 0,
      unit: '式', measured: true, slot_code: 'window-1', slot_label: '窓①',
      category_id: 'sash', selectable_option_ids: ['sash1', 'sash2'] },
  ],
  prices: {
    roof1: { groups: [], units: { '': 10500 } },
    roof2: { groups: [], units: { '': 12000 } },
    sash1: { groups: [], units: { '': 4500 } },
    sash2: { groups: [], units: { '': 6000 } },
  },
};

const v25Cats = [cat('roof'), cat('sash')];
const v25Options = [product('roof1', 'roof', 0, '㎡'), product('roof2', 'roof', 0, '㎡'),
  product('sash1', 'sash', 0), product('sash2', 'sash', 0)];
const v25Bundle = bundle(v25Cats, v25Options);
const v25Slots = [{ slot_code: 'window-1', option_id: 'sash2', variant_choice_ids: [] }];
const baselineSlots = [{ slot_code: 'window-1', option_id: 'sash1', variant_choice_ids: [] }];
const v25Evaluator = createSimulatorCardDeltaEvaluator({
  bundle: v25Bundle,
  source: { kind: 'sale-view', view: v25View, activeSlotCodes: ['window-1'] },
  current: { optionIds: ['roof2'], variantChoiceIds: [], exteriorFaces: [], slotSelections: v25Slots },
  standard: { optionIds: ['roof1'], variantChoiceIds: [], exteriorFaces: [], slotSelections: baselineSlots },
});
const v25Total = (roofId: string, slots: typeof v25Slots) =>
  computeSaleViewPricing(v25Bundle, v25View, [roofId], [], [], undefined, slots).pricing.total;
const v25Tiles: EquipmentSlotTile[] = [
  { slotCode: 'window-1', categoryId: 'sash', label: '窓①',
    option: v25Options[3], variantNames: [] },
];

export function SimulatorCardPriceFixture() {
  const legacyCurrentTotal = legacyTotal(legacyCurrent);
  const roofDifference = legacyCurrentTotal - legacyTotal([
    'roof-standard', 'toilet-economy', 'bed-standard', 'kitchen-equal',
  ]);
  const toiletDifference = legacyCurrentTotal - legacyTotal([
    'roof-upgrade', 'toilet-standard', 'bed-standard', 'kitchen-equal',
  ]);
  const currentV25Total = v25Total('roof2', v25Slots);
  const roofV25Difference = currentV25Total - v25Total('roof1', v25Slots);
  const sashV25Difference = currentV25Total - v25Total('roof2', baselineSlots);

  return (
    <main className="container-x mx-auto max-w-5xl py-8" data-testid="isolated-card-fixture">
      <h1 className="mb-4 text-xl font-semibold">ローカル専用・商品カード税込差額検証</h1>
      <section data-testid="legacy-fixture" className="mb-8">
        <EquipmentBoard
          categories={legacyCats}
          options={legacyOptions}
          selected={legacyCurrent}
          baselineSelected={legacyStandard}
          readOnly
          onPickCategory={() => undefined}
          getCardDelta={legacyEvaluator.evaluate}
        />
        <output data-testid="legacy-official-total">{legacyCurrentTotal}</output>
        <output data-testid="expected-roof">{money(roofDifference)}</output>
        <output data-testid="expected-toilet">{money(toiletDifference)}</output>
      </section>
      <section data-testid="v25-fixture" className="mb-8">
        <EquipmentBoard
          categories={v25Cats}
          options={v25Options}
          selected={['roof2']}
          baselineSelected={['roof1']}
          slotTiles={v25Tiles}
          readOnly
          onPickCategory={() => undefined}
          getCardDelta={v25Evaluator.evaluate}
        />
        <output data-testid="v25-official-total">{currentV25Total}</output>
        <output data-testid="expected-v25-roof">{money(roofV25Difference)}</output>
        <output data-testid="expected-v25-sash">{money(sashV25Difference)}</output>
      </section>
    </main>
  );
}
