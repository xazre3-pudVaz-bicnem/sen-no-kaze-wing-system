/**
 * シミュレーターの位置・用途の選択枠（v2.5 PR-S2）。公開中の v2.5 の版の位置の枠（掃出し窓・洗面窓など）ごとに、お客様が 1 つ選ぶ。
 * 正本は DB（save_configuration_atomic の p_slot_selections と standard_estimate_v25_configuration_slot_issue）。ここは同じ決まりで画面の状態を作るだけ：
 *   - 注文範囲の内の位置は、すべて 1 つずつ選ぶ（範囲の外の位置は選ばない。DB は範囲の外の位置の商品を受け付けない）
 *   - その位置で選べる商品（標準の商品と、枠ごとの選べる商品）だけ
 *   - 位置で選ぶカテゴリーの商品は、カテゴリー単位では選ばない（同じ商品を二重に数えない）
 * 金額は computeSaleViewPricing（その位置の標準のままなら公開した版の売価、それ以外は売価の表）。
 */
import { reconcileVariantChoices } from './preset';
import { toggleOption, type RuleContext } from './rules';
import type { StandardEstimateSaleView, V25PositionSlot } from './standard-estimate-sale-view';
import type { OptionVariantChoice, OptionVariantGroup, ProductOption, SlotSelection } from './types';

/** 位置の枠の標準の選択（版の標準の商品と選択肢。今のカタログに無い（非公開の）選択肢は外す） */
export function standardSlotSelection(
  slot: V25PositionSlot,
  variantGroups: OptionVariantGroup[],
  variantChoices: OptionVariantChoice[]
): SlotSelection {
  const groupIds = new Set(variantGroups.filter((group) => group.option_id === slot.standard_option_id).map((group) => group.id));
  const published = new Set(variantChoices.filter((choice) => groupIds.has(choice.group_id)).map((choice) => choice.id));
  return {
    slot_code: slot.slot_code,
    option_id: slot.standard_option_id,
    variant_choice_ids: slot.standard_variant_choice_ids.filter((id) => published.has(id)),
  };
}

/** 2 つの位置の選択が同じ（商品と選択肢の組み合わせが同じ）か */
export function sameSlotSelection(a: Pick<SlotSelection, 'option_id' | 'variant_choice_ids'>, b: Pick<SlotSelection, 'option_id' | 'variant_choice_ids'>): boolean {
  if (a.option_id !== b.option_id) return false;
  const left = [...new Set(a.variant_choice_ids)].sort();
  const right = [...new Set(b.variant_choice_ids)].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export interface ActiveSlotSelections {
  /** 版の位置の枠の順の、今の選択（注文範囲の内の位置だけ。保存・金額にはこれを使う） */
  selections: SlotSelection[];
  /** 選んでいた商品が今は選べないため、標準に戻した位置の名前 */
  reverted: string[];
}

/**
 * 今の選択（お客様が変えた位置だけでよい）から、版の位置の枠ごとの選択をそろえる。
 * 選んでいない位置・版に無い商品・選べなくなった商品の位置は標準にし、注文範囲の外の位置は選ばない。
 * 選択肢は、その商品の選択項目のものだけにそろえる（足りない項目は標準の選択肢）
 */
export function activeV25SlotSelections(
  slots: V25PositionSlot[],
  chosen: SlotSelection[],
  context: {
    /** 位置の枠のカテゴリーが注文範囲の内か */
    inScope: (slot: V25PositionSlot) => boolean;
    /** その商品を新しく選べるか（仕様で選べる・販売中・シミュレーターに表示）。標準の商品は常に選べる */
    canSelect: (optionId: string) => boolean;
    variantGroups: OptionVariantGroup[];
    variantChoices: OptionVariantChoice[];
  }
): ActiveSlotSelections {
  const selections: SlotSelection[] = [];
  const reverted: string[] = [];
  for (const slot of slots) {
    if (!context.inScope(slot)) continue;
    const standard = standardSlotSelection(slot, context.variantGroups, context.variantChoices);
    const current = chosen.find((row) => row.slot_code === slot.slot_code);
    if (!current || sameSlotSelection(current, standard)) {
      selections.push(standard);
      continue;
    }
    const allowed =
      slot.selectable_option_ids.includes(current.option_id) &&
      (current.option_id === slot.standard_option_id || context.canSelect(current.option_id));
    if (!allowed) {
      reverted.push(slot.slot_label);
      selections.push(standard);
      continue;
    }
    selections.push({
      slot_code: slot.slot_code,
      option_id: current.option_id,
      variant_choice_ids: reconcileVariantChoices(context.variantGroups, context.variantChoices, [current.option_id], current.variant_choice_ids),
    });
  }
  return { selections, reverted };
}

/** 位置で選ぶカテゴリーの商品を、カテゴリー単位の選択から外す（DB の 'category_mixed' にしない） */
export function withoutPositionCategoryOptions(
  options: Pick<ProductOption, 'id' | 'category_id'>[],
  selectedIds: string[],
  positionCategoryIds: ReadonlySet<string>
): string[] {
  if (positionCategoryIds.size === 0) return selectedIds;
  const categoryOf = new Map(options.map((option) => [option.id, option.category_id] as const));
  return selectedIds.filter((id) => !positionCategoryIds.has(categoryOf.get(id) ?? ''));
}

/**
 * 使う版が変わったとき（防火の切り替えで標準構成から変えている場合）の、カテゴリー単位の選択のそろえ方。
 * 新しい版で位置ごとに選ぶカテゴリーの商品は外し、前の版で位置ごとに選んでいたが新しい版ではカテゴリー単位のカテゴリーは、
 * 新しい版の標準の商品で補う（位置の選択は activeV25SlotSelections が新しい版の枠でそろえる）
 */
export function switchPositionCategories(
  ctx: RuleContext,
  selectedIds: string[],
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
  nextStandardIds: string[]
): string[] {
  let current = withoutPositionCategoryOptions(ctx.options, selectedIds, next);
  for (const id of nextStandardIds) {
    const categoryId = ctx.options.find((option) => option.id === id)?.category_id;
    if (!categoryId || !previous.has(categoryId) || next.has(categoryId) || current.includes(id)) continue;
    const result = toggleOption(ctx, current, id);
    if (!result.rejected) current = result.next;
  }
  return current;
}

/**
 * 御見積書の標準見積の明細のうち、版の選択枠の商品の行に付ける注記（v2.5 PR-S2。表示だけで、金額は「選択商品の変更差額」の行のまま）。
 * 行の id は saleViewToTemplateBundle と同じ（版の id-line-番号）。外壁（4 面）の行は面ごとの選択で示すので付けない
 */
export function v25StandardLineNotes(
  view: Pick<StandardEstimateSaleView, 'revision_id' | 'lines' | 'baseline'>,
  current: { optionIds: string[]; variantChoiceIds: string[]; slotSelections: SlotSelection[] },
  catalog: {
    optionName: (optionId: string) => string | undefined;
    choiceName: (choiceId: string) => string | undefined;
    /** 選択肢の商品（今のカタログに無い選択肢は undefined） */
    optionOfChoice: (choiceId: string) => string | undefined;
  }
): Record<string, string> {
  const notes: Record<string, string> = {};
  const choicesOf = (optionId: string, ids: string[]) => ids.filter((id) => catalog.optionOfChoice(id) === optionId);
  const describe = (optionId: string, ids: string[]) => {
    const choices = choicesOf(optionId, ids).map(catalog.choiceName).filter(Boolean).join('・');
    return `${catalog.optionName(optionId) ?? '選んだ商品'}${choices ? `（${choices}）` : ''}`;
  };
  view.lines.forEach((line, index) => {
    if (!line.option_id) return;
    const id = `${view.revision_id}-line-${index}`;
    const slotCode = line.slot_code ?? null;
    const item = view.baseline.find((row) => (row.slot_code ?? null) === slotCode && row.option_id === line.option_id);
    if (item?.selection_target_code === 'exterior-wall') return;
    const standard = { option_id: line.option_id, variant_choice_ids: choicesOf(line.option_id, item?.variant_choice_ids ?? []) };
    if (slotCode) {
      const selection = current.slotSelections.find((row) => row.slot_code === slotCode);
      if (!selection) notes[id] = '選択なし（変更差額に含みます）';
      else if (!sameSlotSelection(selection, standard)) notes[id] = `変更：${describe(selection.option_id, selection.variant_choice_ids)}（変更差額に含みます）`;
      return;
    }
    if (!current.optionIds.includes(line.option_id)) {
      notes[id] = '選択から外しています（変更差額に含みます）';
      return;
    }
    const chosen = { option_id: line.option_id, variant_choice_ids: choicesOf(line.option_id, current.variantChoiceIds) };
    if (!sameSlotSelection(chosen, standard)) notes[id] = `仕様を変更：${describe(line.option_id, chosen.variant_choice_ids)}（変更差額に含みます）`;
  });
  return notes;
}
