import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { calculatePricingV25, type PricingCalculationRule, type PricingTaxRule } from '@/lib/domain/pricing-v25';
import { formatYen } from '@/lib/domain/pricing';
import type { V25EditorState, V25Preview } from '@/lib/domain/standard-estimate-v25-view';
import {
  calculateV25Workbench,
  percentProblem,
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

const { StandardEstimateV25Workbench, v25VariantSummary, v25PositionActionsLocked, deleteV25WorkbenchRow, v25DisplayedCostAndGross } = await import('@/components/admin/standard-estimate-v25-workbench');

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
    categoryCode: 'equipment',
    singleSelect: false,
    manufacturer: 'メーカーA',
    modelNo: 'A-1',
    priceUnit: '台',
    section: 'option',
    variantGroups: [{ id: 'g1', name: 'サイズ', choices: [{ id: 'c1', name: '標準' }, { id: 'c2', name: '大' }] }],
    defaultChoices: { g1: 'c1' },
  },
  { id: 'p2', name: '検査商品2', categoryId: 'cat-1', categoryName: '設備', categoryCode: 'equipment', singleSelect: false, manufacturer: '', modelNo: '', section: 'option', variantGroups: [], defaultChoices: {} },
  { id: 'p3', name: '内装材', categoryId: 'cat-2', categoryName: '内装', categoryCode: 'wall-ceiling', singleSelect: true, manufacturer: '', modelNo: '', section: 'interior_exterior', variantGroups: [], defaultChoices: {} },
  { id: 'p5', name: '設置工事', categoryId: 'cat-3', categoryName: '施工', categoryCode: 'sitework', singleSelect: false, manufacturer: '', modelNo: '', section: 'sitework', variantGroups: [], defaultChoices: {} },
];
const sectionOf = (optionId: string) => candidates.find((candidate) => candidate.id === optionId)?.section;

// 保存済みの auto の選択枠の固定した原価（DB の保存と同じく「商品｜選択肢」ごと）
const costs: V25WorkbenchCosts = {
  pinned: {
    'p1|c2': { standard_cost: 100_000, variant_adjustments: { c2: 20_000 } },
    'p2|': { standard_cost: null, variant_adjustments: {} },
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
    { key: 'slot-b1', baseline_key: 'b1', option_id: 'p1', variant_choices: { g1: 'c2' }, quantity: '2', price_mode: 'auto', manual_unit_price: '', slot_code: '', slot_label: '', selectable_option_ids: [] },
    { key: 'slot-b2', baseline_key: 'b2', option_id: 'p2', variant_choices: {}, quantity: '1', price_mode: 'auto', manual_unit_price: '', slot_code: '', slot_label: '', selectable_option_ids: [] },
    { key: 'slot-b3', baseline_key: 'b3', option_id: 'p3', variant_choices: {}, quantity: '3', price_mode: 'manual', manual_unit_price: '9000', slot_code: '', slot_label: '', selectable_option_ids: [] },
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
  it('保存済みの auto の行と同じ「商品＋選択肢」は固定した原価、それ以外は今の原価（DB の保存と同じ決まり）', () => {
    expect(slotCostForWorkbench(initial.slots[0], costs)).toEqual({ status: 'ok', standard_cost: 100_000, variant_adjustment: 20_000, pinned: true });
    // 行を消して同じ商品・選択肢を入れ直しても、DB は「商品＋選択肢」で固定した版を使い回す（行の key では決めない）
    expect(slotCostForWorkbench({ option_id: 'p1', variant_choices: { g1: 'c2' } }, costs)).toEqual({
      status: 'ok', standard_cost: 100_000, variant_adjustment: 20_000, pinned: true,
    });
    // 選択肢を変えると今の版（保存すると DB が今の版で固定する）
    expect(slotCostForWorkbench({ ...initial.slots[0], variant_choices: { g1: 'c1' } }, costs)).toEqual({
      status: 'ok', standard_cost: 110_000, variant_adjustment: 0, pinned: false,
    });
    // 固定した版が無い（原価未設定）行は 0 円にしない
    expect(slotCostForWorkbench(initial.slots[1], costs)).toEqual({ status: 'missing', reason: 'missing_standard_cost', pinned: true });
    // 今の版が無い選択肢も原価未設定
    expect(slotCostForWorkbench({ option_id: 'p1', variant_choices: { g1: 'c3' } }, costs)).toEqual({
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
      slots: [...initial.slots, { key: 'slot-n1', baseline_key: null, option_id: 'p5', variant_choices: {}, quantity: '1', price_mode: 'auto', manual_unit_price: '', slot_code: '', slot_label: '', selectable_option_ids: [] }],
    };
    const calc = calculateV25Workbench(rule, taxRule, state, baseLines, { ...costs, currentProduct: { ...costs.currentProduct, p5: 10_000 } }, sectionOf);
    expect(calc.result).toBeNull();
    expect(calc.error).toBeTruthy();
  });

  it('売価入力の行で売価が未入力なら、0 円にせず計算から外す', () => {
    const state: V25EditorState = {
      ...initial,
      lines: initial.lines.map((line) => (line.key === 'line-k2' ? { ...line, unit_price: '' } : line)),
      slots: initial.slots.map((slot) => (slot.key === 'slot-b3' ? { ...slot, manual_unit_price: '' } : slot)),
    };
    const calc = calculateV25Workbench(rule, taxRule, state, baseLines, costs, sectionOf);
    expect(calc.unpriced.sort()).toEqual(['line-k2', 'slot-b3']);
    expect(calc.lineKeyOf['line-k2']).toBeUndefined();
    expect(calc.result?.sections.find((section) => section.code === 'interior_exterior')?.lines).toEqual([]);
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
    // 読めない入力（小数 3 桁以上の % を含む）は空にし、保存の前に % の文で案内する（生の率として使わない）
    expect(percentToRate('abc')).toBe('');
    expect(percentToRate('15.125')).toBe('');
    expect(percentProblem({ sales_fee_rate: '107', expense_rate: '15.125', markup_rate: '150' })).toBe('経費率は % で、小数 2 桁までの数を入力してください');
    expect(percentProblem({ sales_fee_rate: '107', expense_rate: '15', markup_rate: '150' })).toBeNull();
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

const render = (readOnly: boolean, view?: { initial?: V25EditorState; candidates?: V25WorkbenchCandidate[] }) =>
  renderToStaticMarkup(
    createElement(StandardEstimateV25Workbench, {
      resetKey: '00000000-0000-4000-8000-000000000001:3',
      revisionId: '00000000-0000-4000-8000-000000000001',
      lockVersion: 3,
      readOnly,
      baseLines,
      candidates: view?.candidates ?? candidates,
      initial: view?.initial ?? initial,
      costs,
      rule,
      taxRule,
      preview,
      savedTotal: null,
    })
  );

describe('Excel 風の画面（描画）', () => {

  it('旧画面の入力黄・参照灰・区分濃緑・小計淡緑、列順と文字サイズを明細だけに適用', () => {
    const html = render(false);
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    const legacy = read('components/admin/estimate-template-workbench.tsx');
    for (const cls of ['bg-amber-50', 'bg-slate-100', 'bg-emerald-900']) {
      expect(legacy).toContain(cls);
      expect(source).toContain(cls);
    }
    expect(legacy).toContain('bg-emerald-50');
    expect(source).toContain('bg-lime-100');
    const header = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect((header.match(/<th /g) ?? []).length).toBe(10);
    const order = ['name', 'quantity', 'unit', 'cost_unit', 'cost_amount', 'sale_unit', 'sale_amount', 'gross', 'note', 'actions'];
    let cursor = -1;
    for (const id of order) {
      const next = header.indexOf('data-v25-column="' + id + '"', cursor + 1);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(header).not.toContain('>グループ</th>');
    expect(header).not.toContain('>状態</th>');
    expect(header).not.toContain('>#</th>');
    expect(html).toContain('data-testid="v25-section-subtotal-base"');
    for (const code of ['interior_exterior', 'option', 'sitework']) {
      expect(html).toContain(`data-testid="v25-section-subtotal-${code}"`);
      expect(html).toContain(`data-testid="v25-section-subtotal-value-${code}"`);
    }
    expect(html).toContain('data-testid="v25-wb-base-row"');
    expect(html).toContain('>本体マスター</span>');
    expect(html).not.toContain('data-v25-excel-col="group"');
    expect(html).toContain('data-v25-excel-col="name"');
    expect(html).toContain('設備');
    expect(html).toContain('bg-slate-100');
    expect(html).toContain('bg-amber-50');
    expect(source).toContain('flex items-center justify-center gap-2');
    expect(source).toContain('flex size-6 cursor-pointer');
    expect(source).toContain('flex size-6 shrink-0');
    expect(source).toContain('h-6 min-h-6!');
    expect(source).toContain('text-[11px]');
    // フォントサイズや共通UIルールを変更せず、通常の入力欄だけ旧画面相当の高さに調整
    expect(legacy).toContain('h-6 min-h-6');
  });

  it('品名欄はグループ入力に圧迫されず、変更操作は自由入力メニューにのみ現れる', () => {
    const html = render(false);
    const readOnlyHtml = render(true);
    const manual = html.slice(html.indexOf('data-testid="v25-wb-line"'), html.indexOf('data-testid="v25-wb-line-menu"'));
    expect(html).not.toContain('data-v25-excel-col="group"');
    expect(manual).toContain('data-v25-excel-col="name"');
    expect(html).toContain('data-testid="v25-wb-change-work-group"');
    expect(readOnlyHtml).not.toContain('data-testid="v25-wb-change-work-group"');
    expect(readOnlyHtml).not.toContain('data-testid="v25-wb-work-group-dialog"');
  });

  it('原価金額と粗利は正式なv2.5結果から表示用に求め、未提供金額はダッシュ表示', () => {
    const calc = calculateV25Workbench(rule, taxRule, initial, baseLines, costs, sectionOf);
    const line = calc.result?.sections.find((section) => section.code === 'option')?.lines.find((row) => row.key === 'slot:slot-b1');
    expect(line?.cost_unit_price).toBe(128400);
    expect(line?.amount).toBe(385200);
    expect(v25DisplayedCostAndGross(line, '2')).toEqual({ costAmount: 256800, gross: 128400 });
    expect(v25DisplayedCostAndGross(line, '1.2345').costAmount).toBe(158509); // 128400×1.2345を整数円で切捨て
    expect(v25DisplayedCostAndGross(line, 'abc')).toEqual({ costAmount: null, gross: null });
    expect(v25DisplayedCostAndGross(undefined, '2')).toEqual({ costAmount: null, gross: null });
    const html = render(false);
    expect(html).toContain(`data-testid="v25-section-subtotal-value-option">${formatYen(385200)}</strong>`);
    expect(html).toContain('data-testid="v25-wb-slot-cost-amount"');
    expect(html).toContain('data-testid="v25-wb-slot-gross"');
    expect(html).toContain('data-testid="v25-wb-slot-sale-amount"');
    expect(html).toContain(formatYen(256800));
    expect(html).toContain(formatYen(128400));
    expect(html).toContain(formatYen(385200));
    expect(html).toContain('data-testid="v25-wb-subtotal"');
    expect(html).toContain('data-testid="v25-wb-total"');
    expect(html).toContain('未確定（別途見積を含む）');
    // UI追加の前後とも、公式の価格計算結果そのものは同一の値である。
    expect(calc.result?.sections.find((section) => section.code === 'option')?.subtotal).toBe(385200);
    expect(calc.result?.total).toBeNull();
  });

  it('商品台帳の販売単位を商品行に表示し、未設定はダッシュで示す（表示のみ）', () => {
    const html = render(false);
    expect(html).toMatch(/data-testid="v25-wb-slot-unit"[^>]*>[\s\S]*?台[\s\S]*?<\/td>/);
    const modified = render(false, { candidates: candidates.map((item) => item.id === 'p1' ? { ...item, priceUnit: '㎡' } : item) });
    expect(modified).toMatch(/data-testid="v25-wb-slot-unit"[^>]*>[\s\S]*?㎡[\s\S]*?<\/td>/);
    const unregistered = render(false, { candidates: candidates.map((item) => ({ ...item, priceUnit: null })) });
    expect(unregistered).toContain('data-testid="v25-wb-slot-unit"');
    expect(unregistered).toMatch(/data-testid="v25-wb-slot-unit"[^>]*>\s*—\s*<\/td>/);
    expect(read('components/admin/standard-estimate-v25-workbench.tsx')).toContain('payload: buildV25SavePayload(orderedToSave)');
  });

  it('旧Excel型の表示密度・固定列・ページ縦スクロールと入力セル移動を保ち、正式な操作を維持する', () => {
    const html = render(false);
    expect(html).not.toContain('data-testid="v25-excel-toolbar"');
    expect(html).toContain('data-testid="v25-wb-column-display-position"');
    expect(html).toContain('data-testid="v25-excel-grid-scroll"');
    expect(html).toContain('overflow-x-auto rounded-b-md');
    expect(html).not.toContain('max-h-[70vh]');
    expect(html).not.toContain('overscroll-contain');
    expect(html).toContain('sticky left-0 top-0 z-40');
    expect(html).not.toContain('sticky left-[6.25rem] top-0 z-40');
    expect(html).not.toContain('sticky left-7 top-0 z-40');
    expect(html).not.toContain('sticky left-[8rem] top-0 z-40');
    expect(html).toContain('sticky top-0 z-30');
    expect(html).toContain('data-testid="v25-wb-menu-panel"');
    expect(html).toContain('fixed z-[60]');
    expect(html).not.toContain('sticky left-[6.25rem]');
    expect(html).toContain('bg-emerald-900');
    expect(html).not.toContain('data-v25-excel-col="group"');
    expect(html).toContain('data-v25-excel-col="name"');
    expect(html).toContain('data-v25-excel-col="qty"');
    expect(html).toContain('data-v25-excel-col="note"');
    expect(html).not.toContain('>状態</th>');
    expect(html).not.toContain('>#</th>');
    expect(html).toContain('>品名');
    expect(html).toContain('>数量');
    expect(html).toContain('>単位');
    expect(html.indexOf('>仕様・備考')).toBeGreaterThan(html.indexOf('>売価金額'));
    expect(read('components/admin/standard-estimate-v25-workbench.tsx')).toContain('v25GridWidth(columnPrefs.prefs)');
    expect(read('components/admin/standard-estimate-v25-workbench.tsx')).toContain('colSpan={beforeSaleAmount}');
    expect(html).toContain('data-testid="v25-wb-save"');
    expect(html).toContain('data-testid="v25-wb-refresh"');
    expect(html).toContain('data-testid="v25-wb-publish"');
    expect(html).toContain('data-testid="v25-wb-variant-summary"');
  });


  it('ページ縦スクロール時の固定見出しは実表から採寸し、原価列の有無・横スクロールに追従する', () => {
    const html = render(false);
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(html).toContain('data-testid="v25-excel-grid-scroll"');
    expect(html).toContain('>数量');
    expect(html).toContain('>単位');
    expect(html).toContain('>売価単価');
    expect(html).toContain('>原価単価');
    expect(html).toContain('>原価金額');
    expect(html).toContain('>粗利');
    expect(source).toContain('useV25PageFloatingHeader(headerLayoutKey)');
    expect(source).toContain('sourceHead.cloneNode(true)');
    expect(source).toContain('table.cloneNode(false)');
    expect(source).toContain('const sourceCells = Array.from(sourceHead.rows[0]?.cells ?? [])');
    expect(source).toContain('columns[index].style.width =');
    expect(source).toContain('cell.getBoundingClientRect().width');
    expect(source).toContain('overlay.scrollLeft = grid.scrollLeft');
    expect(source).toContain("window.addEventListener('scroll', sync, true)");
    expect(source).toContain('const nativeHeaderPassed = sourceHead.getBoundingClientRect().bottom <= 0;');
    expect(source).toContain("saveAreaRef.current.getBoundingClientRect().top < window.innerHeight");
    expect(source).toContain('const visible = nativeHeaderPassed && gridRect.bottom > headerHeight && !saveAreaReached;');
    expect(source).toContain('ref={saveAreaRef}');
    expect(source).toContain("overlay.style.display = visible ? 'block' : 'none'");
    expect(source).toContain("overlay.setAttribute('aria-hidden', 'true')");
    expect(source).toContain('pointer-events-none fixed top-0');
    expect(source).toContain("sourceHead.cloneNode(true) as HTMLTableSectionElement");
    // 原価列の切替後は同じ hook が再実行され、複製される列数は実ヘッダーに一致する。
    expect(source).toContain('}, [headerLayoutKey]);');
    expect(source).toContain('{visible.cost_unit && <th');
    expect(read('components/admin/v25-grid-preferences.tsx')).toContain('原価を表示');
    // 表の後ろに見積の保存領域が残り、別スクロールではなくページで到達できる。
    expect(source).toContain('data-testid="v25-wb-save"');
    expect(source).toContain('data-testid="v25-wb-publish"');
    expect(source).not.toContain('max-h-[70vh] overflow-auto');
  });

  it('売価単価は数字だけを表示・入力し、切替と行操作を右端メニューへ集約する', () => {
    const html = render(false);
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(html).not.toContain('>計算</th>');
    expect(html).toContain('>売価単価');
    expect(html).toContain('>操作');
    expect(html).toContain('data-testid="v25-wb-slot-price-cell"');
    expect(html).toContain('data-testid="v25-wb-line-price-cell"');
    expect(html).not.toContain('data-testid="v25-wb-slot-price-mode"');
    expect(html).not.toContain('data-testid="v25-wb-line-price-mode"');
    expect(html).toContain('data-testid="v25-wb-slot-menu"');
    expect(html).toContain('data-testid="v25-wb-line-menu"');
    expect(html).not.toContain('data-testid="v25-wb-slot-status"');
    expect(html).not.toContain('data-testid="v25-wb-line-status"');
    expect(html).toContain('data-testid="v25-wb-slot-cost-alert"');
    expect(html).toContain('data-testid="v25-wb-line-review-alert"');
    expect(html).toContain('原価未設定');
    expect(html).toContain('原価更新あり');
    expect(html).not.toContain('原価最新');
    expect(html).toContain('要見直し');
    expect(source).toContain("status && status !== 'current'");
    expect(source).toContain('title={V25_COST_STATUS_LABEL[status]}');
    expect(html).toContain('商品台帳から選択');
    expect(html).toContain('金額を入力する');
    expect(html).toContain('別途見積にする');
    expect(html).toContain('自動計算に戻す');
    expect(html).toContain('見直し済みにする');
    expect(html).toContain('data-testid="v25-wb-slot-delete"');
    expect(html).toContain('data-testid="v25-wb-line-delete"');
    expect(source).toContain('const columnCount = displayedColumns.length;');
    expect(source).toContain("code !== 'sitework' && slot.price_mode !== 'auto'");
    expect(source).toContain("setSlot(slot.key, { price_mode: 'auto' })");
    expect(source).toContain("setSlot(slot.key, { price_mode: 'manual' })");
    expect(source).toContain("setSlot(slot.key, { price_mode: 'por' })");
    expect(source).toContain("setLine(line.key, { price_mode: 'manual' })");
    expect(source).toContain("setLine(line.key, { price_mode: 'por' })");
    expect(source).toContain('payload: buildV25SavePayload(orderedToSave)');
  });

  it('幅の過大な列を圧縮し、広い画面では表全体を可変幅で表示する', () => {
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    const html = render(false);
    const headerSource = source.slice(source.indexOf('<thead className='), source.indexOf('</thead>'));
    const tableSource = source.slice(source.indexOf('<table ref={tableRef}'), source.indexOf('<thead className='));
    expect(tableSource).toContain('v25GridWidth(columnPrefs.prefs)');
    expect(html).toContain('data-testid="v25-workbench-grid"');
    expect(html).toContain('min-width:1104px');
    expect(html).toContain('w-full');
    const widths = [
      ['w-[20rem]', 1], // 品名
      ['w-14', 2], // 数量と単位
      ['w-[5.75rem]', 5], // 金額5列
      ['w-[8rem]', 1], // 仕様・備考
      ['w-[4.5rem]', 1], // 操作
    ] as const;
    for (const [width, expectedCount] of widths) {
      expect(headerSource.split(width).length - 1).toBe(expectedCount);
    }
    const previousCostOn = 85 * 16;
    const currentCostOn = 69 * 16;
    const previousCostOff = 64 * 16;
    const currentCostOff = 52 * 16;
    expect(currentCostOn).toBe(1104);
    expect(currentCostOff).toBe(832);
    expect(previousCostOn - currentCostOn).toBe(256);
    expect(previousCostOff - currentCostOff).toBe(192);
    // 操作ボタンを押し分けられる幅（24px×2＋8px間隔）を確保。
    expect(4.5 * 16).toBeGreaterThanOrEqual(24 * 2 + 8);
    expect(html).toContain('data-testid="v25-wb-slot-menu"');
    expect(html).toContain('data-testid="v25-wb-slot-delete"');
    expect(html).toContain('data-testid="v25-wb-line-menu"');
    expect(html).toContain('data-testid="v25-wb-line-delete"');
    // 位置名・カテゴリー・品名・備考は省略表示でも元データを保持している。
    expect(source).toContain('title={line.section}');
    expect(source).toContain('title={candidate?.categoryName ??');
    expect(source).toContain('flex min-w-0 flex-wrap items-center gap-1');
    expect(source).toContain('title={line.remark}');
    expect(source).toContain('data-testid="v25-wb-change-work-group"');
    expect(source).toContain('data-v25-excel-col="name"');
    expect(source).toContain('data-v25-excel-col="note"');
  });

  it('通常10列・原価非表示7列の旧画面順にし、入力状態表示を残す', () => {
    const html = render(false);
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    const header = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    expect((header.match(/<th /g) ?? []).length).toBe(10);
    expect(source).toContain('const columnCount = displayedColumns.length;');
    expect(source).toContain('w-[20rem]');
    expect(source).toContain('w-[4.5rem]');
    expect(source).toContain('className="h-6 min-h-6!');
    expect(source).toContain('data-v25-excel-col="qty"');
    expect(source).toContain('data-v25-excel-col="unit"');
    expect(source).toContain('data-v25-excel-col="sale"');
    expect(source).toContain('data-v25-excel-col="name"');
    expect(source).toContain('data-v25-excel-col="note"');
    expect(source).toContain('if (event.key === \'Enter\' && index >= 0)');
    expect(source).toContain("} else if (event.key === 'Tab') {");
    expect(source).toContain("overlay.scrollLeft = grid.scrollLeft");
    expect(source).toContain('columns[index].style.width =');
    expect(source).toContain('}, [headerLayoutKey]);');
    // 原価の警告は原価列の表示フラグに依存しない位置にある。
    const warningSource = source.slice(source.indexOf('data-testid="v25-wb-slot-cost-alert"') - 130, source.indexOf('data-testid="v25-wb-slot-cost-alert"') + 180);
    expect(warningSource).not.toContain('showCost &&');
    expect(html).toContain('原価未設定');
    expect(html).toContain('原価更新あり');
  });

  it('明細セル内の入力欄だけ旧画面に合わせた24px最小高さと11px文字を維持する', () => {
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    const globals = read('app/globals.css');
    const grid = source.slice(source.indexOf('<tbody onMouseDownCapture='), source.indexOf('</tbody>'));
    const excelInputs = Array.from(grid.matchAll(/<Input data-v25-excel-col="[^"]+"[\s\S]*?className="([^"]+)"/g));
    expect(excelInputs).toHaveLength(7);
    for (const match of excelInputs) {
      const classes = match[1].split(/\s+/);
      expect(classes).toContain('h-6');
      expect(classes).toContain('min-h-6!'); // Tailwind v4 important で .input の min-h-12 を上書き
      expect(classes).toContain('text-[11px]'); // 文字サイズは変更しない
      expect(classes).not.toContain('text-[10px]');
    }
    expect(globals).toContain('@utility input {');
    expect(globals).toContain('min-h-12');
    const nonGrid = source.slice(source.indexOf('</tbody>'));
    expect(nonGrid).not.toContain('min-h-6!');
    // 標準見積の外の共通Inputやモーダル入力には同じ上書きを適用しない。
    const beforeGrid = source.slice(0, source.indexOf('<tbody onMouseDownCapture='));
    expect(beforeGrid).not.toContain('className="h-6 min-h-6!');
    const html = render(false);
    const renderedInputs = Array.from(html.matchAll(/<input\b[^>]*data-v25-excel-col="[^"]+"[^>]*>/g));
    // 8種類のJSX入力が複数の明細行に描画されるため、実際のinput要素数は8より多い。
    expect(renderedInputs.length).toBeGreaterThan(8);
    for (const input of renderedInputs) {
      expect(input[0]).toContain('min-h-6!');
      expect(input[0]).toContain('text-[11px]');
    }
  });

  it('確認なしの即削除を撤去し、品名を示す確認ダイアログの確定時だけ対象行を削除する', () => {
    const html = render(false);
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    const confirmSource = read('components/admin/confirm-action-button.tsx');
    expect((html.match(/data-testid="v25-wb-slot-delete"/g) ?? []).length).toBe(initial.slots.length);
    expect((html.match(/data-testid="v25-wb-line-delete"/g) ?? []).length).toBe(initial.lines.length);
    expect(html).toContain('aria-label="「検査商品1」を削除"');
    expect(html).toContain('aria-label="「外構工事」を削除"');
    expect(html).toContain('data-testid="v25-wb-slot-menu"');
    expect(html).toContain('data-testid="v25-wb-line-menu"');
    expect(source).toContain('dialogTitle="この明細を削除しますか？"');
    expect(source).toContain('message={`「${name}」を明細から削除します。削除は下書き保存まで確定しません。`}');
    expect(source).toContain('confirmLabel="削除する"');
    expect(source).toContain('onConfirm={onConfirm}');
    expect(source).toContain('if (positionActionsLocked) return;');
    expect(confirmSource).toContain('onClick={closeDialog}');
    expect(confirmSource).toContain('void onConfirm()');
    // 取消時は操作関数が呼ばれない。確認時だけ対象の種類・キーを限定して更新する。
    const before = initial;
    const removedSlot = deleteV25WorkbenchRow(before, 'slot', 'slot-b1');
    expect(removedSlot.slots).toHaveLength(before.slots.length - 1);
    expect(removedSlot.slots.find((row) => row.key === 'slot-b1')).toBeUndefined();
    expect(removedSlot.lines).toEqual(before.lines);
    const removedLine = deleteV25WorkbenchRow(before, 'line', 'line-k1');
    expect(removedLine.lines).toHaveLength(before.lines.length - 1);
    expect(removedLine.slots).toEqual(before.slots);
    expect(before.slots).toHaveLength(initial.slots.length);
    expect(before.lines).toHaveLength(initial.lines.length);
    const published = render(true);
    expect(published).not.toContain('data-testid="v25-wb-slot-delete"');
    expect(published).not.toContain('data-testid="v25-wb-line-delete"');
  });

  it('商品名右端に商品台帳アイコンを配置し、既存の選び直し画面を使用する', () => {
    const html = render(false);
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    const iconCount = (html.match(/data-testid="v25-wb-slot-product-picker-icon"/g) ?? []).length;
    const slotCount = (html.match(/data-testid="v25-wb-slot"/g) ?? []).length;
    expect(slotCount).toBeGreaterThan(0);
    expect(iconCount).toBe(slotCount);
    expect(html).toContain('title="商品台帳から選ぶ"');
    expect(html).toContain('aria-label="検査商品1を商品台帳から選び直す"');
    expect(source).toContain("import { Package, Trash2 } from 'lucide-react'");
    expect(source).toContain('<Package className="size-3.5" aria-hidden="true" />');
    expect(source).toContain("setPicker({ section: code, targetKey: slot.key });");
    expect(source).toContain('<StandardEstimateV25ProductPicker');
    expect(source).toContain('onChoose={choose}');
    expect(html).toContain('data-testid="v25-wb-slot-menu"');
    expect(html).toContain('商品台帳から選択');
  });

  it('採用済みの現行商品だけ、行の「…」から商品台帳を別タブで編集できる', () => {
    const html = render(false);
    const links = html.match(/data-testid="v25-wb-slot-edit-catalog"/g) ?? [];
    expect(links).toHaveLength(initial.slots.length);
    expect(html).toContain('この商品を台帳で編集 ↗');
    expect(html).toContain('href="/admin/options/p1"');
    expect(html).toContain('href="/admin/options/p2"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('商品台帳から選択');
    expect(html).toContain('仕様を変更');
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(source).toContain("encodeURIComponent(slot.option_id)");
    expect(source).toContain('candidate.id === slot.option_id');
    expect(source).not.toContain('onClick={() => save()}');
  });

  it('販売停止・対象外・存在しない商品、手入力明細と公開版には台帳編集リンクを出さない', () => {
    const unavailable = render(false, {
      candidates: candidates.map((candidate) => candidate.id === 'p2'
        ? { ...candidate, unavailable: true } : candidate.id === 'p3'
          ? { ...candidate, retired: true } : candidate),
    });
    expect(unavailable.match(/data-testid="v25-wb-slot-edit-catalog"/g) ?? []).toHaveLength(1);
    expect(unavailable).toContain('href="/admin/options/p1"');
    expect(unavailable).not.toContain('href="/admin/options/p2"');
    expect(unavailable).not.toContain('href="/admin/options/p3"');
    const missing = render(false, { candidates: candidates.filter((candidate) => candidate.id !== 'p2') });
    expect(missing).not.toContain('href="/admin/options/p2"');
    // 手入力明細のメニューには Link が無く、選択枠の数だけ編集リンクがある。
    expect(render(false).match(/data-testid="v25-wb-slot-edit-catalog"/g) ?? []).toHaveLength(initial.slots.length);
    expect(render(true)).not.toContain('v25-wb-slot-edit-catalog');
  });

  it('固定メニューはスクロール領域の外へ切り出して表示し、画面移動時は閉じる', () => {
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(source).toContain("window.addEventListener('scroll', onScroll, true)");
    expect(source).toContain("window.addEventListener('resize', dismiss)");
    expect(source).toContain("document.addEventListener('keydown', onEscape, true)");
    expect(source).toContain('data-testid="v25-wb-menu-backdrop"');
    expect(source).toContain("event.stopImmediatePropagation()");
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain('maxHeight: Math.max(80');
    expect(source).toContain('target="_blank" rel="noopener noreferrer" prefetch={false}');
    expect(source).toContain('clearV25Position(state, positionFor)');
  });

  it('公開中の版では右端の変更メニューを表示しない', () => {
    const html = render(true);
    expect(html).not.toContain('data-testid="v25-wb-slot-menu"');
    expect(html).not.toContain('data-testid="v25-wb-slot-product-picker-icon"');
    expect(html).not.toContain('data-testid="v25-wb-line-menu"');
    expect(html).toContain('data-testid="v25-wb-slot-price-cell"');
    expect(html).toContain('data-testid="v25-wb-line-price-cell"');
  });

  it('選択肢が4種類でも表には短い要約だけを出し、ドロップダウンを縦に並べない', () => {
    const groups = [
      { id: 'g1', name: 'サイズ', choices: [{ id: 'c1', name: '標準' }, { id: 'c2', name: '大' }] },
      { id: 'g2', name: '色', choices: [{ id: 'white', name: '白' }] },
      { id: 'g3', name: '仕上げ', choices: [{ id: 'matte', name: 'マット' }] },
      { id: 'g4', name: '方向', choices: [{ id: 'left', name: '左' }] },
    ];
    const choices = { g1: 'c2', g2: 'white', g3: 'matte', g4: 'left' };
    const updated = candidates.map((candidate) => candidate.id === 'p1' ? { ...candidate, variantGroups: groups } : candidate);
    expect(v25VariantSummary(updated[0], choices)).toBe('サイズ：大 ／ 色：白 ／ 仕上げ：マット ／ 方向：左');
    expect(v25VariantSummary(updated[0], { g1: 'c2' })).toContain('色：未選択');
    expect(v25VariantSummary(updated[0], { g1: 'does-not-exist' })).toContain('選択肢を確認');
    const html = render(false, {
      candidates: updated,
      initial: {
        ...initial,
        slots: initial.slots.map((slot) => slot.key === 'slot-b1'
          ? { ...slot, variant_choices: choices, slot_code: 'living', slot_label: 'リビング', selectable_option_ids: ['p2'] }
          : slot),
      },
    });
    expect(html).toContain('data-testid="v25-wb-variant-summary"');
    expect(html).toContain('仕様を変更');
    expect(html).toContain('サイズ：大 ／ 色：白');
    expect(html).not.toContain('data-testid="v25-wb-variant-choice"');
    expect(html).not.toContain('data-testid="v25-wb-variant-editor"');
    expect(html).toContain('リビング');
    expect(html).toContain('変更候補1件');
    expect(html).toContain('data-testid="v25-wb-slot-position"');
    expect(html).not.toContain('data-testid="v25-wb-slot-position-editor"');
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(source).toContain('target.option_id === candidate.id');
    expect(source).toContain('setSlot(target.key, { variant_choices: { ...choices } })');
    expect(source).toContain('removePositionOnConfirm');
    expect(source).toContain('clearV25Position(state, positionFor)');
    expect(source).not.toContain("updatePosition({ slot_code: '', slot_label: '', selectable_option_ids: [] })");
  });

  it('位置名直接編集・別位置複製は設定済みの編集行だけにあり、公開版は閲覧のみ', () => {
    const positioned = render(false, {
      initial: {
        ...initial,
        slots: initial.slots.map((slot) => slot.key === 'slot-b1'
          ? { ...slot, slot_code: 'living', slot_label: 'リビングの窓', selectable_option_ids: ['p2'] }
          : slot),
      },
    });
    expect(positioned).toContain('data-testid="v25-wb-duplicate-position"');
    expect(positioned).toContain('別の位置に複製');
    expect(positioned).toContain('位置名を直接編集');
    expect(positioned).toContain('位置を設定');
    expect(positioned).toContain('この商品を台帳で編集');
    expect(positioned).not.toContain('v25-wb-duplicate-position-dialog');
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain('event.nativeEvent.isComposing');
    expect(source).toContain('event.nativeEvent.keyCode');
    expect(source).toContain('onCompositionStart=');
    expect(source).toContain('onCompositionEnd=');
    expect(source).toContain('v25PositionNameKeyAction(');
    expect(source).toContain('renameV25Position(state, positionLabelEditor.slotKey');
    expect(source).not.toContain('data-v25-excel-col="position"');
    const published = render(true, {
      initial: {
        ...initial,
        slots: initial.slots.map((slot) => slot.key === 'slot-b1'
          ? { ...slot, slot_code: 'living', slot_label: 'リビングの窓' } : slot),
      },
    });
    expect(published).not.toContain('v25-wb-duplicate-position');
    expect(published).not.toContain('位置名を直接編集');
    expect(published).toContain('リビングの窓');
  });

  it('位置名を直接編集中は保存・公開・原価更新・変更破棄を無効化し、理由を表示する', () => {
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(source).toContain('const positionInputActive = positionLabelEditor !== null || duplicateFor !== null;');
    expect(source).toContain('data-testid="v25-wb-position-edit-save-blocked"');
    expect(source).toContain('位置名を編集中のため、下書きの保存・公開はできません。Enterで確定するかEscで取り消してください。');
    expect(source).toContain('disabled={pending || !dirty || positionInputActive} data-testid="v25-wb-save"');
    // 変更破棄は手で変えた分だけ（カテゴリーからの工事項目の自動の値は破棄できないため。2026-11-16 の先方の依頼）
    expect(source).toContain('disabled={pending || (!editedDirty && !orderDirty) || positionInputActive} onClick={() => {');
    expect(source).toContain('disabled={pending || dirty || positionInputActive} data-testid="v25-wb-refresh"');
    expect(source).toContain('disabled={pending || blockers.length > 0 || positionInputActive}');
    expect(source).toContain('const save = () => {\n    if (pending || positionInputActive) return;');
    expect(source).toContain('const run = (task:');
    expect(source).toContain('if (pending || positionInputActive) return;');
  });

  it('保存等の処理中は位置名Enter確定・複製モーダル・追加確定を止める', () => {
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(source).toContain('if (!positionLabelEditor || readOnly || pending) return;');
    expect(source).toContain('if (!duplicateFor || readOnly || pending) return;');
    expect(source).toContain('if (readOnly || pending || !positionFor || !positionDraft) return;');
    expect(source).toContain('disabled={pending || positionInputActive}');
    expect(source).toContain('if (pending || positionInputActive) return;');
    expect(source).toContain('data-testid="v25-wb-duplicate-position-confirm" disabled={pending}');
    expect(source).toContain('<V25PositionNameInput disabled={pending}');
    expect(source).toContain('if (disabled) { event.preventDefault(); return; }');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain('event.nativeEvent.isComposing');
  });

  it('位置名を編集中は別行の編集開始を無効化し、Enter確定・Esc取消まで入力途中の内容を守る', () => {
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    const labelButton = source.slice(
      source.indexOf('data-testid="v25-wb-slot-position"'),
      source.indexOf('data-testid="v25-wb-position-unset"')
    );
    expect(labelButton).toContain('disabled={pending || positionInputActive}');
    expect(labelButton).toContain('if (pending || positionInputActive) return;');
    expect(labelButton).toContain('setPositionLabelEditor({ slotKey: slot.key, label: slot.slot_label, error: null })');
    expect(labelButton).toContain('編集中の位置名をEnterで確定するかEscで取り消してください');
    // 同じ位置の入力部品は確定／取消まで維持し、他の行を開くことで置き換えられない。
    expect(source).toContain('positionLabelEditor?.slotKey === slot.key && !readOnly');
    expect(source).toContain('onConfirm={commitInlinePositionLabel}');
    expect(source).toContain('onCancel={() => setPositionLabelEditor(null)}');
    expect(source).toContain('編集中は保存・行削除・位置設定・別の位置名編集ができません。Enterで確定するかEscで取り消してください。');
  });

  it('位置名編集中は行削除と位置を設定の両経路を無効化し、確定・取消後は再び操作・保存が可能', () => {
    // pendingがない通常時は編集中だけロックし、Enter・Escで編集状態がnullに戻れば解除される。
    expect(v25PositionActionsLocked(false, true)).toBe(true);
    expect(v25PositionActionsLocked(false, false)).toBe(false); // Enter 確定後・Esc 取消後
    expect(v25PositionActionsLocked(true, false)).toBe(true); // 保存などの処理中

    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(source).toContain('const positionInputActive = positionLabelEditor !== null || duplicateFor !== null;');
    expect(source).toContain('const positionActionsLocked = v25PositionActionsLocked(pending, positionInputActive);');
    const openDetail = source.slice(source.indexOf('const openPosition ='), source.indexOf('const closePosition ='));
    expect(openDetail).toContain('if (positionActionsLocked) return;');
    const sashButton = source.slice(source.indexOf('data-testid="v25-wb-slot-position-toggle"'), source.indexOf('data-testid="v25-wb-slot-product-picker-icon"'));
    expect(sashButton).toContain('disabled={positionActionsLocked}');
    const menuButton = source.slice(source.indexOf('data-testid="v25-wb-slot-position-menu"'), source.indexOf('金額を入力する'));
    expect(menuButton).toContain('disabled={positionActionsLocked}');
    expect(menuButton).toContain('if (positionActionsLocked) return;');
    const deleteButton = source.slice(source.indexOf('testId="v25-wb-slot-delete"'), source.indexOf('testId="v25-wb-line-delete"'));
    expect(deleteButton).toContain('disabled={positionActionsLocked}');
    expect(deleteButton).toContain('if (positionActionsLocked) return;');
    expect(source).toContain('setPositionLabelEditor(null);'); // Enterが成功したとき
    expect(source).toContain('onCancel={() => setPositionLabelEditor(null)}'); // Escのとき
    expect(source).toContain('disabled={pending || !dirty || positionInputActive} data-testid="v25-wb-save"');
    expect(source).toContain('編集中は保存・行削除・位置設定・別の位置名編集ができません。');
    // 保存ボタンは dirty のままなら編集確定／取消で再び押せる。元から未変更なら無効のまま。
    const canSave = (pending: boolean, dirty: boolean, editing: boolean) => !pending && dirty && !editing;
    expect(canSave(false, true, true)).toBe(false);
    expect(canSave(false, true, false)).toBe(true);
    expect(canSave(false, false, false)).toBe(false);
  });

  it('読み取り専用でも仕様・位置を確認でき、保存や変更はできない', () => {
    const html = render(true, {
      initial: {
        ...initial,
        slots: initial.slots.map((slot) => slot.key === 'slot-b1'
          ? { ...slot, slot_code: 'living', slot_label: 'リビング' } : slot),
      },
    });
    expect(html).toContain('仕様を確認');
    expect(html).toContain('位置・選べる商品を設定');
    expect(html).not.toContain('data-testid="v25-wb-variant-confirm"');
    expect(html).not.toContain('data-testid="v25-wb-position-confirm"');
    expect(html).not.toContain('data-testid="v25-wb-save"');
  });
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

  it('この仕様で選べなくなった商品の行も隠さずに出し、削除を促す', () => {
    const html = renderToStaticMarkup(
      createElement(StandardEstimateV25Workbench, {
        resetKey: 'r:1',
        revisionId: '00000000-0000-4000-8000-000000000001',
        lockVersion: 1,
        readOnly: false,
        baseLines,
        candidates: [
          ...candidates,
          { id: 'p8', name: '下書きに戻した商品', categoryId: '', categoryName: '設備', categoryCode: '', singleSelect: false, manufacturer: '', modelNo: '', section: 'option', retired: true, unavailable: true, variantGroups: [], defaultChoices: {} },
        ],
        initial: { ...initial, slots: [...initial.slots, { key: 'slot-b8', baseline_key: 'b8', option_id: 'p8', variant_choices: {}, quantity: '1', price_mode: 'manual', manual_unit_price: '1000', slot_code: '', slot_label: '', selectable_option_ids: [] }] },
        costs,
        rule,
        taxRule,
        preview,
        savedTotal: null,
      })
    );
    expect(html).toContain('下書きに戻した商品');
    expect(html).toContain('この仕様では選べない商品（削除してください）');
    expect(html).toContain('この仕様では選べなくなった商品の行が 1 件あります');
  });

  it('原価単価・原価金額・粗利を初期表示し、オフでは3列だけを非表示にできる', () => {
    const html = render(false);
    expect(html).toContain('>原価単価');
    expect(html).toContain('>原価金額');
    expect(html).toContain('>粗利');
    expect(html).toContain('原価を表示');
    expect(html).toContain('data-testid="v25-wb-show-cost"');
    expect(html).toMatch(/data-testid="v25-wb-show-cost"[^>]*checked=""/);
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(source).toContain('const columnPrefs = useV25GridPreferences();');
    expect(source).toContain('const columnCount = displayedColumns.length;');
    const headerSource = source.slice(source.indexOf('<thead className='), source.indexOf('</thead>'));
    expect((headerSource.match(/{visible\.(cost_unit|cost_amount|sale_unit|gross|note) && <th /g) ?? []).length).toBe(5);
    expect(source).toContain('v25GridWidth(columnPrefs.prefs)');
    expect(source).toContain("}, [headerLayoutKey]);");
    expect(source).toContain("overlay.scrollLeft = grid.scrollLeft");
    expect(source).toContain("columns[index].style.width =");
  });

  it('編集できる下書きでは保存・最新原価の取り込み・公開を出し、公開中の版は読み取りだけ', () => {
    const editable = render(false);
    expect(editable).toContain('data-testid="v25-wb-save"');
    expect(editable).toContain('data-testid="v25-wb-refresh"');
    expect(editable).toContain('data-testid="v25-wb-publish"');
    expect(editable).toContain('＋ 行を追加');
    const readOnly = render(true);
    expect(readOnly).not.toContain('data-testid="v25-wb-save"');
    expect(readOnly).not.toContain('＋ 行を追加');
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
    // 保存・公開の後も結果の案内を残す（版が変わると中身だけ作り直す）
    expect(page).toContain('resetKey={`${workspace.revision.id}:${workspace.revision.lockVersion}`}');
    // 新しい標準見積は、本体マスターの公開版から作る画面（保存しない試作の画面へは案内しない）
    expect(page).toContain('<Link href="/admin/standard-estimates" className="btn-primary btn-sm">＋ 新しい標準見積を作る</Link>');
    expect(page).not.toContain('href="/admin/estimate-templates/new"');
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
