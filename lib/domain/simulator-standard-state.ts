import { finishLevelForEstimateSpec, ruleContextForSpec } from './estimate-template';
import { makeDefaultExteriorFaces, standardExteriorWallOptions, type ExteriorFaceSelection } from './exterior-wall';
import { pruneToScope, type RuleContext } from './rules';
import type { CatalogBundle, FinishLevel } from './types';
import { normalizeWashbasinSelection } from './washbasin-selection';

/** シミュレーターの仕様の標準状態（注文範囲・商品・選択肢・外壁の 4 面） */
export interface SimulatorStandardState {
  finishLevel: FinishLevel;
  optionIds: string[];
  variantChoiceIds: string[];
  exteriorFaces: ExteriorFaceSelection[];
}

/**
 * v2.5 の売価を使う間の、仕様・防火条件の標準状態（2026-10-29 先方回答：公開中の版の選択枠がシミュレーターの初期構成）。
 * 新しいプランの最初の状態・仕様の読み込み・防火の切り替え・/plans からの入口で、同じこの関数を使う
 * （どこから入っても同じ状態にし、標準構成のままなら公開した版の標準価格になるようにする）。
 * baselineIds は仕様の標準構成の商品（buildV25SpecSelection）、variantIdsFor は標準の選択肢の決め方（選択枠の選択肢）。
 * 洗面の正規化と、外壁の 4 面（公開中の外壁の商品。シミュレーター非表示の標準の商品を含む）は画面の操作と同じ作り
 */
export function v25SimulatorStandardState(
  bundle: Pick<
    CatalogBundle,
    'model' | 'options' | 'categories' | 'dependencies' | 'conflicts' | 'customerCategoryMatrix' | 'variantGroups' | 'variantChoices'
  >,
  specCode: string,
  baselineIds: string[],
  variantIdsFor: (optionIds: string[]) => string[]
): SimulatorStandardState {
  const ctx: RuleContext = {
    options: bundle.options,
    categories: bundle.categories,
    dependencies: bundle.dependencies,
    conflicts: bundle.conflicts,
    customerCategoryMatrix: bundle.customerCategoryMatrix ?? null,
  };
  const finishLevel = finishLevelForEstimateSpec(specCode);
  const specCtx = ruleContextForSpec(ctx, specCode, bundle.model.slug);
  const optionIds = normalizeWashbasinSelection(bundle.options, pruneToScope(specCtx, baselineIds, finishLevel), baselineIds);
  const variantChoiceIds = variantIdsFor(optionIds);
  const exteriorCategoryId = bundle.categories.find((category) => category.code === 'exterior-wall')?.id;
  const exteriorFaces = makeDefaultExteriorFaces(
    standardExteriorWallOptions(specCtx.options, exteriorCategoryId),
    bundle.variantGroups,
    bundle.variantChoices,
    optionIds,
    variantChoiceIds
  );
  return { finishLevel, optionIds, variantChoiceIds, exteriorFaces };
}
