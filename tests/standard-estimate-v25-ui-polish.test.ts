import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/actions/standard-estimate-v25', () => ({
  saveStandardEstimateV25DraftAction: vi.fn(),
  refreshStandardEstimateV25CostsAction: vi.fn(),
  publishStandardEstimateV25RevisionAction: vi.fn(),
}));
const { v25GrossToneClass } = await import('@/components/admin/standard-estimate-v25-workbench');
const source = readFileSync(resolve(process.cwd(), 'components/admin/standard-estimate-v25-workbench.tsx'), 'utf8');
const page = readFileSync(resolve(process.cwd(), 'app/admin/estimate-templates/page.tsx'), 'utf8');
const aColumnPrefs = readFileSync(resolve(process.cwd(), 'components/admin/v25-grid-preferences.tsx'), 'utf8');

describe('v2.5 文字のメリハリ（計算を変えない）', () => {
  it('粗利の正負と0/不明に応じて深緑・赤・灰色を返す', () => {
    expect(v25GrossToneClass(1)).toContain('text-emerald-800');
    expect(v25GrossToneClass(50000)).toContain('font-semibold');
    expect(v25GrossToneClass(-1)).toContain('text-red-700');
    expect(v25GrossToneClass(-10000)).toContain('font-semibold');
    expect(v25GrossToneClass(0)).toContain('text-slate-500');
    expect(v25GrossToneClass(null)).toContain('text-slate-500');
    expect(v25GrossToneClass(undefined)).toContain('text-slate-500');
  });
  it('原価を灰・売価金額を太字、原価警告は既存のまま', () => {
    expect(source).toContain('text-slate-500">{yen(result?.cost_unit_price)}');
    expect(source).toContain('text-slate-500">{yen(display.costAmount)}');
    expect(source).toContain('font-semibold text-slate-900" data-testid="v25-wb-base-sale-amount"');
    expect(source).toContain('font-semibold text-slate-900" data-testid="v25-wb-slot-sale-amount"');
    expect(source).toContain('font-semibold text-slate-900" data-testid="v25-wb-line-sale-amount"');
    expect(source).toContain('v25GrossToneClass(display.gross)');
    expect(source).toContain('data-testid="v25-wb-slot-cost-alert"');
    expect(source).toContain('data-testid="v25-wb-line-price-cell"');
    expect(source).toContain('data-testid="v25-wb-slot-price-cell"');
    expect(source).toContain('data-v25-excel-col="qty"');
    expect(source).toContain('data-v25-excel-col="unit"');
  });
});

describe('v2.5 区分見出し・明細の一行表示', () => {
  it('左に開閉・区分名・行追加、右にラベルと金額、経費との境界線', () => {
    const i = source.indexOf('const sectionHeader =');
    const j = source.indexOf('const sectionSubtotal =', i);
    const header = source.slice(i, j);
    expect(header).toContain('aria-expanded={!collapsed.has(code)}');
    expect(header).toContain('{label}');
    expect(header).toContain('{actions}');
    expect(header).toContain('justify-between gap-2');
    expect(header).toContain('data-testid={`v25-wb-section-money-${code}`}');
    expect(header).toContain('text-emerald-200');
    expect(header).toContain('font-bold text-white');
    expect(header).toContain('border-l border-emerald-600');
    expect(header).toContain('tabular-nums');
    // Aが作った表示列数を基準にする。小計・経費の計算式は変更しない
    expect(header).toContain('result.subtotal');
    expect(header).toContain('result.expense');
    expect(header).toContain('colSpan={columnCount}');
    expect(source).toContain('const columnCount = displayedColumns.length;');
    expect(source).toContain('const beforeSaleAmount = 3 + Number(visible.cost_unit)');
    expect(source).toContain('const afterSaleAmount = Number(visible.gross)');
  });

  it('新規追加が確定したときだけ閉じた区分を展開し、行へ移動する', () => {
    // 手入力：新規IDを確定後、同区分を展開してスクロール/フォーカス
    const lineStart = source.indexOf('const addLine = (section:');
    const lineEnd = source.indexOf('const run =', lineStart);
    const addLine = source.slice(lineStart, lineEnd);
    expect(addLine).toContain("const addedKey = newKey('line')");
    expect(addLine).toContain('key: addedKey');
    expect(addLine).toContain('revealAddedRow(section, addedKey)');

    // 商品：ピッカーの確定（バリデーションを通過した新規追加）の分岐でのみ展開
    const choose = source.slice(source.indexOf('const choose ='), source.indexOf('const openVariant ='));
    expect(choose).toContain("const addedKey = newKey('slot')");
    expect(choose).toContain('key: addedKey');
    expect(choose).toContain('revealAddedRow(picker.section, addedKey)');
    expect(choose).toContain("if (candidate.section !== picker.section || candidate.retired");
    expect(choose.indexOf('revealAddedRow(picker.section, addedKey)')).toBeGreaterThan(choose.indexOf("const addedKey = newKey('slot')"));
    expect(choose.indexOf('revealAddedRow(picker.section, addedKey)')).toBeLessThan(choose.lastIndexOf('setPicker(null)'));

    const reveal = source.slice(source.indexOf('const revealAddedRow ='), source.indexOf('const setRate ='));
    expect(reveal).toContain('if (!current.has(section)) return current');
    expect(reveal).toContain('next.delete(section)');
    expect(reveal).toContain('setJumpToKey({ key })');
    expect(source).toContain('document.getElementById(`v25-manual-row-${jumpToKey.key}`)');
    expect(source).toContain('id={`v25-manual-row-${line.key}`} tabIndex={-1}');
    expect(source).toContain("row.scrollIntoView({ behavior: 'smooth', block: 'center' })");
    expect(source).toContain('row.focus({ preventScroll: true })');
  });

  it('商品選択のキャンセルや既存行変更では新規行向け自動展開を行わない', () => {
    const choose = source.slice(source.indexOf('const choose ='), source.indexOf('const openVariant ='));
    const targetStart = choose.indexOf('if (picker.targetKey) {');
    const newStart = choose.lastIndexOf('} else {');
    expect(targetStart).toBeGreaterThan(0);
    expect(newStart).toBeGreaterThan(targetStart);
    expect(choose.slice(targetStart, newStart)).not.toContain('revealAddedRow(');
    expect(source).toContain('setPicker(null); setPickerDirty(false);');
    expect(source).toContain('triggerText="＋ 行を追加"');
  });

  it('閉じた区分は小計行を隠し、開いている区分の小計行は維持', () => {
    expect(source).toContain("{!collapsed.has('base') && sectionSubtotal('base', '本体')}");
    expect(source).toContain('{!collapsed.has(code) && sectionSubtotal(code, STANDARD_SECTION_LABEL[code])}');
    expect(source).toContain('data-testid={`v25-section-subtotal-${code}`}');
    expect(source).toContain('data-testid={`v25-wb-section-heading-${code}`}');
  });

  it('区分見出しの追加ボタンは一つで、商品と直接入力を従来機能につなぐ', () => {
    expect(source).toContain('testId={`v25-wb-add-row-${code}`}');
    expect(source).toContain('triggerText="＋ 行を追加"');
    expect(source).toContain('商品台帳から追加</button>');
    expect(source).toContain('直接入力</button>');
    expect(source).toContain('setPicker({ section: code, targetKey: null })');
    expect(source).toContain('addLine(code)');
    expect(source).not.toContain('data-testid={`v25-wb-add-product-${code}`}');
    expect(source).not.toContain('data-testid={`v25-wb-add-line-${code}`}');
    // 本体は追加メニューを持たず参照のまま
    expect(source).toContain("sectionHeader('base', '本体（本体マスター）')");
    expect(source).toContain('data-testid="v25-wb-base-row"');
  });
});

describe('Aの列表示PR #669との整合', () => {
  it('比率欄の右端に列表示メニューを一つだけ残して薄青色説明行を削除', () => {
    expect(source).toContain('data-testid="v25-wb-column-display-position"');
    expect(source.split('<V25ColumnDisplayMenu').length - 1).toBe(1);
    expect(source).not.toContain('v25-excel-toolbar');
    expect(source).not.toContain('標準見積明細（Excel風）');
    expect(source).not.toContain('黄色＝入力');
    expect(source).toContain('handleExcelNavigation');
    expect(source).toContain('onKeyDown={handleExcelNavigation}');
    expect(source).toContain('data-testid="v25-wb-compact-settings"');
    expect(aColumnPrefs).toContain('v25-grid-column-menu');
  });
  it('動的なON/OFFと列幅変更の実装を維持', () => {
    expect(source).toContain('const displayedColumns = V25_GRID_COLUMNS.filter');
    expect(source).toContain('const columnCount = displayedColumns.length;');
    expect(source).toContain('v25GridWidth(columnPrefs.prefs)');
    expect(source).toContain('V25WidthHandle');
    expect(source).toContain('overlay.scrollLeft = grid.scrollLeft');
    expect(source).toContain('columns[index].style.width =');
    expect(source).toContain('visible.cost_unit');
    expect(source).toContain('visible.cost_amount');
    expect(source).toContain('visible.gross');
    expect(source).toContain('visible.sale_unit');
    expect(source).toContain('visible.note');
  });
  it('価格の切り替えと版の詳細への導線を変更しない', () => {
    expect(page).toContain('価格の切り替え');
    expect(page).toContain('版の詳細');
    expect(page).toContain('StandardEstimateV25Selector');
    expect(page).toContain('startStandardEstimateV25DraftAction');
  });
});

describe('A #669 最新▲▼上下限・列表示/列幅設定との整合', () => {
  it('既存の上下限付き率スピナーと無効化・キーボード操作を変更しない', () => {
    const rate = readFileSync(resolve(process.cwd(), 'lib/domain/standard-estimate-v25-rate-step.ts'), 'utf8');
    expect(rate).toContain('V25_RATE_RULES');
    expect(rate).toContain('const lower = Math.round(rule.min * 10000)');
    expect(rate).toContain('const upper = Math.round(rule.max * 10000)');
    expect(source).toContain('v25StepPercent(percents[key], direction, key)');
    expect(source).toContain('disabled={readOnly || v25StepPercent(percents[key], 1, key) === percents[key]}');
    expect(source).toContain('disabled={readOnly || v25StepPercent(percents[key], -1, key) === percents[key]}');
    expect(source).toContain("stepRate(key, event.key === 'ArrowUp' ? 1 : -1)");
  });
});

