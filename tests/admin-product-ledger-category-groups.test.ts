import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ledgerPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');
const helper = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/domain/product-registration-category-display.ts'),
  'utf8'
);

describe('商品台帳の表示用大分類', () => {
  it('商品登録と商品台帳で同じ7分類を正本として使う', () => {
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

    expect(ledgerPage).toContain("import { productRegistrationCategoryGroup } from '@/lib/domain/product-registration-category-display';");
    expect(ledgerPage).toContain('const displayGroup = productRegistrationCategoryGroup(category.code);');
    expect(ledgerPage).not.toContain('const LEDGER_DISPLAY_GROUPS =');
    expect(ledgerPage).toContain("group_code: displayGroup?.code ?? 'other'");
    expect(ledgerPage).toContain("group_name: displayGroup?.label ?? 'その他'");
    expect(ledgerPage).toContain('group_sort: displayGroup?.sort ?? 8');
    expect(ledgerPage).toContain('categories={ledgerCategories}');
  });

  it('断熱3カテゴリーを本体・外装に含め、その他への分類漏れを防ぐ', () => {
    expect(helper).toContain("'insulation-floor'");
    expect(helper).toContain("'insulation-wall'");
    expect(helper).toContain("'insulation-ceiling'");
  });
});
