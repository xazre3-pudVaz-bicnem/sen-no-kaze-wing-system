/**
 * 見積書管理 ＞ 標準見積（Excel 風の画面）で v2.5 の下書きを編集するときの、画面の試算（2026-10-27 先方方針：この画面を正式な編集画面にする）。
 *
 * 正本は DB の計算（save_standard_estimate_v25_draft・standard_estimate_v25_recalculate）。ここは DB と同じ入力
 * （standard_estimate_v25_calc_input）を画面の状態から組み立て、同じ式の calculatePricingV25 で試算するだけ。
 *   - 本体：本体マスターの Revision の明細（原価）を auto で
 *   - 商品の選択枠：auto は原価 Version（保存済みで商品・選択肢を変えていない行は固定した版、それ以外は今の版。保存すると DB が同じ決まりで固定する）
 *     原価が未設定の auto の選択枠は計算から外し、「原価未設定」として示す（0 円にしない）
 *   - 工事費などの明細：manual は入力した売価、por は金額未確定
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

/** 保存済みの選択枠（baseline_key ごと）：保存した商品・選択肢と、固定した原価 */
export interface V25WorkbenchSavedSlot {
  option_id: string;
  variant_choice_ids: string[];
  /** 固定した商品の標準原価（版が無ければ null＝原価未設定） */
  standard_cost: number | null;
  /** 固定した選択肢の調整額（choice_id → 金額。版が無ければ null） */
  variant_adjustments: Record<string, number | null>;
}

export interface V25WorkbenchCosts {
  saved: Record<string, V25WorkbenchSavedSlot>;
  /** 今の商品の標準原価（option_id → 金額。版が無ければ null） */
  currentProduct: Record<string, number | null>;
  /** 今の選択肢の調整額（choice_id → 金額。版が無ければ null） */
  currentChoice: Record<string, number | null>;
}

export type V25WorkbenchSlotCost =
  | { status: 'ok'; standard_cost: number; variant_adjustment: number; pinned: boolean }
  | { status: 'missing'; reason: 'missing_standard_cost' | 'missing_variant_cost'; pinned: boolean };

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/** 選択枠の選んだ選択肢（選択項目の順に並べる。保存の形と同じ） */
export function slotChoiceIds(slot: V25SlotRow): string[] {
  return Object.values(slot.variant_choices).filter(Boolean);
}

/**
 * auto の選択枠の原価。保存済みの選択枠で、商品と選択肢が保存したときと同じなら固定した版を使う（DB の保存と同じ決まり）。
 * 商品・選択肢を変えた行と新しい行は今の版を使う（保存すると DB が今の版で固定する）
 */
export function slotCostForWorkbench(slot: V25SlotRow, costs: V25WorkbenchCosts): V25WorkbenchSlotCost {
  const choices = slotChoiceIds(slot);
  const saved = slot.baseline_key ? costs.saved[slot.baseline_key] : undefined;
  if (saved && saved.option_id === slot.option_id && sameSet(saved.variant_choice_ids, choices)) {
    if (saved.standard_cost === null) return { status: 'missing', reason: 'missing_standard_cost', pinned: true };
    let total = 0;
    for (const choiceId of choices) {
      const adjustment = saved.variant_adjustments[choiceId];
      if (adjustment === null || adjustment === undefined) return { status: 'missing', reason: 'missing_variant_cost', pinned: true };
      total += adjustment;
    }
    return { status: 'ok', standard_cost: saved.standard_cost, variant_adjustment: total, pinned: true };
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
  /** 画面の行の key → 計算結果の明細の key */
  lineKeyOf: Record<string, string>;
}

const LINE_SECTIONS: StandardLineSectionCode[] = ['interior_exterior', 'option', 'sitework'];

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
  const lineKeyOf: Record<string, string> = {};
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
        lines.push({ key, mode: 'manual', quantity: slot.quantity.trim(), manual_unit_price: Number(slot.manual_unit_price.trim()) });
      } else {
        lines.push({ key, mode: 'por', quantity: slot.quantity.trim() });
      }
      lineKeyOf[slot.key] = key;
    }
    for (const line of state.lines) {
      if (line.section_code !== code) continue;
      const key = `line:${line.key}`;
      lines.push(
        line.price_mode === 'manual'
          ? { key, mode: 'manual', quantity: line.quantity.trim(), manual_unit_price: Number(line.unit_price.trim()) }
          : { key, mode: 'por', quantity: line.quantity.trim() }
      );
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
    return { result: calculatePricingV25(rule, taxRule, input), error: null, incomplete, lineKeyOf };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { result: null, error: message.replace(/^VALIDATION:\s*/, ''), incomplete, lineKeyOf };
  }
}

/** 率（小数）を画面の % の文字列にする（1.5 → "150"、0.15 → "15"）。小数 4 桁の率は % で小数 2 桁まで */
export function rateToPercent(rate: string): string {
  const value = Number(rate);
  if (!Number.isFinite(value)) return rate;
  return String(Math.round(value * 1_000_000) / 10_000);
}

/** 画面の % の文字列を率（小数 4 桁まで）にする（"150" → "1.5"）。読めなければ入力のまま返す（保存の前の確認で止まる） */
export function percentToRate(percent: string): string {
  const trimmed = percent.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return trimmed;
  const [whole, fraction = ''] = trimmed.split('.');
  // 10 進のまま 100 で割る（浮動小数の誤差を持ち込まない）
  const digits = (whole + fraction.padEnd(2, '0')).replace(/^0+(?=\d)/, '');
  const padded = digits.padStart(5, '0');
  const integer = padded.slice(0, -4).replace(/^0+(?=\d)/, '');
  const decimal = padded.slice(-4).replace(/0+$/, '');
  return decimal ? `${integer}.${decimal}` : integer;
}
