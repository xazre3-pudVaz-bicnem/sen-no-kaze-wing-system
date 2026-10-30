import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeSaleViewPricing,
  isV25SaleView,
  pendingSaleViewPricing,
  pickSaleView,
  v25ConfigurationPricing,
  v25DisplayCatalog,
  v25PriceKey,
  v25SelectionUnit,
  v25StandardVariantIds,
  v25UnitKey,
  withoutCatalogCosts,
  withoutTemplatePrices,
  type StandardEstimateSaleView,
} from '@/lib/domain/standard-estimate-sale-view';
import { computePricing } from '@/lib/domain/pricing';
import type { ExteriorFaceSelection } from '@/lib/domain/exterior-wall';
import type { CatalogBundle, EstimateTemplateBundle } from '@/lib/domain/types';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8').split('\r').join('');

// DB の実行時検査（scripts/db-rehearsal/runtime-simulator-v25-pricing.sql）と同じ版：率 1.07・1.5、経費 15%、本体 18,200 円 × 12 本、
// 商品1（標準 c1）160,500 円、商品2 32,100 円、設置工事 50,000 円。シミュレーターの選択は数量 1 なので、商品2 の選択枠は 1 個にした
const view: StandardEstimateSaleView = {
  pricing_model: 'v2.5',
  revision_id: 'rev-v25',
  version: 2,
  base_model_id: 'model',
  spec_code: 'office',
  size_code: '2100x4550',
  fire_spec_code: 'non_fire',
  tax_rate: '0.100000',
  expense_rate: '0.1500',
  subtotal_raw: 674601,
  adjustment: 0,
  subtotal: 674601,
  tax: 67460,
  total: 742061,
  has_por: false,
  sections: [
    { code: 'base', expense_method: 'rate', line_subtotal: 350532, expense_amount: 52579, total: 403111, has_por: false },
    { code: 'interior_exterior', expense_method: 'rate', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
    { code: 'option', expense_method: 'rate', line_subtotal: 192600, expense_amount: 28890, total: 221490, has_por: false },
    { code: 'sitework', expense_method: 'none', line_subtotal: 50000, expense_amount: 0, total: 50000, has_por: false },
  ],
  base_lines: [{ section: '1．金物', name: '伸縮脚', quantity: 12, unit: '本', unit_price: 29211, amount: 350532 }],
  lines: [
    { section_code: 'option', group_label: 'C1 検査', name: 'C1 商品1 ／ 標準', quantity: '1', unit: '式', unit_price: 160500, amount: 160500, is_por: false },
    { section_code: 'option', group_label: 'C1 検査', name: 'C1 商品2', quantity: '1', unit: '式', unit_price: 32100, amount: 32100, is_por: false },
    { section_code: 'sitework', group_label: null, name: '設置工事', quantity: '1', unit: '式', unit_price: 50000, amount: 50000, is_por: false },
  ],
  baseline: [
    { option_id: 'p1', section_code: 'option', selection_target_code: 'runtime-svp-category', quantity: '1', unit_price: 160500, price_on_request: false, variant_choice_ids: ['c1'], variant_extra: 0, amount: 160500 },
    { option_id: 'p2', section_code: 'option', selection_target_code: 'runtime-svp-category', quantity: '1', unit_price: 32100, price_on_request: false, variant_choice_ids: [], variant_extra: 0, amount: 32100 },
  ],
  // 商品1 の原価を 110,000 円に改定した後の表（選ばない・標準・大）。標準は版の選択枠と同じなので、公開した版の売価のまま
  prices: {
    p1: { groups: [['c1', 'c2']], units: { '-': 176550, '0': 160500, '1': 184575 } },
    p2: { groups: [], units: { '': 32100 } },
    p3: { por: true },
    p4: { por: true },
    p5: { por: true },
  },
};

const option = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  code: `runtime-svp-${id}`,
  name: `C1 ${id}`,
  category_id: 'cat-opt',
  base_model_id: null,
  price: 0,
  price_on_request: false,
  is_installation: false,
  status: 'published',
  image_url: null,
  ...extra,
});

// 商品価格の列は原価（v2.5 の売価の計算には使わない）
const bundle = {
  model: { id: 'model', slug: 'runtime-svp-model', base_price: 1000000, presets: [] },
  categories: [
    { id: 'cat-opt', code: 'runtime-svp-category', name: 'C1 検査' },
    { id: 'cat-wall', code: 'exterior-wall', name: '外壁' },
  ],
  options: [
    option('p1', { price: 110000 }),
    option('p2', { price: 20000 }),
    option('p3', { price: 50000 }),
    option('p4', { price: 15000, is_installation: true }),
    option('p5', { price_on_request: true }),
    option('ew', { category_id: 'cat-wall', price: 13000 }),
    option('ew2', { category_id: 'cat-wall', price: 16000 }),
  ],
  variantGroups: [{ id: 'g1', option_id: 'p1', code: 'size', name: 'サイズ', sort_order: 1, is_required: true, status: 'published' }],
  variantChoices: [
    { id: 'c1', group_id: 'g1', code: 'standard', name: '標準', kind: 'standard', extra_price: 0, price_on_request: false, status: 'published', sort_order: 1 },
    { id: 'c2', group_id: 'g1', code: 'large', name: '大', kind: 'option', extra_price: 5000, price_on_request: false, status: 'published', sort_order: 2 },
  ],
} as unknown as CatalogBundle;

const faces = (front: string, others = 'ew'): ExteriorFaceSelection[] => [
  { face_code: 'front', option_id: front, variant_choice_ids: [] },
  { face_code: 'right', option_id: others, variant_choice_ids: [] },
  { face_code: 'back', option_id: others, variant_choice_ids: [] },
  { face_code: 'left', option_id: others, variant_choice_ids: [] },
];

describe('v2.5 の売価の表（PR-C1）', () => {
  it('表のキーは、選択項目の順に選んだ選択肢の位置（選ばないは -）を . でつなぐ。表に無い・同じ項目の 2 つ選びは未確定', () => {
    const table = { groups: [['a', 'b'], ['c']] };
    expect(v25PriceKey(table, [])).toBe('-.-');
    expect(v25PriceKey(table, ['b'])).toBe('1.-');
    expect(v25PriceKey(table, ['c', 'a'])).toBe('0.0');
    expect(v25PriceKey(table, ['a', 'b'])).toBeNull();
    expect(v25PriceKey(table, ['x'])).toBeNull();
    // 選択項目の無い商品は空文字（DB の array_to_string('{}', '.') と同じ）
    expect(v25PriceKey({ groups: [] }, [])).toBe('');
  });

  it('版の選択枠と同じ「商品＋選択肢」は公開した版の売価、それ以外は今の原価 Version の表（DB の selection_unit と同じ）', () => {
    expect(v25SelectionUnit(view, 'p1', ['c1'])).toBe(160500);
    expect(v25SelectionUnit(view, 'p1', ['c2'])).toBe(184575);
    expect(v25SelectionUnit(view, 'p1', [])).toBe(176550);
    expect(v25SelectionUnit(view, 'p2', [])).toBe(32100);
    // 原価未設定・別途工事・別途見積・表に無い商品・ほかの商品の選択肢を混ぜた選び方は未確定
    expect(v25SelectionUnit(view, 'p3', [])).toBeNull();
    expect(v25SelectionUnit(view, 'p4', [])).toBeNull();
    expect(v25SelectionUnit(view, 'p5', [])).toBeNull();
    expect(v25SelectionUnit(view, 'unknown', [])).toBeNull();
    expect(v25SelectionUnit(view, 'p2', ['c2'])).toBeNull();
    // 未確定の選択枠は未確定
    const porSlot = { ...view, baseline: [{ ...view.baseline[0], price_on_request: true, amount: null }] };
    expect(v25SelectionUnit(porSlot, 'p1', ['c1'])).toBeNull();
  });
});

describe('v2.5 の標準見積でのシミュレーターの金額（PR-C1）：DB の configuration_money と同じ式', () => {
  it('標準のままなら公開した版の合計。商品価格の列（原価）は使わない', () => {
    const withCosts = computeSaleViewPricing(bundle, view, ['p1', 'p2'], ['c1'], []);
    const withoutCosts = computeSaleViewPricing(withoutCatalogCosts(bundle), view, ['p1', 'p2'], ['c1'], []);
    expect(withCosts.pricing.total).toBe(742061);
    expect(withCosts.has_changes).toBe(false);
    expect(withoutCosts.pricing).toEqual(withCosts.pricing);
    expect(withCosts.pricing.lines.map((line) => [line.option_id, line.unit_price])).toEqual([['p1', 160500], ['p2', 32100]]);
  });

  it('選択肢を変えると、今の原価の売価との差額と区分の経費を計算し直す（DB の実行時検査と同じ差額 24,075 円）', () => {
    const result = computeSaleViewPricing(withoutCatalogCosts(bundle), view, ['p1', 'p2'], ['c2'], []);
    expect(result.sections.find((section) => section.code === 'option')).toMatchObject({
      delta_line: 24075,
      line_subtotal: 216675,
      expense_amount: 32501,
    });
    expect(result.pricing).toMatchObject({ base_total: 403111, subtotal: 702287, tax: 70228, total: 772515, has_price_on_request: false });
  });

  it('価格未確定の商品は 0 円として合計し、別途見積の印を付ける（別途工事は自動計算しない）', () => {
    const result = computeSaleViewPricing(withoutCatalogCosts(bundle), view, ['p1', 'p2', 'p3', 'p4'], ['c1'], []);
    expect(result.pricing.total).toBe(742061);
    expect(result.pricing.has_price_on_request).toBe(true);
    const p3 = result.pricing.lines.find((line) => line.option_id === 'p3')!;
    const p4 = result.pricing.lines.find((line) => line.option_id === 'p4')!;
    expect([p3.amount, p3.price_on_request, p4.amount, p4.price_on_request]).toEqual([0, true, 0, true]);
  });

  it('シミュレーターの選択は数量 1。版の選択枠の数量が 2 なら、標準のままでも 1 個分の差額になる（v2.5 以前と DB と同じ決まり）', () => {
    const doubled: StandardEstimateSaleView = {
      ...view,
      sections: view.sections.map((section) => (section.code === 'option' ? { ...section, line_subtotal: 224700, expense_amount: 33705, total: 258405 } : section)),
      baseline: view.baseline.map((item) => (item.option_id === 'p2' ? { ...item, quantity: '2', amount: 64200 } : item)),
    };
    const result = computeSaleViewPricing(withoutCatalogCosts(bundle), doubled, ['p1', 'p2'], ['c1'], []);
    expect(result.sections.find((section) => section.code === 'option')?.delta_line).toBe(-32100);
  });

  it('外壁は 4 面を 1 面ずつ数える。選択枠を 4（面）で登録すれば、標準のままなら差額 0、1 面だけ変えればその差', () => {
    const wall: StandardEstimateSaleView = {
      ...view,
      sections: view.sections.map((section) =>
        section.code === 'interior_exterior' ? { ...section, line_subtotal: 80000, expense_amount: 12000, total: 92000 } : section
      ),
      baseline: [
        ...view.baseline,
        { option_id: 'ew', section_code: 'interior_exterior', selection_target_code: 'exterior-wall', quantity: '4', unit_price: 20000, price_on_request: false, variant_choice_ids: [], variant_extra: 0, amount: 80000 },
      ],
      prices: { ...view.prices, ew: { groups: [], units: { '': 20500 } }, ew2: { groups: [], units: { '': 25000 } } },
    };
    const same = computeSaleViewPricing(withoutCatalogCosts(bundle), wall, ['p1', 'p2', 'ew'], ['c1'], faces('ew'));
    expect(same.sections.find((section) => section.code === 'interior_exterior')).toMatchObject({ delta_line: 0, expense_amount: 12000 });
    const changed = computeSaleViewPricing(withoutCatalogCosts(bundle), wall, ['p1', 'p2', 'ew'], ['c1'], faces('ew2'));
    expect(changed.sections.find((section) => section.code === 'interior_exterior')).toMatchObject({ delta_line: 5000, line_subtotal: 85000, expense_amount: 12750 });
  });

  it('v2.5 の版は選択枠が無くても使う。v2.5 以前の版は従来どおり選択枠が要る', () => {
    expect(isV25SaleView(view)).toBe(true);
    expect(pickSaleView([{ ...view, baseline: [] }], 'runtime-svp-model', 'office', false)?.revision_id).toBe('rev-v25');
    const legacy = { ...view, pricing_model: undefined, baseline: [] };
    expect(isV25SaleView(legacy)).toBe(false);
    expect(pickSaleView([legacy], 'runtime-svp-model', 'office', false)).toBeNull();
  });

  it('計算の差し替え（unitPriceOf）は外壁の面にも効き、null は価格未確定', () => {
    const result = computePricing(bundle.model, bundle.options, bundle.categories, [{ option_id: 'p2' }], undefined, undefined, null, faces('ew'), (opt) =>
      opt.id === 'p2' ? null : 1000
    );
    expect(result.lines.find((line) => line.option_id === 'p2')).toMatchObject({ unit_price: 0, amount: 0, price_on_request: true });
    expect(result.lines.filter((line) => line.category_code === 'exterior-wall').map((line) => line.amount)).toEqual([1000, 1000, 1000, 1000]);
  });
});

describe('v2.5 の売価の画面表示（PR-C1）', () => {
  it('画面の商品価格は標準の選択肢での売価、選択肢の差額は標準と入れ替えたときの売価の差。版が無ければすべて未確定', () => {
    const display = v25DisplayCatalog(bundle.options, bundle.variantGroups, bundle.variantChoices, view);
    const price = (id: string) => display.options.find((row) => row.id === id)!;
    expect([price('p1').price, price('p1').price_on_request]).toEqual([160500, false]);
    expect([price('p2').price, price('p2').price_on_request]).toEqual([32100, false]);
    expect([price('p3').price_on_request, price('p4').price_on_request, price('p5').price_on_request]).toEqual([true, true, true]);
    const choice = (id: string) => display.choices.find((row) => row.id === id)!;
    expect([choice('c1').extra_price, choice('c2').extra_price, choice('c2').price_on_request]).toEqual([0, 24075, false]);

    const pending = v25DisplayCatalog(bundle.options, bundle.variantGroups, bundle.variantChoices, null);
    expect(pending.options.every((row) => row.price === 0 && row.price_on_request)).toBe(true);
    expect(pending.choices.every((row) => row.extra_price === 0 && row.price_on_request)).toBe(true);
  });

  it('お客様の画面へ渡すカタログから原価・本体の価格・本体内訳を外す（元のカタログは変えない）', () => {
    const withBase = { ...bundle, baseBreakdowns: [{ id: 'b1', base_model_id: 'model', spec_code: 'office', section: '1．金物', name: '伸縮脚', quantity: 12, unit: '本', unit_price: 18200, amount: 218400, remark: null, sort_order: 1 }] } as unknown as CatalogBundle;
    const stripped = withoutCatalogCosts(withBase);
    expect(stripped.options.every((row) => row.price === 0)).toBe(true);
    expect(stripped.variantChoices.every((row) => row.extra_price === 0)).toBe(true);
    expect(stripped.model.base_price).toBe(0);
    expect(stripped.baseBreakdowns.map((row) => [row.unit_price, row.amount])).toEqual([[0, 0]]);
    expect(bundle.options.find((row) => row.id === 'p1')?.price).toBe(110000);
    expect(withBase.baseBreakdowns[0].amount).toBe(218400);
  });

  it('旧テンプレートは仕様の選択肢・標準構成だけを渡し、金額を外す', () => {
    const template = {
      template: { id: 't', base_model_id: 'model', spec_code: 'office', name: '事務所', source_file_name: '', source_sheet_name: '', source_sha256: '', baseline_option_ids: ['p1'], tax_rate: 0.1, subtotal_raw: 900000, adjustment: -1000, subtotal: 899000, tax: 89900, total: 988900, imported_at: '', updated_at: '' },
      sections: [{ id: 's', template_id: 't', code: 'option', label: 'オプション', line_subtotal: 100000, expense_label: '経費', expense_rate: 0.15, expense_amount: 15000, total: 115000, sort_order: 1 }],
      lines: [{ id: 'l', template_id: 't', section_code: 'option', group_label: null, name: '照明', quantity: 1, unit: '式', unit_price: 100000, amount: 100000, remark: null, sort_order: 1 }],
      base_breakdown_items: [{ id: 'b', base_model_id: 'model', spec_code: 'office', section: '1．金物', name: '伸縮脚', quantity: 12, unit: '本', unit_price: 18200, amount: 218400, remark: null, sort_order: 1 }],
      baseline_option_ids: ['p1'],
    } as unknown as EstimateTemplateBundle;
    const [stripped] = withoutTemplatePrices([template]);
    expect(stripped.template).toMatchObject({ spec_code: 'office', name: '事務所', baseline_option_ids: ['p1'], subtotal: 0, total: 0, tax: 0 });
    expect(stripped.sections[0]).toMatchObject({ line_subtotal: 0, expense_amount: 0, total: 0 });
    expect(stripped.lines[0]).toMatchObject({ name: '照明', unit_price: null, amount: 0 });
    expect(stripped.base_breakdown_items[0]).toMatchObject({ unit_price: 0, amount: 0 });
    expect(stripped.baseline_option_ids).toEqual(['p1']);
  });

  it('v2.5 の版が無い仕様は価格準備中：すべて 0 円・別途見積', () => {
    const legacy = computePricing(bundle.model, bundle.options, bundle.categories, [{ option_id: 'p1', variant_choice_ids: ['c1'] }, { option_id: 'p2' }]);
    const pending = pendingSaleViewPricing(legacy);
    expect(pending).toMatchObject({ base_price: 0, base_total: 0, option_subtotal: 0, subtotal: 0, tax: 0, total: 0, has_price_on_request: true });
    expect(pending.lines.every((line) => line.amount === 0 && line.unit_price === 0 && line.price_on_request)).toBe(true);
  });

  it('保存した仕様の画面の金額：v2.5 の版があればシミュレーターと同じ、無い仕様・用途が無い仕様は価格準備中', () => {
    const input = { optionIds: ['p1', 'p2'], variantChoiceIds: ['c2'], exteriorFaces: [] };
    expect(v25ConfigurationPricing(bundle, [view], { ...input, specCode: 'office' }).pricing.total).toBe(772515);
    expect(v25ConfigurationPricing(bundle, [view], { ...input, specCode: 'hotel' }).pricing).toMatchObject({ total: 0, has_price_on_request: true });
    expect(v25ConfigurationPricing(bundle, [view], { ...input, specCode: null }).pricing).toMatchObject({ total: 0, has_price_on_request: true });
  });
});

// 組み合わせが多い商品（partial）：選択項目 2 つ（a1 標準・a2・a3、b1 標準・b2・b3）。表は標準（0.0）と 1 か所だけ変えた組み合わせだけ
const partialBundle = {
  ...bundle,
  options: [...bundle.options, option('p6', { price: 10000 })],
  variantGroups: [
    ...bundle.variantGroups,
    { id: 'ga', option_id: 'p6', code: 'a', name: '項目A', sort_order: 1, is_required: true, status: 'published' },
    { id: 'gb', option_id: 'p6', code: 'b', name: '項目B', sort_order: 2, is_required: true, status: 'published' },
  ],
  variantChoices: [
    ...bundle.variantChoices,
    ...['a1', 'a2', 'a3'].map((id, index) => ({ id, group_id: 'ga', code: id, name: id, kind: index === 0 ? 'standard' : 'option', extra_price: 0, price_on_request: false, status: 'published', sort_order: index + 1 })),
    ...['b1', 'b2', 'b3'].map((id, index) => ({ id, group_id: 'gb', code: id, name: id, kind: index === 0 ? 'standard' : 'option', extra_price: 0, price_on_request: false, status: 'published', sort_order: index + 1 })),
  ],
} as unknown as CatalogBundle;
// 原価 10,000、a2 +100・a3 +200、b2 +100・b3 +800 として DB が作った表（trunc(trunc(原価 × 1.07) × 1.5)）
const partialView: StandardEstimateSaleView = {
  ...view,
  prices: {
    ...view.prices,
    p6: {
      groups: [['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']],
      partial: true,
      default_key: '0.0',
      units: { '0.0': 16050, '-.0': 16050, '1.0': 16210, '2.0': 16371, '0.-': 16050, '0.1': 16210, '0.2': 17334 },
    },
  },
};

describe('組み合わせが多い商品の売価（PR-C1）', () => {
  it('表に無い組み合わせは undefined（まだ計算していない）。サーバーで計算した値があればそれを使う', () => {
    expect(v25SelectionUnit(partialView, 'p6', ['a1', 'b1'])).toBe(16050);
    expect(v25SelectionUnit(partialView, 'p6', ['a2', 'b1'])).toBe(16210);
    expect(v25SelectionUnit(partialView, 'p6', ['a2', 'b2'])).toBeUndefined();
    const lookup = new Map([[v25UnitKey('rev-v25', 'p6', ['b2', 'a2']), 16371]]);
    expect(v25SelectionUnit(partialView, 'p6', ['a2', 'b2'], lookup)).toBe(16371);
    // 版が違えば別の値（キーに版を含める）
    expect(v25SelectionUnit({ ...partialView, revision_id: 'other' }, 'p6', ['a2', 'b2'], lookup)).toBeUndefined();
    // 全部の組み合わせの表で表に無いものは未確定（null）のまま
    expect(v25SelectionUnit(partialView, 'p1', ['c1', 'c2'])).toBeNull();
  });

  it('まだ計算していない組み合わせは、1 か所ずつ変えた差を足した目安で計算し、missing_units に挙げる', () => {
    const approx = computeSaleViewPricing(withoutCatalogCosts(partialBundle), partialView, ['p1', 'p2', 'p6'], ['c1', 'a2', 'b2'], []);
    // 目安：16,050 ＋（16,210 − 16,050）×2 ＝ 16,370。正しい売価は原価 10,200 → trunc(trunc(10,200 × 1.07) × 1.5) ＝ 16,371
    // （v2.5 の式は差額を足してから率を掛けるので、1 か所ずつの差の足し算は 1 円ずれる）
    expect(approx.pricing.lines.find((line) => line.option_id === 'p6')?.unit_price).toBe(16370);
    expect(approx.missing_units).toEqual([{ revision_id: 'rev-v25', option_id: 'p6', choice_ids: ['a2', 'b2'] }]);
    const exact = computeSaleViewPricing(withoutCatalogCosts(partialBundle), partialView, ['p1', 'p2', 'p6'], ['c1', 'a2', 'b2'], [],
      new Map([[v25UnitKey('rev-v25', 'p6', ['a2', 'b2']), 16371]]));
    expect(exact.pricing.lines.find((line) => line.option_id === 'p6')?.unit_price).toBe(16371);
    expect(exact.missing_units).toEqual([]);
    // v2.5 以前の版では挙げない
    expect(computeSaleViewPricing(bundle, { ...view, pricing_model: undefined }, ['p1'], ['c1'], []).missing_units).toBeUndefined();
  });

  it('画面の商品価格は標準の売価、選択肢の差額は 1 か所だけ変えた売価との差（partial の表から作る）', () => {
    const display = v25DisplayCatalog(partialBundle.options, partialBundle.variantGroups, partialBundle.variantChoices, partialView);
    expect(display.options.find((row) => row.id === 'p6')).toMatchObject({ price: 16050, price_on_request: false });
    expect(display.choices.filter((row) => row.group_id === 'gb').map((row) => row.extra_price)).toEqual([0, 160, 1284]);
  });

  it('v2.5 の標準の選択肢は、版の選択枠に同じ商品があればその選択肢（無ければ商品の標準）', () => {
    const slotted = { ...partialView, baseline: [...partialView.baseline, { ...partialView.baseline[0], option_id: 'p6', variant_choice_ids: ['a3', 'b1'], unit_price: 16371, amount: 16371 }] };
    expect(v25StandardVariantIds(partialBundle.variantGroups, partialBundle.variantChoices, slotted, ['p1', 'p6']).sort()).toEqual(['a3', 'b1', 'c1']);
    expect(v25StandardVariantIds(partialBundle.variantGroups, partialBundle.variantChoices, null, ['p1', 'p6']).sort()).toEqual(['a1', 'b1', 'c1']);
    // カタログに無い（公開中でない）選択枠の選択肢は使わない
    const unknownChoice = { ...partialView, baseline: [{ ...partialView.baseline[0], option_id: 'p6', variant_choice_ids: ['zz'] }] };
    expect(v25StandardVariantIds(partialBundle.variantGroups, partialBundle.variantChoices, unknownChoice, ['p6'])).toEqual([]);
  });
});

describe('v2.5 の売価の差し込み（PR-C1）', () => {
  it('シミュレーターのページ：v2.5 の売価を使うときだけ、ブラウザへ渡すカタログから原価を外す', () => {
    const page = read('app/(site)/simulator/[slug]/page.tsx');
    expect(page).toContain('const clientBundle = sale.v25 ? withoutCatalogCosts(bundle) : bundle;');
    expect(page).toContain('bundle={clientBundle}');
    expect(page).toContain('v25Pricing={sale.v25}');
    // 旧テンプレートは仕様の選択肢・標準構成のためにだけ渡し、金額は外す
    expect(page).toContain('estimateTemplates={sale.v25 ? withoutTemplatePrices(estimateTemplates) : estimateTemplates}');
  });

  it('シミュレーター：v2.5 の間は旧テンプレートで計算せず、版が無い仕様は価格準備中', () => {
    const app = read('components/simulator/simulator-app.tsx');
    expect(app).toContain(': activeEstimateTemplate && !v25Pricing');
    expect(app).toContain('return v25PricePending ? pendingSaleViewPricing(result) : result;');
    // 価格準備中の仕様では、注文範囲のカードにも金額を出さない（0 円と出さない）
    expect(app).toContain('if (!activeSaleView || !isV25SaleView(activeSaleView)) continue;');
    // ほかの注文範囲の目安でも、表に無い組み合わせはサーバーで計算してもらう
    expect(app).toContain('const wanted = [...missingV25Units, ...levelMissingUnits]');
    expect(app).toContain('data-testid="price-pending-banner"');
    expect(app).toContain('options={displayScopedOptions}');
    expect(app).toContain('variantChoices={displayVariantChoices}');
  });

  it('売価の取得：v2.5 の関数は service role で呼び、関数が無い DB（未適用）では従来の売価の取得に戻す', () => {
    const data = read('lib/data/standard-estimate-sale-views.ts');
    expect(data).toContain("db.rpc('get_simulator_v25_sale_views', { p_base_model_id: baseModelId })");
    expect(data).toContain("if (isMissingNamedFunction(error, 'get_simulator_v25_sale_views')) return null;");
    expect(data).toContain('if (v25Views !== null) return { saleViews: v25Views, switchedOn, v25: true };');
  });

  it('見積依頼の確認・本部の保存プラン・商品ページも、v2.5 の間は原価で金額を出さない', () => {
    const request = read('app/(site)/mypage/configurations/[id]/request-quote/page.tsx');
    expect(request).toContain('const pricing = sale.v25');
    const admin = read('app/admin/configurations/[id]/page.tsx');
    expect(admin).toContain('const current = sale.v25');
    const product = read('app/(site)/products/[slug]/page.tsx');
    expect(product).toContain('const shownOptions = sale.v25');
    // 先頭のプリセットの仕様に v2.5 の版が無くても、v2.5 の版がある仕様の売価を出す（すべて要見積にしない）
    expect(product).toContain('const specCandidates = [...(model.presets ?? []).map((preset) => preset.code), ...sale.saleViews.map((view) => view.spec_code)];');
    expect(product).toContain('options: shownOptions.filter(');
  });

  it('表に無い組み合わせはサーバーで計算する：スイッチが切れている間は本部だけ・売価だけ返す・ページは計算してから出す', () => {
    const action = read('lib/actions/simulator-v25-units.ts');
    expect(action).toContain('if (!(await getSimulatorStandardPricingEnabled())) {');
    expect(action).toContain("if (user?.role !== 'admin') return { ok: false };");
    expect(action).toContain('.max(200)');
    const data = read('lib/data/standard-estimate-sale-views.ts');
    expect(data).toContain("db.rpc('get_simulator_v25_units', {");
    expect(read('app/(site)/mypage/configurations/[id]/request-quote/page.tsx')).toContain('? await resolvedV25ConfigurationPricing(bundle, sale.saleViews, {');
    expect(read('app/admin/configurations/[id]/page.tsx')).toContain('? await resolvedV25ConfigurationPricing(bundle, sale.saleViews, {');
    const app = read('components/simulator/simulator-app.tsx');
    expect(app).toContain('fetchSimulatorV25UnitsAction({ items: wanted })');
    expect(app).toContain('data-testid="price-calculating"');
    expect(app).toContain('data-testid="price-estimate-banner"');
  });

  it('v2.5 の間は、仕様の標準の選択肢を標準見積の選択枠の選択肢にする（最初の表示・仕様の切り替え・注文範囲を広げたとき・/plans から）', () => {
    const app = read('components/simulator/simulator-app.tsx');
    expect(app).toContain('initial?.variant_choice_ids ?? standardVariantIdsFor(defaultSpecCode, initialSelection)');
    expect(app).toContain('const nextVariants = standardVariantIdsFor(code, nextSel);');
    expect(app).toContain('() => standardVariantIdsFor(specCode, activeSpecSelection),');
    // 狭める前に選んでいた選択肢が残っている選択項目には足さない（同じ選択項目に 2 つ選ばない）
    expect(app).toContain('return [...prev, ...standardVariantIdsFor(specCode, added).filter((id) => !chosenGroups.has(groupOf.get(id)))];');
    // 商品を選び直したときも、標準の商品は標準見積の選択枠の選択肢から選ぶ
    const picker = read('components/simulator/option-picker-dialog.tsx');
    expect(picker).toContain('defaultVariants(groups, variantChoices, currentForProduct, baselineVariantIds)');
    expect(picker).toContain('const standard = list.find((c) => preferred.includes(c.id));');
    expect(read('app/(site)/simulator/[slug]/page.tsx')).toContain('v25StandardVariantIds(');
    expect(read('lib/domain/simulator-entry.ts')).toContain('? standardVariantIds(choice.code, optionIds)');
  });

  it('原価の Version を変えたら、シミュレーターの売価の表のキャッシュを捨てる', () => {
    expect(read('lib/data/option-cost-recording.ts')).toContain('updateTag(CATALOG_TAG);');
    expect(read('lib/actions/option-hq-standard-cost.ts')).toContain('if (row.changed) updateTag(CATALOG_TAG);');
    expect(read('lib/actions/option-cost-import.ts')).toContain('if (imported > 0) updateTag(CATALOG_TAG);');
  });
});
