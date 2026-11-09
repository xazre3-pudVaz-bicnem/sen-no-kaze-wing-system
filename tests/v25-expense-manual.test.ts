import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PricingCalculationRule, PricingTaxRule } from '@/lib/domain/pricing-v25';
import {
  computeQuoteV25Totals,
  parseQuoteV25ExpenseSettings,
  quoteV25ExpenseLines,
  type QuoteV25Context,
  type QuoteV25Row,
} from '@/lib/domain/quote-v25';
import { sectionMoney } from '@/lib/domain/standard-estimate-money';
import { buildV25SavePayload, validateV25EditorState, type V25EditorState } from '@/lib/domain/standard-estimate-v25-view';
import { standardQuoteExpenseAmountsSchema } from '@/lib/validation';
import {
  calculateV25Workbench,
  type V25WorkbenchBaseLine,
  type V25WorkbenchCandidate,
  type V25WorkbenchCosts,
} from '@/lib/domain/standard-estimate-v25-workbench';
import {
  previewStandardQuote,
  standardQuoteStateFromPayload,
  toStandardQuoteExpenseMethods,
  type StandardQuoteDraftPayload,
  type StandardQuoteEditorState,
} from '@/lib/domain/standard-quote-view';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/standard-estimate-v25', () => ({
  saveStandardEstimateV25DraftAction: vi.fn(),
  refreshStandardEstimateV25CostsAction: vi.fn(),
  publishStandardEstimateV25RevisionAction: vi.fn(),
}));

vi.mock('@/lib/actions/standard-quotes', () => ({
  saveStandardQuoteDraftAction: vi.fn(),
  finalizeStandardQuoteDraftAction: vi.fn(),
}));

const { StandardEstimateV25Workbench } = await import('@/components/admin/standard-estimate-v25-workbench');
const { StandardQuoteEditor } = await import('@/components/admin/standard-quote-editor');

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8').split('\r').join('');

/**
 * A-2 ⑥（2026-11-04 の先方回答）：v2.5 の経費を、標準見積と案件見積の両方で「率で計算」か「金額を手動」で決める。
 * 手動の額は通常の再計算で変えない。全体の調整額とは別。正本は DB（20261104113000）で、ここは画面の試算と保存の形を確かめる
 */

const rule: PricingCalculationRule = {
  id: 'rule-1',
  formula_code: 'v2.5',
  rounding_mode: 'trunc',
  expense_target_sections: ['base', 'interior_exterior', 'option'],
  auto_price_sections: ['base', 'interior_exterior', 'option'],
};
const taxRule: PricingTaxRule = { id: 'tax-1', tax_mode: 'full_single_rate', tax_rate: '0.100000', rounding_mode: 'trunc' };
// 実 DB の検査（runtime-v25-expense-manual.sql）と同じ本体：伸縮脚 18,200 × 12（売価 29,211 × 12 ＝ 350,532）
const baseLines: V25WorkbenchBaseLine[] = [{ id: 'bl1', section: '1．金物', name: '伸縮脚', quantity: '12', unit: '本', standard_cost: 18_200 }];
const candidates: V25WorkbenchCandidate[] = [
  { id: 'o1', name: '設備1', categoryId: 'cat-1', categoryName: '設備', categoryCode: 'equipment', singleSelect: false, manufacturer: '', modelNo: '', section: 'option', variantGroups: [], defaultChoices: {} },
];
const costs: V25WorkbenchCosts = { pinned: { 'o1|': { standard_cost: 20_000, variant_adjustments: {} } }, currentProduct: { o1: 20_000 }, currentChoice: {} };
const sectionOf = (optionId: string) => candidates.find((candidate) => candidate.id === optionId)?.section;

const rateExpenses: V25EditorState['expenses'] = {
  base: { method: 'rate', amount: '' },
  interior_exterior: { method: 'rate', amount: '' },
  option: { method: 'rate', amount: '' },
};
const state = (expenses: Partial<V25EditorState['expenses']> = {}): V25EditorState => ({
  sales_fee_rate: '1.07',
  markup_rate: '1.5',
  expense_rate: '0.15',
  adjustment: '0',
  adjustment_reason: '',
  slots: [{ key: 'slot-1', baseline_key: 'k1', option_id: 'o1', variant_choices: {}, quantity: '1', price_mode: 'auto', manual_unit_price: '', slot_code: '', slot_label: '', selectable_option_ids: [] }],
  lines: [],
  expenses: { ...rateExpenses, ...expenses },
});

describe('A-2 ⑥ 標準見積（Excel 風の画面）：区分の経費を率か手動の額で', () => {
  it('手動の区分は、その額を経費にする（オプション 32,100＋手動 30,000。本体は率のまま。DB の EXP-4 と同じ）', () => {
    const calc = calculateV25Workbench(rule, taxRule, state({ option: { method: 'fixed', amount: '30000' } }), baseLines, costs, sectionOf);
    const option = calc.result?.sections.find((section) => section.code === 'option');
    const base = calc.result?.sections.find((section) => section.code === 'base');
    expect([option?.expense_method, option?.expense, option?.total]).toEqual(['fixed', 30000, 62100]);
    expect([base?.expense_method, base?.expense]).toEqual(['rate', 52579]);
    expect(calc.invalidExpenses).toEqual([]);
  });

  it('本体も手動にでき、合計は公開した版と同じ（税込 508,895 円。DB の EXP-13 と同じ）', () => {
    const calc = calculateV25Workbench(
      rule,
      taxRule,
      state({ base: { method: 'fixed', amount: '50000' }, option: { method: 'fixed', amount: '30000' } }),
      baseLines,
      costs,
      sectionOf
    );
    expect([calc.result?.subtotal, calc.result?.tax, calc.result?.total]).toEqual([462632, 46263, 508895]);
  });

  it('明細を変えても手動の額は変わらない（設備1 の数量を 2 にしても 30,000 円）', () => {
    const changed = state({ option: { method: 'fixed', amount: '30000' } });
    changed.slots = changed.slots.map((slot) => ({ ...slot, quantity: '2' }));
    const option = calculateV25Workbench(rule, taxRule, changed, baseLines, costs, sectionOf).result?.sections.find((section) => section.code === 'option');
    expect([option?.subtotal, option?.expense]).toEqual([64200, 30000]);
  });

  it('額が正しくない手動の区分は、直すまで率で試算し、保存の前の確認で止める', () => {
    const invalid = state({ option: { method: 'fixed', amount: '-1' } });
    const calc = calculateV25Workbench(rule, taxRule, invalid, baseLines, costs, sectionOf);
    expect(calc.invalidExpenses).toEqual(['option']);
    expect(calc.result?.sections.find((section) => section.code === 'option')?.expense_method).toBe('rate');
    expect(validateV25EditorState(invalid, sectionOf)).toBe('オプションの経費の手動の額は、0〜100,000,000 円の整数で入力してください');
    expect(validateV25EditorState(state({ base: { method: 'fixed', amount: '100000001' } }), sectionOf)).toMatch(/^本体の経費の手動の額は/);
    expect(validateV25EditorState(state({ interior_exterior: { method: 'fixed', amount: '1.5' } }), sectionOf)).toMatch(/^内外装工事の経費の手動の額は/);
    expect(validateV25EditorState(state({ option: { method: 'fixed', amount: '0' } }), sectionOf)).toBeNull();
  });

  it('保存の形：区分ごとに method と、手動の区分は amount（整数）を送る', () => {
    expect(buildV25SavePayload(state({ option: { method: 'fixed', amount: ' 30000 ' } })).expenses).toEqual({
      base: { method: 'rate' },
      interior_exterior: { method: 'rate' },
      option: { method: 'fixed', amount: 30000 },
    });
  });

  it('保存の形：経費の決め方は計算ルールの経費の対象の区分だけ送る（対象外の区分は DB が止めるため。空なら送らない）', () => {
    const fixed = state({ option: { method: 'fixed', amount: '30000' } });
    expect(buildV25SavePayload(fixed, ['base', 'option']).expenses).toEqual({ base: { method: 'rate' }, option: { method: 'fixed', amount: 30000 } });
    expect(buildV25SavePayload(fixed, ['base', 'interior_exterior', 'option', 'sitework']).expenses).toEqual({
      base: { method: 'rate' },
      interior_exterior: { method: 'rate' },
      option: { method: 'fixed', amount: 30000 },
    });
    expect('expenses' in buildV25SavePayload(fixed, [])).toBe(false);
  });

  it('本部の見積下書きの保存の検査：手動の区分の額だけを持てる（zod 4 の partialRecord。区分のキー・額の範囲は確かめる）', () => {
    expect(standardQuoteExpenseAmountsSchema.safeParse({ base: 30000 }).success).toBe(true);
    expect(standardQuoteExpenseAmountsSchema.safeParse({}).success).toBe(true);
    expect(standardQuoteExpenseAmountsSchema.safeParse({ base: 1, option: 100_000_000 }).success).toBe(true);
    expect(standardQuoteExpenseAmountsSchema.safeParse({ option: 100_000_001 }).success).toBe(false);
    expect(standardQuoteExpenseAmountsSchema.safeParse({ option: 1.5 }).success).toBe(false);
    expect(standardQuoteExpenseAmountsSchema.safeParse({ unknown: 1 }).success).toBe(false);
    // 画面が送る形（手動の区分だけ）がそのまま通る
    const methods = toStandardQuoteExpenseMethods({
      expense_methods: { base: 'fixed', interior_exterior: 'rate', option: 'rate', sitework: 'none' },
      expense_amounts: { base: '30000', interior_exterior: '', option: '', sitework: '' },
    });
    expect(methods.amounts).toEqual({ base: 30000 });
    expect(standardQuoteExpenseAmountsSchema.safeParse(methods.amounts).success).toBe(true);
  });

  const render = (expenseManualAvailable: boolean, initial: V25EditorState) =>
    renderToStaticMarkup(
      createElement(StandardEstimateV25Workbench, {
        resetKey: '00000000-0000-4000-8000-000000000001:1',
        revisionId: '00000000-0000-4000-8000-000000000001',
        lockVersion: 1,
        readOnly: false,
        baseLines,
        candidates,
        initial,
        costs,
        rule,
        taxRule,
        preview: null,
        savedTotal: null,
        expenseManualAvailable,
      })
    );

  it('画面：経費を掛ける区分（本体・内外装・オプション）に経費の行を出し、別途工事には出さない', () => {
    const html = render(true, state({ option: { method: 'fixed', amount: '30000' } }));
    expect(html.match(/data-testid="v25-wb-expense"/g)?.length).toBe(3);
    expect(html).toContain('data-section="base"');
    expect(html).toContain('data-section="interior_exterior"');
    expect(html).toContain('data-section="option"');
    expect(html).not.toMatch(/data-testid="v25-wb-expense"[^>]*data-section="sitework"/);
    // 手動の区分は額の入力欄と「（手動）」、率の区分は率の説明
    expect(html.match(/data-testid="v25-wb-expense-amount"/g)?.length).toBe(1);
    expect(html).toContain('（手動）');
    expect(html).toContain('区分の小計 × 15%');
    expect(html).toContain('手動の額（明細を変えても変わりません）');
  });

  it('画面：DB の更新の前は経費の行を出さない（今の画面のまま）', () => {
    expect(render(false, state())).not.toContain('data-testid="v25-wb-expense"');
  });
});

describe('A-2 ⑥ Web の見積の第 2 版以降：前の版の決め方を引き継ぎ、変えた区分だけ送る', () => {
  const context: QuoteV25Context = {
    expenseRate: '0.1500',
    expenseSections: ['base', 'interior_exterior', 'option'],
    taxRate: '0.100000',
    expenses: { base: { method: 'fixed', amount: 50000 }, interior_exterior: { method: 'rate' }, option: { method: 'fixed', amount: 30000 }, sitework: { method: 'none' } },
  };
  // DB の EXP-22 と同じ第 2 版：本体 350,532、オプション 設備1 32,100・設備2＋大 17,655・追加工事 20,000
  const rows: QuoteV25Row[] = [
    { section: 'base', unitPrice: 29211, quantity: '12', state: null, unchangedAmount: 350532 },
    { section: 'option', unitPrice: 32100, quantity: '1', state: null },
    { section: 'option', unitPrice: 17655, quantity: '1', state: null },
    { section: 'option', unitPrice: 20000, quantity: '1', state: null },
  ];

  it('手動の区分は手動の額のまま（明細を足しても 30,000 円）、率の区分は率で計算する', () => {
    const totals = computeQuoteV25Totals(rows, context, 0);
    expect(totals.expenses).toEqual({ base: 50000, interior_exterior: 0, option: 30000, sitework: 0 });
    // 画面で率に戻す（DB の EXP-23：69,755 × 15% ＝ 10,463）
    const rate = computeQuoteV25Totals(rows, context, 0, { ...context.expenses, option: { method: 'rate' } });
    expect(rate.expenses.option).toBe(10463);
  });

  it('発行で送るのは前の版から変えた区分だけ（同じ決め方・同じ額は送らない）', () => {
    expect(quoteV25ExpenseLines(context, context.expenses ?? {})).toEqual([]);
    expect(quoteV25ExpenseLines(context, { ...context.expenses, option: { method: 'rate' } })).toEqual([
      { source: 'expense', section: 'option', method: 'rate' },
    ]);
    expect(quoteV25ExpenseLines(context, { ...context.expenses, base: { method: 'fixed', amount: 60000 }, interior_exterior: { method: 'fixed', amount: 0 } })).toEqual([
      { source: 'expense', section: 'base', method: 'fixed', amount: 60000 },
      { source: 'expense', section: 'interior_exterior', method: 'fixed', amount: 0 },
    ]);
  });

  it('DB の更新の前（決め方を返さない）は、決め方を送らず、率で計算する', () => {
    const { expenses: _ignored, ...old } = context;
    expect(quoteV25ExpenseLines(old, { option: { method: 'fixed', amount: 1 } })).toEqual([]);
    expect(computeQuoteV25Totals(rows, old, 0).expenses.option).toBe(10463);
  });

  it('DB の決め方を読む（形が違う区分は読まない＝率で計算する）', () => {
    expect(parseQuoteV25ExpenseSettings({ base: { method: 'fixed', amount: 50000 }, option: { method: 'fixed', amount: -1 }, sitework: { method: 'none' }, other: { method: 'rate' } })).toEqual({
      base: { method: 'fixed', amount: 50000 },
      sitework: { method: 'none' },
    });
    expect(parseQuoteV25ExpenseSettings(null)).toBeUndefined();
  });

  it('画面：経費の行・決め方の選択・手動の額の欄があり、変えた区分を発行の明細の最後に足す', () => {
    const form = read('components/admin/quote-v25-revision-form.tsx');
    expect(form).toContain('data-testid="v25-revision-expense"');
    expect(form).toContain('data-testid="v25-revision-expense-method"');
    expect(form).toContain('data-testid="v25-revision-expense-amount"');
    expect(form).toContain('.concat(quoteV25ExpenseLines(context.money, expenseSettings))');
    // 本体諸費用は本体の行と同じく本部・総代理店だけ（DB も止める）
    expect(form).toContain("const locked = section === 'base' && !canEditBase;");
    const action = read('lib/actions/quote-v25.ts');
    expect(action).toContain("source: z.literal('expense')");
    expect(action).toContain(".refine((line) => line.method !== 'fixed' || typeof line.amount === 'number')");
  });
});

describe('A-2 ⑥ Web 以外の案件の下書き：v2.5 の版から作った下書きは率か手動の額', () => {
  it('手動の区分は売価側の経費を手動の額にし、原価側の経費は率のまま', () => {
    const money = sectionMoney(
      [{ mode: 'auto', costUnitPrice: 21400, saleUnitPrice: 32100, costAmount: 21400, saleAmount: 32100 }],
      'fixed',
      { expenseRate: '0.15' },
      30000
    );
    expect([money.saleExpense, money.costExpense, money.saleTotal, money.costTotal]).toEqual([30000, 3210, 62100, 24610]);
    expect(sectionMoney([], 'none', { expenseRate: '0.15' }).costExpense).toBe(0);
  });

  const payload = (internals: StandardQuoteDraftPayload['internals']): StandardQuoteDraftPayload => ({
    draft: {
      id: 'd1', quote_request_id: 'r1', parent_quote_id: null, base_model_id: 'm1', spec_code: 'office', tax_rate: '0.10',
      adjustment: 0, adjustment_reason: null, subtotal: 0, tax: 0, total: 0, lock_version: 1, notes: null, source_kind: 'standard_estimate',
      standard_estimate_revision_id: 'rev1',
    },
    request: { id: 'r1', case_name: null, status: 'new', message: null, contact: null },
    internals,
    items: [
      { line_key: 'b1', kind: 'base', name: '伸縮脚', description: '1．金物', unit: '本', remark: null, unit_price: 29211, quantity: 12, amount: 350532, sort_order: 1001, price_mode: 'auto', section_code: 'base', line_role: 'line', base_unit_cost: 18200, cost_unit_price: 19474, cost_amount: 233688 },
      { line_key: 'o1', kind: 'option', name: '設備1', description: '設備', unit: '式', remark: null, unit_price: 32100, quantity: 1, amount: 32100, sort_order: 3001, price_mode: 'auto', section_code: 'option', line_role: 'line', base_unit_cost: null, cost_unit_price: 21400, cost_amount: 21400 },
    ],
    standard_estimate: null,
    parent: null,
  });

  it('下書きの決め方と手動の額を読み、DB の EXP-30 と同じ合計（税込 508,895 円）を試算する', () => {
    const state = standardQuoteStateFromPayload(
      payload({
        sales_fee_rate: '1.0700', expense_rate: '0.1500', markup_rate: '1.5000',
        expense_methods: { base: 'fixed', interior_exterior: 'rate', option: 'fixed', sitework: 'none' },
        expense_amounts: { base: 50000, option: 30000 },
        cost_total: 0,
      })
    );
    expect(state.expense_methods).toEqual({ base: 'fixed', interior_exterior: 'rate', option: 'fixed', sitework: 'none' });
    expect(state.expense_amounts).toEqual({ base: '50000', interior_exterior: '', option: '30000', sitework: '' });
    const preview = previewStandardQuote(state, '0.10');
    expect(preview.errors).toEqual([]);
    expect([preview.money?.subtotal, preview.money?.tax, preview.money?.total]).toEqual([462632, 46263, 508895]);
    expect([preview.sections.base.costExpense, preview.sections.option.costExpense]).toEqual([35053, 3210]);
    // 保存で送る方法：手動の区分の額は amounts
    expect(toStandardQuoteExpenseMethods(state)).toEqual({
      base: 'fixed', interior_exterior: 'rate', option: 'fixed', sitework: 'none', amounts: { base: 50000, option: 30000 },
    });
  });

  it('手動の額が読めない区分は、試算の誤りとして示し、保存では額を送らない（DB が止める）', () => {
    const state: StandardQuoteEditorState = {
      ...standardQuoteStateFromPayload(payload(null)),
      expense_methods: { base: 'rate', interior_exterior: 'rate', option: 'fixed', sitework: 'none' },
      expense_amounts: { base: '', interior_exterior: '', option: 'abc', sitework: '' },
    };
    expect(previewStandardQuote(state, '0.10').errors).toContain('オプション諸費用の手動の額は 0〜100,000,000 円の整数で入力してください');
    expect(toStandardQuoteExpenseMethods(state)).toEqual({ base: 'rate', interior_exterior: 'rate', option: 'fixed', sitework: 'none' });
  });

  const renderEditor = (props: { ratesLocked: boolean; expenseManualAvailable: boolean; initial: StandardQuoteEditorState }) =>
    renderToStaticMarkup(
      createElement(StandardQuoteEditor, { draftId: 'd1', lockVersion: 1, taxRate: '0.10', savedUnresolvedNames: [], ...props })
    );
  // 経費の選択の欄（区分の順：本体・内外装工事・オプション・別途工事）
  const expenseSelects = (html: string) =>
    [...html.matchAll(/<select[^>]*data-testid="standard-quote-expense-method"[^>]*>([\s\S]*?)<\/select>/g)].map((match) => ({
      disabled: /\sdisabled=""/.test(match[0].slice(0, match[0].indexOf('>'))),
      options: [...match[1].matchAll(/<option value="([a-z]+)"/g)].map((option) => option[1]),
    }));

  it('画面：v2.5 の版から作った下書きで、DB の更新の後だけ、経費を掛ける区分で「手動」を選べる（掛けない区分・別途工事・旧来の下書きは今のまま）', () => {
    const v25 = standardQuoteStateFromPayload(
      payload({
        sales_fee_rate: '1.0700', expense_rate: '0.1500', markup_rate: '1.5000',
        // 内外装工事を経費の対象外にした計算ルールの版から作った下書き（保存済みの方法が「なし」）
        expense_methods: { base: 'fixed', interior_exterior: 'none', option: 'rate', sitework: 'none' },
        expense_amounts: { base: 50000 },
        cost_total: 0,
      })
    );
    expect(expenseSelects(renderEditor({ ratesLocked: true, expenseManualAvailable: true, initial: v25 }))).toEqual([
      { disabled: false, options: ['rate', 'fixed'] },
      { disabled: true, options: ['rate', 'none'] },
      { disabled: false, options: ['rate', 'fixed'] },
      { disabled: true, options: ['rate', 'none'] },
    ]);
    // DB の更新の前は、今と同じく変えられない
    expect(expenseSelects(renderEditor({ ratesLocked: true, expenseManualAvailable: false, initial: v25 })).every((select) => select.disabled)).toBe(true);
    // 旧来の下書き（版の率に縛られない）は「率」「なし」
    const legacy = standardQuoteStateFromPayload(payload(null));
    expect(expenseSelects(renderEditor({ ratesLocked: false, expenseManualAvailable: false, initial: legacy }))).toEqual(
      Array.from({ length: 4 }, () => ({ disabled: false, options: ['rate', 'none'] }))
    );
    expect(read('app/admin/quotes/standard-drafts/[id]/page.tsx')).toContain(
      "expenseManualAvailable={ratesLocked && Boolean(payload.internals && 'expense_amounts' in payload.internals)}"
    );
    expect(read('lib/actions/standard-quotes.ts')).toContain("const method = z.enum(['rate', 'none', 'fixed']);");
  });
});
