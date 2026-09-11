import { buildPresetSelection } from './preset';
import { selectedPreviewKeys } from './preview';
import type { CatalogBundle, PreviewImageRule } from './types';
import { isDedicatedBaseFloorplanRule, isPresetFloorplanRule } from './preview-rule-meta';

const normalizeKeys = (keys: string[]) => [...new Set(keys)].sort();

export function samePreviewKeys(a: string[], b: string[]): boolean {
  const aa = normalizeKeys(a);
  const bb = normalizeKeys(b);
  return aa.length === bb.length && aa.every((key, index) => key === bb[index]);
}

export interface StandardFloorplanSlot {
  code: string;
  name: string;
  keys: string[];
  rule: PreviewImageRule | null;
  source: 'preset';
}

/**
 * 標準構成に対応する平面図の登録枠を返す。
 *
 * 現段階の参照元は model.presets。
 * 将来、本体のみ・ホテル・住宅・事務所などを正式な見積テンプレートで管理するようになったら、
 * 管理画面側を変えず、この関数の参照元だけ差し替える。
 */
export function buildStandardFloorplanSlots(bundle: CatalogBundle): StandardFloorplanSlot[] {
  const floorplans = bundle.previewRules.filter((rule) => rule.view === 'floorplan');
  const ctx = {
    options: bundle.options,
    categories: bundle.categories,
    dependencies: bundle.dependencies,
    conflicts: bundle.conflicts,
  };

  return (bundle.model.presets ?? []).map((preset) => {
    const selectedIds = buildPresetSelection(ctx, preset);
    const keys = selectedPreviewKeys(bundle.options, selectedIds, 'floorplan');

    // 空キーの標準仕様は旧 fallback と区別できないため、
    // 内部マーカーが一致する preset 専用ルールだけを紐付ける。
    const rule =
      keys.length === 0
        ? floorplans.find((candidate) => isPresetFloorplanRule(candidate, preset.code)) ?? null
        : floorplans.find(
            (candidate) =>
              !isDedicatedBaseFloorplanRule(candidate) &&
              samePreviewKeys(candidate.preview_keys, keys)
          ) ?? null;

    return {
      code: preset.code,
      name: preset.name,
      keys,
      rule,
      source: 'preset' as const,
    };
  });
}
