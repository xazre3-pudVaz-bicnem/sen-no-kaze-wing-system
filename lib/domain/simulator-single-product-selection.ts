import type { OptionCategory } from './types';

/**
 * 公開シミュレーターの「商品を選ぶ」画面だけに適用する選択方式。
 * DBの共通カテゴリー設定や、発行済み見積・既存Configurationは書き換えない。
 * 洗面は一つの表示商品が既存の器具＋水栓など複数IDを持つため、表示商品単位で判定する。
 */
type SelectionCategory = Pick<OptionCategory, 'code' | 'selection_mode'>;

const SINGLE_PRODUCT_CATEGORY_CODES = new Set(['boiler', 'aircon', 'washbasin', 'toilet', 'kitchen']);

export function isSimulatorSingleProductCategory(category: SelectionCategory): boolean {
  return category.selection_mode === 'single' || SINGLE_PRODUCT_CATEGORY_CODES.has(category.code);
}

/** 別のトイレ・キッチンを選んだら、以前の商品を追加せず置き換える。 */
export function nextSimulatorSelectedProducts(
  category: SelectionCategory,
  currentSelectedInCategory: string[],
  chosenOptionId: string,
  chosenSelectionIds: string[],
): string[] {
  if (isSimulatorSingleProductCategory(category)) return [...chosenSelectionIds];
  return currentSelectedInCategory.includes(chosenOptionId)
    ? currentSelectedInCategory
    : [...currentSelectedInCategory, ...chosenSelectionIds];
}
