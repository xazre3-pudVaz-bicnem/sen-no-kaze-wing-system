'use client';

import { Fragment, useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
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
  type V25SlotPriceMode,
  type V25SlotRow,
} from '@/lib/domain/standard-estimate-v25-view';
import {
  calculateV25Workbench,
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
const SLOT_MODE_LABEL: Record<V25SlotPriceMode, string> = { auto: '自動', manual: '売価入力', por: '別途見積' };
const LINE_MODE_LABEL: Record<V25LinePriceMode, string> = { manual: '金額確定', por: '別途見積' };
const RATE_LABEL = { sales_fee_rate: '販売費率', expense_rate: '経費率', markup_rate: '掛率' } as const;

let rowSeq = 0;
const newKey = (prefix: string) => `${prefix}-new-${(rowSeq += 1)}`;

const yen = (value: number | null | undefined) => (value === null || value === undefined ? '—' : formatYen(value));

type Notice = { tone: 'success' | 'danger'; text: string };

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
  // 原価の状態は、保存済みの auto の選択枠と同じ「商品＋選択肢」の行にだけ出す（商品・選択肢を変えた行は、保存すると今の原価で固定する）
  const previewByIdentity = useMemo(
    () =>
      new Map(
        (preview?.slots ?? []).filter((slot) => slot.price_mode === 'auto').map((slot) => [
          slotIdentity(slot.option_id, slot.variants.map((variant) => variant.variant_choice_id)),
          slot,
        ])
      ),
    [preview]
  );
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
    if (!picker) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPicker(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [picker]);

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
      setSlot(picker.targetKey, {
        option_id: candidate.id,
        variant_choices: { ...candidate.defaultChoices },
        quantity,
        ...(candidate.section === 'sitework' ? { price_mode: priceMode } : {}),
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
          },
        ],
      }));
    }
    setPicker(null);
  };

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

  let rowNumber = 0;
  const columnCount = showCost ? 11 : 10;

  const sectionHeader = (code: string, label: string, actions?: ReactNode) => {
    const result = sectionResult(code);
    return (
      <tr className="bg-[#eef3ef]" data-testid={`v25-section-${code}`}>
        <td colSpan={columnCount} className="border-y border-slate-300 px-2 py-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="flex items-center gap-2 text-left text-xs font-semibold text-ink" onClick={() => toggleSection(code)} aria-expanded={!collapsed.has(code)}>
              <span aria-hidden="true">{collapsed.has(code) ? '▸' : '▾'}</span>
              {label}
              <span className="font-normal text-muted">
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

      <div className="grid gap-3 rounded-lg border border-slate-300 bg-white p-3 text-xs sm:grid-cols-[repeat(3,minmax(0,8rem))_minmax(0,9rem)_minmax(0,1fr)_auto] sm:items-end">
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

      <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
        <table className="w-full min-w-[68rem] border-collapse text-xs" data-testid="v25-workbench-grid">
          <thead className="sticky top-0 z-10 bg-slate-100 text-[0.7rem] text-slate-600">
            <tr>
              <th className="w-10 border-b border-r border-slate-300 px-1 py-1 text-center font-normal">#</th>
              <th className="w-28 border-b border-r border-slate-300 px-2 py-1 text-left font-medium">グループ</th>
              <th className="min-w-[14rem] border-b border-r border-slate-300 px-2 py-1 text-left font-medium">品名</th>
              <th className="min-w-[10rem] border-b border-r border-slate-300 px-2 py-1 text-left font-medium">選択肢・備考</th>
              <th className="w-20 border-b border-r border-slate-300 px-2 py-1 text-right font-medium">数量</th>
              <th className="w-14 border-b border-r border-slate-300 px-2 py-1 text-left font-medium">単位</th>
              <th className="w-24 border-b border-r border-slate-300 px-2 py-1 text-left font-medium">計算</th>
              {showCost && <th className="w-28 border-b border-r border-slate-300 px-2 py-1 text-right font-medium">原価単価</th>}
              <th className="w-28 border-b border-r border-slate-300 px-2 py-1 text-right font-medium">売価単価</th>
              <th className="w-28 border-b border-r border-slate-300 px-2 py-1 text-right font-medium">金額（税別）</th>
              <th className="w-24 border-b border-slate-300 px-2 py-1 text-left font-medium">状態</th>
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
                    <td className="border-r border-slate-200 bg-slate-50 px-1 text-center text-slate-400">{rowNumber}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-muted">{line.section}</td>
                    <td className="border-r border-slate-200 px-2 py-1">{line.name}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-muted">本体マスターの明細</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-right tabular-nums">{line.quantity}</td>
                    <td className="border-r border-slate-200 px-2 py-1">{line.unit ?? ''}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-muted">自動</td>
                    {showCost && <td className="border-r border-slate-200 px-2 py-1 text-right tabular-nums">{yen(result?.cost_unit_price)}</td>}
                    <td className="border-r border-slate-200 px-2 py-1 text-right tabular-nums">{yen(result?.sale_unit_price)}</td>
                    <td className="border-r border-slate-200 px-2 py-1 text-right tabular-nums">{yen(result?.amount)}</td>
                    <td className="px-2 py-1" />
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
                        <button type="button" className="btn-secondary btn-sm" data-testid={`v25-wb-add-product-${code}`}
                          onClick={() => { setPicker({ section: code, targetKey: null }); setPickerCategory(''); setPickerQuery(''); }}>
                          ＋ 商品台帳から追加
                        </button>
                        <button type="button" className="btn-secondary btn-sm" data-testid={`v25-wb-add-line-${code}`} onClick={() => addLine(code)}>
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
                      const pinnedPreview = previewByIdentity.get(slotIdentity(slot.option_id, slotChoiceIds(slot)));
                      const status: V25CostStatus | null = slot.price_mode !== 'auto' ? null : missing ? 'missing' : pinnedPreview ? slotCostStatus(pinnedPreview) : null;
                      rowNumber += 1;
                      return (
                        <tr key={slot.key} className="border-b border-slate-200 align-top" data-testid="v25-wb-slot">
                          <td className="border-r border-slate-200 bg-slate-50 px-1 pt-1.5 text-center text-slate-400">{rowNumber}</td>
                          <td className="border-r border-slate-200 px-2 pt-1.5 text-muted">{candidate?.categoryName ?? ''}</td>
                          <td className="border-r border-slate-200 bg-amber-50/60 px-2 py-1">
                            <div className="flex items-start gap-1">
                              <span className="flex-1 pt-0.5 font-medium text-ink">
                                {candidate?.name ?? '（商品が見つかりません）'}
                                {candidate?.unavailable ? (
                                  <Badge tone="danger">この仕様では選べない商品（削除してください）</Badge>
                                ) : (
                                  candidate?.retired && <Badge tone="warn">販売停止</Badge>
                                )}
                              </span>
                              {!readOnly && (
                                <button type="button" className="text-[0.7rem] text-navy underline" aria-label={`${candidate?.name ?? '商品'}を選び直す`}
                                  onClick={() => { setPicker({ section: code, targetKey: slot.key }); setPickerCategory(''); setPickerQuery(''); }}>
                                  変更
                                </button>
                              )}
                            </div>
                            {candidate && (candidate.manufacturer || candidate.modelNo) && (
                              <p className="text-[0.68rem] text-muted">{[candidate.manufacturer, candidate.modelNo].filter(Boolean).join(' ／ ')}</p>
                            )}
                          </td>
                          <td className="space-y-1 border-r border-slate-200 px-2 py-1">
                            {(candidate?.variantGroups ?? []).map((group) => (
                              <Select key={group.id} value={slot.variant_choices[group.id] ?? ''} disabled={readOnly} aria-label={group.name} className="h-7 text-xs"
                                onChange={(event) => setSlot(slot.key, { variant_choices: { ...slot.variant_choices, [group.id]: event.target.value } })}>
                                <option value="">{group.name}を選ぶ</option>
                                {group.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                              </Select>
                            ))}
                            {candidate && candidate.variantGroups.length === 0 && <span className="text-muted">—</span>}
                          </td>
                          <td className="border-r border-slate-200 px-1 py-1">
                            <Input value={slot.quantity} disabled={readOnly} inputMode="decimal" aria-label="数量" className="h-7 text-right text-xs"
                              onChange={(event) => setSlot(slot.key, { quantity: event.target.value })} />
                          </td>
                          <td className="border-r border-slate-200 px-2 pt-1.5 text-muted">—</td>
                          <td className="border-r border-slate-200 px-1 py-1">
                            <Select value={slot.price_mode} disabled={readOnly} aria-label="計算" className="h-7 text-xs"
                              onChange={(event) => setSlot(slot.key, { price_mode: event.target.value as V25SlotPriceMode })}>
                              {(Object.keys(SLOT_MODE_LABEL) as V25SlotPriceMode[]).map((mode) => (
                                <option key={mode} value={mode} disabled={mode === 'auto' && code === 'sitework'}>{SLOT_MODE_LABEL[mode]}</option>
                              ))}
                            </Select>
                          </td>
                          {showCost && (
                            <td className="border-r border-slate-200 px-2 pt-1.5 text-right tabular-nums">
                              {slot.price_mode === 'auto' ? (missing ? '原価未設定' : yen(result?.cost_unit_price)) : '—'}
                            </td>
                          )}
                          <td className="border-r border-slate-200 px-1 py-1 text-right">
                            {slot.price_mode === 'manual' ? (
                              <Input value={slot.manual_unit_price} disabled={readOnly} inputMode="numeric" aria-label="売価単価" className="h-7 text-right text-xs"
                                onChange={(event) => setSlot(slot.key, { manual_unit_price: event.target.value })} />
                            ) : (
                              <span className="block pt-0.5 tabular-nums">{slot.price_mode === 'por' ? '別途見積' : yen(result?.sale_unit_price)}</span>
                            )}
                          </td>
                          <td className="border-r border-slate-200 px-2 pt-1.5 text-right tabular-nums">
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
                          <td className="space-y-1 px-2 py-1">
                            {status && <Badge tone={COST_TONE[status]}>{V25_COST_STATUS_LABEL[status]}</Badge>}
                            {!readOnly && (
                              <button type="button" className="block text-[0.7rem] text-danger underline"
                                onClick={() => setState((current) => ({ ...current, slots: current.slots.filter((row) => row.key !== slot.key) }))}>
                                削除
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  {!collapsed.has(code) &&
                    lines.map((line) => {
                      const result = resultByKey.get(calc.lineKeyOf[line.key] ?? '');
                      rowNumber += 1;
                      return (
                        <tr key={line.key} className="border-b border-slate-200 align-top" data-testid="v25-wb-line">
                          <td className="border-r border-slate-200 bg-slate-50 px-1 pt-1.5 text-center text-slate-400">{rowNumber}</td>
                          <td className="border-r border-slate-200 px-1 py-1">
                            <Input value={line.group_label} disabled={readOnly} aria-label="グループ" className="h-7 text-xs"
                              onChange={(event) => setLine(line.key, { group_label: event.target.value })} />
                          </td>
                          <td className="border-r border-slate-200 px-1 py-1">
                            <Input value={line.name} disabled={readOnly} aria-label="品名" placeholder="品名" className="h-7 text-xs"
                              onChange={(event) => setLine(line.key, { name: event.target.value })} />
                          </td>
                          <td className="border-r border-slate-200 px-1 py-1">
                            <Input value={line.remark} disabled={readOnly} aria-label="備考" placeholder="備考" className="h-7 text-xs"
                              onChange={(event) => setLine(line.key, { remark: event.target.value })} />
                          </td>
                          <td className="border-r border-slate-200 px-1 py-1">
                            <Input value={line.quantity} disabled={readOnly} inputMode="decimal" aria-label="明細の数量" className="h-7 text-right text-xs"
                              onChange={(event) => setLine(line.key, { quantity: event.target.value })} />
                          </td>
                          <td className="border-r border-slate-200 px-1 py-1">
                            <Input value={line.unit} disabled={readOnly} aria-label="単位" className="h-7 text-xs"
                              onChange={(event) => setLine(line.key, { unit: event.target.value })} />
                          </td>
                          <td className="border-r border-slate-200 px-1 py-1">
                            <Select value={line.price_mode} disabled={readOnly} aria-label="明細の計算" className="h-7 text-xs"
                              onChange={(event) => setLine(line.key, { price_mode: event.target.value as V25LinePriceMode })}>
                              {(Object.keys(LINE_MODE_LABEL) as V25LinePriceMode[]).map((mode) => <option key={mode} value={mode}>{LINE_MODE_LABEL[mode]}</option>)}
                            </Select>
                          </td>
                          {showCost && <td className="border-r border-slate-200 px-2 pt-1.5 text-right text-muted">—</td>}
                          <td className="border-r border-slate-200 px-1 py-1 text-right">
                            {line.price_mode === 'manual' ? (
                              <Input value={line.unit_price} disabled={readOnly} inputMode="numeric" aria-label="明細の売価単価" className="h-7 text-right text-xs"
                                onChange={(event) => setLine(line.key, { unit_price: event.target.value })} />
                            ) : (
                              <span className="block pt-0.5">別途見積</span>
                            )}
                          </td>
                          <td className="border-r border-slate-200 px-2 pt-1.5 text-right tabular-nums">
                            {line.price_mode === 'por' ? (
                              <Badge tone="warn">未確定</Badge>
                            ) : unpricedKeys.has(line.key) ? (
                              <Badge tone="danger">売価未入力</Badge>
                            ) : (
                              yen(result?.amount)
                            )}
                          </td>
                          <td className="space-y-1 px-2 py-1">
                            {line.review_required &&
                              (readOnly ? (
                                <Badge tone="warn">要見直し</Badge>
                              ) : (
                                <button type="button" className="block text-left text-[0.7rem] text-navy underline" onClick={() => setLine(line.key, { review_required: false })}>
                                  要見直し → 見直し済みにする
                                </button>
                              ))}
                            {!readOnly && (
                              <button type="button" className="block text-[0.7rem] text-danger underline"
                                onClick={() => setState((current) => ({ ...current, lines: current.lines.filter((row) => row.key !== line.key) }))}>
                                削除
                              </button>
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
              <td colSpan={columnCount - 2} className="px-2 py-1.5 text-right text-muted">税別小計（経費を含む）</td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums" data-testid="v25-wb-subtotal">
                {calc.result ? (calc.result.subtotal !== null ? yen(calc.result.subtotal) : '未確定') : '—'}
              </td>
              <td />
            </tr>
            <tr>
              <td colSpan={columnCount - 2} className="px-2 py-1 text-right text-muted">調整額</td>
              <td className="px-2 py-1 text-right tabular-nums">{calc.result ? yen(calc.result.adjustment) : '—'}</td>
              <td />
            </tr>
            <tr>
              <td colSpan={columnCount - 2} className="px-2 py-1 text-right text-muted">消費税</td>
              <td className="px-2 py-1 text-right tabular-nums">{calc.result ? (calc.result.tax !== null ? yen(calc.result.tax) : '未確定') : '—'}</td>
              <td />
            </tr>
            <tr className="border-t border-slate-300">
              <td colSpan={columnCount - 2} className="px-2 py-1.5 text-right font-semibold">税込合計（画面の試算）</td>
              <td className="px-2 py-1.5 text-right text-sm font-semibold tabular-nums" data-testid="v25-wb-total">
                {calc.result ? (calc.result.total !== null ? yen(calc.result.total) : '未確定（別途見積を含む）') : '—'}
              </td>
              <td className="px-2 py-1.5 text-[0.68rem] text-muted">保存済み {savedTotal !== null ? yen(savedTotal) : '未確定'}</td>
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
    </section>
  );
}
