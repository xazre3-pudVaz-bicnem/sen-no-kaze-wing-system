/**
 * 案件の画面のプランボード（本部・担当の代理店）の、位置・用途の選択枠ごとのタイル（v2.5 PR-S2b）。
 * 見積に固定した標準見積の版の位置の枠（get_case_plan_configuration の position_slots）と、保存したプランの位置の明細から作る。
 * 表示だけ（金額は出さない。見積書の明細・合計は見積の版のまま）。保存したデータをそのまま見せる（シミュレーターのように直さない）：
 *   - 位置の明細が 1 つも無いカテゴリー（位置の枠ができる前の保存など）は、位置のタイルにせず、カテゴリー単位の明細をそのまま出す
 *   - 版の位置の枠に合わない位置の明細は、カテゴリー単位の明細として出す（消さない）
 *   - 標準との比較は、今のカタログにある選択肢だけで行う（版の標準と同じく。非公開になった選択肢で「変更済」にしない）
 */
import { sameSlotSelection, standardSlotSelection } from './simulator-position-slots';
import type { V25PositionSlot } from './standard-estimate-sale-view';
import type { OptionVariantChoice, OptionVariantGroup, ProductOption } from './types';

/** 見積に固定した版の位置の枠（選べる商品は返さない） */
export type CasePlanPositionSlot = Omit<V25PositionSlot, 'selectable_option_ids'>;

/** 保存したプランの明細（位置の明細は slot_code を持つ） */
export interface CasePlanSlotItem {
  option_id: string;
  variant_choice_ids?: string[] | null;
  slot_code?: string | null;
}

/** 設備の一覧の位置ごとのタイル（EquipmentBoard の slotTiles と同じ形） */
export interface CasePlanSlotTile {
  slotCode: string;
  categoryId: string;
  label: string;
  option: ProductOption | null;
  variantNames: string[];
  state: 'standard' | 'changed';
  deltaLabel: null;
}

export interface CasePlanSlotView<T extends CasePlanSlotItem> {
  /** 位置ごとのタイル（版の位置の枠の順） */
  tiles: CasePlanSlotTile[];
  /** 位置ごとのタイルにしたカテゴリー（カテゴリー単位の選択・標準との比較から外す） */
  positionCategoryIds: Set<string>;
  /** カテゴリー単位で出す明細（位置のタイルに使わなかった明細） */
  categoryItems: T[];
  /** 位置のタイルがすべて標準のままか（タイルが無ければ true） */
  slotsAtStandard: boolean;
}

export function casePlanSlotView<T extends CasePlanSlotItem>(
  slots: readonly CasePlanPositionSlot[],
  items: readonly T[],
  context: {
    options: readonly ProductOption[];
    variantGroups: OptionVariantGroup[];
    variantChoices: OptionVariantChoice[];
    /** 注文範囲の内のカテゴリーか（範囲の外の位置は出さない） */
    inScope: (categoryId: string) => boolean;
  }
): CasePlanSlotView<T> {
  const optionById = new Map(context.options.map((option) => [option.id, option] as const));
  const choiceName = new Map(context.variantChoices.map((choice) => [choice.id, choice.name] as const));
  // 今のカタログにある、その商品の選択肢（版の標準の選択肢も同じ決まりで絞る：standardSlotSelection）
  const publishedChoiceIds = (optionId: string) => {
    const groupIds = new Set(context.variantGroups.filter((group) => group.option_id === optionId).map((group) => group.id));
    return new Set(context.variantChoices.filter((choice) => groupIds.has(choice.group_id)).map((choice) => choice.id));
  };
  const scopedSlots = slots.flatMap((slot) => {
    const categoryId = slot.category_id ?? optionById.get(slot.standard_option_id)?.category_id ?? '';
    return categoryId && context.inScope(categoryId) ? [{ slot, categoryId }] : [];
  });
  const positionCategoryIds = new Set(
    scopedSlots.filter(({ slot }) => items.some((item) => item.slot_code === slot.slot_code)).map(({ categoryId }) => categoryId)
  );
  const tileSlots = scopedSlots.filter(({ categoryId }) => positionCategoryIds.has(categoryId));
  const tileSlotCodes = new Set(tileSlots.map(({ slot }) => slot.slot_code));
  const tiles = tileSlots.map(({ slot, categoryId }): CasePlanSlotTile => {
    const standard = standardSlotSelection(slot, context.variantGroups, context.variantChoices);
    const item = items.find((row) => row.slot_code === slot.slot_code);
    // 位置の明細が無い位置（同じカテゴリーのほかの位置にはある）は、版の標準を出す（シミュレーターと同じ）
    const selection = item ? { option_id: item.option_id, variant_choice_ids: item.variant_choice_ids ?? [] } : standard;
    const published = publishedChoiceIds(selection.option_id);
    const current = { option_id: selection.option_id, variant_choice_ids: selection.variant_choice_ids.filter((id) => published.has(id)) };
    return {
      slotCode: slot.slot_code,
      categoryId,
      label: slot.slot_label,
      option: optionById.get(selection.option_id) ?? null,
      variantNames: current.variant_choice_ids.map((id) => choiceName.get(id)).filter((name): name is string => Boolean(name)),
      state: sameSlotSelection(current, standard) ? 'standard' : 'changed',
      deltaLabel: null,
    };
  });
  return {
    tiles,
    positionCategoryIds,
    categoryItems: items.filter((item) => !(item.slot_code && tileSlotCodes.has(item.slot_code))),
    slotsAtStandard: tiles.every((tile) => tile.state === 'standard'),
  };
}
