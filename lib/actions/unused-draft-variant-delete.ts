'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireCatalogEditor } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { getStore, isDemoFallback, isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { variantDeleteErrorMessage } from '@/lib/domain/variant-delete-errors';

/**
 * 下書き商品限定。削除の可否はDB RPCが同一トランザクションで最終判断する。
 * UIやgetOptionVariantsの事前チェックは権限・履歴ガードの代わりにならない。
 */
export async function deleteUnusedDraftVariantAction(formData: FormData): Promise<void> {
  await requireCatalogEditor();
  const optionId = String(formData.get('option_id') ?? '').trim();
  const groupId = String(formData.get('group_id') ?? '').trim();
  const choiceId = String(formData.get('choice_id') ?? '').trim();
  const target = String(formData.get('target') ?? '').trim();

  const errorPath = (reason: string) =>
    `/admin/options/${encodeURIComponent(optionId)}?step=info&error=${encodeURIComponent(reason)}#customer-selection`;

  if (!optionId || !groupId || !['choice', 'group'].includes(target) || (target === 'choice' && !choiceId)) {
    redirect('/admin/options?error=' + encodeURIComponent('削除対象を特定できませんでした。'));
  }

  const store = await getStore();
  const option = await store.getOption(optionId);
  if (!option || option.status !== 'draft') {
    redirect(errorPath('下書き商品以外の選択肢は、この画面から削除できません。'));
  }

  const variants = await store.getOptionVariants(optionId);
  const group = variants.groups.find((g) => g.id === groupId);
  const choice = variants.choices.find((c) => c.id === choiceId && c.group_id === groupId);
  if (!group || (target === 'choice' && !choice)) redirect(errorPath('対象の選択項目・選択肢が見つかりません。'));

  // DB未適用時・本番設定欠落時・ローカルではfail closed。画面から直接DELETEしない。
  if (isDemoFallback() || isLocalMode()) {
    redirect(errorPath('安全削除のDB機能が利用できません。削除せず、非表示にしてください。'));
  }

  const db = await createClient();
  const result = target === 'choice'
    ? await db.rpc('delete_unused_variant_choice', { p_option_id: optionId, p_choice_id: choiceId })
    : await db.rpc('delete_unused_variant_group', { p_option_id: optionId, p_group_id: groupId });

  if (result.error) {
    // DB は理由を文の先頭（FORBIDDEN・LOCKED・NOT_FOUND・VALIDATION）で返す。すべてを「使用中」にまとめない
    redirect(errorPath(variantDeleteErrorMessage(result.error)));
  }

  revalidatePath(`/admin/options/${optionId}`);
  revalidatePath('/admin/options');
  updateTag(CATALOG_TAG);
  redirect(`/admin/options/${encodeURIComponent(optionId)}?step=info&deleted_variant=1#customer-selection`);
}
