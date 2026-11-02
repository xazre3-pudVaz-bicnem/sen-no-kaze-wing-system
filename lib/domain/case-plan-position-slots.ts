/**
 * 案件の画面のプランボード（本部・担当の代理店）の、位置・用途の選択枠ごとのタイル（v2.5 PR-S2b）。
 * 見積に固定した標準見積の版の位置の枠（get_case_plan_configuration の position_slots）と、保存したプランの位置の明細から作る。
 * 表示だけ（金額は出さない。見積書の明細・合計は見積の版のまま）。
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

export function casePlanSlotTiles(
  slots: readonly CasePlanPositionSlot[],
  items: readonly CasePlanSlotItem[],
  context: {
    options: readonly ProductOption[];
    variantGroups: OptionVariantGroup[];
    variantChoices: OptionVariantChoice[];
    /** 注文範囲の内のカテゴリーか（範囲の外の位置は出さない） */
    inScope: (categoryId: string) => boolean;
  }
): CasePlanSlotTile[] {
  const optionById = new Map(context.options.map((option) => [option.id, option] as const));
  const choiceName = new Map(context.variantChoices.map((choice) => [choice.id, choice.name] as const));
  return slots.flatMap((slot): CasePlanSlotTile[] => {
    const categoryId = slot.category_id ?? optionById.get(slot.standard_option_id)?.category_id ?? '';
    if (!categoryId || !context.inScope(categoryId)) return [];
    const standard = standardSlotSelection(slot, context.variantGroups, context.variantChoices);
    const item = items.find((row) => row.slot_code === slot.slot_code);
    // 位置の明細が無い（位置の枠ができる前の保存など）ときは、版の標準を出す（シミュレーターと同じ）
    const selection = item ? { option_id: item.option_id, variant_choice_ids: item.variant_choice_ids ?? [] } : standard;
    return [
      {
        slotCode: slot.slot_code,
        categoryId,
        label: slot.slot_label,
        option: optionById.get(selection.option_id) ?? null,
        variantNames: selection.variant_choice_ids
          .map((id) => choiceName.get(id))
          .filter((name): name is string => Boolean(name)),
        state: sameSlotSelection(selection, standard) ? 'standard' : 'changed',
        deltaLabel: null,
      },
    ];
  });
}
