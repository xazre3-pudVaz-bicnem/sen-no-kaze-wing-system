import { ImageOff } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { Quote, QuoteItem } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';

/**
 * 見積書テンプレートの構造（本体／オプション／別途工事 → 小計・調整・税・合計）で明細を表示する。
 * マイページ・管理画面で共用。
 */
export function QuoteTable({ quote, items, totalTestId = 'quote-total' }: { quote: Quote; items: QuoteItem[]; totalTestId?: string }) {
  const sections: { key: string; label: string; rows: QuoteItem[]; subtotal: number; note?: string }[] = [
    { key: 'base', label: '本体（工場生産分）', rows: items.filter((i) => i.kind === 'base' || i.kind === 'base_expense'), subtotal: quote.base_price + quote.base_expense },
    { key: 'option', label: 'オプション', rows: items.filter((i) => i.kind === 'option' || i.kind === 'option_expense'), subtotal: quote.option_subtotal + quote.option_expense },
    {
      key: 'installation',
      label: '別途工事（現地施工）',
      rows: items.filter((i) => i.kind === 'installation'),
      subtotal: quote.installation_subtotal,
      note: '設置場所の確認後、代理店よりお見積りします',
    },
  ];
  const withImages = items.filter((i) => i.kind === 'option' && i.image_url);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-sand/60 text-left text-xs text-muted">
            <tr>
              <th className="px-6 py-3 font-semibold">項目</th>
              <th className="px-6 py-3 font-semibold">摘要</th>
              <th className="px-6 py-3 text-right font-semibold">単価</th>
              <th className="px-6 py-3 text-right font-semibold">数量</th>
              <th className="px-6 py-3 text-right font-semibold">金額</th>
            </tr>
          </thead>
          {sections.map((s) =>
            s.rows.length === 0 ? null : (
              <tbody key={s.key} className="divide-y divide-line border-b border-line">
                <tr className="bg-sand/30">
                  <td colSpan={5} className="px-6 py-2 text-xs font-semibold text-ink-soft">
                    {s.label}
                    {s.note && <span className="ml-2 font-normal text-muted">（{s.note}）</span>}
                  </td>
                </tr>
                {s.rows.map((it) => (
                  <tr key={it.id} className={it.kind.endsWith('_expense') ? 'text-ink-soft' : ''}>
                    <td className="px-6 py-3">
                      <span className="flex items-center gap-2">
                        {it.image_url && (
                          <span className="relative size-9 shrink-0 overflow-hidden rounded bg-sand">
                            <SmartImage src={it.image_url} alt="" fill sizes="36px" className="object-cover" />
                          </span>
                        )}
                        {it.name}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-ink-soft">{it.description}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{it.kind === 'installation' && it.amount === 0 ? '別途' : formatYen(it.unit_price)}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{it.quantity}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{it.kind === 'installation' && it.amount === 0 ? '別途' : formatYen(it.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-sand/20 font-semibold">
                  <td colSpan={4} className="px-6 py-2 text-right text-xs">
                    {s.key === 'base' ? '本体価格計' : s.key === 'option' ? 'オプション価格計' : '別途工事計'}
                  </td>
                  <td className="px-6 py-2 text-right tabular-nums">{s.key === 'installation' && s.subtotal === 0 ? '別途' : formatYen(s.subtotal)}</td>
                </tr>
              </tbody>
            )
          )}
        </table>
      </div>

      <dl className="ml-auto max-w-sm space-y-1 p-6 text-sm sm:p-8">
        <div className="flex justify-between"><dt className="text-ink-soft">小計</dt><dd className="tabular-nums">{formatYen(quote.subtotal - quote.adjustment)}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-soft">値引き等調整額</dt><dd className="tabular-nums">{formatYen(quote.adjustment)}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-soft">税抜請負額</dt><dd className="tabular-nums">{formatYen(quote.subtotal)}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-soft">消費税（{Math.round(quote.tax_rate * 100)}%）</dt><dd className="tabular-nums">{formatYen(quote.tax)}</dd></div>
        <div className="flex items-baseline justify-between border-t border-line pt-2"><dt className="font-semibold">合計（税込）</dt><dd className="font-serif text-3xl" data-testid={totalTestId}>{formatYen(quote.total)}</dd></div>
      </dl>

      {withImages.length > 0 && (
        <div className="border-t border-line px-6 py-5 sm:px-8">
          <p className="text-xs font-semibold text-muted">選択した商品</p>
          <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
            {withImages.map((it) => (
              <li key={it.id}>
                <span className="relative block aspect-square overflow-hidden rounded-lg bg-sand">
                  {it.image_url ? <SmartImage src={it.image_url} alt={it.name} fill sizes="120px" className="object-cover" /> : <ImageOff className="m-auto size-5" />}
                </span>
                <span className="mt-1 block text-xs text-ink-soft">{it.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
