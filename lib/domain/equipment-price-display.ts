import type { OptionVariantChoice, OptionVariantGroup, ProductOption } from './types';

export type EquipmentCategoryPriceState =
  | { kind: 'standard' }
  | { kind: 'delta'; delta: number }
  | { kind: 'no-change' }
  | { kind: 'price-on-request' };

interface EquipmentCategoryPriceStateInput {
  categoryId: string;
  options: ProductOption[];
  selectedIds: string[];
  baselineIds: string[];
  selectedVariantIds: string[];
  baselineVariantIds: string[];
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
}

function sameSet(a: string[], b: string[]): boolean {
  const aa = [...new Set(a)].sort();
  const bb = [...new Set(b)].sort();
  return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}

function relevantVariantChoiceIds(
  optionIds: string[],
  variantIds: string[],
  variantGroups: OptionVariantGroup[],
  variantChoices: OptionVariantChoice[]
): string[] {
  const optionSet = new Set(optionIds);
  const groupIds = new Set(
    variantGroups.filter((group) => optionSet.has(group.option_id)).map((group) => group.id)
  );
  const selectedVariants = new Set(variantIds);
  return variantChoices
    .filter((choice) => groupIds.has(choice.group_id) && selectedVariants.has(choice.id))
    .map((choice) => choice.id);
}

interface SelectionAmount {
  productAmount: number;
  variantAmount: number;
  productPriceOnRequest: boolean;
  variantPriceOnRequest: boolean;
}

function selectionAmount(
  optionIds: string[],
  variantIds: string[],
  options: ProductOption[],
  variantGroups: OptionVariantGroup[],
  variantChoices: OptionVariantChoice[]
): SelectionAmount {
  const selected = new Set(optionIds);
  const selectedVariants = new Set(variantIds);
  const groupById = new Map(variantGroups.map((group) => [group.id, group]));

  let productAmount = 0;
  let variantAmount = 0;
  let productPriceOnRequest = false;
  let variantPriceOnRequest = false;

  for (const option of options) {
    if (!selected.has(option.id)) continue;
    if (option.price_on_request) productPriceOnRequest = true;
    else productAmount += option.price;

    for (const choice of variantChoices) {
      if (!selectedVariants.has(choice.id)) continue;
      const group = groupById.get(choice.group_id);
      if (group?.option_id !== option.id) continue;
      if (choice.price_on_request) variantPriceOnRequest = true;
      else variantAmount += choice.extra_price;
    }
  }

  return {
    productAmount,
    variantAmount,
    productPriceOnRequest,
    variantPriceOnRequest,
  };
}

export interface EquipmentCategoryPriceBreakdown {
  state: EquipmentCategoryPriceState;
  productDelta: number;
  variantDelta: number;
  productPriceOnRequest: boolean;
  variantPriceOnRequest: boolean;
}

export function equipmentCategoryPriceBreakdown({
  categoryId,
  options,
  selectedIds,
  baselineIds,
  selectedVariantIds,
  baselineVariantIds,
  variantGroups,
  variantChoices,
}: EquipmentCategoryPriceStateInput): EquipmentCategoryPriceBreakdown {
  const categoryOptionIds = new Set(
    options.filter((option) => option.category_id === categoryId).map((option) => option.id)
  );
  const currentIds = selectedIds.filter((id) => categoryOptionIds.has(id));
  const standardIds = baselineIds.filter((id) => categoryOptionIds.has(id));

  const currentVariantIds = relevantVariantChoiceIds(
    currentIds,
    selectedVariantIds,
    variantGroups,
    variantChoices
  );
  const standardVariantIds = relevantVariantChoiceIds(
    standardIds,
    baselineVariantIds,
    variantGroups,
    variantChoices
  );

  const current = selectionAmount(
    currentIds,
    currentVariantIds,
    options,
    variantGroups,
    variantChoices
  );
  const standard = selectionAmount(
    standardIds,
    standardVariantIds,
    options,
    variantGroups,
    variantChoices
  );

  const productDelta = current.productAmount - standard.productAmount;
  const variantDelta = current.variantAmount - standard.variantAmount;
  const productPriceOnRequest =
    current.productPriceOnRequest || standard.productPriceOnRequest;
  const variantPriceOnRequest =
    current.variantPriceOnRequest || standard.variantPriceOnRequest;

  let state: EquipmentCategoryPriceState;
  if (sameSet(currentIds, standardIds) && sameSet(currentVariantIds, standardVariantIds)) {
    state = { kind: 'standard' };
  } else if (productPriceOnRequest || variantPriceOnRequest) {
    state = { kind: 'price-on-request' };
  } else {
    const delta = productDelta + variantDelta;
    state = delta === 0 ? { kind: 'no-change' } : { kind: 'delta', delta };
  }

  return {
    state,
    productDelta,
    variantDelta,
    productPriceOnRequest,
    variantPriceOnRequest,
  };
}

/**
 * 設備カードの価格表示を、現在の標準見積との差額として判定する。
 * 標準商品は商品価格が0円でなくても「標準」、変更時だけ差額を表示する。
 */
export function equipmentCategoryPriceState(
  input: EquipmentCategoryPriceStateInput
): EquipmentCategoryPriceState {
  return equipmentCategoryPriceBreakdown(input).state;
}
