/**
 * v2.5 の標準見積から作った見積の、第 2 版以降（正式見積）の画面の試算（v2.5 PR-D1）。
 * 正本は DB の create_quote_revision_v25（同じ決まりで金額を作り、画面から来た単価で合計を作らない）。ここは画面で先に見せるためだけ：
 *   - 前の版の行：前の版の単価のまま（単価・数量を変えなければ前の版の金額のまま）。別途見積の行だけ担当者が売価を入れられる
 *   - 商品台帳の商品：固定した版の v2.5 の売価（サーバーで計算した値）
 *   - 自由明細：担当者が決めた税別の売価
 *   - 明細売価 = trunc(売価単価 × 数量)、区分の経費 = trunc(区分の明細の小計 × 経費率)（経費の対象の区分だけ）
 *   - 税別 = Σ(区分の明細の小計 ＋ 経費) ＋ 調整額、税 = trunc(税別 × 税率)。千円未満の切り捨てはしない
 */
import { customerCategorySelectable, productSpecCodesAllow, type CustomerCategoryMatrix } from './customer-category-applicability';
import { isQuoteSelectableProduct } from './product-lifecycle';
import { truncMul, truncQuantity } from './standard-estimate-money';
import type { OptionCategory, ProductOption } from './types';

export type QuoteV25Section = 'base' | 'interior_exterior' | 'option' | 'sitework';
export const QUOTE_V25_SECTIONS: QuoteV25Section[] = ['base', 'interior_exterior', 'option', 'sitework'];
export type QuoteV25LineState = 'zero_confirmed' | 'excluded';

export interface QuoteV25Context {
  /** 版の経費率（例：0.15） */
  expenseRate: string;
  /** 経費を掛ける区分（計算ルール） */
  expenseSections: QuoteV25Section[];
  /** 税率（例：0.10） */
  taxRate: string;
}

export interface QuoteV25Row {
  section: QuoteV25Section;
  /** 売価単価（未確定は null） */
  unitPrice: number | null;
  quantity: string;
  state: QuoteV25LineState | null;
  /** 前の版の金額（前の版の行で、単価・数量・状態を変えていないときはこの金額のまま） */
  unchangedAmount?: number | null;
}

export interface QuoteV25Totals {
  lineTotals: Record<QuoteV25Section, number>;
  expenses: Record<QuoteV25Section, number>;
  rawSubtotal: number;
  adjustment: number;
  subtotal: number;
  tax: number;
  total: number;
  /** 未確定の行（単価が無く、状態も付けていない）がある */
  hasUnresolved: boolean;
}

/** 行の金額（0円確定・対象外は 0 円。未確定は 0 円で数え、hasUnresolved で示す） */
export function quoteV25RowAmount(row: QuoteV25Row): number {
  if (row.state) return 0;
  if (row.unchangedAmount !== undefined && row.unchangedAmount !== null) return row.unchangedAmount;
  if (row.unitPrice === null) return 0;
  return truncQuantity(row.quantity, row.unitPrice);
}

export function computeQuoteV25Totals(rows: QuoteV25Row[], context: QuoteV25Context, adjustment: number): QuoteV25Totals {
  const zero = () => ({ base: 0, interior_exterior: 0, option: 0, sitework: 0 }) as Record<QuoteV25Section, number>;
  const lineTotals = zero();
  const expenses = zero();
  let hasUnresolved = false;
  for (const row of rows) {
    if (row.unitPrice === null && !row.state) hasUnresolved = true;
    lineTotals[row.section] += quoteV25RowAmount(row);
  }
  let rawSubtotal = 0;
  for (const section of QUOTE_V25_SECTIONS) {
    if (context.expenseSections.includes(section)) expenses[section] = truncMul(lineTotals[section], context.expenseRate);
    rawSubtotal += lineTotals[section] + expenses[section];
  }
  const subtotal = rawSubtotal + adjustment;
  const tax = truncMul(subtotal, context.taxRate);
  return { lineTotals, expenses, rawSubtotal, adjustment, subtotal, tax, total: subtotal + tax, hasUnresolved };
}

/**
 * 商品台帳から足せる商品（DB の create_quote_revision_v25 と同じ決まり）：新しく選べる（公開中・販売中の）商品で、
 * 商品の仕様コードがこの見積の仕様に合い、本体仕様マトリクスでその商品のカテゴリーが「×」でないもの
 * （2026-10-21 の確定事項：明細を自由に編集できても、本体仕様マトリクスの適合を無条件に外さない。マトリクスの対象外のカテゴリーは制限しない）
 */
export function quoteV25SelectableProducts<T extends ProductOption>(
  options: readonly T[],
  categories: readonly Pick<OptionCategory, 'id' | 'code'>[],
  matrix: CustomerCategoryMatrix | null,
  modelSlug: string,
  specCode: string
): T[] {
  const codeById = new Map(categories.map((category) => [category.id, category.code] as const));
  return options.filter(
    (option) =>
      isQuoteSelectableProduct(option) &&
      productSpecCodesAllow(option.spec_codes ?? [], specCode, modelSlug) &&
      customerCategorySelectable(matrix, modelSlug, specCode, codeById.get(option.category_id) ?? '')
  );
}
