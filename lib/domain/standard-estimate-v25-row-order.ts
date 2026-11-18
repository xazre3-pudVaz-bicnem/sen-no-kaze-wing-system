import { v25RowOrderRefs } from './standard-estimate-v25-row-persistence';
import type { StandardLineSectionCode } from './standard-estimate-view';
import type { V25EditorState } from './standard-estimate-v25-view';

/** 商品行と手入力の混在表示参照。DBへは既存の row_order として保存する。 */
export type V25MixedRowRef = {
  kind: 'slot' | 'line';
  key: string;
  section: StandardLineSectionCode;
};

export const V25_MIXED_SECTIONS: readonly StandardLineSectionCode[] = ['interior_exterior', 'option', 'sitework'];

export const v25MixedRowIdentity = (row: Pick<V25MixedRowRef, 'kind' | 'key'>) =>
  `${row.kind}:${row.key}`;

/** DBの順序契約が決まるまでは、既存画面の「商品→手入力」の順を初期値とする。 */
export function v25DefaultMixedRowOrder(
  state: Pick<V25EditorState, 'slots' | 'lines'>,
  sectionOf: (optionId: string) => StandardLineSectionCode | undefined,
): V25MixedRowRef[] {
  return V25_MIXED_SECTIONS.flatMap((section) => [
    ...state.slots
      .filter((slot) => sectionOf(slot.option_id) === section)
      .map((slot): V25MixedRowRef => ({ kind: 'slot', key: slot.key, section })),
    ...state.lines
      .filter((line) => line.section_code === section)
      .map((line): V25MixedRowRef => ({ kind: 'line', key: line.key, section })),
  ]);
}

/**
 * 削除・商品差し替え・新規追加があっても残存する行の相対順を維持する。
 * 区分は商品台帳/明細の現在の値から再取得し、過去の参照で別区分へ動かさない。
 * 既存順にない行は該当区分末尾へ追加する。純粋関数で副作用はない。
 */
export function v25ReconcileMixedRowOrder(
  savedViewOrder: readonly V25MixedRowRef[],
  state: Pick<V25EditorState, 'slots' | 'lines'>,
  sectionOf: (optionId: string) => StandardLineSectionCode | undefined,
): V25MixedRowRef[] {
  const defaults = v25DefaultMixedRowOrder(state, sectionOf);
  const actual = new Map(defaults.map((row) => [v25MixedRowIdentity(row), row]));
  const kept: V25MixedRowRef[] = [];
  for (const row of savedViewOrder) {
    const key = v25MixedRowIdentity(row);
    const current = actual.get(key);
    if (!current) continue;
    kept.push(current);
    actual.delete(key);
  }
  return V25_MIXED_SECTIONS.flatMap((section) => [
    ...kept.filter((row) => row.section === section),
    ...[...actual.values()].filter((row) => row.section === section),
  ]);
}

/** 1行ずつ上下移動。区分境界での操作は無変更とする。 */
export function v25MoveMixedRow(
  order: readonly V25MixedRowRef[], row: Pick<V25MixedRowRef, 'kind' | 'key'>,
  direction: -1 | 1,
): V25MixedRowRef[] {
  const index = order.findIndex((item) => v25MixedRowIdentity(item) === v25MixedRowIdentity(row));
  const other = index + direction;
  if (index < 0 || other < 0 || other >= order.length || order[index].section !== order[other].section) {
    return [...order];
  }
  const moved = [...order];
  [moved[index], moved[other]] = [moved[other], moved[index]];
  return moved;
}

/** 同一区分の行の直下へ、種別を問わず挿入する。起点がないときは区分末尾。 */
export function v25InsertMixedRow(
  order: readonly V25MixedRowRef[], row: V25MixedRowRef, after: V25MixedRowRef | null = null,
): V25MixedRowRef[] {
  if (!V25_MIXED_SECTIONS.includes(row.section) ||
      order.some((existing) => v25MixedRowIdentity(existing) === v25MixedRowIdentity(row))) return [...order];
  const anchor = after && after.section === row.section
    ? order.findIndex((item) => item.section === row.section && v25MixedRowIdentity(item) === v25MixedRowIdentity(after))
    : -1;
  const lastSectionRow = order.reduce((last, item, index) => item.section === row.section ? index : last, -1);
  const sectionAfter = V25_MIXED_SECTIONS.findIndex((section) => section === row.section);
  const firstLaterSection = order.findIndex((item) => V25_MIXED_SECTIONS.indexOf(item.section) > sectionAfter);
  const index = anchor >= 0 ? anchor + 1 : lastSectionRow >= 0 ? lastSectionRow + 1
    : firstLaterSection >= 0 ? firstLaterSection : order.length;
  const next = [...order];
  next.splice(index, 0, row);
  return next;
}

export function v25MixedOrderEquals(a: readonly V25MixedRowRef[], b: readonly V25MixedRowRef[]): boolean {
  return a.length === b.length && a.every((row, index) =>
    v25MixedRowIdentity(row) === v25MixedRowIdentity(b[index]) && row.section === b[index].section);
}

/** #686 の保存済み display_order を読み込んで、区分内の混在順へ復元する。 */
export function v25PersistedMixedRowOrder(
  state: Pick<V25EditorState, 'slots' | 'lines'>,
  sectionOf: (optionId: string) => StandardLineSectionCode | undefined,
): V25MixedRowRef[] {
  return v25ReconcileMixedRowOrder(
    v25RowOrderRefs(state).map((ref): V25MixedRowRef => ({ ...ref, section: 'option' })), state, sectionOf
  );
}

/** #687の工事項目を保ち、商品と自由入力を1つの順序で描画する。 */
export function v25MixedRowsForWorkGroup(
  order: readonly V25MixedRowRef[],
  group: { slots: readonly { key: string }[]; lines: readonly { key: string }[] },
): V25MixedRowRef[] {
  const keys = new Set([
    ...group.slots.map((row) => 'slot:' + row.key),
    ...group.lines.map((row) => 'line:' + row.key),
  ]);
  return order.filter((row) => keys.has(v25MixedRowIdentity(row)));
}

/** 工事項目をまたがず、商品と自由入力が隣接する場合も↑↓で1行ずつ交換する。 */
export function v25MoveMixedRowWithinGroup(
  order: readonly V25MixedRowRef[],
  group: { slots: readonly { key: string }[]; lines: readonly { key: string }[] },
  row: Pick<V25MixedRowRef, 'kind' | 'key'>,
  direction: -1 | 1,
): V25MixedRowRef[] {
  const groupRows = v25MixedRowsForWorkGroup(order, group);
  const index = groupRows.findIndex((item) => v25MixedRowIdentity(item) === v25MixedRowIdentity(row));
  const other = groupRows[index + direction];
  if (index < 0 || !other || groupRows[index].section !== other.section) return [...order];
  const moved = [...order];
  const a = moved.findIndex((item) => v25MixedRowIdentity(item) === v25MixedRowIdentity(row));
  const b = moved.findIndex((item) => v25MixedRowIdentity(item) === v25MixedRowIdentity(other));
  if (a < 0 || b < 0) return moved;
  [moved[a], moved[b]] = [moved[b], moved[a]];
  return moved;
}
