import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/layout.tsx'), 'utf8');
const form = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/product-registration-final-refinements.tsx'),
  'utf8'
);

describe('商品登録 選択項目フォームの表示位置', () => {
  it('追加フォームをボタンの直下へ通常フローで描画する', () => {
    const button = form.indexOf('aria-controls="registration-variant-create-form"');
    const expandedForm = form.indexOf('id="registration-variant-create-form"');
    expect(button).toBeGreaterThan(-1);
    expect(expandedForm).toBeGreaterThan(button);
    expect(form).toContain('aria-expanded={open}');
    expect(form).toContain('{open && (');
    expect(form).toContain('className="border-t border-line/70 pt-3"');
  });

  it('管理画面で旧絶対配置・余白補正を動かさない', () => {
    expect(layout).toContain('<ProductRegistrationFinalRefinements />');
    expect(layout).not.toContain('ProductRegistrationFormPlacementFix');
    expect(fs.existsSync(path.resolve(
      process.cwd(), 'components/admin/product-registration-form-placement-fix.tsx'
    ))).toBe(false);
  });
});
