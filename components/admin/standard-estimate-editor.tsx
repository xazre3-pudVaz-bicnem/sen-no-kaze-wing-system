'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { publishStandardEstimateRevisionAction, saveStandardEstimateDraftAction } from '@/lib/actions/standard-estimates';
import { formatYen } from '@/lib/domain/pricing';
import type { ExpenseMethod, PriceMode } from '@/lib/domain/standard-estimate-money';
import {
  PRICE_MODE_LABEL,
  STANDARD_SECTION_LABEL,
  moveLineWithinSection,
  previewStandardEstimate,
  toSaveLines,
  type BaseLineView,
  type StandardEstimateEditorState,
  type StandardEstimateLineInput,
  type StandardLineSectionCode,
  type StandardSectionCode,
} from '@/lib/domain/standard-estimate-view';
import { Alert, Button, Input, Select } from '@/components/ui';
import { ConfirmActionButton } from '@/components/admin/confirm-action-button';

type Props = {
  revisionId: string;
  lockVersion: number;
  readOnly: boolean;
  taxRate: string;
  baseLines: BaseLineView[];
  initial: StandardEstimateEditorState;
};

const SECTIONS: StandardSectionCode[] = ['base', 'interior_exterior', 'option', 'sitework'];
const LINE_SECTIONS: StandardLineSectionCode[] = ['interior_exterior', 'option', 'sitework'];
const pct = (value: string) => `${Math.round(Number(value) * 10000) / 100}%`;

export function StandardEstimateEditor({ revisionId, lockVersion, readOnly, taxRate, baseLines, initial }: Props) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const preview = useMemo(() => previewStandardEstimate(baseLines, state, taxRate), [baseLines, state, taxRate]);

  const update = (patch: Partial<StandardEstimateEditorState>) => setState((current) => ({ ...current, ...patch }));
  const updateLine = (index: number, patch: Partial<StandardEstimateLineInput>) =>
    setState((current) => ({ ...current, lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)) }));
  const addLine = (section: StandardLineSectionCode) =>
    setState((current) => ({
      ...current,
      lines: [
        ...current.lines,
        { line_key: null, section_code: section, group_label: null, name: '', quantity: '1', unit: '式', price_mode: 'auto', cost_unit_price: 0, unit_price: null, remark: null },
      ],
    }));
  const removeLine = (index: number) => setState((current) => ({ ...current, lines: current.lines.filter((_, i) => i !== index) }));
  const moveLine = (index: number, direction: -1 | 1) =>
    setState((current) => ({ ...current, lines: moveLineWithinSection(current.lines, index, direction) }));
  const intOrNull = (value: string) => (value.trim() === '' ? null : Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null);

  const save = () =>
    startTransition(async () => {
      const result = await saveStandardEstimateDraftAction({
        revision_id: revisionId,
        expected_lock_version: lockVersion,
        sales_fee_rate: state.sales_fee_rate,
        expense_rate: state.expense_rate,
        markup_rate: state.markup_rate,
        adjustment: state.adjustment,
        adjustment_reason: state.adjustment_reason,
        section_methods: state.section_methods,
        lines: toSaveLines(state.lines),
      });
      setNotice(result.ok ? { tone: 'success', text: result.message } : { tone: 'danger', text: result.error });
      if (result.ok) router.refresh();
    });
  const publish = () =>
    startTransition(async () => {
      const result = await publishStandardEstimateRevisionAction({ revision_id: revisionId, expected_lock_version: lockVersion });
      setNotice(result.ok ? { tone: 'success', text: result.message } : { tone: 'danger', text: result.error });
      if (result.ok) router.refresh();
    });

  return (
    <div className="space-y-5" data-testid="standard-estimate-editor">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <section className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-4">
        {(['sales_fee_rate', 'expense_rate', 'markup_rate'] as const).map((key) => (
          <label key={key} className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">
              {key === 'sales_fee_rate' ? '販売費率（100〜150%）' : key === 'expense_rate' ? '経費率（0〜30%）' : '掛率（100〜250%）'}
            </span>
            <Input value={state[key]} disabled={readOnly} inputMode="decimal" onChange={(e) => update({ [key]: e.target.value } as Partial<StandardEstimateEditorState>)} />
            <span className="text-xs text-muted">{pct(state[key])}</span>
          </label>
        ))}
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">調整額（円・理由が必要）</span>
          <Input value={String(state.adjustment)} disabled={readOnly} inputMode="numeric" onChange={(e) => update({ adjustment: intOrNull(e.target.value) ?? 0 })} />
          <Input value={state.adjustment_reason} disabled={readOnly} placeholder="調整の理由" onChange={(e) => update({ adjustment_reason: e.target.value })} />
        </label>
      </section>

      {SECTIONS.map((section) => {
        const money = preview.sections[section];
        const indexes = state.lines.map((line, index) => ({ line, index })).filter(({ line }) => line.section_code === section);
        return (
          <section key={section} className="space-y-2 rounded-lg border border-line bg-white p-4" data-testid={`standard-estimate-section-${section}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{STANDARD_SECTION_LABEL[section]}</h3>
              <label className="flex items-center gap-2 text-xs text-muted">
                経費
                <Select
                  value={state.section_methods[section]}
                  disabled={readOnly}
                  onChange={(e) => update({ section_methods: { ...state.section_methods, [section]: e.target.value as ExpenseMethod } })}
                >
                  <option value="rate">率（{pct(state.expense_rate)}）</option>
                  <option value="none">なし</option>
                </Select>
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="px-2 py-1">見出し・品名</th>
                    <th className="px-2 py-1 text-right">数量</th>
                    <th className="px-2 py-1">単位</th>
                    <th className="px-2 py-1">価格の決め方</th>
                    <th className="px-2 py-1 text-right">原価単価</th>
                    <th className="px-2 py-1 text-right">売価単価</th>
                    <th className="px-2 py-1 text-right">売価金額</th>
                    <th className="px-2 py-1">備考</th>
                    {!readOnly && section !== 'base' && <th />}
                  </tr>
                </thead>
                <tbody>
                  {section === 'base'
                    ? baseLines.map((line, i) => (
                        <tr key={`${line.section}-${line.name}-${i}`} className="border-t border-line">
                          <td className="px-2 py-1">
                            <span className="text-muted">{line.section}</span> {line.name}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{String(line.quantity)}</td>
                          <td className="px-2 py-1">{line.unit ?? ''}</td>
                          <td className="px-2 py-1 text-muted">本体マスター（自動）</td>
                          <td className="px-2 py-1 text-right tabular-nums">{preview.base[i] ? formatYen(preview.base[i].costUnitPrice ?? 0) : '—'}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{preview.base[i] ? formatYen(preview.base[i].saleUnitPrice ?? 0) : '—'}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{preview.base[i] ? formatYen(preview.base[i].saleAmount ?? 0) : '—'}</td>
                          <td className="px-2 py-1" />
                        </tr>
                      ))
                    : indexes.map(({ line, index }, position) => {
                        const money = preview.lines[index];
                        return (
                          <tr key={index} className="border-t border-line" data-testid="standard-estimate-line">
                            <td className="px-2 py-1">
                              {/* 見出しは見積書の明細の説明欄に出る（例：「２．その他の設備」）。空欄なら見出しなし */}
                              <div className="space-y-1">
                                <Input
                                  value={line.group_label ?? ''}
                                  disabled={readOnly}
                                  aria-label="見出し"
                                  placeholder="見出し（任意）"
                                  className="text-muted"
                                  onChange={(e) => updateLine(index, { group_label: e.target.value || null })}
                                />
                                <Input value={line.name} disabled={readOnly} aria-label="品名" onChange={(e) => updateLine(index, { name: e.target.value })} />
                              </div>
                            </td>
                            <td className="px-2 py-1">
                              <Input value={line.quantity} disabled={readOnly} aria-label="数量" className="w-20 text-right" onChange={(e) => updateLine(index, { quantity: e.target.value })} />
                            </td>
                            <td className="px-2 py-1">
                              <Input value={line.unit ?? ''} disabled={readOnly} aria-label="単位" className="w-16" onChange={(e) => updateLine(index, { unit: e.target.value || null })} />
                            </td>
                            <td className="px-2 py-1">
                              <Select value={line.price_mode} disabled={readOnly} aria-label="価格の決め方" onChange={(e) => updateLine(index, { price_mode: e.target.value as PriceMode })}>
                                {(Object.keys(PRICE_MODE_LABEL) as PriceMode[]).map((mode) => (
                                  <option key={mode} value={mode}>{PRICE_MODE_LABEL[mode]}</option>
                                ))}
                              </Select>
                            </td>
                            <td className="px-2 py-1">
                              <Input
                                value={line.cost_unit_price === null ? '' : String(line.cost_unit_price)}
                                disabled={readOnly || line.price_mode === 'por'}
                                aria-label="原価単価"
                                className="w-28 text-right"
                                inputMode="numeric"
                                onChange={(e) => updateLine(index, { cost_unit_price: intOrNull(e.target.value) })}
                              />
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {line.price_mode === 'manual' ? (
                                <Input
                                  value={line.unit_price === null ? '' : String(line.unit_price)}
                                  disabled={readOnly}
                                  aria-label="売価単価"
                                  className="w-28 text-right"
                                  inputMode="numeric"
                                  onChange={(e) => updateLine(index, { unit_price: intOrNull(e.target.value) })}
                                />
                              ) : money && money.saleUnitPrice !== null ? (
                                formatYen(money.saleUnitPrice)
                              ) : (
                                <span className="text-warn">未確定</span>
                              )}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">{money && money.saleAmount !== null ? formatYen(money.saleAmount) : '—'}</td>
                            <td className="px-2 py-1">
                              <Input value={line.remark ?? ''} disabled={readOnly} aria-label="備考" onChange={(e) => updateLine(index, { remark: e.target.value || null })} />
                            </td>
                            {!readOnly && (
                              <td className="px-2 py-1">
                                <div className="flex items-center gap-1">
                                  <Button type="button" variant="ghost" size="sm" aria-label="上へ" disabled={position === 0} onClick={() => moveLine(index, -1)}>
                                    ↑
                                  </Button>
                                  <Button type="button" variant="ghost" size="sm" aria-label="下へ" disabled={position === indexes.length - 1} onClick={() => moveLine(index, 1)}>
                                    ↓
                                  </Button>
                                  <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)}>
                                    削除
                                  </Button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              {!readOnly && section !== 'base' && LINE_SECTIONS.includes(section as StandardLineSectionCode) ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => addLine(section as StandardLineSectionCode)}>
                  行を追加
                </Button>
              ) : (
                <span />
              )}
              {money && (
                <span className="tabular-nums text-muted">
                  明細 {formatYen(money.saleLineSubtotal)} ＋ 経費 {formatYen(money.saleExpense)} ＝ {formatYen(money.saleTotal)}（原価 {formatYen(money.costTotal)}）
                  {money.hasPor && <span className="ml-2 text-warn">価格未確定の行は合計に含めていません</span>}
                </span>
              )}
            </div>
          </section>
        );
      })}

      <section className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-line bg-[#fbfcfb] p-4" data-testid="standard-estimate-preview">
        {preview.money ? (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <dt className="text-muted">税抜（調整後）</dt>
            <dd className="tabular-nums sm:col-span-2">{formatYen(preview.money.subtotal)}</dd>
            <dt className="text-muted">消費税</dt>
            <dd className="tabular-nums sm:col-span-2">{formatYen(preview.money.tax)}</dd>
            <dt className="font-semibold">税込合計</dt>
            <dd className="font-semibold tabular-nums sm:col-span-2">{formatYen(preview.money.total)}</dd>
            <dt className="text-muted">内部原価・粗利</dt>
            <dd className="tabular-nums text-muted sm:col-span-2">
              {formatYen(preview.money.costTotal)}・{formatYen(preview.money.grossProfit)}
              {preview.money.grossMarginRatio !== null && `（${Math.round(preview.money.grossMarginRatio * 1000) / 10}%）`}
            </dd>
          </dl>
        ) : (
          <Alert tone="warn">{preview.errors.join(' / ') || '入力内容を確認してください'}</Alert>
        )}
        {!readOnly && (
          <div className="flex gap-2">
            <Button type="button" disabled={pending || preview.errors.length > 0} onClick={save} data-testid="standard-estimate-save">
              保存
            </Button>
            <ConfirmActionButton
              className="btn-secondary btn-sm"
              disabled={pending}
              message="保存済みの標準見積を公開します。公開後、このRevisionは直接変更できません。変更する場合は新しい下書きRevisionを作成します。"
              dialogTitle="標準見積を公開しますか？"
              confirmLabel="公開する"
              onConfirm={publish}
              data-testid="standard-estimate-publish"
            >
              保存済みの内容で公開
            </ConfirmActionButton>
          </div>
        )}
      </section>
      <p className="text-xs text-muted">
        画面の金額は試算です。保存すると DB が同じ式（すべての計算で切り捨て）で計算し直します。公開すると、この Revision は変更できなくなります。
      </p>
    </div>
  );
}