'use client';

import {
  buildEstimateBaselineSelection,
  buildEstimateSpecSelection,
  finishLevelForEstimateSpec,
  simulatorEstimateChoices,
} from '@/lib/domain/estimate-template';
import { customerPlanName, planDisplaySizeFromSpecs } from '@/lib/domain/plan-display';
import { baseBreakdownTotal, buildPresetSelection, defaultVariantIdsFor } from '@/lib/domain/preset';
import { computePricing } from '@/lib/domain/pricing';
import { resolvePreview, selectedPreviewKeys } from '@/lib/domain/preview';
import { defaultSelection, pruneToScope, type RuleContext } from '@/lib/domain/rules';
import { computeStandardEstimatePricing } from '@/lib/domain/standard-estimate-pricing';
import { makeDefaultExteriorFaces } from '@/lib/domain/exterior-wall';
import type { CatalogBundle, EstimateTemplateBundle } from '@/lib/domain/types';
import { PlanBoard } from '@/components/simulator/plan-board';
import { QuoteSheet } from '@/components/simulator/quote-sheet';

interface Props {
  bundle: CatalogBundle;
  specCode: string;
  template: EstimateTemplateBundle | null;
}

export function StandardEstimateSimulatorPreview({ bundle, specCode, template }: Props) {
  const { model } = bundle;
  const ctx: RuleContext = {
    options: bundle.options,
    categories: bundle.categories,
    dependencies: bundle.dependencies,
    conflicts: bundle.conflicts,
  };
  const defaults = defaultSelection(ctx);
  const choices = simulatorEstimateChoices(model, template ? [template] : []);
  const choice = choices.find((row) => row.code === specCode) ?? null;
  const preset = choice?.preset ?? model.presets.find((row) => row.code === specCode) ?? null;
  const finishLevel = finishLevelForEstimateSpec(specCode);

  const baselineIds = template
    ? buildEstimateBaselineSelection(ctx, model, template)
    : preset
      ? buildPresetSelection(ctx, preset, defaults)
      : buildEstimateSpecSelection(ctx, model, specCode);

  const selected = pruneToScope(ctx, baselineIds, finishLevel);
  const variantIds = defaultVariantIdsFor(bundle.variantGroups, bundle.variantChoices, selected);

  const exteriorCategory = bundle.categories.find((category) => category.code === 'exterior-wall');
  const exteriorOptions = bundle.options
    .filter((option) => option.category_id === exteriorCategory?.id && option.status === 'published')
    .sort((a, b) => a.sort_order - b.sort_order);
  const exteriorFaces = makeDefaultExteriorFaces(
    exteriorOptions,
    bundle.variantGroups,
    bundle.variantChoices,
    selected,
    variantIds
  );

  const standardEstimate = template
    ? computeStandardEstimatePricing(
        bundle,
        template,
        selected,
        variantIds,
        exteriorFaces,
        finishLevel
      )
    : null;

  const pricing =
    standardEstimate?.pricing ??
    computePricing(
      model,
      bundle.options,
      bundle.categories,
      selected.map((option_id) => ({ option_id, variant_choice_ids: variantIds })),
      undefined,
      { groups: bundle.variantGroups, choices: bundle.variantChoices },
      baseBreakdownTotal(bundle, specCode),
      exteriorFaces
    );

  const specName = template?.template.name ?? choice?.name ?? preset?.name ?? specCode;
  const planDisplayName = customerPlanName(preset, specName);
  const planSize = planDisplaySizeFromSpecs(model.specs);
  const preferredFloorplanKeys = preset
    ? selectedPreviewKeys(
        bundle.options,
        buildPresetSelection(ctx, preset, defaults),
        'floorplan'
      )
    : undefined;
  const plan = resolvePreview(
    bundle.previewRules,
    'floorplan',
    selectedPreviewKeys(bundle.options, selected, 'floorplan'),
    specCode,
    preferredFloorplanKeys
  );

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden" id="estimate-preview">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-sand/20 px-4 py-4 sm:px-5">
          <div>
            <p className="text-xs font-semibold text-forest">選択中の標準見積</p>
            <h2 className="mt-1 text-lg font-semibold">
              {model.name === 'フラット' ? 'Flat' : model.name} / {specName}
            </h2>
            <p className="mt-1 text-xs text-muted">
              シミュレーターの標準状態と同じ選択内容で、見積書を読み取り専用表示しています。
            </p>
          </div>
          <a href={`/simulator/${model.slug}`} className="btn-secondary btn-sm">
            シミュレーターで確認
          </a>
        </div>

        <div className="px-4 py-4 sm:px-5">
          <QuoteSheet
            modelName={model.name === 'フラット' ? 'Flat' : model.name}
            specName={specName}
            finishLevel={finishLevel}
            pricing={pricing}
            standardEstimate={standardEstimate}
            categories={bundle.categories}
            options={bundle.options}
            readOnly
            onPickCategory={() => undefined}
          />
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-line bg-sand/20 px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold">プランボード</h2>
          <p className="mt-1 text-xs text-muted">同じ標準状態の平面図を確認できます。</p>
        </div>
        <div className="p-4 sm:p-5">
          <PlanBoard
            plan={plan}
            specName={planDisplayName}
            planSize={planSize}
            modelSlug={model.slug}
            readOnly
          />
        </div>
      </section>
    </div>
  );
}
