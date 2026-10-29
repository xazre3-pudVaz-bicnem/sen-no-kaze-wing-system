import 'server-only';
import { unstable_cache } from 'next/cache';
import type { V25MissingUnit } from '@/lib/domain/standard-estimate-pricing';
import { v25ConfigurationPricing, v25UnitKey, type StandardEstimateSaleView } from '@/lib/domain/standard-estimate-sale-view';
import type { CatalogBundle, PricingResult } from '@/lib/domain/types';
import type { ExteriorFaceSelection } from '@/lib/domain/exterior-wall';
import { CATALOG_TAG } from './public-catalog';
import { isMissingNamedFunction } from './schema-compat';
import { isLocalMode } from './store';

/**
 * 公開中の新しい標準見積を、売価だけの形で取得する（get_standard_estimate_sale_views。原価・社内の率・備考は含まれない）。
 * この関数はサーバー側（service role）だけが呼べる。シミュレーターのページがサーバーで呼び、ブラウザへは結果だけを渡す。
 * ローカル検証モードと、関数が無い DB（migration 未適用）では空（シミュレーターは従来の計算のまま）。
 */
async function fetchStandardEstimateSaleViews(baseModelId: string): Promise<StandardEstimateSaleView[]> {
  if (isLocalMode()) return [];
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[wing] SUPABASE_SERVICE_ROLE_KEY が未設定のため、新しい標準見積はシミュレーターに使いません');
    return [];
  }
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const db = createAdminClient();
  const { data, error } = await db.rpc('get_standard_estimate_sale_views', { p_base_model_id: baseModelId });
  if (error) {
    if (isMissingNamedFunction(error, 'get_standard_estimate_sale_views')) return [];
    throw new Error(`standard estimate sale views: ${error.message}`);
  }
  return (data ?? []) as StandardEstimateSaleView[];
}

/** 公開ページ用。標準見積を公開すると updateTag(CATALOG_TAG) で破棄される */
export const getStandardEstimateSaleViews = unstable_cache(fetchStandardEstimateSaleViews, ['standard-estimate-sale-views-v1'], {
  tags: [CATALOG_TAG],
  revalidate: 300,
});

/**
 * 公開中の v2.5 の標準見積を、売価だけの形（選択肢の組み合わせごとの売価の表つき）で取得する（get_simulator_v25_sale_views。v2.5 PR-C1）。
 * 原価・率・原価の Version は含まれない。サーバー側（service role）だけが呼べる。
 * 関数が無い DB（20261029100000 が未適用）では null（v2.5 以前の売価の取得を使う）
 */
async function fetchSimulatorV25SaleViews(baseModelId: string): Promise<StandardEstimateSaleView[] | null> {
  if (isLocalMode()) return null;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const db = createAdminClient();
  const { data, error } = await db.rpc('get_simulator_v25_sale_views', { p_base_model_id: baseModelId });
  if (error) {
    if (isMissingNamedFunction(error, 'get_simulator_v25_sale_views')) return null;
    throw new Error(`simulator v2.5 sale views: ${error.message}`);
  }
  return (data ?? []) as StandardEstimateSaleView[];
}

/** 標準見積の公開・原価の変更（商品の保存）で updateTag(CATALOG_TAG) により破棄される */
export const getSimulatorV25SaleViews = unstable_cache(fetchSimulatorV25SaleViews, ['simulator-v25-sale-views-v1'], {
  tags: [CATALOG_TAG],
  revalidate: 300,
});

/**
 * 売価の表に無い「商品＋選択肢」（組み合わせが多い商品）の v2.5 の売価を、サーバー（service role）で計算する（get_simulator_v25_units）。
 * 売価だけを返す。版ごとに 200 件ずつ。結果のキーは v25UnitKey。呼んでよいか（スイッチ・本部のプレビュー）は呼び出し側で決める
 */
export async function fetchSimulatorV25Units(items: V25MissingUnit[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (items.length === 0 || isLocalMode() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return out;
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const db = createAdminClient();
  const byRevision = new Map<string, V25MissingUnit[]>();
  for (const item of items) byRevision.set(item.revision_id, [...(byRevision.get(item.revision_id) ?? []), item]);
  for (const [revisionId, list] of byRevision) {
    for (let start = 0; start < list.length; start += 200) {
      const chunk = list.slice(start, start + 200);
      const { data, error } = await db.rpc('get_simulator_v25_units', {
        p_revision_id: revisionId,
        p_items: chunk.map((item) => ({ option_id: item.option_id, choice_ids: item.choice_ids })),
      });
      if (error) throw new Error(`simulator v2.5 units: ${error.message}`);
      const units = (Array.isArray(data) ? data : []) as Array<number | null>;
      // 結果が足りなければ価格未確定（null）として扱う（安全側）
      chunk.forEach((item, index) => out.set(v25UnitKey(revisionId, item.option_id, item.choice_ids), units[index] ?? null));
    }
  }
  return out;
}

/**
 * 保存した仕様の画面に出す v2.5 の金額（見積依頼の確認画面・本部の保存プランの画面）。
 * 売価の表に無い組み合わせは、サーバーで計算してから求める（金額の正本は DB の保存・見積依頼）
 */
export async function resolvedV25ConfigurationPricing(
  bundle: CatalogBundle,
  views: StandardEstimateSaleView[],
  input: { specCode: string | null; optionIds: string[]; variantChoiceIds: string[]; exteriorFaces: ExteriorFaceSelection[] }
): Promise<PricingResult> {
  const first = v25ConfigurationPricing(bundle, views, input);
  if (first.missing.length === 0) return first.pricing;
  return v25ConfigurationPricing(bundle, views, input, await fetchSimulatorV25Units(first.missing)).pricing;
}

/**
 * シミュレーターの新価格へ切り替えるスイッチ（20261013210000）。本部が入れるまでは false（現在のサイト価格を維持する）。
 * スイッチの関数が無い DB（migration 未適用）では、20261013200000 の時点の動き（標準状態の商品があれば新しい計算）に合わせず、
 * 安全側の false にする（サイトの新価格への切り替えは、先方の最終確認のあとに本部が明示的に行う）。
 */
async function fetchSimulatorStandardPricingEnabled(): Promise<boolean> {
  if (isLocalMode()) return false;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const db = createAdminClient();
  const { data, error } = await db.rpc('simulator_standard_pricing_enabled');
  if (error) {
    if (isMissingNamedFunction(error, 'simulator_standard_pricing_enabled')) return false;
    throw new Error(`simulator standard pricing switch: ${error.message}`);
  }
  return data === true;
}

/** スイッチを切り替えると updateTag(CATALOG_TAG) で破棄される */
export const getSimulatorStandardPricingEnabled = unstable_cache(
  fetchSimulatorStandardPricingEnabled,
  ['simulator-standard-pricing-enabled-v1'],
  { tags: [CATALOG_TAG], revalidate: 300 }
);

/**
 * シミュレーターに渡す売価（新しい標準見積）。
 * - スイッチが入っていれば、お客様にも新しい標準見積の価格を使う
 * - スイッチが切れている間は空（現在のサイト価格）。本部のプレビュー（preview）だけ、切り替え前の確認用に新しい価格を使う
 * - v2.5 の売価の取得（20261029100000）がある DB では、v2.5 の標準見積だけを使う（v25: true）。
 *   v2.5 以前の標準見積は商品価格の列（今は原価）で差額を出すため使わない。画面へ渡すカタログからは原価を外す（ページ側）
 */
export async function getSimulatorSaleViews(
  baseModelId: string,
  opts: { preview: boolean }
): Promise<{ saleViews: StandardEstimateSaleView[]; switchedOn: boolean; v25: boolean }> {
  const switchedOn = await getSimulatorStandardPricingEnabled();
  if (!switchedOn && !opts.preview) return { saleViews: [], switchedOn, v25: false };
  const v25Views = await getSimulatorV25SaleViews(baseModelId);
  if (v25Views !== null) return { saleViews: v25Views, switchedOn, v25: true };
  return { saleViews: await getStandardEstimateSaleViews(baseModelId), switchedOn, v25: false };
}
