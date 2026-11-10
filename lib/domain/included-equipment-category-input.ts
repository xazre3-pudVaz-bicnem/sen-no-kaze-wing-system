/**
 * 商品が内包する設備を、商品IDではなくカテゴリーIDで登録するための入力補助。
 * DBの正式保存・金額判定とは独立した純粋なUI準備処理。
 */
export interface IncludedEquipmentCategoryCandidate {
  id: string;
  code: string;
  name: string;
}

/** 同じカテゴリーを重複表示せず、商品自身のカテゴリーを候補から外す。 */
export function includedEquipmentCategoryCandidates(
  categories: readonly IncludedEquipmentCategoryCandidate[],
  ownCategoryId: string,
): IncludedEquipmentCategoryCandidate[] {
  const seen = new Set<string>();
  return categories.filter((category) => {
    if (!category.id || category.id === ownCategoryId || seen.has(category.id)) return false;
    seen.add(category.id);
    return true;
  });
}

/**
 * 表示可能なものと、それ以外の既存関係を分ける。
 * 画面で候補に表示されない保存済み関係は、通常の編集操作で消さない。
 * 選択の状態はUI専用であり、正式な保存処理の権限・同時編集検証とは別。
 */
export function splitIncludedEquipmentCategoryIds(
  includedCategoryIds: readonly string[],
  candidates: readonly IncludedEquipmentCategoryCandidate[],
): { visibleIds: string[]; preservedIds: string[] } {
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  const seen = new Set<string>();
  const visibleIds: string[] = [];
  const preservedIds: string[] = [];
  for (const id of includedCategoryIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    (allowed.has(id) ? visibleIds : preservedIds).push(id);
  }
  return { visibleIds, preservedIds };
}
