import type { OptionCategory } from './types';
import { PRODUCT_REGISTRATION_CATEGORY_GROUPS } from './product-registration-category-display';

/**
 * カテゴリーの「お客様画面に表示」だけを変更する操作用フォーム。
 * 既存のカテゴリー保存 action と同じ必須フィールドを渡し、
 * 必須・分類・公開状態を勝手に初期値へ戻さない。
 */
export function customerCategoryVisibilityFormData(category: OptionCategory, visible: boolean): FormData {
  const data = new FormData();
  data.set('id', category.id);
  data.set('code', category.code);
  data.set('name', category.name);
  data.set('description', category.description ?? '');
  data.set('group_code', category.group_code);
  data.set('group_name', category.group_name);
  data.set('group_sort', String(category.group_sort));
  data.set('selection_mode', category.selection_mode);
  data.set('finish_level', category.finish_level);
  data.set('sort_order', String(category.sort_order));
  data.set('status', category.status);

  if (category.is_required) data.set('is_required', 'on');
  if (visible) data.set('customer_visible', 'on');
  return data;
}


export interface CustomerCategoryDisplayGroup {
  key: string;
  label: string;
  categories: OptionCategory[];
}

/**
 * 商品登録・商品台帳と同じ「表示用」の7分類でカテゴリーを束ねる。
 * 正式な category.group_code/group_sort は更新しない。
 * 後から追加された未定義コードも最後の「その他」に残して操作可能にする。
 */
export function groupCustomerCategories(categories: OptionCategory[]): CustomerCategoryDisplayGroup[] {
  const assigned = new Set<string>();
  const groups: CustomerCategoryDisplayGroup[] = [];

  for (const group of PRODUCT_REGISTRATION_CATEGORY_GROUPS) {
    const members = categories.filter((category) => group.codes.includes(category.code));
    if (members.length === 0) continue;
    members.sort((a, b) => {
      const rank = group.codes.indexOf(a.code) - group.codes.indexOf(b.code);
      if (rank !== 0) return rank;
      return a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja');
    });
    for (const category of members) assigned.add(category.id);
    groups.push({ key: group.code, label: group.label, categories: members });
  }

  const others = categories.filter((category) => !assigned.has(category.id));
  others.sort((a, b) =>
    a.group_sort - b.group_sort ||
    a.sort_order - b.sort_order ||
    a.name.localeCompare(b.name, 'ja')
  );
  if (others.length > 0) {
    groups.push({ key: 'other-unmapped', label: 'その他のカテゴリー', categories: others });
  }
  return groups;
}
