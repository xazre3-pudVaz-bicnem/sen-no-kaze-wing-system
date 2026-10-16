/**
 * 金額正本 v2.5 第11章の正式計算。DB の public.pricing_calculate（20261016210000）と同じ式・同じ切り捨ての境界・同じ入力の検査にする。
 *
 *   auto：選択状態標準原価 = 商品標準原価 + バリエーション標準原価調整額（0 円未満なら計算しない）
 *         見積用原価単価 = trunc(選択状態標準原価 × 販売費率)
 *         売価単価       = trunc(見積用原価単価 × 掛率)
 *         明細売価       = trunc(売価単価 × 数量)
 *   manual：明細売価 = trunc(manual 売価単価 × 数量)（販売費・掛率を再適用しない）
 *   por：金額未確定。0 円として扱わず、区分・合計・税まで null（未確定）を伝える
 *   区分小計 = 金額確定済みの明細売価の合計、区分経費 = trunc(区分小計 × 経費率)（計算ルールの経費対象区分だけ）
 *   税別小計 = Σ(区分小計 + 区分経費)、調整後税別額 = 税別小計 + 調整額（0 円以上）
 *   税額 = trunc(調整後税別額 × 税率)（全額課税・単一税率）、税込総額 = 調整後税別額 + 税額
 *
 * 正本は DB の計算。この関数は画面の試算と、DB との突き合わせに使う。浮動小数点を使わず、
 * 10 進の固定小数（BigInt）で計算する（trunc はすべて 0 以上の値に掛かるので、BigInt の除算と一致する）。
 *
 * このファイルは import を持たない（実 DB の検査 scripts/db-rehearsal/runtime-pricing-v25.mjs が node から直接読み込む）。
 */

export type PricingSectionCode = 'base' | 'interior_exterior' | 'option' | 'sitework';
export type PricingLineMode = 'auto' | 'manual' | 'por';

export const PRICING_SECTION_CODES: readonly PricingSectionCode[] = ['base', 'interior_exterior', 'option', 'sitework'];

/** 計算ルール Version（pricing_calculation_rule_versions の行） */
export interface PricingCalculationRule {
  id: string;
  formula_code: string;
  rounding_mode: string;
  expense_target_sections: readonly string[];
}

/** 税ルール Version（tax_rule_versions の行。税率は numeric(8,6) の 10 進文字列） */
export interface PricingTaxRule {
  id: string;
  tax_mode: string;
  tax_rate: string | number;
  rounding_mode: string;
}

export interface PricingLineInput {
  key: string;
  mode: PricingLineMode;
  /** 小数 4 桁まで・0 以上 */
  quantity: string | number;
  /** auto だけ必須（整数円・0 以上） */
  standard_cost?: number | null;
  /** auto だけ（整数円。プラス・0・マイナス可。省略は 0） */
  variant_adjustment?: number | null;
  /** manual だけ必須（税別・経費別の売価単価。整数円・0 以上） */
  manual_unit_price?: number | null;
}

export interface PricingInput {
  rates: {
    /** 小数 4 桁まで。販売費率・掛率は 0 より大きく、経費率は 0 以上。いずれも 99.9999 まで */
    sales_fee_rate: string | number;
    markup_rate: string | number;
    expense_rate: string | number;
  };
  /** 案件全体の調整額（整数円。省略は 0） */
  adjustment?: number | null;
  sections: { code: PricingSectionCode; lines: PricingLineInput[] }[];
}

export interface PricingLineResult {
  key: string;
  mode: PricingLineMode;
  selection_cost: number | null;
  cost_unit_price: number | null;
  sale_unit_price: number | null;
  amount: number | null;
}

export interface PricingSectionResult {
  code: PricingSectionCode;
  expense_target: boolean;
  has_por: boolean;
  /** 金額確定済みの明細だけの合計（por があっても表示用に持つ） */
  priced_subtotal: number;
  subtotal: number | null;
  expense: number | null;
  total: number | null;
  lines: PricingLineResult[];
}

export interface PricingResult {
  formula_code: string;
  calc_rule_version_id: string;
  tax_rule_version_id: string;
  has_por: boolean;
  subtotal: number | null;
  adjustment: number;
  adjusted_subtotal: number | null;
  taxable_amount: number | null;
  tax: number | null;
  total: number | null;
  sections: PricingSectionResult[];
}

const MAX_AMOUNT = 999_999_999_999n;
const RATE_SCALE = 4;
const QUANTITY_SCALE = 4;
const TAX_SCALE = 6;
const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

function fail(message: string): never {
  throw new Error(`VALIDATION: ${message}`);
}

/** 小数 scale 桁の固定小数（値 = units / 10^scale） */
interface Fixed {
  units: bigint;
  scale: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 10 進数（数値または文字列）を固定小数にする。小数は maxScale 桁まで（末尾の 0 は数えない） */
function parseDecimal(value: unknown, label: string, maxScale: number): Fixed {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} の形式が正しくありません`);
    // JSON に書いたときと同じ表記。指数表記になるのは 1e-6 未満（小数 4 桁を超える）か 1e21 以上（範囲外）だけ
    text = String(value);
    if (!/^-?[0-9]+(\.[0-9]+)?$/.test(text)) fail(`${label} が範囲外です`);
  } else if (typeof value === 'string') {
    text = value;
    if (!/^-?[0-9]+(\.[0-9]+)?$/.test(text)) fail(`${label} の形式が正しくありません`);
  } else {
    fail(`${label} がありません`);
  }
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const trimmed = fraction.replace(/0+$/, '');
  if (trimmed.length > maxScale) fail(`${label} の小数は ${maxScale} 桁までです`);
  const units = BigInt(whole) * 10n ** BigInt(maxScale) + BigInt((trimmed + '0'.repeat(maxScale)).slice(0, maxScale) || '0');
  return { units: negative ? -units : units, scale: maxScale };
}

/** 整数円（数値）。無い・null は fallback（fallback も無ければ必須） */
function parseInteger(value: unknown, label: string, min: number, max: number, fallback?: number): bigint {
  if (value === undefined || value === null) {
    if (fallback === undefined) fail(`${label} がありません`);
    return BigInt(fallback);
  }
  if (typeof value !== 'number') fail(`${label} は整数円の数値で指定してください`);
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} は ${min}〜${max} の整数円です`);
  return BigInt(value);
}

function checked(value: bigint, label: string): bigint {
  if (value > MAX_AMOUNT || value < -MAX_AMOUNT) fail(`${label} が扱える金額の範囲を超えています`);
  return value;
}

/** trunc(金額 × 固定小数)。金額・固定小数とも 0 以上で使う */
function truncMul(amount: bigint, factor: Fixed): bigint {
  return (amount * factor.units) / 10n ** BigInt(factor.scale);
}

function compareFixed(value: Fixed, text: string): number {
  const other = parseDecimal(text, '比較値', value.scale);
  return value.units === other.units ? 0 : value.units > other.units ? 1 : -1;
}

const toNumber = (value: bigint) => Number(value);

/** 正式計算（DB の public.pricing_calculate と同じ結果になる） */
export function calculatePricingV25(rule: PricingCalculationRule, taxRule: PricingTaxRule, input: unknown): PricingResult {
  if (rule.formula_code !== 'v2.5' || rule.rounding_mode !== 'trunc') fail('この計算ルールの式には対応していません');
  if (taxRule.tax_mode !== 'full_single_rate' || taxRule.rounding_mode !== 'trunc') fail('この税ルールには対応していません');
  const taxRate = parseDecimal(taxRule.tax_rate, '税率', TAX_SCALE);

  if (!isObject(input) || !isObject(input.rates)) fail('計算の入力の形式が正しくありません');
  const salesFee = parseDecimal(input.rates.sales_fee_rate, '販売費率', RATE_SCALE);
  const markup = parseDecimal(input.rates.markup_rate, '掛率', RATE_SCALE);
  const expenseRate = parseDecimal(input.rates.expense_rate, '経費率', RATE_SCALE);
  if (
    compareFixed(salesFee, '0') <= 0 || compareFixed(salesFee, '99.9999') > 0 ||
    compareFixed(markup, '0') <= 0 || compareFixed(markup, '99.9999') > 0 ||
    compareFixed(expenseRate, '0') < 0 || compareFixed(expenseRate, '99.9999') > 0
  ) {
    fail('率が範囲外です（販売費率・掛率は 0 より大きく、経費率は 0 以上、いずれも 99.9999 まで）');
  }
  const adjustment = parseInteger(input.adjustment, '調整額', INT4_MIN, INT4_MAX, 0);

  if (!Array.isArray(input.sections)) fail('区分の一覧がありません');

  const seenCodes = new Set<string>();
  const seenKeys = new Set<string>();
  const sections: PricingSectionResult[] = [];
  let subtotal = 0n;
  let hasPor = false;

  for (const section of input.sections as unknown[]) {
    if (!isObject(section)) fail('区分の形式が正しくありません');
    const code = typeof section.code === 'string' ? section.code : null;
    if (code === null || !(PRICING_SECTION_CODES as readonly string[]).includes(code)) fail('区分のコードが正しくありません');
    if (seenCodes.has(code)) fail(`区分 ${code} が重複しています`);
    seenCodes.add(code);
    if (!Array.isArray(section.lines)) fail(`区分 ${code} の明細の一覧がありません`);

    let priced = 0n;
    let sectionPor = false;
    const lines: PricingLineResult[] = [];

    for (const line of section.lines as unknown[]) {
      if (!isObject(line)) fail('明細の形式が正しくありません');
      const key = typeof line.key === 'string' ? line.key : null;
      if (key === null || !/^[A-Za-z0-9_.:-]{1,100}$/.test(key)) fail('明細のキーが正しくありません');
      if (seenKeys.has(key)) fail(`明細のキー ${key} が重複しています`);
      seenKeys.add(key);
      const mode = typeof line.mode === 'string' ? line.mode : null;
      if (mode !== 'auto' && mode !== 'manual' && mode !== 'por') fail(`明細 ${key} の価格方式が正しくありません`);
      const quantity = parseDecimal(line.quantity, '数量', QUANTITY_SCALE);
      if (compareFixed(quantity, '0') < 0 || compareFixed(quantity, '9999999999.9999') > 0) fail(`明細 ${key} の数量が範囲外です`);

      if (mode === 'auto') {
        const standardCost = parseInteger(line.standard_cost, '商品標準原価', 0, INT4_MAX);
        const variant = parseInteger(line.variant_adjustment, 'バリエーション標準原価調整額', INT4_MIN, INT4_MAX, 0);
        const selection = standardCost + variant;
        if (selection < 0n) fail(`明細 ${key} の選択状態標準原価が 0 円未満です（調整額を見直してください）`);
        const costUnit = checked(truncMul(selection, salesFee), '見積用原価単価');
        const saleUnit = checked(truncMul(costUnit, markup), '売価単価');
        const amount = checked(truncMul(saleUnit, quantity), '明細売価');
        priced = checked(priced + amount, '区分小計');
        lines.push({
          key, mode,
          selection_cost: toNumber(selection),
          cost_unit_price: toNumber(costUnit),
          sale_unit_price: toNumber(saleUnit),
          amount: toNumber(amount),
        });
      } else if (mode === 'manual') {
        const saleUnit = parseInteger(line.manual_unit_price, 'manual 売価単価', 0, INT4_MAX);
        const amount = checked(truncMul(saleUnit, quantity), '明細売価');
        priced = checked(priced + amount, '区分小計');
        lines.push({ key, mode, selection_cost: null, cost_unit_price: null, sale_unit_price: toNumber(saleUnit), amount: toNumber(amount) });
      } else {
        sectionPor = true;
        lines.push({ key, mode, selection_cost: null, cost_unit_price: null, sale_unit_price: null, amount: null });
      }
    }

    const expenseTarget = rule.expense_target_sections.includes(code);
    if (sectionPor) {
      hasPor = true;
      sections.push({
        code: code as PricingSectionCode, expense_target: expenseTarget, has_por: true,
        priced_subtotal: toNumber(priced), subtotal: null, expense: null, total: null, lines,
      });
    } else {
      const expense = expenseTarget ? checked(truncMul(priced, expenseRate), '区分経費') : 0n;
      const total = checked(priced + expense, '区分合計');
      subtotal = checked(subtotal + total, '税別小計');
      sections.push({
        code: code as PricingSectionCode, expense_target: expenseTarget, has_por: false,
        priced_subtotal: toNumber(priced), subtotal: toNumber(priced), expense: toNumber(expense), total: toNumber(total), lines,
      });
    }
  }

  const base = {
    formula_code: rule.formula_code,
    calc_rule_version_id: rule.id,
    tax_rule_version_id: taxRule.id,
  };

  if (hasPor) {
    return {
      ...base,
      has_por: true,
      subtotal: null,
      adjustment: toNumber(adjustment),
      adjusted_subtotal: null,
      taxable_amount: null,
      tax: null,
      total: null,
      sections,
    };
  }

  const adjusted = checked(subtotal + adjustment, '調整後税別額');
  if (adjusted < 0n) fail('調整後税別額が 0 円未満です');
  const tax = checked(truncMul(adjusted, taxRate), '税額');
  const total = checked(adjusted + tax, '税込総額');

  return {
    ...base,
    has_por: false,
    subtotal: toNumber(subtotal),
    adjustment: toNumber(adjustment),
    adjusted_subtotal: toNumber(adjusted),
    taxable_amount: toNumber(adjusted),
    tax: toNumber(tax),
    total: toNumber(total),
    sections,
  };
}
