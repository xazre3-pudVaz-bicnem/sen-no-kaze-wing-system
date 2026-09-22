import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ledger = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/ledger/page.tsx'), 'utf8');

describe('商品台帳の入口', () => {
  it('商品識別情報で検索し、販売基準の導線を含めない', () => {
    expect(ledger).toContain('商品名・メーカー・型番');
    expect(ledger).toContain('name="category"');
    expect(ledger).toContain('商品価格（税別）');
    expect(ledger).toContain('全モデル共通');
    expect(ledger).not.toContain('/admin/base-breakdown');
  });

  it('フリー商品を正式な商品台帳へ混ぜない', () => {
    expect(ledger).toContain('FREE_PRODUCT_CATEGORY_CODE');
    expect(ledger).toContain('catalogOptions');
    expect(ledger).toContain('catalogCategories');
  });

  it('一覧全体でなく表領域だけを横スクロールする共通Tableを使う', () => {
    expect(ledger).toContain('<Table>');
  });
});
