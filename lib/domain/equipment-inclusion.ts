/**
 * 設備包含の「表示上の状態」だけを分類する。
 *
 * この関数に渡す sources は、既に選択されている包含元商品の設置単位だけ。
 * 未選択の商品や、商品台帳上の全候補を渡してはならない。
 *
 * DB の保存・金額計算・正式見積の判定はここでは行わない。
 * 同じ商品が別の位置に複数設置される場合は、sourceSelectionKey を分ける。
 */
export const INCLUDED_IN_UNIT_LABEL = 'ユニットに含まれています';

export type EquipmentPlacementRelation = 'same-unit' | 'separate-room' | 'undetermined';

export interface ActiveIncludedEquipmentSource {
  /** 同一商品を複数位置に設置しても区別できる、選択の識別子 */
  sourceSelectionKey: string;
  sourceOptionId: string;
  /** 商品に含まれる設備のカテゴリーID。商品名や個別商品IDではない */
  includedCategoryIds: readonly string[];
  /** 対象設備と包含元の設置位置との関係。根拠がなければ undetermined */
  relationToTarget: EquipmentPlacementRelation;
}

export type EquipmentInclusionState =
  | 'not-included'
  | 'included-in-unit'
  | 'additional-equipment'
  | 'placement-undetermined';

export interface EquipmentInclusionResult {
  state: EquipmentInclusionState;
  /** 判定の根拠となった、選択済み包含元の識別子 */
  sourceSelectionKeys: readonly string[];
}

/**
 * 対象カテゴリーに対する包含状態を返す。
 *
 * - 同じユニット内に包含元があれば「包含」。
 * - 別室の包含元しかなければ「独立した追加設備」。
 * - 位置関係が未確定なら、包含済みとみなさず確認を要求する。
 * - 包含元がなければ通常の単体設備。
 *
 * 金額を0円にする・選択を消す・保存を許可する、といった処理は行わない。
 */
export function resolveEquipmentInclusion(
  categoryId: string,
  sources: readonly ActiveIncludedEquipmentSource[],
): EquipmentInclusionResult {
  const relevant = sources.filter((source) => source.includedCategoryIds.includes(categoryId));
  if (relevant.length === 0) return { state: 'not-included', sourceSelectionKeys: [] };

  const candidates: { state: EquipmentInclusionState; relation: EquipmentPlacementRelation }[] = [
    { state: 'included-in-unit', relation: 'same-unit' },
    { state: 'placement-undetermined', relation: 'undetermined' },
    { state: 'additional-equipment', relation: 'separate-room' },
  ];
  for (const candidate of candidates) {
    const matching = relevant.filter((source) => source.relationToTarget === candidate.relation);
    if (matching.length > 0) {
      return {
        state: candidate.state,
        sourceSelectionKeys: [...new Set(matching.map((source) => source.sourceSelectionKey))],
      };
    }
  }

  // 型付き入力では到達しない。未知の位置情報を包含済みとして扱わない。
  return { state: 'placement-undetermined', sourceSelectionKeys: [] };
}
