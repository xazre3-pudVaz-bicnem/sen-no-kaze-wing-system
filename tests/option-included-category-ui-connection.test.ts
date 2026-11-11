import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  includedCategoryRpcError, sameCategoryIdSet, validateIncludedCategoryContract,
} from '@/lib/domain/included-equipment-action-contract';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ub = id(1);
const toilet = id(2);
const wash = id(3);
const unexpected = id(4);

const input = (overrides: Record<string, string[]> = {}) => ({
  ownCategoryId: ub,
  currentIds: [] as string[],
  allowedIds: [toilet, wash] as string[],
  expectedIds: [] as string[],
  nextIds: [] as string[],
  ...overrides,
});

const source = (name: string) => fs.readFileSync(path.resolve(process.cwd(), name), 'utf8');

describe('設備包含の保存契約（独立RPC／期待集合）', () => {
  it('順序によらず集合を比較し、要素の違いは拒否する', () => {
    expect(sameCategoryIdSet([toilet, wash], [wash, toilet])).toBe(true);
    expect(sameCategoryIdSet([toilet], [wash])).toBe(false);
  });

  it.each([
    { nextIds: [] as string[], expected: [] },
    { nextIds: [toilet], expected: [toilet] },
    { nextIds: [wash], expected: [wash] },
    { nextIds: [wash, toilet], expected: [toilet, wash] },
  ])('未設定から保存可能な4通り：$nextIds', ({ nextIds, expected }) => {
    expect(validateIncludedCategoryContract(input({ nextIds }))).toEqual({ ok: true, ids: expected });
  });

  it('クライアントexpectedを現在値に置き換えず、古い編集をCONFLICTにする', () => {
    expect(validateIncludedCategoryContract(input({
      currentIds: [toilet], expectedIds: [], nextIds: [wash],
    }))).toEqual({ ok: false, code: 'CONFLICT' });
  });

  it('前回の集合と次の集合が同じなら空集合も合法', () => {
    expect(validateIncludedCategoryContract(input({ currentIds: [], expectedIds: [], nextIds: [] })))
      .toEqual({ ok: true, ids: [] });
  });

  it('未知の既存リンクは自動削除も保持保存も行わず停止', () => {
    expect(validateIncludedCategoryContract(input({
      currentIds: [unexpected], expectedIds: [unexpected], nextIds: [unexpected],
    }))).toEqual({ ok: false, code: 'INCONSISTENT' });
  });

  it.each([
    { nextIds: [unexpected] },
    { nextIds: [ub] },
    { nextIds: [toilet, toilet] },
    { nextIds: ['not-uuid'] },
  ])('偽ID・自己包含・重複・不正UUIDは拒否する：$nextIds', ({ nextIds }) => {
    expect(validateIncludedCategoryContract(input({ nextIds }))).toEqual({ ok: false, code: 'INVALID' });
  });

  it('フォームexpectedの重複・不正UUIDも拒否', () => {
    expect(validateIncludedCategoryContract(input({ expectedIds: [toilet, toilet] }))).toEqual({ ok: false, code: 'INVALID' });
    expect(validateIncludedCategoryContract(input({ expectedIds: ['invalid'] }))).toEqual({ ok: false, code: 'INVALID' });
  });

  it('RPCの競合・ロック超過・権限エラーを分離し、勝手に再実行しない', () => {
    expect(includedCategoryRpcError({ code: 'P0001', message: 'CONFLICT: updated' })).toBe('CONFLICT');
    expect(includedCategoryRpcError({ code: '55P03', message: 'canceling due to lock timeout' })).toBe('TIMEOUT');
    expect(includedCategoryRpcError({ code: '42501', message: 'forbidden' })).toBe('FORBIDDEN');
    expect(includedCategoryRpcError({ code: 'P0001', message: 'VALIDATION: invalid' })).toBe('FAILED');
  });
});

describe('設備包含のUI／Action接続の安全境界', () => {
  it('書込みはユーザーセッションRPCのみ。admin直書き・service_roleを使わない', () => {
    const action = source('lib/actions/option-included-categories.ts');
    expect(action).toContain("actor.role !== 'admin'");
    expect(action).toContain("supabase.rpc('set_option_included_categories'");
    expect(action).toContain('p_expected_category_ids: input.expectedCategoryIds');
    expect(action).toContain('validateIncludedCategoryContract');
    expect(action).not.toContain('createAdminClient');
    expect(action).not.toMatch(/\.insert\(|\.delete\(/);
  });

  it('STEP2ではDBの保存済み値を再読込し、読み込めないときは公開しない', () => {
    const page = source('app/admin/options/[id]/page.tsx');
    const publish = source('lib/actions/admin.ts');
    expect(page).toContain('readOptionIncludedCategories(id)');
    expect(page).toContain('included-equipment-step2-saved');
    expect(page).toContain('canEditThisOption && category && inclusionReady');
    expect(publish).toContain('await readOptionIncludedCategories(option.id)');
    expect(page).toContain('name="included_categories_expected_ids"');
    expect(publish).toContain('included_categories_expected_ids');
    expect(publish).toContain('sameCategoryIdSet(expectedIds, inclusion.ids)');
  });

  it('Draftの未保存状態は既存商品情報と独立して管理し、登録済みは差分確認を要求', () => {
    const boundary = source('components/admin/option-registration-save-boundary.tsx');
    const editor = source('components/admin/included-equipment-category-editor.tsx');
    const fields = source('components/admin/included-equipment-category-fields.tsx');
    expect(boundary).toContain('registerIndependentSaveHandler');
    expect(boundary).toContain('hasAnyDirty()');
    expect(editor).toContain("mode === 'draft'");
    expect(editor).toContain('setReviewing(true)');
    expect(editor).toContain("result.code === 'CONFLICT'");
    expect(fields).not.toContain('<form');
    expect(editor).not.toContain('<form');
  });
});
