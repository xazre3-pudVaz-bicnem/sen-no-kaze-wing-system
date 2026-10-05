'use client';

import { useActionState, useMemo, useState } from 'react';
import { formalizeLegacyAcceptedQuoteAction } from '@/lib/actions/legacy-accepted-formalization';
import type { QuoteItem } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';

interface InstallationRow {
  key: string;
  source_item_id: string | null;
  name: string;
  unit: string;
  remark: string;
  unit_price: number;
  quantity: number;
}

const initialState = { ok: false } as const;

function initialRow(item: QuoteItem): InstallationRow {
  return {
    key: item.id,
    source_item_id: item.id,
    name: item.name,
    unit: item.unit ?? '式',
    remark: item.remark ?? '',
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
  defaultDealerNote,
}: {
  quoteId: string;
  installationItems: QuoteItem[];
  defaultDealerNote: string | null;
}) {
  const [state, action, pending] = useActionState(formalizeLegacyAcceptedQuoteAction, initialState);
  const [rows, setRows] = useState<InstallationRow[]>(() => installationItems.map(initialRow));
  const [dealerNote, setDealerNote] = useState(defaultDealerNote ?? '');

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
        name: '',
        unit: '式',
        remark: '',
        unit_price: 0,
        quantity: 1,
      },
    ]);
  };

  const updateRow = (key: string, patch: Partial<InstallationRow>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

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
                <th className="w-48 px-2 py-1.5 text-left font-semibold">備考</th>
                <th className="w-16 px-2 py-1.5" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted">
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
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatYen(amountOf(row))}</td>
                    <td className="px-2 py-1.5">
                      <input
                        value={row.remark}
                        onChange={(event) => updateRow(row.key, { remark: event.target.value })}
                        className="w-full rounded border border-line px-2 py-1.5"
                        maxLength={200}
                        aria-label="施工備考"
                      />
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
                <td colSpan={2} />
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

      <section className="rounded-lg border-2 border-[#d9b65f] bg-[#fff9e9] p-3">
        <p className="text-sm font-semibold text-[#6f5518]">発行すると新しい確定見積になります</p>
        <p className="mt-1 text-xs leading-5 text-ink-soft">
          承諾済みの概算見積は履歴としてそのまま残ります。金額・税・千円未満調整は送信値ではなくDB側で再計算し、現在の見積だけを新しい確定見積へ切り替えます。
        </p>
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="btn-primary"
            data-testid="formalization-submit"
          >
            {pending ? '発行中…' : '施工金額を反映して確定見積を発行'}
          </button>
        </div>
      </section>
    </form>
  );
}
