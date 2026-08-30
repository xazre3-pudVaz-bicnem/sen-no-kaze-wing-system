import 'server-only';
import '@/lib/seed/independent-insulation';
import { unstable_cache } from 'next/cache';
import type {
  BaseBreakdownItem,
  BaseModel,
  CatalogBundle,
  OptionCategory,
  OptionConflict,
  OptionDependency,
  OptionVariantChoice,
  OptionVariantGroup,
  PreviewImageRule,
  PreviewHotspot,
  ProductImage,
  ProductOption,
} from '@/lib/domain/types';
import { isLocalMode } from './store';
import { isMissingRelation, normalizeCategories, normalizeOptions } from './schema-compat';

export const CATALOG_TAG = 'catalog';

export interface PublicCatalog {
  models: BaseModel[];
  bundles: Record<string, CatalogBundle>;
}

function assemble(
  models: BaseModel[],
  images: ProductImage[],
  categories: OptionCategory[],
  options: ProductOption[],
  dependencies: OptionDependency[],
  conflicts: OptionConflict[],
  previewRules: PreviewImageRule[],
  hotspots: PreviewHotspot[],
  variantGroups: OptionVariantGroup[],
  variantChoices: OptionVariantChoice[],
  baseBreakdowns: BaseBreakdownItem[]
): PublicCatalog {
  const bundles: Record<string, CatalogBundle> = {};
  for (const model of models) {
    const opts = options
      .filter((o) => o.base_model_id === null || o.base_model_id === model.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const ids = new Set(opts.map((o) => o.id));
    bundles[model.id] = {
      model,
      images: images.filter((i) => i.base_model_id === model.id).sort((a, b) => a.sort_order - b.sort_order),
      categories,
      options: opts,
      dependencies: dependencies.filter((d) => ids.has(d.option_id) && ids.has(d.requires_option_id)),
      conflicts: conflicts.filter((c) => ids.has(c.option_id) && ids.has(c.conflicts_with_option_id)),
      previewRules: previewRules.filter((r) => r.base_model_id === model.id),
      hotspots: hotspots.filter((h) => previewRules.some((r) => r.id === h.rule_id && r.base_model_id === model.id)),
      variantGroups: variantGroups.filter((g) => ids.has(g.option_id)),
      variantChoices: variantChoices.filter((c) => variantGroups.some((g) => g.id === c.group_id && ids.has(g.option_id))),
      baseBreakdowns: baseBreakdowns.filter((b) => b.base_model_id === model.id),
    };
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
      if (b) bundles[m.id] = b;
    }
    return { models, bundles };
  }

  const { createPublicClient } = await import('@/lib/supabase/public');
  const db = createPublicClient();
  const [models, images, categories, options, dependencies, conflicts, rules, hotspots, vgroups, vchoices, bbItems] = await Promise.all([
    db.from('base_models').select('*').eq('status', 'published').order('sort_order'),
    db.from('product_images').select('*').order('sort_order'),
    db.from('option_categories').select('*').eq('status', 'published').order('sort_order'),
    db.from('options').select('*').eq('status', 'published').order('sort_order'),
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
  const err = [models, images, categories, options, dependencies, conflicts, rules].find((r) => r.error)?.error;
  if (err) throw new Error(`public catalog: ${err.message}`);

  return assemble(
    (models.data ?? []) as BaseModel[],
    (images.data ?? []) as ProductImage[],
    normalizeCategories((categories.data ?? []) as OptionCategory[]),
    normalizeOptions((options.data ?? []) as ProductOption[]),
    (dependencies.data ?? []) as OptionDependency[],
    (conflicts.data ?? []) as OptionConflict[],
    (rules.data ?? []) as PreviewImageRule[],
    hotspotRows,
    groupRows,
    choiceRows,
    breakdownRows
  );
}

/**
 * 公開ページ用。管理画面で内容を更新すると revalidateTag(CATALOG_TAG) で破棄される。
 */
export const getPublicCatalog = unstable_cache(fetchPublicCatalog, ['public-catalog-v1'], {
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
