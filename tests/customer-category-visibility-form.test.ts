import { describe, expect, it } from 'vitest';
import type { OptionCategory } from '@/lib/domain/types';
import { customerCategoryVisibilityFormData } from '@/lib/domain/category-customer-visibility';

const category: OptionCategory = {
  id: '29000000-0000-4000-8000-000000000002',
  code: 'insulation-wall',
  name: '壁断熱',
  description: '壁の断熱材',
  group_code: 'finish',
  group_name: '内外装仕上げ',
  group_sort: 2,
  selection_mode: 'single',
  finish_level: 'shell',
  is_required: true,
  customer_visible: true,
  sort_order: 5,
  status: 'published',
};

describe('カテゴリーのお客様表示切替用フォーム', () => {
  it('非表示にするとき、必須設定・公開状態・分類・注文範囲を変更しない', () => {
    const data = customerCategoryVisibilityFormData(category, false);
    expect(data.get('customer_visible')).toBeNull();
    expect(data.get('is_required')).toBe('on');
    expect(data.get('finish_level')).toBe('shell');
    expect(data.get('status')).toBe('published');
    expect(data.get('code')).toBe('insulation-wall');
    expect(data.get('group_name')).toBe('内外装仕上げ');
    expect(data.get('group_sort')).toBe('2');
    expect(data.get('description')).toBe('壁の断熱材');
  });

  it('再表示でき、必須でないカテゴリーを必須に変えない', () => {
    const data = customerCategoryVisibilityFormData({
      ...category,
      customer_visible: false,
      is_required: false,
      status: 'draft',
      description: null,
    }, true);
    expect(data.get('customer_visible')).toBe('on');
    expect(data.get('is_required')).toBeNull();
    expect(data.get('status')).toBe('draft');
    expect(data.get('description')).toBe('');
  });

  it('特定の6カテゴリーを特別扱いせず、どのカテゴリーでも同じ設定を使える', () => {
    for (const code of ['roof', 'sash', 'smartlock', 'insulation-ceiling', 'interior-door', 'future-category']) {
      const data = customerCategoryVisibilityFormData({ ...category, code }, false);
      expect(data.get('code')).toBe(code);
      expect(data.get('customer_visible')).toBeNull();
    }
  });
});
