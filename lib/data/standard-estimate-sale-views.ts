import 'server-only';
import { unstable_cache } from 'next/cache';
import type { StandardEstimateSaleView } from '@/lib/domain/standard-estimate-sale-view';
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
 */
export async function getSimulatorSaleViews(
  baseModelId: string,
  opts: { preview: boolean }
): Promise<{ saleViews: StandardEstimateSaleView[]; switchedOn: boolean }> {
  const switchedOn = await getSimulatorStandardPricingEnabled();
  if (!switchedOn && !opts.preview) return { saleViews: [], switchedOn };
  return { saleViews: await getStandardEstimateSaleViews(baseModelId), switchedOn };
}
