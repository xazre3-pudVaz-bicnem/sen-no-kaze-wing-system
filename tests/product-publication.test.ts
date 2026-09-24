import { describe, expect, it } from 'vitest';
import {
  introducesUnconfirmedZeroPrice,
  requiresZeroPriceConfirmation,
} from '@/lib/domain/product-publication';

describe('商品公開時の0円確認', () => {
  it('通常価格0円だけ明示確認を要求する', () => {
    expect(requiresZeroPriceConfirmation({ price: 0, price_on_request: false })).toBe(true);
    expect(requiresZeroPriceConfirmation({ price: 1, price_on_request: false })).toBe(false);
    expect(requiresZeroPriceConfirmation({ price: 0, price_on_request: true })).toBe(false);
  });

  it('公開中商品が新たに通常価格0円になる変更だけ検出する', () => {
    expect(
      introducesUnconfirmedZeroPrice(
        { price: 100_000, price_on_request: false },
        { price: 0, price_on_request: false }
      )
    ).toBe(true);
    expect(
      introducesUnconfirmedZeroPrice(
        { price: 0, price_on_request: true },
        { price: 0, price_on_request: false }
      )
    ).toBe(true);
    expect(
      introducesUnconfirmedZeroPrice(
        { price: 0, price_on_request: false },
        { price: 0, price_on_request: false }
      )
    ).toBe(false);
    expect(
      introducesUnconfirmedZeroPrice(
        { price: 100_000, price_on_request: false },
        { price: 0, price_on_request: true }
      )
    ).toBe(false);
  });
});
