/**
 * 商品に含まれる設備カテゴリーのフォーム入力を、保存前に検査する純粋関数。
 *
 * existingIds はサーバーが信頼できる保存データから取得し、
 * editableCategoryIds はサーバーが業務仕様と権限から決めること。
 * FormData から渡された「既存ID」や「編集可能ID」を信用しない。
 *
 * これは DB 保存ではない。正式更新ではDB/RPC側で権限・競合・存在を再検証する。
 */
export interface IncludedCategorySaveInput {
  ownCategoryId: string;
  existingIds: readonly string[];
  editableCategoryIds: readonly string[];
  requestedIds: readonly string[];
}

export type IncludedCategorySaveError =
  | 'INVALID_CATEGORY_ID'
  | 'DUPLICATE_CATEGORY'
  | 'SELF_INCLUSION'
  | 'UNAUTHORIZED_CATEGORY'
  | 'HIDDEN_RELATION_REMOVED';

export type IncludedCategorySaveValidation =
  | { ok: true; categoryIds: string[] }
  | { ok: false; code: IncludedCategorySaveError };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 表示対象外の既存関係は黙って削除できず、現在選べる候補外の新規IDも挿入できない。
 * 重複や不正な入力は正規化して黙って通さず拒否する。
 */
export function validateIncludedCategorySaveInput(
  input: IncludedCategorySaveInput,
): IncludedCategorySaveValidation {
  const { ownCategoryId, existingIds, editableCategoryIds, requestedIds } = input;
  if (!UUID_RE.test(ownCategoryId) ||
      [...existingIds, ...editableCategoryIds, ...requestedIds].some((id) => !UUID_RE.test(id))) {
    return { ok: false, code: 'INVALID_CATEGORY_ID' };
  }
  const requested = new Set<string>();
  for (const id of requestedIds) {
    if (requested.has(id)) return { ok: false, code: 'DUPLICATE_CATEGORY' };
    requested.add(id);
  }
  if (requested.has(ownCategoryId)) return { ok: false, code: 'SELF_INCLUSION' };

  const editable = new Set(editableCategoryIds);
  const original = new Set(existingIds);
  for (const id of requested) {
    if (!editable.has(id) && !original.has(id)) {
      return { ok: false, code: 'UNAUTHORIZED_CATEGORY' };
    }
  }
  for (const id of original) {
    if (!editable.has(id) && !requested.has(id)) {
      return { ok: false, code: 'HIDDEN_RELATION_REMOVED' };
    }
  }
  return { ok: true, categoryIds: [...requested].sort() };
}
