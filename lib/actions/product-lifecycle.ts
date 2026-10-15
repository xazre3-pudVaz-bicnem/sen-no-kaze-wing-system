'use server';

import { redirect } from 'next/navigation';
import { revalidatePath, updateTag } from 'next/cache';
import { requireCatalogEditor } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { createClient } from '@/lib/supabase/server';

const ledgerPath = '/admin/ledger';

function ledgerRedirect(params: Record<string, string>): never {
  redirect(`${ledgerPath}?${new URLSearchParams(params).toString()}`);
}

async function refreshCatalogAndLedger() {
  revalidatePath('/', 'layout');
  updateTag(CATALOG_TAG);
}

export async function setProductHandlingStateAction(formData: FormData): Promise<void> {
  await requireCatalogEditor(ledgerPath);

  const id = String(formData.get('id') ?? '').trim();
  const next = String(formData.get('next') ?? '').trim();
  if (!id || (next !== 'retire' && next !== 'resume')) {
    ledgerRedirect({ error: '商品状態を変更できませんでした。' });
  }

  const db = await createClient();
  const current = await db.from('options').select('id,status,archived_at').eq('id', id).maybeSingle();
  if (current.error) ledgerRedirect({ error: '商品状態を確認できませんでした。' });
  if (!current.data) ledgerRedirect({ error: '商品が見つかりません。' });
  if (current.data.status !== 'published') {
    ledgerRedirect({ error: '下書きは取扱終了にせず、不要な場合は削除してください。' });
  }

  if (next === 'retire' && current.data.archived_at) {
    ledgerRedirect({ error: 'この商品はすでに取扱終了です。' });
  }
  if (next === 'resume' && !current.data.archived_at) {
    ledgerRedirect({ error: 'この商品はすでに登録済みです。' });
  }

  const patch = next === 'retire' ? { archived_at: new Date().toISOString() } : { archived_at: null };
  const updated = await db.from('options').update(patch).eq('id', id).eq('status', 'published');
  if (updated.error) ledgerRedirect({ error: '商品状態の変更に失敗しました。' });

  await refreshCatalogAndLedger();
  ledgerRedirect(next === 'retire' ? { retired: '1', product: id } : { resumed: '1', product: id });
}

export async function setProductSimulatorVisibilityAction(formData: FormData): Promise<void> {
  await requireCatalogEditor(ledgerPath);

  const id = String(formData.get('id') ?? '').trim();
  const visible = String(formData.get('visible') ?? '').trim();
  if (!id || (visible !== '1' && visible !== '0')) {
    ledgerRedirect({ error: 'シミュレーター表示設定を変更できませんでした。' });
  }

  const db = await createClient();
  const current = await db.from('options').select('id,status,archived_at').eq('id', id).maybeSingle();
  if (current.error) ledgerRedirect({ error: '商品状態を確認できませんでした。' });
  if (!current.data) ledgerRedirect({ error: '商品が見つかりません。' });
  if (current.data.status !== 'published' || current.data.archived_at) {
    ledgerRedirect({ error: 'シミュレーター表示は取扱中の登録済み商品で設定してください。' });
  }

  const updated = await db
    .from('options')
    .update({ simulator_visible: visible === '1' })
    .eq('id', id)
    .eq('status', 'published')
    .is('archived_at', null);
  if (updated.error) ledgerRedirect({ error: 'シミュレーター表示設定の変更に失敗しました。' });

  await refreshCatalogAndLedger();
  ledgerRedirect({ simulator_visibility_updated: '1', product: id });
}
