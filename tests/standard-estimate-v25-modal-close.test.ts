import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const workbench = read('components/admin/standard-estimate-v25-workbench.tsx');
const layer = read('components/admin/standard-estimate-v25-dialog-layer.tsx');
const picker = read('components/admin/standard-estimate-v25-product-picker.tsx');
const confirmAction = read('components/admin/confirm-action-button.tsx');

describe('標準見積 v2.5 ポップアップの閉鎖規則', () => {
  it('行の⋯メニューは枠外・Esc・同じ⋯の操作で閉じ、背景のクリックを通さない', () => {
    expect(workbench).toContain('<details ref={menuRef}');
    expect(workbench).toContain('onToggle={(event) => {');
    expect(workbench).toContain('if (!event.currentTarget.open) setPlacement(null)');
    expect(workbench).toContain('data-testid="v25-wb-menu-backdrop"');
    expect(workbench).toContain("if (menuRef.current) menuRef.current.open = false");
    expect(workbench).toContain('event.preventDefault(); event.stopPropagation()');
    expect(workbench).toContain("document.addEventListener('keydown', onEscape, true)");
    expect(workbench).toContain("details.querySelector('summary')?.focus()");
    expect(workbench).toContain("if (!details.open || event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return");
  });

  it('6種類の編集画面すべてに同じ閉じ方と右上の×を適用する', () => {
    expect((workbench.match(/<V25DialogLayer /g) ?? []).length).toBe(6);
    expect((workbench.match(/\{\(requestClose\) => \(/g) ?? []).length).toBe(6);
    expect(workbench).toContain('aria-label="仕様変更を閉じる"');
    expect(workbench).toContain('aria-label="別位置への複製を閉じる"');
    expect(workbench).toContain('aria-label="位置設定画面を閉じる"');
    expect(workbench).toContain('aria-label="標準品の入替を閉じる"');
    expect(workbench).toContain('aria-label="変更候補の選択を閉じる"');
    expect(picker).toContain('aria-label="商品選択を閉じる"');
    expect(workbench).toContain('onClose={requestClose}');
    expect(workbench).toContain('onCancel={requestClose}');
  });

  it('未確定入力だけ破棄確認し、続行では元の画面と入力が残る', () => {
    expect(workbench).toContain("dirty={duplicateFor.label !== ''}");
    expect(workbench).toContain('dirty={pickerDirty}');
    expect(workbench).toContain('dirty={!readOnly && JSON.stringify(variantEditor.choices) !== JSON.stringify(variantSlot.variant_choices)}');
    expect(workbench).toContain('dirty={!readOnly && (removePositionOnConfirm || positionDraft.slot_label !== positionSlot.slot_label');
    expect(workbench).toContain('dirty={replacementDraft.selectableIds.length > 0}');
    expect(workbench).toContain('dirty={selectableDirty}');
    expect(layer).toContain('if (dirty) setDiscardOpen(true)');
    expect(layer).toContain('変更内容を破棄しますか？');
    expect(layer).toContain('編集を続ける');
    expect(layer).toContain('破棄して閉じる');
    expect(layer).toContain('data-testid="v25-wb-discard-confirm-accept" onClick={onClose}');
    expect(picker).toContain('onDirtyChange?.(inputDirty)');
    expect(picker).toContain('const inputDirty = Boolean(categoryId || query || selectedId');
  });

  it('重なった画面は一番手前だけEscで閉じ、Tabを前面に留めてフォーカスを戻す', () => {
    expect(layer).toContain("document.querySelectorAll('[data-v25-dialog-layer]')");
    expect(layer).toContain('if (layers[layers.length - 1] !== layer) return');
    expect(layer).toContain("if (event.key === 'Escape')");
    expect(layer).toContain('event.stopImmediatePropagation()');
    expect(layer).toContain("if (event.key === 'Tab')");
    expect(layer).toContain('first.focus()');
    expect(layer).toContain('last.focus()');
    expect(layer).toContain('openerRef.current = requestedOpenerRef.current?.isConnected');
    expect(layer).toContain(': document.activeElement instanceof HTMLElement ? document.activeElement : null;');
    expect(layer).toContain("if (opener?.isConnected) opener.focus({ preventScroll: true })");
    expect(layer).toContain('data-v25-dialog-close');
    expect(layer).toContain('role="alertdialog"');
  });

  it('「…」と区分の行追加メニューは元のsummaryを明示保存し、ポップアップ閉鎖で元の行に戻す', () => {
    expect(workbench).toContain("const menuTrigger = button.closest('details')?.querySelector<HTMLElement>('summary')");
    expect(workbench).toContain('setDialogOpener(menuTrigger ?? button);');
    expect(workbench).toContain('const [dialogOpener, setDialogOpener] = useState<HTMLElement | null>(null);');
    expect((workbench.match(/rememberRowMenuOpener\(event\.currentTarget\)/g) ?? [])).toHaveLength(4);
    expect((workbench.match(/returnFocusTo=\{dialogOpener\}/g) ?? [])).toHaveLength(5);
    // 子の「変更候補を選ぶ」は親画面内の元ボタンへ戻すため、明示オーバーライドを渡さない。
    expect(workbench).toContain('onClose={closeSelectable} dirty={selectableDirty}');
    expect(layer).toContain('returnFocusTo?: HTMLElement | null;');
    expect(layer).toContain('openerRef.current = requestedOpenerRef.current?.isConnected');
    expect(layer).toContain('if (opener?.isConnected) opener.focus({ preventScroll: true })');
    // メニューのglobal Escapeハンドラーは既にclosedのメニューに横取りさせない。
    expect(workbench).toContain("if (!details.open || event.key !== 'Escape'");
  });

  it('公開確認中のTab/Shift+Tabは前面の確認ボタン内で循環する', () => {
    expect(confirmAction).toContain('const dialogRef = useRef<HTMLElement>(null)');
    expect(confirmAction).toContain('ref={dialogRef}');
    expect(confirmAction).toContain('tabIndex={-1}');
    expect(confirmAction).toContain("if (event.key !== 'Tab' || !dialogRef.current) return;");
    expect(confirmAction).toContain('const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(');
    expect(confirmAction).toContain('element.getClientRects().length > 0');
    expect(confirmAction).toContain('event.shiftKey && active === first');
    expect(confirmAction).toContain('!event.shiftKey && active === last');
    expect(confirmAction).toContain('!dialog.contains(active)');
    expect(confirmAction).toContain('(event.shiftKey ? last : first).focus({ preventScroll: true })');
    expect(confirmAction).toContain('dialog.focus({ preventScroll: true })');
    expect(confirmAction).toContain("document.addEventListener('keydown', handleKeyDown, true)");
    expect(confirmAction).toContain('cancelButtonRef.current?.focus()');
    expect(confirmAction).toContain('queueMicrotask(() => triggerRef.current?.focus())');
  });

  it('共通確認部品の他画面4か所もTab制御の対象で、×は標準見積v2.5のみ追加', () => {
    for (const file of [
      'components/admin/base-master-revision-form.tsx',
      'components/admin/standard-quote-editor.tsx',
      'components/admin/standard-estimate-editor.tsx',
    ]) {
      const consumer = read(file);
      expect(consumer).toContain('ConfirmActionButton');
      expect(consumer).not.toContain('showCloseButton');
    }
    expect(workbench).toContain('<ConfirmActionButton');
    expect(workbench).toContain('showCloseButton');
    expect(confirmAction).toContain('showCloseButton = false');
    // 他画面はデフォルトで×を表示しないが、モーダル中のTab封じ込めは共通で効く。
    expect(confirmAction).toContain('{showCloseButton && (');
    expect(confirmAction).toContain('aria-modal="true"');
    expect(confirmAction).toContain('role="dialog"');
    expect(confirmAction).toContain('void onConfirm()');
  });

  it('変更候補は「決定」まで子画面内だけで変更し、取消時は親の候補に触れない', () => {
    expect(workbench).toContain('setSelectableDraftIds([...(positionDraft?.selectable_option_ids ?? [])])');
    expect(workbench).toContain('setSelectableDraftIds((current) => current');
    expect(workbench).toContain("JSON.stringify(selectableDraftIds ?? []) !== JSON.stringify(positionDraft?.selectable_option_ids ?? [])");
    expect(workbench).toContain('if (selectableDraftIds) updatePosition({ selectable_option_ids: [...selectableDraftIds] })');
    expect(workbench).toContain('onClose={closeSelectable}');
    expect(workbench).toContain('onClick={applySelectable}>決定');
    expect(workbench).toContain('checked={checked} onChange={() => toggleSelectableDraft(candidate.id)}');
    expect(workbench).toContain('const closeSelectable = () => {\n    setSelectableFor(null);\n    setSelectableDraftIds(null);');
  });

  it('枠外クリックはclick終了時に閉じ、背後への貫通を防ぐ', () => {
    expect(layer).toContain('onClick={(event) => {');
    expect(layer).toContain('if (event.target === event.currentTarget)');
    expect(layer).toContain('event.preventDefault();');
    expect(layer).toContain('event.stopPropagation();');
    expect(layer).not.toContain("onPointerDown={(event) => {\n        if (event.target === event.currentTarget) requestClose()");
    expect(confirmAction).toContain('showCloseButton = false');
    expect(confirmAction).toContain('data-testid="confirm-action-close"');
    expect(confirmAction).toContain('onClick={(event) => {');
    expect(confirmAction).not.toContain('onMouseDown={(event) => {');
    expect(workbench).toContain('showCloseButton\n');
  });

  it('既存の価格計算・保存・公開処理を変更せずUIに閉鎖処理だけを追加する', () => {
    expect(workbench).toContain('saveStandardEstimateV25DraftAction');
    expect(workbench).toContain('refreshStandardEstimateV25CostsAction');
    expect(workbench).toContain('publishStandardEstimateV25RevisionAction');
    expect(workbench).toContain('confirmDuplicatePosition');
    expect(workbench).toContain('confirmPosition');
    expect(workbench).toContain('confirmReplacement');
  });
});
