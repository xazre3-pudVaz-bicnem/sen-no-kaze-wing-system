/**
 * プランボードの商品カード用「この変更による税込差額」。
 *
 * 現在のほかの選択を維持して対象だけ標準へ戻し、
 * 正式なシミュレーターの価格計算経路の total 同士を比較する。
 * 個別の影響額は非加算的（経費・税・端数調整のため）。合計に合わせる配分をしない。
 *
 * 表示用のみ。保存・見積・価格計算の正本・新価格スイッチには一切触れない。
 */
import { computePricing } from './pricing';
import { computeStandardEstimatePricing } from './standard-estimate-pricing';
import {
  computeSaleViewPricing,
  isV25SaleView,
  v25PositionSlotCategoryIds,
  v25PositionSlots,
  type StandardEstimateSaleView,
  type V25UnitLookup,
} from './standard-estimate-sale-view';
import type { ExteriorFaceCode, ExteriorFaceSelection } from './exterior-wall';
import type { CatalogBundle, EstimateTemplateBundle, FinishLevel, SlotSelection } from './types';

export interface SimulatorCardPlanSelection {
  optionIds: string[];
  variantChoiceIds: string[];
  exteriorFaces: ExteriorFaceSelection[];
  slotSelections?: SlotSelection[];
}

/** SimulatorApp で実際に選んだ価格計算経路を、そのまま呼び出し元から指定する。 */
export type SimulatorCardPriceSource =
  | { kind: 'legacy'; baseOverride: number | null }
  | { kind: 'legacy-template'; template: EstimateTemplateBundle; finishLevel: FinishLevel }
  | {
      kind: 'sale-view';
      view: StandardEstimateSaleView;
      unitLookup?: V25UnitLookup;
      /** 注文範囲内の公開位置コード（現在の選択ではなく、公開版と注文範囲から導出）。
       * 未指定なら公開版の全位置枠を必須とする。 */
      activeSlotCodes?: readonly string[];
    }
  | { kind: 'v25-pending' };

export type SimulatorCardTarget =
  | { kind: 'category'; categoryId: string }
  | { kind: 'slot'; slotCode: string }
  | { kind: 'exterior-face'; faceCode: ExteriorFaceCode };

export type SimulatorCardPendingReason =
  | 'no-published-price'
  | 'incomplete-selection'
  | 'unresolved-unit'
  | 'price-on-request'
  | 'invalid-amount'
  | 'calculation-failed';

export type SimulatorCardDelta =
  | { kind: 'standard' }
  | { kind: 'changed'; deltaIncludingTax: number }
  | { kind: 'pending'; reason: SimulatorCardPendingReason };

export interface SimulatorCardPriceInput {
  bundle: CatalogBundle;
  source: SimulatorCardPriceSource;
  /** 現在の選択（別の商品・位置・外壁面の変更も含める） */
  current: SimulatorCardPlanSelection;
  /** 対象を戻す標準選択。v2.5 の位置別標準だけは公開版の枠を正本として参照する。 */
  standard: SimulatorCardPlanSelection;
}

const FACE_CODES = ['front', 'right', 'back', 'left'] as const;

function sameSet(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameFace(a: ExteriorFaceSelection, b: ExteriorFaceSelection): boolean {
  return a.option_id === b.option_id && sameSet(a.variant_choice_ids, b.variant_choice_ids);
}

function completeFaces(faces: ExteriorFaceSelection[]): boolean {
  return faces.length === FACE_CODES.length &&
    FACE_CODES.every((code) => faces.filter((face) => face.face_code === code).length === 1);
}

/**
 * 公開版の位置枠を正本として、選択データ全体を検証する。
 * computeSaleViewPricing は無い位置や知らない位置を計上せず、重複は複数計上し得る。
 * そのため表示専用の差額判定では、価格計算へ渡す前に欠落・重複・不整合を遮断する。
 */
function validV25PositionSlots(
  bundle: CatalogBundle,
  source: Extract<SimulatorCardPriceSource, { kind: 'sale-view' }>,
  plan: SimulatorCardPlanSelection
): boolean {
  const published = v25PositionSlots(source.view);
  const publishedCodes = published.map((slot) => slot.slot_code);
  const activeCodes = source.activeSlotCodes ?? publishedCodes;
  const selected = plan.slotSelections ?? [];
  const publishedCodeSet = new Set(publishedCodes);
  const activeCodeSet = new Set(activeCodes);

  // 公開版そのものが重複・不正、注文範囲の指定が公開版と一致しない場合も数値を出さない。
  if (publishedCodeSet.size !== publishedCodes.length ||
      activeCodeSet.size !== activeCodes.length ||
      activeCodes.some((code) => !publishedCodeSet.has(code)) ||
      selected.length !== activeCodes.length ||
      new Set(selected.map((item) => item.slot_code)).size !== selected.length ||
      selected.some((item) => !activeCodeSet.has(item.slot_code))) {
    return false;
  }

  const options = new Map(bundle.options.map((option) => [option.id, option] as const));
  const groups = new Map(bundle.variantGroups.map((group) => [group.id, group] as const));
  const choices = new Map(bundle.variantChoices.map((choice) => [choice.id, choice] as const));
  const activeSlots = published.filter((slot) => activeCodeSet.has(slot.slot_code));
  const activeCategories = new Set(activeSlots.map((slot) =>
    slot.category_id ?? options.get(slot.standard_option_id)?.category_id
  ));
  // 位置別とカテゴリー別で同じ商品の価格を二重計上しない。
  if (plan.optionIds.some((id) => activeCategories.has(options.get(id)?.category_id))) return false;

  return activeSlots.every((slot) => {
    const choice = selected.find((item) => item.slot_code === slot.slot_code);
    const standardOption = options.get(slot.standard_option_id);
    const pickedOption = choice ? options.get(choice.option_id) : undefined;
    const categoryId = slot.category_id ?? standardOption?.category_id;
    if (!choice || !standardOption || standardOption.status !== 'published' ||
        !pickedOption || pickedOption.status !== 'published' ||
        !categoryId || standardOption.category_id !== categoryId ||
        pickedOption.category_id !== categoryId ||
        !slot.selectable_option_ids.includes(choice.option_id) ||
        !Array.isArray(choice.variant_choice_ids)) return false;

    const seenGroups = new Set<string>();
    return choice.variant_choice_ids.every((id) => {
      const variant = choices.get(id);
      const group = variant ? groups.get(variant.group_id) : undefined;
      if (!variant || !group || group.option_id !== choice.option_id ||
          variant.status !== 'published' || group.status !== 'published' ||
          seenGroups.has(group.id)) return false;
      seenGroups.add(group.id);
      return true;
    });
  });
}

type Restored =
  | { kind: 'same' }
  | { kind: 'restored'; plan: SimulatorCardPlanSelection }
  | { kind: 'pending' };

function restoreTarget(input: SimulatorCardPriceInput, target: SimulatorCardTarget): Restored {
  const { bundle, source, current, standard } = input;
  const slots = current.slotSelections ?? [];
  if (source.kind === 'sale-view' && isV25SaleView(source.view) &&
      !validV25PositionSlots(bundle, source, current)) return { kind: 'pending' };

  if (target.kind === 'slot') {
    if (source.kind !== 'sale-view' || !isV25SaleView(source.view)) return { kind: 'pending' };
    const slot = v25PositionSlots(source.view).find((item) => item.slot_code === target.slotCode);
    const matches = slots.filter((item) => item.slot_code === target.slotCode);
    if (!slot || matches.length !== 1) return { kind: 'pending' };
    const selected = matches[0];
    const standardSlot: SlotSelection = {
      slot_code: slot.slot_code,
      option_id: slot.standard_option_id,
      variant_choice_ids: [...slot.standard_variant_choice_ids],
    };
    const selectedProduct = bundle.options.find((option) => option.id === selected.option_id);
    const standardProduct = bundle.options.find((option) => option.id === standardSlot.option_id);
    if (!selectedProduct || selectedProduct.status !== 'published' ||
        !standardProduct || standardProduct.status !== 'published') return { kind: 'pending' };
    if (selected.option_id === standardSlot.option_id &&
        sameSet(selected.variant_choice_ids, standardSlot.variant_choice_ids)) return { kind: 'same' };
    return {
      kind: 'restored',
      plan: {
        ...current,
        slotSelections: slots.map((item) => item.slot_code === target.slotCode ? standardSlot : item),
      },
    };
  }

  if (target.kind === 'exterior-face') {
    if (!completeFaces(current.exteriorFaces) || !completeFaces(standard.exteriorFaces)) return { kind: 'pending' };
    const chosen = current.exteriorFaces.find((face) => face.face_code === target.faceCode);
    const defaultFace = standard.exteriorFaces.find((face) => face.face_code === target.faceCode);
    if (!chosen || !defaultFace) return { kind: 'pending' };
    const options = [chosen.option_id, defaultFace.option_id].map((id) => bundle.options.find((row) => row.id === id));
    if (options.some((option) => !option || option.status !== 'published')) return { kind: 'pending' };
    if (sameFace(chosen, defaultFace)) return { kind: 'same' };
    return {
      kind: 'restored',
      plan: {
        ...current,
        exteriorFaces: current.exteriorFaces.map((face) => face.face_code === target.faceCode ? defaultFace : face),
      },
    };
  }

  const category = bundle.categories.find((row) => row.id === target.categoryId);
  if (!category) return { kind: 'pending' };
  // 位置別サッシは位置ごとに照合する。カテゴリー単位で戻すと別の位置まで変更される。
  if (source.kind === 'sale-view' && isV25SaleView(source.view) &&
      v25PositionSlotCategoryIds(source.view, bundle.options).has(target.categoryId)) {
    return { kind: 'pending' };
  }

  const products = bundle.options.filter((option) => option.category_id === target.categoryId);
  const ids = new Set(products.map((option) => option.id));
  const selectedIds = current.optionIds.filter((id) => ids.has(id));
  const standardIds = standard.optionIds.filter((id) => ids.has(id));
  if ([...selectedIds, ...standardIds].some((id) => products.find((row) => row.id === id)?.status !== 'published')) {
    return { kind: 'pending' };
  }
  const groupIds = new Set(bundle.variantGroups.filter((group) => ids.has(group.option_id)).map((group) => group.id));
  const choiceIds = new Set(bundle.variantChoices.filter((choice) => groupIds.has(choice.group_id)).map((choice) => choice.id));
  const chosenChoices = current.variantChoiceIds.filter((id) => choiceIds.has(id));
  const standardChoices = standard.variantChoiceIds.filter((id) => choiceIds.has(id));

  // v2.5 では選択枠に公開した標準の商品の組み合わせが正本。
  // 誤った baseline が渡されたときは数値を表示しない。
  if (source.kind === 'sale-view' && isV25SaleView(source.view)) {
    const official = source.view.baseline.filter((item) => {
      if (item.slot_code) return false;
      const option = bundle.options.find((row) => row.id === item.option_id);
      return (item.category_id ?? option?.category_id) === target.categoryId;
    });
    if (!sameSet(standardIds, official.map((item) => item.option_id)) ||
        !sameSet(standardChoices, official.flatMap((item) => item.variant_choice_ids))) {
      return { kind: 'pending' };
    }
  }

  const isExteriorWall = category.code === 'exterior-wall';
  if (isExteriorWall &&
      ((current.exteriorFaces.length > 0 || standard.exteriorFaces.length > 0) &&
       (!completeFaces(current.exteriorFaces) || !completeFaces(standard.exteriorFaces)))) {
    return { kind: 'pending' };
  }
  const sameProducts = sameSet(selectedIds, standardIds) && sameSet(chosenChoices, standardChoices);
  const sameExterior = !isExteriorWall ||
    current.exteriorFaces.length === 0 && standard.exteriorFaces.length === 0 ||
    current.exteriorFaces.every((face) => {
      const reference = standard.exteriorFaces.find((row) => row.face_code === face.face_code);
      return reference ? sameFace(face, reference) : false;
    });
  if (sameProducts && sameExterior) return { kind: 'same' };

  return {
    kind: 'restored',
    plan: {
      ...current,
      optionIds: [...current.optionIds.filter((id) => !ids.has(id)), ...standardIds],
      variantChoiceIds: [...current.variantChoiceIds.filter((id) => !choiceIds.has(id)), ...standardChoices],
      exteriorFaces: isExteriorWall ? [...standard.exteriorFaces] : current.exteriorFaces,
    },
  };
}

type PriceOutcome =
  | { kind: 'exact'; total: number }
  | { kind: 'pending'; reason: SimulatorCardPendingReason };

function exactPrice(
  input: SimulatorCardPriceInput,
  plan: SimulatorCardPlanSelection
): PriceOutcome {
  const { bundle, source } = input;
  if (source.kind === 'v25-pending') return { kind: 'pending', reason: 'no-published-price' };

  try {
    const priced = source.kind === 'sale-view'
      ? computeSaleViewPricing(bundle, source.view, plan.optionIds, plan.variantChoiceIds,
          plan.exteriorFaces, source.unitLookup, plan.slotSelections ?? [])
      : source.kind === 'legacy-template'
        ? computeStandardEstimatePricing(bundle, source.template, plan.optionIds,
            plan.variantChoiceIds, plan.exteriorFaces, source.finishLevel)
        : null;

    if (priced?.missing_units?.length) return { kind: 'pending', reason: 'unresolved-unit' };

    const pricing = priced?.pricing ?? computePricing(
      bundle.model, bundle.options, bundle.categories,
      plan.optionIds.map((option_id) => ({ option_id, variant_choice_ids: plan.variantChoiceIds })),
      undefined,
      { groups: bundle.variantGroups, choices: bundle.variantChoices },
      source.kind === 'legacy' ? source.baseOverride : null,
      plan.exteriorFaces
    );
    // 未確定行は合計では 0 円扱いになる。税込「影響額」が確定したように見せない。
    if (pricing.has_price_on_request) return { kind: 'pending', reason: 'price-on-request' };
    if (!Number.isSafeInteger(pricing.total) || pricing.total < 0) {
      return { kind: 'pending', reason: 'invalid-amount' };
    }
    return { kind: 'exact', total: pricing.total };
  } catch {
    // 表示専用の仮計算に失敗しても、既存の見積・保存操作を巻き込まない。
    return { kind: 'pending', reason: 'calculation-failed' };
  }
}

/**
 * 同じ画面状態で使い回せる評価器。現在の総額は必要時に一度だけ計算し、
 * 対象ごとの差額もメモ化。価格計算やDBへの書き込みは行わない。
 * 選択・版・売価 lookup が変わったら評価器を作り直す。
 */
export function createSimulatorCardDeltaEvaluator(input: SimulatorCardPriceInput): {
  evaluate(target: SimulatorCardTarget): SimulatorCardDelta;
} {
  let currentPrice: PriceOutcome | undefined;
  const byTarget = new Map<string, SimulatorCardDelta>();

  return {
    evaluate(target) {
      const key = target.kind === 'category'
        ? 'category:' + target.categoryId
        : target.kind === 'slot' ? 'slot:' + target.slotCode : 'face:' + target.faceCode;
      const cached = byTarget.get(key);
      if (cached) return cached;

      const restored = restoreTarget(input, target);
      let result: SimulatorCardDelta;
      if (restored.kind === 'same') {
        result = { kind: 'standard' };
      } else if (restored.kind === 'pending') {
        result = { kind: 'pending', reason: 'incomplete-selection' };
      } else {
        currentPrice ??= exactPrice(input, input.current);
        const restoredPrice = currentPrice.kind === 'exact'
          ? exactPrice(input, restored.plan)
          : currentPrice;
        if (currentPrice.kind === 'pending') {
          result = currentPrice;
        } else if (restoredPrice.kind === 'pending') {
          result = restoredPrice;
        } else {
          const delta = currentPrice.total - restoredPrice.total;
          result = Number.isSafeInteger(delta)
            ? { kind: 'changed', deltaIncludingTax: delta }
            : { kind: 'pending', reason: 'invalid-amount' };
        }
      }
      byTarget.set(key, result);
      return result;
    },
  };
}

/** 1商品だけを調べる場合のヘルパー。多数のカードには共有評価器を使う。 */
export function simulatorCardDelta(
  input: SimulatorCardPriceInput,
  target: SimulatorCardTarget
): SimulatorCardDelta {
  return createSimulatorCardDeltaEvaluator(input).evaluate(target);
}
