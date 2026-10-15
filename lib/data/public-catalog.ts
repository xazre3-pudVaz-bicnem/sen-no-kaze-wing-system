import 'server-only';
import '@/lib/seed/independent-insulation';
import { unstable_cache } from 'next/cache';
import type {
  BaseBreakdownItem,
  BaseModel,
  CatalogBundle,
  OptionCategory,
  OptionImage,
  OptionConflict,
  OptionDependency,
  OptionVariantChoice,
  OptionVariantGroup,
  PreviewImageRule,
  PreviewHotspot,
  ProductImage,
  ProductOption,
  SpecMatrix,
} from '@/lib/domain/types';
import {
  isOptionVisibleInSimulator,
  type ProductLifecycleOption,
} from '@/lib/domain/product-lifecycle';
import {
  applyCustomerCategoryApplicability,
  buildCustomerCategoryMatrix,
  type CustomerCategoryMatrix,
} from '@/lib/domain/customer-category-applicability';
import { isLocalMode } from './store';
import { isMissingRelation, normalizeCategories, normalizeOptions } from './schema-compat';

export const CATALOG_TAG = 'catalog';

export interface PublicCatalog {
  models: BaseModel[];
  bundles: Record<string, CatalogBundle>;
}

function filterBundleForSimulator(bundle: CatalogBundle): CatalogBundle {
  const options = bundle.options.filter((option) => isOptionVisibleInSimulator(option as ProductLifecycleOption));
  const optionIds = new Set(options.map((option) => option.id));
  const variantGroups = bundle.variantGroups.filter((group) => optionIds.has(group.option_id));
  const variantGroupIds = new Set(variantGroups.map((group) => group.id));
  return {
    ...bundle,
    options,
    // 依存元が候補に残る限りルールは保持し、前提商品が非表示なら明示的に選択不可とする。
    dependencies: bundle.dependencies.filter((dependency) => optionIds.has(dependency.option_id)),
    conflicts: bundle.conflicts.filter(
      (conflict) => optionIds.has(conflict.option_id) && optionIds.has(conflict.conflicts_with_option_id)
    ),
    variantGroups,
    variantChoices: bundle.variantChoices.filter((choice) => variantGroupIds.has(choice.group_id)),
  };
}

function assemble(
  models: BaseModel[],
  images: ProductImage[],
  categories: OptionCategory[],
  options: ProductOption[],
  optionImages: OptionImage[],
  dependencies: OptionDependency[],
  conflicts: OptionConflict[],
  previewRules: PreviewImageRule[],
  hotspots: PreviewHotspot[],
  variantGroups: OptionVariantGroup[],
  variantChoices: OptionVariantChoice[],
  baseBreakdowns: BaseBreakdownItem[],
  customerMatrix: CustomerCategoryMatrix | null
): PublicCatalog {
  const bundles: Record<string, CatalogBundle> = {};
  for (const model of models) {
    const opts = options
      .filter((o) => o.base_model_id === null || o.base_model_id === model.id)
      .map((option) => ({
        ...option,
        gallery_images: optionImages
          .filter((image) => image.option_id === option.id)
          .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => a.sort_order - b.sort_order);
    const ids = new Set(opts.map((o) => o.id));
    bundles[model.id] = applyCustomerCategoryApplicability({
      model,
      images: images.filter((i) => i.base_model_id === model.id).sort((a, b) => a.sort_order - b.sort_order),
      categories,
      options: opts,
      // 依存ルールは依存元が候補に残る限り保持する（前提商品が無い場合は rules.ts が選択拒否・明示エラーにする）
      dependencies: dependencies.filter((d) => ids.has(d.option_id)),
      conflicts: conflicts.filter((c) => ids.has(c.option_id) && ids.has(c.conflicts_with_option_id)),
      previewRules: previewRules.filter((r) => r.base_model_id === model.id),
      hotspots: hotspots.filter((h) => previewRules.some((r) => r.id === h.rule_id && r.base_model_id === model.id)),
      variantGroups: variantGroups.filter((g) => ids.has(g.option_id)),
      variantChoices: variantChoices.filter((c) => variantGroups.some((g) => g.id === c.group_id && ids.has(g.option_id))),
      baseBreakdowns: baseBreakdowns.filter((b) => b.base_model_id === model.id),
      customerCategoryMatrix: customerMatrix,
    });
  }
  return { models, bundles };
}

/**
 * 公開カタログ（公開中のモデル・画像・オプション・ルール）をまとめて 1 回で取得する。
 * モデルごとに問い合わせると往復が増えるため、テーブル単位で並列に取得して JS 側で組み立てる。
 */
async function fetchPublicCatalog(): Promise<PublicCatalog> {
  if (isLocalMode()) {
    const { LocalStore } = await import('./local-store');
    const store = new LocalStore();
    const models = await store.listModels();
    const bundles: Record<string, CatalogBundle> = {};
    for (const m of models) {
      const b = await store.getCatalogBundle(m.id);
      if (b) bundles[m.id] = applyCustomerCategoryApplicability(filterBundleForSimulator(b));
    }
    return { models, bundles };
  }

  const { createPublicClient } = await import('@/lib/supabase/public');
  const db = createPublicClient();
  const [models, images, categories, options, optionImages, dependencies, conflicts, rules, hotspots, vgroups, vchoices, bbItems] = await Promise.all([
    db.from('base_models').select('*').eq('status', 'published').order('sort_order'),
    db.from('product_images').select('*').order('sort_order'),
    db.from('option_categories').select('*').eq('status', 'published').order('sort_order'),
    db.from('options').select('*').eq('status', 'published').order('sort_order'),
    db.from('option_images').select('*').order('sort_order'),
    db.from('option_dependencies').select('*'),
    db.from('option_conflicts').select('*'),
    db.from('preview_image_rules').select('*').eq('status', 'published'),
    db.from('preview_hotspots').select('*').order('sort_order'),
    db.from('option_variant_groups').select('*').eq('status', 'published').order('sort_order'),
    db.from('option_variant_choices').select('*').eq('status', 'published').order('sort_order'),
    db.from('base_breakdown_items').select('*').order('sort_order'),
  ]);
  // preview_hotspots は 0008 で追加されるテーブル。未適用の DB ではホットスポットなしとして扱う
  const hotspotRows = isMissingRelation(hotspots.error) ? [] : ((hotspots.data ?? []) as PreviewHotspot[]);
  // バリエーションは 0013 で追加。未適用の DB では「選択項目なし」として扱う
  const groupRows = isMissingRelation(vgroups.error) ? [] : ((vgroups.data ?? []) as OptionVariantGroup[]);
  const choiceRows = isMissingRelation(vchoices.error) ? [] : ((vchoices.data ?? []) as OptionVariantChoice[]);
  // 本体内訳は 0016 で追加。未適用の DB では「内訳なし」として扱う
  const breakdownRows = isMissingRelation(bbItems.error) ? [] : ((bbItems.data ?? []) as BaseBreakdownItem[]);
  if (optionImages.error && !isMissingRelation(optionImages.error)) {
    throw new Error(`public catalog option_images: ${optionImages.error.message}`);
  }
  const optionImageRows = isMissingRelation(optionImages.error) ? [] : ((optionImages.data ?? []) as OptionImage[]);
  const err = [models, images, categories, options, dependencies, conflicts, rules].find((r) => r.error)?.error;
  if (err) throw new Error(`public catalog: ${err.message}`);

  // 本体仕様マトリクス（PR A）。表が無い DB（migration 未適用）では可否表なし＝カテゴリーを制限しない（DB 側も同じ）
  const matrixResults = await Promise.all([
    db.from('matrix_specs').select('code, label, sort_order, status'),
    db.from('matrix_sizes').select('code, width_mm, depth_mm, label, sort_order, status'),
    db.from('matrix_items').select('code, label, sort_order, status'),
    db.from('matrix_rows').select('id, base_model_id, spec_code, size_code, fire_selectable, status, lock_version'),
    db.from('matrix_cells').select('matrix_row_id, matrix_item_code, selectable'),
    db.from('option_category_matrix_items').select('category_id, matrix_item_code'),
  ]);
  const matrixError = matrixResults.find((r) => r.error)?.error ?? null;
  if (matrixError && !isMissingRelation(matrixError)) throw new Error(`public catalog matrix: ${matrixError.message}`);
  const [mSpecs, mSizes, mItems, mRows, mCells, mCategoryItems] = matrixResults.map((r) => r.data ?? []);
  const specMatrix: SpecMatrix | null = matrixError
    ? null
    : {
        specs: mSpecs as SpecMatrix['specs'],
        sizes: mSizes as SpecMatrix['sizes'],
        items: mItems as SpecMatrix['items'],
        rows: mRows as SpecMatrix['rows'],
        cells: mCells as SpecMatrix['cells'],
        categoryItems: mCategoryItems as SpecMatrix['categoryItems'],
      };
  const categoryRows = normalizeCategories((categories.data ?? []) as OptionCategory[]);
  const modelRows = (models.data ?? []) as BaseModel[];
  const visibleOptions = normalizeOptions((options.data ?? []) as ProductOption[]).filter((option) =>
    isOptionVisibleInSimulator(option as ProductLifecycleOption)
  );

  return assemble(
    modelRows,
    (images.data ?? []) as ProductImage[],
    categoryRows,
    visibleOptions,
    optionImageRows,
    (dependencies.data ?? []) as OptionDependency[],
    (conflicts.data ?? []) as OptionConflict[],
    (rules.data ?? []) as PreviewImageRule[],
    hotspotRows,
    groupRows,
    choiceRows,
    breakdownRows,
    buildCustomerCategoryMatrix(specMatrix, categoryRows, modelRows)
  );
}

/**
 * 公開ページ用。管理画面で内容を更新すると revalidateTag(CATALOG_TAG) で破棄される。
 */
export const getPublicCatalog = unstable_cache(fetchPublicCatalog, ['public-catalog-v5-spec-matrix'], {
  tags: [CATALOG_TAG],
  revalidate: 300,
});

export async function getPublicModels(): Promise<BaseModel[]> {
  return (await getPublicCatalog()).models;
}

export async function getPublicBundleBySlug(slug: string): Promise<CatalogBundle | null> {
  const { models, bundles } = await getPublicCatalog();
  const model = models.find((m) => m.slug === slug);
  return model ? (bundles[model.id] ?? null) : null;
}
