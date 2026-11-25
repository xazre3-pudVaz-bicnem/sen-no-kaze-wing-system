/**
 * 商品選択ポップアップの比較ガイド。Cによる14カテゴリー調査をもとにした固定の着眼点。
 * 個々の商品の仕様・性能の認定ではない。商品台帳・価格・保存方式には影響しない。
 */
export const SIMULATOR_PRODUCT_CHOICE_POINTS: Readonly<Record<string, readonly string[]>> = {
  'exterior-wall': ['色・柄', '材質・仕上がり', 'お手入れ'],
  roof: ['色', '形状・仕上がり', '耐久性・メンテナンス'],
  ub: ['サイズ', '浴槽・シャワーなどの設備構成', '壁色・デザイン'],
  toilet: ['洗浄機能', '手洗いの有無', 'お手入れ'],
  washbasin: ['間口・奥行', '収納', 'ミラー・水栓'],
  kitchen: ['幅', '加熱機器', '収納・設備'],
  boiler: ['給湯能力（号数）', '給湯方式', '機能'],
  aircon: ['適用畳数', '冷暖房能力', '電源条件'],
  lighting: ['明るさ', '光の色', 'デザイン・設置場所'],
  'entrance-door': ['デザイン', '断熱・防火仕様', '鍵'],
  'service-door': ['採風の有無', 'ガラス仕様', 'サイズ'],
  sash: ['開閉方式', 'サイズ', 'ガラス・断熱仕様'],
  'interior-door': ['開閉方式', 'デザイン', '寸法'],
  furniture: ['寸法', '収納・使い勝手', '設置条件'],
};

export function productChoicePoints(categoryCode: string): readonly string[] {
  return SIMULATOR_PRODUCT_CHOICE_POINTS[categoryCode] ?? [];
}

/**
 * 現在選択中 → 基本プランの商品 → 変更候補。
 * 複数選択時も現在選択中をすべて先頭へ。各グループ内は元の順を保つ。
 * is_defaultのような商品台帳の属性は使わない。
 */
export function orderPickerProducts<T extends { id: string }>(
  products: readonly T[],
  selectedIds: readonly string[],
  baselineSelectedIds: readonly string[],
): T[] {
  const selected = new Set(selectedIds);
  const baseline = new Set(baselineSelectedIds);
  const priority = (id: string) => selected.has(id) ? 0 : baseline.has(id) ? 1 : 2;
  return products
    .map((product, index) => ({ product, index, order: priority(product.id) }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ product }) => product);
}
