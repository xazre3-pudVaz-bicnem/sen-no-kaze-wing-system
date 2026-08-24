'use client';

import Link from 'next/link';
import { ArrowRight, Pencil } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import { FINISH_LEVEL_INFO, type FinishLevel, type OptionCategory, type PricingResult, type ProductOption } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

interface Props {
  modelName: string;
  specName: string;
  finishLevel: FinishLevel;
  pricing: PricingResult;
  categories: OptionCategory[];
  options: ProductOption[];
  readOnly: boolean;
  onPickCategory: (categoryId: string) => void;
}

/**
 * 先方指定の御見積書。
 *   1. 本体価格      1式
 *   2. オプション価格 1式  ＋ 2-1 明細（選択した物を項目表示。クリックで変更＝方法③）
 *   3. 別途工事      1式
 *   4. 運送費        1式
 *   合計
 */
export function QuoteSheet({ modelName, specName, finishLevel, pricing, categories, options, readOnly, onPickCategory }: Props) {
  const levelInfo = FINISH_LEVEL_INFO[finishLevel];
  const byOption = new Map(options.map((o) => [o.id, o]));
  // 「別途見積」の商品も明細として出す（0 円だからと「標準仕様に含む」へ混ぜない）
  const optionLines = pricing.lines.filter((l) => !l.is_installation && (l.amount > 0 || l.price_on_request));
  const includedLines = pricing.lines.filter((l) => !l.is_installation && l.amount === 0 && !l.price_on_request);
  const transport = pricing.lines.find((l) => l.code === 'sw-transport');
  const freeLines = pricing.lines.filter((l) => l.is_free_product);
  const sitework = pricing.lines.filter((l) => l.is_installation && !l.is_free_product && l.code !== 'sw-transport');
  const siteworkTotal = sitework.reduce((s, l) => s + l.amount, 0);
  const transportTotal = transport?.amount ?? 0;

  const rows: { no: string; label: string; qty: string; amount: string; strong?: boolean }[] = [
    { no: '１', label: '本体価格', qty: '１式', amount: formatYen(pricing.base_total), strong: true },
    { no: '２', label: 'オプション価格', qty: '１式', amount: formatYen(pricing.option_total), strong: true },
  ];

  return (
    <section aria-labelledby="quote-sheet-heading" className="card overflow-hidden" data-testid="quote-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-ivory px-5 py-3">
        <h2 id="quote-sheet-heading" className="font-serif text-lg">
          御見積書
        </h2>
        <p className="text-xs text-muted" data-testid="quote-scope">
          {modelName}（{specName}）／注文範囲：{levelInfo.name}／概算・税込
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.no} className="bg-white">
                <td className="w-10 px-4 py-3 text-center text-muted">{r.no}</td>
                <td className="px-2 py-3 font-semibold">{r.label}</td>
                <td className="w-16 px-2 py-3 text-right text-muted">{r.qty}</td>
                <td className="w-32 px-4 py-3 text-right tabular-nums">{r.amount}</td>
              </tr>
            ))}

            {/* 2-1 明細（クリックで変更） */}
            <tr>
              <td colSpan={4} className="bg-sand/40 px-4 py-2 text-xs font-semibold text-ink-soft">
                2-1 明細（項目をクリックすると変更できます）
              </td>
            </tr>
            {optionLines.map((l) => {
              const cat = categories.find((c) => c.id === byOption.get(l.option_id)?.category_id);
              return (
                <tr key={l.option_id} className="bg-white">
                  <td className="px-4 py-2"></td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      disabled={readOnly || !cat}
                      onClick={() => cat && onPickCategory(cat.id)}
                      className="group inline-flex items-center gap-1.5 text-left hover:text-brown disabled:hover:text-ink"
                      data-testid={`quote-line-${l.code}`}
                    >
                      <span className="text-xs text-muted">{cat?.name}</span>
                      <span>
                        {l.name}
                        {l.variants.length > 0 && (
                          <span className="block text-[0.7rem] text-muted">
                            {l.variants.map((v) => `${v.group}：${v.choice}`).join('／')}
                          </span>
                        )}
                      </span>
                      {!readOnly && cat && <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
                    </button>
                  </td>
                  <td className="px-2 py-2 text-right text-muted">{l.quantity}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{l.price_on_request ? '別途見積' : formatYen(l.amount)}</td>
                </tr>
              );
            })}
            {includedLines.length > 0 && (
              <tr className="bg-white">
                <td className="px-4 py-2"></td>
                <td className="px-2 py-2 text-xs text-muted" colSpan={3}>
                  標準仕様に含む：{includedLines.map((l) => l.name).join('、')}
                </td>
              </tr>
            )}
            <tr className="bg-white">
              <td className="px-4 py-2"></td>
              <td className="px-2 py-2 text-xs text-muted">オプション諸費用（{Math.round(pricing.expense_rate * 100)}%）</td>
              <td className="px-2 py-2"></td>
              <td className="px-4 py-2 text-right text-xs tabular-nums text-muted">{formatYen(pricing.option_expense)}</td>
            </tr>

            <tr className="bg-white">
              <td className="w-10 px-4 py-3 text-center text-muted">３</td>
              <td className="px-2 py-3 font-semibold">
                別途工事
                <span className="ml-2 text-xs font-normal text-muted">（{sitework.length}項目）</span>
              </td>
              <td className="px-2 py-3 text-right text-muted">１式</td>
              <td className="px-4 py-3 text-right tabular-nums">{siteworkTotal > 0 ? formatYen(siteworkTotal) : '別途'}</td>
            </tr>
            <tr className="bg-white">
              <td className="w-10 px-4 py-3 text-center text-muted">４</td>
              <td className="px-2 py-3 font-semibold">運送費</td>
              <td className="px-2 py-3 text-right text-muted">１式</td>
              <td className="px-4 py-3 text-right tabular-nums">{transportTotal > 0 ? formatYen(transportTotal) : '別途'}</td>
            </tr>

            {/* 5. フリー商品（代理店・工務店が登録した自社商品） */}
            {freeLines.length > 0 && (
              <>
                <tr className="bg-white" data-testid="quote-free-products">
                  <td className="w-10 px-4 py-3 text-center text-muted">５</td>
                  <td className="px-2 py-3 font-semibold">
                    フリー商品
                    <span className="ml-2 text-xs font-normal text-muted">（代理店・工務店の取扱商品／諸費用なし）</span>
                  </td>
                  <td className="px-2 py-3 text-right text-muted">１式</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatYen(pricing.free_subtotal)}</td>
                </tr>
                {freeLines.map((l) => {
                  const cat = categories.find((c) => c.id === byOption.get(l.option_id)?.category_id);
                  return (
                    <tr key={l.option_id} className="bg-white">
                      <td className="px-4 py-2"></td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          disabled={readOnly || !cat}
                          onClick={() => cat && onPickCategory(cat.id)}
                          className="group inline-flex items-center gap-1.5 text-left hover:text-brown disabled:hover:text-ink"
                          data-testid={`quote-line-${l.code}`}
                        >
                          <span>{l.name}</span>
                          {!readOnly && cat && <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-right text-muted">{l.quantity}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatYen(l.amount)}</td>
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink bg-ivory">
              <td className="px-4 py-4"></td>
              <td className="px-2 py-4 font-serif text-lg">合計</td>
              <td className="px-2 py-4"></td>
              <td className="px-4 py-4 text-right">
                <span className="font-serif text-2xl tabular-nums" data-testid="total-price">
                  {formatYen(pricing.total)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-2 border-t border-line px-5 py-4 text-xs text-ink-soft">
        <p>
          <strong className="font-semibold">注文範囲：{levelInfo.name}（{levelInfo.short}）</strong>
          — {levelInfo.lead}
        </p>
        <p>運搬、設置費など設置場所によって変動する費用は別途工事となっていて、現地の代理店、工務店にお問合せ下さい。</p>
        <Link href="/dealers" className={cn('inline-flex items-center gap-1 font-semibold text-brown underline underline-offset-4')} data-testid="dealers-link">
          代理店・工務店を探す／お問い合わせ
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
        <p className="text-muted">
          税抜請負額 {formatYen(pricing.subtotal)}（値引き等調整額 {formatYen(pricing.adjustment)}）／消費税 {formatYen(pricing.tax)}
        </p>
      </div>
    </section>
  );
}
