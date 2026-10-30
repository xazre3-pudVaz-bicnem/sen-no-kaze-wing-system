/**
 * 見積書管理 ＞ 標準見積（Excel 風の画面）で v2.5 の下書きを編集するときの、画面の試算（2026-10-27 先方方針：この画面を正式な編集画面にする）。
 *
 * 正本は DB の計算（save_standard_estimate_v25_draft・standard_estimate_v25_recalculate）。ここは DB と同じ入力
 * （standard_estimate_v25_calc_input）を画面の状態から組み立て、同じ式の calculatePricingV25 で試算するだけ。
 *   - 本体：本体マスターの Revision の明細（原価）を auto で
 *   - 商品の選択枠：auto は原価 Version。保存済みの auto の選択枠と同じ「商品＋選択肢」なら固定した版、それ以外は今の版
 *     （DB の保存と同じ決まり。保存すると DB がこの決まりで固定する）。原価が未設定の auto の選択枠は計算から外し、
 *     「原価未設定」として示す（0 円にしない）
 *   - 工事費などの明細・売価入力の選択枠：manual は入力した売価（未入力は計算から外し「売価未入力」と示す。0 円にしない）、por は金額未確定
 * 原価はこの画面（本部だけ）でだけ扱う。
 */
import { calculatePricingV25, type PricingCalculationRule, type PricingInput, type PricingLineInput, type PricingResult, type PricingTaxRule } from './pricing-v25';
import type { V25EditorState, V25ProductCandidate, V25SlotRow } from './standard-estimate-v25-view';
import type { StandardLineSectionCode } from './standard-estimate-view';

/** 商品台帳の商品（その仕様で選べる商品）。画面の商品選択に使う */
export interface V25WorkbenchCandidate extends V25ProductCandidate {
  categoryId: string;
  manufacturer: string;
  modelNo: string;
  /** 新しく入れるときの選択肢（選択項目 → 標準の選択肢） */
  defaultChoices: Record<string, string>;
  /**
   * 保存済みの行の商品だが、今はこの仕様で選べない（下書きに戻した・カテゴリーが × になった等）。
   * 表示と削除のためだけに渡す（保存は DB が止める）
   */
  unavailable?: boolean;
}

export interface V25WorkbenchBaseLine {
  /** base_master_revision_lines の id */
  id: string;
  section: string;
  name: string;
  quantity: string;
  unit: string | null;
  /** 本体の原価単価（税別） */
  standard_cost: number;
}

/** 保存済みの auto の選択枠の固定した原価（「商品＋選択肢」ごと） */
export interface V25WorkbenchPinnedCost {
  /** 固定した商品の標準原価（版が無ければ null＝原価未設定） */
  standard_cost: number | null;
  /** 固定した選択肢の調整額（choice_id → 金額。版が無ければ null） */
  variant_adjustments: Record<string, number | null>;
}

export interface V25WorkbenchCosts {
  /** slotIdentity → 固定した原価（保存済みの auto の選択枠だけ。DB の保存の v_old と同じ） */
  pinned: Record<string, V25WorkbenchPinnedCost>;
  /** 今の商品の標準原価（option_id → 金額。版が無ければ載せない） */
  currentProduct: Record<string, number | null>;
  /** 今の選択肢の調整額（choice_id → 金額。版が無ければ載せない） */
  currentChoice: Record<string, number | null>;
}

export type V25WorkbenchSlotCost =
  | { status: 'ok'; standard_cost: number; variant_adjustment: number; pinned: boolean }
  | { status: 'missing'; reason: 'missing_standard_cost' | 'missing_variant_cost'; pinned: boolean };

/** 選択枠の選んだ選択肢（選択項目の順に並べる。保存の形と同じ） */
export function slotChoiceIds(slot: Pick<V25SlotRow, 'variant_choices'>): string[] {
  return Object.values(slot.variant_choices).filter(Boolean);
}

/** 「商品＋選択肢」の識別子（DB の保存の v_identity と同じ：商品 ID ｜ 選択肢 ID を昇順に , でつなぐ） */
export function slotIdentity(optionId: string, choiceIds: string[]): string {
  return `${optionId}|${[...choiceIds].sort().join(',')}`;
}

/**
 * auto の選択枠の原価。保存済みの auto の選択枠と同じ「商品＋選択肢」なら固定した版を使う（版が無ければ原価未設定のまま）。
 * それ以外（新しい行・商品や選択肢を変えた行・売価入力や別途見積から自動に変えた行）は今の版を使う（DB の保存と同じ決まり）
 */
export function slotCostForWorkbench(slot: Pick<V25SlotRow, 'option_id' | 'variant_choices'>, costs: V25WorkbenchCosts): V25WorkbenchSlotCost {
  const choices = slotChoiceIds(slot);
  const pinned = costs.pinned[slotIdentity(slot.option_id, choices)];
  if (pinned) {
    if (pinned.standard_cost === null) return { status: 'missing', reason: 'missing_standard_cost', pinned: true };
    let total = 0;
    for (const choiceId of choices) {
      const adjustment = pinned.variant_adjustments[choiceId];
      if (adjustment === null || adjustment === undefined) return { status: 'missing', reason: 'missing_variant_cost', pinned: true };
      total += adjustment;
    }
    return { status: 'ok', standard_cost: pinned.standard_cost, variant_adjustment: total, pinned: true };
  }
  const standardCost = costs.currentProduct[slot.option_id];
  if (standardCost === null || standardCost === undefined) return { status: 'missing', reason: 'missing_standard_cost', pinned: false };
  let total = 0;
  for (const choiceId of choices) {
    const adjustment = costs.currentChoice[choiceId];
    if (adjustment === null || adjustment === undefined) return { status: 'missing', reason: 'missing_variant_cost', pinned: false };
    total += adjustment;
  }
  return { status: 'ok', standard_cost: standardCost, variant_adjustment: total, pinned: false };
}

export interface V25WorkbenchCalculation {
  result: PricingResult | null;
  /** 計算できなかった理由（入力の不備など。DB の保存でも止まる） */
  error: string | null;
  /** 原価未設定で計算から外した auto の選択枠（画面の行の key） */
  incomplete: { key: string; option_id: string; reason: 'missing_standard_cost' | 'missing_variant_cost' }[];
  /** 売価が未入力（または整数円でない）ため計算から外した売価入力の行（画面の行の key） */
  unpriced: string[];
  /** 画面の行の key → 計算結果の明細の key */
  lineKeyOf: Record<string, string>;
}

const LINE_SECTIONS: StandardLineSectionCode[] = ['interior_exterior', 'option', 'sitework'];
const NON_NEGATIVE_INTEGER = /^\d+$/;

/**
 * 画面の状態から、DB の standard_estimate_v25_calc_input と同じ入力を組み立てて試算する。
 * sectionOf は商品の区分（商品台帳のカテゴリーから決まる。DB の保存と同じ）
 */
export function calculateV25Workbench(
  rule: PricingCalculationRule,
  taxRule: PricingTaxRule,
  state: V25EditorState,
  baseLines: V25WorkbenchBaseLine[],
  costs: V25WorkbenchCosts,
  sectionOf: (optionId: string) => StandardLineSectionCode | undefined
): V25WorkbenchCalculation {
  const incomplete: V25WorkbenchCalculation['incomplete'] = [];
  const unpriced: string[] = [];
  const lineKeyOf: Record<string, string> = {};
  const manualLine = (key: string, rowKey: string, quantity: string, unitPrice: string): PricingLineInput | null => {
    if (!NON_NEGATIVE_INTEGER.test(unitPrice.trim())) {
      unpriced.push(rowKey);
      return null;
    }
    return { key, mode: 'manual', quantity: quantity.trim(), manual_unit_price: Number(unitPrice.trim()) };
  };
  const sections: PricingInput['sections'] = [
    {
      code: 'base',
      lines: baseLines.map((line) => ({ key: `base:${line.id}`, mode: 'auto', quantity: line.quantity, standard_cost: line.standard_cost })),
    },
  ];
  for (const code of LINE_SECTIONS) {
    const lines: PricingLineInput[] = [];
    for (const slot of state.slots) {
      if (sectionOf(slot.option_id) !== code) continue;
      const key = `slot:${slot.key}`;
      if (slot.price_mode === 'auto') {
        const cost = slotCostForWorkbench(slot, costs);
        if (cost.status === 'missing') {
          incomplete.push({ key: slot.key, option_id: slot.option_id, reason: cost.reason });
          continue;
        }
        lines.push({ key, mode: 'auto', quantity: slot.quantity.trim(), standard_cost: cost.standard_cost, variant_adjustment: cost.variant_adjustment });
      } else if (slot.price_mode === 'manual') {
        const line = manualLine(key, slot.key, slot.quantity, slot.manual_unit_price);
        if (!line) continue;
        lines.push(line);
      } else {
        lines.push({ key, mode: 'por', quantity: slot.quantity.trim() });
      }
      lineKeyOf[slot.key] = key;
    }
    for (const line of state.lines) {
      if (line.section_code !== code) continue;
      const key = `line:${line.key}`;
      if (line.price_mode === 'manual') {
        const priced = manualLine(key, line.key, line.quantity, line.unit_price);
        if (!priced) continue;
        lines.push(priced);
      } else {
        lines.push({ key, mode: 'por', quantity: line.quantity.trim() });
      }
      lineKeyOf[line.key] = key;
    }
    sections.push({ code, lines });
  }
  const input: PricingInput = {
    rates: {
      sales_fee_rate: state.sales_fee_rate.trim(),
      markup_rate: state.markup_rate.trim(),
      expense_rate: state.expense_rate.trim(),
    },
    adjustment: Number(state.adjustment.trim() || '0'),
    sections,
  };
  try {
    return { result: calculatePricingV25(rule, taxRule, input), error: null, incomplete, unpriced, lineKeyOf };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { result: null, error: message.replace(/^VALIDATION:\s*/, ''), incomplete, unpriced, lineKeyOf };
  }
}

const PERCENT = /^\d+(\.\d{1,2})?$/;

/** 画面の率（%）の入力の確認。読めなければ最初の 1 件の文を返す（率の範囲は保存の前の確認・DB で確かめる） */
export function percentProblem(percents: Record<'sales_fee_rate' | 'expense_rate' | 'markup_rate', string>): string | null {
  const labels = { sales_fee_rate: '販売費率', expense_rate: '経費率', markup_rate: '掛率' } as const;
  for (const key of ['sales_fee_rate', 'expense_rate', 'markup_rate'] as const) {
    if (!PERCENT.test(percents[key].trim())) return `${labels[key]}は % で、小数 2 桁までの数を入力してください`;
  }
  return null;
}

/** 率（小数）を画面の % の文字列にする（1.5 → "150"、0.15 → "15"）。小数 4 桁の率は % で小数 2 桁まで */
export function rateToPercent(rate: string): string {
  const value = Number(rate);
  if (!Number.isFinite(value)) return rate;
  return String(Math.round(value * 1_000_000) / 10_000);
}

/**
 * 画面の % の文字列を率（小数 4 桁まで）にする（"150" → "1.5"）。10 進のまま 100 で割る（浮動小数の誤差を持ち込まない）。
 * 読めない入力は空文字にする（試算は止まり、保存の前の確認で percentProblem の文を出す）
 */
export function percentToRate(percent: string): string {
  const trimmed = percent.trim();
  if (!PERCENT.test(trimmed)) return '';
  const [whole, fraction = ''] = trimmed.split('.');
  const digits = (whole + fraction.padEnd(2, '0')).replace(/^0+(?=\d)/, '');
  const padded = digits.padStart(5, '0');
  const integer = padded.slice(0, -4).replace(/^0+(?=\d)/, '');
  const decimal = padded.slice(-4).replace(/0+$/, '');
  return decimal ? `${integer}.${decimal}` : integer;
}
