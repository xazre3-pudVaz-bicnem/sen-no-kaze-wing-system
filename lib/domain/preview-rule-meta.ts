import type { PreviewImageRule } from './types';

/**
 * DB変更なしで本体専用平面図を既存 fallback と区別するための内部識別値。
 * 管理者向けの通常の補足文としては扱わない。
 */
export const BASE_FLOORPLAN_NOTE = '本体専用平面図';

export function hasBaseFloorplanInternalMarker(rule: PreviewImageRule): boolean {
  return rule.note?.trim() === BASE_FLOORPLAN_NOTE;
}

export function isDedicatedBaseFloorplanRule(rule: PreviewImageRule): boolean {
  return (
    rule.view === 'floorplan' &&
    rule.preview_keys.length === 0 &&
    hasBaseFloorplanInternalMarker(rule)
  );
}

/** 内部識別値は管理画面・シミュレーターの通常の補足文には表示しない。 */
export function previewRuleDisplayNote(rule: PreviewImageRule): string | null {
  return hasBaseFloorplanInternalMarker(rule) ? null : rule.note;
}


export function findDedicatedBaseFloorplanRule(rules: PreviewImageRule[]): PreviewImageRule | null {
  return rules.find(isDedicatedBaseFloorplanRule) ?? null;
}

export interface PreviewRuleEditableFields {
  base_model_id: string;
  view: string;
  kind: string;
  preview_keys: string[];
  note: string | null;
}

/**
 * 本体専用平面図の保存条件をサーバー側でも固定する。
 * 既存ルールの編集では登録時のモデルを必ず保持する。
 * 新規登録時は呼び出し元が指定したモデルを使い、その他の本体専用条件を固定する。
 */
export function enforceDedicatedBaseFloorplanFields(
  existing: PreviewImageRule | null,
  incoming: PreviewRuleEditableFields,
  registerAsDedicatedBase: boolean
): PreviewRuleEditableFields {
  const protectedRule = existing ? hasBaseFloorplanInternalMarker(existing) : registerAsDedicatedBase;
  if (!protectedRule) return incoming;

  return {
    base_model_id: existing?.base_model_id ?? incoming.base_model_id,
    view: 'floorplan',
    kind: 'composite',
    preview_keys: [],
    note: BASE_FLOORPLAN_NOTE,
  };
}
