import 'server-only';
import { unstable_cache } from 'next/cache';
import type { StandardEstimateSaleView } from '@/lib/domain/standard-estimate-sale-view';
import { CATALOG_TAG } from './public-catalog';
import { isMissingNamedFunction } from './schema-compat';
import { isLocalMode } from './store';

/**
 * 公開中の新しい標準見積を、売価だけの形で取得する（get_standard_estimate_sale_views。原価・社内の率は含まれない）。
 * ローカル検証モードと、関数が無い DB（migration 未適用）では空（シミュレーターは従来の計算のまま）。
 */
async function fetchStandardEstimateSaleViews(baseModelId: string): Promise<StandardEstimateSaleView[]> {
  if (isLocalMode()) return [];
  const { createPublicClient } = await import('@/lib/supabase/public');
  const db = createPublicClient();
  const { data, error } = await db.rpc('get_standard_estimate_sale_views', { p_base_model_id: baseModelId });
  if (error) {
    if (isMissingNamedFunction(error, 'get_standard_estimate_sale_views')) return [];
    throw new Error(`standard estimate sale views: ${error.message}`);
  }
  return (data ?? []) as StandardEstimateSaleView[];
}

/** 公開ページ用。標準見積を公開すると revalidateTag(CATALOG_TAG) で破棄される */
export const getStandardEstimateSaleViews = unstable_cache(fetchStandardEstimateSaleViews, ['standard-estimate-sale-views-v1'], {
  tags: [CATALOG_TAG],
  revalidate: 300,
});
