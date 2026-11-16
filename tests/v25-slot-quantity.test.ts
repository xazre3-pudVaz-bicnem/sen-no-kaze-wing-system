import { describe, expect, it } from 'vitest';
import {
  computeSaleViewPricing,
  v25DisplayCatalog,
  v25SlotMeasure,
  withoutCatalogCosts,
  type StandardEstimateSaleView,
} from '@/lib/domain/standard-estimate-sale-view';
import { v25SlotRuleIssues } from '@/lib/domain/standard-estimate-v25-workbench';
import type { CatalogBundle, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';

// #647：選択枠の「選ぶ数」と「計上数量」を分ける。DB の実行時検査（scripts/db-rehearsal/runtime-v25-slot-quantity.sql）と同じ数：
// 率は販売費 100%・掛率 150%・経費 15%。屋根1（標準の選択肢 v-std）の原価 7,000 円/㎡ → 売価 10,500 円/㎡ × 23.5㎡ ＝ 246,750 円。
// 屋根1 の選択肢 v-alt は原価 +500 円（売価 11,250 円/㎡）。床1（位置の枠・数量 1）4,500 円
const view: StandardEstimateSaleView = {
  pricing_model: 'v2.5',
  revision_id: 'rev-647',
  version: 1,
  base_model_id: 'model',
  spec_code: 'office',
  size_code: '2100x4550',
  fire_spec_code: 'non_fire',
  tax_rate: '0.100000',
  expense_rate: '0.1500',
  subtotal_raw: 288937,
  adjustment: 0,
  subtotal: 288937,
  tax: 28893,
  total: 317830,
  has_por: false,
  sections: [
    { code: 'base', expense_method: 'rate', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
    { code: 'interior_exterior', expense_method: 'rate', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
    { code: 'option', expense_method: 'rate', line_subtotal: 251250, expense_amount: 37687, total: 288937, has_por: false },
    { code: 'sitework', expense_method: 'none', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
  ],
  base_lines: [],
  lines: [
    { section_code: 'option', group_label: '屋根', name: '屋根1 ／ 標準', quantity: '23.5000', unit: '㎡', unit_price: 10500, amount: 246750, is_por: false },
    { section_code: 'option', group_label: '床（ホール）', name: '床1', quantity: '1.0000', unit: '式', unit_price: 4500, amount: 4500, is_por: false, slot_code: 'hall' },
  ],
  baseline: [
    {
      option_id: 'r1', section_code: 'option', selection_target_code: 'runtime-q647-roof', quantity: '23.5000', unit_price: 10500,
      price_on_request: false, variant_choice_ids: ['v-std'], variant_extra: 0, amount: 246750, unit: '㎡', measured: true,
      slot_code: null, category_id: 'cat-roof', selectable_option_ids: null,
    },
    {
      option_id: 'f1', section_code: 'option', selection_target_code: 'runtime-q647-floor', quantity: '1.0000', unit_price: 4500,
      price_on_request: false, variant_choice_ids: [], variant_extra: 0, amount: 4500, unit: '㎡', measured: true,
      slot_code: 'hall', slot_label: 'ホール', category_id: 'cat-floor', selectable_option_ids: ['f1', 'f2'],
    },
  ],
  prices: {
    r1: { groups: [['v-std', 'v-alt']], units: { '0': 10500, '1': 11250, '-': 10500 } },
    r2: { groups: [], units: { '': 12000 } },
    r3: { groups: [], units: { '': 7500 } },
    f1: { groups: [], units: { '': 4500 } },
    f2: { groups: [], units: { '': 6000 } },
  },
};

const option = (id: string, categoryId: string, priceUnit: string | null) =>
  ({
    id,
    code: `runtime-q647-${id}`,
    name: `#647 ${id}`,
    category_id: categoryId,
    base_model_id: null,
    price: 0,
    price_on_request: false,
    is_installation: false,
    status: 'published',
    image_url: null,
    price_unit: priceUnit,
  }) as unknown as ProductOption;

const groups = [{ id: 'g-color', option_id: 'r1', code: 'color', name: '色', sort_order: 1, is_required: true, status: 'published' }] as unknown as OptionVariantGroup[];
const choices = [
  { id: 'v-std', group_id: 'g-color', code: 'std', name: '標準', kind: 'standard', extra_price: 0, price_on_request: false, status: 'published', sort_order: 1 },
  { id: 'v-alt', group_id: 'g-color', code: 'alt', name: '別色', kind: 'option', extra_price: 0, price_on_request: false, status: 'published', sort_order: 2 },
] as unknown as OptionVariantChoice[];

const bundleWith = (r1Unit: string | null) =>
  ({
    model: { id: 'model', slug: 'runtime-q647-model', base_price: 1000000, presets: [] },
    categories: [
      { id: 'cat-roof', code: 'runtime-q647-roof', name: '屋根', selection_mode: 'single' },
      { id: 'cat-floor', code: 'runtime-q647-floor', name: '床', selection_mode: 'single' },
    ],
    options: [option('r1', 'cat-roof', r1Unit), option('r2', 'cat-roof', '㎡'), option('r3', 'cat-roof', '式'), option('f1', 'cat-floor', '㎡'), option('f2', 'cat-floor', '㎡')],
    variantGroups: groups,
    variantChoices: choices,
  }) as unknown as CatalogBundle;
const bundle = bundleWith('㎡');

const hall = [{ slot_code: 'hall', option_id: 'f1', variant_choice_ids: [] }];
const optionDelta = (result: ReturnType<typeof computeSaleViewPricing>) => result.sections.find((section) => section.code === 'option')?.delta_line;

describe('#647：お客様の選択に、選択枠の計上数量を掛ける（DB の standard_estimate_v25_slot_measure・configuration_money と同じ）', () => {
  it('標準のままなら差額 0（屋根 23.5㎡ を 1 個分で数えない）。画面の行も 23.5 ㎡ 分', () => {
    const result = computeSaleViewPricing(withoutCatalogCosts(bundle), view, ['r1'], ['v-std'], [], undefined, hall);
    expect(optionDelta(result)).toBe(0);
    expect(result.pricing.has_price_on_request).toBe(false);
    const roof = result.pricing.lines.find((line) => line.option_id === 'r1');
    expect([roof?.quantity, roof?.unit, roof?.unit_price, roof?.amount]).toEqual([23.5, '㎡', 10500, 246750]);
    const floor = result.pricing.lines.find((line) => line.option_id === 'f1');
    expect([floor?.quantity, floor?.amount]).toEqual([1, 4500]);
  });

  it('屋根を同じ販売単位の屋根2（12,000 円/㎡）に変えると、差額は 23.5㎡ 分（282,000 − 246,750 ＝ 35,250）', () => {
    expect(optionDelta(computeSaleViewPricing(withoutCatalogCosts(bundle), view, ['r2'], [], [], undefined, hall))).toBe(35250);
  });

  it('同じ屋根の別の選択肢は、売価の表の単価 × 23.5（264,375 − 246,750 ＝ 17,625）', () => {
    expect(optionDelta(computeSaleViewPricing(withoutCatalogCosts(bundle), view, ['r1'], ['v-alt'], [], undefined, hall))).toBe(17625);
  });

  it('販売単位の違う商品（屋根3 は「式」）には計上数量を掛けず、価格未確定にする', () => {
    const result = computeSaleViewPricing(withoutCatalogCosts(bundle), view, ['r3'], [], [], undefined, hall);
    expect(result.pricing.has_price_on_request).toBe(true);
    expect(optionDelta(result)).toBe(-246750);
  });

  it('標準の商品の販売単位が後から変わっても、版の枠と同じ「商品＋選択肢」はそのまま。別の選択肢は価格未確定', () => {
    const changed = bundleWith('式');
    expect(optionDelta(computeSaleViewPricing(withoutCatalogCosts(changed), view, ['r1'], ['v-std'], [], undefined, hall))).toBe(0);
    const alt = computeSaleViewPricing(withoutCatalogCosts(changed), view, ['r1'], ['v-alt'], [], undefined, hall);
    expect(alt.pricing.has_price_on_request).toBe(true);
  });

  it('v25SlotMeasure：計上数量を掛ける枠の数量。古い版（measured なし）は 1。前後の半角空白は DB と同じく外す', () => {
    const r1 = option('r1', 'cat-roof', null);
    expect(v25SlotMeasure(view, r1, null, ['v-std'])).toBe('23.5000');
    expect(v25SlotMeasure(view, r1, null, ['v-alt'])).toBeNull();
    expect(v25SlotMeasure(view, option('r2', 'cat-roof', ' ㎡ '), null, [])).toBe('23.5000');
    expect(v25SlotMeasure(view, option('r3', 'cat-roof', '式'), null, [])).toBeNull();
    expect(v25SlotMeasure(view, option('f2', 'cat-floor', '㎡'), 'hall', [])).toBe(1);
    const old = { ...view, baseline: view.baseline.map((item) => ({ ...item, measured: undefined })) };
    expect(v25SlotMeasure(old, option('r2', 'cat-roof', '㎡'), null, [])).toBe(1);
  });

  it('画面の商品価格・選択肢の差額は計上数量分（カードの差額と合計の差額がそろう）。単位の違う商品は別途見積', () => {
    const display = v25DisplayCatalog(bundle.options, groups, choices, view);
    const price = (id: string) => display.options.find((row) => row.id === id);
    expect([price('r1')?.price, price('r2')?.price, price('r3')?.price_on_request, price('f1')?.price]).toEqual([246750, 282000, true, 4500]);
    expect(display.choices.find((row) => row.id === 'v-alt')?.extra_price).toBe(17625);
  });
});

describe('#647：標準見積の画面の公開の判定（DB の standard_estimate_v25_slot_rule_issues と同じ決まり・文言）', () => {
  const candidates = {
    r1: { name: '屋根1', categoryId: 'cat-roof', categoryName: '屋根', categoryCode: 'roof', singleSelect: true, priceUnit: '㎡' },
    r2: { name: '屋根2', categoryId: 'cat-roof', categoryName: '屋根', categoryCode: 'roof', singleSelect: true, priceUnit: '㎡' },
    r3: { name: '屋根3', categoryId: 'cat-roof', categoryName: '屋根', categoryCode: 'roof', singleSelect: true, priceUnit: '式' },
    f1: { name: '床1', categoryId: 'cat-floor', categoryName: '床', categoryCode: 'floor', singleSelect: true, priceUnit: '㎡' },
    m1: { name: '設備1', categoryId: 'cat-multi', categoryName: '設備', categoryCode: 'equipment', singleSelect: false, priceUnit: '台' },
    nounit: { name: '屋根（単位なし）', categoryId: 'cat-roof2', categoryName: '屋根2', categoryCode: 'roof2', singleSelect: true, priceUnit: null },
  } as const;
  const of = (id: string) => candidates[id as keyof typeof candidates];
  const inCategory = (categoryId: string) => Object.values(candidates).filter((candidate) => candidate.categoryId === categoryId);

  it('1 つだけ選べるカテゴリーにその枠だけ・販売単位がそろえば、屋根 23.5 は問題なし', () => {
    expect(
      v25SlotRuleIssues(
        [
          { option_id: 'r1', quantity: '23.5' },
          { option_id: 'f1', quantity: '1', slot_code: 'hall', selectable_option_ids: [] },
        ],
        of,
        (categoryId) => inCategory(categoryId).filter((candidate) => candidate.name !== '屋根3')
      )
    ).toEqual([]);
  });

  it('カテゴリーの販売単位の違う商品・販売単位の無い標準の商品・多く選べるカテゴリーと位置の枠の数量 1 以外を挙げる', () => {
    expect(
      v25SlotRuleIssues(
        [
          { option_id: 'r1', quantity: '23.5' },
          { option_id: 'f1', quantity: '12.5', slot_code: 'hall', selectable_option_ids: [] },
          { option_id: 'nounit', quantity: '2' },
          { option_id: 'm1', quantity: '2' },
        ],
        of,
        inCategory
      )
    ).toEqual([
      '外壁以外の選択枠の数量を 1 以外にできるのは、1 つだけ選べるカテゴリーにその選択枠だけがあるときです（位置・用途の選択枠とほかは数量 1 にし、個別に選ばない数量は明細にします）：「床1」・「設備1」',
      '数量が 1 以外の選択枠には、商品台帳の販売単位（12 文字まで）が必要です（商品台帳で販売単位を設定してから、下書きを保存し直してください）：「屋根（単位なし）」',
      '数量が 1 以外の選択枠のカテゴリーの商品は、標準の商品と同じ販売単位にしてください：「屋根3」（式）',
    ]);
  });
});
