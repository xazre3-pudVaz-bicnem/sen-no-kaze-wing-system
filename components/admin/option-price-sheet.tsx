'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { SquarePen } from 'lucide-react';
import { bulkUpdateOptionPricesAction } from '@/lib/actions/admin';
import { formatYen } from '@/lib/domain/pricing';
import { ROUNDING_UNIT } from '@/lib/domain/pricing';
import { Input } from '@/components/ui';
import { Status, SubmitButton } from './forms';

const initial = { ok: false } as const;

export interface PriceSheetRow {
  id: string;
  name: string;
  category: string;
  price: number;
  price_on_request: boolean;
}

/**
 * 本体内訳マスターの下に続く「オプション」「別途工事」の一括管理表。
 * 先方修正案「本体につながる形で、オプション・別途工事もその下に並べて一括管理できるように」に対応。
 * 表示するのは選択中の仕様（プラン）の標準構成で、エクセルの分類表見積書と同じ並びになる。
 * 価格はこの場で書き換えて一括保存できる（商品台帳の価格そのものが変わる）。
 */
export function OptionPriceSheet({
  options,
  sitework,
  baseLines,
  expenseRate,
  specName,
}: {
  /** 標準構成のオプション（設備・仕上げ） */
  options: PriceSheetRow[];
  /** 別途工事（現地確認後に代理店が見積） */
  sitework: PriceSheetRow[];
  /** 本体内訳の明細合計（保存済みの値） */
  baseLines: number;
  expenseRate: number;
  specName: string;
}) {
  const [state, action, pending] = useActionState(bulkUpdateOptionPricesAction, initial);
  const [prices, setPrices] = useState<Record<string, number>>(() => Object.fromEntries(options.map((o) => [o.id, o.price])));

  const priceOf = (o: PriceSheetRow) => prices[o.id] ?? o.price;
  const optSubtotal = options.reduce((s, o) => s + (o.price_on_request ? 0 : priceOf(o)), 0);
  const optExpense = Math.floor(optSubtotal * expenseRate);
  const optionTotal = optSubtotal + optExpense;
  const baseTotal = baseLines + Math.floor(baseLines * expenseRate);
  const subRaw = baseTotal + optionTotal;
  const sub = Math.floor(subRaw / ROUNDING_UNIT) * ROUNDING_UNIT;
  const tax = Math.floor(sub * 0.1);

  const cell = 'px-3 py-1.5';

  return (
    <form action={action} className="card space-y-4 p-6" noValidate data-testid="option-price-sheet">
      <div>
        <p className="font-semibold">オプション・別途工事（{specName}の標準構成）</p>
        <p className="mt-1 text-xs text-muted">
          本体の下に続く、分類表見積書と同じ並びです。単価はここで書き換えて一括保存できます
          （<strong className="font-semibold">商品台帳の価格そのものが変わり、全モデル・全仕様の新しい見積に反映されます</strong>。発行済みの見積は変わりません）。
        </p>
      </div>
      <Status state={state} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-sand/60 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">品名</th>
              <th className="w-20 px-2 py-2 text-right font-semibold">数量</th>
              <th className="w-20 px-2 py-2 font-semibold whitespace-nowrap">単位</th>
              <th className="w-32 px-2 py-2 text-right font-semibold whitespace-nowrap">単価（売価）</th>
              <th className="w-28 px-3 py-2 text-right font-semibold">金額</th>
              <th className="w-14 px-2 py-2"></th>
            </tr>
          </thead>

          <tbody className="divide-y divide-line/60">
            <tr className="bg-ivory">
              <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold text-ink-soft">オプション（設備・仕上げ）</td>
            </tr>
            {options.map((o) => (
              <tr key={o.id} className="bg-white text-xs" data-testid={`price-row-${o.id}`}>
                <td className={cell}>
                  <span className="mr-2 text-[0.65rem] text-muted">{o.category}</span>
                  {o.name}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">1</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted">式</td>
                <td className="px-2 py-1.5">
                  {o.price_on_request ? (
                    <span className="block text-right text-muted">別途見積</span>
                  ) : (
                    <Input
                      name={`prices.${o.id}`}
                      type="number"
                      min={0}
                      value={priceOf(o)}
                      onChange={(e) => setPrices((cur) => ({ ...cur, [o.id]: Number(e.target.value) }))}
                      aria-label={`${o.name} の単価`}
                      className="text-right"
                    />
                  )}
                </td>
                <td className={`${cell} text-right tabular-nums`}>{o.price_on_request ? '別途見積' : formatYen(priceOf(o))}</td>
                <td className="px-2 py-1.5 text-center">
                  <Link href={`/admin/options/${o.id}`} className="inline-flex rounded p-1 text-muted hover:bg-sand hover:text-ink" title="商品の詳細を編集（名称・画像・選択肢など）">
                    <SquarePen className="size-4" aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
            <tr className="bg-white text-xs text-ink-soft">
              <td colSpan={4} className="px-3 py-1.5 text-right">オプション諸費用（{Math.round(expenseRate * 100)}%）</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatYen(optExpense)}</td>
              <td></td>
            </tr>
            <tr className="border-y border-line bg-ivory font-semibold">
              <td colSpan={4} className="px-3 py-2 text-right text-sm">【オプション価格計】</td>
              <td className="px-3 py-2 text-right text-sm tabular-nums">{formatYen(optionTotal)}</td>
              <td></td>
            </tr>
          </tbody>

          <tbody className="divide-y divide-line/60">
            <tr className="bg-ivory">
              <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold text-ink-soft">別途工事（設置場所の確認後、代理店がお見積り）</td>
            </tr>
            {sitework.map((o) => (
              <tr key={o.id} className="bg-white text-xs">
                <td className={cell}>{o.name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">1</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted">式</td>
                <td className="px-2 py-1.5 text-right text-muted">−</td>
                <td className={`${cell} text-right text-muted`}>−</td>
                <td className="px-2 py-1.5 text-center">
                  <Link href={`/admin/options/${o.id}`} className="inline-flex rounded p-1 text-muted hover:bg-sand hover:text-ink" title="項目を編集">
                    <SquarePen className="size-4" aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
            <tr className="border-y border-line bg-ivory font-semibold">
              <td colSpan={4} className="px-3 py-2 text-right text-sm">【別途工事計】</td>
              <td className="px-3 py-2 text-right text-sm">別途</td>
              <td></td>
            </tr>
          </tbody>

          <tfoot>
            <tr className="text-sm">
              <td colSpan={4} className="px-3 pt-3 pb-1 text-right text-muted">小　計（本体価格計 {formatYen(baseTotal)}＋オプション価格計）</td>
              <td className="px-3 pt-3 pb-1 text-right tabular-nums">{formatYen(subRaw)}</td>
              <td></td>
            </tr>
            <tr className="text-sm text-ink-soft">
              <td colSpan={4} className="px-3 py-1 text-right text-muted">値引き等調整額（千円未満切捨て）</td>
              <td className="px-3 py-1 text-right tabular-nums">{formatYen(sub - subRaw)}</td>
              <td></td>
            </tr>
            <tr className="text-sm text-ink-soft">
              <td colSpan={4} className="px-3 py-1 text-right text-muted">消費税（10%）</td>
              <td className="px-3 py-1 text-right tabular-nums">{formatYen(tax)}</td>
              <td></td>
            </tr>
            <tr className="border-t-2 border-ink bg-ivory font-semibold">
              <td colSpan={4} className="px-3 py-2 text-right">合　計（この標準構成・税込）</td>
              <td className="px-3 py-2 text-right tabular-nums" data-testid="price-sheet-total">{formatYen(sub + tax)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <SubmitButton pending={pending} label="オプション価格を一括保存する" />
    </form>
  );
}
