'use client';

import { useMemo, useState } from 'react';
import { EquipmentBoard } from '@/components/simulator/equipment-board';
import { OptionPickerDialog } from '@/components/simulator/option-picker-dialog';
import { createSimulatorCardDeltaEvaluator, type SimulatorCardPriceInput } from '@/lib/domain/simulator-card-price-delta';
import { simulatorCandidatePriceDelta } from '@/lib/domain/simulator-candidate-price-delta';
import { computeSaleViewPricing, type StandardEstimateSaleView } from '@/lib/domain/standard-estimate-sale-view';
import type { CatalogBundle, OptionCategory, ProductOption } from '@/lib/domain/types';

/** 本番DBには接続しない。公開第2版の売価・区分小計・経費率の検証用スナップショット。 */
const toilet = { id: 'toilet', code: 'toilet', name: 'トイレ', group_sort: 1,
  sort_order: 1, status: 'published', finish_level: 'full', customer_visible: true,
  selection_mode: 'single', is_required: true } as unknown as OptionCategory;
const products = [
  { id: 'toilet-standard', code: 'toilet-standard', name: '基本プラン アラウーノ S160',
    price: 0 },
  { id: 'toilet-up', code: 'toilet-up', name: 'GG3-800 ウォシュレット一体形便器',
    price: 0 },
  { id: 'toilet-down', code: 'toilet-down', name: 'アメージュ便器＋シャワートイレD11',
    price: 0 },
].map((item) => ({
  ...item, category_id: 'toilet', price_unit: '台', status: 'published',
  is_default: false, is_installation: false, price_on_request: false,
  is_required: false, selection_type: 'radio', sort_order: 1, image_url: null,
  manufacturer: null, model_no: null, size_note: null, description: null,
})) as unknown as ProductOption[];
const bundle = {
  model: { id: 'model', slug: 'model', base_price: 0, expense_rate: 0.15, presets: [] },
  categories: [toilet], options: products, variantGroups: [], variantChoices: [],
  dependencies: [], conflicts: [], previewRules: [], baseBreakdowns: [],
  images: [], hotspots: [],
} as unknown as CatalogBundle;
const view: StandardEstimateSaleView = {
  pricing_model: 'v2.5', revision_id: 'fixture-published-v2.5-2', version: 2,
  base_model_id: 'model', spec_code: 'hotel', size_code: 'wing', fire_spec_code: 'non_fire',
  tax_rate: '0.100000', expense_rate: '0.1500',
  subtotal_raw: 6309054, adjustment: 0, subtotal: 6309054, tax: 630905, total: 6939959,
  has_por: false,
  sections: [
    { code: 'base', line_subtotal: 1176034, expense_amount: 176405, total: 1352439, expense_method: 'rate', has_por: false },
    { code: 'interior_exterior', line_subtotal: 2296600, expense_amount: 344490, total: 2641090, expense_method: 'rate', has_por: false },
    { code: 'option', line_subtotal: 2013500, expense_amount: 302025, total: 2315525, expense_method: 'rate', has_por: false },
    { code: 'sitework', line_subtotal: 0, expense_amount: 0, total: 0, expense_method: 'none', has_por: false },
  ],
  base_lines: [], lines: [],
  baseline: [{
    option_id: 'toilet-standard', category_id: 'toilet', section_code: 'option',
    selection_target_code: 'toilet', slot_code: null, selectable_option_ids: null,
    quantity: '1.0000', unit: '台', measured: true,
    unit_price: 294000, amount: 294000, price_on_request: false,
    variant_choice_ids: [], variant_extra: 0,
  }],
  prices: {
    'toilet-standard': { groups: [], units: { '': 294000 } },
    'toilet-up': { groups: [], units: { '': 372000 } },
    'toilet-down': { groups: [], units: { '': 186000 } },
  },
};

export function SimulatorCandidateIntegrationFixture() {
  const [selected, setSelected] = useState('toilet-standard');
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = useMemo(() => ({ optionIds: [selected], variantChoiceIds: [], exteriorFaces: [] }), [selected]);
  const input: SimulatorCardPriceInput = useMemo(() => ({
    bundle, source: { kind: 'sale-view', view },
    current,
    standard: { optionIds: ['toilet-standard'], variantChoiceIds: [], exteriorFaces: [] },
  }), [current]);
  const evaluator = useMemo(() => createSimulatorCardDeltaEvaluator(input), [input]);
  const currentTotal = computeSaleViewPricing(bundle, view, [selected], [], []).pricing.total;
  const candidateDelta = (ids: string[], variants: string[]) => simulatorCandidatePriceDelta(
    input, { kind: 'category', categoryId: 'toilet' },
    { ...current, optionIds: ids, variantChoiceIds: variants }
  );
  return (
    <section data-testid="integrated-candidate-fixture" className="mt-8 border-t border-line py-6">
      <h2 className="text-lg font-semibold">隔離統合試験｜公開版と同条件のトイレ変更</h2>
      <output data-testid="integrated-official-total">{currentTotal}</output>
      <EquipmentBoard
        categories={[toilet]} options={products} selected={[selected]}
        baselineSelected={['toilet-standard']} readOnly={false}
        onPickCategory={() => setPickerOpen(true)} getCardDelta={evaluator.evaluate}
      />
      <button type="button" className="mt-3 rounded border p-2" onClick={() => setPickerOpen(true)} data-testid="integrated-open-picker">
        商品を選ぶ
      </button>
      {pickerOpen && <OptionPickerDialog
        category={toilet} options={products} selectedIds={[selected]}
        baselineSelectedIds={['toilet-standard']} blocked={new Map()}
        variantGroups={[]} variantChoices={[]} selectedVariantIds={[]} baselineVariantIds={[]}
        onClose={() => setPickerOpen(false)}
        onApply={(ids) => { if (ids[0]) setSelected(ids[0]); setPickerOpen(false); }}
        getCandidateDelta={candidateDelta}
      />}
    </section>
  );
}
