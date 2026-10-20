'use server';

import { redirect } from 'next/navigation';
import { revalidatePath, updateTag } from 'next/cache';
import { requireCatalogEditor } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { getStore, StoreError, type ProductLifecycleAction } from '@/lib/data/store';
import { productLifecycleEnabled } from '@/lib/domain/product-lifecycle';

const ledgerPath = '/admin/ledger';
const ACTIONS: readonly ProductLifecycleAction[] = ['retire', 'resume', 'show_in_simulator', 'hide_from_simulator'];
/** 完了後に商品台帳で出すお知らせ（app/admin/ledger/page.tsx の PRODUCT_LIFECYCLE_DONE） */
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
 * 商品の状態を変える（取扱終了・取扱再開・シミュレーターに表示する／しない）。
 * 画面が読んだ版（updated_at）と一致するときだけ更新し、0 件なら失敗にする（古い画面の操作を成功扱いにしない）。
 * 参照保護（公開中の標準見積・Excel 標準の基準商品・必須・初期選択・前提商品・本体の仕様）などの判定は DB のトリガーが行う。
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
