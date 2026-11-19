import type { V25EditorState } from '@/lib/domain/standard-estimate-v25-view';
import type { V25MixedRowRef } from '@/lib/domain/standard-estimate-v25-row-order';
import {
  v25MixedOrderEquals, v25MixedRowIdentity, v25MixedRowsForWorkGroup,
} from '@/lib/domain/standard-estimate-v25-row-order';
import { v25WorkItemForManual, type V25WorkItemContext } from './standard-estimate-v25-work-groups';

export type V25MoveSide = 'before' | 'after';
export type V25MoveGroup = {
  key: string;
  label: string;
  slots: readonly { key: string }[];
  lines: readonly { key: string }[];
};
export type V25MoveTarget = { row: V25MixedRowRef; side: V25MoveSide };
type MoveContext = V25WorkItemContext & {
  sectionOf: (optionId: string) => V25MixedRowRef['section'] | undefined;
};

const contains = (group: V25MoveGroup, row: V25MixedRowRef) =>
  group.slots.some((item) => row.kind === 'slot' && item.key === row.key) ||
  group.lines.some((item) => row.kind === 'line' && item.key === row.key);

const findGroup = (groups: readonly V25MoveGroup[], row: V25MixedRowRef) =>
  groups.find((group) => contains(group, row));

/**
 * 工事項目の移動先が一意に分かる場合だけ書き換える。
 * 「未設定の手入力」や「未分類の商品」に空の文字列を保存すると
 * 自動分類で別の見出しに戻るため、そこへの境界越えは許可しない。
 */
export function v25MoveDestinationLabel(group: V25MoveGroup, context: V25WorkItemContext): string | null {
  const label = group.label.trim();
  if (!label || label.length > 120 ||
      group.key === 'manual:empty' || group.key === 'products:unclassified') return null;
  const resolved = v25WorkItemForManual(label, context);
  return resolved.key === group.key ? label : null;
}

/** 同じ大区分の表示済みの隣接工事項目だけに移動する。 */
export function v25ArrowRowTarget(
  order: readonly V25MixedRowRef[], groups: readonly V25MoveGroup[],
  source: V25MixedRowRef, direction: -1 | 1,
): V25MoveTarget | null {
  const groupIndex = groups.findIndex((group) => contains(group, source));
  if (groupIndex < 0) return null;
  const rows = v25MixedRowsForWorkGroup(order, groups[groupIndex]);
  const index = rows.findIndex((row) => v25MixedRowIdentity(row) === v25MixedRowIdentity(source));
  if (index < 0) return null;
  const adjacent = rows[index + direction];
  if (adjacent) return { row: adjacent, side: direction < 0 ? 'before' : 'after' };
  const nextGroup = groups[groupIndex + direction];
  if (!nextGroup) return null;
  const nextRows = v25MixedRowsForWorkGroup(order, nextGroup);
  const target = direction < 0 ? nextRows[nextRows.length - 1] : nextRows[0];
  return target ? { row: target, side: direction < 0 ? 'after' : 'before' } : null;
}

/**
 * ↓↑／ドラッグ共通：画面の一行移動を原子的に計画する純粋関数。
 * 大区分を越えず、商品・自由入力の同一IDや存在しない移動先は拒否。
 * 工事項目を越えた場合だけ work_item / group_label を変更し、
 * 数量・価格・位置・原価Version・元配列の並びはそのまま維持する。
 */
export function v25PlanMixedRowMove(
  state: V25EditorState, order: readonly V25MixedRowRef[], groups: readonly V25MoveGroup[],
  source: V25MixedRowRef, target: V25MixedRowRef, side: V25MoveSide, context: MoveContext,
): { state: V25EditorState; order: V25MixedRowRef[] } | null {
  if (side !== 'before' && side !== 'after') return null;
  if (source.section !== target.section || source.section !== context.sectionCode ||
      v25MixedRowIdentity(source) === v25MixedRowIdentity(target)) return null;
  const fromGroup = findGroup(groups, source);
  const toGroup = findGroup(groups, target);
  if (!fromGroup || !toGroup) return null;

  const actualSource = source.kind === 'slot'
    ? state.slots.find((row) => row.key === source.key && context.sectionOf(row.option_id) === source.section)
    : state.lines.find((row) => row.key === source.key && row.section_code === source.section);
  const actualTarget = target.kind === 'slot'
    ? state.slots.find((row) => row.key === target.key && context.sectionOf(row.option_id) === target.section)
    : state.lines.find((row) => row.key === target.key && row.section_code === target.section);
  if (!actualSource || !actualTarget) return null;

  const changedGroup = fromGroup.key !== toGroup.key;
  const destination = changedGroup ? v25MoveDestinationLabel(toGroup, context) : null;
  if (changedGroup && destination === null) return null;
  const nextOrder = order.filter((item) => v25MixedRowIdentity(item) !== v25MixedRowIdentity(source));
  const targetIndex = nextOrder.findIndex((item) => v25MixedRowIdentity(item) === v25MixedRowIdentity(target));
  if (targetIndex < 0) return null;
  nextOrder.splice(targetIndex + (side === 'after' ? 1 : 0), 0, source);
  if (!changedGroup && v25MixedOrderEquals(nextOrder, order)) return null;

  const nextState: V25EditorState = !changedGroup ? state : source.kind === 'slot'
    ? { ...state, slots: state.slots.map((slot) => slot.key === source.key
      ? { ...slot, work_item: destination! } : slot) }
    : { ...state, lines: state.lines.map((line) => line.key === source.key
      ? { ...line, group_label: destination! } : line) };
  return { state: nextState, order: nextOrder };
}
