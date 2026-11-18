/**
 * 標準見積 v2.5：商品行と手入力明細の並び順の保存・読み込み（2026-11-16 の先方の依頼。DB の display_order）。
 *
 * 取り決め（画面 ⇔ 保存 RPC）
 * - 保存：`slots[i].row_order`・`lines[j].row_order` に、版の中で商品と手入力を通した 1 始まりの番号を全行に付ける
 *   （全行に付けるか全部省略。重なりなし。1〜100000）。`slots[i].work_item` は工事項目のラベル（未設定は null）。
 *   手入力明細の工事項目は今までどおり `group_label`
 * - 読み込み：初期状態の `slots[i].row_order`・`lines[j].row_order`（number | null。保存前の下書きは null）と
 *   `slots[i].work_item`（文字列。未設定は ''）
 *
 * 並びの配列 `{ kind, key }` は、先方の PR #666 の表示順の参照（V25MixedRowRef）と同じ形（section は無くてよい）。
 */
import type { V25EditorState } from './standard-estimate-v25-view';

export type V25RowRef = { kind: 'slot' | 'line'; key: string };

const identity = (ref: V25RowRef) => `${ref.kind}:${ref.key}`;

/**
 * 保存済みの並び（row_order）の順の行の参照。row_order のある行をその順に、無い行（保存前の下書き・新しい行）を
 * その後ろに「商品→手入力」の配列の順で並べる（保存前の下書きは今までどおり「商品→手入力」）。
 * 区分は見ない（読む側は区分ごとに並べるので、区分の中の前後だけが意味を持つ）
 */
export function v25RowOrderRefs(state: Pick<V25EditorState, 'slots' | 'lines'>): V25RowRef[] {
  const rows = [
    ...state.slots.map((slot, index) => ({ ref: { kind: 'slot' as const, key: slot.key }, order: slot.row_order ?? null, rank: 0, index })),
    ...state.lines.map((line, index) => ({ ref: { kind: 'line' as const, key: line.key }, order: line.row_order ?? null, rank: 1, index })),
  ];
  const ordered = rows
    .filter((row) => typeof row.order === 'number' && Number.isFinite(row.order))
    .sort((a, b) => (a.order as number) - (b.order as number) || a.rank - b.rank || a.index - b.index);
  const rest = rows.filter((row) => !(typeof row.order === 'number' && Number.isFinite(row.order)));
  return [...ordered, ...rest].map((row) => row.ref);
}

/**
 * 並びの配列のとおりに row_order を 1 から付け直す。配列に無い行は、保存済みの並びの順でその後ろに付ける。
 * 配列にある、もう無い行の参照は読み飛ばす。値（数量・単価など）は変えない
 */
export function v25WithRowOrder<T extends Pick<V25EditorState, 'slots' | 'lines'>>(state: T, refs: readonly V25RowRef[]): T {
  const exists = new Set([...state.slots.map((slot) => `slot:${slot.key}`), ...state.lines.map((line) => `line:${line.key}`)]);
  const seen = new Set<string>();
  const sequence: string[] = [];
  for (const ref of [...refs, ...v25RowOrderRefs(state)]) {
    const id = identity(ref);
    if (!exists.has(id) || seen.has(id)) continue;
    seen.add(id);
    sequence.push(id);
  }
  const orderOf = new Map(sequence.map((id, index) => [id, index + 1]));
  return {
    ...state,
    slots: state.slots.map((slot) => ({ ...slot, row_order: orderOf.get(`slot:${slot.key}`) ?? null })),
    lines: state.lines.map((line) => ({ ...line, row_order: orderOf.get(`line:${line.key}`) ?? null })),
  };
}
