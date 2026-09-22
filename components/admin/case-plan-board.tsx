'use client';

import { useMemo, useState } from 'react';
import type {
  CatalogBundle,
  Configuration,
  ConfigurationItem,
  EstimateTemplateBundle,
  ViewKey,
} from '@/lib/domain/types';
import { VIEW_KEYS } from '@/lib/domain/types';
import type { ExteriorFaceSelection } from '@/lib/domain/exterior-wall';
import { normalizeExteriorFaces } from '@/lib/domain/exterior-wall';
import { categoriesInScope, defaultSelection, pruneToScope, type RuleContext } from '@/lib/domain/rules';
import { resolvePreview, selectedPreviewKeys } from '@/lib/domain/preview';
import {
  buildEstimateBaselineSelection,
  buildEstimateSpecSelection,
} from '@/lib/domain/estimate-template';
import { buildPresetSelection, defaultVariantIdsFor } from '@/lib/domain/preset';
import { customerPlanName, planDisplaySizeFromSpecs } from '@/lib/domain/plan-display';
import { PlanBoard, ElevationStrip } from '@/components/simulator/plan-board';
import { PreviewStage } from '@/components/simulator/preview-stage';
import { EquipmentBoard } from '@/components/simulator/equipment-board';
import { SimulatorCaseImagesProvider } from '@/components/simulator/case-images-context';

function sameSelection(a: string[], b: string[]) {
  const aa = [...new Set(a)].sort();
  const bb = [...new Set(b)].sort();
  return aa.length === bb.length && aa.every((id, index) => id === bb[index]);
}

export function CasePlanBoard({
  bundle,
  configuration,
  items,
  exteriorFaces,
  estimateTemplate,
  elevations,
}: {
  bundle: CatalogBundle;
  configuration: Configuration;
  items: ConfigurationItem[];
  exteriorFaces: ExteriorFaceSelection[];
  estimateTemplate: EstimateTemplateBundle | null;
  elevations: { url: string; label: string; alt: string }[];
}) {
  const [view, setView] = useState<ViewKey>('exterior');
  const selected = useMemo(() => items.map((item) => item.option_id), [items]);
  const selectedVariantIds = useMemo(
    () => items.flatMap((item) => item.variant_choice_ids ?? []),
    [items]
  );
  const ctx = useMemo<RuleContext>(
    () => ({
      options: bundle.options,
      categories: bundle.categories,
      dependencies: bundle.dependencies,
      conflicts: bundle.conflicts,
    }),
    [bundle]
  );

  const specCode = configuration.spec_code ?? bundle.model.presets?.[0]?.code ?? 'base';
  const activePreset = bundle.model.presets?.find((preset) => preset.code === specCode) ?? null;
  const defaults = useMemo(
    () => defaultSelection(ctx, configuration.finish_level),
    [configuration.finish_level, ctx]
  );
  const baselineSelected = useMemo(() => {
    if (estimateTemplate?.template.spec_code === specCode) {
      return buildEstimateBaselineSelection(ctx, bundle.model, estimateTemplate);
    }
    if (activePreset) return buildPresetSelection(ctx, activePreset, defaults);
    return buildEstimateSpecSelection(ctx, bundle.model, specCode);
  }, [activePreset, bundle.model, ctx, defaults, estimateTemplate, specCode]);
  const baselineVariantIds = useMemo(
    () => defaultVariantIdsFor(bundle.variantGroups, bundle.variantChoices, baselineSelected),
    [baselineSelected, bundle.variantChoices, bundle.variantGroups]
  );

  const specOptions = useMemo(() => {
    if (estimateTemplate || !activePreset) return bundle.options;
    return bundle.options.filter(
      (option) => option.spec_codes.length === 0 || option.spec_codes.includes(specCode)
    );
  }, [activePreset, bundle.options, estimateTemplate, specCode]);
  const scopedCategories = useMemo(
    () =>
      categoriesInScope(bundle.categories, configuration.finish_level).filter(
        (category) => category.customer_visible !== false
      ),
    [bundle.categories, configuration.finish_level]
  );
  const scopedCategoryIds = useMemo(
    () => new Set(scopedCategories.map((category) => category.id)),
    [scopedCategories]
  );
  const specCategories = useMemo(
    () =>
      scopedCategories.filter(
        (category) =>
          category.code !== 'fireproof' &&
          specOptions.some((option) => option.category_id === category.id)
      ),
    [scopedCategories, specOptions]
  );
  const scopedOptions = useMemo(
    () => specOptions.filter((option) => scopedCategoryIds.has(option.category_id)),
    [scopedCategoryIds, specOptions]
  );

  const atStandardSelection = sameSelection(
    selected,
    pruneToScope(ctx, baselineSelected, configuration.finish_level)
  );
  const preferredFloorplanKeys = useMemo<string[] | undefined>(() => {
    if (!atStandardSelection || !activePreset) return undefined;
    const presetSelection = buildPresetSelection(ctx, activePreset, defaults);
    return selectedPreviewKeys(bundle.options, presetSelection, 'floorplan');
  }, [activePreset, atStandardSelection, bundle.options, ctx, defaults]);

  const previews = useMemo(
    () =>
      Object.fromEntries(
        VIEW_KEYS.map((key) => [
          key,
          resolvePreview(
            bundle.previewRules,
            key,
            selectedPreviewKeys(bundle.options, selected, key),
            specCode,
            key === 'floorplan' ? preferredFloorplanKeys : undefined
          ),
        ])
      ) as Record<ViewKey, ReturnType<typeof resolvePreview>>,
    [bundle.options, bundle.previewRules, preferredFloorplanKeys, selected, specCode]
  );

  const exteriorWallCategory = bundle.categories.find((category) => category.code === 'exterior-wall');
  const exteriorWallOptions = bundle.options.filter(
    (option) => option.category_id === exteriorWallCategory?.id && option.status === 'published'
  );
  const hasSelectedExterior = exteriorWallOptions.some((option) => selected.includes(option.id));
  const displayedExteriorFaces =
    exteriorFaces.length === 0 && hasSelectedExterior
      ? normalizeExteriorFaces(
          [],
          exteriorWallOptions,
          bundle.variantGroups,
          bundle.variantChoices,
          selected,
          selectedVariantIds
        )
      : exteriorFaces;

  const specName = estimateTemplate?.template.name ?? activePreset?.name ?? '';
  const planDisplayName = customerPlanName(activePreset, specName);
  const planSize = planDisplaySizeFromSpecs(bundle.model.specs);
  const displayModelName = bundle.model.name === 'フラット' ? 'Flat' : bundle.model.name;
  const caseImages = bundle.images
    .filter((image) => image.kind === 'case')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      caption: image.caption,
    }));

  return (
    <SimulatorCaseImagesProvider images={caseImages}>
      <div className="space-y-4" data-testid="case-plan-board-readonly">
        <section aria-label="案件プランボード" className="space-y-4 lg:space-y-0">
          <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch lg:gap-0">
            <div className="min-w-0">
              <PlanBoard
                plan={previews.floorplan}
                specName={planDisplayName}
                planSize={planSize}
                modelSlug={bundle.model.slug}
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
              exteriorFaces={displayedExteriorFaces}
              readOnly
              onPickExteriorFace={() => undefined}
            />
          </div>
        </section>

        <EquipmentBoard
          categories={specCategories}
          options={scopedOptions}
          selected={selected}
          baselineSelected={baselineSelected}
          selectedVariantIds={selectedVariantIds}
          baselineVariantIds={baselineVariantIds}
          variantGroups={bundle.variantGroups}
          variantChoices={bundle.variantChoices}
          readOnly
          onPickCategory={() => undefined}
        />
      </div>
    </SimulatorCaseImagesProvider>
  );
}
