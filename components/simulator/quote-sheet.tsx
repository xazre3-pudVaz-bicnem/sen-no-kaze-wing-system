'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { ArrowRight, Pencil } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import { FINISH_LEVEL_INFO, type BaseBreakdownItem, type FinishLevel, type OptionCategory, type PricingResult, type ProductOption } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

interface Props {
  modelName: string;
  specName: string;
  finishLevel: FinishLevel;
  pricing: PricingResult;
  /** 本体の内訳（分類表見積書・仕様別）。本体の明細行として展開表示する */
  baseBreakdown?: BaseBreakdownItem[];
  categories: OptionCategory[];
  options: ProductOption[];
  readOnly: boolean;
  onPickCategory: (categoryId: string) => void;
}

/** 表の列（項目／数量／単位／単価／金額／備考）を揃えるための共通セル */
const td = {
  name: 'px-3 py-1.5',
  qty: 'w-16 px-2 py-1.5 text-right tabular-nums',
  unit: 'w-14 px-2 py-1.5 text-muted',
  price: 'w-24 px-2 py-1.5 text-right tabular-nums',
  amount: 'w-28 px-3 py-1.5 text-right tabular-nums',
  remark: 'w-32 px-3 py-1.5 text-[0.7rem] text-muted',
};

/** 工事区分の見出し行（１．金物関係費用 など） */
function SectionRow({ label, tone = 'sand' }: { label: string; tone?: 'sand' | 'ivory' }) {
  return (
    <tr className={tone === 'sand' ? 'bg-sand/40' : 'bg-ivory'}>
      <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold text-ink-soft">
        {label}
      </td>
    </tr>
  );
}

/** 【本体価格計】のような小計行 */
function SubtotalRow({ label, amount, testId }: { label: string; amount: string; testId?: string }) {
  return (
    <tr className="border-y border-line bg-ivory font-semibold">
      <td colSpan={4} className="px-3 py-2 text-sm">{label}</td>
      <td className="px-3 py-2 text-right text-sm tabular-nums" data-testid={testId}>{amount}</td>
      <td></td>
    </tr>
  );
}

/**
 * 先方の「ネット画面構成」シートの表示例に合わせた御見積書（エクセル形式・全行展開）。
 *   本体（内訳）→ 本体諸費用 →【本体価格計】
 *   オプション（明細。クリックで変更＝方法③）→ オプション諸費用 →【オプション価格計】
 *   別途工事（9項目）→【別途工事計】／フリー商品
 *   小計 → 値引き等調整額 → 税抜請負額 → 消費税 → 合計
 */
export function QuoteSheet({ modelName, specName, finishLevel, pricing, baseBreakdown = [], categories, options, readOnly, onPickCategory }: Props) {
  const levelInfo = FINISH_LEVEL_INFO[finishLevel];
  const byOption = new Map(options.map((o) => [o.id, o]));
  const optionLines = pricing.lines.filter((l) => !l.is_installation);
  const freeLines = pricing.lines.filter((l) => l.is_free_product);
  const sitework = pricing.lines.filter((l) => l.is_installation && !l.is_free_product);
  const siteworkTotal = sitework.reduce((s, l) => s + l.amount, 0);
  const freeTotal = pricing.free_subtotal;

  /** 本体内訳を工事区分ごとにまとめる（登録順） */
  const sections: { section: string; items: BaseBreakdownItem[] }[] = [];
  for (const b of baseBreakdown) {
    const last = sections[sections.length - 1];
    if (last && last.section === b.section) last.items.push(b);
    else sections.push({ section: b.section, items: [b] });
  }

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
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-sand/60 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">項目</th>
              <th className="w-16 px-2 py-2 text-right font-semibold">数量</th>
              <th className="w-14 px-2 py-2 font-semibold">単位</th>
              <th className="w-24 px-2 py-2 text-right font-semibold">単価</th>
              <th className="w-28 px-3 py-2 text-right font-semibold">金額</th>
              <th className="w-32 px-3 py-2 font-semibold">備考</th>
            </tr>
          </thead>

          {/* ---- 本体（分類表見積書の内訳を全行展開） ---- */}
          <tbody className="divide-y divide-line/60" data-testid="base-breakdown">
            <SectionRow label="本体" tone="ivory" />
            {sections.map((sec) => (
              <Fragment key={sec.section}>
                <SectionRow label={sec.section} />
                {sec.items.map((b) => (
                  <tr key={b.id} className="bg-white text-xs">
                    <td className={td.name}>{b.name}</td>
                    <td className={td.qty}>{b.quantity}</td>
                    <td className={td.unit}>{b.unit ?? ''}</td>
                    <td className={td.price}>{formatYen(b.unit_price)}</td>
                    <td className={td.amount}>{formatYen(b.amount)}</td>
                    <td className={td.remark}>{b.remark ?? ''}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {sections.length === 0 && (
              <tr className="bg-white">
                <td className={td.name}>{modelName} 本体一式</td>
                <td className={td.qty}>1</td>
                <td className={td.unit}>式</td>
                <td className={td.price}>{formatYen(pricing.base_price)}</td>
                <td className={td.amount}>{formatYen(pricing.base_price)}</td>
                <td className={td.remark}>工場生産分</td>
              </tr>
            )}
            <tr className="bg-white text-xs text-ink-soft">
              <td className={td.name}>本体諸費用（交通費、労災、安全管理費等）</td>
              <td className={td.qty}>1</td>
              <td className={td.unit}>式</td>
              <td className={td.price}></td>
              <td className={td.amount}>{formatYen(pricing.base_expense)}</td>
              <td className={td.remark}>{Math.round(pricing.expense_rate * 100)}%</td>
            </tr>
            <SubtotalRow label="【本体価格計】" amount={formatYen(pricing.base_total)} />
          </tbody>

          {/* ---- オプション（クリックで変更） ---- */}
          <tbody className="divide-y divide-line/60">
            <SectionRow label={`オプション${readOnly ? '' : '（項目をクリックすると変更できます）'}`} tone="ivory" />
            {optionLines.map((l) => {
              const cat = categories.find((c) => c.id === byOption.get(l.option_id)?.category_id);
              return (
                <tr key={l.option_id} className="bg-white">
                  <td className={td.name}>
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
                  <td className={td.qty}>{l.quantity}</td>
                  <td className={td.unit}>式</td>
                  <td className={td.price}>{l.price_on_request ? '別途見積' : formatYen(l.unit_price)}</td>
                  <td className={td.amount}>{l.price_on_request ? '別途見積' : l.amount === 0 ? '標準' : formatYen(l.amount)}</td>
                  <td className={td.remark}></td>
                </tr>
              );
            })}
            <tr className="bg-white text-xs text-ink-soft">
              <td className={td.name}>オプション諸費用（交通費、労災、安全管理費等）</td>
              <td className={td.qty}>1</td>
              <td className={td.unit}>式</td>
              <td className={td.price}></td>
              <td className={td.amount}>{formatYen(pricing.option_expense)}</td>
              <td className={td.remark}>{Math.round(pricing.expense_rate * 100)}%</td>
            </tr>
            <SubtotalRow label="【オプション価格計】" amount={formatYen(pricing.option_total)} />
          </tbody>

          {/* ---- 別途工事（現地確認後に代理店が見積） ---- */}
          <tbody className="divide-y divide-line/60">
            <SectionRow label="別途工事（設置場所の確認後、代理店がお見積りします）" tone="ivory" />
            {sitework.map((l) => (
              <tr key={l.option_id} className="bg-white text-xs">
                <td className={td.name}>{l.name}</td>
                <td className={td.qty}>{l.quantity}</td>
                <td className={td.unit}>式</td>
                <td className={td.price}></td>
                <td className={td.amount}>{l.amount > 0 ? formatYen(l.amount) : '−'}</td>
                <td className={td.remark}></td>
              </tr>
            ))}
            <SubtotalRow label="【別途工事計】" amount={siteworkTotal > 0 ? formatYen(siteworkTotal) : '別途'} />
          </tbody>

          {/* ---- フリー商品（代理店・工務店の取扱商品／諸費用なし） ---- */}
          {freeLines.length > 0 && (
            <tbody className="divide-y divide-line/60">
              <tr className="bg-ivory" data-testid="quote-free-products">
                <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold text-ink-soft">
                  フリー商品（代理店・工務店の取扱商品／諸費用なし）
                </td>
              </tr>
              {freeLines.map((l) => (
                <tr key={l.option_id} className="bg-white text-xs">
                  <td className={td.name} data-testid={`quote-line-${l.code}`}>{l.name}</td>
                  <td className={td.qty}>{l.quantity}</td>
                  <td className={td.unit}>式</td>
                  <td className={td.price}>{l.price_on_request ? '別途見積' : formatYen(l.unit_price)}</td>
                  <td className={td.amount}>{l.price_on_request ? '別途見積' : formatYen(l.amount)}</td>
                  <td className={td.remark}></td>
                </tr>
              ))}
              <SubtotalRow label="【フリー商品計】" amount={formatYen(freeTotal)} />
            </tbody>
          )}

          {/* ---- 合計 ---- */}
          <tfoot>
            <tr className="text-sm">
              <td colSpan={4} className="px-3 pt-3 pb-1">小　計</td>
              <td className="px-3 pt-3 pb-1 text-right tabular-nums">{formatYen(pricing.subtotal_raw)}</td>
              <td></td>
            </tr>
            <tr className="text-sm text-ink-soft">
              <td colSpan={4} className="px-3 py-1">値引き等調整額（千円未満切捨て）</td>
              <td className="px-3 py-1 text-right tabular-nums">{formatYen(pricing.adjustment)}</td>
              <td></td>
            </tr>
            <tr className="text-sm">
              <td colSpan={4} className="px-3 py-1">税抜請負額</td>
              <td className="px-3 py-1 text-right tabular-nums">{formatYen(pricing.subtotal)}</td>
              <td></td>
            </tr>
            <tr className="text-sm text-ink-soft">
              <td colSpan={4} className="px-3 py-1">消費税（{Math.round(pricing.tax_rate * 100)}%）</td>
              <td className="px-3 py-1 text-right tabular-nums">{formatYen(pricing.tax)}</td>
              <td></td>
            </tr>
            <tr className="border-t-2 border-ink bg-ivory">
              <td colSpan={4} className="px-3 py-3 font-serif text-lg">合　計（税込）</td>
              <td className="px-3 py-3 text-right">
                <span className="font-serif text-2xl tabular-nums" data-testid="total-price">
                  {formatYen(pricing.total)}
                </span>
              </td>
              <td></td>
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
      </div>
    </section>
  );
}
