export interface QuoteRevisionAmountSnapshot {
  unit_price: number;
  quantity: number;
  amount: number;
}

/**
 * 既存明細で単価・数量が変わっていない場合は、親Revisionに保存された amount を再利用する。
 * 過去の正式見積が floor / Excel式など別の丸めで確定されていても、無変更Revisionで1円差を作らない。
 */
export function computeQuoteRevisionItemAmount(
  unitPrice: number,
  quantity: number,
  source?: QuoteRevisionAmountSnapshot | null
) {
  if (source && source.unit_price === unitPrice && source.quantity === quantity) return source.amount;
  return Math.round(unitPrice * Math.max(0.01, quantity || 0));
}

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
