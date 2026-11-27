import 'server-only';
import { getStore, StoreError, type SessionUser } from '@/lib/data/store';

export type IncludedCategoryRead =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };

const INCONSISTENT_PREFIX = '設備包含設定の保存内容に不整合';

/**
 * 保存済みの設備包含（#628・#631）を DataStore から読む。
 * 本番はログインした利用者として読み（管理用のキーは使わない）、ローカル検証モードも同じ範囲で読む。
 * 読めないときは ok: false（画面は STEP 2・公開を止める）
 */
export async function readOptionIncludedCategories(actor: SessionUser | null, optionId: string): Promise<IncludedCategoryRead> {
  try {
    const store = await getStore();
    return { ok: true, ids: await store.listOptionIncludedCategoryIds(actor, optionId) };
  } catch (error) {
    console.error('[wing] inclusion read failed', error instanceof StoreError ? { code: error.code, message: error.message } : error);
    if (error instanceof StoreError && error.message.startsWith(INCONSISTENT_PREFIX)) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: '設備包含設定を読み込めません。再読み込みしてください。' };
  }
}
