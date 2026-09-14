'use client';

import { Check, ImageOff } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { VariantPicker } from './variant-picker';

interface Props {
  category: OptionCategory;
  option: ProductOption;
  groups: OptionVariantGroup[];
  choices: OptionVariantChoice[];
  selectedVariantIds: string[];
  isCurrentlySelected: boolean;
  onVariantChange: (choiceId: string, groupId: string) => void;
}

/**
 * 共通商品詳細の本文。
 *
 * 左側は「見る場所」＝商品画像・説明。
 * 右側は「選ぶ場所」＝基本情報・文字カードの仕様選択・今回の選択内容。
 * 金額と確定ボタンは親ダイアログの固定フッターに置く。
 */
export function ProductDetail({
  category,
  option,
  groups,
  choices,
  selectedVariantIds,
  isCurrentlySelected,
  onVariantChange,
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

  const selectedSpecs = groups
    .map((group) => {
      const list = choices.filter((choice) => choice.group_id === group.id);
      const choice = list.find((item) => selectedVariantIds.includes(item.id));
      if (!choice) return null;
      if (list.length === 1 && choice.kind === 'fixed' && choice.name.trim() === option.name.trim()) return null;
      return { group, choice };
    })
    .filter(
      (item): item is { group: OptionVariantGroup; choice: OptionVariantChoice } => Boolean(item)
    );

  return (
    <div className="h-full min-h-0" data-testid="product-detail">
      <div className="grid h-full min-h-0 gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(21rem,0.92fr)]">
        <section className="min-w-0 lg:self-start">
          <div className="mb-2 rounded-lg border border-line bg-white px-3 py-2 text-center text-xs font-semibold text-brown">
            商品画像
          </div>

          <div className="relative aspect-[3/2] overflow-hidden rounded-lg border border-line bg-sand">
            {option.image_url ? (
              <SmartImage
                src={option.image_url}
                alt={option.name}
                fill
                sizes="(min-width: 1024px) 36rem, 90vw"
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

        <section className="min-h-0 min-w-0 lg:overflow-y-auto lg:pr-2">
          <div className="border-b border-line pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {option.manufacturer && <p className="text-xs font-semibold text-brown">{option.manufacturer}</p>}
                <h3 className="mt-0.5 text-lg font-semibold leading-snug text-ink">{option.name}</h3>
              </div>
              {isCurrentlySelected && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brown px-2 py-1 text-[0.68rem] font-semibold text-white">
                  <Check className="size-3" aria-hidden="true" />
                  現在選択中
                </span>
              )}
            </div>

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
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold text-ink">標準仕様</p>
              <dl className="grid gap-1.5 rounded-lg bg-ivory/55 px-3 py-2.5 text-xs">
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
            </div>
          )}

          {editableGroups.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink">仕様を選ぶ</h4>
                <p className="text-[0.65rem] text-muted">色・柄は商品画像やメーカー資料でご確認ください</p>
              </div>
              <VariantPicker
                groups={editableGroups}
                choices={choices}
                selected={selectedVariantIds}
                onChange={onVariantChange}
                showImages={false}
              />
            </div>
          )}

          {selectedSpecs.length > 0 && (
            <section className="mt-4 rounded-lg border border-line bg-white" data-testid="product-detail-summary">
              <h4 className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">今回の選択内容</h4>
              <dl className="divide-y divide-line text-xs">
                {selectedSpecs.map(({ group, choice }) => (
                  <div key={group.id} className="grid grid-cols-[6.5rem_1fr] gap-2 px-3 py-2">
                    <dt className="text-muted">{group.name}</dt>
                    <dd className="min-w-0 break-words font-medium text-ink">
                      {choice.name}
                      {choice.price_on_request && <span className="ml-2 text-warn">別途見積</span>}
                      {!choice.price_on_request && choice.extra_price > 0 && (
                        <span className="ml-2 text-ink-soft">+{formatYen(choice.extra_price)}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
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
