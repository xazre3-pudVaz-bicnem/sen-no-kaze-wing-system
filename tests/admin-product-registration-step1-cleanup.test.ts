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

const adminLayout = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/layout.tsx'),
  'utf8'
);

describe('商品登録 STEP1 の簡潔化', () => {
  it('旧絶対配置処理を使わず、追加ボタン直下の通常フローでフォームを開く', () => {
    const buttonIndex = refinement.indexOf('aria-controls="registration-variant-create-form"');
    const formIndex = refinement.indexOf('id="registration-variant-create-form"');
    expect(buttonIndex).toBeGreaterThan(-1);
    expect(formIndex).toBeGreaterThan(buttonIndex);
    expect(refinement).toContain('data-combined-create-root="true"');
    expect(refinement).toContain('aria-expanded={open}');
    expect(adminLayout).toContain('<ProductRegistrationFinalRefinements />');
    expect(adminLayout).not.toContain('ProductRegistrationFormPlacementFix');
    expect(fs.existsSync(path.resolve(
      process.cwd(), 'components/admin/product-registration-form-placement-fix.tsx'
    ))).toBe(false);
  });

  it('閉じた状態は追加ボタン、展開中は重複のないコンパクトな入力フォームを表示する', () => {
    const button = refinement.indexOf('＋ 選択項目を追加');
    const openedForm = refinement.indexOf('className="border-t border-line/70 pt-3"', button);
    expect(button).toBeGreaterThan(-1);
    expect(openedForm).toBeGreaterThan(button);
    expect(refinement).not.toContain('{!open && (');
    expect(refinement).toContain('aria-expanded={open}');
    expect(refinement).toContain('disabled={pending || open}');
    expect(refinement).toContain('aria-controls="registration-variant-create-form"');
    expect(refinement).toContain('id="registration-variant-create-form"');
    expect(refinement.indexOf('aria-controls="registration-variant-create-form"')).toBeLessThan(
      refinement.indexOf('id="registration-variant-create-form"')
    );
    expect(refinement).not.toContain('画像なし');
    expect(refinement).toContain('{open && (');
    expect(refinement).toContain('画像は任意');
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
