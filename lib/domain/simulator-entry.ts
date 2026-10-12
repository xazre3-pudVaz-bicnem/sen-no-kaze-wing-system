import { normalizeExteriorFaces, type ExteriorFaceSelection } from './exterior-wall';
import {
  buildEstimateBaselineSelection,
  buildEstimateSpecSelection,
  finishLevelForEstimateSpec,
  simulatorEstimateChoices,
} from './estimate-template';
import { buildPresetSelection, defaultVariantIdsFor } from './preset';
import { defaultSelection, pruneToScope, type RuleContext } from './rules';
import type { CatalogBundle, EstimateTemplateBundle, FinishLevel } from './types';
import { normalizeWashbasinSelection } from './washbasin-selection';

export interface SimulatorEntryState {
  spec_code: string;
  finish_level: FinishLevel;
  option_ids: string[];
  variant_choice_ids: string[];
  exterior_faces: ExteriorFaceSelection[];
}

const LEGACY_EXTERIOR_CODES = new Set(['exterior-galnote', 'exterior-wood']);
const CURRENT_EXTERIOR_CODES = new Set([
  'exterior-nichiha-st-u18',
  'exterior-nichiha-ns-premium18',
  'exterior-nichiha-m-flat-premium18',
  'exterior-wood-accent-100',
  'exterior-current-gl-bare',
]);

/**
 * /plans などから仕様を指定してシミュレーターへ入るときの初期状態。
 * 保存済みConfigurationは作らず、シミュレーター内で仕様ボタンを押した直後と
 * 同じ標準構成を組み立てる。未知のspec_codeは安全に無視する。
 */
export function buildSimulatorEntryState(
  bundle: CatalogBundle,
  estimateTemplates: EstimateTemplateBundle[],
  requestedSpecCode: string
): SimulatorEntryState | null {
  const { model } = bundle;
  const choice = simulatorEstimateChoices(model, estimateTemplates).find(
    (row) => row.code === requestedSpecCode
  );
  if (!choice) return null;

  const ctx: RuleContext = {
    options: bundle.options,
    categories: bundle.categories,
    dependencies: bundle.dependencies,
    conflicts: bundle.conflicts,
  };
  const defaults = defaultSelection(ctx);
  const baselineIds = choice.template
    ? buildEstimateBaselineSelection(ctx, model, choice.template)
    : choice.preset
      ? buildPresetSelection(ctx, choice.preset, defaults)
      : buildEstimateSpecSelection(ctx, model, choice.code);
  const finishLevel = finishLevelForEstimateSpec(choice.code);
  const optionIds = normalizeWashbasinSelection(
    bundle.options,
    pruneToScope(ctx, baselineIds, finishLevel),
    baselineIds
  );
  const variantChoiceIds = defaultVariantIdsFor(
    bundle.variantGroups,
    bundle.variantChoices,
    optionIds
  );

  const exteriorWallCategory = bundle.categories.find((category) => category.code === 'exterior-wall');
  const allExteriorWallOptions = bundle.options
    .filter(
      (option) =>
        option.category_id === exteriorWallCategory?.id && option.status === 'published'
    )
    .sort((a, b) => a.sort_order - b.sort_order);
  const hasCurrentExteriorCatalog = allExteriorWallOptions.some((option) =>
    CURRENT_EXTERIOR_CODES.has(option.code)
  );
  const exteriorWallOptions = hasCurrentExteriorCatalog
    ? allExteriorWallOptions.filter((option) => !LEGACY_EXTERIOR_CODES.has(option.code))
    : allExteriorWallOptions;
  const exteriorFaces = normalizeExteriorFaces(
    undefined,
    exteriorWallOptions,
    bundle.variantGroups,
    bundle.variantChoices,
    optionIds,
    variantChoiceIds
  );

  return {
    spec_code: choice.code,
    finish_level: finishLevel,
    option_ids: optionIds,
    variant_choice_ids: variantChoiceIds,
    exterior_faces: exteriorFaces,
  };
}
