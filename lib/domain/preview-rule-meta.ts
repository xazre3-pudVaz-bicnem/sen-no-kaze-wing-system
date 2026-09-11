import type { PreviewImageRule } from './types';

/**
 * DB変更なしで本体専用平面図を既存 fallback と区別するための内部識別値。
 * 管理者向けの通常の補足文としては扱わない。
 */
export const BASE_FLOORPLAN_NOTE = '本体専用平面図';

export function isDedicatedBaseFloorplanRule(rule: PreviewImageRule): boolean {
  return (
    rule.view === 'floorplan' &&
    rule.preview_keys.length === 0 &&
    rule.note?.trim() === BASE_FLOORPLAN_NOTE
  );
}

/** 内部識別値は管理画面・シミュレーターの通常の補足文には表示しない。 */
export function previewRuleDisplayNote(rule: PreviewImageRule): string | null {
  return isDedicatedBaseFloorplanRule(rule) ? null : rule.note;
}
