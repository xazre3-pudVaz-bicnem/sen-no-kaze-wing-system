/**
 * 標準見積（Standard Estimate）の金額の取り決め（統合版依頼書 §6）。
 *
 * - 率：販売費率（初期 100%、100〜150%）・経費率（初期 15%、0〜30%）・掛率（初期 150%、100〜250%）を Revision に保存
 * - 丸め：すべての計算境界で trunc（0 方向切り捨て）。調整額は整数円をそのまま加減算し、最終合計で再丸めしない
 *     販売費適用後原価単価 = trunc(本体マスターの整数基準原価単価 × 販売費率)
 *     原価明細額         = trunc(数量 × 原価単価)
 *     売価単価（auto）     = trunc(原価単価 × 掛率)
 *     売価明細額         = trunc(数量 × 売価単価)
 *     原価側経費         = trunc(原価明細小計 × 経費率)
 *     売価側経費         = trunc(売価明細小計 × 経費率)
 *     税                 = trunc(課税小計 × 税率)
 * - price_mode：auto（率で計算）・manual（売価単価を直接入力。行ごとの掛率は持たない）・por（価格未確定。金額は NULL）
 *   POR の行は売価・原価・粗利の合計から除外し、「価格未確定の行あり」を示す
 * - 経費の計算方法は rate / none だけ（fixed は新規に使わない）
 *
 * DB（RPC）が正本。この関数は画面の試算用で、DB と同じ式・同じ丸めにする（浮動小数点を使わず、1/10000 単位の整数で計算する）。
 */

export type PriceMode = 'auto' | 'manual' | 'por';
export type ExpenseMethod = 'rate' | 'none';

export const RATE_RULES = {
  salesFeeRate: { initial: '1.0000', min: '1.0000', max: '1.5000', label: '販売費率' },
  expenseRate: { initial: '0.1500', min: '0.0000', max: '0.3000', label: '経費率' },
  markupRate: { initial: '1.5000', min: '1.0000', max: '2.5000', label: '掛率' },
} as const;

export interface MoneyRates {
  /** 小数 4 桁までの 10 進文字列または数値（例：'1.15'、0.15） */
  salesFeeRate: string | number;
  expenseRate: string | number;
  markupRate: string | number;
  taxRate: string | number;
}

const SCALE = 10000n;

/** 小数 4 桁までの 10 進数を、1/10000 単位の整数へ正確に変換する（それより細かい桁は不正） */
export function toScaled(value: string | number): bigint {
  const text = typeof value === 'number' ? value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '') : value.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`数値の形式が正しくありません: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.replace(/0+$/, '').length > 4) throw new Error(`小数は 4 桁までです: ${value}`);
  const scaled = BigInt(whole) * SCALE + BigInt((fraction + '0000').slice(0, 4));
  return sign ? -scaled : scaled;
}

/** trunc(a × b / 10000)（0 方向切り捨て。BigInt の除算は 0 方向） */
function truncScaled(a: bigint, scaledRate: bigint): number {
  return Number((a * scaledRate) / SCALE);
}

/** trunc(整数円 × 率) */
export function truncMul(amount: number, rate: string | number): number {
  if (!Number.isSafeInteger(amount)) throw new Error(`金額は整数円です: ${amount}`);
  return truncScaled(BigInt(amount), toScaled(rate));
}

/** trunc(数量 × 単価) */
export function truncQuantity(quantity: string | number, unitPrice: number): number {
  if (!Number.isSafeInteger(unitPrice)) throw new Error(`単価は整数円です: ${unitPrice}`);
  return truncScaled(BigInt(unitPrice), toScaled(quantity));
}

export function assertRates(rates: MoneyRates): void {
  for (const key of ['salesFeeRate', 'expenseRate', 'markupRate'] as const) {
    const rule = RATE_RULES[key];
    const value = toScaled(rates[key]);
    if (value < toScaled(rule.min) || value > toScaled(rule.max)) {
      throw new Error(`${rule.label}は ${Number(rule.min) * 100}〜${Number(rule.max) * 100}% の範囲で入力してください`);
    }
  }
  const tax = toScaled(rates.taxRate);
  if (tax < 0n || tax > SCALE) throw new Error('税率が不正です');
}

export interface LineInput {
  mode: PriceMode;
  quantity: string | number;
  /** auto・manual では必須（auto は売価の元、manual は粗利の計算に使う） */
  costUnitPrice: number | null;
  /** manual だけ必須（auto は掛率で計算、por は NULL） */
  saleUnitPrice?: number | null;
}

export interface LineMoney {
  mode: PriceMode;
  costUnitPrice: number | null;
  saleUnitPrice: number | null;
  costAmount: number | null;
  saleAmount: number | null;
}

/** 標準見積の明細 1 行（内外装・オプション・別途工事） */
export function lineMoney(line: LineInput, rates: Pick<MoneyRates, 'markupRate'>): LineMoney {
  if (toScaled(line.quantity) <= 0n) throw new Error('数量は 0 より大きい値にしてください');
  if (line.mode === 'por') {
    return { mode: 'por', costUnitPrice: null, saleUnitPrice: null, costAmount: null, saleAmount: null };
  }
  if (line.costUnitPrice === null || !Number.isSafeInteger(line.costUnitPrice) || line.costUnitPrice < 0) {
    throw new Error('原価単価（0 円以上の整数）を入力してください');
  }
  let saleUnitPrice: number;
  if (line.mode === 'auto') {
    saleUnitPrice = truncMul(line.costUnitPrice, rates.markupRate);
  } else {
    if (line.saleUnitPrice === null || line.saleUnitPrice === undefined || !Number.isSafeInteger(line.saleUnitPrice) || line.saleUnitPrice < 0) {
      throw new Error('売価単価（0 円以上の整数）を入力してください');
    }
    saleUnitPrice = line.saleUnitPrice;
  }
  return {
    mode: line.mode,
    costUnitPrice: line.costUnitPrice,
    saleUnitPrice,
    costAmount: truncQuantity(line.quantity, line.costUnitPrice),
    saleAmount: truncQuantity(line.quantity, saleUnitPrice),
  };
}

/** 本体マスターの明細 1 行（整数の基準原価単価に販売費率を掛けてから、掛率で売価を求める。常に auto） */
export function baseLineMoney(baseUnitCost: number, quantity: string | number, rates: Pick<MoneyRates, 'salesFeeRate' | 'markupRate'>): LineMoney {
  if (!Number.isSafeInteger(baseUnitCost) || baseUnitCost < 0) throw new Error('本体の基準原価単価は 0 円以上の整数です');
  const costUnitPrice = truncMul(baseUnitCost, rates.salesFeeRate);
  return lineMoney({ mode: 'auto', quantity, costUnitPrice }, rates);
}

export interface SectionMoney {
  costLineSubtotal: number;
  saleLineSubtotal: number;
  costExpense: number;
  saleExpense: number;
  costTotal: number;
  saleTotal: number;
  hasPor: boolean;
}

/** 区分（本体・内外装・オプション・別途工事）の小計と経費。POR の行は合計から除外する */
export function sectionMoney(lines: LineMoney[], expenseMethod: ExpenseMethod, rates: Pick<MoneyRates, 'expenseRate'>): SectionMoney {
  const priced = lines.filter((line) => line.mode !== 'por');
  const costLineSubtotal = priced.reduce((sum, line) => sum + (line.costAmount ?? 0), 0);
  const saleLineSubtotal = priced.reduce((sum, line) => sum + (line.saleAmount ?? 0), 0);
  const costExpense = expenseMethod === 'rate' ? truncMul(costLineSubtotal, rates.expenseRate) : 0;
  const saleExpense = expenseMethod === 'rate' ? truncMul(saleLineSubtotal, rates.expenseRate) : 0;
  return {
    costLineSubtotal,
    saleLineSubtotal,
    costExpense,
    saleExpense,
    costTotal: costLineSubtotal + costExpense,
    saleTotal: saleLineSubtotal + saleExpense,
    hasPor: priced.length !== lines.length,
  };
}

export interface RevisionMoney {
  saleSubtotalBeforeAdjustment: number;
  adjustment: number;
  /** 課税小計（調整後） */
  subtotal: number;
  tax: number;
  total: number;
  /** 内部原価（お客様・代理店には見せない） */
  costTotal: number;
  grossProfit: number;
  /** 粗利率（売価小計に対する比。売価が 0 なら null） */
  grossMarginRatio: number | null;
  hasPor: boolean;
}

/** Revision の合計。調整額は整数円をそのまま加減算し、税だけ trunc で求める（最終合計で再丸めしない） */
export function revisionMoney(sections: SectionMoney[], adjustment: number, rates: Pick<MoneyRates, 'taxRate'>): RevisionMoney {
  if (!Number.isSafeInteger(adjustment)) throw new Error('調整額は整数円です');
  const saleSubtotalBeforeAdjustment = sections.reduce((sum, section) => sum + section.saleTotal, 0);
  const subtotal = saleSubtotalBeforeAdjustment + adjustment;
  if (subtotal < 0) throw new Error('調整後の小計が 0 円未満です');
  const tax = truncMul(subtotal, rates.taxRate);
  const costTotal = sections.reduce((sum, section) => sum + section.costTotal, 0);
  const grossProfit = subtotal - costTotal;
  return {
    saleSubtotalBeforeAdjustment,
    adjustment,
    subtotal,
    tax,
    total: subtotal + tax,
    costTotal,
    grossProfit,
    grossMarginRatio: subtotal > 0 ? grossProfit / subtotal : null,
    hasPor: sections.some((section) => section.hasPor),
  };
}
