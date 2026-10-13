import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/product-registration-refinements.css'),
  'utf8'
);
const refinement = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/product-registration-final-refinements.tsx'),
  'utf8'
);

describe('商品登録 STEP1 の簡潔化', () => {
  it('選択項目の追加ボタンを残したまま、その直下に入力フォームを展開する', () => {
    const button = refinement.indexOf('＋ 選択項目を追加');
    const openedForm = refinement.indexOf("rounded-xl border border-dashed border-line bg-ivory/20 p-4", button);
    expect(button).toBeGreaterThan(-1);
    expect(openedForm).toBeGreaterThan(button);
    expect(refinement).toContain('aria-expanded={open}');
    expect(refinement).toContain('{open && (');
    expect(refinement).not.toContain('!open ? (');
    expect(css).toContain("[data-combined-create-root='true']");
    expect(css).toContain('flex-direction: column;');
  });

  it('価格欄の二重枠と二重見出しを表示しない', () => {
    expect(css).toContain('#sales-settings > div:nth-of-type(2)');
    expect(css).toContain('border: 0 !important;');
    expect(css).toContain("#sales-settings > div:nth-of-type(2) > p:first-child");
    expect(css).toContain('display: none !important;');
  });

  it('別途見積と高度な条件設定を業務向けの短い表示にする', () => {
    expect(css).toContain("content: '価格は別途見積';");
    expect(css).toContain("content: 'シミュレーター表示・選択条件';");
    expect(css).toContain("content: '使用中の項目は削除せず、「お客様に表示する」をOFFにして管理します。';");
  });
});
