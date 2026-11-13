import 'server-only';
import { isLocalMode } from '@/lib/data/store';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';

export type IncludedCategoryRead =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };

/** Always read the persisted relation with the user's session, never an admin/service key. */
export async function readOptionIncludedCategories(optionId: string): Promise<IncludedCategoryRead> {
  if (isLocalMode() || !hasSupabaseEnv()) {
    return { ok: false, error: '設備包含設定のDB読込ができません。公開・保存は行わないでください。' };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('option_included_categories')
      .select('included_category_id')
      .eq('option_id', optionId);
    if (error || !data) {
      console.error('[wing] inclusion read failed', { code: error?.code, message: error?.message });
      return { ok: false, error: '設備包含設定を読み込めません。再読み込みしてください。' };
    }
    const ids = data.map((row) => row.included_category_id);
    if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      return { ok: false, error: '設備包含設定の保存内容に不整合があります。管理者に確認してください。' };
    }
    return { ok: true, ids: ids.sort() };
  } catch (error) {
    console.error('[wing] inclusion read exception', error);
    return { ok: false, error: '設備包含設定を読み込めません。再読み込みしてください。' };
  }
}
