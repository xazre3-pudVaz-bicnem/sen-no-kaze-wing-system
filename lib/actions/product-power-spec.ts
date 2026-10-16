'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { publishOptionAction } from '@/lib/actions/admin';
import { requireCatalogEditor, requireStaff } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { getStore, isLocalMode, type OptionInput } from '@/lib/data/store';
import {
  hasPowerSpec,
  normalizePowerSpec,
  productPowerSpec,
  productRequiresPowerSpec,
} from '@/lib/domain/product-power-spec';
import { createClient } from '@/lib/supabase/server';

export type PowerSpecSaveResult = {
  ok: boolean;
  error?: string;
  value?: string | null;
};

function previewErrorUrl(id: string, formData: FormData, message: string): string {
  const params = new URLSearchParams({ step: 'preview', error: message });
  const returnTo = String(formData.get('return_to') ?? '').trim();
  if (returnTo.startsWith('/admin/') && !returnTo.startsWith('//')) params.set('return_to', returnTo);
  return `/admin/options/${id}?${params.toString()}`;
}

/**
 * 商品本体の価格・選択ロジックには触れず、電源仕様の専用列だけを更新する。
 * Draftでは空欄保存を許可し、STEP2遷移・公開・登録済み編集時に必須判定する。
 */
export async function saveOptionPowerSpecAction(input: {
  optionId: string;
  powerSpec: string;
  requireComplete?: boolean;
}): Promise<PowerSpecSaveResult> {
  await requireCatalogEditor(`/admin/options/${input.optionId}`);
  const store = await getStore();
  const option = await store.getOption(input.optionId);
  if (!option) return { ok: false, error: '商品が見つかりません。' };

  const category = (await store.listCategories()).find((row) => row.id === option.category_id);
  if (!category) return { ok: false, error: '商品カテゴリーが見つかりません。' };

  const value = normalizePowerSpec(input.powerSpec);
  if (input.requireComplete && productRequiresPowerSpec(category.code) && !hasPowerSpec(value)) {
    return { ok: false, error: '電源仕様を入力してください' };
  }

  try {
    if (isLocalMode()) {
      const {
        id: optionId,
        product_no: _productNo,
        gallery_images: _galleryImages,
        created_at: _createdAt,
        updated_at: _updatedAt,
        ...editable
      } = option;
      await store.upsertOption({
        ...editable,
        id: optionId,
        power_spec: value,
      } as unknown as OptionInput);
    } else {
      const db = await createClient();
      const { data, error } = await db
        .from('options')
        .update({ power_spec: value })
        .eq('id', option.id)
        .select('id')
        .maybeSingle();
      if (error) {
        if (error.code === '42703' || error.code === 'PGRST204') {
          return { ok: false, error: '電源仕様のDB列がまだ適用されていません。migration適用後に保存してください。' };
        }
        return { ok: false, error: '電源仕様を保存できませんでした。' };
      }
      if (!data) return { ok: false, error: '商品を更新できませんでした。' };
    }
  } catch {
    return { ok: false, error: '電源仕様を保存できませんでした。' };
  }

  revalidatePath(`/admin/options/${option.id}`);
  revalidatePath('/', 'layout');
  updateTag(CATALOG_TAG);
  return { ok: true, value };
}

/**
 * STEP2の公開操作をサーバー側でも fail closed にする。
 * URL直打ち等でクライアント必須チェックを迂回しても、空調は電源仕様なしで公開できない。
 */
export async function publishOptionWithPowerSpecAction(formData: FormData): Promise<void> {
  await requireStaff();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/admin/options?error=' + encodeURIComponent('商品が指定されていません。'));

  const store = await getStore();
  const option = await store.getOption(id);
  if (!option) redirect(previewErrorUrl(id, formData, '商品が見つかりません。'));

  const category = (await store.listCategories()).find((row) => row.id === option.category_id);
  if (!category) redirect(previewErrorUrl(id, formData, '商品カテゴリーが見つかりません。'));

  if (productRequiresPowerSpec(category.code) && !hasPowerSpec(productPowerSpec(option))) {
    redirect(previewErrorUrl(id, formData, '電源仕様を入力してください'));
  }

  return publishOptionAction(formData);
}
