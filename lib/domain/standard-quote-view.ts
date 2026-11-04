/**
 * 標準見積から作成した見積（PR H）の編集画面で使う型と試算。正本は DB（save_standard_quote_draft が全額を計算する）。
 * 式は標準見積と同じ（lib/domain/standard-estimate-money.ts）。ここは編集中の表示用。
 *
 * - 本体マスター由来の行：原価単価 = trunc(基準原価単価 × 販売費率)。基準原価単価は DB の値で、保存では送らない
 * - 経費の行は画面で持たない。区分の明細小計（POR を除く）× 経費率で、保存のたびに DB が作り直す
 * - POR（価格未確定）は下書きでは使えるが、残っていると発行できない
 * - 「0円確定」「対象外」は本体以外の「金額を入力」の 0 円の行。保存のときにサーバーが備考の印にする（対象外は原価も 0 円。D1 までの暫定）
 */
import {
  assertRates,
  lineMoney,
  revisionMoney,
  sectionMoney,
  toScaled,
  truncMul,
  type ExpenseMethod,
  type LineMoney,
  type PriceMode,
  type RevisionMoney,
  type SectionMoney,
} from './standard-estimate-money';
import type { StandardSectionCode } from './standard-estimate-view';
import { splitQuoteLineStateRemark, type QuoteLineState } from './quote-por';

export const STANDARD_QUOTE_SECTIONS: StandardSectionCode[] = ['base', 'interior_exterior', 'option', 'sitework'];

export const STANDARD_QUOTE_EXPENSE_LABEL: Record<StandardSectionCode, string> = {
  base: '本体諸費用',
  interior_exterior: '内外装工事経費',
  option: 'オプション諸費用',
  sitework: '別途工事経費',
};

export interface StandardQuoteLineInput {
  line_key: string | null;
  section_code: StandardSectionCode;
  name: string;
  description: string | null;
  quantity: string;
  unit: string | null;
  price_mode: PriceMode;
  /** 本体マスター由来の行の整数の基準原価単価（DB の値。試算と表示だけに使い、保存では送らない） */
  base_unit_cost: number | null;
  cost_unit_price: number | null;
  /** manual のときだけ使う売価単価 */
  unit_price: number | null;
  remark: string | null;
  /** 扱い（0円確定・対象外）。price_mode は manual・売価は 0 円 */
  line_state: QuoteLineState | null;
  /** 0円確定の理由・対象外のメモ */
  line_state_reason: string;
}

export interface StandardQuoteEditorState {
  sales_fee_rate: string;
  expense_rate: string;
  markup_rate: string;
  expense_methods: Record<StandardSectionCode, ExpenseMethod>;
  adjustment: number;
  adjustment_reason: string;
  notes: string;
  lines: StandardQuoteLineInput[];
}

export interface StandardQuotePreview {
  lines: Array<LineMoney | null>;
  sections: Record<StandardSectionCode, SectionMoney>;
  money: RevisionMoney | null;
  errors: string[];
}

/** 見積の数量のルール（DB と同じ）：0.01 以上 99999 以下・小数 4 桁まで */
function assertQuoteQuantity(quantity: string) {
  const scaled = toScaled(quantity);
  if (scaled < 100n || scaled > 999_990_000n) throw new Error('数量は0.01以上99999以下で入力してください');
}

/** 編集中の内容を DB と同じ式で試算する。入力に誤りがある行は null にして、誤りの一覧を返す */
export function previewStandardQuote(state: StandardQuoteEditorState, taxRate: string | number): StandardQuotePreview {
  const errors: string[] = [];
  const rates = { salesFeeRate: state.sales_fee_rate, expenseRate: state.expense_rate, markupRate: state.markup_rate, taxRate };
  let ratesOk = true;
  try {
    assertRates(rates);
  } catch (e) {
    ratesOk = false;
    errors.push(e instanceof Error ? e.message : String(e));
  }
  const lines = state.lines.map((line, index) => {
    if (!ratesOk) return null;
    try {
      if (!line.name.trim()) throw new Error('品名を入力してください');
      assertQuoteQuantity(line.quantity);
      if (line.line_state && (line.section_code === 'base' || line.price_mode !== 'manual')) {
        throw new Error('「0円確定」「対象外」は本体以外の「金額を入力」の行だけです');
      }
      if (line.line_state === 'zero_confirmed' && !line.line_state_reason.trim()) throw new Error('0円確定の理由を入力してください');
      const costUnitPrice =
        line.line_state === 'excluded'
          ? 0
          : line.base_unit_cost !== null && line.price_mode !== 'por'
            ? truncMul(line.base_unit_cost, rates.salesFeeRate)
            : line.cost_unit_price;
      const saleUnitPrice = line.line_state ? 0 : line.unit_price;
      return lineMoney({ mode: line.price_mode, quantity: line.quantity, costUnitPrice, saleUnitPrice }, rates);
    } catch (e) {
      errors.push(`${index + 1}行目：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  });
  const sectionOf = (code: StandardSectionCode) =>
    lines.filter((money, index): money is LineMoney => money !== null && state.lines[index].section_code === code);
  let sections = {} as Record<StandardSectionCode, SectionMoney>;
  let money: RevisionMoney | null = null;
  if (ratesOk) {
    try {
      sections = Object.fromEntries(
        STANDARD_QUOTE_SECTIONS.map((code) => [code, sectionMoney(sectionOf(code), state.expense_methods[code], rates)])
      ) as Record<StandardSectionCode, SectionMoney>;
      money = errors.length ? null : revisionMoney(STANDARD_QUOTE_SECTIONS.map((code) => sections[code]), state.adjustment, rates);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { lines, sections, money, errors };
}

/** 保存 RPC（save_standard_quote_draft）へ渡す明細。DB が売価・金額・経費の行を計算するので、単価と方法だけを送る */
export function toStandardQuoteSaveLines(lines: StandardQuoteLineInput[]) {
  return lines.map((line) => ({
    line_key: line.line_key,
    section_code: line.section_code,
    name: line.name,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    price_mode: line.price_mode,
    // 本体マスター由来の行の原価は DB が基準原価単価から計算する（画面からは送らない）
    cost_unit_price: line.price_mode === 'por' || line.base_unit_cost !== null ? null : line.cost_unit_price,
    unit_price: line.price_mode === 'manual' ? (line.line_state ? 0 : line.unit_price) : null,
    remark: line.remark,
    line_state: line.line_state,
    line_state_reason: line.line_state ? line.line_state_reason : null,
  }));
}

/** get_standard_quote_draft が返す明細（発行用の明細＋本部だけの内部原価） */
export interface StandardQuoteDraftItemPayload {
  line_key: string;
  kind: string;
  name: string;
  description: string | null;
  unit: string | null;
  remark: string | null;
  unit_price: number | null;
  quantity: number | string;
  amount: number | null;
  sort_order: number;
  price_mode: PriceMode;
  section_code: StandardSectionCode | null;
  line_role: 'line' | 'expense' | null;
  base_unit_cost: number | null;
  cost_unit_price: number | null;
  cost_amount: number | null;
}

export interface StandardQuoteDraftPayload {
  draft: {
    id: string;
    quote_request_id: string;
    parent_quote_id: string | null;
    base_model_id: string;
    spec_code: string;
    tax_rate: number | string;
    adjustment: number;
    adjustment_reason: string | null;
    subtotal: number;
    tax: number;
    total: number;
    lock_version: number;
    notes: string | null;
    source_kind: string;
    standard_estimate_revision_id: string | null;
  };
  request: { id: string; case_name: string | null; status: string; message: string | null; contact: { full_name?: string; company_name?: string | null } | null };
  internals: {
    sales_fee_rate: number | string | null;
    expense_rate: number | string | null;
    markup_rate: number | string | null;
    expense_methods: Partial<Record<StandardSectionCode, ExpenseMethod>> | null;
    cost_total: number | null;
  } | null;
  items: StandardQuoteDraftItemPayload[];
  standard_estimate: { revision_id: string; version: number; status: string; total: number; master_id: string; name: string; current_published_revision_id: string | null } | null;
  parent: { id: string; quote_no: string; revision: number; total: number } | null;
}

/** RPC の返り値から編集画面の状態を作る（経費の行は DB が作り直すので、画面の明細には入れない） */
export function standardQuoteStateFromPayload(payload: StandardQuoteDraftPayload): StandardQuoteEditorState {
  const methods = payload.internals?.expense_methods ?? {};
  const method = (code: StandardSectionCode): ExpenseMethod => (methods[code] === 'none' ? 'none' : methods[code] === 'rate' ? 'rate' : code === 'sitework' ? 'none' : 'rate');
  return {
    sales_fee_rate: String(payload.internals?.sales_fee_rate ?? '1.0000'),
    expense_rate: String(payload.internals?.expense_rate ?? '0.1500'),
    markup_rate: String(payload.internals?.markup_rate ?? '1.5000'),
    expense_methods: { base: method('base'), interior_exterior: method('interior_exterior'), option: method('option'), sitework: method('sitework') },
    adjustment: Number(payload.draft.adjustment ?? 0),
    adjustment_reason: payload.draft.adjustment_reason ?? '',
    notes: payload.draft.notes ?? '',
    lines: payload.items
      .filter((item) => item.line_role !== 'expense')
      .map((item) => ({
        line_key: item.line_key,
        section_code: (item.section_code ?? 'option') as StandardSectionCode,
        name: item.name,
        description: item.description,
        quantity: String(item.quantity),
        unit: item.unit,
        price_mode: item.price_mode,
        base_unit_cost: item.base_unit_cost,
        cost_unit_price: item.base_unit_cost !== null ? null : item.cost_unit_price,
        unit_price: item.price_mode === 'manual' ? item.unit_price : null,
        ...splitQuoteLineStateRemark(item.remark),
      })),
  };
}
