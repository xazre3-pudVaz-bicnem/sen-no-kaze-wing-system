'use server';

import { redirect } from 'next/navigation';
import { revalidatePath, updateTag } from 'next/cache';
import { requireCatalogEditor } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { getStore, isDemoFallback, isLocalMode, StoreError } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';

const DELETE_NOT_AVAILABLE = '登録済み商品の削除機能はDB反映待ちです。反映完了後にもう一度お試しください。';

function safeMessage(message: string) {
  return message.replace(/^(VALIDATION|FORBIDDEN|NOT_FOUND|UNAUTHENTICATED):\s*/, '').trim();
}

function optionPath(id: string, error: string) {
  return `/admin/options/${encodeURIComponent(id)}?error=${encodeURIComponent(error)}`;
}

/**
 * 誤登録・動作確認用などの「登録済みだが一度も業務利用されていない商品」だけを削除する。
 * 本番はDB RPC側で参照確認とDELETEを同一transactionに閉じ、UI/APIの事前判定だけには依存しない。
 */
export async function deleteUnusedPublishedOptionAction(formData: FormData): Promise<void> {
  await requireCatalogEditor();

  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/admin/options?error=' + encodeURIComponent('商品IDがありません。'));

  const store = await getStore();
  const option = await store.getOption(id);
  if (!option) redirect('/admin/options?error=' + encodeURIComponent('商品が見つかりません。'));
  if (option.status !== 'published') {
    redirect(optionPath(id, 'この操作は登録済み商品の誤登録削除専用です。下書き商品は下書き画面から削除してください。'));
  }

  let errorMessage: string | null = null;

  if (isDemoFallback()) {
    // Supabase環境変数の欠落を「ローカル検証モード」とみなして破壊的操作を成功させない。
    // 明示的 WING_LOCAL_MODE=1 のときだけLocalStore削除を許可する。
    errorMessage = DELETE_NOT_AVAILABLE;
  } else if (isLocalMode()) {
    try {
      await store.deleteOption(id);
    } catch (error) {
      errorMessage = error instanceof StoreError ? error.message : '削除処理に失敗しました。';
    }
  } else {
    const db = await createClient();
    const { error } = await db.rpc('delete_unused_published_option', { p_option_id: id });
    if (error) {
      if (error.code === 'PGRST202') errorMessage = DELETE_NOT_AVAILABLE;
      else errorMessage = safeMessage(error.message || '削除処理に失敗しました。');
    }
  }

  if (errorMessage) redirect(optionPath(id, errorMessage));

  revalidatePath('/admin/options');
  revalidatePath('/admin/ledger');
  updateTag(CATALOG_TAG);
  redirect('/admin/options?deleted=1');
}
