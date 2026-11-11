import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  includedEquipmentCategoryCandidates,
  splitIncludedEquipmentCategoryIds,
} from '@/lib/domain/included-equipment-category-input';

const categories = [
  { id: 'ub', code: 'ub', name: '浴室' },
  { id: 'toilet', code: 'toilet', name: 'トイレ' },
  { id: 'washbasin', code: 'washbasin', name: '洗面' },
] as const;

describe('商品登録：設備包含カテゴリーのコンパクトな入力準備', () => {
  it('同じ商品カテゴリーは包含候補から除き、候補の重複も除く', () => {
    expect(includedEquipmentCategoryCandidates([...categories, categories[1]], 'ub').map((item) => item.id))
      .toEqual(['toilet', 'washbasin']);
  });

  it('カテゴリーIDで表示・保存対象を分類し、選択済みの順番を保持する', () => {
    expect(splitIncludedEquipmentCategoryIds(['washbasin', 'toilet'], categories)).toEqual({
      visibleIds: ['washbasin', 'toilet'],
      preservedIds: [],
    });
  });

  it('候補から除外された既存設定は、誤って消さず保持する', () => {
    expect(splitIncludedEquipmentCategoryIds(['toilet', 'retired-category', 'toilet'], categories)).toEqual({
      visibleIds: ['toilet'],
      preservedIds: ['retired-category'],
    });
  });

  it('空の選択・空の候補は安全に処理する', () => {
    expect(splitIncludedEquipmentCategoryIds([], [])).toEqual({ visibleIds: [], preservedIds: [] });
    expect(includedEquipmentCategoryCandidates([], 'ub')).toEqual([]);
  });

  it('コンパクト表示・カテゴリー名・フォーム名を持ち、DB保存には接続していない', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'components/admin/included-equipment-category-fields.tsx'), 'utf8');
    expect(source).toContain('<details');
    expect(source).toContain('この商品に含まれる設備');
    expect(source).toContain('name="included_category_ids"');
    expect(source).toContain('onToggle=');
    expect(source).toContain('設定なし（必要なときだけ開く）');
    expect(source).not.toContain('saveOptionAction');
    expect(source).not.toContain('db.rpc(');
  });
});
