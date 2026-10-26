import type { OptionCategory } from './types';

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
