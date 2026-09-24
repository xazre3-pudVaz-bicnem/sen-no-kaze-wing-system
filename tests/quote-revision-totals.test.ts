import { describe, expect, it } from 'vitest';
import { computeQuoteRevisionItemAmount, computeQuoteRevisionTotals } from '../lib/domain/quote-revision';

describe('Quote Revision totals', () => {
  it('単価・数量が未変更の既存明細は親Revisionの確定amountを再利用する', () => {
    expect(
      computeQuoteRevisionItemAmount(9_021, 17, {
        unit_price: 9_021,
        quantity: 17,
        amount: 153_356,
      })
    ).toBe(153_356);
  });

  it('単価または数量を変更した明細は現在の計算式で再計算する', () => {
    expect(
      computeQuoteRevisionItemAmount(9_021, 18, {
        unit_price: 9_021,
        quantity: 17,
        amount: 153_356,
      })
    ).toBe(162_378);
  });

  it('親Revisionの調整額をそのまま引き継ぎ、パパマハロ実案件の金額を変えない', () => {
    expect(computeQuoteRevisionTotals(8_369_798, -9_798, 0.1)).toEqual({
      subtotal_raw: 8_369_798,
      adjustment: -9_798,
      subtotal: 8_360_000,
      tax: 836_000,
      total: 9_196_000,
    });
  });

  it('明細を変更しても調整額そのものは自動再計算しない', () => {
    expect(computeQuoteRevisionTotals(8_370_798, -9_798, 0.1)).toEqual({
      subtotal_raw: 8_370_798,
      adjustment: -9_798,
      subtotal: 8_361_000,
      tax: 836_100,
      total: 9_197_100,
    });
  });
});
