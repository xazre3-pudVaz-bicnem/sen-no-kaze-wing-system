import { describe, expect, it } from 'vitest';
import { computeQuoteV25Totals, quoteV25RowAmount, type QuoteV25Context, type QuoteV25Row } from '@/lib/domain/quote-v25';

// 実 DB の検査（scripts/db-rehearsal/runtime-v25-formal-quotes.sql の D1-21）と同じ第 2 版：
// 本体 29,211 × 12、オプション 設備1 32,100（前の版のまま）・取付費 10,000 × 2・価格未確定の商品（0円確定）・設備2＋大 17,655 × 2、別途工事 運搬費 50,000
const context: QuoteV25Context = { expenseRate: '0.1500', expenseSections: ['base', 'interior_exterior', 'option'], taxRate: '0.100000' };
const rows: QuoteV25Row[] = [
  { section: 'base', unitPrice: 29211, quantity: '12', state: null, unchangedAmount: 350532 },
  { section: 'option', unitPrice: 32100, quantity: '1', state: null, unchangedAmount: 32100 },
  { section: 'option', unitPrice: 10000, quantity: '2', state: null },
  { section: 'option', unitPrice: null, quantity: '1', state: 'zero_confirmed' },
  { section: 'option', unitPrice: 17655, quantity: '2', state: null },
  { section: 'sitework', unitPrice: 50000, quantity: '1', state: null },
];

describe('v2.5 PR-D1：正式見積の第 2 版以降の画面の試算（DB の create_quote_revision_v25 と同じ式）', () => {
  it('区分の経費は明細の小計 × 経費率（経費の対象の区分だけ）、税は trunc、千円未満の切り捨てはしない', () => {
    const totals = computeQuoteV25Totals(rows, context, 0);
    expect(totals.lineTotals).toEqual({ base: 350532, interior_exterior: 0, option: 87410, sitework: 50000 });
    expect(totals.expenses).toEqual({ base: 52579, interior_exterior: 0, option: 13111, sitework: 0 });
    expect([totals.rawSubtotal, totals.subtotal, totals.tax, totals.total]).toEqual([553632, 553632, 55363, 608995]);
    expect(totals.hasUnresolved).toBe(false);
  });

  it('調整額は税別に足してから税を計算する（DB の D1-28 と同じ：-3,632 → 税抜 550,000・税 55,000）', () => {
    const totals = computeQuoteV25Totals(rows, context, -3632);
    expect([totals.subtotal, totals.tax, totals.total]).toEqual([550000, 55000, 605000]);
  });

  it('未確定の行（単価が無く、状態も付けていない）は 0 円で数え、未確定として示す', () => {
    const totals = computeQuoteV25Totals([...rows, { section: 'option', unitPrice: null, quantity: '1', state: null }], context, 0);
    expect(totals.hasUnresolved).toBe(true);
    expect(totals.lineTotals.option).toBe(87410);
  });

  it('行の金額：0円確定・対象外は 0 円、前の版のままの行は前の版の金額、それ以外は trunc(単価 × 数量)', () => {
    expect(quoteV25RowAmount({ section: 'option', unitPrice: 1000, quantity: '1', state: 'excluded' })).toBe(0);
    expect(quoteV25RowAmount({ section: 'option', unitPrice: 333, quantity: '1.5', state: null })).toBe(499);
    expect(quoteV25RowAmount({ section: 'option', unitPrice: 333, quantity: '1.5', state: null, unchangedAmount: 500 })).toBe(500);
    // 選択商品の変更差額（マイナス）も前の版の金額のまま
    expect(quoteV25RowAmount({ section: 'option', unitPrice: -16050, quantity: '1', state: null, unchangedAmount: -16050 })).toBe(-16050);
  });
});
