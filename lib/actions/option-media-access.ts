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
