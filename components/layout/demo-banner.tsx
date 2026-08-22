import { isDemoFallback } from '@/lib/data/store';

/**
 * Supabase 未設定で自動的にローカル（デモ）モードになっているときの注意表示。
 * サーバーレス環境では一時領域に保存するため、データはインスタンスごと・再デプロイで消える。
 */
export function DemoBanner() {
  if (!isDemoFallback()) return null;
  return (
    <div role="status" className="bg-warn px-4 py-2 text-center text-xs font-semibold text-white">
      デモ環境（データベース未接続）：会員登録・保存・見積は動作しますが、データは一時的で再デプロイ時に消えます。本番運用には Vercel の環境変数に Supabase の設定が必要です。
    </div>
  );
}
