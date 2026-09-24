import { describe, expect, it } from 'vitest';
import { computeQuoteRevisionTotals } from '../lib/domain/quote-revision';

describe('Quote Revision totals', () => {
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
