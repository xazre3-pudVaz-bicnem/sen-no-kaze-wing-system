'use client';

import { ArrowLeft, Check, ImageOff } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { Button } from '@/components/ui';
import { VariantPicker } from './variant-picker';

interface Props {
  category: OptionCategory;
  option: ProductOption;
  groups: OptionVariantGroup[];
  choices: OptionVariantChoice[];
  selectedVariantIds: string[];
  isCurrentlySelected: boolean;
  priceLabel: string;
  onVariantChange: (choiceId: string, groupId: string) => void;
  onBack: () => void;
  onApply: () => void;
  onRemove?: () => void;
  applyDisabled?: boolean;
}

/**
 * 14カテゴリで共通利用する商品詳細。
 *
 * 左に商品画像、右に基本情報・仕様選択・追加金額をまとめる。
 * メーカー資料は商品マスター側の資料URLを持つ段階で、この左側にタブ追加する想定。
 */
export function ProductDetail({
  category,
  option,
  groups,
  choices,
  selectedVariantIds,
  isCurrentlySelected,
  priceLabel,
  onVariantChange,
  onBack,
  onApply,
  onRemove,
  applyDisabled = false,
}: Props) {
  const basicInfo = [
    { label: 'メーカー', value: option.manufacturer },
    { label: 'シリーズ・型番', value: option.model_no },
    { label: sizeLabel(category.code), value: option.size_note },
    { label: '区分', value: option.highlight },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value?.trim()));

  return (
    <div data-testid="product-detail">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-brown hover:underline"
        data-testid="product-detail-back"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        一覧へ戻る
      </button>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-ink">商品画像</span>
            {isCurrentlySelected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brown px-2 py-1 text-[0.68rem] font-semibold text-white">
                <Check className="size-3" aria-hidden="true" />
                現在選択中
              </span>
            )}
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-line bg-sand">
            {option.image_url ? (
              <SmartImage
                src={option.image_url}
                alt={option.name}
                fill
                sizes="(min-width: 1024px) 34rem, 90vw"
                className="object-contain"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted">
                <ImageOff className="size-8" aria-hidden="true" />
                <span>画像なし</span>
              </div>
            )}
          </div>

          {option.description && (
            <div className="mt-3 rounded-lg bg-ivory/55 px-3 py-2.5">
              <p className="whitespace-pre-line text-xs leading-relaxed text-ink-soft">{option.description}</p>
            </div>
          )}
        </section>

        <section className="min-w-0">
          <div className="border-b border-line pb-3">
            {option.manufacturer && <p className="text-xs text-muted">{option.manufacturer}</p>}
            <h3 className="mt-0.5 text-lg font-semibold leading-snug text-ink">{option.name}</h3>

            {basicInfo.length > 0 && (
              <dl className="mt-3 grid gap-1.5 rounded-lg bg-sand/45 p-3 text-xs">
                {basicInfo.map((item) => (
                  <div key={item.label} className="grid grid-cols-[5.5rem_1fr] gap-2">
                    <dt className="text-muted">{item.label}</dt>
                    <dd className="min-w-0 break-words text-ink-soft">{item.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {option.list_price != null && (
              <p className="mt-2 text-[0.68rem] text-muted">メーカー参考価格 {formatYen(option.list_price)}</p>
            )}
          </div>

          {groups.length > 0 ? (
            <VariantPicker groups={groups} choices={choices} selected={selectedVariantIds} onChange={onVariantChange} />
          ) : (
            <div className="border-b border-line py-4">
              <p className="text-xs text-muted">この商品に選択する仕様はありません。</p>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-line bg-white p-3">
            <p className="text-[0.68rem] text-muted">追加金額</p>
            <p className="mt-0.5 text-base font-semibold text-ink">{priceLabel}</p>
          </div>

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {isCurrentlySelected && onRemove && (
                <button type="button" onClick={onRemove} className="text-xs font-semibold text-warn hover:underline">
                  選択から外す
                </button>
              )}
            </div>
            <Button type="button" onClick={onApply} disabled={applyDisabled} data-testid="product-detail-apply">
              この内容に変更する
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function sizeLabel(categoryCode: string): string {
  const labels: Record<string, string> = {
    ub: 'サイズ',
    washbasin: '間口',
    kitchen: '間口',
    boiler: '号数',
    aircon: '適用畳数',
    sash: 'サイズ・呼称',
    furniture: '寸法',
  };
  return labels[categoryCode] ?? 'サイズ・仕様';
}
