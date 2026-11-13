'use client';

import { Fragment, useEffect, useMemo, useState, useTransition, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
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
  type V25LinePriceMode,
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
  type V25WorkbenchBaseLine,
  type V25WorkbenchCandidate,
  type V25WorkbenchCosts,
} from '@/lib/domain/standard-estimate-v25-workbench';
import { Alert, Badge, Button, Input, Select } from '@/components/ui';
import { ConfirmActionButton } from '@/components/admin/confirm-action-button';

const LINE_SECTIONS: StandardLineSectionCode[] = ['interior_exterior', 'option', 'sitework'];
const COST_TONE: Record<V25CostStatus, 'success' | 'warn' | 'danger'> = { current: 'success', stale: 'warn', missing: 'danger' };
const RATE_LABEL = { sales_fee_rate: '販売費率', expense_rate: '経費率', markup_rate: '掛率' } as const;

let rowSeq = 0;
const newKey = (prefix: string) => `${prefix}-new-${(rowSeq += 1)}`;
/** 選べる商品の絞り込みの「窓タイプ未設定」 */
const NO_WINDOW_TYPE = '__none';

const yen = (value: number | null | undefined) => (value === null || value === undefined ? '—' : formatYen(value));

type Notice = { tone: 'success' | 'danger'; text: string };

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
  revisionId: string;
  lockVersion: number;
  readOnly: boolean;
  baseLines: V25WorkbenchBaseLine[];
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
  revisionId,
  lockVersion,
  readOnly,
  baseLines,
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
  const [percents, setPercents] = useState(() => ({
    sales_fee_rate: rateToPercent(initial.sales_fee_rate),
    expense_rate: rateToPercent(initial.expense_rate),
    markup_rate: rateToPercent(initial.markup_rate),
  }));
  const [showCost, setShowCost] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [picker, setPicker] = useState<{ section: StandardLineSectionCode; targetKey: string | null } | null>(null);
  const [pickerCategory, setPickerCategory] = useState('');
  const [pickerQuery, setPickerQuery] = useState('');
  // 位置・用途の選択枠（v2.5 PR-S2）：位置の編集欄を開いている行と、選べる商品を選ぶ画面の対象の行
  const [variantEditor, setVariantEditor] = useState<{ slotKey: string; choices: V25SlotRow['variant_choices'] } | null>(null);
  const [positionFor, setPositionFor] = useState<string | null>(null);
  const [positionDraft, setPositionDraft] = useState<Pick<V25SlotRow, 'slot_code' | 'slot_label' | 'selectable_option_ids'> | null>(null);
  const [addPositionOnConfirm, setAddPositionOnConfirm] = useState(false);
  const [selectableFor, setSelectableFor] = useState<string | null>(null);
  const [selectableWindowType, setSelectableWindowType] = useState('');
  const [selectableQuery, setSelectableQuery] = useState('');
  const [pending, startTransition] = useTransition();

  const candidateById = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);
  const sectionOf = (optionId: string) => candidateById.get(optionId)?.section;
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
  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initial), [state, initial]);
  // シミュレーターと連携する選択枠の決まり（外壁は数量 4、それ以外は数量 1、1 つだけ選べるカテゴリーは 1 枠。DB も公開で止める）
  const slotRuleIssues = useMemo(() => v25SlotRuleIssues(state.slots, (optionId) => candidateById.get(optionId)), [state.slots, candidateById]);
  const blockers = [
    ...v25PublishBlockers(preview, dirty),
    ...(slotRuleIssues.length > 0 ? ['選択枠がシミュレーターと連携する決まりに合いません（表の下の案内を確認してください）'] : []),
  ];

  useEffect(() => {
    if (!picker && !selectableFor && !variantEditor && !positionFor) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (selectableFor) setSelectableFor(null);
      else if (positionFor) {
        setPositionFor(null);
        setPositionDraft(null);
        setAddPositionOnConfirm(false);
      } else if (variantEditor) setVariantEditor(null);
      else setPicker(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [picker, selectableFor, variantEditor, positionFor]);

  const setSlot = (key: string, patch: Partial<V25SlotRow>) =>
    setState((current) => ({ ...current, slots: current.slots.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)) }));
  const setLine = (key: string, patch: Partial<V25LineRow>) =>
    setState((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));
  const setRate = (key: keyof typeof RATE_LABEL, value: string) => {
    setPercents((current) => ({ ...current, [key]: value }));
    setState((current) => ({ ...current, [key]: percentToRate(value) }));
  };

  const choose = (candidate: V25WorkbenchCandidate) => {
    if (!picker) return;
    // 別途工事は販売費・経費・掛率を掛けない（自動にできない）。Web では金額を確定しないので別途見積にする
    const priceMode: V25SlotPriceMode = candidate.section === 'sitework' ? 'por' : 'auto';
    // 選択枠の数量は、外壁は 4（面）、それ以外は 1（シミュレーターと連携する選択枠の決まり）
    const quantity = String(standardSlotQuantity(candidate.categoryCode));
    if (picker.targetKey) {
      const target = state.slots.find((slot) => slot.key === picker.targetKey);
      setSlot(picker.targetKey, {
        option_id: candidate.id,
        variant_choices: { ...candidate.defaultChoices },
        quantity,
        ...(candidate.section === 'sitework' ? { price_mode: priceMode } : {}),
        // 位置の枠の選べる商品は、新しい標準の商品と同じカテゴリーのものだけ残す（標準の商品そのものは外す）
        ...(target
          ? {
              selectable_option_ids: target.selectable_option_ids.filter(
                (id) => id !== candidate.id && candidateById.get(id)?.categoryId === candidate.categoryId
              ),
            }
          : {}),
      });
    } else {
      setState((current) => ({
        ...current,
        slots: [
          ...current.slots,
          {
            key: newKey('slot'),
            baseline_key: null,
            option_id: candidate.id,
            variant_choices: { ...candidate.defaultChoices },
            quantity,
            price_mode: priceMode,
            manual_unit_price: '',
            // 位置・用途の選択枠（v2.5 PR-S1）。新しい行はカテゴリー単位の枠から始める
            slot_code: '',
            slot_label: '',
            selectable_option_ids: [],
          },
        ],
      }));
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

  // 位置設定も仮編集し、確定時に既存の slot ID / variant ID を保持したまま反映する。
  const openPosition = (slot: V25SlotRow) => {
    setPositionFor(slot.key);
    setPositionDraft({ slot_code: slot.slot_code, slot_label: slot.slot_label, selectable_option_ids: [...slot.selectable_option_ids] });
    setAddPositionOnConfirm(false);
  };
  const closePosition = () => {
    setSelectableFor(null);
    setPositionFor(null);
    setPositionDraft(null);
    setAddPositionOnConfirm(false);
  };
  const updatePosition = (patch: Partial<Pick<V25SlotRow, 'slot_code' | 'slot_label' | 'selectable_option_ids'>>) =>
    setPositionDraft((current) => current ? { ...current, ...patch } : null);
  const toggleSelectable = (optionId: string) =>
    setPositionDraft((current) => current ? {
      ...current,
      selectable_option_ids: current.selectable_option_ids.includes(optionId)
        ? current.selectable_option_ids.filter((id) => id !== optionId)
        : [...current.selectable_option_ids, optionId],
    } : null);
  const positionSlot = positionFor ? state.slots.find((slot) => slot.key === positionFor) : null;
  const positionCandidate = positionSlot ? candidateById.get(positionSlot.option_id) : undefined;
  const confirmPosition = () => {
    if (readOnly || !positionFor || !positionDraft) return;
    const draft = { ...positionDraft, selectable_option_ids: [...positionDraft.selectable_option_ids] };
    setState((current) => {
      const slots = current.slots.map((slot) => slot.key === positionFor ? { ...slot, ...draft } : slot);
      const index = slots.findIndex((slot) => slot.key === positionFor);
      if (addPositionOnConfirm && index !== -1) {
        const source = slots[index];
        slots.splice(index + 1, 0, {
          ...source, key: newKey('slot'), baseline_key: null,
          variant_choices: { ...source.variant_choices }, quantity: '1',
          slot_code: '', slot_label: '', selectable_option_ids: [...source.selectable_option_ids],
        });
      }
      return { ...current, slots };
    });
    closePosition();
  };
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

  const addLine = (section: StandardLineSectionCode) =>
    setState((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          key: newKey('line'),
          line_key: null,
          section_code: section,
          group_label: '',
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

  const run = (task: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    startTransition(async () => {
      const result = await task();
      onNotice(result.ok ? { tone: 'success', text: result.message } : { tone: 'danger', text: result.error });
      if (result.ok) router.refresh();
    });

  const save = () => {
    // 率は % で入力する。読めない入力は % の文で案内する（範囲は validateV25EditorState・DB で確かめる）
    const problem = percentProblem(percents) ?? validateV25EditorState(state, sectionOf);
    if (problem) {
      onNotice({ tone: 'danger', text: problem });
      return;
    }
    run(() => saveStandardEstimateV25DraftAction({ revision_id: revisionId, expected_lock_version: lockVersion, payload: buildV25SavePayload(state) }));
  };

  const toggleSection = (code: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const pickerCandidates = useMemo(() => {
    if (!picker) return [];
    const query = pickerQuery.trim().toLocaleLowerCase('ja-JP');
    return candidates.filter(
      (candidate) =>
        !candidate.retired &&
        candidate.section === picker.section &&
        (!pickerCategory || candidate.categoryId === pickerCategory) &&
        (!query || [candidate.name, candidate.manufacturer, candidate.modelNo, candidate.categoryName].join(' ').toLocaleLowerCase('ja-JP').includes(query))
    );
  }, [candidates, picker, pickerCategory, pickerQuery]);
  const pickerCategories = useMemo(() => {
    if (!picker) return [];
    const map = new Map<string, string>();
    for (const candidate of candidates) {
      if (!candidate.retired && candidate.section === picker.section) map.set(candidate.categoryId, candidate.categoryName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  }, [candidates, picker]);

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

  let rowNumber = 0;
  const columnCount = showCost ? 11 : 10;

  const sectionHeader = (code: string, label: string, actions?: ReactNode) => {
    const result = sectionResult(code);
    return (
      <tr className="bg-emerald-900 text-white" data-testid={`v25-section-${code}`}>
        <td colSpan={columnCount} className="border-y border-emerald-800 px-2 py-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="flex items-center gap-1.5 text-left text-[11px] font-semibold text-white" onClick={() => toggleSection(code)} aria-expanded={!collapsed.has(code)}>
              <span aria-hidden="true">{collapsed.has(code) ? '▸' : '▾'}</span>
              {label}
              <span className="font-normal text-emerald-100">
                小計 {result?.subtotal !== null && result?.subtotal !== undefined ? yen(result.subtotal) : result ? `${yen(result.priced_subtotal)}＋未確定` : '—'}
                {result?.expense_target ? `・経費 ${result.expense !== null ? yen(result.expense) : '未確定'}` : ''}
              </span>
              {result?.has_por && <Badge tone="warn">別途見積を含む</Badge>}
            </button>
            {actions}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <section className="space-y-3" data-testid="standard-estimate-v25-workbench">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="grid gap-2 rounded-t-md border border-slate-300 bg-white px-3 py-2 text-[11px] sm:grid-cols-[repeat(3,minmax(0,8rem))_minmax(0,9rem)_minmax(0,1fr)_auto] sm:items-end">
        {(['sales_fee_rate', 'expense_rate', 'markup_rate'] as const).map((key) => (
          <label key={key} className="space-y-1">
            <span className="text-muted">{RATE_LABEL[key]}（%）</span>
            <Input value={percents[key]} disabled={readOnly} inputMode="decimal" className="h-8 text-right" data-testid={`v25-wb-${key}`}
              onChange={(event) => setRate(key, event.target.value)} />
          </label>
        ))}
        <label className="space-y-1">
          <span className="text-muted">調整額（税別・円）</span>
          <Input value={state.adjustment} disabled={readOnly} inputMode="numeric" className="h-8 text-right" data-testid="v25-wb-adjustment"
            onChange={(event) => setState((current) => ({ ...current, adjustment: event.target.value }))} />
        </label>
        <label className="space-y-1">
          <span className="text-muted">調整額の理由</span>
          <Input value={state.adjustment_reason} disabled={readOnly} className="h-8"
            onChange={(event) => setState((current) => ({ ...current, adjustment_reason: event.target.value }))} />
        </label>
        <label className="flex items-center gap-2 pb-1.5 text-ink-soft">
          <input type="checkbox" checked={showCost} onChange={(event) => setShowCost(event.target.checked)} data-testid="v25-wb-show-cost" />
          原価を表示
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-x border-slate-300 bg-slate-100 px-2 py-1 text-[10px] text-slate-600" data-testid="v25-excel-toolbar">
        <strong>標準見積明細（Excel風）</strong>
        <span>黄色＝入力 ／ グレー＝参照 ／ Tab：次のセル ／ Enter：下の行 ／ Shift＋Enter：上の行</span>
      </div>
      <div className="overflow-x-auto rounded-b-md border border-slate-300 bg-white" data-testid="v25-excel-grid-scroll">
        <table className={`table-fixed border-collapse text-[11px] ${showCost ? 'w-[68rem] min-w-[68rem]' : 'w-[62rem] min-w-[62rem]'}`} data-testid="v25-workbench-grid" onKeyDown={handleExcelNavigation}>
          <thead className="sticky top-0 z-20 bg-slate-200 text-[10px] text-slate-600">
            <tr>
              <th className="sticky left-0 z-30 w-7 border-b border-r border-slate-300 bg-slate-100 px-0.5 py-0.5 text-center font-normal">#</th>
              <th className="sticky left-7 z-30 w-[6.25rem] border-b border-r border-slate-300 bg-slate-100 px-1 py-0.5 text-left font-medium">グループ</th>
              <th className="sticky left-[8rem] z-30 w-[15rem] border-b border-r border-slate-300 bg-slate-100 px-1 py-0.5 text-left font-medium">品名</th>
              <th className="w-16 border-b border-r border-slate-300 px-1 py-0.5 text-right font-medium">数量</th>
              <th className="w-16 border-b border-r border-slate-300 px-1 py-0.5 text-left font-medium">単位</th>
              {showCost && <th className="w-24 border-b border-r border-slate-300 px-1 py-0.5 text-right font-medium">原価単価</th>}
              <th className="w-28 border-b border-r border-slate-300 px-1 py-0.5 text-right font-medium">売価単価</th>
              <th className="w-24 border-b border-r border-slate-300 px-1 py-0.5 text-right font-medium">金額（税別）</th>
              <th className="w-24 border-b border-r border-slate-300 px-1 py-0.5 text-left font-medium">状態</th>
              <th className="w-[9rem] border-b border-r border-slate-300 px-1 py-0.5 text-left font-medium">仕様・備考</th>
              <th className="w-10 border-b border-slate-300 px-0.5 py-0.5 text-center font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {sectionHeader('base', '本体（本体マスター）')}
            {!collapsed.has('base') &&
              baseLines.map((line) => {
                const result = resultByKey.get(`base:${line.id}`);
                rowNumber += 1;
                return (
                  <tr key={line.id} className="border-b border-slate-200 text-slate-700">
                    <td className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-1 text-center text-slate-400">{rowNumber}</td>
                    <td className="sticky left-7 z-10 border-r border-slate-200 bg-white px-1 py-0.5 text-muted">{line.section}</td>
                    <td className="sticky left-[8rem] z-10 border-r border-slate-200 bg-white px-1 py-0.5"><span className="block truncate" title={line.name}>{line.name}</span></td>
                    <td className="border-r border-slate-200 px-1 py-0.5 text-right tabular-nums">{line.quantity}</td>
                    <td className="border-r border-slate-200 px-1 py-0.5">{line.unit ?? ''}</td>
                    {showCost && <td className="border-r border-slate-200 px-1 py-0.5 text-right tabular-nums">{yen(result?.cost_unit_price)}</td>}
                    <td className="border-r border-slate-200 px-1 py-0.5 text-right tabular-nums">{yen(result?.sale_unit_price)}</td>
                    <td className="border-r border-slate-200 px-1 py-0.5 text-right tabular-nums">{yen(result?.amount)}</td>
                    <td className="border-r border-slate-200 px-1 py-0.5" />
                    <td className="px-1 py-0.5 text-muted"><span className="block truncate" title="本体マスターの明細">本体マスター</span></td>
                    <td className="px-1 py-0.5" />
                  </tr>
                );
              })}

            {LINE_SECTIONS.map((code) => {
              const slots = state.slots.filter((slot) => sectionOf(slot.option_id) === code);
              const lines = state.lines.filter((line) => line.section_code === code);
              return (
                <Fragment key={code}>
                  {sectionHeader(
                    code,
                    STANDARD_SECTION_LABEL[code],
                    readOnly ? undefined : (
                      <div className="flex gap-2">
                        <button type="button" className="btn-secondary btn-sm !h-6 !min-h-6 !px-2 !text-[10px]" data-testid={`v25-wb-add-product-${code}`}
                          onClick={() => { setPicker({ section: code, targetKey: null }); setPickerCategory(''); setPickerQuery(''); }}>
                          ＋ 商品台帳から追加
                        </button>
                        <button type="button" className="btn-secondary btn-sm !h-6 !min-h-6 !px-2 !text-[10px]" data-testid={`v25-wb-add-line-${code}`} onClick={() => addLine(code)}>
                          ＋ 明細（工事費など）
                        </button>
                      </div>
                    )
                  )}
                  {!collapsed.has(code) &&
                    slots.map((slot) => {
                      const candidate = candidateById.get(slot.option_id);
                      const result = resultByKey.get(calc.lineKeyOf[slot.key] ?? '');
                      const missing = incompleteKeys.get(slot.key);
                      const pinnedPreview = previewByIdentity.get(slot);
                      const status: V25CostStatus | null = slot.price_mode !== 'auto' ? null : missing ? 'missing' : pinnedPreview ? slotCostStatus(pinnedPreview) : null;
                      const slotCode = slot.slot_code.trim();
                      const positionAllowed = Boolean(candidate && !candidate.unavailable && canUsePositionSlot(candidate.categoryCode));
                      rowNumber += 1;
                      return (
                        <Fragment key={slot.key}>
                        <tr className="border-b border-slate-200 align-middle" data-testid="v25-wb-slot">
                          <td className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-1 text-center text-slate-400">{rowNumber}</td>
                                                    <td className="sticky left-7 z-10 border-r border-slate-200 bg-white px-1 py-0.5 text-muted">
                            <div className="flex min-w-0 items-center gap-1">
                              <span className="min-w-0 flex-1 truncate" title={candidate?.categoryName ?? ""}>{candidate?.categoryName ?? ""}</span>
                              {(slotCode || (positionAllowed && !readOnly)) && (
                                <button type="button" className="max-w-[4rem] shrink-0 truncate text-[10px] text-navy underline" title={slot.slot_label.trim() || "位置・選べる商品を設定"}
                                  aria-label="位置・選べる商品を設定" data-testid="v25-wb-slot-position-toggle" onClick={() => openPosition(slot)}>
                                  <span data-testid="v25-wb-slot-position">{slotCode ? (slot.slot_label.trim() || "位置") : "位置"}</span>
                                  {slotCode && <span> {slot.selectable_option_ids.length + 1}件</span>}
                                </button>
                              )}
                            </div>
                          </td>
                                                    <td className="sticky left-[8rem] z-10 border-r border-slate-200 bg-amber-50 px-1 py-0.5">
                            <div className="flex min-w-0 items-center gap-1">
                              <span className="min-w-0 flex-1 truncate font-medium text-ink" title={[candidate?.name, candidate?.manufacturer, candidate?.modelNo, candidate?.windowTypeLabel].filter(Boolean).join(" ／ ")}>{candidate?.name ?? "（商品が見つかりません）"}</span>
                              {candidate?.unavailable ? <Badge tone="danger">この仕様では選べない商品（削除してください）</Badge> : (candidate?.retired && <Badge tone="warn">販売停止</Badge>)}
                              {candidate && <span className="sr-only">{[candidate.manufacturer, candidate.modelNo, candidate.windowTypeLabel].filter(Boolean).join(" ／ ")}</span>}
                            </div>
                          </td>

                          <td className="border-r border-slate-200 px-0.5 py-0.5">
                            <Input data-v25-excel-col="qty" value={slot.quantity} disabled={readOnly} inputMode="decimal" aria-label="数量" className="h-6 rounded-sm border-0 bg-amber-50 px-1 text-right text-[11px] shadow-none focus-visible:ring-1"
                              onChange={(event) => setSlot(slot.key, { quantity: event.target.value })} />
                          </td>
                          <td className="border-r border-slate-200 px-1 py-0.5 text-muted">—</td>
                          {showCost && (
                            <td className="border-r border-slate-200 px-1 py-0.5 text-right tabular-nums">
                              {slot.price_mode === 'auto' ? (missing ? '原価未設定' : yen(result?.cost_unit_price)) : '—'}
                            </td>
                          )}
                          <td className="border-r border-slate-200 px-0.5 py-0.5 text-right" data-testid="v25-wb-slot-price-cell">
                            {slot.price_mode === 'manual' ? (
                              <Input data-v25-excel-col="sale" value={slot.manual_unit_price} disabled={readOnly} inputMode="numeric" aria-label="売価単価"
                                className="h-6 w-full rounded-sm border-0 bg-amber-50 px-1 text-right text-[11px] shadow-none focus-visible:ring-1"
                                onChange={(event) => setSlot(slot.key, { manual_unit_price: event.target.value })} />
                            ) : slot.price_mode === 'auto' ? (
                              <span className="block truncate px-1 tabular-nums" title={yen(result?.sale_unit_price)}>{yen(result?.sale_unit_price)}</span>
                            ) : (
                              <span className="block px-1 text-[10px] text-amber-800">別途見積</span>
                            )}
                          </td>
                          <td className="border-r border-slate-200 px-1 py-0.5 text-right tabular-nums">
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
                          <td className="border-r border-slate-200 px-1 py-0.5" data-testid="v25-wb-slot-status">
                            {status && <Badge tone={COST_TONE[status]}>{V25_COST_STATUS_LABEL[status]}</Badge>}
                          </td>
                          <td className="border-r border-slate-200 px-1 py-0.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-muted" title={v25VariantSummary(candidate, slot.variant_choices)} data-testid="v25-wb-variant-summary">
                                {v25VariantSummary(candidate, slot.variant_choices)}
                              </span>
                              {Boolean(candidate?.variantGroups.length) && (
                                <button type="button" className="shrink-0 text-[0.7rem] text-navy underline" data-testid="v25-wb-variant-open"
                                  onClick={() => openVariant(slot)}>{readOnly ? '仕様を確認' : '仕様を変更'}</button>
                              )}
                            </div>
                          </td>

                          <td className="relative px-0.5 py-0.5 text-center">
                            {!readOnly && (
                              <details className="group relative inline-block" data-testid="v25-wb-slot-menu"
                                onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.stopPropagation(); } }}>
                                <summary className="flex size-6 cursor-pointer list-none items-center justify-center rounded text-sm font-bold text-slate-600 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
                                  aria-label={(candidate?.name ?? '商品') + 'の操作'} title="行の操作">⋯</summary>
                                <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left text-[11px] font-normal shadow-lg">
                                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                                    onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setPicker({ section: code, targetKey: slot.key }); setPickerCategory(''); setPickerQuery(''); }}>商品台帳から選択</button>
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
                                  <button type="button" className="block w-full px-3 py-1.5 text-left text-red-700 hover:bg-red-50"
                                    onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setState((current) => ({ ...current, slots: current.slots.filter((row) => row.key !== slot.key) })); }}>行を削除</button>
                                </div>
                              </details>
                            )}
                          </td>
                        </tr>
                        </Fragment>
                      );
                    })}
                  {!collapsed.has(code) &&
                    lines.map((line) => {
                      const result = resultByKey.get(calc.lineKeyOf[line.key] ?? '');
                      rowNumber += 1;
                      return (
                        <tr key={line.key} className="border-b border-slate-200 align-middle" data-testid="v25-wb-line">
                          <td className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-1 text-center text-slate-400">{rowNumber}</td>
                          <td className="sticky left-7 z-10 border-r border-slate-200 bg-white px-0.5 py-0.5">
                            <Input data-v25-excel-col="group" value={line.group_label} disabled={readOnly} aria-label="グループ" className="h-6 rounded-sm border-0 bg-amber-50 px-1 text-[11px] shadow-none focus-visible:ring-1"
                              onChange={(event) => setLine(line.key, { group_label: event.target.value })} />
                          </td>
                          <td className="sticky left-[8rem] z-10 border-r border-slate-200 bg-white px-0.5 py-0.5">
                            <Input data-v25-excel-col="name" value={line.name} disabled={readOnly} aria-label="品名" placeholder="品名" className="h-6 rounded-sm border-0 bg-amber-50 px-1 text-[11px] shadow-none focus-visible:ring-1"
                              onChange={(event) => setLine(line.key, { name: event.target.value })} />
                          </td>

                          <td className="border-r border-slate-200 px-0.5 py-0.5">
                            <Input data-v25-excel-col="qty" value={line.quantity} disabled={readOnly} inputMode="decimal" aria-label="明細の数量" className="h-6 rounded-sm border-0 bg-amber-50 px-1 text-right text-[11px] shadow-none focus-visible:ring-1"
                              onChange={(event) => setLine(line.key, { quantity: event.target.value })} />
                          </td>
                          <td className="border-r border-slate-200 px-0.5 py-0.5">
                            <Input data-v25-excel-col="unit" value={line.unit} disabled={readOnly} aria-label="単位" className="h-6 rounded-sm border-0 bg-amber-50 px-1 text-[11px] shadow-none focus-visible:ring-1"
                              onChange={(event) => setLine(line.key, { unit: event.target.value })} />
                          </td>
                          {showCost && <td className="border-r border-slate-200 px-1 py-0.5 text-right text-muted">—</td>}
                          <td className="border-r border-slate-200 px-0.5 py-0.5 text-right" data-testid="v25-wb-line-price-cell">
                            {line.price_mode === 'manual' ? (
                              <Input data-v25-excel-col="sale" value={line.unit_price} disabled={readOnly} inputMode="numeric" aria-label="明細の売価単価"
                                className="h-6 w-full rounded-sm border-0 bg-amber-50 px-1 text-right text-[11px] shadow-none focus-visible:ring-1"
                                onChange={(event) => setLine(line.key, { unit_price: event.target.value })} />
                            ) : (
                              <span className="block px-1 text-[10px] text-amber-800">別途見積</span>
                            )}
                          </td>
                          <td className="border-r border-slate-200 px-1 py-0.5 text-right tabular-nums">
                            {line.price_mode === 'por' ? (
                              <Badge tone="warn">未確定</Badge>
                            ) : unpricedKeys.has(line.key) ? (
                              <Badge tone="danger">売価未入力</Badge>
                            ) : (
                              yen(result?.amount)
                            )}
                          </td>
                          <td className="border-r border-slate-200 px-1 py-0.5" data-testid="v25-wb-line-status">
                            {line.review_required && <Badge tone="warn">要見直し</Badge>}
                          </td>
                          <td className="border-r border-slate-200 px-0.5 py-0.5">
                            <Input data-v25-excel-col="note" value={line.remark} disabled={readOnly} aria-label="備考" title={line.remark} placeholder="備考" className="h-6 w-full rounded-sm border-0 bg-amber-50 px-1 text-[11px] shadow-none focus-visible:ring-1"
                              onChange={(event) => setLine(line.key, { remark: event.target.value })} />
                          </td>

                          <td className="relative px-0.5 py-0.5 text-center">
                            {!readOnly && (
                              <details className="group relative inline-block" data-testid="v25-wb-line-menu"
                                onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.stopPropagation(); } }}>
                                <summary className="flex size-6 cursor-pointer list-none items-center justify-center rounded text-sm font-bold text-slate-600 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
                                  aria-label={(line.name || '明細') + 'の操作'} title="行の操作">⋯</summary>
                                <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left text-[11px] font-normal shadow-lg">
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
                                    onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setLine(line.key, { review_required: false }); }}>見直し済みにする</button>
                                  )}
                                  <button type="button" className="block w-full px-3 py-1.5 text-left text-red-700 hover:bg-red-50"
                                    onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setState((current) => ({ ...current, lines: current.lines.filter((row) => row.key !== line.key) })); }}>行を削除</button>
                                </div>
                              </details>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50 text-xs">
            <tr className="border-t-2 border-slate-300">
              <td colSpan={columnCount - 4} className="px-1 py-0.5.5 text-right text-muted">税別小計（経費を含む）</td>
              <td className="px-1 py-0.5.5 text-right font-semibold tabular-nums" data-testid="v25-wb-subtotal">
                {calc.result ? (calc.result.subtotal !== null ? yen(calc.result.subtotal) : '未確定') : '—'}
              </td>
              <td />
              <td />
              <td />
              <td />
            </tr>
            <tr>
              <td colSpan={columnCount - 4} className="px-1 py-0.5 text-right text-muted">調整額</td>
              <td className="px-1 py-0.5 text-right tabular-nums">{calc.result ? yen(calc.result.adjustment) : '—'}</td>
              <td />
              <td />
              <td />
              <td />
            </tr>
            <tr>
              <td colSpan={columnCount - 4} className="px-1 py-0.5 text-right text-muted">消費税</td>
              <td className="px-1 py-0.5 text-right tabular-nums">{calc.result ? (calc.result.tax !== null ? yen(calc.result.tax) : '未確定') : '—'}</td>
              <td />
              <td />
              <td />
              <td />
            </tr>
            <tr className="border-t border-slate-300">
              <td colSpan={columnCount - 4} className="px-1 py-0.5.5 text-right font-semibold">税込合計（画面の試算）</td>
              <td className="px-1 py-0.5.5 text-right text-sm font-semibold tabular-nums" data-testid="v25-wb-total">
                {calc.result ? (calc.result.total !== null ? yen(calc.result.total) : '未確定（別途見積を含む）') : '—'}
              </td>
              <td className="px-1 py-0.5.5 text-[0.68rem] text-muted">保存済み {savedTotal !== null ? yen(savedTotal) : '未確定'}</td>
              <td />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

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
        <div className="space-y-3 rounded-lg border border-slate-300 bg-white p-3">
          {blockers.length > 0 && (
            <Alert tone="warn">
              <p className="font-semibold">公開できない理由</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} disabled={pending || !dirty} data-testid="v25-wb-save">
              {pending ? '処理中…' : '下書きを保存'}
            </Button>
            <Button type="button" variant="secondary" disabled={pending || !dirty} onClick={() => {
              setState(initial);
              setPercents({ sales_fee_rate: rateToPercent(initial.sales_fee_rate), expense_rate: rateToPercent(initial.expense_rate), markup_rate: rateToPercent(initial.markup_rate) });
            }}>
              変更を破棄
            </Button>
            <Button type="button" variant="secondary" disabled={pending || dirty} data-testid="v25-wb-refresh"
              title={dirty ? '保存してから取り込んでください' : undefined}
              onClick={() => run(() => refreshStandardEstimateV25CostsAction({ revision_id: revisionId, expected_lock_version: lockVersion }))}>
              最新原価を取り込む
            </Button>
            <ConfirmActionButton
              className="btn-primary"
              disabled={pending || blockers.length > 0}
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
      )}

      {variantEditor && variantSlot && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClick={() => setVariantEditor(null)}>
          <div role="dialog" aria-modal="true" aria-label="商品の仕様を変更" data-testid="v25-wb-variant-editor"
            className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="font-semibold">{variantCandidate?.name ?? '商品'}：仕様の選択</p>
                <p className="text-xs text-muted">確定しても下書きは保存されません。保存は表の下のボタンから行います。</p>
              </div>
              <button type="button" className="text-sm text-muted underline" onClick={() => setVariantEditor(null)}>閉じる</button>
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
              <Button type="button" variant="secondary" onClick={() => setVariantEditor(null)}>{readOnly ? '閉じる' : 'キャンセル'}</Button>
              {!readOnly && <Button type="button" data-testid="v25-wb-variant-confirm" onClick={applyVariant}>確定</Button>}
            </div>
          </div>
        </div>
      )}

      {positionSlot && positionDraft && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClick={closePosition}>
          <div role="dialog" aria-modal="true" aria-label="位置・選べる商品を設定" data-testid="v25-wb-slot-position-editor"
            className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-semibold">{positionCandidate?.name ?? '商品'}：位置・選べる商品を設定</p>
              <button type="button" className="text-sm text-muted underline" onClick={closePosition}>閉じる</button>
            </div>
            <div className="overflow-y-auto px-4 py-3">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
                                <div className="space-y-1.5">
                                  <p className="text-[0.7rem] font-semibold text-ink">位置・用途の選択枠</p>
                                  <label className="block space-y-0.5">
                                    <span className="text-[0.68rem] text-muted">識別子（英小文字・数字・ハイフン）</span>
                                    <Input value={positionDraft.slot_code} disabled={readOnly} placeholder="例：living-sweep" className="h-7 font-mono text-xs" data-testid="v25-wb-slot-code"
                                      onChange={(event) => updatePosition({ slot_code: event.target.value })} />
                                  </label>
                                  <label className="block space-y-0.5">
                                    <span className="text-[0.68rem] text-muted">位置・用途の名前（お客様の画面に出ます）</span>
                                    <Input value={positionDraft.slot_label} disabled={readOnly} placeholder="例：掃出し窓" className="h-7 text-xs" data-testid="v25-wb-slot-label"
                                      onChange={(event) => updatePosition({ slot_label: event.target.value })} />
                                  </label>
                                  <p className="text-[0.68rem] leading-4 text-muted">
                                    識別子は新しい版へ引き継ぎ、将来の平面図の位置と紐づけます。公開した後は変えないでください。位置の枠の数量は 1 です。
                                  </p>
                                </div>
                                <div className="space-y-1.5">
                                  <p className="text-[0.7rem] font-semibold text-ink">お客様が選べる商品（この位置で 1 つ選ぶ）</p>
                                  <ul className="flex flex-wrap gap-1.5" data-testid="v25-wb-slot-selectables">
                                    <li className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[0.7rem]">
                                      <span className="mr-1 text-[0.62rem] font-semibold text-brown">標準</span>
                                      {positionCandidate?.name ?? '（商品が見つかりません）'}
                                      {positionCandidate?.windowTypeLabel ? `（${positionCandidate.windowTypeLabel}）` : ''}
                                    </li>
                                    {positionDraft.selectable_option_ids.map((id) => {
                                      const alternative = candidateById.get(id);
                                      const name = alternative?.name ?? '（選べない商品）';
                                      return (
                                        <li key={id} className="flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[0.7rem]">
                                          {name}
                                          {alternative?.windowTypeLabel ? `（${alternative.windowTypeLabel}）` : ''}
                                          {!readOnly && (
                                            <button type="button" className="text-muted hover:text-danger" aria-label={`${name}を選べる商品から外す`}
                                              onClick={() => toggleSelectable(id)}>
                                              ×
                                            </button>
                                          )}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                  {!readOnly && (
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button type="button" className="btn-secondary btn-sm" disabled={!positionDraft.slot_code.trim()} data-testid="v25-wb-slot-selectable-open"
                                        onClick={() => { setSelectableFor(positionSlot.key); setSelectableWindowType(''); setSelectableQuery(''); }}>
                                        ＋ 選べる商品を選ぶ
                                      </button>
                                      {positionDraft.slot_code.trim() && (
                                        <button type="button" className="btn-secondary btn-sm" data-testid="v25-wb-slot-add-position" onClick={() => setAddPositionOnConfirm((current) => !current)}>
                                          {addPositionOnConfirm ? '位置追加を取り消す' : '＋ 同じ商品で位置を足す'}
                                        </button>
                                      )}
                                      {(positionDraft.slot_code.trim() || positionDraft.slot_label.trim() || positionDraft.selectable_option_ids.length > 0) && (
                                        <button type="button" className="text-[0.7rem] text-muted underline"
                                          onClick={() => updatePosition({ slot_code: '', slot_label: '', selectable_option_ids: [] })}>
                                          カテゴリー単位の選択枠に戻す
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {!positionDraft.slot_code.trim() && !readOnly && (
                                    <p className="text-[0.68rem] leading-4 text-muted">識別子と名前を入れると、この位置でお客様が商品を選べるようになります。</p>
                                  )}
                                </div>
                              </div>
              {addPositionOnConfirm && !readOnly && <p className="mt-2 text-xs text-muted">確定時に同じ商品の行を直下へ追加します。新しい位置の識別子と名前は空欄です。</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <Button type="button" variant="secondary" onClick={closePosition}>{readOnly ? '閉じる' : 'キャンセル'}</Button>
              {!readOnly && <Button type="button" data-testid="v25-wb-position-confirm" onClick={confirmPosition}>確定</Button>}
            </div>
          </div>
        </div>
      )}

      {picker && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClick={() => setPicker(null)}>
          <div role="dialog" aria-modal="true" aria-label="商品台帳から選ぶ" className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-semibold">{STANDARD_SECTION_LABEL[picker.section]}：商品台帳から選ぶ</p>
              <button type="button" className="text-sm text-muted underline" onClick={() => setPicker(null)}>閉じる</button>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2">
              <Select value={pickerCategory} onChange={(event) => setPickerCategory(event.target.value)} aria-label="カテゴリー" className="h-8 text-xs">
                <option value="">すべてのカテゴリー</option>
                {pickerCategories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </Select>
              <Input value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder="商品名・メーカー・型番" aria-label="商品を検索" className="h-8 flex-1 text-xs" />
            </div>
            <ul className="divide-y divide-line overflow-y-auto" data-testid="v25-wb-picker">
              {pickerCandidates.map((candidate) => (
                <li key={candidate.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-sand/40" onClick={() => choose(candidate)}>
                    <span>
                      <span className="font-medium">{candidate.name}</span>
                      <span className="block text-xs text-muted">{[candidate.categoryName, candidate.manufacturer, candidate.modelNo].filter(Boolean).join(' ／ ')}</span>
                    </span>
                    {state.slots.some((slot) => slot.option_id === candidate.id) && <Badge tone="neutral">追加済み</Badge>}
                  </button>
                </li>
              ))}
              {pickerCandidates.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">選べる商品がありません。</li>}
            </ul>
          </div>
        </div>
      )}

      {selectableSlot && selectableBase && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClick={() => setSelectableFor(null)}>
          <div role="dialog" aria-modal="true" aria-label="お客様が選べる商品" className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold">{positionDraft?.slot_label.trim() || positionDraft?.slot_code.trim() || 'カテゴリー単位'}：お客様が選べる商品</p>
                <p className="text-xs text-muted">標準の「{selectableBase.name}」の代わりに選べる、{selectableBase.categoryName}の商品を選びます（いくつでも）。</p>
              </div>
              <button type="button" className="shrink-0 text-sm text-muted underline" onClick={() => setSelectableFor(null)}>閉じる</button>
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
                const checked = positionDraft?.selectable_option_ids.includes(candidate.id) ?? false;
                return (
                  <li key={candidate.id}>
                    <label className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-sand/40">
                      <input type="checkbox" checked={checked} onChange={() => toggleSelectable(candidate.id)} disabled={readOnly} />
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
              <span>選んでいる商品 {positionDraft?.selectable_option_ids.length ?? 0} 件（標準の商品のほか）</span>
              <button type="button" className="btn-primary btn-sm" onClick={() => setSelectableFor(null)}>決定</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
