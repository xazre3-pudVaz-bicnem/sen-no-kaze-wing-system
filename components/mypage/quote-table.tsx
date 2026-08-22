import Link from 'next/link';
import { ArrowRight, ImageOff } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { Quote, QuoteItem } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';

/**
 * 先方指定の見積明細（1.本体価格／2.オプション価格＋明細／3.別途工事／4.運送費／合計）。
 * マイページ・管理画面で共用。金額は発行時のスナップショット。
 */
export function QuoteTable({ quote, items, totalTestId = 'quote-total' }: { quote: Quote; items: QuoteItem[]; totalTestId?: string }) {
  const optionItems = items.filter((i) => i.kind === 'option');
  const siteworkItems = items.filter((i) => i.kind === 'installation');
  const transport = siteworkItems.find((i) => /運送費/.test(i.name));
  const otherSitework = siteworkItems.filter((i) => i !== transport);
  const transportAmount = transport?.amount ?? 0;
  const siteworkAmount = otherSitework.reduce((s, i) => s + i.amount, 0);
  const baseTotal = quote.base_price + quote.base_expense;
  const optionTotal = quote.option_subtotal + quote.option_expense;
  const withImages = optionItems.filter((i) => i.image_url);

  return (
    <div data-testid="quote-table">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-sand/60 text-left text-xs text-muted">
            <tr>
              <th className="w-12 px-4 py-3 text-center font-semibold">No</th>
              <th className="px-2 py-3 font-semibold">項目</th>
              <th className="w-20 px-2 py-3 text-right font-semibold">数量</th>
              <th className="w-32 px-4 py-3 text-right font-semibold">金額</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr>
              <td className="px-4 py-3 text-center text-muted">１</td>
              <td className="px-2 py-3 font-semibold">本体価格</td>
              <td className="px-2 py-3 text-right text-muted">１式</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatYen(baseTotal)}</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-center text-muted">２</td>
              <td className="px-2 py-3 font-semibold">オプション価格</td>
              <td className="px-2 py-3 text-right text-muted">１式</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatYen(optionTotal)}</td>
            </tr>
            <tr className="bg-sand/30">
              <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-ink-soft">
                2-1 明細
              </td>
            </tr>
            {optionItems.map((it) => (
              <tr key={it.id}>
                <td className="px-4 py-2"></td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2">
                    {it.image_url && (
                      <span className="relative size-8 shrink-0 overflow-hidden rounded bg-sand">
                        <SmartImage src={it.image_url} alt="" fill sizes="32px" className="object-cover" />
                      </span>
                    )}
                    <span>
                      {it.name}
                      {it.description && <span className="ml-2 text-xs text-muted">{it.description}</span>}
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-muted">{it.quantity}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatYen(it.amount)}</td>
              </tr>
            ))}
            {items
              .filter((i) => i.kind === 'option_expense')
              .map((it) => (
                <tr key={it.id} className="text-ink-soft">
                  <td className="px-4 py-2"></td>
                  <td className="px-2 py-2 text-xs">{it.name}</td>
                  <td className="px-2 py-2"></td>
                  <td className="px-4 py-2 text-right text-xs tabular-nums">{formatYen(it.amount)}</td>
                </tr>
              ))}
            <tr>
              <td className="px-4 py-3 text-center text-muted">３</td>
              <td className="px-2 py-3 font-semibold">
                別途工事
                <span className="ml-2 text-xs font-normal text-muted">（{otherSitework.length}項目）</span>
              </td>
              <td className="px-2 py-3 text-right text-muted">１式</td>
              <td className="px-4 py-3 text-right tabular-nums">{siteworkAmount > 0 ? formatYen(siteworkAmount) : '別途'}</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-center text-muted">４</td>
              <td className="px-2 py-3 font-semibold">運送費</td>
              <td className="px-2 py-3 text-right text-muted">１式</td>
              <td className="px-4 py-3 text-right tabular-nums">{transportAmount > 0 ? formatYen(transportAmount) : '別途'}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink bg-ivory">
              <td className="px-4 py-4"></td>
              <td className="px-2 py-4 font-serif text-lg">合計</td>
              <td className="px-2 py-4"></td>
              <td className="px-4 py-4 text-right">
                <span className="font-serif text-2xl tabular-nums" data-testid={totalTestId}>
                  {formatYen(quote.total)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <dl className="ml-auto max-w-sm space-y-1 px-6 py-4 text-sm sm:px-8">
        <div className="flex justify-between">
          <dt className="text-ink-soft">小計</dt>
          <dd className="tabular-nums">{formatYen(quote.subtotal - quote.adjustment)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-soft">値引き等調整額</dt>
          <dd className="tabular-nums">{formatYen(quote.adjustment)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-soft">税抜請負額</dt>
          <dd className="tabular-nums">{formatYen(quote.subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-soft">消費税（{Math.round(quote.tax_rate * 100)}%）</dt>
          <dd className="tabular-nums">{formatYen(quote.tax)}</dd>
        </div>
      </dl>

      <div className="space-y-2 border-t border-line px-6 py-4 text-xs text-ink-soft sm:px-8">
        <p>運搬、設置費など設置場所によって変動する費用は別途工事となっていて、現地の代理店、工務店にお問合せ下さい。</p>
        <Link href="/dealers" className="inline-flex items-center gap-1 font-semibold text-brown underline underline-offset-4">
          代理店・工務店を探す／お問い合わせ
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

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
