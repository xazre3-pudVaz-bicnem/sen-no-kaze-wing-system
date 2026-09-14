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
 * 固定仕様は選択カードにせず、必要な場合だけ簡潔なテキストで表示する。
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
    { label: 'シリーズ・型番', value: option.model_no },
    { label: sizeLabel(category.code), value: option.size_note },
    { label: '区分', value: option.highlight },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value?.trim()));

  const fixedSpecs = groups
    .map((group) => {
      const list = choices.filter((choice) => choice.group_id === group.id);
      const choice = list.length === 1 && list[0].kind === 'fixed' ? list[0] : null;
      return choice && choice.name.trim() !== option.name.trim() ? { group, choice } : null;
    })
    .filter(
      (item): item is { group: OptionVariantGroup; choice: OptionVariantChoice } => Boolean(item)
    );

  const editableGroups = groups.filter((group) => {
    const list = choices.filter((choice) => choice.group_id === group.id);
    return !(list.length === 1 && list[0].kind === 'fixed');
  });

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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(19rem,0.92fr)]">
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

          <div className="relative aspect-[3/2] overflow-hidden rounded-lg border border-line bg-sand">
            {option.image_url ? (
              <SmartImage
                src={option.image_url}
                alt={option.name}
                fill
                sizes="(min-width: 1024px) 32rem, 90vw"
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

        <section className="min-w-0 lg:flex lg:flex-col">
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

          {fixedSpecs.length > 0 && (
            <dl className="mt-3 grid gap-1.5 rounded-lg bg-ivory/55 px-3 py-2.5 text-xs">
              {fixedSpecs.map(({ group, choice }) => (
                <div key={group.id} className="grid grid-cols-[5.5rem_1fr] gap-2">
                  <dt className="text-muted">{group.name}</dt>
                  <dd className="min-w-0 break-words text-ink-soft">
                    {choice.name}
                    {choice.price_on_request
                      ? '（別途見積）'
                      : choice.extra_price > 0
                        ? `（+${formatYen(choice.extra_price)}）`
                        : ''}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {editableGroups.length > 0 && (
            <VariantPicker
              groups={editableGroups}
              choices={choices}
              selected={selectedVariantIds}
              onChange={onVariantChange}
            />
          )}

          <div className="sticky bottom-0 z-10 mt-4 border-t border-line bg-white/95 pt-3 pb-1 backdrop-blur lg:mt-auto">
            <div className="rounded-lg border border-line bg-white p-3">
              <p className="text-[0.68rem] text-muted">追加金額</p>
              <p className="mt-0.5 text-base font-semibold text-ink">{priceLabel}</p>
            </div>

            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
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
    boiler: 'サイズ・設置',
    aircon: '適用畳数',
    sash: 'サイズ・呼称',
    furniture: '寸法',
  };
  return labels[categoryCode] ?? 'サイズ・仕様';
}
