import { describe, expect, it } from 'vitest';
import {
  INCLUDED_IN_UNIT_LABEL,
  resolveEquipmentInclusion,
  type ActiveIncludedEquipmentSource,
} from '@/lib/domain/equipment-inclusion';

const threePointUnit = (overrides: Partial<ActiveIncludedEquipmentSource> = {}): ActiveIncludedEquipmentSource => ({
  sourceSelectionKey: 'unit-1',
  sourceOptionId: 'three-point-ub',
  includedCategoryIds: ['category-toilet', 'category-washbasin'],
  relationToTarget: 'same-unit',
  ...overrides,
});

describe('設備包含カテゴリー：設置場所を区別した表示判定（正式金額には非関与）', () => {
  it('3点ユニット内のトイレ・洗面をカテゴリー単位で「含まれる」と判定する', () => {
    expect(INCLUDED_IN_UNIT_LABEL).toBe('ユニットに含まれています');
    for (const categoryId of ['category-toilet', 'category-washbasin']) {
      expect(resolveEquipmentInclusion(categoryId, [threePointUnit()])).toEqual({
        state: 'included-in-unit',
        sourceSelectionKeys: ['unit-1'],
      });
    }
  });

  it('含まれない設備や未選択のユニットは、包含済みにはしない', () => {
    expect(resolveEquipmentInclusion('category-kitchen', [threePointUnit()])).toEqual({
      state: 'not-included',
      sourceSelectionKeys: [],
    });
    expect(resolveEquipmentInclusion('category-toilet', [])).toEqual({
      state: 'not-included',
      sourceSelectionKeys: [],
    });
  });

  it('別室のトイレは、3点ユニットの商品に含まれていても独立した追加設備にする', () => {
    expect(resolveEquipmentInclusion('category-toilet', [
      threePointUnit({ relationToTarget: 'separate-room' }),
    ])).toEqual({
      state: 'additional-equipment',
      sourceSelectionKeys: ['unit-1'],
    });
  });

  it('設置位置の区別が不明なら、包含済みと決めつけない', () => {
    expect(resolveEquipmentInclusion('category-toilet', [
      threePointUnit({ relationToTarget: 'undetermined' }),
    ])).toEqual({
      state: 'placement-undetermined',
      sourceSelectionKeys: ['unit-1'],
    });
  });

  it('別室と位置不明の包含元が混ざる場合は、確認が必要な状態を優先する', () => {
    expect(resolveEquipmentInclusion('category-toilet', [
      threePointUnit({ relationToTarget: 'separate-room' }),
      threePointUnit({ sourceSelectionKey: 'unit-2', relationToTarget: 'undetermined' }),
    ])).toEqual({
      state: 'placement-undetermined',
      sourceSelectionKeys: ['unit-2'],
    });
  });

  it('同じ商品が複数位置にある場合、商品IDではなく設置単位ごとに判定する', () => {
    expect(resolveEquipmentInclusion('category-toilet', [
      threePointUnit({ sourceSelectionKey: 'unit-1', relationToTarget: 'separate-room' }),
      threePointUnit({ sourceSelectionKey: 'unit-2', relationToTarget: 'same-unit' }),
    ])).toEqual({
      state: 'included-in-unit',
      sourceSelectionKeys: ['unit-2'],
    });
  });

  it('同じ選択識別子が重複しても判定根拠は重複表示しない', () => {
    expect(resolveEquipmentInclusion('category-washbasin', [threePointUnit(), threePointUnit()])).toEqual({
      state: 'included-in-unit',
      sourceSelectionKeys: ['unit-1'],
    });
  });
});
