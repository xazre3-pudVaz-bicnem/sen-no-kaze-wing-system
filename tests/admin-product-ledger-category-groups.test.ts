import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ledgerPage = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');

describe('商品台帳の表示用大分類', () => {
  it('正式カテゴリーを変更せず、商品台帳だけで探しやすい大分類へまとめる', () => {
    for (const label of ['性能・仕様', '外まわり', '窓・ドア', '室内', '水回り・設備', '電気・照明', '家具・収納', '別途工事', 'その他']) {
      expect(ledgerPage).toContain(`name: '${label}'`);
    }

    expect(ledgerPage).toContain("categories: ['fireproof', 'insulation', 'insulation-floor', 'insulation-wall', 'insulation-ceiling']");
    expect(ledgerPage).toContain("categories: ['roof', 'exterior-wall', 'exterior-parts']");
    expect(ledgerPage).toContain("categories: ['entrance-door', 'sash', 'service-door', 'smartlock']");
    expect(ledgerPage).toContain("categories: ['floor', 'wall-ceiling', 'carpentry', 'interior-door']");
    expect(ledgerPage).toContain("categories: ['ub', 'kitchen', 'washbasin', 'toilet', 'boiler', 'aircon']");
    expect(ledgerPage).toContain("categories: ['lighting']");
    expect(ledgerPage).toContain("categories: ['entrance-storage', 'closet', 'bed', 'furniture', 'appliances', 'office-supplies']");
    expect(ledgerPage).toContain("categories: ['sitework']");

    expect(ledgerPage).toContain('const ledgerCategories = catalogCategories.map');
    expect(ledgerPage).toContain("group_code: displayGroup?.code ?? 'other'");
    expect(ledgerPage).toContain("group_name: displayGroup?.name ?? 'その他'");
    expect(ledgerPage).toContain('group_sort: displayGroup?.sort ?? 9');
    expect(ledgerPage).toContain('categories={ledgerCategories}');
  });
});
