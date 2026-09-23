'use client';

import { useMemo, useState } from 'react';
import { ProductDetail } from '@/components/simulator/product-detail';
import { defaultVariantIdsFor, pruneHiddenVariantChoices, visibleVariantGroups } from '@/lib/domain/preset';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';

type Props = {
  category: OptionCategory;
  option: ProductOption;
  groups: OptionVariantGroup[];
  choices: OptionVariantChoice[];
};

export function OptionCustomerPreview({ category, option, groups, choices }: Props) {
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

  const categoryDisplayName =
    category.code === 'boiler' ? '給湯器' : category.code === 'ub' ? 'ユニットバス' : category.name;

  return (
    <div data-testid="simulator-product-detail-preview">
      <div className="overflow-hidden rounded-xl border border-line bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
          <div>
            <h3 className="text-lg">{categoryDisplayName} 商品詳細</h3>
          </div>
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
          />
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">
        商品詳細本文は実際のシミュレーターと同じコンポーネントです。商品追加額・仕様追加額・合計追加額と
        「この内容に変更する」操作は、実際のシミュレーターで選択中の標準商品・仕様によって変わるため、この確認画面では表示しません。
      </p>
    </div>
  );
}
