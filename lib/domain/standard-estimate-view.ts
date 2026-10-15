/**
 * 標準見積の管理画面（PR F）で使う型と試算。正本は DB（save_standard_estimate_draft が全額を計算する）。
 * ここは編集中の表示用で、DB と同じ式（lib/domain/standard-estimate-money.ts）を使う。
 */
import {
  baseLineMoney,
  lineMoney,
  revisionMoney,
  sectionMoney,
  type ExpenseMethod,
  type LineMoney,
  type PriceMode,
  type RevisionMoney,
  type SectionMoney,
} from './standard-estimate-money';

export type StandardSectionCode = 'base' | 'interior_exterior' | 'option' | 'sitework';
export type StandardLineSectionCode = Exclude<StandardSectionCode, 'base'>;

export const STANDARD_SECTION_LABEL: Record<StandardSectionCode, string> = {
  base: '本体',
  interior_exterior: '内外装',
  option: 'オプション',
  sitework: '別途工事',
};

export const PRICE_MODE_LABEL: Record<PriceMode, string> = {
  auto: '自動（原価 × 掛率）',
  manual: '売価を入力',
  por: '価格未確定',
};

export interface StandardEstimateLineInput {
  line_key: string | null;
  section_code: StandardLineSectionCode;
  group_label: string | null;
  name: string;
  quantity: string;
  unit: string | null;
  price_mode: PriceMode;
  cost_unit_price: number | null;
  /** manual のときだけ使う売価単価 */
  unit_price: number | null;
  remark: string | null;
}

export interface StandardEstimateEditorState {
  sales_fee_rate: string;
  expense_rate: string;
  markup_rate: string;
  adjustment: number;
  adjustment_reason: string;
  section_methods: Record<StandardSectionCode, ExpenseMethod>;
  lines: StandardEstimateLineInput[];
}

export interface BaseLineView {
  section: string;
  name: string;
  quantity: number | string;
  unit: string | null;
  /** 本体マスターの整数の基準原価単価 */
  unit_price: number;
}

export interface StandardEstimatePreview {
  base: LineMoney[];
  lines: Array<LineMoney | null>;
  sections: Record<StandardSectionCode, SectionMoney>;
  money: RevisionMoney | null;
  errors: string[];
}

/** 編集中の内容を DB と同じ式で試算する。入力に誤りがある行は null にして、誤りの一覧を返す */
export function previewStandardEstimate(baseLines: BaseLineView[], state: StandardEstimateEditorState, taxRate: string | number): StandardEstimatePreview {
  const errors: string[] = [];
  const rates = { salesFeeRate: state.sales_fee_rate, expenseRate: state.expense_rate, markupRate: state.markup_rate, taxRate };
  let base: LineMoney[] = [];
  try {
    base = baseLines.map((line) => baseLineMoney(line.unit_price, String(line.quantity), rates));
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  const lines = state.lines.map((line, index) => {
    try {
      return lineMoney(
        { mode: line.price_mode, quantity: line.quantity, costUnitPrice: line.cost_unit_price, saleUnitPrice: line.unit_price },
        rates
      );
    } catch (e) {
      errors.push(`${index + 1}行目：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  });
  const sectionOf = (code: StandardLineSectionCode) =>
    lines.filter((money, index): money is LineMoney => money !== null && state.lines[index].section_code === code);
  let sections = {} as Record<StandardSectionCode, SectionMoney>;
  let money: RevisionMoney | null = null;
  try {
    sections = {
      base: sectionMoney(base, state.section_methods.base, rates),
      interior_exterior: sectionMoney(sectionOf('interior_exterior'), state.section_methods.interior_exterior, rates),
      option: sectionMoney(sectionOf('option'), state.section_methods.option, rates),
      sitework: sectionMoney(sectionOf('sitework'), state.section_methods.sitework, rates),
    };
    money = errors.length ? null : revisionMoney(Object.values(sections), state.adjustment, rates);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  return { base, lines, sections, money, errors };
}

/** 保存 RPC（save_standard_estimate_draft）へ渡す明細。DB が売価・金額を計算するので、単価と方法だけを送る */
/** 同じ区分の中で、ひとつ前（-1）／後ろ（1）の行と入れ替える。保存で送る順番がそのまま並び順になる */
export function moveLineWithinSection<T extends { section_code: string }>(lines: T[], index: number, direction: -1 | 1): T[] {
  const section = lines[index]?.section_code;
  if (section === undefined) return lines;
  let target = index + direction;
  while (target >= 0 && target < lines.length && lines[target].section_code !== section) target += direction;
  if (target < 0 || target >= lines.length) return lines;
  const next = [...lines];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function toSaveLines(lines: StandardEstimateLineInput[]) {
  return lines.map((line) => ({
    line_key: line.line_key,
    section_code: line.section_code,
    group_label: line.group_label,
    name: line.name,
    quantity: line.quantity,
    unit: line.unit,
    price_mode: line.price_mode,
    cost_unit_price: line.price_mode === 'por' ? null : line.cost_unit_price,
    unit_price: line.price_mode === 'manual' ? line.unit_price : null,
    remark: line.remark,
  }));
}
