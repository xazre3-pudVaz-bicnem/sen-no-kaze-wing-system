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

const normalizedName = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('ja-JP');

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
    const requestedGroupName = normalizedName(formData.get('name'));
    const sameNameGroups = variants.groups.filter((row) => normalizedName(row.name) === requestedGroupName);
    const reusableGroup = sameNameGroups.find(
      (row) => !variants.choices.some((choice) => choice.group_id === row.id)
    );
    if (sameNameGroups.some((row) => row.id !== reusableGroup?.id)) {
      return {
        ok: false,
        fieldErrors: { name: ['同じ名前の選択項目がすでにあります。既存の選択項目へ選択肢を追加してください。'] },
      };
    }

    const groupId = reusableGroup?.id ?? randomUUID();
    const group = variantGroupSchema.safeParse({
      id: reusableGroup?.id ?? null,
      option_id: option.id,
      code: reusableGroup?.code ?? `vg-${randomUUID()}`,
      name: formData.get('name'),
      note: reusableGroup?.note ?? null,
      depends_on_group_code: reusableGroup?.depends_on_group_code ?? null,
      depends_on_choice_codes: reusableGroup?.depends_on_choice_codes ?? [],
      sort_order: reusableGroup?.sort_order ?? variants.groups.length,
      is_required: reusableGroup?.is_required ?? true,
      status: reusableGroup?.status ?? 'published',
    });
    if (!group.success) return { ok: false, fieldErrors: flattenErrors(group.error) };

    const additionalChoiceNames = formData
      .getAll('additional_choice_name')
      .map((value) => String(value).trim())
      .filter(Boolean);
    const choiceInputs = [
      {
        name: formData.get('first_choice_name'),
        kind: 'standard' as const,
        sortOrder: 0,
        fieldKey: 'first_choice_name',
      },
      ...additionalChoiceNames.map((name, index) => ({
        name,
        kind: 'option' as const,
        sortOrder: index + 1,
        fieldKey: 'additional_choice_name',
      })),
    ];

    const normalizedChoiceNames = choiceInputs.map((row) => normalizedName(row.name));
    if (new Set(normalizedChoiceNames).size !== normalizedChoiceNames.length) {
      return {
        ok: false,
        fieldErrors: { additional_choice_name: ['同じ選択肢名が重複しています。'] },
      };
    }

    const choices = [];
    for (const input of choiceInputs) {
      const parsed = variantChoiceSchema.safeParse({
        id: null,
        option_id: option.id,
        group_id: groupId,
        code: `vc-${randomUUID()}`,
        name: input.name,
        kind: input.kind,
        extra_price: 0,
        price_on_request: false,
        image_url: null,
        note: null,
        sort_order: input.sortOrder,
        status: 'published',
      });
      if (!parsed.success) {
        const errors = flattenErrors(parsed.error);
        return {
          ok: false,
          fieldErrors: {
            [input.fieldKey]: errors.name,
            _form: errors._form,
          },
        };
      }
      choices.push(parsed.data);
    }

    if (!reusableGroup) {
      await store.upsertVariantGroup({ ...group.data, id: groupId });
    }

    let savedChoiceCount = 0;
    try {
      for (const choice of choices) {
        await store.upsertVariantChoice({
          id: randomUUID(),
          group_id: choice.group_id,
          code: choice.code,
          name: choice.name,
          kind: choice.kind,
          extra_price: choice.extra_price,
          price_on_request: choice.price_on_request,
          image_url: choice.image_url,
          note: choice.note,
          sort_order: choice.sort_order,
          status: choice.status,
        });
        savedChoiceCount += 1;
      }
    } catch (error) {
      console.error('[wing] product variant choice create error', error);
      revalidatePath(`/admin/options/${option.id}`);
      return {
        ok: false,
        error:
          savedChoiceCount === 0
            ? '選択項目はありますが、選択肢を保存できませんでした。表示された選択項目から選択肢を追加してください。'
            : `選択項目と選択肢${savedChoiceCount}件は保存されましたが、残りの選択肢を保存できませんでした。表示された選択項目から不足分を追加してください。`,
      };
    }

    revalidatePath(`/admin/options/${option.id}`);
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    return {
      ok: true,
      message: reusableGroup
        ? `既存の選択項目へ選択肢${choices.length}件を追加しました。`
        : `選択項目と選択肢${choices.length}件を追加しました。`,
    };
  } catch (error) {
    return initialError(error);
  }
}
