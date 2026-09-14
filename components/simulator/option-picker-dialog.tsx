'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import {
  equipmentCategoryPriceBreakdown,
  type EquipmentCategoryPriceState,
} from '@/lib/domain/equipment-price-display';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';
import { pruneHiddenVariantChoices, visibleVariantGroups } from '@/lib/domain/preset';
import { Button } from '@/components/ui';
import { ProductDetail } from './product-detail';
import { ProductList } from './product-list';
import { cn } from '@/lib/utils';

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

function deltaPriceLabel(value: number, priceOnRequest = false): string {
  if (priceOnRequest) return '別途見積';
  if (value === 0) return '0円';
  return value > 0 ? `+${formatYen(value)}` : formatYen(value);
}

function totalPriceLabel(state: EquipmentCategoryPriceState): string {
  if (state.kind === 'standard') return '標準';
  if (state.kind === 'price-on-request') return '別途見積';
  if (state.kind === 'no-change') return '追加費用なし';
  return state.delta > 0 ? `+${formatYen(state.delta)}` : formatYen(state.delta);
}

interface Props {
  category: OptionCategory;
  options: ProductOption[];
  selectedIds: string[];
  baselineSelectedIds: string[];
  blocked: Map<string, string>;
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
  selectedVariantIds: string[];
  baselineVariantIds: string[];
  onClose: () => void;
  onApply: (nextSelectedInCategory: string[], variantIds: string[]) => void;
}

/**
 * 商品一覧 → 商品詳細・仕様選択 → プラン反映を1つのモーダル内で行う。
 *
 * 詳細画面は「左＝見る、右＝選ぶ、下＝確認・反映」に役割を分ける。
 * 一覧・詳細とも、枠外クリック / × / Esc で閉じる。
 */
export function OptionPickerDialog({
  category,
  options,
  selectedIds,
  baselineSelectedIds,
  blocked,
  variantGroups,
  variantChoices,
  selectedVariantIds,
  baselineVariantIds,
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
  const isSingleSelection =
    category.code === 'boiler' ||
    category.code === 'aircon' ||
    category.selection_mode === 'single';
  const categoryDisplayName =
    category.code === 'boiler' ? '給湯器' : category.code === 'ub' ? 'ユニットバス' : category.name;

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

  const categoryVariantIds = (source: string[]) => {
    const categoryOptionIds = new Set(options.map((option) => option.id));
    const categoryGroupIds = new Set(
      variantGroups.filter((group) => categoryOptionIds.has(group.option_id)).map((group) => group.id)
    );
    return source.filter((choiceId) => {
      const groupId = variantChoices.find((choice) => choice.id === choiceId)?.group_id;
      return Boolean(groupId && categoryGroupIds.has(groupId));
    });
  };

  const optionVariantIds = (option: ProductOption) => {
    const groups = variantGroups
      .filter((group) => group.option_id === option.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const groupIds = new Set(groups.map((group) => group.id));
    const currentForProduct = selectedVariantIds.filter((choiceId) => {
      const groupId = variantChoices.find((choice) => choice.id === choiceId)?.group_id;
      return Boolean(groupId && groupIds.has(groupId));
    });
    return pruneHiddenVariantChoices(
      groups,
      variantChoices,
      defaultVariants(groups, variantChoices, currentForProduct)
    );
  };

  const nextSelectedForOption = (option: ProductOption) =>
    isSingleSelection
      ? [option.id]
      : selectedInCategory.includes(option.id)
        ? selectedInCategory
        : [...selectedInCategory, option.id];

  const nextVariantsForOption = (option: ProductOption, optionVariants: string[]) => {
    const detailGroupIds = new Set(
      variantGroups.filter((group) => group.option_id === option.id).map((group) => group.id)
    );
    const preserved = isSingleSelection
      ? []
      : categoryVariantIds(selectedVariantIds).filter((choiceId) => {
          const groupId = variantChoices.find((choice) => choice.id === choiceId)?.group_id;
          return !groupId || !detailGroupIds.has(groupId);
        });
    return [...preserved, ...optionVariants];
  };

  const priceBreakdown = (option: ProductOption, optionVariants: string[]) =>
    equipmentCategoryPriceBreakdown({
      categoryId: category.id,
      options,
      selectedIds: nextSelectedForOption(option),
      baselineIds: baselineSelectedIds,
      selectedVariantIds: nextVariantsForOption(option, optionVariants),
      baselineVariantIds,
      variantGroups,
      variantChoices,
    });

  const priceLabel = (option: ProductOption) =>
    totalPriceLabel(priceBreakdown(option, optionVariantIds(option)).state);

  const detailBreakdown = detailOption
    ? priceBreakdown(detailOption, draftVariantIds)
    : null;
  const productPriceDetailLabel = detailBreakdown
    ? deltaPriceLabel(detailBreakdown.productDelta, detailBreakdown.productPriceOnRequest)
    : '0円';
  const variantPriceDetailLabel = detailBreakdown
    ? deltaPriceLabel(detailBreakdown.variantDelta, detailBreakdown.variantPriceOnRequest)
    : '0円';
  const totalPriceDetailLabel = detailBreakdown
    ? totalPriceLabel(detailBreakdown.state)
    : '0円';

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

  const backToList = () => {
    setDetailOptionId(null);
    setDraftVariantIds([]);
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

  const currentCategoryVariantIds = () => categoryVariantIds(selectedVariantIds);

  const applyDetail = () => {
    if (!detailOption) return;

    const nextSelected = isSingleSelection
      ? [detailOption.id]
      : selectedInCategory.includes(detailOption.id)
        ? selectedInCategory
        : [...selectedInCategory, detailOption.id];

    const detailGroupIds = new Set(detailGroups.map((group) => group.id));
    const preservedVariants = isSingleSelection
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
      className={cn(
        'm-auto rounded-xl p-0 shadow-lift backdrop:bg-ink/40',
        detailOption ? 'w-[min(96vw,72rem)]' : 'w-[min(96vw,60rem)]'
      )}
      aria-labelledby="picker-title"
      data-testid="option-picker"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
        <div>
          <h2 id="picker-title" className="text-lg">
            {detailOption ? `${categoryDisplayName} 商品詳細` : `${categoryDisplayName}を選ぶ`}
          </h2>
          {!detailOption && (
            <p className="text-xs text-muted">
              {isSingleSelection ? '1つ選択' : '複数選択可'}
              {category.description ? `・${category.description}` : ''}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-sand" aria-label="閉じる">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div
        className={cn(
          'px-4 py-3 sm:px-5',
          detailOption
            ? 'max-h-[68vh] overflow-y-auto lg:h-[64vh] lg:max-h-[42rem] lg:overflow-hidden'
            : 'max-h-[74vh] overflow-y-auto'
        )}
      >
        {detailOption ? (
          <ProductDetail
            category={category}
            option={detailOption}
            groups={activeDetailGroups}
            choices={variantChoices}
            selectedVariantIds={draftVariantIds}
            isCurrentlySelected={isCurrentlySelected}
            onVariantChange={chooseVariant}
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

      {detailOption ? (
        <div className="border-t border-line bg-white px-4 py-3 sm:px-5" data-testid="product-detail-footer">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={backToList}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brown hover:underline"
                data-testid="product-detail-back"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                一覧へ戻る
              </button>
              {canRemove && (
                <button type="button" onClick={removeDetail} className="text-xs font-semibold text-warn hover:underline">
                  選択から外す
                </button>
              )}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <dl className="grid grid-cols-3 overflow-hidden rounded-lg border border-line bg-white text-center text-[0.68rem]">
                <div className="min-w-[6.5rem] px-2.5 py-1.5">
                  <dt className="text-muted">商品差額</dt>
                  <dd className="mt-0.5 font-semibold text-ink">{productPriceDetailLabel}</dd>
                </div>
                <div className="min-w-[6.5rem] border-x border-line px-2.5 py-1.5">
                  <dt className="text-muted">仕様差額</dt>
                  <dd className="mt-0.5 font-semibold text-ink">{variantPriceDetailLabel}</dd>
                </div>
                <div className="min-w-[7rem] bg-ivory/55 px-2.5 py-1.5">
                  <dt className="font-semibold text-brown">標準との差額</dt>
                  <dd className="mt-0.5 text-sm font-bold text-brown">{totalPriceDetailLabel}</dd>
                </div>
              </dl>

              <Button type="button" onClick={applyDetail} disabled={requiredVariantMissing} data-testid="product-detail-apply">
                この内容に変更する
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-end border-t border-line px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
        </div>
      )}
    </dialog>
  );
}
