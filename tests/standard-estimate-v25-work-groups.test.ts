import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { V25LineRow, V25SlotRow } from '@/lib/domain/standard-estimate-v25-view';
import {
  V25_DISPLAY_WORK_ITEMS,
  v25WorkGroupsForDisplay,
  v25WorkItemForCategory,
  v25WorkItemForManual,
} from '@/components/admin/standard-estimate-v25-work-groups';

const slot = (key: string, option_id: string): V25SlotRow => ({
  key, baseline_key: null, option_id, variant_choices: {}, quantity: '1',
  price_mode: 'por', manual_unit_price: '', slot_code: '', slot_label: '', selectable_option_ids: [],
});
const line = (key: string, group_label: string): V25LineRow => ({
  key, line_key: null, section_code: 'interior_exterior', group_label, name: key,
  quantity: '1', unit: '式', price_mode: 'por', unit_price: '', remark: '', review_required: false,
});
const source = readFileSync(resolve(process.cwd(), 'components/admin/standard-estimate-v25-workbench.tsx'), 'utf8');

describe('標準見積v2.5：商品カテゴリーから工事項目へ（UI表示専用）', () => {
  it('正確なカテゴリーコードだけ4工事項目に分類', () => {
    expect(V25_DISPLAY_WORK_ITEMS.map(x => x.label)).toEqual([
      '1. サッシ・木製建具工事', '2. 屋根工事', '3. 外壁工事', '4. 内装仕上げ',
    ]);
    for (const code of ['sash', 'interior-door']) {
      expect(v25WorkItemForCategory(code)?.key).toBe('work:sash_wood');
    }
    expect(v25WorkItemForCategory('roof')?.label).toBe('2. 屋根工事');
    expect(v25WorkItemForCategory('exterior-wall')?.label).toBe('3. 外壁工事');
    for (const code of ['floor', 'wall-ceiling']) {
      expect(v25WorkItemForCategory(code)?.key).toBe('work:interior');
    }
  });

  it('根拠のない商品カテゴリーを工事項目へ推測で振り分けない', () => {
    for (const code of ['entrance-door', 'carpentry', 'insulation', 'ub', 'lighting', 'furniture', 'sitework', 'sash-frame', '', null, undefined]) {
      expect(v25WorkItemForCategory(code)).toBeNull();
    }
  });

  it('手入力グループは同名の工事項目だけと合流し、異なる番号や部分一致は分類しない', () => {
    expect(v25WorkItemForManual('サッシ・木製建具工事').key).toBe('work:sash_wood');
    expect(v25WorkItemForManual('1. サッシ・木製建具工事').key).toBe('work:sash_wood');
    expect(v25WorkItemForManual('2．屋根工事').key).toBe('work:roof');
    expect(v25WorkItemForManual('3、 外壁工事').key).toBe('work:exterior');
    expect(v25WorkItemForManual('4. 内装仕上げ').key).toBe('work:interior');
    expect(v25WorkItemForManual('3. 屋根工事').key).not.toBe('work:roof');
    expect(v25WorkItemForManual('屋根補修工事').key).not.toBe('work:roof');
    expect(v25WorkItemForManual('屋根工事（追加）').label).toBe('屋根工事（追加）');
    expect(v25WorkItemForManual('電気設備工事').label).toBe('電気設備工事');
    expect(v25WorkItemForManual('  ').label).toBe('工事項目未設定（手入力）');
  });

  it('商品行と手入力行が同じ見出しに入り、未分類や既存の自由なグループを保持する', () => {
    const slots = [
      slot('s1', 'roof-product'), slot('s2', 'sash-product'), slot('s3', 'unknown-product'),
      slot('s4', 'floor-product'), slot('s5', 'wall-product'), slot('s6', 'exterior-product'),
    ];
    const lines = [
      line('l1', '4. 内装仕上げ'), line('l2', '電気設備工事'), line('l3', ''),
      line('l4', '2. 屋根工事'), line('l5', 'サッシ・木製建具工事'),
    ];
    const codes: Record<string,string> = {
      'roof-product': 'roof', 'sash-product': 'sash', 'unknown-product': 'entrance-door',
      'floor-product': 'floor', 'wall-product': 'wall-ceiling', 'exterior-product': 'exterior-wall',
    };
    const before = JSON.stringify({ slots, lines });
    const groups = v25WorkGroupsForDisplay(slots, lines, id => codes[id]);
    expect(groups.map(x => x.label)).toEqual([
      '1. サッシ・木製建具工事', '2. 屋根工事', '3. 外壁工事',
      '4. 内装仕上げ', '電気設備工事', '工事項目未設定（手入力）', '工事項目未分類の商品',
    ]);
    expect(groups[0].slots.map(x => x.key)).toEqual(['s2']);
    expect(groups[0].lines.map(x => x.key)).toEqual(['l5']);
    expect(groups[1].slots.map(x => x.key)).toEqual(['s1']);
    expect(groups[1].lines.map(x => x.key)).toEqual(['l4']);
    expect(groups[3].slots.map(x => x.key)).toEqual(['s4', 's5']);
    expect(groups[3].lines.map(x => x.key)).toEqual(['l1']);
    expect(groups.at(-1)?.slots.map(x => x.key)).toEqual(['s3']);
    expect(groups.flatMap(x => x.slots).length).toBe(slots.length);
    expect(groups.flatMap(x => x.lines).length).toBe(lines.length);
    expect(groups[3].slots[0]).toBe(slots[3]); // 元オブジェクトをそのまま表示する
    expect(groups[3].lines[0]).toBe(lines[0]);
    expect(JSON.stringify({ slots, lines })).toBe(before); // group_label / 並び順 / 価格は無変更
  });

  it('グループ編集中は元の表示場所に行を保ち、入力完了後に新しい表示場所へ移す', () => {
    const editing = line('l-edit', '屋根工事（修正中）');
    const frozen = v25WorkGroupsForDisplay([], [editing], () => null, () => '2. 屋根工事');
    expect(frozen.map((group) => group.label)).toEqual(['2. 屋根工事']);
    expect(frozen[0].lines[0]).toBe(editing);
    const afterBlur = v25WorkGroupsForDisplay([], [editing], () => null);
    expect(afterBlur.map((group) => group.label)).toEqual(['屋根工事（修正中）']);
    expect(afterBlur[0].lines[0]).toBe(editing);
    expect(editing.group_label).toBe('屋根工事（修正中）');
  });

  it('区分内が空なら空の見出し行を表示しない', () => {
    expect(v25WorkGroupsForDisplay([], [], () => null)).toEqual([]);
  });
});

describe('標準見積v2.5：全列結合の独立小計行／列表示・編集回帰', () => {
  it('小計だけを1セル＋表示列数で描画し、金額を右寄せして桁を揃える', () => {
    const subtotal = source.slice(source.indexOf('const sectionSubtotal ='), source.indexOf('  return (\n    <section className=', source.indexOf('const sectionSubtotal =')));
    expect(subtotal).toContain('bg-lime-100');
    expect(subtotal).toContain('colSpan={columnCount}');
    expect((subtotal.match(/<td\b/g) ?? [])).toHaveLength(1);
    expect(subtotal).toContain('justify-end');
    expect(subtotal).toContain('tabular-nums');
    expect(subtotal).toContain('whitespace-nowrap');
    expect(subtotal).toContain('data-testid={`v25-section-subtotal-value-${code}`}');
    expect(subtotal).toContain('result.subtotal');
    expect(subtotal).not.toContain('beforeSaleAmount');
    expect(subtotal).not.toContain('afterSaleAmount');
  });

  it('商品/手入力は元の編集行を工事項目下に描画、区分小計は末尾に一度だけ', () => {
    expect(source).toContain('const workGroups = v25WorkGroupsForDisplay(');
    expect(source).toContain('(optionId) => candidateById.get(optionId)?.categoryCode');
    expect(source).toContain('editingWorkGroup?.lineKey === line.key ? editingWorkGroup.originalLabel : line.group_label');
    expect(source).toContain('workGroups.map((workGroup)');
    expect(source).toContain('data-testid="v25-work-item-heading"');
    expect(source).toContain('data-work-item={workGroup.key}');
    expect(source).toContain('{workGroup.slots.map((slot) => {');
    expect(source).toContain('{workGroup.lines.map((line) => {');
    expect(source).toContain('{!collapsed.has(code) && sectionSubtotal(code, STANDARD_SECTION_LABEL[code])}');
    expect(source).toContain('setLine(line.key, { group_label: event.target.value })');
    expect(source).toContain('onFocus={() => setEditingWorkGroup({ lineKey: line.key, originalLabel: line.group_label })}');
    expect(source).toContain('onBlur={(event) => {');
    expect(source).toContain('if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;');
    expect(source).toContain('setEditingWorkGroup((current) => current?.lineKey === line.key ? null : current);');
    expect(source).toContain('setSlot(slot.key, { quantity: event.target.value })');
    expect(source).toContain('id={`v25-manual-row-${line.key}`}');
  });

  it('Tabでグループから同じ行の品名・数量へ移る間は再分類を保留する', () => {
    const row = source.slice(
      source.indexOf('id={`v25-manual-row-${line.key}`}'),
      source.indexOf('data-v25-excel-col="name"', source.indexOf('id={`v25-manual-row-${line.key}`}')),
    );
    expect(row).toContain('onBlur={(event) => {');
    expect(row).toContain('event.currentTarget.contains(event.relatedTarget)');
    expect(row.indexOf('event.currentTarget.contains(event.relatedTarget)')).toBeLessThan(row.indexOf('setEditingWorkGroup((current)'));
    expect(row).toContain('data-v25-excel-col="group"');
    expect(source).toContain('const handleExcelNavigation = (event: ReactKeyboardEvent<HTMLTableElement>) => {');
    expect(source).toContain("event.key === 'Tab'");
    expect(source).toContain('next.focus(); next.select();');
    // グループ入力単体のonBlurでは再分類をしない
    expect(row).not.toContain('onBlur={() => setEditingWorkGroup');
  });

  it('Enter・Shift+Enter・Tabで別行へ移った場合は、再分類後に同じ入力先を復元する', () => {
    const row = source.slice(source.indexOf('id={`v25-manual-row-${line.key}`}'), source.indexOf('data-v25-excel-col="group"', source.indexOf('id={`v25-manual-row-${line.key}`}')));
    expect(row).toContain('const nextInput = event.relatedTarget instanceof HTMLInputElement ? event.relatedTarget : null;');
    expect(row).toContain("const nextRowId = nextInput?.closest('tr')?.id;");
    expect(row).toContain('const nextColumn = nextInput?.dataset.v25ExcelCol;');
    expect(row).toContain('pendingWorkGroupFocus.current = nextRowId && nextColumn');
    expect(row).toContain('{ rowId: nextRowId, column: nextColumn }');
    expect(row).toContain('setEditingWorkGroup((current) => current?.lineKey === line.key ? null : current)');
    expect(source).toContain("event.key === 'Enter'");
    expect(source).toContain('event.shiftKey ? -1 : 1');
    expect(source).toContain("event.key === 'Tab'");
    expect(source).toContain('const [editingWorkGroup, setEditingWorkGroup] = useState');
    expect(source).toContain('useLayoutEffect(() => {');
    expect(source).toContain('const target = pendingWorkGroupFocus.current;');
    expect(source).toContain('pendingWorkGroupFocus.current = null;');
    expect(source).toContain('document.getElementById(target.rowId)');
    expect(source).toContain("element.dataset.v25ExcelCol === target.column && !element.disabled");
    expect(source).toContain('document.activeElement !== input');
    expect(source).toContain('input.focus({ preventScroll: true });');
    expect(source).toContain('input.select();');
    expect(source).toContain('}, [editingWorkGroup]);');
  });

  it('グループ以外の操作へ移る場合は入力先復元をしない', () => {
    const row = source.slice(source.indexOf('id={`v25-manual-row-${line.key}`}'), source.indexOf('data-v25-excel-col="group"', source.indexOf('id={`v25-manual-row-${line.key}`}')));
    expect(row).toContain('pendingWorkGroupFocus.current = nextRowId && nextColumn');
    expect(row).toContain(': null;');
    expect(source).toContain('if (!target) return;');
    expect(source).toContain('if (input && document.activeElement !== input)');
  });

  it('列の表示/非表示と幅調整、固定見出し、保存のpayloadは既存のまま', () => {
    expect(source).toContain('const columnCount = displayedColumns.length;');
    expect(source).toContain('v25GridWidth(columnPrefs.prefs)');
    expect(source).toContain('V25ColumnDisplayMenu');
    expect(source).toContain('V25WidthHandle');
    expect(source).toContain('useV25PageFloatingHeader(headerLayoutKey)');
    expect(source).toContain('overlay.scrollLeft = grid.scrollLeft');
    expect(source).toContain('buildV25SavePayload(state)');
    expect(source).toContain('saveStandardEstimateV25DraftAction');
    expect(source).toContain('clearV25Position(state, positionFor)');
    expect(source).toContain('updateV25Position(state, positionFor, positionDraft.slot_label');
  });
});
