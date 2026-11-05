import { describe, expect, it } from 'vitest';
import type { OptionCategory } from '@/lib/domain/types';
import { customerCategoryVisibilityFormData, groupCustomerCategories } from '@/lib/domain/category-customer-visibility';

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

describe('お客様表示カテゴリーの表示用グループ', () => {
  it('商品台帳と同じ並びで表示し、並び替えても元の配列と値を変えない', () => {
    const items = [
      { ...category, id: '1', code: 'smartlock', name: 'スマートロック・鍵', group_name: 'その他' },
      { ...category, id: '2', code: 'wall-ceiling', name: '壁・天井' },
      { ...category, id: '3', code: 'sash', name: 'サッシ' },
      { ...category, id: '4', code: 'roof', name: '屋根' },
      { ...category, id: '5', code: 'exterior-wall', name: '外壁' },
    ];
    const originalCodes = items.map((item) => item.code);
    const groups = groupCustomerCategories(items);
    expect(groups.map((g) => g.label)).toEqual(['本体・外装', '開口部・建具', '内装・造作', '電気・設備']);
    expect(groups[0].categories.map((item) => item.code)).toEqual(['roof', 'exterior-wall']);
    expect(items.map((item) => item.code)).toEqual(originalCodes);
    expect(items[3].name).toBe('屋根');
  });

  it('未定義の新カテゴリーを欠落させず、最後にまとめる', () => {
    const known = { ...category, id: 'known', code: 'roof', name: '屋根' };
    const newCategory = { ...category, id: 'new', code: 'future-product', name: '将来の商品分類', group_name: '新規分類' };
    const groups = groupCustomerCategories([newCategory, known]);
    expect(groups.map((g) => g.label)).toEqual(['本体・外装', 'その他のカテゴリー']);
    expect(groups[1].categories).toEqual([newCategory]);
  });

  it('検索・表示状態で絞られた配列のみでグループを構成できる', () => {
    const filtered = [
      { ...category, id: '1', code: 'insulation-wall', customer_visible: false },
      { ...category, id: '2', code: 'insulation-ceiling', customer_visible: false },
    ];
    const groups = groupCustomerCategories(filtered);
    expect(groups).toHaveLength(1);
    expect(groups[0].categories).toHaveLength(2);
    expect(groups[0].categories.map((c) => c.code)).toEqual(['insulation-wall', 'insulation-ceiling']);
  });
});
