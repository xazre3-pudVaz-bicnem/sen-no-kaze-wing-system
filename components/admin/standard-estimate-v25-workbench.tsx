'use client';

import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Package, Trash2 } from 'lucide-react';
import { V25RowDragHandle } from './v25-row-drag-handle';
import { v25ArrowRowTarget, v25PlanMixedRowMove, type V25MoveSide, type V25MoveGroup } from './standard-estimate-v25-row-move';
import {
  publishStandardEstimateV25RevisionAction,
  refreshStandardEstimateV25CostsAction,
  saveStandardEstimateV25DraftAction,
} from '@/lib/actions/standard-estimate-v25';
import { formatYen } from '@/lib/domain/pricing';
import type { PricingCalculationRule, PricingLineResult, PricingSectionResult, PricingTaxRule } from '@/lib/domain/pricing-v25';
import { STANDARD_SECTION_LABEL, type StandardLineSectionCode } from '@/lib/domain/standard-estimate-view';
import {
  V25_COST_STATUS_LABEL,
  buildV25SavePayload,
  slotCostStatus,
  v25PublishBlockers,
  validateV25EditorState,
  type V25CostStatus,
  type V25EditorState,
  type V25LineRow,
  type V25Preview,
  type V25PreviewSlot,
  type V25SlotPriceMode,
  type V25SlotRow,
} from '@/lib/domain/standard-estimate-v25-view';
import {
  calculateV25Workbench,
  canUsePositionSlot,
  percentProblem,
  percentToRate,
  rateToPercent,
  slotChoiceIds,
  slotIdentity,
  standardSlotQuantity,
  v25SlotRuleIssues,
  v25ProductReplacementIssue,
  v25ProductChangePatch,
  type V25WorkbenchBaseLine,
  type V25WorkbenchCandidate,
  type V25WorkbenchCosts,
} from '@/lib/domain/standard-estimate-v25-workbench';
import {
  addV25PositionRow,
  clearV25Position,
  renameV25Position,
  v25PositionNameKeyAction,
  replaceV25PositionStandard,
  updateV25Position,
  v25PositionMixes,
} from '@/lib/domain/standard-estimate-v25-position-ui';
import { Alert, Badge, Button, Input, Select } from '@/components/ui';
import { ConfirmActionButton } from '@/components/admin/confirm-action-button';
import { StandardEstimateV25AmountBreakdown } from '@/components/admin/standard-estimate-v25-amount-breakdown';
import { StandardEstimateV25ProductPicker } from '@/components/admin/standard-estimate-v25-product-picker';
import { V25DialogLayer } from '@/components/admin/standard-estimate-v25-dialog-layer';
import { v25PositionLabelSuggestions } from '@/lib/domain/standard-estimate-v25-position-label-suggestions';
import { v25WithRowOrder } from '@/lib/domain/standard-estimate-v25-row-persistence';
import {
  v25PersistedMixedRowOrder, v25ReconcileMixedRowOrder, v25InsertMixedRow,
  v25MixedOrderEquals, v25MixedRowsForWorkGroup,
  v25MixedRowIdentity, type V25MixedRowRef,
} from '@/lib/domain/standard-estimate-v25-row-order';
import { v25StepPercent } from '@/lib/domain/standard-estimate-v25-rate-step';
import {
  v25AutoWorkItemLabel,
  v25WorkGroupsForDisplay,
} from '@/components/admin/standard-estimate-v25-work-groups';
import {
  V25ColumnDisplayMenu,
  V25WidthHandle,
  V25_GRID_COLUMNS,
  v25GridWidth,
  useV25GridPreferences,
  type V25GridColumnId,
} from '@/components/admin/v25-grid-preferences';

const LINE_SECTIONS: StandardLineSectionCode[] = ['interior_exterior', 'option', 'sitework'];
const COST_TONE: Record<V25CostStatus, 'success' | 'warn' | 'danger'> = { current: 'success', stale: 'warn', missing: 'danger' };
const COST_COMPACT_LABEL: Record<V25CostStatus, string> = { current: '原価最新', stale: '原価更新あり', missing: '原価未設定' };
const RATE_LABEL = { sales_fee_rate: '販売費率', expense_rate: '経費率', markup_rate: '掛率' } as const;

let rowSeq = 0;
const newKey = (prefix: string) => `${prefix}-new-${(rowSeq += 1)}`;
/** 選べる商品の絞り込みの「窓タイプ未設定」 */
const NO_WINDOW_TYPE = '__none';

const yen = (value: number | null | undefined) => (value === null || value === undefined ? '—' : formatYen(value));

/** 金額を変更せず、計算済み粗利の符号だけで表示色を選ぶ。 */
export function v25GrossToneClass(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || amount === 0) return 'font-medium text-slate-500';
  return amount > 0 ? 'font-semibold text-emerald-800' : 'font-semibold text-red-700';
}

/**
 * v2.5の計算結果「見積用原価単価・売価金額」をそのまま使う表示専用の内訳。
 * 原価金額は確定済み原価単価×数量の端数切捨て。DBの計算・保存値は変更しない。
 * 原価のないmanual/porや未確定行では推測値を出さない。
 */
export function v25DisplayedCostAndGross(
  line: PricingLineResult | undefined,
  quantity: string,
): { costAmount: number | null; gross: number | null } {
  const unitCost = line?.cost_unit_price;
  const count = quantity.trim();
  if (unitCost == null || !Number.isSafeInteger(unitCost) || unitCost < 0 || !/^\d+(?:\.\d{1,4})?$/.test(count)) {
    return { costAmount: null, gross: null };
  }
  const [whole, fraction = ''] = count.split('.');
  const scaledQuantity = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0') || '0');
  const amount = BigInt(unitCost) * scaledQuantity / 10000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) return { costAmount: null, gross: null };
  const costAmount = Number(amount);
  const gross = line?.amount == null || !Number.isSafeInteger(line.amount) ? null : line.amount - costAmount;
  return { costAmount, gross };
}

/** 位置名の編集中や保存などの処理中は、行削除と位置設定の操作を保護する。 */
export const v25PositionActionsLocked = (pending: boolean, editingPosition: boolean) => pending || editingPosition;

type Notice = { tone: 'success' | 'danger'; text: string };
type V25MenuPlacement = { left: number; top?: number; bottom?: number; maxHeight: number };

/**
 * スクロール可能な明細内でも操作メニューを切らさないため、viewport基準で表示する。
 * メニューを開いたまま表／画面がスクロールしたら閉じ、誤った行での操作を防ぐ。
 */
/** 行削除は編集中の明細のみを変更し、他種の行と保存形式を変えない。 */
export function deleteV25WorkbenchRow(state: V25EditorState, kind: 'slot' | 'line', key: string): V25EditorState {
  return kind === 'slot'
    ? { ...state, slots: state.slots.filter((row) => row.key !== key) }
    : { ...state, lines: state.lines.filter((row) => row.key !== key) };
}

/** 品名を確認してからだけ行を削除する。削除は画面上の下書きstateに限定する。 */
function V25RowDeleteButton({ name, disabled, testId, onConfirm, inMenu = false }: {
  name: string; disabled: boolean; testId: string; onConfirm: () => void; inMenu?: boolean;
}) {
  return (
    <ConfirmActionButton destructive data-testid={testId} disabled={disabled}
      dialogTitle="この明細を削除しますか？"
      message={`「${name}」を明細から削除します。削除は下書き保存まで確定しません。`}
      confirmLabel="削除する" onConfirm={onConfirm}
      aria-label={`「${name}」を削除`}
      title={disabled ? '位置名を確定または取り消してから削除してください' : `${name}を削除`}
      className={inMenu
        ? 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-40'
        : 'flex size-6 shrink-0 items-center justify-center rounded text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-40'}>
      <Trash2 className="size-3.5" aria-hidden="true" />
      {inMenu && <span>削除</span>}
    </ConfirmActionButton>
  );
}

function V25WorkbenchRowMenu({ label, testId, children, triggerText = '⋯', disabled = false }: { label: string; testId: string; children: ReactNode; triggerText?: string; disabled?: boolean }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<V25MenuPlacement | null>(null);

  const place = (summary: HTMLElement) => {
    const rect = summary.getBoundingClientRect();
    const margin = 8;
    const menuWidth = Math.min(224, window.innerWidth - margin * 2);
    const availableBelow = window.innerHeight - rect.bottom - margin;
    const availableAbove = rect.top - margin;
    const above = availableBelow < 230 && availableAbove > availableBelow;
    setPlacement({
      left: Math.max(margin, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - margin)),
      ...(above ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      maxHeight: Math.max(80, (above ? availableAbove : availableBelow) - 4),
    });
  };

  useEffect(() => {
    const details = menuRef.current;
    if (!placement || !details?.open) return;
    const dismiss = () => { details.open = false; panelRef.current?.hidePopover(); };
    const onOutside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !details.contains(target)) dismiss();
    };
    const onScroll = (event: Event) => {
      if (details.contains(event.target as Node)) return;
      dismiss();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (!details.open || event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
      details.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('click', onOutside, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', dismiss);
    document.addEventListener('keydown', onEscape, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('click', onOutside, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('keydown', onEscape, true);
    };
  }, [placement]);

  return (
    <details ref={menuRef} className="group relative inline-block" data-testid={testId}
      onToggle={(event) => {
        if (disabled && event.currentTarget.open) { event.currentTarget.open = false; return; }
        if (!event.currentTarget.open) {
          panelRef.current?.hidePopover();
          setPlacement(null);
        } else {
          const summary = event.currentTarget.querySelector('summary');
          if (summary instanceof HTMLElement) place(summary);
          // Native top layer escapes all ancestor overflow and sticky stacking contexts.
          panelRef.current?.showPopover();
        }
      }}
      onKeyDown={(event) => {
        if (disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault(); event.stopPropagation(); return;
        }
        if (event.key === 'Escape') { event.currentTarget.open = false; event.stopPropagation(); }
      }}>
      <summary className={triggerText === '⋯'
        ? 'flex size-6 cursor-pointer list-none items-center justify-center rounded text-sm font-bold text-slate-600 hover:bg-slate-100 [&::-webkit-details-marker]:hidden'
        : triggerText === '＋' 
          ? 'flex size-4 cursor-pointer list-none items-center justify-center rounded border border-slate-300 bg-white text-[10px] font-semibold text-emerald-900 hover:bg-slate-100 [&::-webkit-details-marker]:hidden'
          : 'flex h-6 cursor-pointer list-none items-center justify-center rounded border border-emerald-400/70 px-2 text-[10px] font-semibold text-white hover:bg-emerald-800 [&::-webkit-details-marker]:hidden'}
        aria-label={label} title={label} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : 0}
        onClick={(event) => {
          if (disabled) { event.preventDefault(); event.stopPropagation(); return; }
          if (!menuRef.current?.open) place(event.currentTarget);
        }}>{triggerText}</summary>
      <div ref={panelRef} popover="manual"
        className="fixed inset-auto m-0 z-[60] w-56 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-left text-[11px] font-normal shadow-lg"
        style={placement ?? undefined} data-testid="v25-wb-menu-panel">
        {children}
      </div>
    </details>
  );
}


/**
 * ページ縦スクロールを保持したまま、明細が画面上端を通過している間だけ列見出しを表示する。
 * overflow-x-auto の内部で sticky top を使うと縦方向の固定先が横スクロール領域に
 * なってしまうため、実際の thead を表示専用に複製し document.body に固定する。
 * 幅は元表の各 th から測定し、横スクロールは同じ scrollLeft を使う。
 * 複製は aria-hidden / pointer-events-none とし、編集や保存には一切関与しない。
 */
function useV25PageFloatingHeader(headerLayoutKey: string) {
  const gridRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const grid = gridRef.current;
    const table = tableRef.current;
    const sourceHead = table?.tHead;
    if (!grid || !table || !sourceHead) return;

    const overlay = document.createElement('div');
    overlay.dataset.testid = 'v25-page-floating-column-header';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.className = 'pointer-events-none fixed top-0 z-[45] overflow-hidden border-b border-[#CBD5E1] bg-[#E6EDF3] shadow-sm';
    overlay.style.display = 'none';

    const mirrorTable = table.cloneNode(false) as HTMLTableElement;
    mirrorTable.removeAttribute('data-testid');
    const mirrorHead = sourceHead.cloneNode(true) as HTMLTableSectionElement;
    const colgroup = document.createElement('colgroup');
    const sourceCells = Array.from(sourceHead.rows[0]?.cells ?? []);
    const columns = sourceCells.map(() => {
      const col = document.createElement('col');
      colgroup.appendChild(col);
      return col;
    });
    mirrorTable.append(colgroup, mirrorHead);
    overlay.appendChild(mirrorTable);
    document.body.appendChild(overlay);

    const sync = () => {
      const gridRect = grid.getBoundingClientRect();
      const headerHeight = sourceHead.getBoundingClientRect().height;
      // ページ縦スクロールで元の見出しが画面上端を通過したときに表示する。
      const nativeHeaderPassed = sourceHead.getBoundingClientRect().bottom <= 0;
      // 表の終端で解除する。保存欄が viewport の下端に現れた時点で消すと、
      // 行数が少ない表・高い画面では明細の途中なのに固定見出しが消えてしまう。
      // 公開済み(readOnly)にも保存欄は無いので、表の矩形だけを正本とする。
      const visible = nativeHeaderPassed && gridRect.bottom > headerHeight;
      overlay.style.display = visible ? 'block' : 'none';
      if (!visible) return;

      overlay.style.left = `${gridRect.left + grid.clientLeft}px`;
      overlay.style.width = `${grid.clientWidth}px`;
      const tableWidth = table.getBoundingClientRect().width;
      mirrorTable.style.width = `${tableWidth}px`;
      mirrorTable.style.minWidth = `${tableWidth}px`;
      sourceCells.forEach((cell, index) => {
        columns[index].style.width = `${cell.getBoundingClientRect().width}px`;
      });
      // overflow:hidden はプログラムから scrollLeft を設定でき、元表と列位置を同期できる。
      overlay.scrollLeft = grid.scrollLeft;
    };

    // capture: true でページ縦スクロールと明細の横スクロールの両方を監視する。
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync);
    resizeObserver?.observe(grid);
    resizeObserver?.observe(table);
    resizeObserver?.observe(sourceHead);
    sync();
    return () => {
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
      resizeObserver?.disconnect();
      overlay.remove();
    };
  }, [headerLayoutKey]);

  return { gridRef, tableRef };
}

/** 位置名のEnter確定は日本語変換中／変換終了直後には実行しない。 */
function V25PositionNameInput({
  value, onChange, onConfirm, onCancel, testId, placeholder, disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  testId: string;
  placeholder: string;
  disabled?: boolean;
}) {
  const composing = useRef(false);
  const justComposed = useRef(false);
  return (
    <Input autoFocus value={value} maxLength={40} data-testid={testId}
      disabled={disabled} aria-label="位置名" placeholder={placeholder}
      className="h-7 w-full rounded-sm border border-amber-400 bg-white px-1 text-[11px]"
      onChange={(event) => onChange(event.target.value)}
      onCompositionStart={() => { composing.current = true; justComposed.current = false; }}
      onCompositionEnd={() => { composing.current = false; justComposed.current = true; }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        // 明細の Enter＝下の行、グローバル Esc＝ダイアログ終了へ伝播させない。
        event.stopPropagation();
        if (disabled) { event.preventDefault(); return; }
        const action = v25PositionNameKeyAction(
          event.key, composing.current || event.nativeEvent.isComposing,
          justComposed.current, event.nativeEvent.keyCode
        );
        if (!action) return; // 日本語IMEの候補確定は標準操作に委ねる。
        event.preventDefault();
        if (action === 'commit') onConfirm();
        else onCancel();
      }}
      onKeyUp={(event) => {
        if (event.key === 'Enter' && !composing.current) justComposed.current = false;
      }}
    />
  );
}

/** 表示用要約のみ。variant choice ID と保存 payload は変更しない。 */
export function v25VariantSummary(candidate: Pick<V25WorkbenchCandidate, 'variantGroups'> | undefined, choices: V25SlotRow['variant_choices']): string {
  if (!candidate) return '商品を確認';
  if (candidate.variantGroups.length === 0) return '仕様選択なし';
  return candidate.variantGroups.map((group) => {
    const id = choices[group.id];
    const choice = group.choices.find((item) => item.id === id);
    return `${group.name}：${choice?.name ?? (id ? '選択肢を確認' : '未選択')}`;
  }).join(' ／ ');
}

type WorkbenchProps = {
  /** 見積の選択モデルと仕様。工事項目見出しの表示だけに使う。 */
  modelSlug?: string | null;
  specCode?: string | null;
  revisionId: string;
  lockVersion: number;
  readOnly: boolean;
  baseLines: V25WorkbenchBaseLine[];
  /** 現在の標準見積が参照する本体Revision。確認できた場合のみ版番号・直リンクを表示。 */
  baseMasterReference?: { masterId: string; revisionVersion: number } | null;
  candidates: V25WorkbenchCandidate[];
  initial: V25EditorState;
  costs: V25WorkbenchCosts;
  rule: PricingCalculationRule;
  taxRule: PricingTaxRule;
  preview: V25Preview | null;
  /** 保存済みの税込合計（DB の計算。未確定を含むなら null） */
  savedTotal: number | null;
};

/**
 * 見積書管理 ＞ 標準見積の Excel 風の画面（v2.5 の下書きの正式な編集画面。2026-10-27 先方方針）。
 * 本体（本体マスター）・内外装・オプション・別途の明細を 1 つの表で編集し、画面で試算する。
 * 保存・最新原価の取り込み・公開は DB の RPC（20261019100000）が行い、金額の正本は DB の計算。本部だけが使う。
 * resetKey（版と lock_version）が変わると、保存済みの内容で作り直す。結果の案内は作り直しても残す
 */
export function StandardEstimateV25Workbench({ resetKey, ...props }: WorkbenchProps & { resetKey: string }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  return <WorkbenchBody key={resetKey} {...props} notice={notice} onNotice={setNotice} />;
}

function WorkbenchBody({
  modelSlug,
  specCode,
  revisionId,
  lockVersion,
  readOnly,
  baseLines,
  baseMasterReference,
  candidates,
  initial,
  costs,
  rule,
  taxRule,
  preview,
  savedTotal,
  notice,
  onNotice,
}: WorkbenchProps & { notice: Notice | null; onNotice: (notice: Notice | null) => void }) {
  const router = useRouter();
  const [state, setState] = useState<V25EditorState>(initial);
  // PR #686 の共通 row_order を表示順の正本にする。↑↓＋は未保存中だけ上書きし、保存時に連番化する。
  const [viewOrder, setViewOrder] = useState<V25MixedRowRef[]>([]);
  // ドラッグ中の一時的な移動先。保存データ・Revisionには含めない。
  const [dropPreview, setDropPreview] = useState<{
    sourceId: string; targetId: string; side: V25MoveSide;
    top: number; left: number; width: number;
  } | null>(null);
  const [percents, setPercents] = useState(() => ({
    sales_fee_rate: rateToPercent(initial.sales_fee_rate),
    expense_rate: rateToPercent(initial.expense_rate),
    markup_rate: rateToPercent(initial.markup_rate),
  }));
  const columnPrefs = useV25GridPreferences();
  const visible = columnPrefs.prefs.visible;
  const displayedColumns = V25_GRID_COLUMNS.filter((col) => visible[col.id]);
  const columnCount = displayedColumns.length;
  const beforeSaleAmount = 3 + Number(visible.cost_unit) + Number(visible.cost_amount) + Number(visible.sale_unit);
  const afterSaleAmount = Number(visible.gross) + Number(visible.note) + 1;
  const headerLayoutKey = displayedColumns.map((col) => `${col.id}:${columnPrefs.prefs.widths[col.id]}`).join('|');
  const { gridRef, tableRef } = useV25PageFloatingHeader(headerLayoutKey);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [picker, setPicker] = useState<{ section: StandardLineSectionCode; targetKey: string | null; insertAfter?: V25MixedRowRef | null } | null>(null);
  const [pickerDirty, setPickerDirty] = useState(false);
  // 位置・用途の選択枠（v2.5 PR-S2）：位置の編集欄を開いている行と、選べる商品を選ぶ画面の対象の行
  const [variantEditor, setVariantEditor] = useState<{ slotKey: string; choices: V25SlotRow['variant_choices'] } | null>(null);
  const [positionFor, setPositionFor] = useState<string | null>(null);
  const [positionDraft, setPositionDraft] = useState<Pick<V25SlotRow, 'slot_code' | 'slot_label' | 'selectable_option_ids'> | null>(null);
  const [removePositionOnConfirm, setRemovePositionOnConfirm] = useState(false);
  const [positionLabelEditor, setPositionLabelEditor] = useState<{ slotKey: string; label: string; error: string | null } | null>(null);
  const [duplicateFor, setDuplicateFor] = useState<{ slotKey: string; label: string; error: string | null } | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [replacementDraft, setReplacementDraft] = useState<{
    slotKey: string; candidate: V25WorkbenchCandidate; choices: Record<string, string>; selectableIds: string[];
  } | null>(null);
  const [jumpToKey, setJumpToKey] = useState<{ key: string } | null>(null);
  const lastNavigated = useRef<{ key: string } | null>(null);
  const [selectableFor, setSelectableFor] = useState<string | null>(null);
  const [selectableDraftIds, setSelectableDraftIds] = useState<string[] | null>(null);
  const [selectableWindowType, setSelectableWindowType] = useState('');
  const [selectableQuery, setSelectableQuery] = useState('');
  // グループ名は行内で常時表示せず、メニューから明示的に確定した場合だけ書き換える。
  // ダイアログ内の入力中に再分類しないので、Tab/Enterで明細のフォーカスが外れることもない。
  const [groupEditor, setGroupEditor] = useState<{ lineKey: string; originalLabel: string; value: string } | null>(null);
  const [pending, startTransition] = useTransition();
  // 未確定の位置名をDBへ保存／公開してしまわないよう、確定か取消まで操作を止める。
  const positionInputActive = positionLabelEditor !== null || duplicateFor !== null;
  const positionActionsLocked = v25PositionActionsLocked(pending, positionInputActive);
  // 起動元を明示保持する。「…」の項目はメニューを閉じると不可視になるため復帰先にしない。
  const [dialogOpener, setDialogOpener] = useState<HTMLElement | null>(null);
  const rememberDialogOpener = (button: HTMLElement) => { setDialogOpener(button); };
  const rememberRowMenuOpener = (button: HTMLElement) => {
    const menuTrigger = button.closest('details')?.querySelector<HTMLElement>('summary');
    setDialogOpener(menuTrigger ?? button);
  };

  const candidateById = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);
  const sectionOf = (optionId: string) => candidateById.get(optionId)?.section;
  // 工事項目（2026-11-16 の先方の依頼）：商品の行は保存した値、未設定ならカテゴリーからの自動の値を表示・見出し・保存に使う。
  // 公開済みの版（閲覧だけ）は保存した値だけを出す（自動の値は保存されていないため）
  const autoWorkItemOf = (slot: Pick<V25SlotRow, 'option_id'>) => {
    if (readOnly) return '';
    const candidate = candidateById.get(slot.option_id);
    return v25AutoWorkItemLabel(candidate?.categoryCode, { modelSlug, specCode, sectionCode: candidate?.section });
  };
  const workItemOf = (slot: V25SlotRow) => slot.work_item?.trim() || autoWorkItemOf(slot);
  // 保存した共通 display_order から商品・自由入力の混在順を再構成する。
  // 工事項目ごとの見出しは #687 の現行仕様を維持し、見出し内だけ ↑↓ できる。
  const persistedMixedOrder = useMemo(
    () => v25PersistedMixedRowOrder(state, (id) => candidateById.get(id)?.section),
    [state, candidateById]
  );
  const mixedOrder = useMemo(
    () => v25ReconcileMixedRowOrder(
      viewOrder.length ? viewOrder : persistedMixedOrder, state, (id) => candidateById.get(id)?.section
    ),
    [viewOrder, persistedMixedOrder, state, candidateById]
  );
  const renderedMixedOrder = LINE_SECTIONS.flatMap((code) => {
    const slots = state.slots.filter((slot) => sectionOf(slot.option_id) === code);
    const lines = state.lines.filter((line) => line.section_code === code);
    return v25WorkGroupsForDisplay(
      slots, lines, (id) => candidateById.get(id)?.categoryCode,
      (line) => line.group_label, { modelSlug, specCode, sectionCode: code }, workItemOf
    ).flatMap((group) => v25MixedRowsForWorkGroup(mixedOrder, group));
  });
  // 保存済みの行と同じ順に戻したときは未保存扱いにしない（並べ替えだけでも保存可）。
  const initialMixedOrder = v25PersistedMixedRowOrder(initial, (id) => candidateById.get(id)?.section);
  const initialRenderedOrder = LINE_SECTIONS.flatMap((code) =>
    v25WorkGroupsForDisplay(
      initial.slots.filter((slot) => sectionOf(slot.option_id) === code),
      initial.lines.filter((line) => line.section_code === code),
      (id) => candidateById.get(id)?.categoryCode,
      (line) => line.group_label, { modelSlug, specCode, sectionCode: code }, workItemOf
    ).flatMap((group) => v25MixedRowsForWorkGroup(initialMixedOrder, group))
  );
  const orderDirty = !v25MixedOrderEquals(renderedMixedOrder, initialRenderedOrder);
  const moveContext = (code: StandardLineSectionCode) => ({ modelSlug, specCode, sectionCode: code, sectionOf });
  const rowMoveLocked = readOnly || positionActionsLocked || groupEditor !== null;
  const plannedMove = (
    row: V25MixedRowRef, target: V25MixedRowRef, side: V25MoveSide, groups: readonly V25MoveGroup[]
  ) => v25PlanMixedRowMove(state, mixedOrder, groups, row, target, side, moveContext(row.section));
  const applyRowMove = (
    row: V25MixedRowRef, target: V25MixedRowRef, side: V25MoveSide, groups: readonly V25MoveGroup[]
  ) => {
    if (rowMoveLocked) return;
    const next = plannedMove(row, target, side, groups);
    if (!next) return;
    // 並び順と工事項目を同一イベントで更新。数量・価格・位置・原価Versionは不変。
    setState(next.state);
    setViewOrder(next.order);
    setDropPreview(null);
  };
  const moveViewRow = (
    row: V25MixedRowRef, direction: -1 | 1, groups: readonly V25MoveGroup[]
  ) => {
    const target = v25ArrowRowTarget(mixedOrder, groups, row, direction);
    if (target) applyRowMove(row, target.row, target.side, groups);
  };
  const previewRowMove = (
    source: V25MixedRowRef, targetId: string | null, side: V25MoveSide,
    groups: readonly V25MoveGroup[]
  ): boolean => {
    if (rowMoveLocked || !targetId) { setDropPreview(null); return false; }
    const target = mixedOrder.find((row) => v25MixedRowIdentity(row) === targetId);
    if (!target || !plannedMove(source, target, side, groups)) {
      setDropPreview(null);
      return false;
    }
    const rowEl = Array.from(tableRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-v25-dnd-row]') ?? [])
      .find((el) => el.dataset.v25DndRow === targetId);
    if (!rowEl) { setDropPreview(null); return false; }
    const rect = rowEl.getBoundingClientRect();
    const top = side === 'before' ? rect.top : rect.bottom;
    setDropPreview((current) => current?.sourceId === v25MixedRowIdentity(source) &&
      current.targetId === targetId && current.side === side &&
      current.top === top && current.left === rect.left && current.width === rect.width
      ? current
      : { sourceId: v25MixedRowIdentity(source), targetId, side, top, left: rect.left, width: rect.width });
    return true;
  };
  const calc = useMemo(
    () => calculateV25Workbench(rule, taxRule, state, baseLines, costs, (optionId) => candidateById.get(optionId)?.section),
    [rule, taxRule, state, baseLines, costs, candidateById]
  );
  const resultByKey = useMemo(() => {
    const map = new Map<string, PricingLineResult>();
    for (const section of calc.result?.sections ?? []) for (const line of section.lines) map.set(line.key, line);
    return map;
  }, [calc.result]);
  const sectionResult = (code: string): PricingSectionResult | undefined => calc.result?.sections.find((section) => section.code === code);
  const incompleteKeys = useMemo(() => new Map(calc.incomplete.map((item) => [item.key, item.reason])), [calc.incomplete]);
  // 原価の状態は、保存済みの auto の選択枠と同じ「商品＋選択肢」の行にだけ出す（商品・選択肢を変えた行は、保存すると今の原価で固定する）。
  // 同じ商品＋選択肢が複数の位置の枠にあるときは、その行の状態を先に使う（DB の保存の固定と同じ順）
  const previewByIdentity = useMemo(() => {
    const byIdentity = new Map<string, V25PreviewSlot>();
    const byRow = new Map<string, V25PreviewSlot>();
    for (const slot of preview?.slots ?? []) {
      if (slot.price_mode !== 'auto') continue;
      const identity = slotIdentity(slot.option_id, slot.variants.map((variant) => variant.variant_choice_id));
      byIdentity.set(identity, slot);
      byRow.set(`${slot.baseline_key}#${identity}`, slot);
    }
    return {
      get: (row: Pick<V25SlotRow, 'baseline_key' | 'option_id' | 'variant_choices'>) => {
        const identity = slotIdentity(row.option_id, slotChoiceIds(row));
        return (row.baseline_key ? byRow.get(`${row.baseline_key}#${identity}`) : undefined) ?? byIdentity.get(identity);
      },
    };
  }, [preview]);
  const unpricedKeys = useMemo(() => new Set(calc.unpriced), [calc.unpriced]);
  const unavailableCount = state.slots.filter((slot) => candidateById.get(slot.option_id)?.unavailable).length;
  const editedDirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initial), [state, initial]);
  // 工事項目が未設定で、カテゴリーからの自動の値を表示している商品の行（保存すると、その値を保存し見積書の摘要にも出る）。
  // 画面と保存・公開の内容をそろえるため、未保存の変更として扱う（保存するまで公開しない）
  const unsavedAutoWorkItems = state.slots.filter((slot) => !slot.work_item?.trim() && autoWorkItemOf(slot)).length;
  const dirty = editedDirty || unsavedAutoWorkItems > 0 || orderDirty;
  const positionMixes = useMemo(() => v25PositionMixes(state.slots, (id) => candidateById.get(id)), [state.slots, candidateById]);
  // シミュレーターと連携する選択枠の決まり（外壁は数量 4、それ以外は数量 1、1 つだけ選べるカテゴリーは 1 枠。DB も公開で止める）
  const slotRuleIssues = useMemo(
    () =>
      v25SlotRuleIssues(
        state.slots,
        (optionId) => candidateById.get(optionId),
        (categoryId) => candidates.filter((candidate) => candidate.categoryId === categoryId)
      ),
    [state.slots, candidateById, candidates]
  );
  const blockers = [
    ...v25PublishBlockers(preview, dirty),
    ...(slotRuleIssues.length > 0 ? ['選択枠がシミュレーターと連携する決まりに合いません（表の下の案内を確認してください）'] : []),
  ];


  // 案内から未設定行へ移動。折り畳まれていた場合は行を開いてから移動する。
  useEffect(() => {
    if (!jumpToKey || lastNavigated.current === jumpToKey) return;
    const row = document.getElementById(`v25-position-row-${jumpToKey.key}`) ??
      document.getElementById(`v25-manual-row-${jumpToKey.key}`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.focus({ preventScroll: true });
    lastNavigated.current = jumpToKey;
  }, [jumpToKey, collapsed]);

  const setSlot = (key: string, patch: Partial<V25SlotRow>) =>
    setState((current) => ({ ...current, slots: current.slots.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)) }));
  const setLine = (key: string, patch: Partial<V25LineRow>) =>
    setState((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));
  // 追加が確定した場合だけ対象区分を開く。商品選択のキャンセル時には呼ばない。
  const revealAddedRow = (section: StandardLineSectionCode, key: string) => {
    setCollapsed((current) => {
      if (!current.has(section)) return current;
      const next = new Set(current);
      next.delete(section);
      return next;
    });
    setJumpToKey({ key });
  };
  const setRate = (key: keyof typeof RATE_LABEL, value: string) => {
    setPercents((current) => ({ ...current, [key]: value }));
    setState((current) => ({ ...current, [key]: percentToRate(value) }));
  };
  const stepRate = (key: keyof typeof RATE_LABEL, direction: -1 | 1) => {
    const next = v25StepPercent(percents[key], direction, key);
    if (next !== percents[key]) setRate(key, next);
  };
  // 明細行の列境界の狭い領域だけを対象にし、既存の列幅変更hookへ委譲する。
  // 結合見出し・小計、ボタン等は対象外。列幅は各行ではなく列全体に反映される。
  const resizeHover = useRef<HTMLElement | null>(null);
  const bodyResizeCandidate = (target: EventTarget, clientX: number) => {
    if (!(target instanceof HTMLElement) || target.closest('button, summary, a, select, textarea, [role="separator"]')) return null;
    const cell = target.closest('td');
    if (!(cell instanceof HTMLTableCellElement) || cell.colSpan !== 1) return null;
    const row = cell.closest('tr');
    if (!row || !['v25-wb-base-row', 'v25-wb-slot', 'v25-wb-line'].includes(row.dataset.testid ?? '')) return null;
    const column = displayedColumns[cell.cellIndex];
    const edge = cell.getBoundingClientRect().right - clientX;
    return column && edge >= 0 && edge <= 6 ? { id: column.id, cell } : null;
  };
  const showBodyResizeCursor = (event: ReactMouseEvent<HTMLTableSectionElement>) => {
    const next = bodyResizeCandidate(event.target, event.clientX);
    const target = next && event.target instanceof HTMLElement ? event.target : null;
    if (resizeHover.current && resizeHover.current !== target) resizeHover.current.style.removeProperty('cursor');
    if (target) target.style.cursor = 'col-resize';
    resizeHover.current = target;
  };
  const startBodyResize = (event: ReactMouseEvent<HTMLTableSectionElement>) => {
    if (event.button !== 0) return;
    const candidate = bodyResizeCandidate(event.target, event.clientX);
    if (candidate) columnPrefs.startResize(event, candidate.id);
  };

  const autoWidth = (id: V25GridColumnId) => {
    const table = tableRef.current;
    const header = Array.from(table?.tHead?.rows[0]?.cells ?? []);
    const index = header.findIndex((cell) => cell.getAttribute('data-v25-column') === id);
    if (!table || index < 0) return;
    let desired = header[index].scrollWidth + 10;
    for (const tbody of Array.from(table.tBodies)) {
      for (const row of Array.from(tbody.rows)) {
        if (row.cells.length !== header.length) continue;
        const cell = row.cells[index];
        if (!cell || cell.colSpan !== 1) continue;
        desired = Math.max(desired, cell.scrollWidth + 10);
        for (const child of Array.from(cell.querySelectorAll<HTMLElement>('[title], input, button'))) {
          desired = Math.max(desired, child.scrollWidth + 14);
        }
      }
    }
    columnPrefs.setWidth(id, desired);
  };

  const choose = (candidate: V25WorkbenchCandidate, choices: Record<string, string>) => {
    if (!picker) return;
    // 確定経路でも区分・販売可否・元のカテゴリーを検証し、画面側の絞り込みのみに依存しない。
    if (candidate.section !== picker.section || candidate.retired || candidate.unavailable || !candidate.categoryId.trim()) {
      onNotice({ tone: 'danger', text: 'この区分では選択できない商品です。商品台帳をご確認ください。' });
      return;
    }
    if (picker.targetKey) {
      const target = state.slots.find((slot) => slot.key === picker.targetKey);
      const original = target ? candidateById.get(target.option_id) : null;
      if (!original?.categoryId.trim() || original.section !== picker.section || original.categoryId !== candidate.categoryId) {
        onNotice({ tone: 'danger', text: '元の商品のカテゴリーを確認できないか、異なるカテゴリーの商品です。同じカテゴリーの商品を選択してください。' });
        return;
      }
    }
    if (picker.targetKey) {
      const target = state.slots.find((slot) => slot.key === picker.targetKey);
      const original = target ? candidateById.get(target.option_id) : null;
      if (!target || !original) return;
      const issue = v25ProductReplacementIssue(
        target, original, candidate, state.slots,
        (id) => candidateById.get(id),
        (categoryId) => candidates.filter((item) => item.categoryId === categoryId),
      );
      if (issue) {
        onNotice({ tone: 'danger', text: issue });
        return; // 選択ポップアップを保持。数量や商品を一切変更しない。
      }
      if (target.option_id === candidate.id) {
        // 同一商品：色・仕様のみ更新し、数量・価格モード・位置・候補・工事項目を変更しない。
        setSlot(target.key, v25ProductChangePatch(target, candidate, choices, (id) => candidateById.get(id)));
        setPicker(null);
        return;
      }
    }
    // 別途工事は販売費・経費・掛率を掛けない（自動にできない）。Web では金額を確定しないので別途見積にする
    const priceMode: V25SlotPriceMode = candidate.section === 'sitework' ? 'por' : 'auto';
    // 初期数量は新規追加にのみ使う。既存行の数量は変更・換算しない。
    const initialQuantity = String(standardSlotQuantity(candidate.categoryCode));
    if (picker.targetKey) {
      const target = state.slots.find((slot) => slot.key === picker.targetKey);
      if (target?.slot_code.trim()) {
        // 色やサイズだけの変更では位置の変更候補を落とさない。
        if (target.option_id === candidate.id) {
          setSlot(target.key, { variant_choices: { ...choices } });
          setPicker(null);
          return;
        }
        const previous = candidateById.get(target.option_id);
        if (previous && previous.categoryId !== candidate.categoryId) {
          onNotice({ tone: 'danger', text: '位置が設定された行は同じカテゴリーの商品へ入れ替えてください。別カテゴリーにする場合は位置を解除してください。' });
          return;
        }
        // 同じ位置の標準品入替は、候補の見直しまで確定操作を保留する。
        setReplacementDraft({ slotKey: target.key, candidate, choices: { ...choices }, selectableIds: [] });
        setPicker(null);
        return;
      }
      // 入れ替えは数量・位置・行順・工事項目を保持。変更候補だけ同カテゴリに整理する。
      if (target) {
        setSlot(target.key, v25ProductChangePatch(target, candidate, choices, (id) => candidateById.get(id)));
      }
    } else {
      const addedKey = newKey('slot');
      setViewOrder((current) => v25InsertMixedRow(
        v25ReconcileMixedRowOrder(current.length ? current : persistedMixedOrder, state, sectionOf),
        { kind: 'slot', key: addedKey, section: picker.section }, picker.insertAfter ?? null
      ));
      setState((current) => ({
        ...current,
        slots: [
          ...current.slots,
          {
            key: addedKey,
            baseline_key: null,
            option_id: candidate.id,
            variant_choices: { ...choices },
            quantity: initialQuantity,
            price_mode: priceMode,
            manual_unit_price: '',
            // 位置・用途の選択枠（v2.5 PR-S1）。新しい行はカテゴリー単位の枠から始める
            slot_code: '',
            slot_label: '',
            selectable_option_ids: [],
            // 工事項目は未設定から始め、カテゴリーからの自動の値で表示・保存する（2026-11-16 の先方の依頼。プルダウンで変えられる）
            work_item: '',
          },
        ],
      }));
      revealAddedRow(picker.section, addedKey);
    }
    setPicker(null);
  };

  const openVariant = (slot: V25SlotRow) =>
    setVariantEditor({ slotKey: slot.key, choices: { ...slot.variant_choices } });
  const applyVariant = () => {
    if (!variantEditor || readOnly) return;
    setSlot(variantEditor.slotKey, { variant_choices: { ...variantEditor.choices } });
    setVariantEditor(null);
  };
  const variantSlot = variantEditor ? state.slots.find((slot) => slot.key === variantEditor.slotKey) : null;
  const variantCandidate = variantSlot ? candidateById.get(variantSlot.option_id) : undefined;

  // 位置名と候補は一時編集し、確定時だけ既存の行へ反映する。
  const openPosition = (slot: V25SlotRow) => {
    if (positionActionsLocked) return;
    setPositionFor(slot.key);
    setPositionDraft({ slot_code: slot.slot_code, slot_label: slot.slot_label, selectable_option_ids: [...slot.selectable_option_ids] });
    setRemovePositionOnConfirm(false);
    setPositionError(null);
  };
  const closePosition = () => {
    setSelectableFor(null);
    setSelectableDraftIds(null);
    setPositionFor(null);
    setPositionDraft(null);
    setRemovePositionOnConfirm(false);
    setPositionError(null);
  };
  const updatePosition = (patch: Partial<Pick<V25SlotRow, 'slot_code' | 'slot_label' | 'selectable_option_ids'>>) => {
    setRemovePositionOnConfirm(false);
    setPositionError(null);
    setPositionDraft((current) => current ? { ...current, ...patch } : null);
  };
  const toggleSelectable = (optionId: string) => {
    setRemovePositionOnConfirm(false);
    setPositionError(null);
    setPositionDraft((current) => current ? {
      ...current,
      selectable_option_ids: current.selectable_option_ids.includes(optionId)
        ? current.selectable_option_ids.filter((id) => id !== optionId)
        : [...current.selectable_option_ids, optionId],
    } : null);
  };
  const positionSlot = positionFor ? state.slots.find((slot) => slot.key === positionFor) : null;
  const positionCandidate = positionSlot ? candidateById.get(positionSlot.option_id) : undefined;
  const positionLabelSuggestions = v25PositionLabelSuggestions(positionCandidate?.categoryCode);
  const confirmPosition = () => {
    if (readOnly || pending || !positionFor || !positionDraft) return;
    const candidateOf = (id: string) => candidateById.get(id);
    const result = removePositionOnConfirm
      ? clearV25Position(state, positionFor)
      : updateV25Position(state, positionFor, positionDraft.slot_label,
        positionDraft.selectable_option_ids, candidateOf);
    if (result.error) { setPositionError(result.error); return; }
    setState(result.state);
    closePosition();
  };
  // 明細上の位置名変更は位置ラベル以外の情報を変更しない。
  const commitInlinePositionLabel = () => {
    if (!positionLabelEditor || readOnly || pending) return;
    const result = renameV25Position(state, positionLabelEditor.slotKey, positionLabelEditor.label,
      (id) => candidateById.get(id));
    if (result.error) {
      setPositionLabelEditor((current) => current ? { ...current, error: result.error } : null);
      return;
    }
    setState(result.state);
    setPositionLabelEditor(null);
  };
  const confirmDuplicatePosition = () => {
    if (!duplicateFor || readOnly || pending) return;
    const addedKey = newKey('slot');
    const result = addV25PositionRow(state, duplicateFor.slotKey, addedKey, duplicateFor.label, [],
      (id) => candidateById.get(id));
    if (result.error) {
      setDuplicateFor((current) => current ? { ...current, error: result.error } : null);
      return;
    }
    const original = state.slots.find((slot) => slot.key === duplicateFor.slotKey);
    const section = original ? sectionOf(original.option_id) : undefined;
    if (section) setViewOrder((current) => v25InsertMixedRow(
      v25ReconcileMixedRowOrder(current.length ? current : persistedMixedOrder, state, sectionOf),
      { kind: 'slot', key: addedKey, section },
      { kind: 'slot', key: duplicateFor.slotKey, section }
    ));
    setState(result.state);
    setDuplicateFor(null);
  };
  const duplicateSource = duplicateFor ? state.slots.find((slot) => slot.key === duplicateFor.slotKey) : null;

  const replacementSource = replacementDraft
    ? state.slots.find((slot) => slot.key === replacementDraft.slotKey) : null;
  const replacementChoices = replacementDraft && replacementSource
    ? [replacementSource.option_id, ...replacementSource.selectable_option_ids].map((id) => candidateById.get(id))
      .filter((candidate): candidate is V25WorkbenchCandidate => Boolean(candidate &&
        candidate.id !== replacementDraft.candidate.id && !candidate.retired && !candidate.unavailable &&
        candidate.categoryId === replacementDraft.candidate.categoryId))
    : [];
  const confirmReplacement = () => {
    if (!replacementDraft || readOnly) return;
    const result = replaceV25PositionStandard(
      state, replacementDraft.slotKey, replacementDraft.candidate,
      replacementDraft.choices, replacementDraft.selectableIds, (id) => candidateById.get(id)
    );
    if (result.error) { onNotice({ tone: 'danger', text: result.error }); return; }
    setState(result.state);
    setReplacementDraft(null);
  };
  const jumpToPosition = (key: string) => {
    const slot = state.slots.find((row) => row.key === key);
    if (!slot) return;
    const section = sectionOf(slot.option_id);
    if (section) setCollapsed((current) => { const next = new Set(current); next.delete(section); return next; });
    setJumpToKey({ key });
  };
  const openSelectable = (key: string) => {
    setSelectableDraftIds([...(positionDraft?.selectable_option_ids ?? [])]);
    setSelectableFor(key);
    setSelectableWindowType('');
    setSelectableQuery('');
  };
  const closeSelectable = () => {
    setSelectableFor(null);
    setSelectableDraftIds(null);
    setSelectableWindowType('');
    setSelectableQuery('');
  };
  const applySelectable = () => {
    // 子画面の候補は「決定」まで親の位置Draftへ反映しない。
    if (selectableDraftIds) updatePosition({ selectable_option_ids: [...selectableDraftIds] });
    closeSelectable();
  };
  const toggleSelectableDraft = (optionId: string) => {
    setSelectableDraftIds((current) => current
      ? current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]
      : null);
  };
  const selectableDirty = Boolean(selectableWindowType || selectableQuery ||
    JSON.stringify(selectableDraftIds ?? []) !== JSON.stringify(positionDraft?.selectable_option_ids ?? []));
  const selectableSlot = selectableFor ? (state.slots.find((slot) => slot.key === selectableFor) ?? null) : null;
  const selectableBase = selectableSlot ? candidateById.get(selectableSlot.option_id) : undefined;
  // 選べる商品の候補：標準の商品と同じカテゴリーの、販売中でこの仕様で選べる商品（DB の保存と公開の確認と同じ）
  const selectableOptions = useMemo(
    () =>
      selectableBase
        ? candidates.filter(
            (candidate) => candidate.id !== selectableBase.id && !candidate.retired && !candidate.unavailable && candidate.categoryId === selectableBase.categoryId
          )
        : [],
    [candidates, selectableBase]
  );
  const selectableWindowTypes = useMemo(() => {
    const map = new Map<string, string>();
    for (const candidate of selectableOptions) if (candidate.windowTypeCode) map.set(candidate.windowTypeCode, candidate.windowTypeLabel ?? candidate.windowTypeCode);
    return [...map.entries()];
  }, [selectableOptions]);
  const selectableShown = useMemo(() => {
    const query = selectableQuery.trim().toLocaleLowerCase('ja-JP');
    return selectableOptions.filter(
      (candidate) =>
        (!selectableWindowType || (selectableWindowType === NO_WINDOW_TYPE ? !candidate.windowTypeCode : candidate.windowTypeCode === selectableWindowType)) &&
        (!query || [candidate.name, candidate.manufacturer, candidate.modelNo].join(' ').toLocaleLowerCase('ja-JP').includes(query))
    );
  }, [selectableOptions, selectableWindowType, selectableQuery]);

  const addLine = (
    section: StandardLineSectionCode,
    insertAfter: V25MixedRowRef | null = null,
    workGroupLabel = ''
  ) => {
    if (readOnly || positionActionsLocked || groupEditor !== null) return;
    const addedKey = newKey('line');
    setViewOrder((current) => v25InsertMixedRow(
      v25ReconcileMixedRowOrder(current.length ? current : persistedMixedOrder, state, sectionOf),
      { kind: 'line', key: addedKey, section }, insertAfter
    ));
    setState((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          key: addedKey,
          line_key: null,
          section_code: section,
          group_label: workGroupLabel === '工事項目未分類の商品' ? '' : workGroupLabel,
          name: '',
          quantity: '1',
          unit: '式',
          // 金額が決まっていない明細は別途見積（0 円にしない）
          price_mode: 'por',
          unit_price: '',
          remark: '',
          review_required: false,
        },
      ],
    }));
    revealAddedRow(section, addedKey);
  };

  const run = (task: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) => {
    if (pending || positionInputActive) return;
    startTransition(async () => {
      const result = await task();
      onNotice(result.ok ? { tone: 'success', text: result.message } : { tone: 'danger', text: result.error });
      if (result.ok) router.refresh();
    });
  };

  const save = () => {
    if (pending || positionInputActive) return;
    // 率は % で入力する。読めない入力は % の文で案内する（範囲は validateV25EditorState・DB で確かめる）
    const problem = percentProblem(percents) ?? validateV25EditorState(state, sectionOf);
    if (problem) {
      onNotice({ tone: 'danger', text: problem });
      return;
    }
    // 工事項目（2026-11-16 の先方の依頼）：未設定の商品の行は、表示しているカテゴリーからの自動の値で保存する
    const toSave: V25EditorState = { ...state, slots: state.slots.map((slot) => ({ ...slot, work_item: workItemOf(slot) })) };
    // #686/#687: 商品と手入力の表示順で row_order を全行（1始まり）へ採番。
    // 工事項目を自動で埋める保存経路はそのまま、金額・数量は変更しない。
    const orderedToSave = v25WithRowOrder(toSave, renderedMixedOrder);
    run(() => saveStandardEstimateV25DraftAction({
      revision_id: revisionId, expected_lock_version: lockVersion, payload: buildV25SavePayload(orderedToSave),
    }));
  };

  const toggleSection = (code: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });


  const mixedRowControls = (
    row: V25MixedRowRef,
    groups: readonly V25MoveGroup[],
    group: V25MoveGroup
  ) => {
    const locked = rowMoveLocked;
    const up = v25ArrowRowTarget(mixedOrder, groups, row, -1);
    const down = v25ArrowRowTarget(mixedOrder, groups, row, 1);
    const canUp = Boolean(up && plannedMove(row, up.row, up.side, groups));
    const canDown = Boolean(down && plannedMove(row, down.row, down.side, groups));
    return (
      <span className="inline-flex w-[5.4rem] shrink-0 items-center gap-px" data-testid="v25-wb-row-order-actions">
        <V25RowDragHandle rowId={v25MixedRowIdentity(row)} section={row.section} disabled={locked}
          onPreview={(targetId, side) => previewRowMove(row, targetId, side, groups)}
          onDrop={(targetId, side) => {
            const target = mixedOrder.find((candidate) => v25MixedRowIdentity(candidate) === targetId);
            if (target) applyRowMove(row, target, side, groups);
          }} />
        <button type="button" data-testid="v25-wb-row-up" aria-label="この行を上へ移動"
          title="同じ工事項目内、または直前の工事項目へ移動"
          className="rounded px-0.5 text-xs text-emerald-900 hover:bg-emerald-100 disabled:opacity-30"
          disabled={locked || !canUp}
          onClick={() => moveViewRow(row, -1, groups)}>↑</button>
        <button type="button" data-testid="v25-wb-row-down" aria-label="この行を下へ移動"
          title="同じ工事項目内、または直後の工事項目へ移動"
          className="rounded px-0.5 text-xs text-emerald-900 hover:bg-emerald-100 disabled:opacity-30"
          disabled={locked || !canDown}
          onClick={() => moveViewRow(row, 1, groups)}>↓</button>
        <V25WorkbenchRowMenu testId="v25-wb-row-insert" label="この行の直下に追加" triggerText="＋" disabled={locked}>
          <button type="button" data-testid="v25-wb-insert-slot" disabled={locked}
            className="block w-full px-3 py-1.5 text-left hover:bg-slate-50 disabled:opacity-40"
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open');
              rememberRowMenuOpener(event.currentTarget);
              setPickerDirty(false); setPicker({ section: row.section, targetKey: null, insertAfter: row });
            }}>直下に商品台帳から追加</button>
          <button type="button" data-testid="v25-wb-insert-line" disabled={locked}
            className="block w-full px-3 py-1.5 text-left hover:bg-slate-50 disabled:opacity-40"
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open');
              addLine(row.section, row, group.label);
            }}>直下に手入力明細を追加</button>
        </V25WorkbenchRowMenu>
      </span>
    );
  };

  // Excel明細の入力セルだけにTab・Enter移動を適用し、保存やポップアップは変更しない。
  const handleExcelNavigation = (event: ReactKeyboardEvent<HTMLTableElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.dataset.v25ExcelCol || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const rows = Array.from(event.currentTarget.tBodies[0]?.rows ?? []);
    const row = target.closest('tr');
    const index = row ? rows.indexOf(row) : -1;
    let next: HTMLInputElement | null = null;
    if (event.key === 'Enter' && index >= 0) {
      const direction = event.shiftKey ? -1 : 1;
      for (let i = index + direction; i >= 0 && i < rows.length; i += direction) {
        next = Array.from(rows[i].querySelectorAll<HTMLInputElement>('input[data-v25-excel-col]:not([disabled])'))
          .find((input) => input.dataset.v25ExcelCol === target.dataset.v25ExcelCol) ?? null;
        if (next) break;
      }
    } else if (event.key === 'Tab') {
      const inputs = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('tbody input[data-v25-excel-col]:not([disabled])'));
      next = inputs[inputs.indexOf(target) + (event.shiftKey ? -1 : 1)] ?? null;
    }
    if (next) { event.preventDefault(); next.focus(); next.select(); }
  };

  const sectionHeader = (code: string, label: string, actions?: ReactNode) => {
    const result = sectionResult(code);
    return (
      <tr className="bg-emerald-900 text-white" data-testid={`v25-section-${code}`}>
        <td colSpan={columnCount} className="border-y border-emerald-800 px-2 py-0.5">
          <div className="flex min-w-0 items-center justify-between gap-2 text-[11px]" data-testid={`v25-wb-section-heading-${code}`}>
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" className="flex shrink-0 items-center gap-1.5 text-left text-[11px] font-semibold text-white"
                onClick={() => toggleSection(code)} aria-expanded={!collapsed.has(code)}>
                <span aria-hidden="true">{collapsed.has(code) ? '▸' : '▾'}</span>
                {label}
              </button>
              {actions}
              {result?.has_por && <span className="hidden text-[10px] text-amber-100 sm:inline">別途見積を含む</span>}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap tabular-nums" data-testid={`v25-wb-section-money-${code}`}>
              <span className="text-emerald-200">小計</span>
              <strong className="font-bold text-white">{result?.subtotal !== null && result?.subtotal !== undefined
                ? yen(result.subtotal) : result ? `${yen(result.priced_subtotal)}＋未確定` : '—'}</strong>
              {result?.expense_target && (
                <>
                  <span className="border-l border-emerald-600 pl-2 text-emerald-200">経費</span>
                  <strong className="font-bold text-white">{result.expense !== null ? yen(result.expense) : '未確定'}</strong>
                </>
              )}
            </div>
          </div>
        </td>
      </tr>
    );
  };

  // 区分末尾の小計は全列結合。可視列や列幅によって金額が別の列へずれない。
  // 数字は従来のv2.5計算結果をそのまま表示し、区分の経費は既存見出し側で扱う。
  const sectionSubtotal = (code: string, label: string) => {
    const result = sectionResult(code);
    return (
      <tr className="border-y-2 border-emerald-800 bg-lime-100 text-slate-800" data-testid={`v25-section-subtotal-${code}`}>
        <td colSpan={columnCount} className="px-2 py-1">
          <div className="flex w-full items-center justify-end gap-3 text-right tabular-nums" data-testid={`v25-section-subtotal-layout-${code}`}>
            <span className="font-semibold whitespace-nowrap">{label} 小計（税別）</span>
            {result?.has_por && <span className="text-amber-800">別途見積を含む</span>}
            <strong className="min-w-[7rem] text-right font-semibold whitespace-nowrap" data-testid={`v25-section-subtotal-value-${code}`}>
              {result ? result.subtotal !== null ? yen(result.subtotal) : '未確定' : '—'}
            </strong>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <section className="space-y-3" data-testid="standard-estimate-v25-workbench">
      {dropPreview && <div data-testid="v25-wb-drop-indicator" role="status" aria-label="ここに移動"
        className="pointer-events-none fixed z-[48] h-[3px] bg-emerald-600 shadow-[0_0_0_1px_white]"
        style={{ top: dropPreview.top - 1, left: dropPreview.left, width: dropPreview.width }}>
        <span className="absolute -top-5 left-1 rounded bg-emerald-700 px-2 py-0.5 text-[10px] font-semibold text-white">ここへ移動</span>
      </div>}

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {!readOnly && dirty && <p className="text-xs font-semibold text-amber-800" data-testid="v25-wb-unsaved-position">明細に反映済み・下書き未保存（保存は「下書きを保存」から）</p>}
      {!readOnly && unsavedAutoWorkItems > 0 && (
        <p className="text-xs text-amber-800" data-testid="v25-wb-work-item-auto-unsaved">
          工事項目が未設定の商品 {unsavedAutoWorkItems} 件は、カテゴリーから工事項目を入れて表示しています。「下書きを保存」で保存すると、見積書の摘要にも反映されます。
        </p>
      )}
      {positionMixes.length > 0 && (
        <div className="space-y-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs" data-testid="v25-wb-position-mixed">
          {positionMixes.map((mix) => (
            <div key={mix.categoryId} className="flex flex-wrap items-center gap-2">
              <span>{mix.categoryName}{mix.total}行のうち{mix.unsetKeys.length}行が位置未設定。公開には混在の解消が必要です。</span>
              {mix.unsetKeys.map((key, index) => (
                <button type="button" className="font-semibold text-navy underline" key={key} onClick={() => jumpToPosition(key)}>
                  未設定の行{index + 1}へ移動
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-t-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px]" data-testid="v25-wb-compact-settings">
        {(['sales_fee_rate', 'expense_rate', 'markup_rate'] as const).map((key) => (
          <div key={key} className="flex items-center gap-1.5">
            <label htmlFor={`v25-wb-rate-${key}`} className="whitespace-nowrap text-slate-600">{RATE_LABEL[key]}（%）</label>
            <div className="relative">
              <Input id={`v25-wb-rate-${key}`} value={percents[key]} disabled={readOnly} inputMode="decimal"
                className="h-7 min-h-7! w-[5rem] rounded border-slate-300 bg-white pr-5 text-right text-[11px]" data-testid={`v25-wb-${key}`}
                onChange={(event) => setRate(key, event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    stepRate(key, event.key === 'ArrowUp' ? 1 : -1);
                  }
                }} />
              <span className="absolute inset-y-0 right-0 flex w-[18px] flex-col border-l border-slate-300" aria-label={`${RATE_LABEL[key]}の増減`}>
                <button type="button" aria-label={`${RATE_LABEL[key]}を1%増やす`} title="1%増やす" disabled={readOnly || v25StepPercent(percents[key], 1, key) === percents[key]}
                  className="flex h-1/2 items-center justify-center rounded-tr-sm text-[9px] leading-none hover:bg-slate-100 disabled:opacity-40"
                  onClick={() => stepRate(key, 1)}>▲</button>
                <button type="button" aria-label={`${RATE_LABEL[key]}を1%減らす`} title="1%減らす" disabled={readOnly || v25StepPercent(percents[key], -1, key) === percents[key]}
                  className="flex h-1/2 items-center justify-center rounded-br-sm border-t border-slate-200 text-[9px] leading-none hover:bg-slate-100 disabled:opacity-40"
                  onClick={() => stepRate(key, -1)}>▼</button>
              </span>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <label htmlFor="v25-wb-adjustment" className="whitespace-nowrap text-slate-600">調整額（税別・円）</label>
          <Input id="v25-wb-adjustment" value={state.adjustment} disabled={readOnly} inputMode="numeric"
            className="h-7 min-h-7! w-[7rem] rounded border-slate-300 bg-white text-right text-[11px]" data-testid="v25-wb-adjustment"
            onChange={(event) => setState((current) => ({ ...current, adjustment: event.target.value }))} />
        </div>
        <div className="flex min-w-[13rem] flex-[2_1_16rem] items-center gap-1.5">
          <label htmlFor="v25-wb-adjustment-reason" className="shrink-0 whitespace-nowrap text-slate-600">調整理由</label>
          <Input id="v25-wb-adjustment-reason" value={state.adjustment_reason} disabled={readOnly}
            className="h-7 min-h-7! min-w-0 flex-1 rounded border-slate-300 bg-white text-[11px]"
            onChange={(event) => setState((current) => ({ ...current, adjustment_reason: event.target.value }))} />
        </div>
        <span className="text-[10px] text-slate-500">列幅は明細行の列境界（右端6px）でもドラッグできます</span>
        <div className="relative z-50 ml-auto shrink-0" data-testid="v25-wb-column-display-position">
          <V25ColumnDisplayMenu prefs={columnPrefs.prefs} setVisible={columnPrefs.setVisible}
            setCostVisible={columnPrefs.setCostVisible} showAll={columnPrefs.showAll} reset={columnPrefs.reset} />
        </div>
      </div>


      <div ref={gridRef} className="overflow-x-auto rounded-b-md border border-slate-300 bg-white" data-testid="v25-excel-grid-scroll">
        <table ref={tableRef} className="table-fixed w-full border-collapse text-[11px]"
          style={{ minWidth: `${Math.ceil(v25GridWidth(columnPrefs.prefs) / 16) * 16}px` }}
          data-testid="v25-workbench-grid" onKeyDown={handleExcelNavigation}>
          <thead className="bg-[#E6EDF3] text-[12px] font-bold leading-4 text-[#24374B]" data-testid="v25-wb-column-header">
            <tr>
              <th data-v25-column="name" style={{ width: columnPrefs.prefs.widths.name }} className="h-[34px] sticky left-0 top-0 z-40 w-[20rem] border-b border-r border-[#CBD5E1] bg-[#E6EDF3] px-2 py-1 text-left font-bold">品名
                <V25WidthHandle id="name" width={columnPrefs.prefs.widths.name}
                  onResizeStart={columnPrefs.startResize} onWidth={columnPrefs.setWidth} onAutoWidth={autoWidth} />
              </th>
              <th data-v25-column="quantity" style={{ width: columnPrefs.prefs.widths.quantity }} className="h-[34px] sticky top-0 z-30 w-14 border-b border-r border-[#CBD5E1] bg-[#E6EDF3] px-1 py-1 text-right font-bold">数量
                <V25WidthHandle id="quantity" width={columnPrefs.prefs.widths.quantity}
                  onResizeStart={columnPrefs.startResize} onWidth={columnPrefs.setWidth} onAutoWidth={autoWidth} />
              </th>
              <th data-v25-column="unit" style={{ width: columnPrefs.prefs.widths.unit }} className="h-[34px] sticky top-0 z-30 w-14 border-b border-r border-[#CBD5E1] bg-[#E6EDF3] px-1 py-1 text-left font-bold">単位
                <V25WidthHandle id="unit" width={columnPrefs.prefs.widths.unit}
                  onResizeStart={columnPrefs.startResize} onWidth={columnPrefs.setWidth} onAutoWidth={autoWidth} />
              </th>
              {visible.cost_unit && <th data-v25-column="cost_unit" style={{ width: columnPrefs.prefs.widths.cost_unit }} className="h-[34px] sticky top-0 z-30 w-[5.75rem] border-b border-r border-[#CBD5E1] bg-[#E6EDF3] px-1 py-1 text-right font-bold">原価単価
                <V25WidthHandle id="cost_unit" width={columnPrefs.prefs.widths.cost_unit}
                  onResizeStart={columnPrefs.startResize} onWidth={columnPrefs.setWidth} onAutoWidth={autoWidth} />
              </th>}
              {visible.cost_amount && <th data-v25-column="cost_amount" style={{ width: columnPrefs.prefs.widths.cost_amount }} className="h-[34px] sticky top-0 z-30 w-[5.75rem] border-b border-r border-[#CBD5E1] bg-[#E6EDF3] px-1 py-1 text-right font-bold">原価金額
                <V25WidthHandle id="cost_amount" width={columnPrefs.prefs.widths.cost_amount}
                  onResizeStart={columnPrefs.startResize} onWidth={columnPrefs.setWidth} onAutoWidth={autoWidth} />
              </th>}
              {visible.sale_unit && <th data-v25-column="sale_unit" style={{ width: columnPrefs.prefs.widths.sale_unit }} className="h-[34px] sticky top-0 z-30 w-[5.75rem] border-b border-r border-[#CBD5E1] bg-[#E6EDF3] px-1 py-1 text-right font-bold">売価単価
                <V25WidthHandle id="sale_unit" width={columnPrefs.prefs.widths.sale_unit}
                  onResizeStart={columnPrefs.startResize} onWidth={columnPrefs.setWidth} onAutoWidth={autoWidth} />
              </th>}
              <th data-v25-column="sale_amount" style={{ width: columnPrefs.prefs.widths.sale_amount }} className="h-[34px] sticky top-0 z-30 w-[5.75rem] border-b border-r border-[#CBD5E1] bg-[#E6EDF3] px-1 py-1 text-right font-bold">売価金額
                <V25WidthHandle id="sale_amount" width={columnPrefs.prefs.widths.sale_amount}
                  onResizeStart={columnPrefs.startResize} onWidth={columnPrefs.setWidth} onAutoWidth={autoWidth} />
              </th>
              {visible.gross && <th data-v25-column="gross" style={{ width: columnPrefs.prefs.widths.gross }} className="h-[34px] sticky top-0 z-30 w-[5.75rem] border-b border-r border-[#CBD5E1] bg-[#E6EDF3] px-1 py-1 text-right font-bold">粗利
                <V25WidthHandle id="gross" width={columnPrefs.prefs.widths.gross}
                  onResizeStart={columnPrefs.startResize} onWidth={columnPrefs.setWidth} onAutoWidth={autoWidth} />
              </th>}
              {visible.note && <th data-v25-column="note" style={{ width: columnPrefs.prefs.widths.note }} className="h-[34px] sticky top-0 z-30 w-[8rem] border-b border-r border-[#CBD5E1] bg-[#E6EDF3] px-1 py-1 text-left font-bold">仕様・備考
                <V25WidthHandle id="note" width={columnPrefs.prefs.widths.note}
                  onResizeStart={columnPrefs.startResize} onWidth={columnPrefs.setWidth} onAutoWidth={autoWidth} />
              </th>}
              <th data-v25-column="actions" style={{ width: columnPrefs.prefs.widths.actions }} className="h-[34px] sticky right-0 top-0 z-40 w-[4.5rem] border-b border-l border-[#CBD5E1] bg-[#E6EDF3] px-1 py-1 text-center font-bold">操作
                <V25WidthHandle id="actions" width={columnPrefs.prefs.widths.actions}
                  onResizeStart={columnPrefs.startResize} onWidth={columnPrefs.setWidth} onAutoWidth={autoWidth} />
              </th>
            </tr>
          </thead>
          <tbody onMouseDownCapture={startBodyResize} onMouseMoveCapture={showBodyResizeCursor}
            onMouseLeave={() => { if (resizeHover.current) resizeHover.current.style.removeProperty('cursor'); resizeHover.current = null; }}
            data-testid="v25-wb-resizable-body">
            {sectionHeader('base', '本体（本体マスター）', (
              <span className="flex flex-wrap items-center gap-2 text-[10px]" data-testid="v25-wb-base-reference">
                <span className="rounded border border-emerald-700 px-1 py-0.5 text-emerald-100">参照専用</span>
                {baseMasterReference ? (
                  <Link href={`/admin/base-masters/${encodeURIComponent(baseMasterReference.masterId)}`}
                    className="font-medium text-white underline underline-offset-2" data-testid="v25-wb-base-master-link"
                    title="参照中の本体マスター。現在の公開版と異なる可能性があります">
                    本体マスターを開く（参照版：第{baseMasterReference.revisionVersion}版）
                  </Link>
                ) : (
                  <Link href="/admin/base-masters" className="text-emerald-100 underline underline-offset-2"
                    data-testid="v25-wb-base-master-fallback">本体マスター一覧（参照元の版番号は未取得）</Link>
                )}
              </span>
            ))}
            {!collapsed.has('base') &&
              baseLines.map((line) => {
                const result = resultByKey.get(`base:${line.id}`);
                const display = v25DisplayedCostAndGross(result, line.quantity);
                return (
                  <tr key={line.id} className="border-b border-slate-200 bg-slate-100 text-slate-700" data-testid="v25-wb-base-row">
                    <td className="sticky left-0 z-10 border-r border-slate-200 bg-slate-100 px-2 py-px">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="max-w-[5rem] shrink-0 truncate text-[10px] text-slate-600" title={line.section}>{line.section}</span>
                        <span className="min-w-0 flex-1 truncate" title={line.name}>{line.name}</span>
                      </div>
                    </td>
                    <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right tabular-nums">{line.quantity}</td>
                    <td className="border-r border-slate-200 bg-slate-100 px-1 py-px">{line.unit ?? ''}</td>
                    {visible.cost_unit && <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right tabular-nums text-slate-500">{yen(result?.cost_unit_price)}</td>}
                    {visible.cost_amount && <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right tabular-nums text-slate-500">{yen(display.costAmount)}</td>}
                    {visible.sale_unit && <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right tabular-nums">{yen(result?.sale_unit_price)}</td>}
                    <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right tabular-nums font-semibold text-slate-900" data-testid="v25-wb-base-sale-amount">{yen(result?.amount)}</td>
                    {visible.gross && <td className={`border-r border-slate-200 bg-slate-100 px-1 py-px text-right tabular-nums ${v25GrossToneClass(display.gross)}`}>{yen(display.gross)}</td>}
                    {visible.note && <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-muted"><span className="block truncate" title="本体マスターの明細">本体マスター</span></td>}
                    <td className="sticky right-0 z-10 bg-slate-100 px-1 py-px text-center text-slate-500">参照</td>
                  </tr>
                );
              })}
            {!collapsed.has('base') && sectionSubtotal('base', '本体')}

            {LINE_SECTIONS.map((code) => {
              const slots = state.slots.filter((slot) => sectionOf(slot.option_id) === code);
              const lines = state.lines.filter((line) => line.section_code === code);
              // 商品のカテゴリーと、手入力明細の既存group_labelから表示用の小見出しを作る。
              // 保存済みのsection_code・行順序・group_labelは書き換えない。
              const workGroups = v25WorkGroupsForDisplay(
                slots, lines, (optionId) => candidateById.get(optionId)?.categoryCode,
                (line) => line.group_label, { modelSlug, specCode, sectionCode: code },
                workItemOf,
              );
              return (
                <Fragment key={code}>
                  {sectionHeader(
                    code,
                    STANDARD_SECTION_LABEL[code],
                    readOnly ? undefined : (
                      <V25WorkbenchRowMenu testId={`v25-wb-add-row-${code}`}
                        label={`${STANDARD_SECTION_LABEL[code]}へ行を追加`} triggerText="＋ 行を追加">
                        <button type="button" className="block w-full px-3 py-1.5 text-left text-ink hover:bg-slate-50"
                          onClick={(event) => {
                            rememberRowMenuOpener(event.currentTarget);
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            setPickerDirty(false); setPicker({ section: code, targetKey: null });
                          }}>商品台帳から追加</button>
                        <button type="button" className="block w-full px-3 py-1.5 text-left text-ink hover:bg-slate-50"
                          onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            addLine(code);
                          }}>直接入力</button>
                      </V25WorkbenchRowMenu>
                    )
                  )}
                  {!collapsed.has(code) && workGroups.map((workGroup) => (
                    <Fragment key={workGroup.key}>
                      <tr className="border-y border-emerald-200 bg-emerald-100 text-slate-800"
                        data-testid="v25-work-item-heading" data-work-item={workGroup.key}>
                        <td colSpan={columnCount} className="px-3 py-1 text-[11px] font-semibold">
                          {workGroup.label}
                        </td>
                      </tr>
                      {v25MixedRowsForWorkGroup(mixedOrder, workGroup).map((rowRef) => {
                      if (rowRef.kind === 'slot') {
                        const slot = workGroup.slots.find((item) => item.key === rowRef.key);
                        if (!slot) return null;
                      const candidate = candidateById.get(slot.option_id);
                      const result = resultByKey.get(calc.lineKeyOf[slot.key] ?? '');
                      const display = v25DisplayedCostAndGross(result, slot.quantity);
                      const missing = incompleteKeys.get(slot.key);
                      const pinnedPreview = previewByIdentity.get(slot);
                      const status: V25CostStatus | null = slot.price_mode !== 'auto' ? null : missing ? 'missing' : pinnedPreview ? slotCostStatus(pinnedPreview) : null;
                      const slotCode = slot.slot_code.trim();
                      const positionAllowed = Boolean(candidate && !candidate.unavailable && canUsePositionSlot(candidate.categoryCode));
                      const isSash = candidate?.categoryCode === 'sash';
                      const isLighting = candidate?.categoryCode === 'lighting';
                      const mixedUnset = !slotCode && positionMixes.some((mix) =>
                        mix.categoryId === candidate?.categoryId && mix.unsetKeys.includes(slot.key));
                      return (
                        <Fragment key={v25MixedRowIdentity(rowRef)}>
                        <tr id={`v25-position-row-${slot.key}`} tabIndex={-1}
                          data-v25-dnd-row={v25MixedRowIdentity(rowRef)} data-v25-dnd-section={code}
                          className={`border-b border-slate-200 align-middle focus:outline-2 focus:outline-offset-[-2px] focus:outline-amber-500 ${dropPreview?.targetId === v25MixedRowIdentity(rowRef) ? 'outline outline-2 outline-emerald-600' : ''}`}
                          data-testid="v25-wb-slot">
                          <td className="sticky left-0 z-10 border-r border-slate-200 bg-slate-100 px-2 py-px">
                            <div className="min-w-0">
                              <div className="flex min-w-0 flex-wrap items-center gap-1">
                                {!readOnly && mixedRowControls(rowRef, workGroups, workGroup)}
                                <span className="max-w-[4.5rem] shrink-0 truncate text-[10px] text-slate-600" title={candidate?.categoryName ?? ''}>{candidate?.categoryName ?? ''}</span>
                                <span className="min-w-0 flex-1 truncate font-medium text-ink" title={[candidate?.name, candidate?.manufacturer, candidate?.modelNo, candidate?.windowTypeLabel].filter(Boolean).join(' ／ ')}>{candidate?.name ?? '（商品が見つかりません）'}</span>
                                {candidate?.unavailable ? <Badge tone="danger">この仕様では選べない商品（削除してください）</Badge> : (candidate?.retired && <Badge tone="warn">販売停止</Badge>)}
                                {(isSash || isLighting) && positionAllowed && (
                                  <button type="button" className="shrink-0 text-[10px] text-navy underline disabled:opacity-50" data-testid="v25-wb-slot-position-toggle"
                                    disabled={positionActionsLocked}
                                    title={positionActionsLocked ? '位置名をEnterで確定するかEscで取り消してください' : undefined}
                                    aria-label="位置を設定" onClick={(event) => { rememberDialogOpener(event.currentTarget); openPosition(slot); }}>位置を設定</button>
                                )}
                                {!readOnly && (
                                  <button type="button"
                                    className="flex size-5 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-emerald-800 hover:border-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700"
                                    title="商品台帳から選ぶ"
                                    aria-label={`${candidate?.name ?? '商品'}を商品台帳から選び直す`}
                                    data-testid="v25-wb-slot-product-picker-icon"
                                    onClick={(event) => { rememberDialogOpener(event.currentTarget); setPickerDirty(false); setPicker({ section: code, targetKey: slot.key }); }}>
                                    <Package className="size-3.5" aria-hidden="true" />
                                  </button>
                                )}
                                {candidate && <span className="sr-only">{[candidate.manufacturer, candidate.modelNo, candidate.windowTypeLabel].filter(Boolean).join(' ／ ')}</span>}
                              </div>
                              {(slotCode || isSash || isLighting) && (
                                <div className="mt-px min-w-0 text-[10px] text-slate-600" data-testid="v25-wb-position-summary">
                                  {slotCode && positionLabelEditor?.slotKey === slot.key && !readOnly ? (
                                    <div className="space-y-0.5" data-testid="v25-wb-inline-position-editor">
                                      <span>設置位置：</span>
                                      <V25PositionNameInput disabled={pending}
                                        testId="v25-wb-inline-position-input"
                                        value={positionLabelEditor.label} placeholder="例：寝室の窓"
                                        onChange={(label) => {
                                          const error = renameV25Position(state, slot.key, label, (id) => candidateById.get(id)).error;
                                          setPositionLabelEditor((current) => current ? { ...current, label, error } : null);
                                        }}
                                        onConfirm={commitInlinePositionLabel}
                                        onCancel={() => setPositionLabelEditor(null)}
                                      />
                                      {positionLabelEditor.error && <p role="alert" className="text-[10px] text-red-700">{positionLabelEditor.error}</p>}
                                      <span className="text-[10px] text-muted">Enterで確定 ／ Escで取消（日本語変換中は確定しません）</span>
                                      <p className="text-[10px] text-amber-800">編集中は保存・行削除・位置設定・別の位置名編集ができません。Enterで確定するかEscで取り消してください。</p>
                                    </div>
                                  ) : (
                                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1">
                                      <span className="shrink-0">設置位置：</span>
                                      {slotCode ? (
                                        <button type="button" className="min-w-0 truncate text-left text-[10px] font-medium text-emerald-900 underline underline-offset-2"
                                          data-testid="v25-wb-slot-position"
                                          disabled={pending || positionInputActive}
                                          aria-label={readOnly ? '位置・選べる商品を設定' : '位置名を直接編集'}
                                          title={positionInputActive
                                            ? '編集中の位置名をEnterで確定するかEscで取り消してください'
                                            : `${slot.slot_label.trim()}（変更候補${slot.selectable_option_ids.length}件）`}
                                          onClick={(event) => {
                                            // 別行を開いて入力途中の位置名を上書きしない。
                                            if (pending || positionInputActive) return;
                                            if (readOnly) { rememberDialogOpener(event.currentTarget); openPosition(slot); }
                                            else setPositionLabelEditor({ slotKey: slot.key, label: slot.slot_label, error: null });
                                          }}>
                                          {slot.slot_label.trim() || '未設定'}
                                        </button>
                                      ) : (
                                        <span className="text-amber-800" data-testid="v25-wb-position-not-set">未設定</span>
                                      )}
                                      {slotCode && <span className="whitespace-nowrap text-slate-500">｜ 変更候補：{slot.selectable_option_ids.length > 0 ? `${slot.selectable_option_ids.length}件` : 'なし'}</span>}
                                    </div>
                                  )}
                                </div>
                              )}
                              {mixedUnset && <span className="block text-[10px] font-semibold text-amber-800" data-testid="v25-wb-position-unset">位置未設定</span>}
                              {status && status !== 'current' && (
                                <div className="mt-0.5" data-testid="v25-wb-slot-cost-alert">
                                  <Badge tone={COST_TONE[status]} title={V25_COST_STATUS_LABEL[status]}>{COST_COMPACT_LABEL[status]}</Badge>
                                </div>
                              )}
                            </div>
                          </td>

                          <td className={`border-r border-slate-200 px-0.5 py-px ${readOnly ? 'bg-slate-100' : 'bg-amber-50'}`}>
                            <Input data-v25-excel-col="qty" value={slot.quantity} disabled={readOnly} inputMode="decimal" aria-label="数量" className="h-6 min-h-6! rounded-sm border-0 bg-transparent px-1 text-right text-[11px] shadow-none focus-visible:ring-1"
                              onChange={(event) => setSlot(slot.key, { quantity: event.target.value })} />
                          </td>
                          <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-slate-800"
                            data-testid="v25-wb-slot-unit"
                            title="商品台帳の販売単位です。単位を変更する場合は台帳の価格・換算条件も確認してください。">
                            {candidate?.priceUnit?.trim() || '—'}
                          </td>
                          {visible.cost_unit && <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right tabular-nums text-slate-500">{yen(result?.cost_unit_price)}</td>}
                          {visible.cost_amount && <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right tabular-nums text-slate-500" data-testid="v25-wb-slot-cost-amount">{yen(display.costAmount)}</td>}
                          {visible.sale_unit && <td className={`border-r border-slate-200 px-0.5 py-px text-right text-slate-800 ${slot.price_mode === 'manual' && !readOnly ? 'bg-amber-50' : 'bg-slate-100'}`} data-testid="v25-wb-slot-price-cell">
                            {slot.price_mode === 'manual' ? (
                              <Input data-v25-excel-col="sale" value={slot.manual_unit_price} disabled={readOnly} inputMode="numeric" aria-label="売価単価"
                                className="h-6 min-h-6! w-full rounded-sm border-0 bg-transparent px-1 text-right text-[11px] shadow-none focus-visible:ring-1"
                                onChange={(event) => setSlot(slot.key, { manual_unit_price: event.target.value })} />
                            ) : slot.price_mode === 'auto' ? (
                              <span className="block truncate px-1 tabular-nums" title={yen(result?.sale_unit_price)}>{yen(result?.sale_unit_price)}</span>
                            ) : (
                              <span className="block px-1 text-[10px] text-amber-800">別途見積</span>
                            )}
                          </td>}
                          <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right tabular-nums font-semibold text-slate-900" data-testid="v25-wb-slot-sale-amount">
                            {slot.price_mode === 'por' ? (
                              <Badge tone="warn">未確定</Badge>
                            ) : unpricedKeys.has(slot.key) ? (
                              <Badge tone="danger">売価未入力</Badge>
                            ) : missing ? (
                              '—'
                            ) : (
                              yen(result?.amount)
                            )}
                          </td>
                          {visible.gross && <td className={`border-r border-slate-200 bg-slate-100 px-1 py-px text-right tabular-nums ${v25GrossToneClass(display.gross)}`} data-testid="v25-wb-slot-gross">{yen(display.gross)}</td>}
                          {visible.note && <td className="border-r border-slate-200 bg-slate-100 px-1 py-px">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-muted" title={v25VariantSummary(candidate, slot.variant_choices)} data-testid="v25-wb-variant-summary">
                                {v25VariantSummary(candidate, slot.variant_choices)}
                              </span>
                              {Boolean(candidate?.variantGroups.length) && (
                                <button type="button" className="shrink-0 text-[0.7rem] text-navy underline" data-testid="v25-wb-variant-open"
                                  onClick={(event) => { rememberDialogOpener(event.currentTarget); openVariant(slot); }}>{readOnly ? '仕様を確認' : '仕様を変更'}</button>
                              )}
                            </div>
                          </td>}

                          <td className="sticky right-0 z-10 bg-slate-100 px-0.5 py-px text-center">
                            {!readOnly && (
                              <div className="flex items-center justify-center gap-2">
                                <V25WorkbenchRowMenu testId="v25-wb-slot-menu" label={(candidate?.name ?? '商品') + 'の操作'}>
                                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                                    onClick={(event) => { rememberRowMenuOpener(event.currentTarget); event.currentTarget.closest('details')?.removeAttribute('open'); setPickerDirty(false); setPicker({ section: code, targetKey: slot.key });  }}>商品台帳から選択</button>
                                  {candidate && candidate.id === slot.option_id && !candidate.retired && !candidate.unavailable && (
                                    <Link href={'/admin/options/' + encodeURIComponent(slot.option_id)}
                                      target="_blank" rel="noopener noreferrer" prefetch={false}
                                      data-testid="v25-wb-slot-edit-catalog"
                                      className="block w-full px-3 py-1.5 text-left text-navy hover:bg-slate-50"
                                      onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); }}>
                                      この商品を台帳で編集 ↗
                                    </Link>
                                  )}
                                  {positionAllowed && slotCode && (
                                    <button type="button" data-testid="v25-wb-duplicate-position"
                                      disabled={pending || positionInputActive}
                                      className="block w-full px-3 py-1.5 text-left hover:bg-slate-50 disabled:opacity-50"
                                      onClick={(event) => {
                                        if (pending || positionInputActive) return;
                                        rememberRowMenuOpener(event.currentTarget);
                                        event.currentTarget.closest('details')?.removeAttribute('open');
                                        setDuplicateFor({ slotKey: slot.key, label: '', error: null });
                                      }}>別の位置に複製</button>
                                  )}
                                  {positionAllowed && (!isSash || Boolean(slotCode)) && (
                                    <button type="button" data-testid="v25-wb-slot-position-menu"
                                      disabled={positionActionsLocked}
                                      className="block w-full px-3 py-1.5 text-left hover:bg-slate-50 disabled:opacity-50"
                                      onClick={(event) => {
                                        if (positionActionsLocked) return;
                                        rememberRowMenuOpener(event.currentTarget);
                                        event.currentTarget.closest('details')?.removeAttribute('open');
                                        openPosition(slot);
                                      }}>位置を設定</button>
                                  )}
                                  {slot.price_mode !== 'manual' && (
                                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                                    onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setSlot(slot.key, { price_mode: 'manual' }); }}>金額を入力する</button>
                                  )}
                                  {slot.price_mode !== 'por' && (
                                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                                    onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setSlot(slot.key, { price_mode: 'por' }); }}>別途見積にする</button>
                                  )}
                                  {code !== 'sitework' && slot.price_mode !== 'auto' && (
                                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                                    onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setSlot(slot.key, { price_mode: 'auto' }); }}>自動計算に戻す</button>
                                  )}
                                <V25RowDeleteButton inMenu
                                  testId="v25-wb-slot-delete" name={candidate?.name || '商品'}
                                  disabled={positionActionsLocked}
                                  onConfirm={() => {
                                    if (positionActionsLocked) return;
                                    setState((current) => deleteV25WorkbenchRow(current, 'slot', slot.key));
                                  }}
                                />
                                </V25WorkbenchRowMenu>
                              </div>
                            )}
                          </td>
                        </tr>
                        </Fragment>
                      );
                      }
                      const line = workGroup.lines.find((item) => item.key === rowRef.key);
                      if (!line) return null;
                      const result = resultByKey.get(calc.lineKeyOf[line.key] ?? '');
                      return (
                        <tr key={v25MixedRowIdentity(rowRef)} id={`v25-manual-row-${line.key}`} tabIndex={-1}
                          data-v25-dnd-row={v25MixedRowIdentity(rowRef)} data-v25-dnd-section={code}
                          className={`border-b border-slate-200 align-middle focus:outline-2 focus:outline-offset-[-2px] focus:outline-amber-500 ${dropPreview?.targetId === v25MixedRowIdentity(rowRef) ? 'outline outline-2 outline-emerald-600' : ''}`}
                          data-testid="v25-wb-line">
                          <td className={`sticky left-0 z-10 border-r border-slate-200 px-1 py-px ${readOnly ? 'bg-slate-100' : 'bg-amber-50'}`}>
                            <div className="flex min-w-0 items-center gap-1">
                              {!readOnly && mixedRowControls(rowRef, workGroups, workGroup)}
                              <Input data-v25-excel-col="name" value={line.name} disabled={readOnly} aria-label="品名" placeholder="品名"
                                className="h-6 min-h-6! min-w-0 flex-1 rounded-sm border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-1"
                                onChange={(event) => setLine(line.key, { name: event.target.value })} />
                            </div>
                            {line.review_required && <div className="px-1" data-testid="v25-wb-line-review-alert"><Badge tone="warn">要見直し</Badge></div>}
                          </td>

                          <td className={`border-r border-slate-200 px-0.5 py-px ${readOnly ? 'bg-slate-100' : 'bg-amber-50'}`}>
                            <Input data-v25-excel-col="qty" value={line.quantity} disabled={readOnly} inputMode="decimal" aria-label="明細の数量" className="h-6 min-h-6! rounded-sm border-0 bg-transparent px-1 text-right text-[11px] shadow-none focus-visible:ring-1"
                              onChange={(event) => setLine(line.key, { quantity: event.target.value })} />
                          </td>
                          <td className={`border-r border-slate-200 px-0.5 py-px ${readOnly ? 'bg-slate-100' : 'bg-amber-50'}`}>
                            <Input data-v25-excel-col="unit" value={line.unit} disabled={readOnly} aria-label="単位" className="h-6 min-h-6! rounded-sm border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-1"
                              onChange={(event) => setLine(line.key, { unit: event.target.value })} />
                          </td>
                          {visible.cost_unit && <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right text-muted">—</td>}
                          {visible.cost_amount && <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right text-muted">—</td>}
                          {visible.sale_unit && <td className={`border-r border-slate-200 px-0.5 py-px text-right text-slate-800 ${line.price_mode === 'manual' && !readOnly ? 'bg-amber-50' : 'bg-slate-100'}`} data-testid="v25-wb-line-price-cell">
                            {line.price_mode === 'manual' ? (
                              <Input data-v25-excel-col="sale" value={line.unit_price} disabled={readOnly} inputMode="numeric" aria-label="明細の売価単価"
                                className="h-6 min-h-6! w-full rounded-sm border-0 bg-transparent px-1 text-right text-[11px] shadow-none focus-visible:ring-1"
                                onChange={(event) => setLine(line.key, { unit_price: event.target.value })} />
                            ) : (
                              <span className="block px-1 text-[10px] text-amber-800">別途見積</span>
                            )}
                          </td>}
                          <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right tabular-nums font-semibold text-slate-900" data-testid="v25-wb-line-sale-amount">
                            {line.price_mode === 'por' ? (
                              <Badge tone="warn">未確定</Badge>
                            ) : unpricedKeys.has(line.key) ? (
                              <Badge tone="danger">売価未入力</Badge>
                            ) : (
                              yen(result?.amount)
                            )}
                          </td>
                          {visible.gross && <td className="border-r border-slate-200 bg-slate-100 px-1 py-px text-right text-muted">—</td>}
                          {visible.note && <td className={`border-r border-slate-200 px-0.5 py-px ${readOnly ? 'bg-slate-100' : 'bg-amber-50'}`}>
                            <Input data-v25-excel-col="note" value={line.remark} disabled={readOnly} aria-label="備考" title={line.remark} placeholder="備考" className="h-6 min-h-6! w-full rounded-sm border-0 bg-transparent px-1 text-[11px] shadow-none focus-visible:ring-1"
                              onChange={(event) => setLine(line.key, { remark: event.target.value })} />
                          </td>}

                          <td className="sticky right-0 z-10 bg-slate-100 px-0.5 py-px text-center">
                            {!readOnly && (
                              <div className="flex items-center justify-center gap-0.5">

                                <V25WorkbenchRowMenu testId="v25-wb-line-menu" label={(line.name || '明細') + 'の操作'}>
                                  <button type="button" data-testid="v25-wb-change-work-group" disabled={positionActionsLocked}
                                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-50 disabled:opacity-40"
                                    onClick={(event) => {
                                      rememberRowMenuOpener(event.currentTarget);
                                      event.currentTarget.closest('details')?.removeAttribute('open');
                                      setGroupEditor({ lineKey: line.key, originalLabel: line.group_label, value: line.group_label });
                                    }}>工事項目を変更</button>
                                  {line.price_mode !== 'manual' && (
                                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                                    onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setLine(line.key, { price_mode: 'manual' }); }}>金額を入力する</button>
                                  )}
                                  {line.price_mode !== 'por' && (
                                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                                    onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setLine(line.key, { price_mode: 'por' }); }}>別途見積にする</button>
                                  )}
                                  {line.review_required && (
                                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                                    title="要見直し → 見直し済みにする"
                                    onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setLine(line.key, { review_required: false }); }}>見直し済みにする</button>
                                  )}
                                <V25RowDeleteButton inMenu
                                  testId="v25-wb-line-delete" name={line.name.trim() || '名称未入力の明細'}
                                  disabled={positionActionsLocked}
                                  onConfirm={() => {
                                    if (positionActionsLocked) return;
                                    setState((current) => deleteV25WorkbenchRow(current, 'line', line.key));
                                  }}
                                />
                                </V25WorkbenchRowMenu>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    </Fragment>
                  ))}
                  {!collapsed.has(code) && sectionSubtotal(code, STANDARD_SECTION_LABEL[code])}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-100 text-[11px]">
            <tr className="border-t-2 border-slate-300">
              <td colSpan={beforeSaleAmount} className="px-2 py-1 text-right text-slate-600">税別小計（経費を含む）</td>
              <td className="border-l border-slate-300 px-2 py-1 text-right font-semibold tabular-nums" data-testid="v25-wb-subtotal">
                {calc.result ? (calc.result.subtotal !== null ? yen(calc.result.subtotal) : '未確定') : '—'}
              </td>
              <td colSpan={afterSaleAmount} />
            </tr>
            <tr>
              <td colSpan={beforeSaleAmount} className="px-2 py-1 text-right text-slate-600">調整額</td>
              <td className="border-l border-slate-300 px-2 py-1 text-right tabular-nums">{calc.result ? yen(calc.result.adjustment) : '—'}</td>
              <td colSpan={afterSaleAmount} />
            </tr>
            <tr>
              <td colSpan={beforeSaleAmount} className="px-2 py-1 text-right text-slate-600">消費税</td>
              <td className="border-l border-slate-300 px-2 py-1 text-right tabular-nums">{calc.result ? (calc.result.tax !== null ? yen(calc.result.tax) : '未確定') : '—'}</td>
              <td colSpan={afterSaleAmount} />
            </tr>
            <tr className="border-t border-slate-300">
              <td colSpan={beforeSaleAmount} className="px-2 py-1 text-right font-semibold">税込合計（画面の試算）</td>
              <td className="border-l border-slate-300 px-2 py-1 text-right text-sm font-semibold tabular-nums" data-testid="v25-wb-total">
                {calc.result ? (calc.result.total !== null ? yen(calc.result.total) : '未確定（別途見積を含む）') : '—'}
              </td>
              <td colSpan={afterSaleAmount} className="px-2 py-1 text-right text-[0.68rem] text-slate-500">保存済み {savedTotal !== null ? yen(savedTotal) : '未確定'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <StandardEstimateV25AmountBreakdown
        result={calc.result}
        savedTotal={savedTotal}
        unpricedCount={calc.unpriced.length}
        incompleteCostCount={calc.incomplete.length}
        adjustmentValue={state.adjustment}
        onAdjustmentChange={(value) => setState((current) => ({ ...current, adjustment: value }))}
        readOnly={readOnly}
      />

      {calc.error && <Alert tone="warn">画面の試算ができません：{calc.error}</Alert>}
      {calc.unpriced.length > 0 && (
        <Alert tone="warn">売価が未入力の行が {calc.unpriced.length} 件あります（金額に含めていません）。売価を整数円で入力するか、別途見積にしてください。</Alert>
      )}
      {unavailableCount > 0 && (
        <Alert tone="danger">この仕様では選べなくなった商品の行が {unavailableCount} 件あります。削除するか、別の商品に変えてから保存してください。</Alert>
      )}
      {!readOnly && slotRuleIssues.length > 0 && (
        <div data-testid="v25-wb-slot-rules">
          <Alert tone="warn">
            <p className="font-semibold">公開中の版の選択枠はシミュレーターの初期構成になるため、次の決まりに合わせてください（合わないと公開できません）</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {slotRuleIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </Alert>
        </div>
      )}
      {calc.incomplete.length > 0 && (
        <Alert tone="warn">
          原価が未設定の商品が {calc.incomplete.length} 件あります（金額に含めていません）。商品台帳で商品標準原価・原価差額を登録するか、売価を入力・別途見積にしてください。
        </Alert>
      )}
      <p className="text-[0.7rem] leading-5 text-muted">
        金額は画面の試算です。保存すると DB の正式計算で確定します（商品・選択肢を変えていない行は固定した原価のまま。原価の更新を反映するときは「最新原価を取り込む」）。
        別途工事には販売費・経費・掛率を掛けません（売価の入力か別途見積）。金額が決まっていない行は別途見積にし、0 円にはしません。
      </p>

      {!readOnly && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" data-testid="v25-wb-save-area">
          {positionInputActive && (
            <p role="status" data-testid="v25-wb-position-edit-save-blocked" className="text-sm font-medium text-amber-800">
              位置名を編集中のため、下書きの保存・公開はできません。Enterで確定するかEscで取り消してください。
            </p>
          )}
          {blockers.length > 0 && (
            <Alert tone="warn">
              <p className="font-semibold">公開できない理由</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </Alert>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-2" data-testid="v25-wb-action-priorities">
            <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={save} disabled={pending || !dirty || positionInputActive} data-testid="v25-wb-save">
              {pending ? '処理中…' : '下書きを保存'}
            </Button>
            <Button type="button" variant="secondary" disabled={pending || (!editedDirty && !orderDirty) || positionInputActive} onClick={() => {
              setState(initial);
              setViewOrder([]);
              setPercents({ sales_fee_rate: rateToPercent(initial.sales_fee_rate), expense_rate: rateToPercent(initial.expense_rate), markup_rate: rateToPercent(initial.markup_rate) });
            }}>
              変更を破棄
            </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" disabled={pending || dirty || positionInputActive} data-testid="v25-wb-refresh"
              title={dirty ? '保存してから取り込んでください' : undefined}
              onClick={() => run(() => refreshStandardEstimateV25CostsAction({ revision_id: revisionId, expected_lock_version: lockVersion }))}>
              最新原価を取り込む
            </Button>
            <ConfirmActionButton
              className="btn-primary"
              disabled={pending || blockers.length > 0 || positionInputActive}
              showCloseButton
              dialogTitle="この内容で公開しますか？"
              message="公開すると、この標準見積の現在の版になり、前の版は置き換わります。公開した金額は変わりません。"
              confirmLabel="公開する"
              data-testid="v25-wb-publish"
              onConfirm={() => run(() => publishStandardEstimateV25RevisionAction({ revision_id: revisionId, expected_lock_version: lockVersion }))}
            >
              公開する
            </ConfirmActionButton>
            </div>
          </div>
        </div>
      )}

      {groupEditor && !readOnly && (
        <V25DialogLayer className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
          onClose={() => setGroupEditor(null)} returnFocusTo={dialogOpener}
          dirty={groupEditor.value !== groupEditor.originalLabel}>
          {(requestClose) => (
            <div role="dialog" aria-modal="true" aria-label="工事項目を変更" data-testid="v25-wb-work-group-dialog"
              className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold">工事項目を変更</h3>
                <button type="button" data-v25-dialog-close aria-label="工事項目の編集を閉じる" className="text-xl text-muted" onClick={requestClose}>×</button>
              </div>
              <div className="space-y-2 px-4 py-3 text-xs">
                <p>現在の工事項目：{groupEditor.originalLabel || '未設定'}</p>
                <label className="block space-y-1">
                  <span className="font-medium">工事項目名（空欄で未設定）</span>
                  <Input autoFocus data-testid="v25-wb-work-group-input" aria-label="工事項目名" value={groupEditor.value}
                    placeholder="例：2. 屋根工事（独自名称も可）" className="h-9 w-full text-sm"
                    onChange={(event) => setGroupEditor((current) => current ? { ...current, value: event.target.value } : null)} />
                </label>
                <p className="text-slate-500">確定すると該当の小見出しに移動します。下書き保存までDBには反映されません。</p>
              </div>
              <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
                <Button type="button" variant="secondary" onClick={requestClose}>キャンセル</Button>
                <Button type="button" data-testid="v25-wb-work-group-confirm" disabled={pending}
                  onClick={() => {
                    if (groupEditor.value !== groupEditor.originalLabel) setLine(groupEditor.lineKey, { group_label: groupEditor.value });
                    setJumpToKey({ key: groupEditor.lineKey });
                    setGroupEditor(null);
                  }}>確定</Button>
              </div>
            </div>
          )}
        </V25DialogLayer>
      )}

      {variantEditor && variantSlot && (
        <V25DialogLayer className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClose={() => setVariantEditor(null)} returnFocusTo={dialogOpener} dirty={!readOnly && JSON.stringify(variantEditor.choices) !== JSON.stringify(variantSlot.variant_choices)}>
          {(requestClose) => (
          <div role="dialog" aria-modal="true" aria-label="商品の仕様を変更" data-testid="v25-wb-variant-editor"
            className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="font-semibold">{variantCandidate?.name ?? '商品'}：仕様の選択</p>
                <p className="text-xs text-muted">確定しても下書きは保存されません。保存は表の下のボタンから行います。</p>
              </div>
              <button type="button" data-v25-dialog-close aria-label="仕様変更を閉じる" title="閉じる" className="text-xl text-muted" onClick={requestClose}>×</button>
            </div>
            <div className="space-y-3 overflow-y-auto px-4 py-3">
              {(variantCandidate?.variantGroups ?? []).map((group) => (
                <label key={group.id} className="block space-y-1 text-xs">
                  <span className="font-medium">{group.name}</span>
                  <Select value={variantEditor.choices[group.id] ?? ''} disabled={readOnly}
                    aria-label={group.name} data-testid="v25-wb-variant-choice" className="h-9 w-full text-xs"
                    onChange={(event) => setVariantEditor((current) => current ? {
                      ...current, choices: { ...current.choices, [group.id]: event.target.value },
                    } : null)}>
                    <option value="">{group.name}を選ぶ（未選択）</option>
                    {group.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                  </Select>
                </label>
              ))}
              {variantCandidate?.unavailable && <Alert tone="danger">この商品は現在の仕様で選べません。商品を変更または削除してください。</Alert>}
              {variantCandidate?.retired && <Alert tone="warn">販売停止の商品です。</Alert>}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button type="button" variant="secondary" onClick={requestClose}>{readOnly ? '閉じる' : 'キャンセル'}</Button>
              {!readOnly && <Button type="button" data-testid="v25-wb-variant-confirm" onClick={applyVariant}>確定</Button>}
            </div>
          </div>
          )}
        </V25DialogLayer>
      )}

      {duplicateFor && duplicateSource && (
        <V25DialogLayer className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClose={() => setDuplicateFor(null)} returnFocusTo={dialogOpener} dirty={duplicateFor.label !== ''}>
          {(requestClose) => (
          <div role="dialog" aria-modal="true" aria-label="別の位置に複製"
            data-testid="v25-wb-duplicate-position-dialog"
            className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div><p className="font-semibold">別の位置に複製</p>
              <p className="text-xs text-muted">{candidateById.get(duplicateSource.option_id)?.name ?? '商品'}を数量１で直下に１行追加します。元行は変更しません。</p></div>
              <button type="button" data-v25-dialog-close aria-label="別位置への複製を閉じる" title="閉じる" className="text-xl text-muted" onClick={requestClose}>×</button>
            </div>
            <div className="space-y-2 px-4 py-3">
              <label className="block space-y-1 text-xs">
                <span className="font-semibold">新しい位置名</span>
                <V25PositionNameInput disabled={pending}
                  testId="v25-wb-duplicate-position-input" value={duplicateFor.label}
                  placeholder="例：寝室の窓"
                  onChange={(label) => setDuplicateFor((current) => current ? { ...current, label, error: null } : null)}
                  onConfirm={confirmDuplicatePosition}
                  onCancel={requestClose}
                />
              </label>
              {duplicateFor.error && <p role="alert" className="text-xs text-red-700">{duplicateFor.error}</p>}
              <p className="text-xs text-muted">変更候補は引き継ぎません。新しい位置識別子・行IDを自動発行します。</p>
              <p className="text-xs text-muted">明細への反映のみです。下書き保存は別操作です。位置名を確定・取消するまでは保存できません。</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button type="button" variant="secondary" onClick={requestClose}>キャンセル</Button>
              <Button type="button" data-testid="v25-wb-duplicate-position-confirm" disabled={pending}
                onClick={confirmDuplicatePosition}>１行追加</Button>
            </div>
          </div>
          )}
        </V25DialogLayer>
      )}

      {positionSlot && positionDraft && (
        <V25DialogLayer className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClose={closePosition} returnFocusTo={dialogOpener} dirty={!readOnly && (removePositionOnConfirm || positionDraft.slot_label !== positionSlot.slot_label || JSON.stringify(positionDraft.selectable_option_ids) !== JSON.stringify(positionSlot.selectable_option_ids))}>
          {(requestClose) => (
          <div role="dialog" aria-modal="true" aria-label="位置を設定" data-testid="v25-wb-slot-position-editor"
            className="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold">位置を設定</p>
                <p className="mt-1 text-xs text-slate-600" data-testid="v25-wb-position-standard-product">
                  標準商品：{positionCandidate?.name ?? '（商品が見つかりません）'}
                  {positionCandidate?.windowTypeLabel ? `（${positionCandidate.windowTypeLabel}）` : ''}
                </p>
              </div>
              <button type="button" data-v25-dialog-close aria-label="位置設定画面を閉じる" title="閉じる" className="text-xl text-muted" onClick={requestClose}>×</button>
            </div>
            <div className="space-y-4 overflow-y-auto px-4 py-3">
              <div className="space-y-2 text-xs" data-testid="v25-wb-position-location-section">
                <p className="font-semibold">① この商品をどこに使いますか？</p>
                {positionLabelSuggestions.length > 0 && (
                  <label className="block space-y-1">
                    <span className="block text-slate-600">位置名の候補（任意）</span>
                    <Select
                      value={positionLabelSuggestions.includes(positionDraft.slot_label) ? positionDraft.slot_label : ''}
                      disabled={readOnly} aria-label="位置名の候補" data-testid="v25-wb-position-label-suggestions"
                      className="h-8 w-full text-xs"
                      onChange={(event) => {
                        if (event.target.value) updatePosition({ slot_label: event.target.value });
                      }}>
                      <option value="">候補から選ぶ（任意）</option>
                      {positionLabelSuggestions.map((label) => <option key={label} value={label}>{label}</option>)}
                    </Select>
                  </label>
                )}
                <label className="block space-y-1">
                  <span className="block text-slate-600">位置名（自由に入力・修正できます）</span>
                  <Input value={positionDraft.slot_label} disabled={readOnly} maxLength={40} data-testid="v25-wb-slot-label"
                    placeholder="例：リビングの掃出し窓" onChange={(event) => updatePosition({ slot_label: event.target.value })} />
                </label>
              </div>
              <div className="space-y-2 text-xs" data-testid="v25-wb-position-alternatives-section">
                <p className="font-semibold">② お客様が選べる別の商品（任意）</p>
                  <ul className="flex flex-wrap gap-1.5" data-testid="v25-wb-slot-selectables">
                    {positionDraft.selectable_option_ids.length === 0 && <li className="text-muted">変更候補なし（標準商品のみ）</li>}
                    {positionDraft.selectable_option_ids.map((id) => {
                      const alternative = candidateById.get(id);
                      const name = alternative?.name ?? '（選べない商品）';
                      return (
                        <li key={id} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1">
                          {name} {alternative?.windowTypeLabel ? `（${alternative.windowTypeLabel}）` : ''}
                          {!readOnly && <button type="button" className="text-muted hover:text-danger" aria-label={`${name}を変更候補から外す`} onClick={() => toggleSelectable(id)}>×</button>}
                        </li>
                      );
                    })}
                  </ul>
                  {!readOnly && (
                    <button type="button" className="btn-secondary btn-sm" disabled={!positionDraft.slot_label.trim()}
                      data-testid="v25-wb-slot-selectable-open"
                      onClick={() => openSelectable(positionSlot.key)}>
                      ＋ 別の商品を選ぶ
                    </button>
                  )}
                  {positionSlot.slot_code.trim() && !readOnly && (
                    <div className="space-y-1 border-t border-slate-200 pt-3">
                      <p className="text-muted">位置設定を解除しても商品行は削除されません。</p>
                      <button type="button" className="text-xs text-red-700 underline"
                        onClick={() => {
                          setRemovePositionOnConfirm(true);
                          setPositionDraft((current) => current
                            ? { ...current, slot_label: '', selectable_option_ids: [] }
                            : null);
                          setPositionError(null);
                        }}>
                        位置設定を解除
                      </button>
                      {removePositionOnConfirm &&
                        <p className="font-medium text-amber-800">位置名と変更候補を外します。この商品行は残ります。確定前ならキャンセルできます。</p>}
                    </div>
                  )}
              </div>
              <p className="text-[0.68rem] leading-5 text-muted">新しく位置を設定するときは数量1が必要です。</p>
              {!positionSlot.slot_code.trim() && Number(positionSlot.quantity) !== 1 && (
                <p className="text-xs font-medium text-amber-800">現在の数量は {positionSlot.quantity} です。新しく位置を設定するには数量１が必要です。自動変更はしません。</p>
              )}
              {positionError && <Alert tone="danger">{positionError}</Alert>}
              <p className="text-xs text-muted">設定を反映しただけでは正式保存されません。最後に「下書きを保存」してください。</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button type="button" variant="secondary" onClick={requestClose}>{readOnly ? '閉じる' : 'キャンセル'}</Button>
              {!readOnly && <Button type="button" data-testid="v25-wb-position-confirm" onClick={confirmPosition} disabled={pending}>
                {removePositionOnConfirm ? '位置設定を解除する' : '設定を反映'}
              </Button>}
            </div>
          </div>
          )}
        </V25DialogLayer>
      )}

      {replacementDraft && replacementSource && (
        <V25DialogLayer className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClose={() => setReplacementDraft(null)} returnFocusTo={dialogOpener} dirty={replacementDraft.selectableIds.length > 0}>
          {(requestClose) => (
          <div role="dialog" aria-modal="true" aria-label="同じ位置の標準品を入れ替える" data-testid="v25-wb-position-replacement"
            className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-semibold">「{replacementSource.slot_label}」の標準品を入替</p>
              <button type="button" data-v25-dialog-close aria-label="標準品の入替を閉じる" title="閉じる" className="text-xl text-muted" onClick={requestClose}>×</button>
            </div>
            <div className="space-y-3 overflow-y-auto px-4 py-3 text-xs">
              <p>新しい標準品：<strong>{replacementDraft.candidate.name}</strong></p>
              <p>位置名と識別子は引き継ぎます。変更候補は見直しが必要なため、初期状態では「新しい標準品のみ」です。</p>
              <div className="space-y-1 rounded border border-slate-200 p-3">
                <p className="font-semibold">新しい位置でも使える変更候補を選ぶ（任意）</p>
                {replacementChoices.length === 0 && <p className="text-muted">引き継げる変更候補はありません。</p>}
                {replacementChoices.map((candidate) => (
                  <label key={candidate.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={replacementDraft.selectableIds.includes(candidate.id)}
                      onChange={(event) => setReplacementDraft((current) => current ? {
                        ...current, selectableIds: event.target.checked
                          ? [...current.selectableIds, candidate.id]
                          : current.selectableIds.filter((id) => id !== candidate.id),
                      } : null)} />
                    {candidate.name}
                  </label>
                ))}
              </div>
              <p className="text-muted">候補が選べることは開口寸法・現場条件への適合を保証しません。担当者が選び直してください。</p>
              <p className="text-muted">確定後は編集中の明細と試算に反映されます。下書きはまだ保存されません。</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button type="button" variant="secondary" onClick={requestClose}>キャンセル</Button>
              <Button type="button" disabled={pending} data-testid="v25-wb-position-replace-confirm" onClick={confirmReplacement}>標準品と候補を反映</Button>
            </div>
          </div>
          )}
        </V25DialogLayer>
      )}

      {picker && (
        <V25DialogLayer className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[6vh]" onClose={() => { setPicker(null); setPickerDirty(false); }} returnFocusTo={dialogOpener} dirty={pickerDirty}>
          {(requestClose) => (
          <StandardEstimateV25ProductPicker
            sectionLabel={STANDARD_SECTION_LABEL[picker.section]}
            section={picker.section}
            candidates={candidates.filter((candidate) => candidate.section === picker.section && !candidate.retired && !candidate.unavailable)}
            productCosts={costs.currentProduct}
            currentSlot={picker.targetKey ? state.slots.find((slot) => slot.key === picker.targetKey) ?? null : null}
            originalProduct={picker.targetKey
              ? candidateById.get(state.slots.find((slot) => slot.key === picker.targetKey)?.option_id ?? '') ?? null
              : null}
            onChoose={choose}
            onClose={requestClose}
            onDirtyChange={setPickerDirty}
          />
          )}
        </V25DialogLayer>
      )}

      {selectableSlot && selectableBase && (
        <V25DialogLayer className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClose={closeSelectable} dirty={selectableDirty}>
          {(requestClose) => (
          <div role="dialog" aria-modal="true" aria-label="お客様が選べる商品" className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold">{positionDraft?.slot_label.trim() || '位置名未設定'}：お客様が選べる商品</p>
                <p className="text-xs text-muted">標準の「{selectableBase.name}」の代わりに選べる、{selectableBase.categoryName}の商品を選びます（いくつでも）。</p>
              </div>
              <button type="button" data-v25-dialog-close aria-label="変更候補の選択を閉じる" title="閉じる" className="shrink-0 text-xl text-muted" onClick={requestClose}>×</button>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2">
              {selectableBase.usesWindowType && (
                <Select value={selectableWindowType} onChange={(event) => setSelectableWindowType(event.target.value)} aria-label="窓タイプ" className="h-8 text-xs"
                  data-testid="v25-wb-selectable-window-type">
                  <option value="">すべての窓タイプ</option>
                  {selectableWindowTypes.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  <option value={NO_WINDOW_TYPE}>窓タイプ未設定</option>
                </Select>
              )}
              <Input value={selectableQuery} onChange={(event) => setSelectableQuery(event.target.value)} placeholder="商品名・メーカー・型番" aria-label="選べる商品を検索" className="h-8 flex-1 text-xs" />
            </div>
            <ul className="divide-y divide-line overflow-y-auto" data-testid="v25-wb-selectable-picker">
              {selectableShown.map((candidate) => {
                const checked = selectableDraftIds?.includes(candidate.id) ?? false;
                return (
                  <li key={candidate.id}>
                    <label className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-sand/40">
                      <input type="checkbox" checked={checked} onChange={() => toggleSelectableDraft(candidate.id)} disabled={readOnly} />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{candidate.name}</span>
                        <span className="block text-xs text-muted">{[candidate.manufacturer, candidate.modelNo, candidate.windowTypeLabel].filter(Boolean).join(' ／ ')}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
              {selectableShown.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">選べる商品がありません。</li>}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
              <span>選んでいる商品 {selectableDraftIds?.length ?? 0} 件（標準の商品のほか）</span>
              <button type="button" className="btn-primary btn-sm" onClick={applySelectable}>決定</button>
            </div>
          </div>
          )}
        </V25DialogLayer>
      )}
    </section>
  );
}
