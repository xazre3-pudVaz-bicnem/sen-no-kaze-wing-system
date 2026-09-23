'use client';

import Link from 'next/link';
import { useState } from 'react';
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
import { categoriesInScope, defaultSelection, pruneToScope, type RuleContext } from '@/lib/domain/rules';
import { computeStandardEstimatePricing } from '@/lib/domain/standard-estimate-pricing';
import { makeDefaultExteriorFaces } from '@/lib/domain/exterior-wall';
import {
  VIEW_KEYS,
  type CatalogBundle,
  type EstimateTemplateBundle,
  type ViewKey,
} from '@/lib/domain/types';
import { ELEVATIONS, MODEL_WING01_ID } from '@/lib/seed/catalog';
import { SimulatorCaseImagesProvider } from '@/components/simulator/case-images-context';
import { EquipmentBoard } from '@/components/simulator/equipment-board';
import { ElevationStrip, PlanBoard } from '@/components/simulator/plan-board';
import { PreviewStage } from '@/components/simulator/preview-stage';
import { QuoteSheet } from '@/components/simulator/quote-sheet';

interface Props {
  bundle: CatalogBundle;
  specCode: string;
  template: EstimateTemplateBundle | null;
}

export function StandardEstimateSimulatorPreview({ bundle, specCode, template }: Props) {
  const [view, setView] = useState<ViewKey>('exterior');
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
  const displayModelName = model.name === 'フラット' ? 'Flat' : model.name;
  const planDisplayName = customerPlanName(preset, specName);
  const planSize = planDisplaySizeFromSpecs(model.specs);
  const preferredFloorplanKeys = preset
    ? selectedPreviewKeys(
        bundle.options,
        buildPresetSelection(ctx, preset, defaults),
        'floorplan'
      )
    : undefined;
  const previews = Object.fromEntries(
    VIEW_KEYS.map((previewView) => [
      previewView,
      resolvePreview(
        bundle.previewRules,
        previewView,
        selectedPreviewKeys(bundle.options, selected, previewView),
        specCode,
        previewView === 'floorplan' ? preferredFloorplanKeys : undefined
      ),
    ])
  ) as Record<ViewKey, ReturnType<typeof resolvePreview>>;

  const registeredElevations = bundle.images
    .filter((image) => image.kind === 'elevation')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((image) => ({
      url: image.url,
      label: image.caption ?? image.alt ?? '立面図',
      alt: image.alt,
    }));
  const elevations =
    registeredElevations.length > 0
      ? registeredElevations
      : model.id === MODEL_WING01_ID
        ? ELEVATIONS
        : [];

  const caseImages = bundle.images
    .filter((image) => image.kind === 'case')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      caption: image.caption,
    }));

  const specOptions =
    template || !preset
      ? bundle.options
      : bundle.options.filter(
          (option) => option.spec_codes.length === 0 || option.spec_codes.includes(specCode)
        );
  const scopedCategories = categoriesInScope(bundle.categories, finishLevel).filter(
    (category) => category.customer_visible !== false
  );
  const scopedCategoryIds = new Set(scopedCategories.map((category) => category.id));
  const specCategories = scopedCategories.filter(
    (category) =>
      category.code !== 'fireproof' &&
      specOptions.some((option) => option.category_id === category.id)
  );
  const scopedOptions = specOptions.filter((option) => scopedCategoryIds.has(option.category_id));

  return (
    <SimulatorCaseImagesProvider images={caseImages}>
      <div className="space-y-5">
        <section className="card overflow-hidden" id="estimate-preview">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-sand/20 px-4 py-4 sm:px-5">
            <div>
              <p className="text-xs font-semibold text-forest">選択中の標準見積</p>
              <h2 className="mt-1 text-lg font-semibold">
                {displayModelName} / {specName}
              </h2>
              <p className="mt-1 text-xs text-muted">
                シミュレーターの標準状態と同じ選択内容で、見積書を読み取り専用表示しています。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {template && (
                <Link href={`/admin/estimate-templates/${template.template.id}`} className="btn-secondary btn-sm">
                  標準見積を編集
                </Link>
              )}
              <Link href={`/simulator/${model.slug}`} className="btn-secondary btn-sm">
                シミュレーターで確認
              </Link>
            </div>
          </div>

          <div className="px-4 py-4 sm:px-5">
            <QuoteSheet
              modelName={displayModelName}
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
            <p className="mt-1 text-xs text-muted">
              シミュレーターと同じ構成で、平面図・完成イメージ・立面図・標準設備及び仕上げ表を確認できます。
            </p>
          </div>

          <div className="p-4 sm:p-5">
            <section aria-label="プランボード" className="space-y-4 lg:space-y-0">
              <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch lg:gap-0">
                <div className="min-w-0">
                  <PlanBoard
                    plan={previews.floorplan}
                    specName={planDisplayName}
                    planSize={planSize}
                    modelSlug={model.slug}
                    readOnly
                  />
                </div>

                <div className="min-w-0">
                  <PreviewStage
                    previews={previews}
                    view={view}
                    onViewChange={setView}
                    options={bundle.options}
                    modelName={displayModelName}
                  />
                </div>
              </div>

              <div className="min-w-0">
                <ElevationStrip
                  elevations={elevations}
                  categories={bundle.categories}
                  options={bundle.options}
                  variantChoices={bundle.variantChoices}
                  exteriorFaces={exteriorFaces}
                  readOnly
                  onPickExteriorFace={() => undefined}
                />
              </div>
            </section>

            <div className="mt-4">
              <EquipmentBoard
                categories={specCategories}
                options={scopedOptions}
                selected={selected}
                baselineSelected={baselineIds}
                selectedVariantIds={variantIds}
                baselineVariantIds={variantIds}
                variantGroups={bundle.variantGroups}
                variantChoices={bundle.variantChoices}
                readOnly
                onPickCategory={() => undefined}
              />
            </div>
          </div>
        </section>
      </div>
    </SimulatorCaseImagesProvider>
  );
}
