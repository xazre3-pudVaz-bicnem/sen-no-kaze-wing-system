import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * 公開データ専用の Supabase クライアント（Cookie を読まない）。
 * unstable_cache の中ではリクエスト固有の Cookie/ヘッダーを参照できないため、
 * 匿名キーでの公開読み取り（RLS の published 行）だけに使う。
 */
export function createPublicClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
