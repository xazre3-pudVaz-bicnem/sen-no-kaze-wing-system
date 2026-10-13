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
