'use server';

import { redirect } from 'next/navigation';
import { revalidatePath, updateTag } from 'next/cache';
import { requireCatalogEditor } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { getStore, StoreError, type ProductLifecycleAction } from '@/lib/data/store';
import { productLifecycleEnabled } from '@/lib/domain/product-lifecycle';

const ledgerPath = '/admin/ledger';
const ACTIONS: readonly ProductLifecycleAction[] = ['retire', 'resume', 'show_in_simulator', 'hide_from_simulator'];
/** 完了後に商品台帳で出すお知らせ（app/admin/ledger/page.tsx の PRODUCT_LIFECYCLE_DONE）。retire＝販売停止（#500 の取扱終了） */
const DONE: Record<ProductLifecycleAction, string> = {
  retire: 'retired',
  resume: 'resumed',
  show_in_simulator: 'simulator_shown',
  hide_from_simulator: 'simulator_hidden',
};

function ledgerRedirect(params: Record<string, string>): never {
  redirect(`${ledgerPath}?${new URLSearchParams(params).toString()}`);
}

/**
 * 商品の状態を変える（販売停止・販売の再開・シミュレーターに表示する／しない）。
 * 画面が読んだ版（updated_at）と一致するときだけ更新し、0 件なら失敗にする（古い画面の操作を成功扱いにしない）。
 * 参照保護（必須・初期選択・前提商品）・廃番の商品の再開の拒否などの判定は DB のトリガーが行う（20261020110000）。
 * 販売の再開は、仕様・供給・価格の確認のチェックが必要（2026-10-19 の先方回答）。
 * 権限は従来の商品台帳の編集権限（requireCatalogEditor）のまま。#502 の未確定事項（総代理店の編集権限）はここで変えない。
 */
export async function setProductLifecycleAction(formData: FormData): Promise<void> {
  await requireCatalogEditor(ledgerPath);

  const id = String(formData.get('id') ?? '').trim();
  const action = String(formData.get('action') ?? '').trim() as ProductLifecycleAction;
  const expectedUpdatedAt = String(formData.get('expected_updated_at') ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !ACTIONS.includes(action) || !expectedUpdatedAt) {
    ledgerRedirect({ error: '商品状態を変更できませんでした。再読み込みしてから、もう一度操作してください。' });
  }

  if (action === 'resume' && formData.get('resume_confirmed') !== '1') {
    ledgerRedirect({ error: '販売を再開する前に、仕様・供給・価格を確認してチェックを入れてください。', product: id });
  }

  const store = await getStore();
  if (!productLifecycleEnabled(await store.getProductLifecycleCapability())) {
    ledgerRedirect({ error: '商品状態の機能は、DB の更新が済むまで使えません。', product: id });
  }
  try {
    await store.setProductLifecycle({ id, action, expectedUpdatedAt });
  } catch (e) {
    ledgerRedirect({ error: e instanceof StoreError ? e.message : '商品状態の変更に失敗しました。', product: id });
  }

  revalidatePath('/', 'layout');
  updateTag(CATALOG_TAG);
  ledgerRedirect({ lifecycle: DONE[action], product: id });
}

/**
 * 廃番にする（販売停止の商品だけ）／取り消す（本部の管理者だけ・販売停止に戻る）。理由は必須で、変更履歴に残す。
 * 判定・権限は DB の set_option_discontinued とトリガーが行う（20261020110000）。画面が読んだ版でなければ失敗にする。
 */
export async function setProductDiscontinuedAction(formData: FormData): Promise<void> {
  const actor = await requireCatalogEditor(ledgerPath);

  const id = String(formData.get('id') ?? '').trim();
  const mode = String(formData.get('mode') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const expectedUpdatedAt = String(formData.get('expected_updated_at') ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || (mode !== 'discontinue' && mode !== 'restore') || !expectedUpdatedAt) {
    ledgerRedirect({ error: '商品状態を変更できませんでした。再読み込みしてから、もう一度操作してください。' });
  }
  if (!reason || reason.length > 500) {
    ledgerRedirect({ error: '理由を 500 文字以内で入力してください。', product: id });
  }

  const store = await getStore();
  const capability = await store.getProductLifecycleCapability();
  if (!productLifecycleEnabled(capability) || !capability.discontinue) {
    ledgerRedirect({ error: '廃番の機能は、DB の更新が済むまで使えません。', product: id });
  }
  try {
    await store.setProductDiscontinued({ id, discontinued: mode === 'discontinue', reason, expectedUpdatedAt }, actor);
  } catch (e) {
    ledgerRedirect({ error: e instanceof StoreError ? e.message : '商品状態の変更に失敗しました。', product: id });
  }

  revalidatePath('/', 'layout');
  updateTag(CATALOG_TAG);
  ledgerRedirect({ lifecycle: mode === 'discontinue' ? 'discontinued' : 'restored', product: id });
}
