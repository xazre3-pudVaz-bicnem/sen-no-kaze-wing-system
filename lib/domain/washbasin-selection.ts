import type { ProductOption } from '@/lib/domain/types';

export const WASHBASIN_STANDARD_SET_ID = '__washbasin-standard-set__';
const LEGACY_WASHBASIN_CODES = ['washbasin-kb', 'faucet-kb'] as const;

export function legacyWashbasinOptions(options: ProductOption[]): ProductOption[] {
  return LEGACY_WASHBASIN_CODES
    .map((code) => options.find((option) => option.code === code))
    .filter((option): option is ProductOption => Boolean(option));
}

export function isLegacyWashbasinOption(option: ProductOption): boolean {
  return LEGACY_WASHBASIN_CODES.includes(option.code as (typeof LEGACY_WASHBASIN_CODES)[number]);
}

export function isWashbasinStandardSet(option: ProductOption): boolean {
  return option.id === WASHBASIN_STANDARD_SET_ID;
}

export function washbasinStandardSetOption(
  options: ProductOption[],
  baselineIds: string[]
): ProductOption | null {
  const members = legacyWashbasinOptions(options);
  if (members.length !== LEGACY_WASHBASIN_CODES.length) return null;

  const [basin, faucet] = members;
  const isBaseline = members.every((option) => baselineIds.includes(option.id));

  return {
    ...basin,
    id: WASHBASIN_STANDARD_SET_ID,
    code: 'washbasin-standard-set',
    name: isBaseline ? '標準洗面セット' : '洗面器＋混合水栓セット',
    description: `${basin.name} と ${faucet.name} を組み合わせた洗面セットです。`,
    price: members.reduce((sum, option) => sum + option.price, 0),
    price_on_request: members.some((option) => option.price_on_request),
    image_url: basin.image_url ?? faucet.image_url,
    manufacturer: null,
    model_no: null,
    size_note: null,
    list_price: null,
    highlight: isBaseline ? '標準' : null,
    preview_key: basin.preview_key ?? faucet.preview_key,
    affects_views: Array.from(new Set(members.flatMap((option) => option.affects_views))),
    sort_order: Math.min(...members.map((option) => option.sort_order)),
  };
}

export function washbasinSelectionIdsForOption(
  option: ProductOption,
  actualOptions: ProductOption[]
): string[] {
  if (!isWashbasinStandardSet(option)) return [option.id];
  return legacyWashbasinOptions(actualOptions).map((member) => member.id);
}

export function washbasinDisplayOptions(
  options: ProductOption[],
  baselineIds: string[]
): ProductOption[] {
  const standardSet = washbasinStandardSetOption(options, baselineIds);
  const alternatives = options.filter((option) => !isLegacyWashbasinOption(option));
  return standardSet ? [standardSet, ...alternatives] : options;
}

export function isWashbasinDisplayOptionSelected(
  option: ProductOption,
  selectedIds: string[],
  actualOptions: ProductOption[]
): boolean {
  return washbasinSelectionIdsForOption(option, actualOptions).every((id) => selectedIds.includes(id));
}


export function normalizeWashbasinSelection(
  options: ProductOption[],
  selectedIds: string[],
  baselineIds: string[] = []
): string[] {
  const members = legacyWashbasinOptions(options);
  if (members.length !== LEGACY_WASHBASIN_CODES.length) return selectedIds;

  const categoryId = members[0].category_id;
  const categoryOptions = options
    .filter((option) => option.category_id === categoryId)
    .sort((a, b) => a.sort_order - b.sort_order);
  const categoryIds = new Set(categoryOptions.map((option) => option.id));
  const selectedInCategory = categoryOptions.filter((option) => selectedIds.includes(option.id));

  if (selectedInCategory.length === 0) return selectedIds;

  const alternatives = selectedInCategory.filter((option) => !isLegacyWashbasinOption(option));
  let normalizedCategoryIds: string[];

  if (alternatives.length > 0) {
    const baselineAlternative = alternatives.find((option) => baselineIds.includes(option.id));
    normalizedCategoryIds = [(baselineAlternative ?? alternatives[0]).id];
  } else {
    normalizedCategoryIds = members.map((option) => option.id);
  }

  return [
    ...selectedIds.filter((id) => !categoryIds.has(id)),
    ...normalizedCategoryIds,
  ];
}
