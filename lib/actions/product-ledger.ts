'use server';

import { redirect } from 'next/navigation';
import { revalidatePath, updateTag } from 'next/cache';
import { requireCatalogEditor } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { getStore, StoreError } from '@/lib/data/store';

const ledgerPath = '/admin/ledger';

function ledgerRedirect(params: Record<string, string>): never {
  const search = new URLSearchParams(params);
  redirect(`${ledgerPath}?${search.toString()}`);
}

export async function deleteDraftProductFromLedgerAction(formData: FormData): Promise<void> {
  await requireCatalogEditor(ledgerPath);

  const id = String(formData.get('id') ?? '').trim();
  if (!id) ledgerRedirect({ error: '削除する商品を特定できませんでした。' });

  const store = await getStore();
  const option = await store.getOption(id);
  if (!option) ledgerRedirect({ error: '商品が見つかりません。' });
  if (option.status !== 'draft') {
    ledgerRedirect({ error: '登録済み商品は完全削除できません。' });
  }

  try {
    await store.deleteOption(id);
  } catch (error) {
    const message = error instanceof StoreError ? error.message : '商品の削除に失敗しました。';
    ledgerRedirect({ error: message });
  }

  revalidatePath('/', 'layout');
  updateTag(CATALOG_TAG);
  ledgerRedirect({ deleted: '1' });
}
