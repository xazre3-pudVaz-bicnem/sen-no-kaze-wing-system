import type { V25LineRow, V25SlotRow } from '@/lib/domain/standard-estimate-v25-view';

/**
 * 標準見積v2.5の工事項目（表示専用）。
 *
 * 商品台帳の既存categoryCodeとの対応が明確なものだけを記載する。
 * この見出しは保存済みのsection_code / group_label / slotの属性を変更しない。
 * 出典: lib/seed/catalog.ts の屋根/外壁/床材/壁・天井/サッシ/内部建具カテゴリー。
 * 玄関ドア・造作工事・設備等は施工区分を推測しない。
 */
export const V25_DISPLAY_WORK_ITEMS = [
  { id: 'sash_wood', label: '1. サッシ・木製建具工事', name: 'サッシ・木製建具工事', categoryCodes: ['sash', 'interior-door'] },
  { id: 'roof', label: '2. 屋根工事', name: '屋根工事', categoryCodes: ['roof'] },
  { id: 'exterior', label: '3. 外壁工事', name: '外壁工事', categoryCodes: ['exterior-wall'] },
  { id: 'interior', label: '4. 内装仕上げ', name: '内装仕上げ', categoryCodes: ['floor', 'wall-ceiling'] },
] as const;

export interface V25DisplayWorkGroup {
  key: string;
  label: string;
  /** 現行画面の表示順: 商品行→手入力行。#666の混在順序には触れない。 */
  slots: V25SlotRow[];
  lines: V25LineRow[];
}

type DisplayGroupIdentity = { key: string; label: string; order: number };

/** 一致するカテゴリーだけを既定工事項目へ。未知のカテゴリーは未分類として残す。 */
export function v25WorkItemForCategory(categoryCode: string | null | undefined): DisplayGroupIdentity | null {
  const index = V25_DISPLAY_WORK_ITEMS.findIndex((item) =>
    (item.categoryCodes as readonly string[]).includes(categoryCode ?? ''));
  if (index < 0) return null;
  const item = V25_DISPLAY_WORK_ITEMS[index];
  return { key: `work:${item.id}`, label: item.label, order: index };
}

/**
 * 手入力のgroup_labelは既存の自由入力を正本にする。
 * 既定工事項目と完全一致する名称（番号なし又は同じ番号）だけ、商品と同じ見出しへ合流。
 * 番号だけの一致、部分一致、別の番号では推測せず、元の見出し名をそのまま使う。
 */
export function v25WorkItemForManual(groupLabel: string): DisplayGroupIdentity {
  const label = groupLabel.trim();
  if (!label) return { key: 'manual:empty', label: '工事項目未設定（手入力）', order: 101 };
  const numbered = label.match(/^([1-4])[.．、]\s*(.+)$/);
  const index = V25_DISPLAY_WORK_ITEMS.findIndex((item, i) =>
    label === item.name || (numbered !== null && Number(numbered[1]) === i + 1 && numbered[2] === item.name));
  if (index >= 0) {
    const item = V25_DISPLAY_WORK_ITEMS[index];
    return { key: `work:${item.id}`, label: item.label, order: index };
  }
  return { key: `manual:${label}`, label, order: 100 };
}

/** UIでだけ商品と手入力を共通の工事項目の下に置く。元配列と保存順は変更しない。 */
export function v25WorkGroupsForDisplay(
  slots: readonly V25SlotRow[],
  lines: readonly V25LineRow[],
  categoryCodeOf: (optionId: string) => string | null | undefined,
  /** グループ名の入力中は表示上だけ編集前の所属へ据え置く（フォームを再マウントしない）。 */
  displayGroupLabelOf: (line: V25LineRow) => string = (line) => line.group_label,
): V25DisplayWorkGroup[] {
  const groups = new Map<string, V25DisplayWorkGroup & { order: number; first: number }>();
  const ensureGroup = (identity: DisplayGroupIdentity) => {
    let group = groups.get(identity.key);
    if (!group) {
      group = { ...identity, slots: [], lines: [], first: groups.size };
      groups.set(identity.key, group);
    }
    return group;
  };
  for (const slot of slots) {
    const item = v25WorkItemForCategory(categoryCodeOf(slot.option_id)) ??
      { key: 'products:unclassified', label: '工事項目未分類の商品', order: 102 };
    ensureGroup(item).slots.push(slot);
  }
  for (const line of lines) ensureGroup(v25WorkItemForManual(displayGroupLabelOf(line))).lines.push(line);
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.first - b.first)
    .map(({ key, label, slots: itemSlots, lines: itemLines }) => ({ key, label, slots: itemSlots, lines: itemLines }));
}
