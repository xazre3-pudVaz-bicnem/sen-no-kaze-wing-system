import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { calculatePricingV25, type PricingCalculationRule, type PricingTaxRule } from '@/lib/domain/pricing-v25';
import type { V25EditorState, V25Preview } from '@/lib/domain/standard-estimate-v25-view';
import {
  calculateV25Workbench,
  percentToRate,
  rateToPercent,
  slotCostForWorkbench,
  type V25WorkbenchBaseLine,
  type V25WorkbenchCandidate,
  type V25WorkbenchCosts,
} from '@/lib/domain/standard-estimate-v25-workbench';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/standard-estimate-v25', () => ({
  saveStandardEstimateV25DraftAction: vi.fn(),
  refreshStandardEstimateV25CostsAction: vi.fn(),
  publishStandardEstimateV25RevisionAction: vi.fn(),
}));

const { StandardEstimateV25Workbench } = await import('@/components/admin/standard-estimate-v25-workbench');

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

const rule: PricingCalculationRule = {
  id: 'rule-1',
  formula_code: 'v2.5',
  rounding_mode: 'trunc',
  expense_target_sections: ['base', 'interior_exterior', 'option'],
  auto_price_sections: ['base', 'interior_exterior', 'option'],
};
const taxRule: PricingTaxRule = { id: 'tax-1', tax_mode: 'full_single_rate', tax_rate: '0.100000', rounding_mode: 'trunc' };

const baseLines: V25WorkbenchBaseLine[] = [{ id: 'bl1', section: '構造体', name: '本体', quantity: '1', unit: '式', standard_cost: 1_000_000 }];

const candidates: V25WorkbenchCandidate[] = [
  {
    id: 'p1',
    name: '検査商品1',
    categoryId: 'cat-1',
    categoryName: '設備',
    manufacturer: 'メーカーA',
    modelNo: 'A-1',
    section: 'option',
    variantGroups: [{ id: 'g1', name: 'サイズ', choices: [{ id: 'c1', name: '標準' }, { id: 'c2', name: '大' }] }],
    defaultChoices: { g1: 'c1' },
  },
  { id: 'p2', name: '検査商品2', categoryId: 'cat-1', categoryName: '設備', manufacturer: '', modelNo: '', section: 'option', variantGroups: [], defaultChoices: {} },
  { id: 'p3', name: '内装材', categoryId: 'cat-2', categoryName: '内装', manufacturer: '', modelNo: '', section: 'interior_exterior', variantGroups: [], defaultChoices: {} },
  { id: 'p5', name: '設置工事', categoryId: 'cat-3', categoryName: '施工', manufacturer: '', modelNo: '', section: 'sitework', variantGroups: [], defaultChoices: {} },
];
const sectionOf = (optionId: string) => candidates.find((candidate) => candidate.id === optionId)?.section;

const costs: V25WorkbenchCosts = {
  saved: {
    b1: { option_id: 'p1', variant_choice_ids: ['c2'], standard_cost: 100_000, variant_adjustments: { c2: 20_000 } },
    b2: { option_id: 'p2', variant_choice_ids: [], standard_cost: null, variant_adjustments: {} },
  },
  currentProduct: { p1: 110_000, p2: 50_000, p3: 30_000 },
  currentChoice: { c1: 0, c2: 25_000 },
};

const initial: V25EditorState = {
  sales_fee_rate: '1.07',
  markup_rate: '1.5',
  expense_rate: '0.15',
  adjustment: '0',
  adjustment_reason: '',
  slots: [
    { key: 'slot-b1', baseline_key: 'b1', option_id: 'p1', variant_choices: { g1: 'c2' }, quantity: '2', price_mode: 'auto', manual_unit_price: '' },
    { key: 'slot-b2', baseline_key: 'b2', option_id: 'p2', variant_choices: {}, quantity: '1', price_mode: 'auto', manual_unit_price: '' },
    { key: 'slot-b3', baseline_key: 'b3', option_id: 'p3', variant_choices: {}, quantity: '3', price_mode: 'manual', manual_unit_price: '9000' },
  ],
  lines: [
    {
      key: 'line-k1', line_key: 'k1', section_code: 'sitework', group_label: '', name: '外構工事', quantity: '1', unit: '式',
      price_mode: 'por', unit_price: '', remark: '', review_required: true,
    },
    {
      key: 'line-k2', line_key: 'k2', section_code: 'sitework', group_label: '', name: '設置工事', quantity: '1', unit: '式',
      price_mode: 'manual', unit_price: '50000', remark: '', review_required: false,
    },
  ],
};

describe('Excel 風の画面の試算（v2.5 の正式計算と同じ入力）', () => {
  it('保存済みで商品・選択肢を変えていない行は固定した原価、変えた行・新しい行は今の原価', () => {
    expect(slotCostForWorkbench(initial.slots[0], costs)).toEqual({ status: 'ok', standard_cost: 100_000, variant_adjustment: 20_000, pinned: true });
    // 選択肢を変えると今の版（保存すると DB が今の版で固定する）
    expect(slotCostForWorkbench({ ...initial.slots[0], variant_choices: { g1: 'c1' } }, costs)).toEqual({
      status: 'ok', standard_cost: 110_000, variant_adjustment: 0, pinned: false,
    });
    // 固定した版が無い（原価未設定）行は 0 円にしない
    expect(slotCostForWorkbench(initial.slots[1], costs)).toEqual({ status: 'missing', reason: 'missing_standard_cost', pinned: true });
    // 今の版が無い選択肢も原価未設定
    expect(slotCostForWorkbench({ ...initial.slots[0], baseline_key: null, variant_choices: { g1: 'c3' } }, costs)).toEqual({
      status: 'missing', reason: 'missing_variant_cost', pinned: false,
    });
  });

  it('DB と同じ式で計算し、原価未設定の auto の行は金額に含めない', () => {
    const calc = calculateV25Workbench(rule, taxRule, initial, baseLines, costs, sectionOf);
    expect(calc.error).toBeNull();
    expect(calc.incomplete).toEqual([{ key: 'slot-b2', option_id: 'p2', reason: 'missing_standard_cost' }]);
    const expected = calculatePricingV25(rule, taxRule, {
      rates: { sales_fee_rate: '1.07', markup_rate: '1.5', expense_rate: '0.15' },
      adjustment: 0,
      sections: [
        { code: 'base', lines: [{ key: 'base:bl1', mode: 'auto', quantity: '1', standard_cost: 1_000_000 }] },
        { code: 'interior_exterior', lines: [{ key: 'slot:slot-b3', mode: 'manual', quantity: '3', manual_unit_price: 9000 }] },
        { code: 'option', lines: [{ key: 'slot:slot-b1', mode: 'auto', quantity: '2', standard_cost: 100_000, variant_adjustment: 20_000 }] },
        {
          code: 'sitework',
          lines: [
            { key: 'line:line-k1', mode: 'por', quantity: '1' },
            { key: 'line:line-k2', mode: 'manual', quantity: '1', manual_unit_price: 50_000 },
          ],
        },
      ],
    });
    expect(calc.result).toEqual(expected);
    // 別途見積があるので合計は未確定（0 円として扱わない）
    expect(calc.result?.total).toBeNull();
    expect(calc.result?.sections.find((section) => section.code === 'option')?.lines[0].sale_unit_price).toBe(Math.trunc(Math.trunc(120_000 * 1.07) * 1.5));
  });

  it('別途工事の商品を自動にすると計算できない（DB の保存でも止まる）', () => {
    const state: V25EditorState = {
      ...initial,
      slots: [...initial.slots, { key: 'slot-n1', baseline_key: null, option_id: 'p5', variant_choices: {}, quantity: '1', price_mode: 'auto', manual_unit_price: '' }],
    };
    const calc = calculateV25Workbench(rule, taxRule, state, baseLines, { ...costs, currentProduct: { ...costs.currentProduct, p5: 10_000 } }, sectionOf);
    expect(calc.result).toBeNull();
    expect(calc.error).toBeTruthy();
  });

  it('率は画面では %、保存は小数（10 進のまま変換する）', () => {
    expect(rateToPercent('1.5')).toBe('150');
    expect(rateToPercent('0.15')).toBe('15');
    expect(rateToPercent('1.0700')).toBe('107');
    expect(percentToRate('150')).toBe('1.5');
    expect(percentToRate('15')).toBe('0.15');
    expect(percentToRate('107')).toBe('1.07');
    expect(percentToRate('12.5')).toBe('0.125');
    expect(percentToRate('100')).toBe('1');
    expect(percentToRate('0')).toBe('0');
    // 読めない入力はそのまま（保存の前の確認で止まる）
    expect(percentToRate('abc')).toBe('abc');
  });
});

const preview: V25Preview = {
  rules_current: true,
  review_required_lines: 1,
  publishable: false,
  calc_error: null,
  incomplete: [{ option_id: 'p2', name: '検査商品2', reason: 'missing_standard_cost' }],
  slots: [
    { baseline_key: 'b1', option_id: 'p1', name: '検査商品1', price_mode: 'auto', cost_status: 'stale', variants: [{ variant_choice_id: 'c2', status: 'current' }] },
  ],
};

const render = (readOnly: boolean) =>
  renderToStaticMarkup(
    createElement(StandardEstimateV25Workbench, {
      revisionId: '00000000-0000-4000-8000-000000000001',
      lockVersion: 3,
      readOnly,
      baseLines,
      candidates,
      initial,
      costs,
      rule,
      taxRule,
      preview,
      savedTotal: null,
    })
  );

describe('Excel 風の画面（描画）', () => {
  it('本体・内外装・オプション・別途を 1 つの表に並べ、試算の金額と状態を出す', () => {
    const html = render(false);
    expect(html).toContain('data-testid="v25-workbench-grid"');
    expect(html).toContain('本体（本体マスター）');
    expect(html).toContain('data-testid="v25-section-interior_exterior"');
    expect(html).toContain('data-testid="v25-section-option"');
    expect(html).toContain('data-testid="v25-section-sitework"');
    expect(html).toContain('検査商品1');
    expect(html).toContain('メーカーA ／ A-1');
    // 原価未設定の商品は金額に含めず、状態で示す
    expect(html).toContain('原価が未設定です');
    expect(html).toContain('原価が更新されています');
    // 別途見積があるので合計は未確定
    expect(html).toContain('未確定（別途見積を含む）');
    // 公開できない理由（要見直し・原価未設定）
    expect(html).toContain('公開できない理由');
    expect(html).toContain('「要見直し」の明細が 1 行残っています');
  });

  it('原価の列は初期値では出さない（本部の画面でも切り替えて見る）', () => {
    const html = render(false);
    expect(html).not.toContain('>原価単価<');
    expect(html).toContain('原価を表示');
  });

  it('編集できる下書きでは保存・最新原価の取り込み・公開を出し、公開中の版は読み取りだけ', () => {
    const editable = render(false);
    expect(editable).toContain('data-testid="v25-wb-save"');
    expect(editable).toContain('data-testid="v25-wb-refresh"');
    expect(editable).toContain('data-testid="v25-wb-publish"');
    expect(editable).toContain('＋ 商品台帳から追加');
    const readOnly = render(true);
    expect(readOnly).not.toContain('data-testid="v25-wb-save"');
    expect(readOnly).not.toContain('＋ 商品台帳から追加');
    expect(readOnly).toContain('disabled=""');
  });
});

describe('見積書管理 ＞ 標準見積の画面（本部だけ・承認申請なし）', () => {
  const page = read('app/admin/estimate-templates/page.tsx');
  it('本部だけが開き、v2.5 の下書きを Excel 風の画面で編集する', () => {
    expect(page).toContain("await requireAdmin('/admin/estimate-templates');");
    expect(page).toContain('<StandardEstimateV25Workbench');
    expect(page).toContain('loadStandardEstimateWorkspace(supabase, selected)');
    expect(page).toContain('startStandardEstimateV25DraftAction');
    expect(page).toContain('<input type="hidden" name="return_to" value="workbench" />');
  });

  it('総代理店の承認申請は出さない（本部が編集・公開する）', () => {
    expect(page).not.toContain('承認申請');
    expect(read('components/admin/standard-estimate-v25-workbench.tsx')).not.toContain('承認申請');
    expect(read('components/admin/estimate-template-workbench.tsx')).not.toContain('承認申請');
  });

  it('旧テンプレートは参照用の画面に残す（削除しない）', () => {
    expect(page).toContain('href="/admin/estimate-templates/legacy"');
    const legacy = read('app/admin/estimate-templates/legacy/page.tsx');
    expect(legacy).toContain("await requireAdmin('/admin/estimate-templates/legacy')");
    expect(legacy).toContain('<EstimateTemplateWorkbench');
  });

  it('下書きを作った後は Excel 風の画面へ戻る', () => {
    const action = read('lib/actions/standard-estimate-v25.ts');
    expect(action).toContain("formData.get('return_to') === 'workbench'");
    expect(action).toContain('/admin/estimate-templates?master=');
  });
});
