'use client';

import { useMemo, useState } from 'react';
import { ProductDetail } from '@/components/simulator/product-detail';
import { defaultVariantIdsFor, pruneHiddenVariantChoices, visibleVariantGroups } from '@/lib/domain/preset';
import { formatPriceWithUnit } from '@/lib/domain/product-price-unit';
import { isHqCostProduct } from '@/lib/domain/option-cost-access';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';

type Props = {
  category: OptionCategory;
  option: ProductOption;
  groups: OptionVariantGroup[];
  choices: OptionVariantChoice[];
  /** 価格（旧シミュレーターの表示＝商品標準原価）を出す。原価を出さない担当者には出さない（v2.5 PR-A3） */
  showPrice?: boolean;
};

export function OptionCustomerPreview({ category, option, groups, choices, showPrice = true }: Props) {
  const preview = useMemo(() => {
    const publishedGroups = groups.filter((group) => group.status === 'published');
    const publishedChoices = choices.filter((choice) => choice.status === 'published');
    return {
      groups: publishedGroups,
      choices: publishedChoices,
      defaults: defaultVariantIdsFor(publishedGroups, publishedChoices, [option.id]),
    };
  }, [choices, groups, option.id]);
  const [selectedVariantIds, setSelectedVariantIds] = useState(preview.defaults);

  const onVariantChange = (choiceId: string, groupId: string) => {
    setSelectedVariantIds((current) =>
      pruneHiddenVariantChoices(
        preview.groups,
        preview.choices,
        [
          ...current.filter((id) => preview.choices.find((choice) => choice.id === id)?.group_id !== groupId),
          choiceId,
        ]
      )
    );
  };

  const visibleGroups = visibleVariantGroups(preview.groups, preview.choices, selectedVariantIds);
  const configuredChoiceGroups = preview.groups.filter((group) =>
    preview.choices.some((choice) => choice.group_id === group.id)
  );
  // 本部商品の金額は商品標準原価（旧シミュレーターでは表示価格にも使う）。本部商品の外（旧フリー商品）は商品価格
  const priceLabel = isHqCostProduct(category.code) ? '商品標準原価' : '商品価格';
  const registrationPriceDisplay = !showPrice
    ? '本部が登録します'
    : option.price_on_request
    ? '別途見積'
    : `${formatPriceWithUnit(option.price, option.price_unit)}（税別）`;
  const manufacturerPriceDisplay = option.list_price == null
    ? '未設定'
    : `${formatPriceWithUnit(option.list_price, option.list_price_unit)}（税別）`;
  const registrationCustomerChoices = configuredChoiceGroups.length > 0
    ? `${configuredChoiceGroups.map((group) => group.name).join('・')}（${configuredChoiceGroups.length}項目）`
    : 'なし';

  const categoryDisplayName =
    category.code === 'boiler' ? '給湯器' : category.code === 'ub' ? 'ユニットバス' : category.name;

  // 共通化の回帰テスト用メモ。画面には表示しない。
  // 商品詳細本文は実際のシミュレーターと同じコンポーネントです。
  // 商品追加額などシミュレーター選択状態に依存する操作は、この確認画面では表示しません。

  return (
    <div
      data-testid="simulator-product-detail-preview"
      data-registration-price-display={registrationPriceDisplay}
      data-registration-price-label={`${priceLabel}（税別）`}
      data-registration-manufacturer={option.manufacturer?.trim() || '未設定'}
      data-registration-model-no={option.model_no?.trim() || '未設定'}
      data-registration-customer-choices={registrationCustomerChoices}
    >
      <div className="overflow-hidden rounded-xl border border-line bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
          <div>
            <h3 className="text-lg">{categoryDisplayName} 商品詳細</h3>
          </div>
        </div>
        <div className="grid gap-2 border-b border-line bg-sand/30 px-4 py-3 text-xs sm:grid-cols-2 sm:px-5" data-testid="registration-price-unit-summary">
          <p><span className="font-semibold text-muted">{priceLabel}：</span><span className="font-semibold text-ink">{registrationPriceDisplay}</span></p>
          <p><span className="font-semibold text-muted">メーカー参考価格：</span><span className="font-semibold text-ink">{manufacturerPriceDisplay}</span></p>
        </div>
        <div className="px-4 py-3 sm:px-5 lg:h-[64vh] lg:max-h-[42rem] lg:overflow-hidden">
          <ProductDetail
            category={category}
            option={option}
            groups={visibleGroups}
            choices={preview.choices}
            selectedVariantIds={selectedVariantIds}
            isCurrentlySelected={false}
            onVariantChange={onVariantChange}
            compactMedia
          />
        </div>
      </div>
    </div>
  );
}
