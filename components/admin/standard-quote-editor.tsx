'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { finalizeStandardQuoteDraftAction, saveStandardQuoteDraftAction } from '@/lib/actions/standard-quotes';
import { formatYen } from '@/lib/domain/pricing';
import { chooseQuoteLineState, QUOTE_LINE_STATE_LABELS, type QuoteLineState } from '@/lib/domain/quote-por';
import type { ExpenseMethod, PriceMode } from '@/lib/domain/standard-estimate-money';
import { PRICE_MODE_LABEL, STANDARD_SECTION_LABEL, type StandardSectionCode } from '@/lib/domain/standard-estimate-view';
import {
  STANDARD_QUOTE_EXPENSE_LABEL,
  STANDARD_QUOTE_SECTIONS,
  previewStandardQuote,
  toStandardQuoteSaveLines,
  type StandardQuoteEditorState,
  type StandardQuoteLineInput,
} from '@/lib/domain/standard-quote-view';
import { Alert, Button, Input, Select, Textarea } from '@/components/ui';
import { ConfirmActionButton } from '@/components/admin/confirm-action-button';

type Props = {
  draftId: string;
  lockVersion: number;
  taxRate: string;
  /** 保存済みの明細のうち、金額が未確定の行の品名（残っていれば発行できない。POR を含む） */
  savedUnresolvedNames: string[];
  initial: StandardQuoteEditorState;
};

const pct = (value: string) => `${Math.round(Number(value) * 10000) / 100}%`;

/** 価格の決め方の選択肢。「0円確定」「対象外」は本体以外の区分だけ（price_mode は manual・売価 0 円） */
type PriceChoice = PriceMode | QuoteLineState;

export function StandardQuoteEditor({ draftId, lockVersion, taxRate, savedUnresolvedNames, initial }: Props) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const preview = useMemo(() => previewStandardQuote(state, taxRate), [state, taxRate]);

  const update = (patch: Partial<StandardQuoteEditorState>) => {
    setState((current) => ({ ...current, ...patch }));
    setDirty(true);
  };
  const updateLine = (index: number, patch: Partial<StandardQuoteLineInput>) => {
    setState((current) => ({ ...current, lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)) }));
    setDirty(true);
  };
  const addLine = (section: StandardSectionCode) => {
    setState((current) => ({
      ...current,
      lines: [
        ...current.lines,
        { line_key: null, section_code: section, name: '', description: null, quantity: '1', unit: '式', price_mode: 'auto', base_unit_cost: null, cost_unit_price: 0, unit_price: null, remark: null, line_state: null, line_state_reason: '' },
      ],
    }));
    setDirty(true);
  };
  const removeLine = (index: number) => {
    setState((current) => ({ ...current, lines: current.lines.filter((_, i) => i !== index) }));
    setDirty(true);
  };
  const intOrNull = (value: string) => (value.trim() === '' ? null : Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : null);
  // 「0円確定」「対象外」は「金額を入力」の 0 円の行にし、理由・メモが空なら今の備考を入れておく
  const choosePrice = (index: number, choice: PriceChoice) => {
    setState((current) => ({
      ...current,
      lines: current.lines.map((line, i) => {
        if (i !== index) return line;
        if (choice === 'excluded' || choice === 'zero_confirmed') return { ...chooseQuoteLineState(line, choice), price_mode: 'manual' };
        return { ...chooseQuoteLineState(line, null), price_mode: choice };
      }),
    }));
    setDirty(true);
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveStandardQuoteDraftAction({
        draft_id: draftId,
        expected_lock_version: lockVersion,
        sales_fee_rate: state.sales_fee_rate,
        expense_rate: state.expense_rate,
        markup_rate: state.markup_rate,
        expense_methods: state.expense_methods,
        adjustment: state.adjustment,
        adjustment_reason: state.adjustment_reason,
        notes: state.notes,
        lines: toStandardQuoteSaveLines(state.lines),
      });
      setNotice(result.ok ? { tone: 'success', text: result.message } : { tone: 'danger', text: result.error });
      if (result.ok) router.refresh();
    });
  const finalize = () =>
    startTransition(async () => {
      const result = await finalizeStandardQuoteDraftAction({ draft_id: draftId, expected_lock_version: lockVersion });
      if (result && !result.ok) setNotice({ tone: 'danger', text: result.error });
    });

  const blockFinalize = dirty || savedUnresolvedNames.length > 0;

  return (
    <div className="space-y-5" data-testid="standard-quote-editor">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <section className="grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-4" aria-label="社内計算条件">
        {(['sales_fee_rate', 'expense_rate', 'markup_rate'] as const).map((key) => (
          <label key={key} className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">
              {key === 'sales_fee_rate' ? '販売費率（100〜150%）' : key === 'expense_rate' ? '経費率（0〜30%）' : '掛率（100〜250%）'}
            </span>
            <Input value={state[key]} inputMode="decimal" onChange={(e) => update({ [key]: e.target.value } as Partial<StandardQuoteEditorState>)} />
            <span className="text-xs text-muted">{pct(state[key])}</span>
          </label>
        ))}
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">調整額（円）</span>
          <Input value={String(state.adjustment)} inputMode="numeric" onChange={(e) => update({ adjustment: intOrNull(e.target.value) ?? 0 })} />
          <Input value={state.adjustment_reason} placeholder="調整の理由（任意）" onChange={(e) => update({ adjustment_reason: e.target.value })} />
        </label>
        <p className="text-xs text-muted sm:col-span-4">
          率を変えても元の標準見積には反映しません。率・内部原価はお客様・代理店には表示しません。
        </p>
      </section>

      {STANDARD_QUOTE_SECTIONS.map((section) => {
        const money = preview.sections[section];
        const indexes = state.lines.map((line, index) => ({ line, index })).filter(({ line }) => line.section_code === section);
        return (
          <section key={section} className="space-y-2 rounded-lg border border-line bg-white p-4" data-testid={`standard-quote-section-${section}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{STANDARD_SECTION_LABEL[section]}</h3>
              <label className="flex items-center gap-2 text-xs text-muted">
                経費
                <Select value={state.expense_methods[section]} onChange={(e) => update({ expense_methods: { ...state.expense_methods, [section]: e.target.value as ExpenseMethod } })}>
                  <option value="rate">率（{pct(state.expense_rate)}）</option>
                  <option value="none">なし</option>
                </Select>
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] text-left text-xs">
                <thead className="text-muted">
                  <tr>
                    <th className="px-2 py-1">品名</th>
                    <th className="px-2 py-1">説明</th>
                    <th className="px-2 py-1 text-right">数量</th>
                    <th className="px-2 py-1">単位</th>
                    <th className="px-2 py-1">価格の決め方</th>
                    <th className="px-2 py-1 text-right">原価単価</th>
                    <th className="px-2 py-1 text-right">売価単価</th>
                    <th className="px-2 py-1 text-right">売価金額</th>
                    <th className="px-2 py-1">備考</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {indexes.map(({ line, index }) => {
                    const lineMoney = preview.lines[index];
                    const fromBase = line.base_unit_cost !== null;
                    return (
                      <tr key={line.line_key ?? `new-${index}`} className="border-t border-line" data-testid="standard-quote-line">
                        <td className="px-2 py-1">
                          <Input value={line.name} aria-label="品名" onChange={(e) => updateLine(index, { name: e.target.value })} />
                        </td>
                        <td className="px-2 py-1">
                          <Input value={line.description ?? ''} aria-label="説明" onChange={(e) => updateLine(index, { description: e.target.value || null })} />
                        </td>
                        <td className="px-2 py-1">
                          <Input value={line.quantity} aria-label="数量" className="w-20 text-right" onChange={(e) => updateLine(index, { quantity: e.target.value })} />
                        </td>
                        <td className="px-2 py-1">
                          <Input value={line.unit ?? ''} aria-label="単位" className="w-16" onChange={(e) => updateLine(index, { unit: e.target.value || null })} />
                        </td>
                        <td className="px-2 py-1">
                          <Select value={line.line_state ?? line.price_mode} aria-label="価格の決め方" onChange={(e) => choosePrice(index, e.target.value as PriceChoice)}>
                            {(Object.keys(PRICE_MODE_LABEL) as PriceMode[]).map((mode) => (
                              <option key={mode} value={mode}>{PRICE_MODE_LABEL[mode]}</option>
                            ))}
                            {section !== 'base' &&
                              (['zero_confirmed', 'excluded'] as const).map((state) => (
                                <option key={state} value={state}>{QUOTE_LINE_STATE_LABELS[state]}</option>
                              ))}
                          </Select>
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {fromBase ? (
                            <span title="本体マスターの基準原価単価 × 販売費率">
                              {lineMoney && lineMoney.costUnitPrice !== null ? formatYen(lineMoney.costUnitPrice) : '—'}
                              <span className="block text-[10px] text-muted">本体マスター</span>
                            </span>
                          ) : (
                            <Input
                              value={line.line_state === 'excluded' ? '0' : line.cost_unit_price === null ? '' : String(line.cost_unit_price)}
                              disabled={line.price_mode === 'por' || line.line_state === 'excluded'}
                              title={line.line_state === 'excluded' ? '対象外の行は今回の契約に含めないため、原価も 0 円です' : undefined}
                              aria-label="原価単価"
                              className="w-28 text-right"
                              inputMode="numeric"
                              onChange={(e) => updateLine(index, { cost_unit_price: intOrNull(e.target.value) })}
                            />
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {line.line_state ? (
                            <span className="text-muted">{QUOTE_LINE_STATE_LABELS[line.line_state]}</span>
                          ) : line.price_mode === 'manual' ? (
                            <Input
                              value={line.unit_price === null ? '' : String(line.unit_price)}
                              aria-label="売価単価"
                              className="w-28 text-right"
                              inputMode="numeric"
                              onChange={(e) => updateLine(index, { unit_price: intOrNull(e.target.value) })}
                            />
                          ) : lineMoney && lineMoney.saleUnitPrice !== null ? (
                            formatYen(lineMoney.saleUnitPrice)
                          ) : (
                            <span className="text-warn">未確定</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {line.line_state === 'excluded' ? '対象外' : lineMoney && lineMoney.saleAmount !== null ? formatYen(lineMoney.saleAmount) : '—'}
                        </td>
                        <td className="px-2 py-1">
                          {line.line_state ? (
                            <Input
                              value={line.line_state_reason}
                              maxLength={190}
                              placeholder={line.line_state === 'zero_confirmed' ? '0円確定の理由（必須）' : 'メモ（任意）'}
                              aria-label={line.line_state === 'zero_confirmed' ? '0円確定の理由' : '対象外のメモ'}
                              onChange={(e) => updateLine(index, { line_state_reason: e.target.value })}
                            />
                          ) : (
                            <Input value={line.remark ?? ''} aria-label="備考" onChange={(e) => updateLine(index, { remark: e.target.value || null })} />
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)}>
                            削除
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {money && money.saleExpense + money.costExpense !== 0 && (
                    <tr className="border-t border-line bg-[#fbfcfb] text-muted" data-testid="standard-quote-expense">
                      <td className="px-2 py-1">{STANDARD_QUOTE_EXPENSE_LABEL[section]}</td>
                      <td className="px-2 py-1">明細小計 × 経費率（保存のたびに計算し直します）</td>
                      <td className="px-2 py-1 text-right">1</td>
                      <td className="px-2 py-1">式</td>
                      <td className="px-2 py-1">自動</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatYen(money.costExpense)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatYen(money.saleExpense)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatYen(money.saleExpense)}</td>
                      <td className="px-2 py-1" />
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <Button type="button" variant="secondary" size="sm" onClick={() => addLine(section)}>
                行を追加
              </Button>
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

      <section className="space-y-2 rounded-lg border border-line bg-white p-4">
        <label className="block space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">メモ（見積書の備考）</span>
          <Textarea value={state.notes} rows={3} onChange={(e) => update({ notes: e.target.value })} />
        </label>
      </section>

      <section className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-line bg-[#fbfcfb] p-4" data-testid="standard-quote-preview">
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
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <Button type="button" disabled={pending || preview.errors.length > 0} onClick={save} data-testid="standard-quote-save">
              保存
            </Button>
            <ConfirmActionButton
              className="btn-secondary btn-sm"
              disabled={pending || blockFinalize}
              message="保存済みの内容で正式な見積書として発行します。発行後は変更できません。変更する場合は次の版を作成します。"
              dialogTitle="正式な見積書を発行しますか？"
              confirmLabel="発行する"
              onConfirm={finalize}
              data-testid="standard-quote-finalize"
            >
              保存済みの内容で発行
            </ConfirmActionButton>
          </div>
          {dirty && <span className="text-xs text-muted">保存していない変更があります。発行の前に保存してください。</span>}
          {!dirty && savedUnresolvedNames.length > 0 && (
            <span className="max-w-md text-right text-xs text-warn" data-testid="standard-quote-unresolved">
              金額が未確定の行があるため発行できません（{savedUnresolvedNames.join('、')}）。自動か売価の入力で金額を確定するか、
              「0円確定」（理由が必要）か「対象外」を選んで保存してください。
            </span>
          )}
        </div>
      </section>
      <p className="text-xs text-muted">
        画面の金額は試算です。保存すると DB が同じ式（すべての計算で切り捨て）で計算し直し、経費の行も作り直します。
      </p>
    </div>
  );
}