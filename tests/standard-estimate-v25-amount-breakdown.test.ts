import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StandardEstimateV25AmountBreakdown } from '@/components/admin/standard-estimate-v25-amount-breakdown';
import { formatYen } from '@/lib/domain/pricing';
import { calculatePricingV25, type PricingCalculationRule, type PricingResult, type PricingTaxRule } from '@/lib/domain/pricing-v25';

const rule: PricingCalculationRule = {
  id: 'rule', formula_code: 'v2.5', rounding_mode: 'trunc',
  expense_target_sections: ['base', 'interior_exterior', 'option'],
  auto_price_sections: ['base', 'interior_exterior', 'option'],
};
const taxRule: PricingTaxRule = {
  id: 'tax', tax_mode: 'full_single_rate', tax_rate: '0.100000', rounding_mode: 'trunc',
};

const calculated = (): PricingResult => calculatePricingV25(rule, taxRule, {
  rates: { sales_fee_rate: '1.07', markup_rate: '1.5', expense_rate: '0.15' },
  adjustment: -17,
  sections: [
    { code: 'base', lines: [{ key: 'base-1', mode: 'auto', quantity: '1', standard_cost: 100000 }] },
    { code: 'interior_exterior', lines: [{ key: 'interior-1', mode: 'manual', quantity: '2', manual_unit_price: 20000 }] },
    { code: 'option', lines: [] },
    { code: 'sitework', lines: [{ key: 'sitework-1', mode: 'manual', quantity: '1', manual_unit_price: 50000 }] },
  ],
});
const render = (result: PricingResult | null, overrides: Partial<{
  savedTotal: number | null;
  unpricedCount: number;
  incompleteCostCount: number;
  adjustmentValue: string;
  onAdjustmentChange: (value: string) => void;
  readOnly: boolean;
}> = {}) => renderToStaticMarkup(createElement(StandardEstimateV25AmountBreakdown, {
  result, savedTotal: result?.total ?? null, unpricedCount: 0, incompleteCostCount: 0, ...overrides,
}));

describe('標準見積v2.5：旧画面の金額内訳を現行の計算結果から表示する', () => {
  it('売価・区分経費・調整・税・税込を既存PricingResultから表示する（再計算しない）', () => {
    const result = calculated();
    const html = render(result);
    expect(html).toContain('data-testid="v25-amount-breakdown-table"');
    expect(html).toContain('本体');
    expect(html).toContain('内外装工事');
    expect(html).toContain('オプション');
    expect(html).toContain('別途工事');
    const base = result.sections.find((section) => section.code === 'base');
    expect(html).toContain(formatYen(base!.priced_subtotal));
    expect(html).toContain(formatYen(base!.expense!));
    expect(html).toContain(formatYen(result.adjustment));
    expect(html).toContain(formatYen(result.adjusted_subtotal!));
    expect(html).toContain(formatYen(result.tax!));
    expect(html).toContain(formatYen(result.total!));
    expect(html).toContain('保存済み税込合計（DB）');
    expect(html).toContain('原価合計・粗利・粗利率');
    expect(html).toContain('未算定');
    expect(html).not.toContain('data-testid="v25-amount-breakdown-incomplete"');
  });

  it('下書きのみ金額内訳に調整額入力を表示し、マイナス値・未入力は文字列として保持する', () => {
    const html = render(calculated(), { readOnly: false, adjustmentValue: '-17', onAdjustmentChange: () => {} });
    expect(html).toContain('data-testid="v25-amount-breakdown-adjustment"');
    expect(html).toContain('value="-17"');
    expect(html).toContain('inputmode="numeric"');
    expect(html).toContain('保存済み税込合計（DB）');
    const blank = render(null, { readOnly: false, adjustmentValue: '', onAdjustmentChange: () => {} });
    expect(blank).toContain('data-testid="v25-amount-breakdown-adjustment"');
    expect(blank).toContain('value=""');
    const readonly = render(calculated(), { readOnly: true, adjustmentValue: '-17', onAdjustmentChange: () => {} });
    expect(readonly).not.toContain('data-testid="v25-amount-breakdown-adjustment"');
    expect(readonly).toContain(formatYen(-17));
  });

  it('PORがある区分は未確定とし、判明分を0円にすり替えない', () => {
    const result = calculatePricingV25(rule, taxRule, {
      rates: { sales_fee_rate: '1.07', markup_rate: '1.5', expense_rate: '0.15' },
      adjustment: 0,
      sections: [
        { code: 'base', lines: [{ key: 'b', mode: 'auto', quantity: '1', standard_cost: 10000 }] },
        { code: 'interior_exterior', lines: [
          { key: 'known', mode: 'manual', quantity: '1', manual_unit_price: 12000 },
          { key: 'por', mode: 'por', quantity: '1' },
        ] },
        { code: 'option', lines: [] },
        { code: 'sitework', lines: [] },
      ],
    });
    const html = render(result);
    expect(result.total).toBeNull();
    expect(html).toContain('（未確定あり）');
    expect(html).toContain(formatYen(12000));
    expect(html).toContain('＋未確定');
    expect(html).toContain('別途見積が含まれています。');
    expect(html).toContain('金額がすべて確定した状態ではありません。');
  });

  it('売価未入力・原価未設定で除外された明細がある場合は、合計に一部除外と明記する', () => {
    const html = render(calculated(), { unpricedCount: 2, incompleteCostCount: 1 });
    expect(html).toContain('売価未入力 2 件、商品原価未設定 1 件は試算から除外されています。');
    expect(html).toContain('一部明細を除く');
    expect(html).toContain('data-testid="v25-amount-breakdown-incomplete"');
  });

  it('試算できない場合は税込合計を捏造せず、保存済み金額を別に表示する', () => {
    const html = render(null, { savedTotal: 123456 });
    expect(html).toContain('保存済み税込合計（DB）');
    expect(html).toContain(formatYen(123456));
    expect(html).toContain('未算定');
  });

  it('既存ワークベンチの表示だけに組み込み、正式計算や保存処理には変更を要求しない', () => {
    const component = fs.readFileSync(path.resolve('components/admin/standard-estimate-v25-amount-breakdown.tsx'), 'utf8');
    const workbench = fs.readFileSync(path.resolve('components/admin/standard-estimate-v25-workbench.tsx'), 'utf8');
    expect(workbench).toContain('<StandardEstimateV25AmountBreakdown');
    expect(workbench).toContain('result={calc.result}');
    expect(workbench).toContain('unpricedCount={calc.unpriced.length}');
    expect(workbench).toContain('incompleteCostCount={calc.incomplete.length}');
    expect(workbench).toContain('adjustmentValue={state.adjustment}');
    expect(workbench).toContain('onAdjustmentChange={(value) => setState((current) => ({ ...current, adjustment: value }))}');
    expect(workbench).toContain('readOnly={readOnly}');
    expect(workbench).toContain('id="v25-wb-adjustment" value={state.adjustment}');
    expect(workbench).toContain('adjustment_reason: event.target.value');
    expect(component).not.toContain('calculatePricingV25(');
    expect(component).not.toContain('saveStandardEstimateV25DraftAction(');
  });
});
