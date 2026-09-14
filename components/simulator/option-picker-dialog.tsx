'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';
import { pruneHiddenVariantChoices, visibleVariantGroups } from '@/lib/domain/preset';
import { Button } from '@/components/ui';
import { ProductDetail } from './product-detail';
import { ProductList } from './product-list';

/** 選択項目ごとに、現在値 → 標準 → 固定 → 先頭の順で初期値を選ぶ */
function defaultVariants(groups: OptionVariantGroup[], choices: OptionVariantChoice[], current: string[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    const list = choices.filter((c) => c.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order);
    if (list.length === 0) continue;
    const already = list.find((c) => current.includes(c.id));
    out.push((already ?? list.find((c) => c.kind === 'standard' || c.kind === 'fixed') ?? list[0]).id);
  }
  return out;
}

interface Props {
  category: OptionCategory;
  options: ProductOption[];
  selectedIds: string[];
  blocked: Map<string, string>;
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
  selectedVariantIds: string[];
  onClose: () => void;
  onApply: (nextSelectedInCategory: string[], variantIds: string[]) => void;
}

/**
 * 商品一覧 → 商品詳細・仕様選択 → プラン反映を1つのモーダル内で行う。
 *
 * 一覧・詳細とも、枠外クリック / × / Esc で閉じる。
 * 一覧で商品を開いただけではプランを変更せず、
 * 詳細の「この内容に変更する」で初めて onApply を呼ぶ。
 */
export function OptionPickerDialog({
  category,
  options,
  selectedIds,
  blocked,
  variantGroups,
  variantChoices,
  selectedVariantIds,
  onClose,
  onApply,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [detailOptionId, setDetailOptionId] = useState<string | null>(null);
  const [draftVariantIds, setDraftVariantIds] = useState<string[]>([]);

  const selectedInCategory = useMemo(
    () => options.filter((option) => selectedIds.includes(option.id)).map((option) => option.id),
    [options, selectedIds]
  );
  const detailOption = options.find((option) => option.id === detailOptionId) ?? null;
  const detailGroups = detailOption
    ? variantGroups.filter((group) => group.option_id === detailOption.id).sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const activeDetailGroups = detailOption
    ? visibleVariantGroups(detailGroups, variantChoices, draftVariantIds)
    : [];

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const priceLabel = (option: ProductOption) =>
    option.price_on_request ? '別途見積' : option.price === 0 ? '追加費用なし' : `+${formatYen(option.price)}`;

  const openDetail = (option: ProductOption) => {
    const groups = variantGroups
      .filter((group) => group.option_id === option.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const groupIds = new Set(groups.map((group) => group.id));
    const currentForProduct = selectedVariantIds.filter((choiceId) => {
      const groupId = variantChoices.find((choice) => choice.id === choiceId)?.group_id;
      return Boolean(groupId && groupIds.has(groupId));
    });
    const defaults = defaultVariants(groups, variantChoices, currentForProduct);
    setDraftVariantIds(pruneHiddenVariantChoices(groups, variantChoices, defaults));
    setDetailOptionId(option.id);
  };

  const chooseVariant = (choiceId: string, groupId: string) => {
    if (!detailOption) return;

    setDraftVariantIds((current) => {
      const withoutCurrentGroup = current.filter(
        (id) => variantChoices.find((choice) => choice.id === id)?.group_id !== groupId
      );
      const next = [...withoutCurrentGroup, choiceId];
      const visible = visibleVariantGroups(detailGroups, variantChoices, next);
      const withDefaults = [
        ...next,
        ...defaultVariants(visible, variantChoices, next).filter((id) => !next.includes(id)),
      ];
      return pruneHiddenVariantChoices(detailGroups, variantChoices, withDefaults);
    });
  };

  const currentCategoryVariantIds = () => {
    const categoryOptionIds = new Set(options.map((option) => option.id));
    const categoryGroupIds = new Set(
      variantGroups.filter((group) => categoryOptionIds.has(group.option_id)).map((group) => group.id)
    );
    return selectedVariantIds.filter((choiceId) => {
      const groupId = variantChoices.find((choice) => choice.id === choiceId)?.group_id;
      return Boolean(groupId && categoryGroupIds.has(groupId));
    });
  };

  const applyDetail = () => {
    if (!detailOption) return;

    const nextSelected = category.selection_mode === 'single'
      ? [detailOption.id]
      : selectedInCategory.includes(detailOption.id)
        ? selectedInCategory
        : [...selectedInCategory, detailOption.id];

    const detailGroupIds = new Set(detailGroups.map((group) => group.id));
    const preservedVariants = category.selection_mode === 'single'
      ? []
      : currentCategoryVariantIds().filter((choiceId) => {
          const groupId = variantChoices.find((choice) => choice.id === choiceId)?.group_id;
          return !groupId || !detailGroupIds.has(groupId);
        });

    onApply(nextSelected, [...preservedVariants, ...draftVariantIds]);
  };

  const removeDetail = () => {
    if (!detailOption) return;

    const detailGroupIds = new Set(detailGroups.map((group) => group.id));
    const nextVariants = currentCategoryVariantIds().filter((choiceId) => {
      const groupId = variantChoices.find((choice) => choice.id === choiceId)?.group_id;
      return !groupId || !detailGroupIds.has(groupId);
    });

    onApply(
      selectedInCategory.filter((id) => id !== detailOption.id),
      nextVariants
    );
  };

  const requiredVariantMissing = activeDetailGroups.some((group) => {
    if (!group.is_required) return false;
    return !variantChoices.some(
      (choice) => choice.group_id === group.id && draftVariantIds.includes(choice.id)
    );
  });

  const isCurrentlySelected = detailOption ? selectedInCategory.includes(detailOption.id) : false;
  const canRemove =
    Boolean(detailOption && isCurrentlySelected) &&
    (!category.is_required || selectedInCategory.length > 1);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto w-[min(96vw,60rem)] rounded-xl p-0 shadow-lift backdrop:bg-ink/40"
      aria-labelledby="picker-title"
      data-testid="option-picker"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
        <div>
          <h2 id="picker-title" className="text-lg">
            {detailOption ? `${category.name} 商品詳細` : `${category.name}を選ぶ`}
          </h2>
          {!detailOption && (
            <p className="text-xs text-muted">
              {category.selection_mode === 'single' ? '1つ選択' : '複数選択可'}
              {category.description ? `・${category.description}` : ''}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-sand" aria-label="閉じる">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="max-h-[76vh] overflow-y-auto px-4 py-3 sm:px-5">
        {detailOption ? (
          <ProductDetail
            category={category}
            option={detailOption}
            groups={activeDetailGroups}
            choices={variantChoices}
            selectedVariantIds={draftVariantIds}
            isCurrentlySelected={isCurrentlySelected}
            priceLabel={priceLabel(detailOption)}
            onVariantChange={chooseVariant}
            onBack={() => {
              setDetailOptionId(null);
              setDraftVariantIds([]);
            }}
            onApply={applyDetail}
            onRemove={canRemove ? removeDetail : undefined}
            applyDisabled={requiredVariantMissing}
          />
        ) : (
          <ProductList
            category={category}
            options={options}
            selectedIds={selectedInCategory}
            getPriceLabel={priceLabel}
            getDisabledReason={(option) =>
              selectedInCategory.includes(option.id) ? null : blocked.get(option.id) ?? null
            }
            onOpenProduct={openDetail}
          />
        )}
      </div>

      {!detailOption && (
        <div className="flex justify-end border-t border-line px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
        </div>
      )}
    </dialog>
  );
}
