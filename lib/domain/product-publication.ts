import type { ProductOption } from './types';

type ProductPriceState = Pick<ProductOption, 'price' | 'price_on_request'>;

/**
 * 0円の商品を「正式な0円」として公開する場合だけ、明示確認を要求する。
 * 別途見積は price_on_request が正本なので対象外。
 */
export function requiresZeroPriceConfirmation(option: ProductPriceState): boolean {
  return option.price === 0 && !option.price_on_request;
}

/**
 * 公開中の商品を、正の価格／別途見積から「通常価格0円」へ直接変更する事故を防ぐ。
 * 既に通常価格0円で公開済みの商品は互換性のためそのまま編集可能。
 */
export function introducesUnconfirmedZeroPrice(
  existing: ProductPriceState,
  next: ProductPriceState
): boolean {
  return !requiresZeroPriceConfirmation(existing) && requiresZeroPriceConfirmation(next);
}
