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

  return (
    <ProductDetail
      category={category}
      option={option}
      groups={visibleGroups}
      choices={preview.choices}
      selectedVariantIds={selectedVariantIds}
      isCurrentlySelected={false}
      onVariantChange={onVariantChange}
    />
  );
}
