import Link from 'next/link';
import { Fragment } from 'react';
import { ArrowRight, ImageOff } from 'lucide-react';
import { formatQty, formatYen } from '@/lib/domain/pricing';
import { FINISH_LEVEL_INFO, type Quote, type QuoteItem } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';

/**
 * 先方の「ネット画面構成」シートの表示例に合わせた見積明細（エクセル形式・全行展開）。
 *   本体（内訳）→ 本体諸費用 →【本体価格計】
 *   オプション明細 → オプション諸費用 →【オプション価格計】
 *   別途工事 →【別途工事計】／フリー商品
 *   小計 → 値引き等調整額 → 税抜請負額 → 消費税 → 合計
 * マイページ・管理画面で共用。金額は発行時のスナップショット。
 */

const td = {
  name: 'px-3 py-1.5',
  qty: 'w-16 px-2 py-1.5 text-right tabular-nums',
  unit: 'w-16 px-2 py-1.5 whitespace-nowrap text-muted',
  price: 'w-24 px-2 py-1.5 text-right tabular-nums',
  amount: 'w-28 px-3 py-1.5 text-right tabular-nums',
  remark: 'w-36 px-3 py-1.5 text-[0.7rem] text-muted',
};

function SectionRow({ label, tone = 'sand', testId }: { label: string; tone?: 'sand' | 'ivory'; testId?: string }) {
  return (
    <tr className={tone === 'sand' ? 'bg-sand/40' : 'bg-ivory'} data-testid={testId}>
      <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold text-ink-soft">
        {label}
      </td>
    </tr>
  );
}

function SubtotalRow({ label, amount }: { label: string; amount: string }) {
  return (
    <tr className="border-y border-line bg-ivory font-semibold">
      <td colSpan={4} className="px-3 py-2 text-sm">{label}</td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">{amount}</td>
      <td></td>
    </tr>
  );
}

function ItemRow({ it, showImage = false }: { it: QuoteItem; showImage?: boolean }) {
  return (
    <tr className="bg-white text-xs">
      <td className={td.name}>
        <span className="flex items-center gap-2">
          {showImage && it.image_url && (
            <span className="relative size-8 shrink-0 overflow-hidden rounded bg-sand">
              <SmartImage src={it.image_url} alt="" fill sizes="32px" className="object-cover" />
            </span>
          )}
          <span>
            {it.name}
            {it.description && <span className="ml-2 text-[0.65rem] text-muted">{it.description}</span>}
          </span>
        </span>
      </td>
      <td className={td.qty}>{formatQty(it.quantity)}</td>
      <td className={td.unit}>{it.unit ?? '式'}</td>
      <td className={td.price}>{it.unit_price > 0 ? formatYen(it.unit_price) : ''}</td>
      <td className={td.amount}>{it.amount > 0 ? formatYen(it.amount) : it.unit_price > 0 ? formatYen(it.amount) : '−'}</td>
      <td className={td.remark}>{it.remark ?? ''}</td>
    </tr>
  );
}

export function QuoteTable({ quote, items, totalTestId = 'quote-total' }: { quote: Quote; items: QuoteItem[]; totalTestId?: string }) {
  const baseItems = items.filter((i) => i.kind === 'base');
  const baseExpense = items.find((i) => i.kind === 'base_expense') ?? null;
  const optionItems = items.filter((i) => i.kind === 'option');
  const optionExpense = items.find((i) => i.kind === 'option_expense') ?? null;
  const siteworkItems = items.filter((i) => i.kind === 'installation');
  const freeItems = items.filter((i) => i.kind === 'free');
  const freeAmount = freeItems.reduce((s, i) => s + i.amount, 0);
  const siteworkAmount = siteworkItems.reduce((s, i) => s + i.amount, 0);
  const baseTotal = quote.base_price + quote.base_expense;
  const optionTotal = quote.option_subtotal + quote.option_expense;
  // 画像一覧はオプションに限らず、画像を持つ明細すべて（フリー商品・別途工事も）
  const withImages = items.filter((i) => i.image_url);
  const levelInfo = FINISH_LEVEL_INFO[quote.finish_level ?? 'full'];

  /** 本体の内訳を工事区分（description）ごとにまとめる */
  const baseSections: { section: string; items: QuoteItem[] }[] = [];
  for (const it of baseItems) {
    const section = it.description ?? '';
    const last = baseSections[baseSections.length - 1];
    if (last && last.section === section) last.items.push(it);
    else baseSections.push({ section, items: [it] });
  }
  const showSections = baseItems.length > 1;

  return (
    <div data-testid="quote-table">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-sand/60 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">項目</th>
              <th className="w-16 px-2 py-2 text-right font-semibold">数量</th>
              <th className="w-16 px-2 py-2 font-semibold whitespace-nowrap">単位</th>
              <th className="w-24 px-2 py-2 text-right font-semibold">単価</th>
              <th className="w-28 px-3 py-2 text-right font-semibold">金額</th>
              <th className="w-36 px-3 py-2 font-semibold">備考</th>
            </tr>
          </thead>

          {/* ---- 本体価格（内訳を全行展開） ---- */}
          <tbody className="divide-y divide-line/60">
            <SectionRow label="本体価格" tone="ivory" />
            {showSections
              ? baseSections.map((sec) => (
                  <Fragment key={sec.section || sec.items[0].id}>
                    {sec.section && <SectionRow label={sec.section} />}
                    {sec.items.map((it) => (
                      <tr key={it.id} className="bg-white text-xs">
                        <td className={td.name}>{it.name}</td>
                        <td className={td.qty}>{formatQty(it.quantity)}</td>
                        <td className={td.unit}>{it.unit ?? ''}</td>
                        <td className={td.price}>{formatYen(it.unit_price)}</td>
                        <td className={td.amount}>{formatYen(it.amount)}</td>
                        <td className={td.remark}>{it.remark ?? ''}</td>
                      </tr>
                    ))}
                    {/* 工事区分ごとの小計（先方修正案） */}
                    {sec.section && (
                      <tr className="bg-white text-[0.7rem] text-ink-soft">
                        <td colSpan={4} className="px-3 py-1 text-right font-semibold">{sec.section}　計</td>
                        <td className="px-3 py-1 text-right font-semibold tabular-nums">
                          {formatYen(sec.items.reduce((sum, x) => sum + x.amount, 0))}
                        </td>
                        <td></td>
                      </tr>
                    )}
                  </Fragment>
                ))
              : baseItems.map((it) => <ItemRow key={it.id} it={it} />)}
            {baseExpense && <ItemRow it={baseExpense} />}
            <SubtotalRow label="【本体価格計】" amount={formatYen(baseTotal)} />
          </tbody>

          {/* ---- オプション価格 ---- */}
          <tbody className="divide-y divide-line/60">
            <SectionRow label="オプション価格" tone="ivory" />
            {optionItems.map((it) => (
              <ItemRow key={it.id} it={it} showImage />
            ))}
            {optionExpense && <ItemRow it={optionExpense} />}
            <SubtotalRow label="【オプション価格計】" amount={formatYen(optionTotal)} />
          </tbody>

          {/* ---- 別途工事（運送費を含む） ---- */}
          <tbody className="divide-y divide-line/60">
            <SectionRow label="別途工事（運送費・現地工事）" tone="ivory" />
            {siteworkItems.map((it) => (
              <ItemRow key={it.id} it={it} showImage />
            ))}
            <SubtotalRow label="【別途工事計】" amount={siteworkAmount > 0 ? formatYen(siteworkAmount) : '別途'} />
          </tbody>

          {/* ---- フリー商品 ---- */}
          {freeItems.length > 0 && (
            <tbody className="divide-y divide-line/60">
              <SectionRow label="フリー商品（代理店・工務店の取扱商品／諸費用なし）" tone="ivory" testId="quote-free-products" />
              {freeItems.map((it) => (
                <ItemRow key={it.id} it={it} showImage />
              ))}
              <SubtotalRow label="【フリー商品計】" amount={formatYen(freeAmount)} />
            </tbody>
          )}

          {/* ---- 合計 ---- */}
          <tfoot>
            <tr className="text-sm">
              <td colSpan={4} className="px-3 pt-3 pb-1">小　計</td>
              <td className="px-3 pt-3 pb-1 text-right tabular-nums">{formatYen(quote.subtotal - quote.adjustment)}</td>
              <td></td>
            </tr>
            <tr className="text-sm text-ink-soft">
              <td colSpan={4} className="px-3 py-1">値引き等調整額（千円未満切捨て）</td>
              <td className="px-3 py-1 text-right tabular-nums">{formatYen(quote.adjustment)}</td>
              <td></td>
            </tr>
            <tr className="text-sm">
              <td colSpan={4} className="px-3 py-1">税抜請負額</td>
              <td className="px-3 py-1 text-right tabular-nums">{formatYen(quote.subtotal)}</td>
              <td></td>
            </tr>
            <tr className="text-sm text-ink-soft">
              <td colSpan={4} className="px-3 py-1">消費税（{Math.round(quote.tax_rate * 100)}%）</td>
              <td className="px-3 py-1 text-right tabular-nums">{formatYen(quote.tax)}</td>
              <td></td>
            </tr>
            <tr className="border-t-2 border-ink bg-ivory">
              <td colSpan={4} className="px-3 py-3 font-serif text-lg">合　計（税込）</td>
              <td className="px-3 py-3 text-right">
                <span className="font-serif text-2xl tabular-nums" data-testid={totalTestId}>
                  {formatYen(quote.total)}
                </span>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-2 border-t border-line px-6 py-4 text-xs text-ink-soft sm:px-8">
        {quote.dealer_note && (
          <p className="rounded-lg bg-ivory px-3 py-2" data-testid="dealer-note">
            <strong className="font-semibold">代理店より：</strong>
            {quote.dealer_note}
          </p>
        )}
        <p data-testid="quote-scope">
          <strong className="font-semibold">注文範囲：{levelInfo.name}（{levelInfo.short}）</strong> — {levelInfo.lead}
        </p>
        <p>運搬、設置費など設置場所によって変動する費用は別途工事となっていて、現地の代理店、工務店にお問合せ下さい。</p>
        <Link href="/dealers" className="inline-flex items-center gap-1 font-semibold text-brown underline underline-offset-4">
          代理店・工務店を探す／お問い合わせ
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      {withImages.length > 0 && (
        <div className="border-t border-line px-6 py-5 sm:px-8">
          <p className="text-xs font-semibold text-muted">選択いただいた商品（画像一覧）</p>
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
