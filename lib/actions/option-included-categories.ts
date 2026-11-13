'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { readOptionIncludedCategories } from '@/lib/data/option-included-categories';
import {
  includedCategoryRpcError,
  sameCategoryIdSet,
  validateIncludedCategoryContract,
} from '@/lib/domain/included-equipment-action-contract';
import { createClient } from '@/lib/supabase/server';

type SaveIncludedCategoryInput = {
  optionId: string;
  expectedCategoryIds: string[];
  nextCategoryIds: string[];
};

export type SaveIncludedCategoryResult =
  | { ok: true; savedIds: string[] }
  | { ok: false; code: 'FORBIDDEN' | 'VALIDATION' | 'CONFLICT' | 'TIMEOUT' | 'FAILED'; error: string };

/** Independent atomic relation update. Does not save product attributes, prices or variants. */
export async function saveIncludedCategoriesAction(input: SaveIncludedCategoryInput): Promise<SaveIncludedCategoryResult> {
  const actor = await getSessionUser();
  if (!actor || actor.role !== 'admin') {
    return { ok: false, code: 'FORBIDDEN', error: '設備包含の変更は本部管理者だけが行えます。' };
  }
  if (isLocalMode()) {
    return { ok: false, code: 'FAILED', error: 'ローカル検証モードでは設備包含の正式保存はできません。' };
  }
  if (!input || typeof input.optionId !== 'string' ||
      !Array.isArray(input.expectedCategoryIds) || !Array.isArray(input.nextCategoryIds) ||
      input.expectedCategoryIds.length > 2 || input.nextCategoryIds.length > 2) {
    return { ok: false, code: 'VALIDATION', error: '設備カテゴリーの指定が正しくありません。' };
  }
  try {
    const store = await getStore();
    const option = await store.getOption(input.optionId);
    if (!option) return { ok: false, code: 'VALIDATION', error: '商品が見つかりません。' };
    const categories = await store.listCategories();
    const source = categories.find((row) => row.id === option.category_id);
    if (source?.code !== 'ub' || source.status !== 'published') {
      return { ok: false, code: 'VALIDATION', error: '設備包含を設定できるのは浴室（ub）カテゴリーの商品だけです。' };
    }
    const allowed = categories.filter((row) => row.status === 'published' &&
      (row.code === 'toilet' || row.code === 'washbasin'));
    if (new Set(allowed.map((row) => row.code)).size !== allowed.length) {
      return { ok: false, code: 'FAILED', error: '設備カテゴリーの候補を確定できません。管理者に確認してください。' };
    }

    const current = await readOptionIncludedCategories(option.id);
    if (!current.ok) return { ok: false, code: 'FAILED', error: current.error };
    const contract = validateIncludedCategoryContract({
      ownCategoryId: source.id,
      currentIds: current.ids,
      allowedIds: allowed.map((row) => row.id),
      expectedIds: input.expectedCategoryIds,
      nextIds: input.nextCategoryIds,
    });
    if (!contract.ok) {
      if (contract.code === 'CONFLICT') return { ok: false, code: 'CONFLICT', error: '別の操作で変更されました。再読み込みしてください。' };
      if (contract.code === 'INCONSISTENT') return { ok: false, code: 'FAILED', error: '候補外の既存設定があるため保存できません。管理者に確認してください。' };
      return { ok: false, code: 'VALIDATION', error: '設備カテゴリーの指定が正しくありません。' };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('set_option_included_categories', {
      p_option_id: option.id,
      p_expected_category_ids: input.expectedCategoryIds,
      p_next_category_ids: contract.ids,
    });
    if (error) {
      console.error('[wing] inclusion RPC failed', { code: error.code, message: error.message });
      const code = includedCategoryRpcError(error);
      if (code === 'CONFLICT') return { ok: false, code, error: '別の操作で変更されました。再読み込みしてください。' };
      if (code === 'TIMEOUT') return { ok: false, code, error: '保存が混み合っています。自動再試行はしません。状態を確認してから再読み込みしてください。' };
      if (code === 'FORBIDDEN') return { ok: false, code, error: '設備包含の変更権限がありません。' };
      return { ok: false, code: 'FAILED', error: '設備包含の保存に失敗しました。状態を確認してから再読み込みしてください。' };
    }
    if (!Array.isArray(data) || !sameCategoryIdSet(data, contract.ids)) {
      return { ok: false, code: 'FAILED', error: '保存結果を確認できません。再読み込みして現在の設定を確認してください。' };
    }
    revalidatePath('/admin/options/' + option.id);
    return { ok: true, savedIds: [...data].sort() };
  } catch (error) {
    console.error('[wing] inclusion save exception', error);
    return { ok: false, code: 'FAILED', error: '設備包含の保存に失敗しました。再読み込みしてください。' };
  }
}
