import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PricingCalculationRule, PricingTaxRule } from '@/lib/domain/pricing-v25';
import {
  buildV25SavePayload,
  v25LineCostAmount,
  v25LineCostValue,
  v25PublishBlockers,
  validateV25EditorState,
  type V25EditorState,
  type V25LineRow,
  type V25Preview,
  type V25SlotRow,
} from '@/lib/domain/standard-estimate-v25-view';
import { v25SavePayloadSchema } from '@/lib/domain/standard-estimate-v25-payload-schema';
import type { V25WorkbenchCandidate } from '@/lib/domain/standard-estimate-v25-workbench';
import { StandardEstimateV25AmountBreakdown } from '@/components/admin/standard-estimate-v25-amount-breakdown';
import { loadStandardEstimateV25 } from '@/lib/data/standard-estimate-v25';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/standard-estimate-v25', () => ({
  saveStandardEstimateV25DraftAction: vi.fn(),
  refreshStandardEstimateV25CostsAction: vi.fn(),
  publishStandardEstimateV25RevisionAction: vi.fn(),
}));
const { StandardEstimateV25Workbench, v25ManualLineCostAndGross } = await import('@/components/admin/standard-estimate-v25-workbench');

// 標準見積 v2.5 の手入力明細の原価単価（2026-11-20 の先方の依頼「手入力明細の原価入力復活」）
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8').split('\r').join('');

const line = (key: string, extra: Partial<V25LineRow> = {}): V25LineRow => ({
  key, line_key: null, section_code: 'option', group_label: '', name: key, quantity: '1', unit: '式',
  price_mode: 'manual', unit_price: '1000', remark: '', review_required: false, ...extra,
});
const state = (lines: V25LineRow[], slots: V25SlotRow[] = []): V25EditorState => ({
  sales_fee_rate: '1', markup_rate: '1.5', expense_rate: '0.15', adjustment: '0', adjustment_reason: '', slots, lines,
});

describe('原価単価の値と原価金額（DB と同じ式・丸め）', () => {
  it('空・省略は原価未設定（null）。0 円は 0。整数でなければ NaN（保存の確かめで止める）', () => {
    expect(v25LineCostValue(undefined)).toBeNull();
    expect(v25LineCostValue('')).toBeNull();
    expect(v25LineCostValue('  ')).toBeNull();
    expect(v25LineCostValue('0')).toBe(0);
    expect(v25LineCostValue(' 1200 ')).toBe(1200);
    expect(v25LineCostValue('1.5')).toBeNaN();
    expect(v25LineCostValue('-1')).toBeNaN();
    expect(v25LineCostValue('abc')).toBeNaN();
  });

  it('原価金額 = trunc(数量 × 原価単価)。小数の数量も浮動小数点を使わず切り捨て。上限を超える・未設定は null', () => {
    expect(v25LineCostAmount('2', '6000')).toBe(12000);
    expect(v25LineCostAmount('1.5', '10001')).toBe(15001);
    expect(v25LineCostAmount('0.3333', '3')).toBe(0);
    expect(v25LineCostAmount('1.1', '3')).toBe(3);
    expect(v25LineCostAmount('3', '0')).toBe(0);
    expect(v25LineCostAmount('1', '')).toBeNull();
    expect(v25LineCostAmount('1', undefined)).toBeNull();
    expect(v25LineCostAmount('1', '100000001')).toBeNull();
    expect(v25LineCostAmount('99999', '100000000')).toBeNull();
    expect(v25LineCostAmount('x', '1')).toBeNull();
  });
});

describe('入力の確かめと保存の形', () => {
  it('原価単価は任意（空は未設定）。0〜100,000,000 円の整数でなければ止める。原価金額の上限も確かめる', () => {
    expect(validateV25EditorState(state([line('a', { cost_unit_price: '' })]))).toBeNull();
    expect(validateV25EditorState(state([line('a', { cost_unit_price: '0' })]))).toBeNull();
    expect(validateV25EditorState(state([line('a')]))).toBeNull();
    expect(validateV25EditorState(state([line('a', { cost_unit_price: '1.5' })]))).toContain('明細 1 行目の原価単価（税別）は 0〜100,000,000 円の整数');
    expect(validateV25EditorState(state([line('a', { cost_unit_price: '-1' })]))).toContain('原価単価（税別）は 0〜100,000,000 円の整数');
    expect(validateV25EditorState(state([line('a', { cost_unit_price: '100000001' })]))).toContain('原価単価（税別）は 0〜100,000,000 円の整数');
    expect(validateV25EditorState(state([line('a', { quantity: '99999', cost_unit_price: '100000000' })]))).toContain('原価金額（数量 × 原価単価）が大きすぎます');
    // 別途見積の行の原価は保存しないので確かめない
    expect(validateV25EditorState(state([line('a', { price_mode: 'por', unit_price: '', cost_unit_price: 'x' })]))).toBeNull();
  });

  it('保存の形：原価単価は数（空・省略は null、0 は 0）。別途見積は null。項目は常に送る（省略すると DB は今の原価を残す）', () => {
    const payload = buildV25SavePayload(state([
      line('a', { cost_unit_price: '1200' }),
      line('b', { cost_unit_price: '' }),
      line('c'),
      line('d', { cost_unit_price: '0' }),
      line('e', { price_mode: 'por', unit_price: '', cost_unit_price: '500' }),
    ]));
    expect(payload.lines.map((row) => row.cost_unit_price)).toEqual([1200, null, null, 0, null]);
    expect(payload.lines.every((row) => Object.hasOwn(row, 'cost_unit_price'))).toBe(true);
    // 売価は原価と別（原価を入れても変わらない）
    expect(payload.lines.map((row) => row.unit_price)).toEqual([1000, 1000, 1000, 1000, null]);
  });

  it('zod の確かめで原価単価を捨てない。数でない・範囲外・小数は止める', () => {
    const payload = buildV25SavePayload(state([line('a', { cost_unit_price: '1200' }), line('b', { cost_unit_price: '' })]));
    const parsed = v25SavePayloadSchema.parse(payload);
    expect(parsed.lines.map((row) => row.cost_unit_price)).toEqual([1200, null]);
    const withCost = (cost: unknown) => ({ ...payload, lines: [{ ...payload.lines[0], cost_unit_price: cost }] });
    expect(v25SavePayloadSchema.safeParse(withCost(1.5)).success).toBe(false);
    expect(v25SavePayloadSchema.safeParse(withCost(-1)).success).toBe(false);
    expect(v25SavePayloadSchema.safeParse(withCost(100_000_001)).success).toBe(false);
    expect(v25SavePayloadSchema.safeParse(withCost('1200')).success).toBe(false);
    expect(v25SavePayloadSchema.safeParse(withCost(Number.NaN)).success).toBe(false);
    expect(v25SavePayloadSchema.safeParse(withCost(100_000_000)).success).toBe(true);
  });

  it('公開できない理由：原価単価が未入力の明細（行の名前を示す。6 行以上は「ほか」）', () => {
    const preview: V25Preview = {
      rules_current: true, publishable: false, calc_error: null, incomplete: [], slots: [],
      missing_line_costs: ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ line_key: `k-${name}`, name })),
    };
    expect(v25PublishBlockers(preview, false)).toEqual([
      '原価単価が未入力の明細が 6 行あります（「a」・「b」・「c」・「d」・「e」 ほか）。原価単価（税別。0 円なら 0）を入力して保存してください',
    ]);
    expect(v25PublishBlockers({ ...preview, missing_line_costs: undefined, publishable: true }, false)).toEqual([]);
  });
});

describe('画面の手入力明細の行：原価単価・原価金額・粗利', () => {
  it('表示用の値：原価金額 = trunc(数量 × 原価単価)、粗利 = 売価金額 − 原価金額。未設定・別途見積・売価未入力は推測しない', () => {
    expect(v25ManualLineCostAndGross({ price_mode: 'manual', quantity: '2', cost_unit_price: '6000' }, 18000))
      .toEqual({ unitCost: 6000, costAmount: 12000, gross: 6000, missing: false });
    expect(v25ManualLineCostAndGross({ price_mode: 'manual', quantity: '1', cost_unit_price: '1500' }, 1000))
      .toEqual({ unitCost: 1500, costAmount: 1500, gross: -500, missing: false });
    expect(v25ManualLineCostAndGross({ price_mode: 'manual', quantity: '1', cost_unit_price: '' }, 1000))
      .toEqual({ unitCost: null, costAmount: null, gross: null, missing: true });
    expect(v25ManualLineCostAndGross({ price_mode: 'manual', quantity: '1', cost_unit_price: '0' }, 0))
      .toEqual({ unitCost: 0, costAmount: 0, gross: 0, missing: false });
    expect(v25ManualLineCostAndGross({ price_mode: 'manual', quantity: '1', cost_unit_price: '500' }, null))
      .toEqual({ unitCost: 500, costAmount: 500, gross: null, missing: false });
    expect(v25ManualLineCostAndGross({ price_mode: 'por', quantity: '1', cost_unit_price: '500' }, null))
      .toEqual({ unitCost: null, costAmount: null, gross: null, missing: false });
  });

  const rule: PricingCalculationRule = {
    id: 'rule-1', formula_code: 'v2.5', rounding_mode: 'trunc',
    expense_target_sections: ['base', 'interior_exterior', 'option'], auto_price_sections: ['base', 'interior_exterior', 'option'],
  };
  const taxRule: PricingTaxRule = { id: 'tax-1', tax_mode: 'full_single_rate', tax_rate: '0.100000', rounding_mode: 'trunc' };
  const candidates: V25WorkbenchCandidate[] = [{
    id: 'eq1', name: '設備', categoryId: 'cat-eq', categoryName: '設備', categoryCode: 'kitchen', singleSelect: false,
    manufacturer: '', modelNo: '', section: 'option', variantGroups: [], defaultChoices: {},
  }];
  const render = (readOnly: boolean, initial: V25EditorState, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(StandardEstimateV25Workbench, {
      resetKey: 'r:1', revisionId: '00000000-0000-4000-8000-000000000001', lockVersion: 1, readOnly,
      modelSlug: 'wing-01', specCode: 'hotel', baseLines: [], candidates, initial,
      costs: { pinned: {}, currentProduct: { eq1: 1000 }, currentChoice: {} },
      rule, taxRule, preview: null, savedTotal: null, ...extra,
    }));
  const rowOf = (html: string, name: string) => {
    const start = html.indexOf(`value="${name}"`);
    const rowStart = html.lastIndexOf('<tr', start);
    return html.slice(rowStart, html.indexOf('</tr>', start));
  };

  it('下書き：手入力明細に原価単価の入力欄（Excel の列移動の対象）。原価金額・粗利を計算して出す', () => {
    const html = render(false, state([line('l1', { name: '取付費', quantity: '2', unit_price: '9000', cost_unit_price: '6000' })]));
    expect(html).not.toContain('画面の試算ができません');
    const row = rowOf(html, '取付費');
    expect(row).toContain('data-testid="v25-wb-line-cost-input"');
    expect(row).toContain('data-v25-excel-col="cost"');
    expect(row).toContain('value="6000"');
    expect(row).toContain('aria-label="明細の原価単価（税別）"');
    expect(row).toMatch(/data-testid="v25-wb-line-cost-amount">[^<]*12,000/);
    expect(row).toMatch(/data-testid="v25-wb-line-gross">[^<]*6,000/);
  });

  it('原価単価が空なら「原価未設定」（0 円にしない）・粗利は出さない。画面の案内に件数を出す', () => {
    const html = render(false, state([line('l1', { name: '材料', cost_unit_price: '' }), line('l2', { name: '養生', unit_price: '0', cost_unit_price: '0' })]));
    const missing = rowOf(html, '材料');
    expect(missing).toContain('placeholder="未入力"');
    expect(missing).toContain('原価未設定');
    expect(missing).toMatch(/data-testid="v25-wb-line-gross">—/);
    const zero = rowOf(html, '養生');
    expect(zero).not.toContain('原価未設定');
    expect(zero).toMatch(/data-testid="v25-wb-line-cost-amount">[^<]*0</);
    expect(html).toContain('data-testid="v25-amount-breakdown-line-cost-missing"');
    expect(html).toContain('原価単価が未入力の手入力明細が 1 行あります');
  });

  it('別途見積の行は原価の欄を出さない（—）。公開済み（閲覧だけ）は入力欄でなく値を出す', () => {
    const por = rowOf(render(false, state([line('l1', { name: '外構', price_mode: 'por', unit_price: '', cost_unit_price: '5000' })])), '外構');
    expect(por).not.toContain('data-testid="v25-wb-line-cost-input"');
    expect(por).toMatch(/data-testid="v25-wb-line-cost-cell"><span[^>]*>—/);
    const html = render(true, state([line('l1', { name: '取付費', cost_unit_price: '6000' }), line('l2', { name: '材料', cost_unit_price: '' })]));
    expect(html).not.toContain('data-testid="v25-wb-line-cost-input"');
    expect(rowOf(html, '取付費')).toMatch(/data-testid="v25-wb-line-cost-value">[^<]*6,000/);
    expect(rowOf(html, '材料')).toContain('>未設定<');
    expect(html).not.toContain('data-testid="v25-amount-breakdown-line-cost-missing"');
  });

  it('原価を入れても売価・合計の試算は変わらない（売価は売価単価から）', () => {
    const without = render(false, state([line('l1', { name: '取付費', unit_price: '9000' })]));
    const withCost = render(false, state([line('l1', { name: '取付費', unit_price: '9000', cost_unit_price: '6000' })]));
    const total = (html: string) => html.match(/data-testid="v25-wb-subtotal">([^<]*)</)?.[1];
    expect(total(withCost)).toBe(total(without));
    // 売価 9,000 ＋ オプションの経費 15%（1,350）。原価は試算の売価に関わらない
    expect(total(withCost)).toMatch(/10,350/);
  });

  it('金額内訳：保存済みの原価・粗利を渡すと出す（原価未設定があれば未確定）', () => {
    const known = render(false, state([line('l1', { name: '取付費', cost_unit_price: '6000' })]), {
      savedCost: { subtotal: 100000, costTotal: 70000, hasPor: false },
      preview: { rules_current: true, publishable: true, calc_error: null, incomplete: [], slots: [], missing_line_costs: [] },
    });
    expect(known).toContain('data-testid="v25-amount-breakdown-profit-values"');
    expect(known).toContain('原価合計 ');
    const unknown = render(false, state([line('l1', { name: '材料', cost_unit_price: '' })]), {
      savedCost: { subtotal: 100000, costTotal: 70000, hasPor: false },
      preview: { rules_current: true, publishable: false, calc_error: null, incomplete: [], slots: [], missing_line_costs: [{ line_key: 'k', name: '材料' }] },
    });
    expect(unknown).toContain('data-testid="v25-amount-breakdown-profit-unknown"');
    expect(unknown).toContain('原価が未設定の行が 1 件あるため、粗利・粗利率は未確定です（0 円として計算しません）。');
  });
});

describe('金額内訳の原価合計・粗利・粗利率（保存済み・社内用）', () => {
  const render = (extra: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(StandardEstimateV25AmountBreakdown, {
      result: null, savedTotal: null, unpricedCount: 0, incompleteCostCount: 0, ...extra,
    }));

  it('粗利 = 調整後税別額 − 原価合計、粗利率は表示だけ 0.1% 未満を切り捨て（旧標準見積と同じ定義）', () => {
    const html = render({ savedProfit: { subtotal: 300000, costTotal: 199999, hasPor: false, missingCostCount: 0 } });
    expect(html).toContain('原価合計・粗利・粗利率（保存済み・社内用）');
    expect(html).toMatch(/原価合計 ¥?199,999/);
    expect(html).toMatch(/粗利 <span class="text-emerald-800">¥?100,001<\/span>/);
    expect(html).toContain('粗利率 33.3%');
    expect(html).toContain('粗利 = 調整後税別額 − 原価合計（原価側の経費を含む）。');
    expect(html).not.toContain('未算定');
  });

  it('赤字は赤・別途見積を除く旨・保存していない変更は含まない旨を示す', () => {
    const html = render({ savedProfit: { subtotal: 1000, costTotal: 1500, hasPor: true, missingCostCount: 0, unsaved: true } });
    expect(html).toMatch(/粗利 <span class="text-red-700">-?¥?-?500<\/span>/);
    expect(html).toContain('粗利率 -50.0%');
    expect(html).toContain('別途見積の行は売価・原価とも含めていません。');
    expect(html).toContain('保存していない変更は含みません（保存すると更新されます）。');
  });

  it('原価未設定がある・保存済みの金額を確認できないときは未確定（0 円として計算しない）。渡さなければ今までどおり未算定', () => {
    const missing = render({ savedProfit: { subtotal: 1000, costTotal: 100, hasPor: false, missingCostCount: 2 } });
    expect(missing).toContain('data-testid="v25-amount-breakdown-profit-unknown"');
    expect(missing).toContain('原価が未設定の行が 2 件あるため');
    expect(missing).not.toContain('粗利率 ');
    expect(render({ savedProfit: null })).toContain('保存済みの金額を確認できないため、粗利・粗利率は未確定です。');
    const legacy = render({});
    expect(legacy).toContain('data-testid="v25-amount-breakdown-profit-pending"');
    expect(legacy).toContain('未算定');
  });

  it('調整後税別額が 0 円なら粗利率は —', () => {
    expect(render({ savedProfit: { subtotal: 0, costTotal: 0, hasPor: false, missingCostCount: 0 } })).toContain('粗利率 —');
  });
});

describe('読み込み：原価単価を読み、列が無い DB でも読める', () => {
  type Call = { table: string; columns: string };
  const fakeClient = (hasCostColumn: boolean, calls: Call[]) => {
    const builder = (table: string) => {
      let columns = '';
      const result = () => {
        calls.push({ table, columns });
        if (table === 'standard_estimate_revision_v25_lines') {
          if (!hasCostColumn && columns.includes('cost_unit_price')) {
            return { data: null, error: { code: '42703', message: 'column standard_estimate_revision_v25_lines.cost_unit_price does not exist' } };
          }
          return {
            data: [
              { line_key: 'k1', section_code: 'option', group_label: null, name: '取付費', quantity: 2, unit: '式', price_mode: 'manual',
                unit_price: 9000, amount: 18000, remark: null, review_required: false, sort_order: 1, display_order: null,
                ...(hasCostColumn ? { cost_unit_price: 6000 } : {}) },
              { line_key: 'k2', section_code: 'option', group_label: null, name: '材料', quantity: 1, unit: '式', price_mode: 'manual',
                unit_price: 1000, amount: 1000, remark: null, review_required: false, sort_order: 2, display_order: null,
                ...(hasCostColumn ? { cost_unit_price: null } : {}) },
              { line_key: 'k3', section_code: 'option', group_label: null, name: '養生', quantity: 1, unit: '式', price_mode: 'manual',
                unit_price: 0, amount: 0, remark: null, review_required: false, sort_order: 3, display_order: null,
                ...(hasCostColumn ? { cost_unit_price: 0 } : {}) },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      };
      const chain = {
        select: (value: string) => { columns = value; return chain; },
        eq: () => chain,
        order: () => Promise.resolve(result()),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return chain;
    };
    return {
      from: (table: string) => builder(table),
      rpc: () => Promise.resolve({ data: null, error: null }),
    } as unknown as SupabaseClient;
  };
  const revision = { id: 'rev-1', sales_fee_rate: '1', markup_rate: '1.5', expense_rate: '0.15', standard_adjustment_amount: 0, standard_adjustment_reason: null };
  const header = { pricing_model: 'v2.5' as const, calc_rule_version_id: null, tax_rule_version_id: null, v25_pricing_complete: true };

  it('原価単価を文字にする（未設定は空、0 円は "0"）', async () => {
    const calls: Call[] = [];
    const data = await loadStandardEstimateV25(fakeClient(true, calls), revision, header);
    expect(data.initial.lines.map((row) => [row.name, row.cost_unit_price])).toEqual([['取付費', '6000'], ['材料', ''], ['養生', '0']]);
    expect(calls.filter((call) => call.table === 'standard_estimate_revision_v25_lines')).toHaveLength(1);
  });

  it('原価の列が無い DB（migration の前）では列を外して読み直し、明細を消さない（原価は未設定として扱う）', async () => {
    const calls: Call[] = [];
    const data = await loadStandardEstimateV25(fakeClient(false, calls), revision, header);
    expect(data.initial.lines.map((row) => [row.name, row.cost_unit_price])).toEqual([['取付費', ''], ['材料', ''], ['養生', '']]);
    const lineCalls = calls.filter((call) => call.table === 'standard_estimate_revision_v25_lines');
    expect(lineCalls).toHaveLength(2);
    expect(lineCalls[1].columns).not.toContain('cost_unit_price');
    expect(lineCalls[1].columns).toContain('display_order');
  });
});

describe('原価を本部以外に出さない', () => {
  it('migration は手入力明細の原価を売価の形（sale_view）に足さない', () => {
    const sql = read('supabase/migrations/20261110150000_v25_manual_line_costs.sql');
    expect(sql).not.toContain('standard_estimate_v25_sale_view');
    expect(sql).not.toContain('write_standard_estimate_quote_items');
    expect(sql).toContain("revoke all on function public.standard_estimate_v25_fill_line_costs_from_legacy(uuid) from public, anon, authenticated, service_role;");
  });
});
