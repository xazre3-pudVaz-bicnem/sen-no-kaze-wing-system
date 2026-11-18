/** 既存カテゴリーコードのみで切り替える位置名入力補助。保存形式・検証規則とは独立。 */
export const V25_POSITION_LABEL_SUGGESTIONS: Readonly<Record<'sash' | 'lighting', readonly string[]>> = {
  sash: [
    '居室の窓',
    'LDKの窓',
    '寝室の窓',
    '浴室の窓',
    'トイレの窓',
    'キッチンの窓',
    '玄関横の窓',
  ],
  lighting: [
    '居室',
    'LDK',
    '寝室',
    '玄関',
    'キッチン',
    'トイレ',
    '洗面脱衣室',
    '浴室',
    '屋外',
  ],
};

/** 未知カテゴリーでは候補を表示しない。入力値を変換・正規化しない。 */
export function v25PositionLabelSuggestions(categoryCode: string | null | undefined): readonly string[] {
  if (categoryCode === 'sash' || categoryCode === 'lighting') return V25_POSITION_LABEL_SUGGESTIONS[categoryCode];
  return [];
}
