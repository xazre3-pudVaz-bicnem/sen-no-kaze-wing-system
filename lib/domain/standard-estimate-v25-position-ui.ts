/**
 * 標準見積 v2.5「位置別設定」専用の編集中 UI 操作。
 * DB・保存形式・価格計算には触れない。失敗した操作は元の state を返し、行を増減させない。
 */
import { V25_SLOT_CODE_PATTERN, type V25EditorState, type V25SlotRow } from './standard-estimate-v25-view';
import { canUsePositionSlot, v25ProductReplacementIssue, type V25WorkbenchCandidate } from './standard-estimate-v25-workbench';

type CandidateOf = (optionId: string) => V25WorkbenchCandidate | undefined;
export type V25PositionResult = { state: V25EditorState; error: string | null };

/**
 * 削除済み識別子を再利用する連番は禁止。UUID v4の122bitランダム性を使う。
 * 保存形式（英小文字・数字・ハイフン／40字以下）は既存どおり。
 * 厳密な履歴上の再利用禁止にはDBの廃止コード台帳が必要だが、今回はUIのみで衝突を極小化する。
 */
export function nextV25PositionCode(
  rows: ReadonlyArray<Pick<V25SlotRow, 'slot_code'>>,
  makeUuid: () => string = () => globalThis.crypto.randomUUID()
): string {
  const taken = new Set(rows.map((row) => row.slot_code.trim()).filter(Boolean));
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `p-${makeUuid().replace(/-/g, '').toLowerCase()}`;
    if (V25_SLOT_CODE_PATTERN.test(code) && !taken.has(code)) return code;
  }
  throw new Error('新しい位置の識別子を発行できませんでした');
}

export function v25ValidPositionAlternatives(
  ids: readonly string[],
  standard: V25WorkbenchCandidate,
  candidateOf: CandidateOf
): string | null {
  if (ids.length > 50) return '変更候補は50件までです';
  if (new Set(ids).size !== ids.length) return '変更候補が重複しています';
  for (const id of ids) {
    const candidate = candidateOf(id);
    if (id === standard.id || !candidate || candidate.retired || candidate.unavailable || candidate.categoryId !== standard.categoryId) {
      return '変更候補は同じカテゴリーの販売中・選択可能な商品から選んでください';
    }
  }
  return null;
}

function labelProblem(
  slots: V25EditorState['slots'],
  rowKey: string,
  label: string,
  candidate: V25WorkbenchCandidate,
  candidateOf: CandidateOf
): string | null {
  if (!label) return 'お客様に表示する位置名を入力してください';
  if (label.length > 40) return '位置名は40文字までです';
  if (slots.some((slot) => slot.key !== rowKey && slot.slot_label.trim() === label &&
    candidateOf(slot.option_id)?.categoryId === candidate.categoryId)) {
    return `同じカテゴリーに「${label}」という位置名があります。別の名前にしてください`;
  }
  return null;
}

/** 既存の位置コード・行ID・商品・仕様・数量・価格指定を保持して設定する。 */
export function updateV25Position(
  state: V25EditorState,
  key: string,
  labelInput: string,
  selectableIds: readonly string[],
  candidateOf: CandidateOf
): V25PositionResult {
  const source = state.slots.find((slot) => slot.key === key);
  const candidate = source && candidateOf(source.option_id);
  if (!source || !candidate || candidate.unavailable || !canUsePositionSlot(candidate.categoryCode)) {
    return { state, error: 'この商品行には位置を設定できません' };
  }
  const label = labelInput.trim();
  const problem = labelProblem(state.slots, key, label, candidate, candidateOf) ??
    v25ValidPositionAlternatives(selectableIds, candidate, candidateOf);
  if (problem) return { state, error: problem };
  if (!source.slot_code.trim() && Number(source.quantity) !== 1) {
    return { state, error: '新しく位置を付けるには数量1が必要です。数量は自動変更されません' };
  }
  const code = source.slot_code.trim() || nextV25PositionCode(state.slots);
  return { state: { ...state, slots: state.slots.map((slot) =>
    slot.key === key ? { ...slot, slot_code: code, slot_label: label, selectable_option_ids: [...selectableIds] } : slot) }, error: null };
}

/** 既存の位置名だけを変更。候補の販売状態を再判定せず、識別子・商品・金額条件を保持する。 */
export function renameV25Position(
  state: V25EditorState,
  key: string,
  labelInput: string,
  candidateOf: CandidateOf
): V25PositionResult {
  const source = state.slots.find((slot) => slot.key === key);
  const candidate = source && candidateOf(source.option_id);
  if (!source || !source.slot_code.trim() || !candidate) {
    return { state, error: '位置設定済みの商品行を選んでください' };
  }
  const label = labelInput.trim();
  const problem = labelProblem(state.slots, key, label, candidate, candidateOf);
  if (problem) return { state, error: problem };
  if (label === source.slot_label) return { state, error: null };
  return {
    state: {
      ...state,
      slots: state.slots.map((slot) => slot.key === key ? { ...slot, slot_label: label } : slot),
    },
    error: null,
  };
}

/** 日本語IMEの確定Enter／直後のEnterは明細確定にもExcelのセル移動にも使わない。 */
export function v25PositionNameKeyAction(
  key: string,
  isComposing: boolean,
  justComposed: boolean,
  keyCode?: number
): 'commit' | 'cancel' | null {
  if (isComposing || justComposed || keyCode === 229) return null;
  if (key === 'Enter') return 'commit';
  if (key === 'Escape') return 'cancel';
  return null;
}

/** 明示的な解除操作でのみ位置と候補を外し、商品・単価・行は保持する。 */
export function clearV25Position(state: V25EditorState, key: string): V25PositionResult {
  const source = state.slots.find((slot) => slot.key === key);
  if (!source || !source.slot_code.trim()) return { state, error: '解除できる位置設定がありません' };
  return {
    state: {
      ...state,
      slots: state.slots.map((slot) => slot.key === key
        ? { ...slot, slot_code: '', slot_label: '', selectable_option_ids: [] }
        : slot),
    },
    error: null,
  };
}

/** 位置名が確定するまで行を作らない。新行の既存行ID・原価固定を使い回さない。 */
export function addV25PositionRow(
  state: V25EditorState,
  sourceKey: string,
  newKey: string,
  labelInput: string,
  selectableIds: readonly string[],
  candidateOf: CandidateOf
): V25PositionResult {
  const index = state.slots.findIndex((slot) => slot.key === sourceKey);
  const source = state.slots[index];
  const candidate = source && candidateOf(source.option_id);
  if (!source || !source.slot_code.trim() || !candidate || candidate.unavailable || !canUsePositionSlot(candidate.categoryCode)) {
    return { state, error: '位置が設定済みの商品行から追加してください' };
  }
  if (state.slots.length >= 200) return { state, error: '商品は200件までです' };
  if (state.slots.some((slot) => slot.key === newKey)) return { state, error: '追加する行IDが重複しています' };
  const label = labelInput.trim();
  const problem = labelProblem(state.slots, '', label, candidate, candidateOf) ??
    (selectableIds.some((id) => !source.selectable_option_ids.includes(id)) ? '引き継ぐ変更候補は元の行の候補から選んでください' : null) ??
    v25ValidPositionAlternatives(selectableIds, candidate, candidateOf);
  if (problem) return { state, error: problem };
  const duplicate: V25SlotRow = {
    ...source, key: newKey, baseline_key: null,
    variant_choices: { ...source.variant_choices }, quantity: '1',
    slot_code: nextV25PositionCode(state.slots),
    slot_label: label,
    selectable_option_ids: [...selectableIds],
  };
  const slots = [...state.slots];
  slots.splice(index + 1, 0, duplicate);
  return { state: { ...state, slots }, error: null };
}

/** 標準品入替を候補の見直しと同時に確定。位置・永続行IDは維持する。 */
export function replaceV25PositionStandard(
  state: V25EditorState,
  key: string,
  standard: V25WorkbenchCandidate,
  choices: Record<string, string>,
  selectableIds: readonly string[],
  candidateOf: CandidateOf
): V25PositionResult {
  const source = state.slots.find((slot) => slot.key === key);
  const previous = source && candidateOf(source.option_id);
  if (!source || !source.slot_code.trim() || !previous || standard.retired || standard.unavailable ||
    standard.categoryId !== previous.categoryId) return { state, error: '同じ位置での標準品入替は同じカテゴリーの商品に限ります' };
  // 同一商品の仕様（色・サイズ等）変更は標準品入替ではない。候補を一切変更しない。
  if (standard.id === source.option_id) {
    return {
      state: {
        ...state,
        slots: state.slots.map((slot) => slot.key === key
          ? { ...slot, variant_choices: { ...choices } }
          : slot),
      },
      error: null,
    };
  }
  const problem = v25ProductReplacementIssue(
    source, previous, standard, state.slots, candidateOf,
    (categoryId) => [previous, standard, ...selectableIds.map(candidateOf).filter((item): item is V25WorkbenchCandidate => Boolean(item))]
      .filter((item) => item.categoryId === categoryId)
  ) ?? v25ValidPositionAlternatives(selectableIds, standard, candidateOf);
  if (problem) return { state, error: problem };
  return { state: { ...state, slots: state.slots.map((slot) => slot.key === key
    ? {
        ...slot, option_id: standard.id, variant_choices: { ...choices },
        selectable_option_ids: [...selectableIds],
        ...(standard.section === 'sitework' ? { price_mode: 'por' as const } : {}),
      }
    : slot) }, error: null };
}

export interface V25PositionMix {
  categoryId: string;
  categoryName: string;
  total: number;
  unsetKeys: string[];
}

/** 同一カテゴリーに位置あり・位置なしが混在する場合だけ未設定行を案内する。 */
export function v25PositionMixes(slots: V25EditorState['slots'], candidateOf: CandidateOf): V25PositionMix[] {
  const groups = new Map<string, { name: string; total: number; hasPosition: boolean; unsetKeys: string[] }>();
  for (const slot of slots) {
    const candidate = candidateOf(slot.option_id);
    if (!candidate || !canUsePositionSlot(candidate.categoryCode)) continue;
    const group = groups.get(candidate.categoryId) ?? { name: candidate.categoryName, total: 0, hasPosition: false, unsetKeys: [] };
    group.total += 1;
    if (slot.slot_code.trim()) group.hasPosition = true;
    else group.unsetKeys.push(slot.key);
    groups.set(candidate.categoryId, group);
  }
  return [...groups].filter(([, value]) => value.hasPosition && value.unsetKeys.length > 0)
    .map(([categoryId, value]) => ({
      categoryId, categoryName: value.name, total: value.total, unsetKeys: value.unsetKeys,
    }));
}
