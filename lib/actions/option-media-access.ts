import 'server-only';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';
import { getStore, StoreError, type SessionUser } from '@/lib/data/store';

/**
 * 商品の画像・メーカー資料を編集できるか。DB の options_admin・option_images_write・apply_option_media_changes と同じ決まり：
 * 商品台帳を編集できる人、または旧フリー商品の持ち主の担当者。
 * 'use server' のファイルから出すとブラウザから呼べる関数になる（利用者を引数で受け取れてしまう）ので、ここに置く
 */
export async function editableOptionContext(actor: SessionUser, optionId: string) {
  const store = await getStore();
  const option = await store.getOption(optionId);
  if (!option) throw new StoreError('NOT_FOUND', '商品が見つかりません。');
  if (canEditCatalog(actor.role)) return { store, option };

  const category = (await store.listCategories()).find((row) => row.id === option.category_id);
  if (actor.role !== 'customer' && option.owner_id === actor.id && category?.code === FREE_PRODUCT_CATEGORY_CODE) {
    return { store, option };
  }
  throw new StoreError('FORBIDDEN', 'この商品のメディアは編集できません。');
}

/**
 * 旧来の追加画像・メーカー資料の操作（商品登録の STEP 1 の画面。1 件ずつ DB と Storage を書き換える）は、下書きの商品だけ。
 * 登録済みの商品は、商品の変更確認（STEP 2）から apply_option_media_changes でまとめて反映する
 * （行ロック・開いた時点の状態の照合・履歴・参照の確認を通さずに変えない。PR #563 の独立レビューの指摘）
 */
export async function draftMediaContext(actor: SessionUser, optionId: string) {
  const context = await editableOptionContext(actor, optionId);
  if (context.option.status === 'published') {
    throw new StoreError('VALIDATION', '登録済みの商品の追加画像・メーカー資料は、商品の変更確認（STEP 2）からまとめて反映してください。');
  }
  return context;
}
