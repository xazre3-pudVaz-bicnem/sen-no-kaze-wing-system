import { CURRENT_EXTERIOR_CODES, LEGACY_EXTERIOR_CODES, normalizeExteriorFaces, type ExteriorFaceSelection } from './exterior-wall';
import {
  buildEstimateBaselineSelection,
  buildEstimateSpecSelection,
  buildV25SpecSelection,
  finishLevelForEstimateSpec,
  simulatorEstimateChoices,
} from './estimate-template';
import { buildPresetSelection, defaultVariantIdsFor } from './preset';
import { defaultSelection, pruneToScope, type RuleContext } from './rules';
import { v25SimulatorStandardState } from './simulator-standard-state';
import type { CatalogBundle, EstimateTemplateBundle, FinishLevel } from './types';
import { normalizeWashbasinSelection } from './washbasin-selection';

export interface SimulatorEntryState {
  spec_code: string;
  finish_level: FinishLevel;
  option_ids: string[];
  variant_choice_ids: string[];
  exterior_faces: ExteriorFaceSelection[];
}

/**
 * /plans などから仕様を指定してシミュレーターへ入るときの初期状態。
 * 保存済みConfigurationは作らず、シミュレーター内で仕様ボタンを押した直後と
 * 同じ標準構成を組み立てる。未知のspec_codeは安全に無視する。
 */
export function buildSimulatorEntryState(
  bundle: CatalogBundle,
  estimateTemplates: EstimateTemplateBundle[],
  requestedSpecCode: string,
  /** 標準の選択肢の決め方（v2.5 の売価を使う間は標準見積の選択枠の選択肢。v2.5 PR-C1）。無ければ商品の標準の選択肢 */
  standardVariantIds?: (specCode: string, optionIds: string[]) => string[],
  /**
   * 標準構成の商品の決め方（v2.5 の売価を使う間は、公開中の v2.5 の版（非防火）の選択枠の商品。2026-10-29 先方回答）。
   * null を返す仕様（v2.5 の版が無い）と、未指定のときは旧来の標準構成
   */
  standardOptionIds?: (specCode: string) => string[] | null
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
    customerCategoryMatrix: bundle.customerCategoryMatrix ?? null,
  };
  const variantIdsFor = (optionIds: string[]) =>
    standardVariantIds
      ? standardVariantIds(choice.code, optionIds)
      : defaultVariantIdsFor(bundle.variantGroups, bundle.variantChoices, optionIds);

  // v2.5：シミュレーターの新しいプラン・仕様の読み込みと同じ関数で、公開中の版の選択枠から標準状態を作る
  const slotOptionIds = standardOptionIds?.(choice.code) ?? null;
  if (slotOptionIds) {
    const state = v25SimulatorStandardState(bundle, choice.code, buildV25SpecSelection(ctx, model, choice.code, slotOptionIds, null), variantIdsFor);
    return {
      spec_code: choice.code,
      finish_level: state.finishLevel,
      option_ids: state.optionIds,
      variant_choice_ids: state.variantChoiceIds,
      exterior_faces: state.exteriorFaces,
    };
  }

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
  const variantChoiceIds = variantIdsFor(optionIds);

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
