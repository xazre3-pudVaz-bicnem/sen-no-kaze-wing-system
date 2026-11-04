import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  baselineSectionTotal,
  computeSaleViewPricing,
  isFireProofSelected,
  pickSaleView,
  saleViewToTemplateBundle,
  type StandardEstimateSaleView,
} from '@/lib/domain/standard-estimate-sale-view';
import type { CatalogBundle } from '@/lib/domain/types';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261013200000_simulator_standard_estimate_pricing.sql');

// 実 DB の実行時検査（runtime-security.sql の 17-1）と同じ標準見積
const view: StandardEstimateSaleView = {
  revision_id: 'rev-3',
  version: 3,
  base_model_id: 'model',
  spec_code: 'hotel',
  size_code: '3640x4550',
  fire_spec_code: 'non_fire',
  tax_rate: '0.1000',
  expense_rate: '0.1500',
  subtotal_raw: 537482,
  adjustment: 0,
  subtotal: 537482,
  tax: 53748,
  total: 591230,
  has_por: false,
  sections: [
    { code: 'base', expense_method: 'rate', line_subtotal: 467376, expense_amount: 70106, total: 537482, has_por: false },
    { code: 'interior_exterior', expense_method: 'rate', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
    { code: 'option', expense_method: 'rate', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
    { code: 'sitework', expense_method: 'none', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
  ],
  base_lines: [{ section: '1．金物', name: '伸縮脚', quantity: 12, unit: '本', unit_price: 38948, amount: 467376 }],
  lines: [],
  baseline: [
    { option_id: 'opt-a', section_code: 'option', selection_target_code: 'runtime-check-free', quantity: '2', unit_price: 12000, price_on_request: false, variant_choice_ids: [], variant_extra: 0 },
  ],
};

const bundle = {
  model: { id: 'model', slug: 'runtime-check', base_price: 1000000 },
  categories: [
    { id: 'cat-free', code: 'runtime-check-free', name: '検査カテゴリー' },
    { id: 'cat-fire', code: 'fireproof', name: '防火仕様' },
    { id: 'cat-wall', code: 'exterior-wall', name: '外壁' },
  ],
  options: [
    { id: 'opt-a', code: 'runtime-check-a', name: '検査商品A', category_id: 'cat-free', base_model_id: 'model', price: 12000, price_on_request: false, is_installation: false, status: 'published', image_url: null },
    { id: 'opt-fire', code: 'fire-proof', name: '防火仕様', category_id: 'cat-fire', base_model_id: null, price: 0, price_on_request: true, is_installation: false, status: 'published', image_url: null },
  ],
  variantGroups: [],
  variantChoices: [],
} as unknown as CatalogBundle;

describe('シミュレーターの標準見積（PR C2）：DB と同じ式', () => {
  it('本体は標準見積の売価、区分は「選んだ商品 − 標準状態の商品」の差額と経費率（実行時検査 17-1 と同じ金額）', () => {
    // 標準状態（2 個 × 12,000 円）より少ない 1 個：12,000 − 24,000 = −12,000（経費も trunc で −1,800）
    const result = computeSaleViewPricing(bundle, view, ['opt-a'], [], []);
    expect(result.sections.find((s) => s.code === 'option')).toMatchObject({ delta_line: -12000, line_subtotal: -12000, expense_amount: -1800 });

    // 実行時検査は 3 個（36,000 円）。シミュレーターの選択は数量 1 なので、同じ金額の商品で同じ差額を作る
    const triple = { ...bundle, options: bundle.options.map((o) => (o.id === 'opt-a' ? { ...o, price: 36000 } : o)) } as CatalogBundle;
    const same = computeSaleViewPricing(triple, view, ['opt-a'], [], []);
    expect(same.pricing).toMatchObject({
      base_price: 467376,
      base_expense: 70106,
      option_subtotal: 12000,
      option_expense: 1800,
      adjustment: 0,
      subtotal: 551282,
      tax: 55128,
      total: 606410,
    });
    expect(same.has_changes).toBe(true);
  });

  it('標準状態のままなら標準見積の合計と同じ（旧来の 1,000 円未満切り捨てはしない）', () => {
    const viewOne = { ...view, baseline: [{ ...view.baseline[0], quantity: '1' }] };
    const result = computeSaleViewPricing(bundle, viewOne, ['opt-a'], [], []);
    expect(result.pricing.total).toBe(view.total);
    expect(result.pricing.subtotal % 1000).not.toBe(0);
    expect(result.has_changes).toBe(false);
  });

  it('標準状態の外壁は 4 面分、価格未定の商品は 0 円で数える', () => {
    const wall = { ...view, baseline: [{ ...view.baseline[0], section_code: 'interior_exterior' as const, selection_target_code: 'exterior-wall', unit_price: 1000, quantity: '1' }] };
    expect(baselineSectionTotal(wall, 'interior_exterior')).toBe(4000);
    const por = { ...view, baseline: [{ ...view.baseline[0], price_on_request: true, variant_extra: 500 }] };
    expect(baselineSectionTotal(por, 'option')).toBe(1000);
  });

  it('使う標準見積は、標準状態の商品があり、機種・用途・防火で 1 件に決まるものだけ', () => {
    const fire = { ...view, revision_id: 'fire', fire_spec_code: 'fire' as const };
    expect(pickSaleView([view, fire], 'runtime-check', 'hotel', true)?.revision_id).toBe('fire');
    expect(pickSaleView([view], 'runtime-check', 'hotel', true)?.revision_id).toBe('rev-3');
    expect(pickSaleView([{ ...view, baseline: [] }], 'runtime-check', 'hotel', false)).toBeNull();
    expect(pickSaleView([view, { ...view, revision_id: 'other-size', size_code: '3900x4800' }], 'runtime-check', 'hotel', false)).toBeNull();
    expect(pickSaleView([{ ...view, spec_code: 'hotel' }], 'box', 'hotel-single', false)).not.toBeNull();
    expect(isFireProofSelected(bundle, ['opt-fire'])).toBe(true);
  });

  it('防火の標準見積を使うときは、防火仕様の行（別途見積）を数えない', () => {
    const fire = { ...view, fire_spec_code: 'fire' as const, baseline: [{ ...view.baseline[0], quantity: '1' }] };
    const result = computeSaleViewPricing(bundle, fire, ['opt-a', 'opt-fire'], [], []);
    expect(result.pricing.has_price_on_request).toBe(false);
    const nonFire = computeSaleViewPricing(bundle, { ...fire, fire_spec_code: 'non_fire' }, ['opt-a', 'opt-fire'], [], []);
    expect(nonFire.pricing.has_price_on_request).toBe(true);
  });

  it('見積書の表示用の形では、価格未確定の行は 0 円で「別途お見積り」と明記する', () => {
    const withPor = { ...view, lines: [{ section_code: 'option' as const, group_label: null, name: '未定の備品', quantity: 1, unit: null, unit_price: null, amount: null, is_por: true }] };
    const template = saleViewToTemplateBundle(withPor, 'model');
    expect(template.lines[0]).toMatchObject({ amount: 0, unit_price: null, remark: '価格未確定（別途お見積り）' });
    expect(template.base_breakdown_items[0]).toMatchObject({ unit_price: 38948, amount: 467376 });
  });
});

describe('シミュレーターの標準見積（PR C2）：DB の差し込み', () => {
  it('保存済みの仕様の再計算と見積依頼は、適用済みの定義を検査してから差し込む（目印はちょうど 1 箇所）', () => {
    expect(migration).toContain("v_signature constant text := 'public.recalculate_configuration(uuid)';");
    expect(migration).toContain("v_signature constant text := 'public.create_quote_from_configuration(uuid, jsonb, text, integer)';");
    expect(migration.match(/anchor % is not unique/g)).toHaveLength(2);

    const legacy = read('supabase/migrations/20260911050000_standard_estimate_simulator.sql');
    const body = (name: string) => {
      const start = legacy.indexOf(`create or replace function public.${name}(`);
      return legacy.slice(start, legacy.indexOf('$$;', legacy.indexOf('as $$', start) + 5));
    };
    const once = (text: string, anchor: string) => text.split(anchor).length - 1;
    const recalc = body('recalculate_configuration');
    expect(once(recalc, "  select * into v_template\n    from public.estimate_templates\n   where base_model_id = cfg.base_model_id\n     and spec_code = coalesce(cfg.spec_code, '')\n   limit 1;\n")).toBe(1);
    const quote = body('create_quote_from_configuration');
    expect(once(quote, 'coalesce(v_template.tax_rate, 0.10)')).toBe(1);
    expect(once(quote, "    case when v_template.id is not null\n      then '本見積書はExcel標準見積を基準に、選択商品の変更差額を反映した概算です。'\n")).toBe(1);
    expect(once(quote, '  if v_template.id is null then\n')).toBe(1);
  });

  it('計算の関数は API から実行させず、選んだ商品は旧来と同じ関数で数える', () => {
    for (const internal of ['standard_estimate_sale_view_for_configuration', 'standard_estimate_configuration_money', 'apply_standard_estimate_to_configuration', 'write_standard_estimate_quote_items']) {
      expect(migration).toContain(`revoke all on function public.${internal}(`);
      expect(migration).not.toMatch(new RegExp(`grant execute on function public\\.${internal}\\(`));
    }
    expect(migration).toContain('public.configuration_master_section_total(p_configuration_id, v_code)');
    expect(migration).toContain("when 'rate' then trunc(v_new_line * v_expense_rate)");
    expect(migration).toContain('v_tax := trunc(v_subtotal * v_tax_rate);');
    expect(migration).not.toMatch(/1000\.0|ROUNDING_UNIT/);
  });
});

describe('シミュレーターの標準見積（PR C2）：画面', () => {
  it('公開中の標準見積（売価だけ）を読み込み、使えるときだけ価格の正本にする', () => {
    const page = read('app/(site)/simulator/[slug]/page.tsx');
    const app = read('components/simulator/simulator-app.tsx');
    const data = read('lib/data/standard-estimate-sale-views.ts');
    // サイトの新価格へ切り替えるスイッチ（20261013210000）を通して読み込む
    expect(page).toContain('getSimulatorSaleViews(model.id, { preview: previewRequested })');
    expect(page).toContain('saleViews={saleViews}');
    expect(app).toContain('pickSaleView(saleViews, model.slug, specCode, fireSelected)');
    // v2.5：表に無い組み合わせはサーバーで計算した売価（v25Units）を使う（v2.5 PR-C1）
    expect(app).toContain('computeSaleViewPricing(bundle, activeSaleView, selected, variantIds, exteriorFaces, v25Units)');
    expect(data).toContain("rpc('get_standard_estimate_sale_views'");
    expect(data).toContain("isMissingNamedFunction(error, 'get_standard_estimate_sale_views')");
    expect(data).toContain('if (isLocalMode()) return [];');
    // 売価だけの取得経路はサーバー側（service role）だけが呼べる。ブラウザへは結果だけを渡す
    expect(data).toContain("import 'server-only';");
    expect(data).toContain('createAdminClient()');
  });
});
