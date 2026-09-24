'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
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
import { categoriesInScope, defaultSelection, explainBlocked, pruneToScope, toggleOption, type RuleContext } from '@/lib/domain/rules';
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
import { OptionPickerDialog } from '@/components/simulator/option-picker-dialog';

interface Props {
  bundle: CatalogBundle;
  specCode: string;
  template: EstimateTemplateBundle | null;
}

export function StandardEstimateSimulatorPreview(props: Props) {
  const previewKey = `${props.bundle.model.id}:${props.specCode}:${props.template?.template.id ?? 'unregistered'}`;
  return <StandardEstimateSimulatorPreviewBody key={previewKey} {...props} />;
}

function StandardEstimateSimulatorPreviewBody({ bundle, specCode, template }: Props) {
  const [view, setView] = useState<ViewKey>('exterior');
  const [picker, setPicker] = useState<string | null>(null);
  const { model } = bundle;
  const ctx = useMemo<RuleContext>(
    () => ({
      options: bundle.options,
      categories: bundle.categories,
      dependencies: bundle.dependencies,
      conflicts: bundle.conflicts,
    }),
    [bundle.categories, bundle.conflicts, bundle.dependencies, bundle.options]
  );
  const defaults = useMemo(() => defaultSelection(ctx), [ctx]);
  const choices = useMemo(
    () => simulatorEstimateChoices(model, template ? [template] : []),
    [model, template]
  );
  const choice = choices.find((row) => row.code === specCode) ?? null;
  const preset = choice?.preset ?? model.presets.find((row) => row.code === specCode) ?? null;
  const finishLevel = finishLevelForEstimateSpec(specCode);

  const baselineIds = useMemo(
    () =>
      template
        ? buildEstimateBaselineSelection(ctx, model, template)
        : preset
          ? buildPresetSelection(ctx, preset, defaults)
          : buildEstimateSpecSelection(ctx, model, specCode),
    [ctx, defaults, model, preset, specCode, template]
  );
  const initialSelected = useMemo(
    () => pruneToScope(ctx, baselineIds, finishLevel),
    [baselineIds, ctx, finishLevel]
  );
  const initialVariantIds = useMemo(
    () => defaultVariantIdsFor(bundle.variantGroups, bundle.variantChoices, initialSelected),
    [bundle.variantChoices, bundle.variantGroups, initialSelected]
  );
  const baselineVariantIds = useMemo(
    () => defaultVariantIdsFor(bundle.variantGroups, bundle.variantChoices, baselineIds),
    [baselineIds, bundle.variantChoices, bundle.variantGroups]
  );

  const exteriorCategory = bundle.categories.find((category) => category.code === 'exterior-wall');
  const exteriorOptions = useMemo(
    () =>
      bundle.options
        .filter((option) => option.category_id === exteriorCategory?.id && option.status === 'published')
        .sort((a, b) => a.sort_order - b.sort_order),
    [bundle.options, exteriorCategory?.id]
  );
  const initialExteriorFaces = useMemo(
    () =>
      makeDefaultExteriorFaces(
        exteriorOptions,
        bundle.variantGroups,
        bundle.variantChoices,
        initialSelected,
        initialVariantIds
      ),
    [bundle.variantChoices, bundle.variantGroups, exteriorOptions, initialSelected, initialVariantIds]
  );
  const [selected, setSelected] = useState(initialSelected);
  const [variantIds, setVariantIds] = useState(initialVariantIds);
  const [exteriorFaces, setExteriorFaces] = useState(initialExteriorFaces);

  const blocked = useMemo(() => explainBlocked(ctx, selected), [ctx, selected]);
  const sameIds = (left: string[], right: string[]) => {
    const a = [...new Set(left)].sort();
    const b = [...new Set(right)].sort();
    return a.length === b.length && a.every((id, index) => id === b[index]);
  };
  const previewChanged =
    !sameIds(selected, initialSelected) || !sameIds(variantIds, initialVariantIds);

  const openPicker = (categoryId: string) => {
    const category = bundle.categories.find((row) => row.id === categoryId);
    if (!category || category.code === 'fireproof' || category.code === 'exterior-wall') return;
    setPicker(categoryId);
  };

  const applyPicker = (categoryId: string, nextInCategory: string[], nextVariants: string[] = []) => {
    const inCategory = bundle.options.filter((option) => option.category_id === categoryId).map((option) => option.id);
    let current = selected;

    let pending = inCategory.filter((id) => current.includes(id) && !nextInCategory.includes(id));
    while (pending.length > 0) {
      const rest: string[] = [];
      let progressed = false;
      for (const id of pending) {
        const result = toggleOption(ctx, current, id);
        if (result.rejected) rest.push(id);
        else {
          current = result.next;
          progressed = true;
        }
      }
      if (!progressed) break;
      pending = rest;
    }

    for (const id of inCategory) {
      if (!nextInCategory.includes(id) || current.includes(id)) continue;
      const result = toggleOption(ctx, current, id);
      if (!result.rejected) current = result.next;
    }

    setSelected(current);

    const categoryOptionIds = new Set(inCategory);
    const categoryGroupIds = new Set(
      bundle.variantGroups
        .filter((group) => categoryOptionIds.has(group.option_id))
        .map((group) => group.id)
    );
    setVariantIds((currentVariants) => [
      ...currentVariants.filter((choiceId) => {
        const groupId = bundle.variantChoices.find((choice) => choice.id === choiceId)?.group_id;
        return !groupId || !categoryGroupIds.has(groupId);
      }),
      ...nextVariants,
    ]);
    setPicker(null);
  };

  const resetPreview = () => {
    setSelected(initialSelected);
    setVariantIds(initialVariantIds);
    setExteriorFaces(initialExteriorFaces);
    setPicker(null);
  };

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
                見積書とプランボードを確認できます。ここでの商品変更は画面内試算で、保存されません。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {previewChanged && (
                <button type="button" onClick={resetPreview} className="btn-ghost btn-sm">
                  試算をリセット
                </button>
              )}
              {template && (
                <Link href={`/admin/estimate-templates/${template.template.id}`} className="btn-secondary btn-sm">
                  標準見積を編集
                </Link>
              )}
            </div>
          </div>

          <div className="px-4 py-4 sm:px-5">
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-ink-soft">
              <strong className="font-semibold text-ink">画面内試算：</strong>
              見積書の商品変更はプランボードへ反映します。正式な変更は「標準見積を編集」から行います。
            </div>
            <QuoteSheet
              modelName={displayModelName}
              specName={specName}
              finishLevel={finishLevel}
              pricing={pricing}
              standardEstimate={standardEstimate}
              categories={bundle.categories}
              options={bundle.options}
              readOnly={false}
              allowStandardEstimateCategoryPick
              onPickCategory={openPicker}
            />
          </div>
        </section>

        <section className="card mx-auto w-full max-w-5xl overflow-hidden">
          <div className="border-b border-line bg-sand/20 px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold">プランボード確認</h2>
          </div>

          <div className="p-4 sm:p-5">
            <section aria-label="プランボード" className="space-y-4 md:space-y-0">
              <div className="grid gap-4 md:grid-cols-2 md:items-stretch md:gap-0">
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
                baselineVariantIds={baselineVariantIds}
                variantGroups={bundle.variantGroups}
                variantChoices={bundle.variantChoices}
                readOnly
                onPickCategory={() => undefined}
              />
            </div>
          </div>
        </section>
      </div>

      {picker && (() => {
        const category = bundle.categories.find((row) => row.id === picker);
        if (!category) return null;
        return (
          <OptionPickerDialog
            category={category}
            options={scopedOptions.filter((option) => option.category_id === picker)}
            selectedIds={selected}
            baselineSelectedIds={baselineIds}
            blocked={blocked}
            variantGroups={bundle.variantGroups}
            variantChoices={bundle.variantChoices}
            selectedVariantIds={variantIds}
            baselineVariantIds={baselineVariantIds}
            onClose={() => setPicker(null)}
            onApply={(nextSelected, nextVariants) => applyPicker(picker, nextSelected, nextVariants)}
          />
        );
      })()}
    </SimulatorCaseImagesProvider>
  );
}
