import { buildPresetSelection } from './preset';
import { selectedPreviewKeys } from './preview';
import { BASE_ESTIMATE_SPEC_CODE, estimateTemplatesFor } from './estimate-template';
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
  source: 'estimate-template';
}

/**
 * 標準見積に対応する平面図の登録枠を返す。
 *
 * Wing は既存 preset と一致する標準見積なら preview_keys を引き継ぐ。
 * BOX の「ホテル・単身者用」「水回りキット」のように preset を持たない標準見積は、
 * 専用の内部マーカーで平面図を紐付ける。シミュレーター接続は別段階。
 */
export function buildStandardFloorplanSlots(bundle: CatalogBundle): StandardFloorplanSlot[] {
  const floorplans = bundle.previewRules.filter((rule) => rule.view === 'floorplan');
  const ctx = {
    options: bundle.options,
    categories: bundle.categories,
    dependencies: bundle.dependencies,
    conflicts: bundle.conflicts,
  };

  return estimateTemplatesFor(bundle.model)
    .filter((choice) => choice.code !== BASE_ESTIMATE_SPEC_CODE)
    .map((choice) => {
      const selectedIds = choice.preset ? buildPresetSelection(ctx, choice.preset) : [];
      const keys = choice.preset ? selectedPreviewKeys(bundle.options, selectedIds, 'floorplan') : [];

      // preview_keys=[] の標準見積は旧 fallback と区別できないため、
      // 内部マーカーが一致する専用ルールだけを紐付ける。
      const rule =
        keys.length === 0
          ? floorplans.find((candidate) => isPresetFloorplanRule(candidate, choice.code)) ?? null
          : floorplans.find(
              (candidate) =>
                !isDedicatedBaseFloorplanRule(candidate) &&
                samePreviewKeys(candidate.preview_keys, keys)
            ) ?? null;

      return {
        code: choice.code,
        name: choice.name,
        keys,
        rule,
        source: 'estimate-template' as const,
      };
    });
}
