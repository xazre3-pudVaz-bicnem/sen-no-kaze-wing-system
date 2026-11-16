import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
const workbench = read('components/admin/standard-estimate-v25-workbench.tsx');
const ordering = read('lib/domain/standard-estimate-v25-row-order.ts');
const view = read('lib/domain/standard-estimate-v25-view.ts');
const calc = read('lib/domain/standard-estimate-v25-workbench.ts');

describe('標準見積v2.5 混在表示 UI の接続（PR #664の配色・明細・保存契約を維持）', () => {
  it('区分ごとに商品行と手入力明細を単一ループで表示する', () => {
    expect(workbench).toContain('const orderedSectionRows = mixedOrder.filter((row) => row.section === code)');
    expect(workbench).toContain('orderedSectionRows.map((rowRef, rowIndex) => {');
    expect(workbench).toContain("if (rowRef.kind === 'slot')");
    expect(workbench).toContain('const slot = slots.find((item) => item.key === rowRef.key)');
    expect(workbench).toContain('const line = lines.find((item) => item.key === rowRef.key)');
    expect(workbench).toContain('<Fragment key={v25MixedRowIdentity(rowRef)}>');
    expect(workbench).toContain('<tr key={v25MixedRowIdentity(rowRef)}');
    expect((workbench.match(/rowControls\(rowRef, rowIndex\)/g) ?? [])).toHaveLength(2);
    expect(workbench).not.toContain('slots.map((slot) => {');
    expect(workbench).not.toContain('lines.map((line) => {');
    expect(workbench).toContain("sectionHeader('base', '本体（本体マスター）')");
    expect(workbench).toContain("sectionSubtotal('base', '本体')");
    expect(workbench).toContain('sectionSubtotal(code, STANDARD_SECTION_LABEL[code])');
  });

  it('↑ ↓ ＋を右端から左端4remへ移し、次の列が将来のカテゴリー・位置→品名となる', () => {
    const header = workbench.slice(workbench.indexOf('<thead className='), workbench.indexOf('</thead>'));
    const controlHeader = header.indexOf('data-testid="v25-wb-order-column"');
    const nameHeader = header.indexOf('>品名</th>');
    const rightHeader = header.indexOf('>操作</th>');
    expect(controlHeader).toBeGreaterThanOrEqual(0);
    expect(nameHeader).toBeGreaterThan(controlHeader);
    expect(rightHeader).toBeGreaterThan(nameHeader);
    expect(header).toContain('w-16 border-b border-r');
    expect(header).toContain('sticky left-16 top-0');
    expect(header).toContain('w-[16rem]');
    expect(header).toContain('w-[4.5rem]');
    expect(header.split('w-[5.75rem]').length - 1).toBe(5);
    expect(header.split('w-14').length - 1).toBe(2);
    expect(header).toContain('w-[8rem]');
    expect(workbench).toContain("showCost ? 'w-full min-w-[69rem]' : 'w-full min-w-[52rem]'");
    expect(workbench).toContain('const sourceCells = Array.from(sourceHead.rows[0]?.cells ?? [])');
    expect(workbench).toContain('overlay.scrollLeft = grid.scrollLeft');
    expect(workbench).toContain('将来の「カテゴリー・位置」列は、この操作列と品名列の間に入れる');
    expect(workbench).toContain('const columnCount = showCost ? 11 : 8;');
    expect(workbench).toContain("showCost ? 'w-full min-w-[69rem]' : 'w-full min-w-[52rem]'");
    expect(workbench).not.toContain("showCost ? 'w-[85rem] min-w-[85rem]' : 'w-[64rem] min-w-[64rem]'");
    expect(workbench).toContain('colSpan={showCost ? 7 : 5}');
    expect(workbench).toContain('v25-wb-base-order-cell');
    expect(workbench).toContain('v25-wb-slot-order-cell');
    expect(workbench).toContain('v25-wb-line-order-cell');
    expect(workbench).toContain('compact disabled={positionActionsLocked}');
    expect(workbench.split('focus-within:z-[70]').length - 1).toBe(2);
    expect(workbench).toContain('gap-px" data-testid="v25-wb-row-order-actions"');
    const slotCell = workbench.slice(workbench.indexOf('data-testid="v25-wb-slot-order-cell"'), workbench.indexOf('data-testid="v25-wb-slot-menu"'));
    expect(slotCell).toContain('rowControls(rowRef, rowIndex)');
    const lineCell = workbench.slice(workbench.indexOf('data-testid="v25-wb-line-order-cell"'), workbench.indexOf('data-testid="v25-wb-line-menu"'));
    expect(lineCell).toContain('rowControls(rowRef, rowIndex)');
    const slotRight = workbench.slice(workbench.indexOf('testId="v25-wb-slot-menu"') - 160, workbench.indexOf('testId="v25-wb-slot-delete"'));
    const lineRight = workbench.slice(workbench.indexOf('testId="v25-wb-line-menu"') - 160, workbench.indexOf('testId="v25-wb-line-delete"'));
    expect(slotRight).not.toContain('rowControls(rowRef, rowIndex)');
    expect(lineRight).not.toContain('rowControls(rowRef, rowIndex)');
  });

  it('左端＋は保存中や位置名編集中に開けず、Enter/Spaceからも無効化する', () => {
    expect(workbench).toContain('aria-disabled={disabled || undefined}');
    expect(workbench).toContain('tabIndex={disabled ? -1 : 0}');
    expect(workbench).toContain("if (disabled && (event.key === 'Enter' || event.key === ' '))");
    expect(workbench).toContain('if (disabled && event.currentTarget.open)');
    expect(workbench).toContain('if (disabled) { event.preventDefault(); event.stopPropagation(); return; }');
  });

  it('↑↓＋は同一区分内の境界で無効、位置名編集中・保存中もロックする', () => {
    for (const marker of ['v25-wb-row-up', 'v25-wb-row-down']) {
      expect(workbench).toContain('data-testid="' + marker + '"');
    }
    expect(workbench).toContain('testId="v25-wb-row-insert"');
    expect(workbench).toContain('rowIndex === 0');
    expect(workbench).toContain('rowIndex === orderedSectionRows.length - 1');
    expect(workbench).toContain('disabled={positionActionsLocked || rowIndex === 0}');
    expect(workbench).toContain('disabled={positionActionsLocked || rowIndex === orderedSectionRows.length - 1}');
    expect(workbench).toContain("if (readOnly || positionActionsLocked) return;");
    expect(workbench).toContain("onClick={() => moveViewRow(row, -1)}>↑</button>");
    expect(workbench).toContain("onClick={() => moveViewRow(row, 1)}>↓</button>");
  });

  it('＋からの手入力・商品追加は同じアンカー直下に入り、商品選択取消では増えない', () => {
    expect(workbench).toContain('addLine(code, row);');
    expect(workbench).toContain('setPicker({ section: code, targetKey: null, insertAfter: row })');
    expect(workbench).toContain('picker.insertAfter ?? null');
    expect(workbench).toContain("key: addedKey,");
    expect(workbench).toContain('setViewOrder((current) => v25InsertMixedRow(');
    expect(workbench).toContain('setViewOrder((current) => v25MoveMixedRow(');
    expect(workbench).toContain('const addedKey = newKey(\'slot\')');
    expect(workbench).toContain('const addedKey = newKey(\'line\')');
    expect(workbench).toContain("onClose={() => { setPicker(null); setPickerDirty(false); }}");
    // 商品選択の確定まで「追加商品のID」は発行されない。
    expect(workbench.indexOf("const addedKey = newKey('slot')", workbench.indexOf('const choose =')))
      .toBeGreaterThan(workbench.indexOf('const choose ='));
  });

  it('位置別複製の新行は異なるkindの行を挟んでいても元の商品行の直下となる', () => {
    expect(workbench).toContain('addV25PositionRow(state, duplicateFor.slotKey, addedKey');
    expect(workbench).toContain("{ kind: 'slot', key: duplicateFor.slotKey, section }");
    expect(workbench).toContain('setState(result.state)');
  });

  it('Aの列順・行高・既存メニュー・本体参照・計算・保存/公開処理は変更しない', () => {
    const cols = ['品名', '数量', '単位', '原価単価', '原価金額', '売価単価', '売価金額', '粗利', '仕様・備考', '操作'];
    let last = workbench.indexOf('<thead');
    for (const column of cols) {
      const i = workbench.indexOf('>' + column + '<', last);
      expect(i, column).toBeGreaterThan(last);
      last = i;
    }
    expect(workbench).toContain('h-6 min-h-6!');
    expect(workbench).toContain('testId="v25-wb-slot-menu"');
    expect(workbench).toContain('testId="v25-wb-line-menu"');
    expect(workbench).toContain('data-testid="v25-wb-base-row"');
    expect(workbench).toContain('saveStandardEstimateV25DraftAction({ revision_id: revisionId, expected_lock_version: lockVersion, payload: buildV25SavePayload(state) })');
    expect(workbench).toContain('publishStandardEstimateV25RevisionAction({ revision_id: revisionId, expected_lock_version: lockVersion })');
    expect(calc).toContain('for (const slot of state.slots)');
    expect(calc).toContain('for (const line of state.lines)');
    expect(view).toContain('slots: state.slots.map((slot) => ({');
    expect(view).toContain('lines: state.lines.map((line) => ({');
  });

  it('DB仕様未確定のため、順序の保存/読込を実装せずユーザーへ制限を説明する', () => {
    expect(workbench).toContain('v25-wb-order-preview-warning');
    expect(workbench).toContain('順序は保存・公開・再読込に反映されません');
    expect(workbench).toContain('setViewOrder([])');
    expect(workbench).toContain('data-testid="v25-wb-row-order-reset"');
    expect(workbench).toContain("...(orderPreviewOnly ? ['表示順は保存できません。");
    expect(workbench).toContain('表示順だけ戻す');
    expect(ordering).toContain('表示専用の行参照');
    expect(ordering).not.toContain('rpc(');
    expect(ordering).not.toContain('supabase');
    expect(view).not.toContain('mixed_order');
    expect(view).not.toContain('display_order');
  });
});
