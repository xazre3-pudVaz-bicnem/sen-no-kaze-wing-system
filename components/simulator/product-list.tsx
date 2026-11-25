'use client';

import { Check, ImageOff } from 'lucide-react';
import type { OptionCategory, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { orderPickerProducts } from '@/lib/domain/simulator-product-choice-guide';
import { cn } from '@/lib/utils';

export interface ProductListAttribute {
  label: string;
  value: string;
}

interface Props {
  category: OptionCategory;
  options: ProductOption[];
  selectedIds: string[];
  baselineSelectedIds: string[];
  getPriceLabel: (option: ProductOption) => string;
  getPriceTone?: (option: ProductOption) => 'increase' | 'decrease' | 'neutral';
  getAttributes?: (category: OptionCategory, option: ProductOption) => ProductListAttribute[];
  onOpenProduct: (option: ProductOption) => void;
  getDisabledReason?: (option: ProductOption) => string | null;
  emptyMessage?: string;
  actionLabel?: string;
}

/**
 * 商品一覧ポップアップで使う共通商品カード一覧。
 *
 * 14カテゴリで同じカードを使い、カテゴリ固有項目だけ getAttributes で差し替える。
 * カード全体と「詳しく見る」は同じ onOpenProduct を呼び、ここではプラン確定を行わない。
 * 金額はこのコンポーネント内で再計算せず、既存見積ロジック側で作った表示値を受け取る。
 */
export function ProductList({
  category,
  options,
  selectedIds,
  baselineSelectedIds,
  getPriceLabel,
  getPriceTone,
  getAttributes = defaultProductListAttributes,
  onOpenProduct,
  getDisabledReason,
  emptyMessage = '現在選択できる商品はありません',
  actionLabel = '詳しく見る',
}: Props) {
  const selected = new Set(selectedIds);
  const baseline = new Set(baselineSelectedIds);
  const orderedOptions = orderPickerProducts(options, selectedIds, baselineSelectedIds);

  if (options.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-ivory/40 px-5 py-10 text-center text-sm text-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4" data-testid="product-list">
      {orderedOptions.map((option) => {
        const checked = selected.has(option.id);
        const isBaseline = baseline.has(option.id);
        const displayPrice = getPriceLabel(option);
        const priceTone = getPriceTone?.(option) ?? 'neutral';
        // 同じ案内がバッジと価格欄に二重表示される場合だけ省略。
        // 数値・別途見積・追加費用のラベルは変更も非表示もしない。
        const redundantBasicPlanText = isBaseline && (displayPrice === '基本プランの商品' || displayPrice === '基本プランに含む');
        const disabledReason = checked ? null : getDisabledReason?.(option) ?? null;
        const attributes = getAttributes(category, option).filter(
          (item) => item.label.trim().length > 0 && item.value.trim().length > 0
        );
        return (
          <li key={option.id}>
            <article
              className={cn(
                'group relative flex h-full min-h-full flex-col overflow-hidden rounded-lg border bg-white transition',
                checked
                  ? 'border-brown ring-2 ring-brown/35 shadow-soft'
                  : 'border-line hover:border-ink/40 hover:shadow-soft',
                disabledReason && 'opacity-60'
              )}
              data-testid={`product-card-${option.code}`}
            >
              <button
                type="button"
                className="absolute inset-0 z-10 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown focus-visible:ring-offset-2 disabled:cursor-not-allowed"
                onClick={() => onOpenProduct(option)}
                disabled={Boolean(disabledReason)}
                aria-label={`${option.name}を${actionLabel}`}
                data-testid={`product-card-open-${option.code}`}
              >
                <span className="sr-only">{option.name}を{actionLabel}</span>
              </button>

              <div className="pointer-events-none relative z-20 flex h-full flex-col">
                <div className="relative aspect-[3/2] bg-sand">
                  {option.image_url ? (
                    <SmartImage
                      src={option.image_url}
                      alt={option.name}
                      fill
                      sizes="(min-width: 1024px) 13rem, (min-width: 768px) 30vw, (min-width: 480px) 45vw, 92vw"
                      className="object-contain p-2"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-1 text-[0.65rem] text-muted">
                      <ImageOff className="size-5" aria-hidden="true" />
                      <span>画像なし</span>
                    </div>
                  )}

                  <div className="absolute top-1.5 left-1.5 flex max-w-[calc(100%-0.75rem)] flex-col items-start gap-1">
                    {checked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brown px-2 py-0.5 text-[0.65rem] font-semibold text-white" data-testid={`product-card-current-${option.code}`}>
                        <Check className="size-3 shrink-0" aria-hidden="true" />
                        現在選択中
                      </span>
                    )}
                    {isBaseline && (
                      <span className="inline-flex items-center rounded-full border border-brown/25 bg-white/95 px-2 py-0.5 text-[0.65rem] font-semibold text-brown" data-testid={`product-card-baseline-${option.code}`}>
                        基本プランの商品
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-1 flex-col p-2.5 sm:p-3">
                  {option.manufacturer && (
                    <span className="mb-0.5 min-w-0 text-[0.65rem] text-muted [overflow-wrap:anywhere]">{option.manufacturer}</span>
                  )}

                  <h3 className="min-w-0 text-xs leading-snug font-semibold text-ink [overflow-wrap:anywhere] sm:text-[0.82rem]">{option.name}</h3>

                  {attributes.length > 0 && (
                    <dl className="mt-2 grid gap-1 text-[0.65rem] sm:text-[0.7rem]">
                      {attributes.map((item) => (
                        <div key={`${item.label}-${item.value}`} className="grid grid-cols-[4rem_1fr] gap-1.5">
                          <dt className="text-muted">{item.label}</dt>
                          <dd className="min-w-0 text-ink-soft [overflow-wrap:anywhere]">{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  <div className="mt-auto pt-2.5">
                    {!redundantBasicPlanText && <p className={cn("min-w-0 text-xs font-semibold [overflow-wrap:anywhere] sm:text-[0.82rem]", priceTone === "increase" ? "text-red-700" : priceTone === "decrease" ? "text-blue-700" : "text-ink")} data-price-tone={priceTone} data-testid={`product-card-price-${option.code}`}>{displayPrice}</p>}
                    {disabledReason && <p className="mt-1 text-[0.65rem] leading-snug text-warn">{disabledReason}</p>}
                    <button
                      type="button"
                      className="pointer-events-auto relative z-30 mt-2 inline-flex min-h-8 w-full items-center justify-center rounded-md border border-brown px-2.5 py-1.5 text-[0.7rem] font-semibold text-brown transition hover:bg-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-line disabled:text-muted disabled:hover:bg-transparent"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenProduct(option);
                      }}
                      disabled={Boolean(disabledReason)}
                      data-testid={`product-card-detail-${option.code}`}
                    >
                      {actionLabel}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 現行の商品マスターで一覧に安全に出せるカテゴリ固有項目。
 * 追加データが未登録の項目は出さず、将来は呼び出し側の getAttributes で差し替えられる。
 */
export function defaultProductListAttributes(
  category: OptionCategory,
  option: ProductOption
): ProductListAttribute[] {
  const attributes: ProductListAttribute[] = [];
  if (option.model_no?.trim()) attributes.push({ label: '型番', value: option.model_no.trim() });

  const labelByCategory: Record<string, string> = {
    ub: 'サイズ',
    washbasin: '間口',
    kitchen: '間口',
    boiler: 'サイズ・設置',
    aircon: 'サイズ・仕様',
    sash: 'サイズ・呼称',
    furniture: '寸法',
  };

  if (option.size_note?.trim()) {
    attributes.push({ label: labelByCategory[category.code] ?? 'サイズ・仕様', value: option.size_note.trim() });
  }
  return attributes;
}
