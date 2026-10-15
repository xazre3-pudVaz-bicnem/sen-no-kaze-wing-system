import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const helper = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/domain/product-registration-category-display.ts'),
  'utf8'
);
const newPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/new/page.tsx'),
  'utf8'
);
const editPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'),
  'utf8'
);

describe('商品登録カテゴリーの表示順', () => {
  it('部位・用途別のグループ順を固定する', () => {
    for (const label of [
      '本体・外装',
      '開口部・建具',
      '内装・造作',
      '水回り',
      '電気・設備',
      '家具・備品',
      '外構・現地工事',
    ]) {
      expect(helper).toContain(`label: '${label}'`);
    }

    for (const code of [
      'insulation',
      'roof',
      'exterior-wall',
      'entrance-door',
      'service-door',
      'sash',
      'interior-door',
      'floor',
      'wall-ceiling',
      'entrance-storage',
      'closet',
      'carpentry',
      'ub',
      'kitchen',
      'washbasin',
      'toilet',
      'boiler',
      'aircon',
      'lighting',
      'smartlock',
      'bed',
      'furniture',
      'appliances',
      'office-supplies',
      'exterior-parts',
      'sitework',
    ]) {
      expect(helper).toContain(`'${code}'`);
    }
  });

  it('DBのカテゴリー名は変更せず、登録画面用の表示名だけを整える', () => {
    expect(helper).toContain("aircon: 'エアコン'");
    expect(helper).toContain('productRegistrationCategoryLabel(category)');
    expect(helper).toContain('...category');
  });

  it('新規登録と下書き編集の両方で同じ表示順を使う', () => {
    expect(newPage).toContain('productRegistrationCategoryDisplay(');
    expect(editPage).toContain('productRegistrationCategoryDisplay(registrationCategories)');
    expect(editPage).toContain('categories={registrationDisplayCategories}');
  });
});
