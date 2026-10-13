import { truncQuantity } from './standard-estimate-money';

/**
 * 見積明細の金額 = trunc(数量 × 単価)。新しい見積下書き・版の DB の計算（save_quote_draft・発行時の検算）と同じ。
 * 浮動小数点の誤差（100 × 1.15 = 114.999…）で 1 円ずれないよう、1/10000 単位の整数で計算する。
 * 数量が小数 4 桁を超えるなど整数で表せない入力は、画面の試算だけ Math.trunc で近似する（保存時は DB が拒否する）。
 */
export function quoteLineAmount(unitPrice: number, quantity: number): number {
  try {
    return truncQuantity(quantity, unitPrice);
  } catch {
    return Math.trunc(unitPrice * quantity);
  }
}
