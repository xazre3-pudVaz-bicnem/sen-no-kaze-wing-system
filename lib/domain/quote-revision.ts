/**
 * Quote Revision の金額計算。
 *
 * Revisionでは親Quoteの adjustment を明示的なスナップショット値として引き継ぐ。
 * 明細を編集しただけで調整額を別の丸めルールへ置き換えない。
 */
export function computeQuoteRevisionTotals(
  subtotalRaw: number,
  carriedAdjustment: number,
  taxRate: number
) {
  const subtotal = subtotalRaw + carriedAdjustment;
  const tax = Math.floor(subtotal * taxRate);
  return {
    subtotal_raw: subtotalRaw,
    adjustment: carriedAdjustment,
    subtotal,
    tax,
    total: subtotal + tax,
  };
}
