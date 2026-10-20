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
  it('マトリクスと矛盾しない7つの表示用大分類へまとめる', () => {
    for (const label of [
      '本体・外装',
      '開口部・建具',
      '内装・造作',
      '水回り',
      '電気・設備',
      '家具・収納',
      '外構・現地工事',
    ]) {
      expect(helper).toContain(`label: '${label}'`);
    }

    expect(helper).toContain("codes: ['roof', 'exterior-wall', 'insulation-floor', 'insulation-wall', 'insulation-ceiling', 'insulation']");
    expect(helper).toContain("codes: ['entrance-door', 'service-door', 'sash', 'interior-door']");
    expect(helper).toContain("codes: ['floor', 'wall-ceiling', 'carpentry']");
    expect(helper).toContain("codes: ['ub', 'kitchen', 'washbasin', 'toilet', 'boiler']");
    expect(helper).toContain("codes: ['aircon', 'lighting', 'smartlock']");
    expect(helper).toContain("codes: ['entrance-storage', 'closet', 'bed', 'furniture', 'appliances', 'office-supplies']");
    expect(helper).toContain("codes: ['exterior-parts', 'sitework']");
  });

  it('DBのカテゴリー名は変更せず、登録画面用の表示名だけを整える', () => {
    expect(helper).toContain("aircon: 'エアコン'");
    expect(helper).toContain('productRegistrationCategoryLabel(category)');
    expect(helper).toContain('...category');
  });

  it('商品台帳からも同じ大分類を参照できる', () => {
    expect(helper).toContain('export function productRegistrationCategoryGroup(categoryCode: string)');
  });

  it('新規登録と下書き編集の両方で同じ表示順を使う', () => {
    expect(newPage).toContain('productRegistrationCategoryDisplay(');
    expect(editPage).toContain('productRegistrationCategoryDisplay(registrationCategories)');
    expect(editPage).toContain('categories={registrationDisplayCategories}');
  });
});
