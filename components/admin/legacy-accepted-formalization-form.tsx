'use client';

import { useActionState, useMemo, useState } from 'react';
import { formalizeLegacyAcceptedQuoteAction } from '@/lib/actions/legacy-accepted-formalization';
import type { QuoteItem } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import {
  chooseQuoteLineState,
  createUnresolvedLineCheck,
  EMPTY_POR_SELECTION_STATE,
  QUOTE_LINE_STATE_LABELS,
  splitQuoteLineStateRemark,
  type QuoteLineState,
  type QuotePorSelectionState,
} from '@/lib/domain/quote-por';
import { QuotePorReview, type QuotePorReviewPatch, type QuotePorReviewRow } from './quote-por-review';

interface InstallationRow {
  key: string;
  source_item_id: string | null;
  /** 元の明細の説明（DB は元の明細の説明を新しい明細へ写す。金額未確定の判定に使う） */
  description: string | null;
  name: string;
  unit: string;
  remark: string;
  unit_price: number;
  quantity: number;
  /** 扱い（0円確定・対象外）。発行のときにサーバーが備考の印にする */
  line_state: QuoteLineState | null;
  line_state_reason: string;
}

const initialState = { ok: false } as const;

function initialRow(item: QuoteItem): InstallationRow {
  return {
    key: item.id,
    source_item_id: item.id,
    description: item.description ?? null,
    name: item.name,
    unit: item.unit ?? '式',
    ...splitQuoteLineStateRemark(item.remark),
    unit_price: item.unit_price,
    quantity: item.quantity,
  };
}

function amountOf(row: InstallationRow) {
  return Math.round(row.unit_price * row.quantity);
}

export function LegacyAcceptedFormalizationForm({
  quoteId,
  installationItems,
  carriedItems = [],
  defaultDealerNote,
  porState = EMPTY_POR_SELECTION_STATE,
}: {
  quoteId: string;
  installationItems: QuoteItem[];
  /** 施工以外の明細（そのまま確定見積へ写る。この画面では直せない） */
  carriedItems?: QuoteItem[];
  defaultDealerNote: string | null;
  /** お客様が選んだ別途見積の商品と、自分の確認が済んでいるか（D1 までの暫定） */
  porState?: QuotePorSelectionState;
}) {
  const [state, action, pending] = useActionState(formalizeLegacyAcceptedQuoteAction, initialState);
  const [rows, setRows] = useState<InstallationRow[]>(() => installationItems.map(initialRow));
  const [dealerNote, setDealerNote] = useState(defaultDealerNote ?? '');

  // ---- 金額未確定の確認（D1 までの暫定。発行を止めるのは DB で、ここでは先に案内する） ----
  // 前の版（承諾済みの概算）の「0 円・印なし・別途見積の目印なし」の同じ明細は、変えていなければ 0 円のままでよい
  const isUnresolved = useMemo(
    () => createUnresolvedLineCheck({ parentLines: [...carriedItems, ...installationItems] }),
    [carriedItems, installationItems]
  );
  const checkRow = (row: InstallationRow) => isUnresolved({ ...row, kind: 'installation' });
  const [porConfirmed, setPorConfirmed] = useState(porState.confirmed);
  const [initialPorRowKeys] = useState(
    () => new Set(installationItems.map(initialRow).filter(checkRow).map((row) => row.key))
  );
  const porRows: QuotePorReviewRow[] = [
    ...carriedItems
      .filter((item) => isUnresolved(item))
      .map((item) => ({
        key: item.id,
        name: item.name,
        sectionLabel: '施工以外',
        unitPrice: item.unit_price,
        remark: item.remark ?? '',
        lineState: null,
        lineStateReason: '',
        unresolved: true,
        editable: false,
        note: 'この画面では施工の金額だけを入れられるため、この明細は直せません。本部にご相談ください',
      })),
    ...rows
      .filter((row) => initialPorRowKeys.has(row.key) || row.line_state !== null || checkRow(row))
      .map((row) => ({
        key: row.key,
        name: row.name,
        sectionLabel: '施工',
        unitPrice: row.unit_price,
        remark: row.remark,
        lineState: row.line_state,
        lineStateReason: row.line_state_reason,
        unresolved: checkRow(row),
        editable: true,
      })),
  ];
  const porSelections = porState.available ? porState.selections : [];
  const unresolvedPorCount = porRows.filter((row) => row.unresolved).length;
  const missingReasonCount = rows.filter((row) => row.line_state === 'zero_confirmed' && !row.line_state_reason.trim()).length;
  const porBlockers = [
    ...(unresolvedPorCount > 0 ? [`金額が未確定の明細が ${unresolvedPorCount} 行残っています`] : []),
    ...(missingReasonCount > 0 ? [`「0円確定」の理由が入っていない明細が ${missingReasonCount} 行あります`] : []),
    ...(porSelections.length > 0 && !porConfirmed ? ['お客様が選んだ別途見積の商品の確認にチェックを入れてください'] : []),
  ];

  const installationTotal = useMemo(
    () => rows.reduce((sum, row) => sum + amountOf(row), 0),
    [rows]
  );

  const addRow = () => {
    setRows((current) => [
      ...current,
      {
        key: `new-${crypto.randomUUID()}`,
        source_item_id: null,
        description: null,
        name: '',
        unit: '式',
        remark: '',
        unit_price: 0,
        quantity: 1,
        line_state: null,
        line_state_reason: '',
      },
    ]);
  };

  const updateRow = (key: string, patch: Partial<InstallationRow>) => {
    // 「0円確定」「対象外」を選んだ行は 0 円にし、理由・メモが空なら今の備考を入れておく（戻したら金額を入れ直す）
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const { line_state: state, ...rest } = patch;
        const next = { ...row, ...rest };
        return state !== undefined ? chooseQuoteLineState(next, state) : next;
      })
    );
  };
  const updatePorRow = (key: string, patch: QuotePorReviewPatch) =>
    updateRow(key, {
      ...(patch.unitPrice !== undefined ? { unit_price: patch.unitPrice } : {}),
      ...(patch.remark !== undefined ? { remark: patch.remark } : {}),
      ...(patch.lineState !== undefined ? { line_state: patch.lineState } : {}),
      ...(patch.lineStateReason !== undefined ? { line_state_reason: patch.lineStateReason } : {}),
    });

  const removeRow = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key));
  };

  const payload = rows.map((row) => ({
    source_item_id: row.source_item_id,
    name: row.name,
    unit: row.unit,
    remark: row.remark,
    unit_price: row.unit_price,
    quantity: row.quantity,
    line_state: row.line_state,
    line_state_reason: row.line_state ? row.line_state_reason : '',
  }));

  return (
    <form action={action} className="space-y-3" data-testid="legacy-accepted-formalization-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="items_json" value={JSON.stringify(payload)} />

      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {state.error}
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#f7faf8] px-3 py-2">
          <div>
            <h2 className="text-sm font-semibold text-[#315745]">現地確認後の施工金額</h2>
            <p className="mt-0.5 text-[0.68rem] text-muted">
              基礎・運搬・設置・給排水・電気など、今回の確定見積へ含める施工金額だけを入力します。
            </p>
          </div>
          <button type="button" onClick={addRow} className="btn-secondary btn-sm" data-testid="formalization-add-installation">
            ＋施工明細を追加
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-xs">
            <thead className="bg-[#eef3f2] text-[#536771]">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">品名</th>
                <th className="w-24 px-2 py-1.5 text-right font-semibold">数量</th>
                <th className="w-20 px-2 py-1.5 text-left font-semibold">単位</th>
                <th className="w-32 px-2 py-1.5 text-right font-semibold">単価</th>
                <th className="w-32 px-2 py-1.5 text-right font-semibold">金額</th>
                <th className="w-28 px-2 py-1.5 text-left font-semibold">扱い</th>
                <th className="w-48 px-2 py-1.5 text-left font-semibold">備考・理由</th>
                <th className="w-16 px-2 py-1.5" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted">
                    施工明細はまだありません。追加金額がない場合は0件のまま確定見積を発行できます。
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.key} className="border-t border-line">
                    <td className="px-2 py-1.5">
                      <input
                        value={row.name}
                        onChange={(event) => updateRow(row.key, { name: event.target.value })}
                        className="w-full rounded border border-line px-2 py-1.5"
                        maxLength={120}
                        aria-label="施工品名"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0.01"
                        max="99999"
                        step="0.0001"
                        value={row.quantity}
                        onChange={(event) => updateRow(row.key, { quantity: Number(event.target.value) })}
                        className="w-full rounded border border-line px-2 py-1.5 text-right tabular-nums"
                        aria-label="施工数量"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={row.unit}
                        onChange={(event) => updateRow(row.key, { unit: event.target.value })}
                        className="w-full rounded border border-line px-2 py-1.5"
                        maxLength={12}
                        aria-label="施工単位"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {row.line_state ? (
                        <span className="block px-2 py-1.5 text-right text-muted">{QUOTE_LINE_STATE_LABELS[row.line_state]}</span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          max="100000000"
                          step="1"
                          value={row.unit_price}
                          onChange={(event) => updateRow(row.key, { unit_price: Number(event.target.value) })}
                          className="w-full rounded border border-line px-2 py-1.5 text-right tabular-nums"
                          aria-label="施工単価"
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                      {row.line_state === 'excluded' ? '対象外' : formatYen(amountOf(row))}
                    </td>
                    <td className={`px-2 py-1.5 ${!row.line_state && checkRow(row) ? 'bg-amber-50' : ''}`}>
                      <select
                        value={row.line_state ?? ''}
                        onChange={(event) => updateRow(row.key, { line_state: (event.target.value || null) as QuoteLineState | null })}
                        className="w-full rounded border border-line bg-white px-1.5 py-1.5"
                        aria-label="施工の扱い"
                        data-testid="formalization-line-state"
                      >
                        <option value="">{checkRow(row) ? '未確定' : '確定'}</option>
                        <option value="zero_confirmed">0円確定</option>
                        <option value="excluded">対象外</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      {row.line_state ? (
                        <input
                          value={row.line_state_reason}
                          onChange={(event) => updateRow(row.key, { line_state_reason: event.target.value })}
                          className="w-full rounded border border-line px-2 py-1.5"
                          maxLength={150}
                          placeholder={row.line_state === 'zero_confirmed' ? '0円確定の理由（必須）' : 'メモ（任意）'}
                          aria-label={row.line_state === 'zero_confirmed' ? '0円確定の理由' : '対象外のメモ'}
                        />
                      ) : (
                        <input
                          value={row.remark}
                          onChange={(event) => updateRow(row.key, { remark: event.target.value })}
                          className="w-full rounded border border-line px-2 py-1.5"
                          maxLength={200}
                          aria-label="施工備考"
                        />
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(row.key)}
                        className="text-[0.68rem] font-semibold text-red-700 hover:underline"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="border-t border-line bg-[#fbfcfb]">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right font-semibold text-muted">施工金額計</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatYen(installationTotal)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-3 shadow-sm">
        <label htmlFor="formalization-dealer-note" className="text-xs font-semibold text-[#315745]">担当者申し送り</label>
        <textarea
          id="formalization-dealer-note"
          name="dealer_note"
          value={dealerNote}
          onChange={(event) => setDealerNote(event.target.value)}
          maxLength={1000}
          rows={3}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          placeholder="現地条件・施工範囲・注意事項など"
        />
      </section>

      <div className="overflow-hidden rounded-lg border border-amber-200 shadow-sm">
        <QuotePorReview
          rows={porRows}
          selections={porSelections}
          confirmed={porConfirmed}
          onConfirmedChange={setPorConfirmed}
          onUpdate={updatePorRow}
        />
      </div>

      <section className="rounded-lg border-2 border-[#d9b65f] bg-[#fff9e9] p-3">
        <p className="text-sm font-semibold text-[#6f5518]">発行すると新しい確定見積になります</p>
        <p className="mt-1 text-xs leading-5 text-ink-soft">
          承諾済みの概算見積は履歴としてそのまま残ります。金額・税・千円未満調整は送信値ではなくDB側で再計算し、現在の見積だけを新しい確定見積へ切り替えます。
        </p>
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            disabled={pending || porBlockers.length > 0}
            className="btn-primary"
            data-testid="formalization-submit"
          >
            {pending ? '発行中…' : '施工金額を反映して確定見積を発行'}
          </button>
        </div>
        {porBlockers.length > 0 && (
          <p className="mt-2 text-right text-xs font-semibold text-amber-900" data-testid="formalization-por-blockers">
            発行できない理由：{porBlockers.join('／')}
          </p>
        )}
      </section>
    </form>
  );
}
