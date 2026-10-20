'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { requireStaff } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { getStore, isLocalMode, type OptionInput } from '@/lib/data/store';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';
import {
  manufacturerListPriceUnit,
  normalizeProductPriceUnit,
  productPriceUnit,
  productPriceUnitDefaults,
} from '@/lib/domain/product-price-unit';
import { createClient } from '@/lib/supabase/server';

export type ProductPriceUnitState = {
  ok: boolean;
  error?: string;
  editable?: boolean;
  categoryCode?: string;
  priceUnit?: string | null;
  listPriceUnit?: string | null;
  defaultPriceUnit?: string | null;
  defaultListPriceUnit?: string | null;
};

function validateUnit(value: unknown): { value: string | null; error?: string } {
  const normalized = normalizeProductPriceUnit(value);
  if (normalized && normalized.length > 40) {
    return { value: null, error: '価格単位は40文字以内で入力してください。' };
  }
  return { value: normalized };
}

async function editableContext(optionId: string) {
  const actor = await requireStaff();
  const store = await getStore();
  const option = await store.getOption(optionId);
  if (!option) return { actor, store, option: null, category: null, editable: false };
  const category = (await store.listCategories()).find((row) => row.id === option.category_id) ?? null;
  const editable = canEditCatalog(actor.role) ||
    Boolean(category?.code === FREE_PRODUCT_CATEGORY_CODE && option.owner_id === actor.id);
  return { actor, store, option, category, editable };
}

export async function getOptionPriceUnitState(optionId: string): Promise<ProductPriceUnitState> {
  const context = await editableContext(optionId);
  if (!context.option) return { ok: false, error: '商品が見つかりません。' };
  if (!context.category) return { ok: false, error: '商品カテゴリーが見つかりません。' };
  const defaults = productPriceUnitDefaults(context.category.code);
  return {
    ok: true,
    editable: context.editable,
    categoryCode: context.category.code,
    priceUnit: productPriceUnit(context.option),
    listPriceUnit: manufacturerListPriceUnit(context.option),
    defaultPriceUnit: defaults.priceUnit,
    defaultListPriceUnit: defaults.listPriceUnit,
  };
}

export async function getCategoryPriceUnitDefaultsAction(categoryId: string): Promise<{
  ok: boolean;
  error?: string;
  priceUnit?: string | null;
  listPriceUnit?: string | null;
}> {
  await requireStaff();
  const store = await getStore();
  const category = (await store.listCategories()).find((row) => row.id === categoryId);
  if (!category) return { ok: false, error: '商品カテゴリーが見つかりません。' };
  const defaults = productPriceUnitDefaults(category.code);
  return { ok: true, priceUnit: defaults.priceUnit, listPriceUnit: defaults.listPriceUnit };
}

/**
 * 数値の price / list_price や見積計算には触れず、価格単位の専用列だけを更新する。
 * 既存商品はNULLのままでも利用でき、カテゴリー既定値は新規入力を助けるUI上の初期値に限定する。
 */
export async function saveOptionPriceUnitsAction(input: {
  optionId: string;
  priceUnit: string;
  listPriceUnit: string;
}): Promise<ProductPriceUnitState> {
  const context = await editableContext(input.optionId);
  const { store, option, category, editable } = context;
  if (!option) return { ok: false, error: '商品が見つかりません。' };
  if (!category) return { ok: false, error: '商品カテゴリーが見つかりません。' };
  if (!editable) return { ok: false, error: 'この商品の価格単位を編集する権限がありません。' };

  const priceUnitResult = validateUnit(input.priceUnit);
  if (priceUnitResult.error) return { ok: false, error: priceUnitResult.error };
  const listPriceUnitResult = validateUnit(input.listPriceUnit);
  if (listPriceUnitResult.error) return { ok: false, error: listPriceUnitResult.error };

  try {
    if (isLocalMode()) {
      const {
        id: optionId,
        product_no: _productNo,
        gallery_images: _galleryImages,
        created_at: _createdAt,
        updated_at: _updatedAt,
        ...editableOption
      } = option;
      await store.upsertOption({
        ...editableOption,
        id: optionId,
        price_unit: priceUnitResult.value,
        list_price_unit: listPriceUnitResult.value,
      } as OptionInput);
    } else {
      const db = await createClient();
      const { data, error } = await db
        .from('options')
        .update({
          price_unit: priceUnitResult.value,
          list_price_unit: listPriceUnitResult.value,
        })
        .eq('id', option.id)
        .select('id')
        .maybeSingle();
      if (error) {
        if (error.code === '42703' || error.code === 'PGRST204') {
          return { ok: false, error: '価格単位のDB列がまだ適用されていません。migration適用後に保存してください。' };
        }
        return { ok: false, error: '価格単位を保存できませんでした。' };
      }
      if (!data) return { ok: false, error: '商品を更新できませんでした。' };
    }
  } catch {
    return { ok: false, error: '価格単位を保存できませんでした。' };
  }

  const defaults = productPriceUnitDefaults(category.code);
  revalidatePath(`/admin/options/${option.id}`);
  revalidatePath('/admin/ledger');
  revalidatePath('/', 'layout');
  updateTag(CATALOG_TAG);
  return {
    ok: true,
    editable: true,
    categoryCode: category.code,
    priceUnit: priceUnitResult.value,
    listPriceUnit: listPriceUnitResult.value,
    defaultPriceUnit: defaults.priceUnit,
    defaultListPriceUnit: defaults.listPriceUnit,
  };
}
