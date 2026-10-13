'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath, updateTag } from 'next/cache';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore, StoreError } from '@/lib/data/store';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { flattenErrors, variantChoiceSchema, variantGroupSchema, type FieldErrors } from '@/lib/validation';

export interface ProductVariantCreateState {
  ok: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
  message?: string;
}

const initialError = (error: unknown): ProductVariantCreateState => {
  if (error instanceof StoreError) return { ok: false, error: error.message };
  console.error('[wing] product variant create error', error);
  return { ok: false, error: '選択項目の登録中にエラーが発生しました。' };
};

export async function createVariantGroupWithFirstChoiceAction(
  _prev: ProductVariantCreateState,
  formData: FormData
): Promise<ProductVariantCreateState> {
  await requireCatalogEditor();

  const optionId = String(formData.get('option_id') ?? '').trim();
  if (!optionId) return { ok: false, error: '商品が指定されていません。' };

  try {
    const store = await getStore();
    const option = await store.getOption(optionId);
    if (!option) return { ok: false, error: '商品が見つかりません。' };

    const variants = await store.getOptionVariants(option.id);
    const groupId = randomUUID();
    const choiceId = randomUUID();

    const group = variantGroupSchema.safeParse({
      id: null,
      option_id: option.id,
      code: `vg-${randomUUID()}`,
      name: formData.get('name'),
      note: null,
      depends_on_group_code: null,
      depends_on_choice_codes: [],
      sort_order: variants.groups.length,
      is_required: true,
      status: 'published',
    });
    if (!group.success) return { ok: false, fieldErrors: flattenErrors(group.error) };

    const choice = variantChoiceSchema.safeParse({
      id: null,
      option_id: option.id,
      group_id: groupId,
      code: `vc-${randomUUID()}`,
      name: formData.get('first_choice_name'),
      kind: 'standard',
      extra_price: 0,
      price_on_request: false,
      image_url: null,
      note: null,
      sort_order: 0,
      status: 'published',
    });
    if (!choice.success) {
      const errors = flattenErrors(choice.error);
      return {
        ok: false,
        fieldErrors: {
          first_choice_name: errors.name,
          _form: errors._form,
        },
      };
    }

    await store.upsertVariantGroup({ ...group.data, id: groupId });
    try {
      await store.upsertVariantChoice({ ...choice.data, id: choiceId });
    } catch {
      revalidatePath(`/admin/options/${option.id}`);
      return {
        ok: false,
        error: '選択項目は作成されましたが、標準の選択肢を保存できませんでした。表示された選択項目から選択肢を追加してください。',
      };
    }

    revalidatePath(`/admin/options/${option.id}`);
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    return { ok: true, message: '選択項目と標準の選択肢を追加しました。' };
  } catch (error) {
    return initialError(error);
  }
}
