import type { OptionCategory } from './types';

type ProductRegistrationCategoryGroup = {
  label: string;
  codes: readonly string[];
};

export const PRODUCT_REGISTRATION_CATEGORY_GROUPS: readonly ProductRegistrationCategoryGroup[] = [
  {
    label: '本体・外装',
    codes: ['insulation', 'roof', 'exterior-wall'],
  },
  {
    label: '開口部・建具',
    codes: ['entrance-door', 'service-door', 'sash', 'interior-door'],
  },
  {
    label: '内装・造作',
    codes: ['floor', 'wall-ceiling', 'entrance-storage', 'closet', 'carpentry'],
  },
  {
    label: '水回り',
    codes: ['ub', 'kitchen', 'washbasin', 'toilet', 'boiler'],
  },
  {
    label: '電気・設備',
    codes: ['aircon', 'lighting', 'smartlock'],
  },
  {
    label: '家具・備品',
    codes: ['bed', 'furniture', 'appliances', 'office-supplies'],
  },
  {
    label: '外構・現地工事',
    codes: ['exterior-parts', 'sitework'],
  },
] as const;

type RankedCategory = {
  category: OptionCategory;
  groupIndex: number;
  itemIndex: number;
  originalIndex: number;
  groupLabel: string | null;
};

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
          name: `【${groupLabel}】${category.name}`,
        }
      : category
  );
}
