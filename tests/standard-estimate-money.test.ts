import { describe, expect, it } from 'vitest';
import {
  RATE_RULES,
  assertRates,
  baseLineMoney,
  lineMoney,
  revisionMoney,
  sectionMoney,
  toScaled,
  truncMul,
  truncQuantity,
} from '@/lib/domain/standard-estimate-money';

const rates = { salesFeeRate: '1.07', expenseRate: '0.15', markupRate: '1.5', taxRate: '0.10' };

describe('標準見積の金額：丸めは trunc で、浮動小数点の誤差を持ち込まない', () => {
  it('100 × 1.15 は 115（浮動小数点では 114.99… になり 114 へ落ちる）', () => {
    expect(Math.trunc(100 * 1.15)).toBe(114);
    expect(truncMul(100, '1.15')).toBe(115);
    expect(truncMul(100, 1.15)).toBe(115);
  });

  it('0 方向へ切り捨てる（負の値でも floor にしない）', () => {
    expect(truncMul(-1001, '0.1')).toBe(-100);
    expect(truncMul(1001, '0.1')).toBe(100);
  });

  it('数量は小数 4 桁まで。数量 × 単価も trunc', () => {
    expect(truncQuantity('2.5', 999)).toBe(2497);
    expect(truncQuantity('0.3333', 3)).toBe(0);
    expect(() => toScaled('1.23456')).toThrow('小数は 4 桁までです');
  });
});

describe('明細の金額（price_mode）', () => {
  it('本体マスターの行：基準原価単価 × 販売費率 → 原価単価、× 掛率 → 売価単価（いずれも trunc）', () => {
    expect(baseLineMoney(18200, 12, rates)).toEqual({
      mode: 'auto',
      costUnitPrice: 19474, // trunc(18200 × 1.07 = 19474)
      saleUnitPrice: 29211, // trunc(19474 × 1.5 = 29211)
      costAmount: 233688,
      saleAmount: 350532,
    });
  });

  it('auto は掛率で売価を求め、manual は入力した売価単価をそのまま使う（行ごとの掛率は持たない）', () => {
    expect(lineMoney({ mode: 'auto', quantity: 1, costUnitPrice: 46150 }, rates)).toMatchObject({ saleUnitPrice: 69225, saleAmount: 69225, costAmount: 46150 });
    expect(lineMoney({ mode: 'manual', quantity: 2, costUnitPrice: 60000, saleUnitPrice: 85000 }, rates)).toMatchObject({
      saleUnitPrice: 85000,
      saleAmount: 170000,
      costAmount: 120000,
    });
    expect(() => lineMoney({ mode: 'manual', quantity: 1, costUnitPrice: 1, saleUnitPrice: null }, rates)).toThrow('売価単価');
    expect(() => lineMoney({ mode: 'auto', quantity: 1, costUnitPrice: null }, rates)).toThrow('原価単価');
    expect(() => lineMoney({ mode: 'auto', quantity: 0, costUnitPrice: 1 }, rates)).toThrow('数量');
  });

  it('por は単価・金額とも NULL（0 円の商品とは別）', () => {
    expect(lineMoney({ mode: 'por', quantity: 1, costUnitPrice: 500 }, rates)).toEqual({
      mode: 'por',
      costUnitPrice: null,
      saleUnitPrice: null,
      costAmount: null,
      saleAmount: null,
    });
    expect(lineMoney({ mode: 'auto', quantity: 1, costUnitPrice: 0 }, rates)).toMatchObject({ saleAmount: 0, costAmount: 0 });
  });
});

describe('区分と Revision の合計', () => {
  const base = sectionMoney([baseLineMoney(18200, 12, rates)], 'rate', rates);

  it('経費は区分の明細小計 × 経費率（原価側・売価側それぞれ trunc）。none なら 0', () => {
    expect(base).toEqual({
      costLineSubtotal: 233688,
      saleLineSubtotal: 350532,
      costExpense: 35053, // trunc(233688 × 0.15 = 35053.2)
      saleExpense: 52579, // trunc(350532 × 0.15 = 52579.8)
      costTotal: 268741,
      saleTotal: 403111,
      hasPor: false,
    });
    expect(sectionMoney([baseLineMoney(18200, 12, rates)], 'none', rates)).toMatchObject({ costExpense: 0, saleExpense: 0, saleTotal: 350532 });
  });

  it('POR の行は売価・原価・粗利の合計から除外し、価格未確定の行ありを示す', () => {
    const option = sectionMoney(
      [lineMoney({ mode: 'auto', quantity: 1, costUnitPrice: 10000 }, rates), lineMoney({ mode: 'por', quantity: 1, costUnitPrice: null }, rates)],
      'rate',
      rates
    );
    expect(option).toMatchObject({ costLineSubtotal: 10000, saleLineSubtotal: 15000, hasPor: true });
    const money = revisionMoney([base, option], 0, rates);
    expect(money.hasPor).toBe(true);
    expect(money.costTotal).toBe(268741 + 11500);
  });

  it('調整額は整数円をそのまま加減算し、税だけ trunc（最終合計で再丸めしない）', () => {
    const money = revisionMoney([base], -1111, rates);
    expect(money).toMatchObject({
      saleSubtotalBeforeAdjustment: 403111,
      adjustment: -1111,
      subtotal: 402000,
      tax: 40200,
      total: 442200,
      costTotal: 268741,
      grossProfit: 402000 - 268741,
      hasPor: false,
    });
    expect(revisionMoney([base], -1, { taxRate: '0.10' }).tax).toBe(40311); // trunc(403110 × 0.1 = 40311.0)
    expect(() => revisionMoney([base], 0.5, rates)).toThrow('整数円');
  });
});

describe('率の範囲（本部管理の共通ルール）', () => {
  it('初期値は 100% / 15% / 150% で、範囲外は拒否する', () => {
    expect(() =>
      assertRates({ salesFeeRate: RATE_RULES.salesFeeRate.initial, expenseRate: RATE_RULES.expenseRate.initial, markupRate: RATE_RULES.markupRate.initial, taxRate: '0.10' })
    ).not.toThrow();
    expect(() => assertRates({ ...rates, salesFeeRate: '0.99' })).toThrow('販売費率');
    expect(() => assertRates({ ...rates, salesFeeRate: '1.5001' })).toThrow('販売費率');
    expect(() => assertRates({ ...rates, expenseRate: '0.3001' })).toThrow('経費率');
    expect(() => assertRates({ ...rates, markupRate: '2.6' })).toThrow('掛率');
    expect(() => assertRates({ ...rates, markupRate: '0.99' })).toThrow('掛率');
  });
});
