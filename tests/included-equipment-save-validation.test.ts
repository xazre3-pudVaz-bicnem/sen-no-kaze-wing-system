import { describe, expect, it } from 'vitest';
import {
  validateIncludedCategorySaveInput,
  type IncludedCategorySaveInput,
} from '@/lib/domain/included-equipment-save-validation';

const category = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const own = category(1);
const toilet = category(2);
const wash = category(3);
const retired = category(4);
const injected = category(5);

function input(overrides: Partial<IncludedCategorySaveInput> = {}): IncludedCategorySaveInput {
  return {
    ownCategoryId: own,
    existingIds: [],
    editableCategoryIds: [toilet, wash],
    requestedIds: [],
    ...overrides,
  };
}

describe('設備包含カテゴリーの保存入力：サーバー側の事前検査', () => {
  it('追加先をカテゴリーIDとして受け取り、DB用に順序を安定させる', () => {
    expect(validateIncludedCategorySaveInput(input({ requestedIds: [wash, toilet] }))).toEqual({
      ok: true, categoryIds: [toilet, wash],
    });
  });

  it('未設定を空の集合として扱い、既存データへ副作用を起こさない', () => {
    const current = [toilet];
    expect(validateIncludedCategorySaveInput(input({
      existingIds: current,
      requestedIds: [],
    }))).toEqual({ ok: true, categoryIds: [] });
    expect(current).toEqual([toilet]);
  });

  it('フォーム改変による候補外の追加は許可しない', () => {
    expect(validateIncludedCategorySaveInput(input({
      requestedIds: [injected],
    }))).toEqual({ ok: false, code: 'UNAUTHORIZED_CATEGORY' });
  });

  it('候補外の既存設定だけは維持でき、削除は拒否する', () => {
    expect(validateIncludedCategorySaveInput(input({
      existingIds: [retired],
      requestedIds: [retired, toilet],
    }))).toEqual({ ok: true, categoryIds: [toilet, retired] });

    expect(validateIncludedCategorySaveInput(input({
      existingIds: [retired],
      requestedIds: [toilet],
    }))).toEqual({ ok: false, code: 'HIDDEN_RELATION_REMOVED' });
  });

  it('自己カテゴリーの包含は拒否する', () => {
    expect(validateIncludedCategorySaveInput(input({
      editableCategoryIds: [own, toilet],
      requestedIds: [own],
    }))).toEqual({ ok: false, code: 'SELF_INCLUSION' });
  });

  it('同じカテゴリーの複数指定は黙ってまとめず拒否する', () => {
    expect(validateIncludedCategorySaveInput(input({
      requestedIds: [toilet, toilet],
    }))).toEqual({ ok: false, code: 'DUPLICATE_CATEGORY' });
  });

  it('不正なUUIDは拒否する（存在確認・権限確認は正式RPCで行う）', () => {
    expect(validateIncludedCategorySaveInput(input({
      requestedIds: ['not-a-uuid'],
    }))).toEqual({ ok: false, code: 'INVALID_CATEGORY_ID' });
    expect(validateIncludedCategorySaveInput(input({
      existingIds: ['not-a-uuid'],
    }))).toEqual({ ok: false, code: 'INVALID_CATEGORY_ID' });
  });
});
