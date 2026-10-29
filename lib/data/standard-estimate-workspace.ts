import 'server-only';
import { getPublicCatalog } from '@/lib/data/public-catalog';
import { isMissingColumn, isMissingRelation } from '@/lib/data/schema-compat';
import { getStandardEstimateV25Header, loadStandardEstimateV25 } from '@/lib/data/standard-estimate-v25';
import type { getStore } from '@/lib/data/store';
import type { createClient } from '@/lib/supabase/server';
import { ruleContextForSpec } from '@/lib/domain/estimate-template';
import { defaultVariantIdsFor } from '@/lib/domain/preset';
import { isQuoteSelectableProduct, productLedgerState } from '@/lib/domain/product-lifecycle';
import type { PricingCalculationRule, PricingTaxRule } from '@/lib/domain/pricing-v25';
import { INTERIOR_EXTERIOR_CATEGORY_CODES } from '@/lib/domain/standard-estimate-pricing';
import type { V25EditorState, V25Preview } from '@/lib/domain/standard-estimate-v25-view';
import {
  slotIdentity,
  type V25WorkbenchBaseLine,
  type V25WorkbenchCandidate,
  type V25WorkbenchCosts,
  type V25WorkbenchPinnedCost,
} from '@/lib/domain/standard-estimate-v25-workbench';
import { FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';

/**
 * 見積書管理 ＞ 標準見積（Excel 風の画面）の読み込み（2026-10-27 先方方針：この画面を v2.5 の標準見積の正式な編集画面にする）。
 * 標準見積（機種 × 用途 × サイズ × 防火）の一覧と、選んだ標準見積の下書き（無ければ公開中の版）を読む。
 * 本部だけの画面。原価（本体・商品・選択肢）も画面の試算のために渡す。金額の正本は DB の計算。
 */

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type DbError = { code?: string } | null;

const PAGE_SIZE = 1000;

/** PostgREST は 1 回に返す行数に上限がある（既定 1,000 行）。黙って切れないよう、ページに分けて全件を読む */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`原価を取得できませんでした: ${error.code ?? 'unknown'}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}
type Store = Awaited<ReturnType<typeof getStore>>;
type PricingModel = 'legacy' | 'v2.5';

export interface StandardEstimateWorkspaceEntry {
  masterId: string;
  name: string;
  /** 機種 / 用途 / サイズ / 防火 */
  identity: string;
  modelId: string;
  specCode: string;
  published: { revisionId: string; version: number; total: number; hasPor: boolean; pricingModel: PricingModel } | null;
  draft: { revisionId: string; version: number; lockVersion: number; pricingModel: PricingModel } | null;
}

type RevisionRow = {
  id: string;
  standard_estimate_master_id: string;
  version: number;
  status: string;
  total: number;
  has_por: boolean;
  lock_version: number;
  pricing_model?: string | null;
};

const pricingModelOf = (row: RevisionRow): PricingModel => (row.pricing_model === 'v2.5' ? 'v2.5' : 'legacy');

/** 標準見積の一覧。表が無い（本体マスター・標準見積が未適用）なら null */
export async function listStandardEstimateWorkspaceEntries(supabase: SupabaseClient, store: Store): Promise<StandardEstimateWorkspaceEntry[] | null> {
  const [mastersResult, revisionsWithModel, matrix, models] = await Promise.all([
    supabase.from('standard_estimate_masters').select('id, base_master_id, base_model_id, spec_code, name, current_published_revision_id').order('name'),
    supabase
      .from('standard_estimate_revisions')
      .select('id, standard_estimate_master_id, version, status, total, has_por, lock_version, pricing_model')
      .in('status', ['draft', 'published']),
    store.getSpecMatrix(),
    store.listModels({ includeDraft: true }),
  ]);
  if (mastersResult.error) {
    if (isMissingRelation(mastersResult.error)) return null;
    throw new Error(`標準見積の一覧を取得できませんでした: ${mastersResult.error.code ?? 'unknown'}`);
  }
  // pricing_model（20261019100000）が無い DB では、すべて v2.5 以前の標準見積
  let revisionError = revisionsWithModel.error;
  let rows = (revisionsWithModel.data ?? []) as RevisionRow[];
  if (revisionError && isMissingColumn(revisionError)) {
    const fallback = await supabase
      .from('standard_estimate_revisions')
      .select('id, standard_estimate_master_id, version, status, total, has_por, lock_version')
      .in('status', ['draft', 'published']);
    revisionError = fallback.error;
    rows = (fallback.data ?? []) as RevisionRow[];
  }
  if (revisionError) throw new Error(`標準見積の版を取得できませんでした: ${revisionError.code ?? 'unknown'}`);
  const masters = mastersResult.data ?? [];
  const baseIds = [...new Set(masters.map((master) => master.base_master_id).filter(Boolean))];
  const { data: bases, error: baseError } = baseIds.length
    ? await supabase.from('base_masters').select('id, matrix_row_id, fire_spec_code').in('id', baseIds)
    : { data: [], error: null };
  if (baseError) throw new Error(`本体マスターを取得できませんでした: ${baseError.code ?? 'unknown'}`);
  const baseById = new Map((bases ?? []).map((base) => [base.id, base]));
  return masters.map((master) => {
    const base = baseById.get(master.base_master_id);
    const row = matrix?.rows.find((candidate) => candidate.id === base?.matrix_row_id);
    const identity = row
      ? [
          models.find((model) => model.id === row.base_model_id)?.name ?? '',
          matrix?.specs.find((spec) => spec.code === row.spec_code)?.label ?? row.spec_code,
          matrix?.sizes.find((size) => size.code === row.size_code)?.label ?? row.size_code,
          base?.fire_spec_code === 'fire' ? '防火' : '非防火',
        ].join(' / ')
      : master.name;
    const published = rows.find((revision) => revision.id === master.current_published_revision_id && revision.status === 'published') ?? null;
    const draft = rows.find((revision) => revision.standard_estimate_master_id === master.id && revision.status === 'draft') ?? null;
    return {
      masterId: master.id,
      name: master.name,
      identity,
      modelId: master.base_model_id,
      specCode: master.spec_code,
      published: published
        ? { revisionId: published.id, version: published.version, total: published.total, hasPor: published.has_por, pricingModel: pricingModelOf(published) }
        : null,
      draft: draft ? { revisionId: draft.id, version: draft.version, lockVersion: draft.lock_version, pricingModel: pricingModelOf(draft) } : null,
    };
  });
}

export interface StandardEstimateWorkspace {
  revision: {
    id: string;
    version: number;
    status: 'draft' | 'published';
    lockVersion: number;
    total: number;
    hasPor: boolean;
    pricingModel: PricingModel;
  };
  /** v2.5 の Revision のときだけ（v2.5 以前・未適用の DB では null） */
  v25: {
    initial: V25EditorState;
    preview: V25Preview | null;
    baseLines: V25WorkbenchBaseLine[];
    candidates: V25WorkbenchCandidate[];
    costs: V25WorkbenchCosts;
    rule: PricingCalculationRule;
    taxRule: PricingTaxRule;
  } | null;
}

/** 選んだ標準見積の作業する版（下書きがあれば下書き、無ければ公開中の版） */
export async function loadStandardEstimateWorkspace(
  supabase: SupabaseClient,
  entry: StandardEstimateWorkspaceEntry
): Promise<StandardEstimateWorkspace | null> {
  const revisionId = entry.draft?.revisionId ?? entry.published?.revisionId;
  if (!revisionId) return null;
  const { data: revision, error } = await supabase
    .from('standard_estimate_revisions')
    .select('id, version, status, base_master_revision_id, sales_fee_rate, expense_rate, markup_rate, standard_adjustment_amount, standard_adjustment_reason, total, has_por, lock_version')
    .eq('id', revisionId)
    .maybeSingle();
  if (error) throw new Error(`標準見積を取得できませんでした: ${error.code ?? 'unknown'}`);
  if (!revision) return null;
  const header = await getStandardEstimateV25Header(supabase, revision.id);
  const pricingModel: PricingModel = header?.pricing_model === 'v2.5' ? 'v2.5' : 'legacy';
  const summary = {
    id: revision.id,
    version: revision.version,
    status: (revision.status === 'draft' ? 'draft' : 'published') as 'draft' | 'published',
    lockVersion: revision.lock_version,
    total: revision.total,
    hasPor: revision.has_por,
    pricingModel,
  };
  if (!header || pricingModel !== 'v2.5' || !header.calc_rule_version_id || !header.tax_rule_version_id) {
    return { revision: summary, v25: null };
  }

  const [v25, baseResult, savedResult, ruleResult, taxResult, catalog] = await Promise.all([
    loadStandardEstimateV25(supabase, revision, header),
    supabase
      .from('base_master_revision_lines')
      .select('id, section, name, quantity, unit, unit_price, sort_order')
      .eq('revision_id', revision.base_master_revision_id)
      .order('sort_order'),
    supabase
      .from('standard_estimate_revision_baseline_items')
      .select('baseline_key, option_id, price_mode, section_code, option_name_snapshot, category_name_snapshot, standard_cost_version_id, standard_estimate_revision_baseline_variants(variant_choice_id, variant_cost_version_id)')
      .eq('revision_id', revision.id),
    supabase
      .from('pricing_calculation_rule_versions')
      .select('id, formula_code, rounding_mode, expense_target_sections, auto_price_sections')
      .eq('id', header.calc_rule_version_id)
      .maybeSingle(),
    supabase.from('tax_rule_versions').select('id, tax_mode, tax_rate, rounding_mode').eq('id', header.tax_rule_version_id).maybeSingle(),
    getPublicCatalog(),
  ]);
  for (const result of [baseResult, savedResult, ruleResult, taxResult]) {
    if (result.error) throw new Error(`標準見積の編集に必要な内容を取得できませんでした: ${result.error.code ?? 'unknown'}`);
  }
  if (!ruleResult.data || !taxResult.data) return { revision: summary, v25: null };

  // 商品の候補：その仕様でお客様が選べる商品（シミュレーターと同じ絞り込み。DB の保存でも確かめる）。
  // 新しく入れられるのは販売中の商品だけ。販売停止・廃番でも、この版に保存済みの商品は表示・保持のために渡す
  const bundle = catalog.bundles[entry.modelId] ?? null;
  const model = catalog.models.find((row) => row.id === entry.modelId) ?? null;
  const specCtx =
    bundle && model
      ? ruleContextForSpec(
          {
            options: bundle.options,
            categories: bundle.categories,
            dependencies: bundle.dependencies,
            conflicts: bundle.conflicts,
            customerCategoryMatrix: bundle.customerCategoryMatrix ?? null,
            canSelectNew: isQuoteSelectableProduct,
          },
          entry.specCode,
          model.slug
        )
      : null;
  const categoryById = new Map((bundle?.categories ?? []).map((category) => [category.id, category] as const));
  const savedOptionIds = new Set(v25.slotOptionIds);
  const candidates: V25WorkbenchCandidate[] = (specCtx?.options ?? [])
    .filter((option) => isQuoteSelectableProduct(option) || (productLedgerState(option) === 'retired' && savedOptionIds.has(option.id)))
    .map((option) => {
      const category = categoryById.get(option.category_id);
      const code = category?.code ?? '';
      const groups = (bundle?.variantGroups ?? []).filter((group) => group.option_id === option.id).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const defaults = new Set(bundle ? defaultVariantIdsFor(bundle.variantGroups, bundle.variantChoices, [option.id]) : []);
      return {
        id: option.id,
        name: option.name,
        categoryId: option.category_id,
        categoryName: category?.name ?? '未分類',
        manufacturer: option.manufacturer ?? '',
        modelNo: option.model_no ?? '',
        section: option.is_installation || code === FREE_PRODUCT_CATEGORY_CODE ? 'sitework' : INTERIOR_EXTERIOR_CATEGORY_CODES.has(code) ? 'interior_exterior' : 'option',
        retired: productLedgerState(option) === 'retired',
        variantGroups: groups.map((group) => ({
          id: group.id,
          name: group.name,
          choices: (bundle?.variantChoices ?? [])
            .filter((choice) => choice.group_id === group.id)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((choice) => ({ id: choice.id, name: choice.name })),
        })),
        defaultChoices: Object.fromEntries(
          groups.flatMap((group) => {
            const choice = (bundle?.variantChoices ?? []).find((row) => row.group_id === group.id && defaults.has(row.id));
            return choice ? [[group.id, choice.id] as const] : [];
          })
        ),
      };
    });

  type SavedRow = {
    baseline_key: string;
    option_id: string;
    price_mode: 'auto' | 'manual' | 'por' | null;
    section_code: 'interior_exterior' | 'option' | 'sitework';
    option_name_snapshot: string | null;
    category_name_snapshot: string | null;
    standard_cost_version_id: string | null;
    standard_estimate_revision_baseline_variants: { variant_choice_id: string; variant_cost_version_id: string | null }[] | null;
  };
  const savedRows = (savedResult.data ?? []) as unknown as SavedRow[];

  // 保存済みの行の商品が今はこの仕様で選べない（下書きに戻した・カテゴリーが × になった等）ときも、行を隠さずに出して削除できるようにする
  // （保存は DB が止める。区分は保存したときの区分）
  const candidateIdSet = new Set(candidates.map((candidate) => candidate.id));
  for (const row of savedRows) {
    if (candidateIdSet.has(row.option_id)) continue;
    candidateIdSet.add(row.option_id);
    candidates.push({
      id: row.option_id,
      name: row.option_name_snapshot ?? '（商品が見つかりません）',
      categoryId: '',
      categoryName: row.category_name_snapshot ?? '',
      manufacturer: '',
      modelNo: '',
      section: row.section_code,
      retired: true,
      unavailable: true,
      variantGroups: [],
      defaultChoices: {},
    });
  }

  // 原価（画面の試算だけに使う）：保存済みの auto の選択枠の固定した版（DB の保存と同じく「商品＋選択肢」ごと）と、今の版
  const autoRows = savedRows.filter((row) => row.price_mode === 'auto');
  const pinnedProductIds = autoRows.map((row) => row.standard_cost_version_id).filter((id): id is string => Boolean(id));
  const pinnedChoiceIds = autoRows
    .flatMap((row) => row.standard_estimate_revision_baseline_variants ?? [])
    .map((row) => row.variant_cost_version_id)
    .filter((id): id is string => Boolean(id));
  const [pinnedProducts, pinnedChoices, currentProducts, currentChoices] = await Promise.all([
    pinnedProductIds.length
      ? supabase.from('option_standard_cost_versions').select('id, standard_cost').in('id', pinnedProductIds)
      : Promise.resolve({ data: [], error: null }),
    pinnedChoiceIds.length
      ? supabase.from('option_variant_cost_versions').select('id, cost_adjustment').in('id', pinnedChoiceIds)
      : Promise.resolve({ data: [], error: null }),
    // 今の版は全件を読む（候補の ID を URL に並べない）
    readAll<{ option_id: string; standard_cost: number }>((from, to) =>
      supabase.from('option_standard_cost_versions').select('option_id, standard_cost').is('superseded_at', null).order('option_id').range(from, to)
    ),
    readAll<{ variant_choice_id: string; cost_adjustment: number }>((from, to) =>
      supabase.from('option_variant_cost_versions').select('variant_choice_id, cost_adjustment').is('superseded_at', null).order('variant_choice_id').range(from, to)
    ),
  ]);
  for (const result of [pinnedProducts, pinnedChoices]) {
    if (result.error) throw new Error(`原価を取得できませんでした: ${result.error.code ?? 'unknown'}`);
  }
  const pinnedProductCost = new Map(((pinnedProducts.data ?? []) as { id: string; standard_cost: number }[]).map((row) => [row.id, Number(row.standard_cost)]));
  const pinnedChoiceCost = new Map(((pinnedChoices.data ?? []) as { id: string; cost_adjustment: number }[]).map((row) => [row.id, Number(row.cost_adjustment)]));
  const pinned: Record<string, V25WorkbenchPinnedCost> = Object.fromEntries(
    autoRows.map((row) => {
      const variants = row.standard_estimate_revision_baseline_variants ?? [];
      return [
        slotIdentity(row.option_id, variants.map((variant) => variant.variant_choice_id)),
        {
          standard_cost: row.standard_cost_version_id ? (pinnedProductCost.get(row.standard_cost_version_id) ?? null) : null,
          variant_adjustments: Object.fromEntries(
            variants.map((variant) => [
              variant.variant_choice_id,
              variant.variant_cost_version_id ? (pinnedChoiceCost.get(variant.variant_cost_version_id) ?? null) : null,
            ])
          ),
        },
      ];
    })
  );
  const costs: V25WorkbenchCosts = {
    pinned,
    currentProduct: Object.fromEntries(currentProducts.map((row) => [row.option_id, Number(row.standard_cost)])),
    currentChoice: Object.fromEntries(currentChoices.map((row) => [row.variant_choice_id, Number(row.cost_adjustment)])),
  };
  return {
    revision: summary,
    v25: {
      initial: v25.initial,
      preview: v25.preview,
      baseLines: ((baseResult.data ?? []) as { id: string; section: string; name: string; quantity: number | string; unit: string | null; unit_price: number }[]).map(
        (line) => ({ id: line.id, section: line.section, name: line.name, quantity: String(Number(line.quantity)), unit: line.unit, standard_cost: Number(line.unit_price) })
      ),
      candidates,
      costs,
      rule: ruleResult.data as PricingCalculationRule,
      taxRule: taxResult.data as PricingTaxRule,
    },
  };
}
