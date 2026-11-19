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
  /** カテゴリーのコード（外壁は exterior-wall。選択枠の数量の決まりに使う） */
  categoryCode: string;
  /** 1 つだけ選べるカテゴリー（シミュレーターで 1 つしか選べない） */
  singleSelect: boolean;
  /**
   * シミュレーターで 1 つの表示商品にまとめる商品の組（標準洗面セットの洗面器＋混合水栓）。
   * 1 つだけ選べるカテゴリーの選択枠を数えるとき、同じ組は 1 つと数える（DB の standard_estimate_v25_slot_rule_issues と同じ）
   */
  displayGroup?: string | null;
  manufacturer: string;
  modelNo: string;
  /** 商品台帳の販売単位（台・セット・㎡など）。表示専用で価格計算には影響しない。 */
  priceUnit?: string | null;
  /** 商品台帳に登録したメイン画像。商品選択画面でのみ使用。 */
  imageUrl?: string | null;
  /** 窓タイプを使うカテゴリー（サッシ）の商品か（v2.5 PR-S2。位置の枠の選べる商品を窓タイプで絞り込む） */
  usesWindowType?: boolean;
  /** 窓タイプ（未設定は null） */
  windowTypeCode?: string | null;
  /** 窓タイプの名前（マスターに無いコードはコードのまま） */
  windowTypeLabel?: string | null;
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
  /**
   * 「選択枠の識別子#slotIdentity」→ 固定した原価（DB の保存の v_old_rows と同じ。v2.5 PR-S1）。
   * 同じ商品＋選択肢が複数の位置の枠にあるときは、その行の固定を先に使う
   */
  pinnedByRow?: Record<string, V25WorkbenchPinnedCost>;
  /** 今の商品の標準原価（option_id → 金額。版が無ければ載せない） */
  currentProduct: Record<string, number | null>;
  /** 今の選択肢の調整額（choice_id → 金額。版が無ければ載せない） */
  currentChoice: Record<string, number | null>;
}

export type V25WorkbenchSlotCost =
  | { status: 'ok'; standard_cost: number; variant_adjustment: number; pinned: boolean }
  | { status: 'missing'; reason: 'missing_standard_cost' | 'missing_variant_cost'; pinned: boolean };

/**
 * 選択枠を新しく入れるときの数量（2026-10-29 先方回答）：外壁は front / right / back / left の 4 面を個別に変えられるので 4（面）、
 * それ以外は 1。屋根の 23.5㎡ のような計上数量は、入れた後に変えられる（#647。決まりは v25SlotRuleIssues）
 */
export function standardSlotQuantity(categoryCode: string): number {
  return categoryCode === 'exterior-wall' ? 4 : 1;
}

/** 位置・用途の選択枠を作れないカテゴリー（外壁は 4 面の専用の仕組み、防火仕様は版で決まる。DB と同じ） */
const NO_POSITION_SLOT_CATEGORY_CODES = new Set(['exterior-wall', 'fireproof']);

/** 位置・用途の選択枠にできるカテゴリーか（外壁・防火仕様は作れない。DB と同じ） */
export function canUsePositionSlot(categoryCode: string): boolean {
  return !NO_POSITION_SLOT_CATEGORY_CODES.has(categoryCode);
}

/** 選択枠の決まりで使う商品の情報（DB の standard_estimate_v25_slot_rule_issues と同じ判定に要るもの） */
type V25SlotRuleCandidate = Pick<
  V25WorkbenchCandidate,
  'name' | 'categoryId' | 'categoryName' | 'categoryCode' | 'singleSelect' | 'displayGroup' | 'unavailable' | 'priceUnit'
> & {
  retired?: boolean;
};

/** DB の nullif(btrim(price_unit), '') と同じ（前後の半角空白だけを外す） */
function normalizedUnit(value: string | null | undefined): string | null {
  const unit = typeof value === 'string' ? value.replace(/^ +| +$/g, '') : '';
  return unit || null;
}

/** 既存行の変更用patch。安全判定（v25ProductReplacementIssue）が成功した後だけ利用する。 */
export function v25ProductChangePatch(
  slot: V25SlotRow,
  candidate: V25WorkbenchCandidate,
  choices: Record<string, string>,
  candidateOf: (id: string) => V25WorkbenchCandidate | undefined,
): Partial<V25SlotRow> {
  if (candidate.id === slot.option_id) return { variant_choices: { ...choices } };
  return {
    option_id: candidate.id,
    variant_choices: { ...choices },
    // 既存行の価格モードは商品入替では変更しない（別途工事の手入力売価も保持）。
    selectable_option_ids: slot.selectable_option_ids.filter(
      (id) => id !== candidate.id && candidateOf(id)?.categoryId === candidate.categoryId
    ),
  };
}

/**
 * 既存商品から別の商品へ入れ替えるときだけの安全検査。
 * 同一商品は仕様だけ変えるため数量・単位・位置・価格指定を保持する。
 * 販売単位を画面で推測・換算せず、#659 の公開判定を変更候補の確定前にも適用する。
 */
export function v25ProductReplacementIssue(
  slot: V25SlotRow,
  previous: V25WorkbenchCandidate,
  replacement: V25WorkbenchCandidate,
  slots: readonly V25SlotRow[],
  candidateOf: (id: string) => V25WorkbenchCandidate | undefined,
  candidatesInCategory: (categoryId: string) => V25WorkbenchCandidate[],
): string | null {
  if (previous.id !== slot.option_id || previous.categoryId !== replacement.categoryId ||
    previous.section !== replacement.section || replacement.retired || replacement.unavailable) {
    return '同じカテゴリーの選択可能な商品へ変更してください';
  }
  if (previous.id === replacement.id) return null;

  const beforeUnit = normalizedUnit(previous.priceUnit);
  const afterUnit = normalizedUnit(replacement.priceUnit);
  if (!beforeUnit || !afterUnit || beforeUnit.length > 12 || afterUnit.length > 12) {
    return '変更前後の商品の販売単位を確認できません。商品台帳の販売単位を確認してから変更してください（数量は自動変更しません）';
  }
  if (beforeUnit !== afterUnit) {
    return `変更前後の販売単位が異なります（${beforeUnit} → ${afterUnit}）。数量の換算は行いません。商品台帳と数量を確認してください`;
  }

  const quantity = slot.quantity.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(quantity) || !Number.isFinite(Number(quantity)) ||
    Number(quantity) <= 0 || Number(quantity) > 99999) {
    return '既存数量が有効ではありません。数量を確認してから商品を変更してください';
  }

  const candidateAfter = (id: string) => id === replacement.id ? replacement : candidateOf(id);
  const beforeIssues = new Set(v25SlotRuleIssues([...slots], candidateOf, candidatesInCategory));
  const afterSlots = slots.map((row) =>
    row.key === slot.key ? { ...row, option_id: replacement.id } : row);
  const newIssues = v25SlotRuleIssues(afterSlots, candidateAfter, candidatesInCategory)
    .filter((issue) => !beforeIssues.has(issue));
  if (newIssues.length > 0) {
    return `変更すると数量・選択枠のルールに適合しません：${newIssues[0]}`;
  }
  return null;
}

/**
 * 選択枠がシミュレーターと連携する決まりに合わない内容（公開できない理由。DB の standard_estimate_v25_slot_rule_issues と同じ決まり・同じ文言）。
 * 外壁は数量 4（面）。外壁以外の数量（計上数量）を 1 以外にできるのは、1 つだけ選べるカテゴリーにその枠だけがある
 * カテゴリー単位の枠（屋根 23.5㎡ など。#647）だけで、その枠は商品台帳の販売単位が必要、そのカテゴリーの選べる商品は同じ販売単位。
 * 位置・用途の枠は数量 1。
 * 1 つだけ選べるカテゴリーのカテゴリー単位の選択枠は 1 つ。位置・用途の選択枠（v2.5 PR-S1）：外壁・防火仕様には作らない、
 * カテゴリー単位の枠と同じカテゴリーに混ぜない、1 つだけ選べるカテゴリーでも位置ごとに 1 つ選ぶので何枠でもよい、選べる商品は同じカテゴリーの販売中の商品。
 * candidatesInCategory はカテゴリー単位の枠の販売単位の確認に使う（その仕様で選べる商品。渡さなければその確認はしない）
 */
export function v25SlotRuleIssues(
  slots: (Pick<V25SlotRow, 'option_id' | 'quantity'> & Partial<Pick<V25SlotRow, 'slot_code' | 'selectable_option_ids'>>)[],
  candidateOf: (optionId: string) => V25SlotRuleCandidate | undefined,
  candidatesInCategory?: (categoryId: string) => V25SlotRuleCandidate[]
): string[] {
  const wall: string[] = [];
  const notMeasured: string[] = [];
  const unitMissing: string[] = [];
  const unitMismatch: string[] = [];
  const noPosition: string[] = [];
  const badSelectable: string[] = [];
  const singles = new Map<string, { name: string; keys: Set<string> }>();
  const kinds = new Map<string, { name: string; category: boolean; position: boolean }>();
  // カテゴリー単位の選択枠の数（カテゴリーごと。DB の standard_estimate_v25_slot_measured と同じ数え方。外壁は別）
  const categoryLevelCount = new Map<string, number>();
  for (const slot of slots) {
    const candidate = candidateOf(slot.option_id);
    if (!candidate || slot.slot_code?.trim()) continue;
    categoryLevelCount.set(candidate.categoryId, (categoryLevelCount.get(candidate.categoryId) ?? 0) + 1);
  }
  slots.forEach((slot, index) => {
    const candidate = candidateOf(slot.option_id);
    // この仕様で選べなくなった商品の行は、削除してから保存する（別の案内を出す）
    if (!candidate || candidate.unavailable) return;
    const position = Boolean(slot.slot_code?.trim());
    const quantity = Number(slot.quantity.trim());
    // 計上数量を 1 以外にできる枠（#647）：1 つだけ選べるカテゴリーに、そのカテゴリー単位の選択枠だけがある（位置・用途の枠は数量 1）
    const quantityAllowed =
      !position &&
      candidate.categoryCode !== 'exterior-wall' &&
      candidate.singleSelect &&
      categoryLevelCount.get(candidate.categoryId) === 1;
    if (candidate.categoryCode === 'exterior-wall') {
      if (quantity !== standardSlotQuantity(candidate.categoryCode)) wall.push(`「${candidate.name}」`);
    } else if (quantity !== 1) {
      const unit = normalizedUnit(candidate.priceUnit);
      if (!quantityAllowed) {
        notMeasured.push(`「${candidate.name}」`);
      } else if (!unit || unit.length > 12) {
        unitMissing.push(`「${candidate.name}」`);
      } else {
        // そのカテゴリーの、この仕様で選べる商品は同じ販売単位（違う商品は価格未確定になるため）
        for (const alternative of candidatesInCategory?.(candidate.categoryId) ?? []) {
          if (alternative.unavailable || alternative.retired) continue;
          const altUnit = normalizedUnit(alternative.priceUnit);
          if (altUnit !== unit) unitMismatch.push(`「${alternative.name}」（${altUnit ?? '販売単位なし'}）`);
        }
      }
    }
    if (position && NO_POSITION_SLOT_CATEGORY_CODES.has(candidate.categoryCode)) noPosition.push(`「${candidate.name}」`);
    const kind = kinds.get(candidate.categoryId) ?? { name: candidate.categoryName, category: false, position: false };
    kinds.set(candidate.categoryId, { ...kind, category: kind.category || !position, position: kind.position || position });
    if (candidate.singleSelect && !position) {
      const row = singles.get(candidate.categoryId) ?? { name: candidate.categoryName, keys: new Set<string>() };
      // 標準洗面セット（洗面器＋混合水栓）は、シミュレーターと同じく 1 つと数える
      row.keys.add(candidate.displayGroup ?? `slot-${index}`);
      singles.set(candidate.categoryId, row);
    }
    if (position) {
      for (const id of slot.selectable_option_ids ?? []) {
        if (id === slot.option_id) continue;
        const alternative = candidateOf(id);
        if (!alternative || alternative.unavailable || alternative.retired || alternative.categoryId !== candidate.categoryId) {
          badSelectable.push(`「${alternative?.name ?? '選べない商品'}」`);
        }
      }
    }
  });
  const doubled = [...singles.values()].filter((row) => row.keys.size > 1).map((row) => `「${row.name}」`);
  const mixed = [...kinds.values()].filter((row) => row.category && row.position).map((row) => `「${row.name}」`);
  const unique = (values: string[]) => [...new Set(values)];
  return [
    ...(wall.length > 0 ? [`外壁の選択枠は数量 4（面）にしてください：${unique(wall).join('・')}`] : []),
    ...(notMeasured.length > 0
      ? [
          `外壁以外の選択枠の数量を 1 以外にできるのは、1 つだけ選べるカテゴリーにその選択枠だけがあるときです（位置・用途の選択枠とほかは数量 1 にし、個別に選ばない数量は明細にします）：${unique(notMeasured).join('・')}`,
        ]
      : []),
    ...(unitMissing.length > 0
      ? [
          `数量が 1 以外の選択枠には、商品台帳の販売単位（12 文字まで）が必要です（商品台帳で販売単位を設定してから、下書きを保存し直してください）：${unique(unitMissing).join('・')}`,
        ]
      : []),
    ...(unitMismatch.length > 0
      ? [`数量が 1 以外の選択枠のカテゴリーの商品は、標準の商品と同じ販売単位にしてください：${unique(unitMismatch).join('・')}`]
      : []),
    ...(noPosition.length > 0 ? [`外壁・防火仕様には位置・用途の選択枠を作れません：${unique(noPosition).join('・')}`] : []),
    ...(mixed.length > 0 ? [`カテゴリー単位の選択枠と位置・用途の選択枠を、同じカテゴリーに混ぜられません：${mixed.join('・')}`] : []),
    ...(doubled.length > 0
      ? [`1 つだけ選べるカテゴリーの選択枠は 1 つにしてください：${doubled.join('・')}（位置ごとに分けるときは、位置・用途の選択枠にします）`]
      : []),
    ...(badSelectable.length > 0
      ? [`選べる商品は、その枠の標準の商品と同じカテゴリーの、公開中で販売停止・廃番でない商品にしてください：${unique(badSelectable).join('・')}`]
      : []),
  ];
}

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
 * 同じ行（選択枠の識別子）の固定を先に、無ければ同じ「商品＋選択肢」のほかの行の固定を使う（DB の保存の v_old_rows → v_old と同じ）。
 * それ以外（新しい行・商品や選択肢を変えた行・売価入力や別途見積から自動に変えた行）は今の版を使う（DB の保存と同じ決まり）
 */
export function slotCostForWorkbench(
  slot: Pick<V25SlotRow, 'option_id' | 'variant_choices'> & Partial<Pick<V25SlotRow, 'baseline_key'>>,
  costs: V25WorkbenchCosts
): V25WorkbenchSlotCost {
  const choices = slotChoiceIds(slot);
  const identity = slotIdentity(slot.option_id, choices);
  const pinned = (slot.baseline_key ? costs.pinnedByRow?.[`${slot.baseline_key}#${identity}`] : undefined) ?? costs.pinned[identity];
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
