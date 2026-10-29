'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath, updateTag } from 'next/cache';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore, StoreError } from '@/lib/data/store';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { flattenErrors, variantChoiceSchema, variantGroupSchema, type FieldErrors } from '@/lib/validation';
import { parseChoiceExtraPrice } from '@/lib/domain/product-variant-creation-prices';
import {
  canEditCostField,
  COST_ACCESS_ERROR_MESSAGE,
  costRecordingNotice,
  getCostAccessForProduct,
  recordPublishedChoiceCosts,
} from '@/lib/data/option-cost-recording';
import { newChoicePriceWithoutCost } from '@/lib/domain/option-cost-access';

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

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

function selectedChoiceImage(formData: FormData, choiceIndex: number): File | null {
  const value = formData.get(`choice_image_file_${choiceIndex}`);
  return value instanceof File && value.size > 0 ? value : null;
}

function selectedChoiceImageUrl(formData: FormData, choiceIndex: number): string {
  return String(formData.get(`choice_image_url_${choiceIndex}`) ?? '').trim();
}

// 外部 URL はサーバー側で取得せず、表示用 URL として保存する。
function isAllowedChoiceImageUrl(value: string): boolean {
  if (!value || value.length > 1000) return false;
  if (value.startsWith('/images/')) return !/[\\\s<>]/.test(value);
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

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
    // 原価差額（v2.5 PR-A3）：原価の Version の仕組みがある間は、本部商品の金額は本部だけが入れられる。それ以外の担当者の追加は 0 円。
    // 本部商品の外（旧フリー商品）は従来どおり
    const costAccess = await getCostAccessForProduct(() => store.listCategories(), option.category_id);
    if (costAccess.error) return { ok: false, error: COST_ACCESS_ERROR_MESSAGE };
    const canEditCost = canEditCostField(costAccess);

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

    const standardIndex = Number(formData.get('standard_choice_index') ?? 0);
    const additionalChoiceNames = formData.getAll('additional_choice_name');
    if (!Number.isSafeInteger(standardIndex) || standardIndex < 0 || standardIndex > additionalChoiceNames.length) {
      return { ok: false, fieldErrors: { _form: ['標準の選択肢を確認してください。'] } };
    }

    // 価格・画像は画面上の元の行番号で受け取る。標準を切り替えても選択肢と取り違えない。
    const choicePrices = Array.from({ length: additionalChoiceNames.length + 1 }, (_, index) =>
      canEditCost ? parseChoiceExtraPrice(formData, index) : 0
    );
    const invalidPriceIndex = choicePrices.findIndex((price) => price === null);
    if (invalidPriceIndex >= 0) {
      return {
        ok: false,
        fieldErrors: {
          _form: [`選択肢${invalidPriceIndex + 1}の原価差額は、0〜100,000,000円の整数で入力してください。`],
        },
      };
    }

    // 画像と追加金額は画面上の元の行番号で受け取る。
    const additionalInputs = additionalChoiceNames
      .map((raw, index) => ({
        name: String(raw).trim(),
        choiceIndex: index >= standardIndex ? index + 1 : index,
      }));
    if (additionalInputs.some((row) => !row.name && (
      selectedChoiceImage(formData, row.choiceIndex) ||
      selectedChoiceImageUrl(formData, row.choiceIndex) ||
      choicePrices[row.choiceIndex] !== 0
    ))) {
      return {
        ok: false,
        fieldErrors: { additional_choice_name: ['画像または原価差額を指定した選択肢には名前を入力してください。'] },
      };
    }
    const choiceInputs = [
      {
        name: formData.get('first_choice_name'),
        kind: 'standard' as const,
        sortOrder: 0,
        fieldKey: 'first_choice_name',
        choiceIndex: standardIndex,
        extraPrice: choicePrices[standardIndex]!,
      },
      ...additionalInputs.filter((row) => row.name).map((row, index) => ({
        name: row.name,
        kind: 'option' as const,
        sortOrder: index + 1,
        fieldKey: 'additional_choice_name',
        choiceIndex: row.choiceIndex,
        extraPrice: choicePrices[row.choiceIndex]!,
      })),
    ];

    for (const input of choiceInputs) {
      const file = selectedChoiceImage(formData, input.choiceIndex);
      const imageUrl = selectedChoiceImageUrl(formData, input.choiceIndex);
      if (file && imageUrl) {
        return { ok: false, fieldErrors: { _form: ['画像URLとファイルはどちらか一方だけ指定してください。'] } };
      }
      if (imageUrl && !isAllowedChoiceImageUrl(imageUrl)) {
        return { ok: false, fieldErrors: { _form: ['画像URLはHTTPS、または /images/ で始まるパスを入力してください。'] } };
      }
      if (file && (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_SIZE)) {
        return {
          ok: false,
          fieldErrors: { _form: ['色見本画像はJPEG / PNG / WebP / AVIF、1枚10MB以下にしてください。'] },
        };
      }
    }

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
        extra_price: input.extraPrice,
        // 本部以外が足す追加の選択肢は、原価差額が未登録（別途見積）。本部が原価差額を登録する
        price_on_request: canEditCost ? false : newChoicePriceWithoutCost(input.kind).price_on_request,
        image_url: selectedChoiceImageUrl(formData, input.choiceIndex) || null,
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
    const savedChoiceIds: string[] = [];
    try {
      for (const [index, choice] of choices.entries()) {
        const file = selectedChoiceImage(formData, choiceInputs[index].choiceIndex);
        let uploadedUrl: string | null = null;
        try {
          if (file) {
            uploadedUrl = await store.uploadImage({
              bytes: new Uint8Array(await file.arrayBuffer()),
              contentType: file.type,
              fileName: file.name,
            }, 'variant-choices');
          }
          const choiceId = randomUUID();
          await store.upsertVariantChoice({
            id: choiceId,
            group_id: choice.group_id,
            code: choice.code,
            name: choice.name,
            kind: choice.kind,
            extra_price: choice.extra_price,
            price_on_request: choice.price_on_request,
            image_url: uploadedUrl ?? choice.image_url,
            note: choice.note,
            sort_order: choice.sort_order,
            status: choice.status,
          });
          savedChoiceCount += 1;
          savedChoiceIds.push(choiceId);
        } catch (error) {
          // DB保存に失敗した場合、参照されないアップロード画像だけ回収する。
          if (uploadedUrl) await store.deleteUploadedImage(uploadedUrl).catch(() => undefined);
          throw error;
        }
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
    // 登録済みの商品なら、本部が入れた原価差額（0 円を含む）を Version に記録する
    const costNotice =
      option.status === 'published' && costAccess.available && costAccess.canManage
        ? costRecordingNotice(await recordPublishedChoiceCosts(option.id, 'choice', savedChoiceIds, costAccess))
        : null;
    const savedMessage = reusableGroup
      ? `既存の選択項目へ選択肢${choices.length}件を追加しました。`
      : `選択項目と選択肢${choices.length}件を追加しました。`;
    return {
      ok: true,
      message: costNotice ? `${savedMessage}${costNotice}` : savedMessage,
    };
  } catch (error) {
    return initialError(error);
  }
}
