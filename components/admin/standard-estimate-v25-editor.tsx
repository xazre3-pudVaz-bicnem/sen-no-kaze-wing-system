'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  publishStandardEstimateV25RevisionAction,
  refreshStandardEstimateV25CostsAction,
  saveStandardEstimateV25DraftAction,
} from '@/lib/actions/standard-estimate-v25';
import { formatYen } from '@/lib/domain/pricing';
import { STANDARD_SECTION_LABEL, type StandardLineSectionCode } from '@/lib/domain/standard-estimate-view';
import {
  V25_COST_STATUS_LABEL,
  V25_LINE_PRICE_MODE_LABEL,
  V25_SLOT_PRICE_MODE_LABEL,
  buildV25SavePayload,
  slotCostStatus,
  v25PublishBlockers,
  validateV25EditorState,
  type V25CostStatus,
  type V25EditorState,
  type V25LinePriceMode,
  type V25LineRow,
  type V25Preview,
  type V25ProductCandidate,
  type V25SlotPriceMode,
  type V25SlotRow,
} from '@/lib/domain/standard-estimate-v25-view';
import { Alert, Badge, Button, Input, Select } from '@/components/ui';
import { ConfirmActionButton } from '@/components/admin/confirm-action-button';

export type V25SavedAmount = { amount: number | null; sale_unit_price: number | null };

const COST_TONE: Record<V25CostStatus, 'success' | 'warn' | 'danger'> = { current: 'success', stale: 'warn', missing: 'danger' };
const LINE_SECTIONS: StandardLineSectionCode[] = ['interior_exterior', 'option', 'sitework'];

let rowSeq = 0;
const newKey = (prefix: string) => `${prefix}-new-${(rowSeq += 1)}`;

/**
 * 標準見積の v2.5 の編集（商品台帳の商品・バリエーションの選択枠と、工事費などの明細）。
 * 金額・原価 Version の固定・公開の可否は DB が決める。保存すると DB が計算し直し、画面は保存済みの内容で作り直す。
 */
export function StandardEstimateV25Editor({
  revisionId,
  lockVersion,
  readOnly,
  initial,
  candidates,
  savedSlotAmounts,
  savedLineAmounts,
  preview,
}: {
  revisionId: string;
  lockVersion: number;
  readOnly: boolean;
  initial: V25EditorState;
  candidates: V25ProductCandidate[];
  /** baseline_key → 保存済みの金額 */
  savedSlotAmounts: Record<string, V25SavedAmount>;
  /** line_key → 保存済みの金額 */
  savedLineAmounts: Record<string, number | null>;
  preview: V25Preview | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<V25EditorState>(initial);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const candidateById = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);
  const grouped = useMemo(() => {
    const map = new Map<string, V25ProductCandidate[]>();
    for (const candidate of candidates.filter((row) => !row.retired)) map.set(candidate.categoryName, [...(map.get(candidate.categoryName) ?? []), candidate]);
    return [...map.entries()];
  }, [candidates]);
  const previewByKey = useMemo(() => new Map((preview?.slots ?? []).map((slot) => [slot.baseline_key, slot])), [preview]);
  const dirty = useMemo(() => JSON.stringify(state) !== JSON.stringify(initial), [state, initial]);
  const blockers = v25PublishBlockers(preview, dirty);
  const reviewCount = state.lines.filter((line) => line.review_required).length;

  const setSlot = (key: string, patch: Partial<V25SlotRow>) =>
    setState((current) => ({ ...current, slots: current.slots.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)) }));
  const setLine = (key: string, patch: Partial<V25LineRow>) =>
    setState((current) => ({ ...current, lines: current.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));

  const run = (task: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) =>
    startTransition(async () => {
      const result = await task();
      setNotice(result.ok ? { tone: 'success', text: result.message } : { tone: 'danger', text: result.error });
      if (result.ok) router.refresh();
    });

  const save = () => {
    const problem = validateV25EditorState(state);
    if (problem) {
      setNotice({ tone: 'danger', text: problem });
      return;
    }
    run(() => saveStandardEstimateV25DraftAction({ revision_id: revisionId, expected_lock_version: lockVersion, payload: buildV25SavePayload(state) }));
  };

  return (
    <section className="space-y-4 rounded-lg border border-line bg-white p-4" data-testid="standard-estimate-v25-editor">
      <div className="space-y-1">
        <h3 className="font-semibold">v2.5 の標準見積（商品台帳の商品から計算）</h3>
        <p className="text-xs leading-5 text-muted">
          商品は商品台帳の商品とバリエーションを選びます。auto の商品は、固定した商品の標準原価から計算します（同じ商品・同じ選択肢のまま保存しても原価は変わりません。
          原価の更新を反映するときは「最新原価を取り込む」を押します）。工事費などは明細として、金額が確定していれば売価を入力し、確定しなければ別途見積にします（0 円にはしません）。
        </p>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {reviewCount > 0 && (
        <Alert tone="warn">
          以前の標準見積から写した明細が {reviewCount} 行あります（「要見直し」）。商品台帳の商品に置き換えるか、金額を確認して「見直し済み」にしてください。
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-5">
        {(['sales_fee_rate', 'markup_rate', 'expense_rate'] as const).map((key) => (
          <label key={key} className="space-y-1 text-xs">
            <span className="text-muted">{key === 'sales_fee_rate' ? '販売費率' : key === 'markup_rate' ? '掛率' : '経費率'}</span>
            <Input
              value={state[key]}
              disabled={readOnly}
              inputMode="decimal"
              onChange={(event) => setState((current) => ({ ...current, [key]: event.target.value }))}
              data-testid={`v25-${key}`}
            />
          </label>
        ))}
        <label className="space-y-1 text-xs">
          <span className="text-muted">調整額（税別・円）</span>
          <Input value={state.adjustment} disabled={readOnly} inputMode="numeric" onChange={(event) => setState((current) => ({ ...current, adjustment: event.target.value }))} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted">調整額の理由</span>
          <Input value={state.adjustment_reason} disabled={readOnly} onChange={(event) => setState((current) => ({ ...current, adjustment_reason: event.target.value }))} />
        </label>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">商品（商品台帳）</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-left text-xs" data-testid="v25-slots">
            <thead className="text-muted">
              <tr>
                <th className="px-2 py-1">商品</th>
                <th className="px-2 py-1">選択肢</th>
                <th className="px-2 py-1">区分</th>
                <th className="px-2 py-1 text-right">数量</th>
                <th className="px-2 py-1">価格の決め方</th>
                <th className="px-2 py-1 text-right">売価単価</th>
                <th className="px-2 py-1">原価</th>
                <th className="px-2 py-1 text-right">保存済みの金額</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {state.slots.map((slot) => {
                const candidate = candidateById.get(slot.option_id);
                const saved = slot.baseline_key ? savedSlotAmounts[slot.baseline_key] : undefined;
                const status = slot.baseline_key ? slotCostStatus(previewByKey.get(slot.baseline_key)) : null;
                return (
                  <tr key={slot.key} className="border-t border-line align-top">
                    <td className="px-2 py-1">
                      <Select
                        value={slot.option_id}
                        disabled={readOnly}
                        aria-label="商品"
                        onChange={(event) => setSlot(slot.key, { option_id: event.target.value, variant_choices: {} })}
                      >
                        <option value="">商品を選ぶ</option>
                        {candidate?.retired && <option value={candidate.id} disabled>{candidate.name}（取扱終了）</option>}
                        {grouped.map(([categoryName, rows]) => (
                          <optgroup key={categoryName} label={categoryName}>
                            {rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                          </optgroup>
                        ))}
                      </Select>
                    </td>
                    <td className="space-y-1 px-2 py-1">
                      {(candidate?.variantGroups ?? []).map((group) => (
                        <Select
                          key={group.id}
                          value={slot.variant_choices[group.id] ?? ''}
                          disabled={readOnly}
                          aria-label={group.name}
                          onChange={(event) => setSlot(slot.key, { variant_choices: { ...slot.variant_choices, [group.id]: event.target.value } })}
                        >
                          <option value="">{group.name}を選ぶ</option>
                          {group.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
                        </Select>
                      ))}
                      {candidate && candidate.variantGroups.length === 0 && <span className="text-muted">なし</span>}
                    </td>
                    <td className="px-2 py-1">{candidate ? STANDARD_SECTION_LABEL[candidate.section] : '—'}</td>
                    <td className="px-2 py-1 text-right">
                      <Input className="w-20 text-right" value={slot.quantity} disabled={readOnly} inputMode="decimal" aria-label="数量"
                        onChange={(event) => setSlot(slot.key, { quantity: event.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <Select value={slot.price_mode} disabled={readOnly} aria-label="価格の決め方"
                        onChange={(event) => setSlot(slot.key, { price_mode: event.target.value as V25SlotPriceMode })}>
                        {(Object.keys(V25_SLOT_PRICE_MODE_LABEL) as V25SlotPriceMode[]).map((mode) => (
                          <option key={mode} value={mode}>{V25_SLOT_PRICE_MODE_LABEL[mode]}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1 text-right">
                      {slot.price_mode === 'manual' ? (
                        <Input className="w-28 text-right" value={slot.manual_unit_price} disabled={readOnly} inputMode="numeric" aria-label="売価単価"
                          onChange={(event) => setSlot(slot.key, { manual_unit_price: event.target.value })} />
                      ) : (
                        <span className="tabular-nums">{saved?.sale_unit_price != null ? formatYen(saved.sale_unit_price) : '—'}</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {slot.price_mode !== 'auto' ? (
                        <span className="text-muted">—</span>
                      ) : status ? (
                        <Badge tone={COST_TONE[status]}>{V25_COST_STATUS_LABEL[status]}</Badge>
                      ) : (
                        <span className="text-muted">保存後に表示</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {slot.price_mode === 'por' ? <Badge tone="warn">別途見積</Badge> : saved?.amount != null ? formatYen(saved.amount) : '—'}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {!readOnly && (
                        <button type="button" className="text-danger underline"
                          onClick={() => setState((current) => ({ ...current, slots: current.slots.filter((row) => row.key !== slot.key) }))}>
                          削除
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <Button type="button" variant="secondary" size="sm" data-testid="v25-add-slot"
            onClick={() => setState((current) => ({
              ...current,
              slots: [...current.slots, { key: newKey('slot'), baseline_key: null, option_id: '', variant_choices: {}, quantity: '1', price_mode: 'auto', manual_unit_price: '' }],
            }))}>
            商品を追加
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">明細（工事費など、商品台帳に無いもの）</h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-left text-xs" data-testid="v25-lines">
            <thead className="text-muted">
              <tr>
                <th className="px-2 py-1">区分</th>
                <th className="px-2 py-1">品名</th>
                <th className="px-2 py-1 text-right">数量</th>
                <th className="px-2 py-1">単位</th>
                <th className="px-2 py-1">価格の決め方</th>
                <th className="px-2 py-1 text-right">売価単価</th>
                <th className="px-2 py-1 text-right">保存済みの金額</th>
                <th className="px-2 py-1">確認</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {state.lines.map((line) => (
                <tr key={line.key} className="border-t border-line align-top">
                  <td className="px-2 py-1">
                    <Select value={line.section_code} disabled={readOnly} aria-label="区分"
                      onChange={(event) => setLine(line.key, { section_code: event.target.value as StandardLineSectionCode })}>
                      {LINE_SECTIONS.map((section) => <option key={section} value={section}>{STANDARD_SECTION_LABEL[section]}</option>)}
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    <Input value={line.name} disabled={readOnly} aria-label="品名" onChange={(event) => setLine(line.key, { name: event.target.value })} />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <Input className="w-20 text-right" value={line.quantity} disabled={readOnly} inputMode="decimal" aria-label="明細の数量"
                      onChange={(event) => setLine(line.key, { quantity: event.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <Input className="w-16" value={line.unit} disabled={readOnly} aria-label="単位" onChange={(event) => setLine(line.key, { unit: event.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <Select value={line.price_mode} disabled={readOnly} aria-label="明細の価格の決め方"
                      onChange={(event) => setLine(line.key, { price_mode: event.target.value as V25LinePriceMode })}>
                      {(Object.keys(V25_LINE_PRICE_MODE_LABEL) as V25LinePriceMode[]).map((mode) => (
                        <option key={mode} value={mode}>{V25_LINE_PRICE_MODE_LABEL[mode]}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-1 text-right">
                    {line.price_mode === 'manual' ? (
                      <Input className="w-28 text-right" value={line.unit_price} disabled={readOnly} inputMode="numeric" aria-label="明細の売価単価"
                        onChange={(event) => setLine(line.key, { unit_price: event.target.value })} />
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {line.price_mode === 'por'
                      ? <Badge tone="warn">別途見積</Badge>
                      : line.line_key && savedLineAmounts[line.line_key] != null ? formatYen(savedLineAmounts[line.line_key] as number) : '—'}
                  </td>
                  <td className="px-2 py-1">
                    {line.review_required ? (
                      readOnly ? <Badge tone="warn">要見直し</Badge> : (
                        <button type="button" className="text-navy underline" onClick={() => setLine(line.key, { review_required: false })}>
                          要見直し → 見直し済みにする
                        </button>
                      )
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {!readOnly && (
                      <button type="button" className="text-danger underline"
                        onClick={() => setState((current) => ({ ...current, lines: current.lines.filter((row) => row.key !== line.key) }))}>
                        削除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <Button type="button" variant="secondary" size="sm" data-testid="v25-add-line"
            onClick={() => setState((current) => ({
              ...current,
              lines: [...current.lines, {
                key: newKey('line'), line_key: null, section_code: 'sitework', group_label: '', name: '', quantity: '1', unit: '式',
                price_mode: 'manual', unit_price: '', remark: '', review_required: false,
              }],
            }))}>
            明細を追加
          </Button>
        )}
      </div>

      {!readOnly && (
        <div className="space-y-3 border-t border-line pt-3">
          {blockers.length > 0 && (
            <Alert tone="warn">
              <p className="font-semibold">公開できない理由</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} disabled={pending || !dirty} data-testid="v25-save">
              {pending ? '処理中…' : '保存'}
            </Button>
            <Button type="button" variant="secondary" disabled={pending || dirty} data-testid="v25-refresh"
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
              data-testid="v25-publish"
              onConfirm={() => run(() => publishStandardEstimateV25RevisionAction({ revision_id: revisionId, expected_lock_version: lockVersion }))}
            >
              公開
            </ConfirmActionButton>
          </div>
        </div>
      )}
    </section>
  );
}
