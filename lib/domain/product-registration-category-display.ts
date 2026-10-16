import type { OptionCategory } from './types';

type ProductRegistrationCategoryGroup = {
  code: string;
  label: string;
  sort: number;
  codes: readonly string[];
};

/**
 * 商品登録・商品台帳で共通利用する表示用の大分類。
 *
 * 業務判定は本体仕様マトリクスの細分類を正本とし、ここでは登録担当者が探しやすいよう
 * 複数の正式カテゴリーだけを7つの表示グループへまとめる。
 */
export const PRODUCT_REGISTRATION_CATEGORY_GROUPS: readonly ProductRegistrationCategoryGroup[] = [
  {
    code: 'exterior',
    label: '本体・外装',
    sort: 1,
    codes: ['roof', 'exterior-wall', 'insulation-floor', 'insulation-wall', 'insulation-ceiling', 'insulation'],
  },
  {
    code: 'openings',
    label: '開口部・建具',
    sort: 2,
    codes: ['entrance-door', 'service-door', 'sash', 'interior-door'],
  },
  {
    code: 'interior',
    label: '内装・造作',
    sort: 3,
    codes: ['floor', 'wall-ceiling', 'carpentry'],
  },
  {
    code: 'equipment',
    label: '水回り',
    sort: 4,
    codes: ['ub', 'kitchen', 'washbasin', 'toilet', 'boiler'],
  },
  {
    code: 'electrical',
    label: '電気・設備',
    sort: 5,
    codes: ['aircon', 'lighting', 'smartlock'],
  },
  {
    code: 'furniture',
    label: '家具・収納',
    sort: 6,
    codes: ['entrance-storage', 'closet', 'bed', 'furniture', 'appliances', 'office-supplies'],
  },
  {
    code: 'sitework',
    label: '外構・現地工事',
    sort: 7,
    codes: ['exterior-parts', 'sitework'],
  },
] as const;

const PRODUCT_REGISTRATION_CATEGORY_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  aircon: 'エアコン',
};

type RankedCategory = {
  category: OptionCategory;
  groupIndex: number;
  itemIndex: number;
  originalIndex: number;
  groupLabel: string | null;
};

function productRegistrationCategoryLabel(category: OptionCategory): string {
  return PRODUCT_REGISTRATION_CATEGORY_LABEL_OVERRIDES[category.code] ?? category.name;
}

export function productRegistrationCategoryGroup(categoryCode: string): ProductRegistrationCategoryGroup | null {
  return PRODUCT_REGISTRATION_CATEGORY_GROUPS.find((group) => group.codes.includes(categoryCode)) ?? null;
}

export function productRegistrationCategoryDisplay(categories: OptionCategory[]): OptionCategory[] {
  const ranked: RankedCategory[] = categories.map((category, originalIndex) => {
    const groupIndex = PRODUCT_REGISTRATION_CATEGORY_GROUPS.findIndex((group) => group.codes.includes(category.code));
    const group = groupIndex >= 0 ? PRODUCT_REGISTRATION_CATEGORY_GROUPS[groupIndex] : null;
    const itemIndex = group ? group.codes.indexOf(category.code) : Number.MAX_SAFE_INTEGER;

    return {
      category,
      groupIndex: groupIndex >= 0 ? groupIndex : Number.MAX_SAFE_INTEGER,
      itemIndex,
      originalIndex,
      groupLabel: group?.label ?? null,
    };
  });

  ranked.sort((a, b) => {
    if (a.groupIndex !== b.groupIndex) return a.groupIndex - b.groupIndex;
    if (a.itemIndex !== b.itemIndex) return a.itemIndex - b.itemIndex;

    const aGroupSort = a.category.group_sort ?? Number.MAX_SAFE_INTEGER;
    const bGroupSort = b.category.group_sort ?? Number.MAX_SAFE_INTEGER;
    if (aGroupSort !== bGroupSort) return aGroupSort - bGroupSort;

    const aSort = a.category.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bSort = b.category.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (aSort !== bSort) return aSort - bSort;

    const nameOrder = a.category.name.localeCompare(b.category.name, 'ja');
    return nameOrder !== 0 ? nameOrder : a.originalIndex - b.originalIndex;
  });

  return ranked.map(({ category, groupLabel }) =>
    groupLabel
      ? {
          ...category,
          name: `【${groupLabel}】${productRegistrationCategoryLabel(category)}`,
        }
      : category
  );
}
