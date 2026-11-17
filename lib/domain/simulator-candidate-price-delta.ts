/**
 * 商品選択ポップアップの候補は、その商品を実際に選んだ想定の税込総額で比較。
 * カードの現在選択差額の流用・値段の再丸め・DBアクセスはしない。
 */
import { toggleOption, type RuleContext } from './rules';
import { withoutPositionCategoryOptions } from './simulator-position-slots';
import {
  createSimulatorCardDeltaEvaluator,
  type SimulatorCardDelta,
  type SimulatorCardPlanSelection,
  type SimulatorCardPriceInput,
  type SimulatorCardTarget,
} from './simulator-card-price-delta';
import type { CatalogBundle } from './types';

const sameIds = (a: string[], b: string[]): boolean => {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((id, i) => id === right[i]);
};

/** 規則を適用した結果が対象外の商品も変える場合は不明として扱う。
 * 副作用があるときは実際の適用前にユーザー確認が必要なため、
 * この表示だけで確定の差額を予測しない。
 */
export function simulatePickerCategoryCandidate(args: {
  bundle: CatalogBundle;
  ruleContext: RuleContext;
  current: SimulatorCardPlanSelection;
  categoryId: string;
  nextInCategory: string[];
  nextVariants: string[];
  positionCategoryIds: ReadonlySet<string>;
}): SimulatorCardPlanSelection | null {
  const { bundle, ruleContext, current, categoryId, nextInCategory, nextVariants, positionCategoryIds } = args;
  const categoryOptions = ruleContext.options.filter((option) => option.category_id === categoryId).map((option) => option.id);
  const categoryIds = new Set(categoryOptions);
  if (nextInCategory.some((id) => !categoryIds.has(id))) return null;

  let next = [...current.optionIds];
  let pending = categoryOptions.filter((id) => next.includes(id) && !nextInCategory.includes(id));
  while (pending.length) {
    let progressed = false;
    const rest: string[] = [];
    for (const id of pending) {
      const result = toggleOption(ruleContext, next, id);
      if (result.rejected) rest.push(id);
      else {
        next = result.next;
        progressed = true;
      }
    }
    if (!progressed) break;
    pending = rest;
  }
  for (const id of categoryOptions) {
    if (!nextInCategory.includes(id) || next.includes(id)) continue;
    const result = toggleOption(ruleContext, next, id);
    if (!result.rejected) next = result.next;
  }
  next = withoutPositionCategoryOptions(bundle.options, next, positionCategoryIds);

  if (!sameIds(next.filter((id) => categoryIds.has(id)), nextInCategory)) return null;
  if (!sameIds(next.filter((id) => !categoryIds.has(id)),
      current.optionIds.filter((id) => !categoryIds.has(id)))) return null;
  const groups = new Set(bundle.variantGroups.filter((group) => categoryIds.has(group.option_id)).map((group) => group.id));
  const choiceGroup = new Map(bundle.variantChoices.map((choice) => [choice.id, choice.group_id]));
  if (nextVariants.some((id) => !groups.has(choiceGroup.get(id) ?? ''))) return null;
  return {
    ...current,
    optionIds: next,
    variantChoiceIds: [
      ...current.variantChoiceIds.filter((id) => !groups.has(choiceGroup.get(id) ?? '')),
      ...nextVariants,
    ],
  };
}

/** 対象を標準に戻す比較も、現在の商品カードと同じ正式な税込総額評価器を使用する。 */
export function simulatorCandidatePriceDelta(
  context: SimulatorCardPriceInput,
  target: SimulatorCardTarget,
  candidate: SimulatorCardPlanSelection
): SimulatorCardDelta {
  return createSimulatorCardDeltaEvaluator({ ...context, current: candidate }).evaluate(target);
}
