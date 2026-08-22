import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * service role クライアント（RLS をバイパス）。
 * 見積PDFの保存・管理画面の画像アップロードなど、サーバー側で権限確認済みの処理だけに使う。
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY が未設定です（.env.example 参照）');
  }
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
