/**
 * 旧明細 1 行 → 商品台帳の商品 1 件の、確認画面専用の置換案。
 * DB・RPC・金額計算は変更しない。確定時にこの plan の state を一度に反映する。
 * 保存済みの置換履歴を新設しないため、事前の実 DB 検証が完了するまでは本番適用しない。
 */
import type { V25EditorState, V25LineRow, V25SlotRow } from '@/lib/domain/standard-estimate-v25-view';
import { validateV25EditorState } from '@/lib/domain/standard-estimate-v25-view';
import {
  canUsePositionSlot,
  standardSlotQuantity,
  v25SlotRuleIssues,
  type V25WorkbenchCandidate,
  type V25WorkbenchCosts,
} from '@/lib/domain/standard-estimate-v25-workbench';

export type LegacyLineReplacementPlan =
  | { ok: true; state: V25EditorState; oldLine: V25LineRow; newSlot: V25SlotRow }
  | { ok: false; error: string };

/**
 * 確認済みの旧明細だけを対象とする。旧明細の数量・単位・備考・手動単価は
 * 商品の選択枠へ自動転記できないため、候補商品の標準仕様・標準原価で再計算する。
 * 単位が変わることを UI で必ず明示し、明示同意するまでは plan を state に反映しない。
 * 旧明細には商品カテゴリーIDがないため自動推測せず、操作担当者の選択したカテゴリーIDと照合する。
 * 位置別であれば既存のslot_code / slot_labelを指定し、DBと同じ混在・重複ルールを検証する。
 */
export function planLegacyLineReplacement(
  state: V25EditorState,
  lineKey: string,
  candidate: V25WorkbenchCandidate,
  candidates: V25WorkbenchCandidate[],
  costs: V25WorkbenchCosts,
  confirmedCategoryId: string,
  newSlotKey: string,
  position?: Pick<V25SlotRow, 'slot_code' | 'slot_label'>
): LegacyLineReplacementPlan {
  const oldLine = state.lines.find((line) => line.key === lineKey);
  if (!oldLine) return { ok: false, error: '置換元の明細が見つかりません。画面を再確認してください' };
  if (!oldLine.review_required || !oldLine.line_key) return { ok: false, error: '置換できるのは保存済みの「要見直し」旧明細だけです' };
  // 別途工事のカタログ登録・保存形式は別工程。直接入力の工事明細を無断で商品行へ移さない。
  if (oldLine.section_code === 'sitework') return { ok: false, error: '別途工事の旧明細は今回の置換対象外です' };
  if (!confirmedCategoryId) return { ok: false, error: '旧明細に対応する商品カテゴリーを選択してください' };
  if (candidate.categoryId !== confirmedCategoryId) return { ok: false, error: '確認したカテゴリーと選択商品のカテゴリーが一致しません' };
  if (candidate.section !== oldLine.section_code) return { ok: false, error: '元の明細と商品の区分が異なります' };
  if (candidate.retired || candidate.unavailable) return { ok: false, error: '販売停止・この仕様で選べない商品には置換できません' };
  if (state.slots.length >= 200) return { ok: false, error: '商品の選択枠は200件までです' };
  if (state.slots.some((slot) => slot.key === newSlotKey)) return { ok: false, error: '置換後の行識別子が重複しています' };
  // カテゴリー単位の枠と位置別の枠は混在不可。同一商品でも位置識別子が異なれば別枠を許可する。
  const slotCode = position?.slot_code.trim() ?? '';
  const slotLabel = position?.slot_label.trim() ?? '';
  if (position && (!slotCode || !slotLabel)) {
    return { ok: false, error: '位置・用途別で置換するには識別子と名前を両方入力してください' };
  }
  if (slotCode && !canUsePositionSlot(candidate.categoryCode)) {
    return { ok: false, error: '外壁・防火仕様には位置・用途の枠を作れません' };
  }
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const categorySlots = state.slots.filter((slot) => byId.get(slot.option_id)?.categoryId === candidate.categoryId);
  if (categorySlots.some((slot) => Boolean(slot.slot_code.trim())) && !slotCode) {
    return { ok: false, error: 'このカテゴリーは位置・用途別の選択枠を使用中です。置換先の位置を指定してください' };
  }
  if (categorySlots.some((slot) => !slot.slot_code.trim()) && slotCode) {
    return { ok: false, error: 'このカテゴリーはカテゴリー単位の選択枠を使用中です。位置別と混在できません' };
  }
  if (state.slots.some((slot) => slot.option_id === candidate.id && slot.slot_code.trim() === slotCode)) {
    return { ok: false, error: '同じ商品・同じ位置の選択枠は重複登録できません' };
  }
  if (slotCode && categorySlots.some((slot) => slot.slot_label.trim() === slotLabel)) {
    return { ok: false, error: 'このカテゴリーには同じ位置・用途名の選択枠があります' };
  }

  const variantChoices: Record<string, string> = {};
  for (const group of candidate.variantGroups) {
    const choiceId = candidate.defaultChoices[group.id];
    if (!choiceId || !group.choices.some((choice) => choice.id === choiceId)) {
      return { ok: false, error: `「${group.name}」の標準仕様が未設定です。商品台帳を確認してください` };
    }
    variantChoices[group.id] = choiceId;
  }
  // 新しい商品の自動単価は、今の原価 Version と選択肢の原価調整額 Version が両方必要。
  // version が無い場合に旧行を消すと、売価が失われるためこの段階で停止する。
  if (costs.currentProduct[candidate.id] === null || costs.currentProduct[candidate.id] === undefined) {
    return { ok: false, error: '商品の最新原価Versionがありません。商品台帳側で確認してください' };
  }
  for (const choiceId of Object.values(variantChoices)) {
    if (costs.currentChoice[choiceId] === null || costs.currentChoice[choiceId] === undefined) {
      return { ok: false, error: '標準仕様の原価差額Versionがありません。商品台帳側で確認してください' };
    }
  }

  const newSlot: V25SlotRow = {
    key: newSlotKey,
    baseline_key: null,
    option_id: candidate.id,
    variant_choices: variantChoices,
    quantity: String(standardSlotQuantity(candidate.categoryCode)),
    price_mode: 'auto',
    manual_unit_price: '',
    slot_code: slotCode,
    slot_label: slotLabel,
    selectable_option_ids: [],
  };
  const next: V25EditorState = {
    ...state,
    slots: [...state.slots, newSlot],
    lines: state.lines.filter((line) => line.key !== lineKey),
  };
  const issues = v25SlotRuleIssues(next.slots, (id) => byId.get(id));
  if (issues.length > 0) return { ok: false, error: issues[0] };
  const validation = validateV25EditorState(next, (id) => byId.get(id)?.section);
  if (validation) return { ok: false, error: validation };

  return { ok: true, oldLine, newSlot, state: next };
}
