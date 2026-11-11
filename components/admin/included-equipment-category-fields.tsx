'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui';
import {
  includedEquipmentCategoryCandidates,
  splitIncludedEquipmentCategoryIds,
  type IncludedEquipmentCategoryCandidate,
} from '@/lib/domain/included-equipment-category-input';

interface Props {
  /** Client selection, never the persisted source of truth. */
  includedCategoryIds: readonly string[];
  candidates: readonly IncludedEquipmentCategoryCandidate[];
  ownCategoryId: string;
  onSelectionChange: (ids: string[]) => void;
  disabled?: boolean;
}

/** Form-free input: inclusion is saved by its own RPC, not by the product information action. */
export function IncludedEquipmentCategoryFields({
  includedCategoryIds, candidates, ownCategoryId, onSelectionChange, disabled = false,
}: Props) {
  const visibleCandidates = includedEquipmentCategoryCandidates(candidates, ownCategoryId);
  const { visibleIds, preservedIds } = splitIncludedEquipmentCategoryIds(includedCategoryIds, visibleCandidates);
  const [expanded, setExpanded] = useState(false);
  const selectedNames = visibleCandidates.filter((category) => visibleIds.includes(category.id)).map((category) => category.name);
  const totalCount = includedCategoryIds.length;

  return (
    <details
      className="card p-4 sm:p-5"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      data-testid="included-equipment-categories"
    >
      <summary className="cursor-pointer text-sm" data-testid="included-equipment-categories-summary">
        <span className="font-semibold">この商品に含まれる設備</span>
        <span className="ml-2 text-xs text-muted">設定中 {totalCount}件</span>
        <span className="mt-1 block text-xs text-muted">
          {totalCount === 0 ? '設定なし（必要なときだけ開く）'
            : [selectedNames.join('・'), preservedIds.length ? `候補外の既存設定 ${preservedIds.length}件` : ''].filter(Boolean).join('・')}
        </span>
      </summary>
      <div className="mt-4 space-y-3">
        <p className="text-xs leading-5 text-muted">
          この商品に一体で含まれる設備カテゴリーだけを選択します。別室に追加する設備や価格控除の判断には使用しません。
        </p>
        {preservedIds.length > 0 && (
          <p className="text-xs text-danger" role="alert">
            候補にない既存設定が{preservedIds.length}件あります。意図せず削除しないため、保存を停止します。管理者へ確認してください。
          </p>
        )}
        {visibleCandidates.length > 0 ? (
          <fieldset disabled={disabled || preservedIds.length > 0} className="grid gap-2 sm:grid-cols-2" data-testid="included-equipment-categories-choices">
            <legend className="sr-only">含まれる設備カテゴリーを選択</legend>
            {visibleCandidates.map((category) => (
              <div key={category.id} className="rounded-md border border-line bg-white px-3 py-2">
                <Checkbox
                  value={category.id}
                  checked={visibleIds.includes(category.id)}
                  onChange={() => onSelectionChange(
                    visibleIds.includes(category.id)
                      ? includedCategoryIds.filter((id) => id !== category.id)
                      : [...includedCategoryIds, category.id]
                  )}
                  label={category.name}
                />
              </div>
            ))}
          </fieldset>
        ) : <p className="text-xs text-muted">選択可能な設備カテゴリーはありません。</p>}
      </div>
    </details>
  );
}
