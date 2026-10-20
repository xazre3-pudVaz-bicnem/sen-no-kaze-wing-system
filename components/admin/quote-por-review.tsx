'use client';

import { porSelectionLabel, type QuotePorSelection } from '@/lib/domain/quote-por';

/** 別途見積の確認の欄の 1 行（改訂・確定見積の画面で、価格が未確定だった明細） */
export interface QuotePorReviewRow {
  key: string;
  name: string;
  sectionLabel: string;
  unitPrice: number;
  remark: string;
  /** いまも未解決（0 円で、理由の備考がない）か */
  unresolved: boolean;
  /** この画面で単価・備考を直せるか。直せない行は note（無ければ lockedNote）を示す */
  editable: boolean;
  note?: string;
}

/**
 * 正式見積の発行前に、未解決の別途見積（POR）を残さないための確認の欄（D1 までの暫定。2026-10-19 の先方回答 ③）。
 * 発行を止めるのは DB で、この欄は先に案内する。
 */
export function QuotePorReview({
  rows,
  selections,
  confirmed,
  onConfirmedChange,
  onUpdate,
  lockedNote = 'この画面では直せません',
}: {
  rows: QuotePorReviewRow[];
  selections: QuotePorSelection[];
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  onUpdate: (key: string, patch: { unitPrice?: number; remark?: string }) => void;
  lockedNote?: string;
}) {
  if (rows.length === 0 && selections.length === 0) return null;
  const unresolved = rows.filter((row) => row.unresolved).length;

  return (
    <section className="space-y-2 border-t border-amber-200 bg-amber-50/70 px-3 py-3 text-xs" data-testid="por-review">
      <div>
        <h3 className="text-sm font-semibold text-amber-950">別途見積の確認</h3>
        <p className="mt-0.5 text-[0.68rem] leading-5 text-amber-950/80">
          正式見積には、価格が未確定（別途見積）の明細を残せません。金額を入れるか、0 円のままにする場合は備考に理由（例：電気設備工事に含む・サービス）を書いてください。
          明細から外すときは「見積内容を変更」から削除します。
        </p>
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-amber-200 bg-white">
          <table className="w-full min-w-[40rem]">
            <thead className="bg-amber-100/70 text-[0.68rem] text-amber-950">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">明細</th>
                <th className="w-24 px-2 py-1.5 text-left font-semibold">区分</th>
                <th className="w-32 px-2 py-1.5 text-right font-semibold">単価（税別）</th>
                <th className="w-56 px-2 py-1.5 text-left font-semibold">備考（0 円のままにする理由）</th>
                <th className="w-20 px-2 py-1.5 text-center font-semibold">状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-amber-100" data-testid="por-review-row">
                  <td className="px-2 py-1.5 font-semibold">{row.name || '（品名なし）'}</td>
                  <td className="px-2 py-1.5 text-muted">{row.sectionLabel}</td>
                  {row.editable ? (
                    <>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min="0"
                          max="100000000"
                          step="1"
                          value={row.unitPrice}
                          onChange={(event) => onUpdate(row.key, { unitPrice: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })}
                          className="w-full rounded border border-line px-2 py-1 text-right tabular-nums"
                          aria-label={`別途見積の単価：${row.name}`}
                          data-testid="por-review-price"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={row.remark}
                          maxLength={200}
                          onChange={(event) => onUpdate(row.key, { remark: event.target.value })}
                          className="w-full rounded border border-line px-2 py-1"
                          aria-label={`別途見積の備考：${row.name}`}
                          data-testid="por-review-remark"
                        />
                      </td>
                    </>
                  ) : (
                    <td colSpan={2} className="px-2 py-1.5 text-[0.68rem] text-amber-950">{row.note ?? lockedNote}</td>
                  )}
                  <td className="px-2 py-1.5 text-center">
                    {row.unresolved ? (
                      <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold text-amber-900">未確定</span>
                    ) : (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-800">確定</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selections.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-amber-200 bg-white px-3 py-2" data-testid="por-selections">
          <p className="font-semibold text-amber-950">お客様が選んだ別途見積の商品（{selections.length} 件）</p>
          <p className="text-[0.68rem] text-muted">
            見積の明細には出ない（選択商品の変更差額に 0 円で含まれる）ことがあります。それぞれ金額を明細に入れたか、お客様と合意のうえ対象外にしたかを確かめてください。
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {selections.map((selection) => (
              <li key={selection.key}>{porSelectionLabel(selection)}</li>
            ))}
          </ul>
          <input type="hidden" name="por_keys" value={JSON.stringify(selections.map((selection) => selection.key))} />
          <label className="flex items-start gap-2 pt-1 font-semibold text-amber-950">
            <input
              type="checkbox"
              name="por_confirmed"
              value="1"
              checked={confirmed}
              onChange={(event) => onConfirmedChange(event.target.checked)}
              className="mt-0.5"
              data-testid="por-confirm"
            />
            上の商品は、金額を明細に入れたか、お客様と合意のうえ対象外にしたことを確認しました
          </label>
        </div>
      )}

      {unresolved > 0 && (
        <p className="font-semibold text-amber-900" role="status">
          未確定の明細が {unresolved} 行あります。金額か理由の備考を入れるまで発行できません。
        </p>
      )}
    </section>
  );
}
