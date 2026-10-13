import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/product-registration-form-placement-fix.tsx'),
  'utf8'
);
const layout = fs.readFileSync(path.resolve(process.cwd(), 'app/admin/layout.tsx'), 'utf8');

describe('商品登録 選択項目フォームの表示位置', () => {
  it('追加フォームをボタンカードの直下へ固定する', () => {
    expect(source).toContain("form.style.position = 'absolute';");
    expect(source).toContain("form.style.top = 'calc(100% + 12px)';");
    expect(source).toContain("activeTarget.style.marginBottom = `${Math.ceil(height) + 12}px`;");
    expect(source).toContain("attributeFilter: ['aria-expanded']");
  });

  it('管理画面で配置補正を有効にする', () => {
    expect(layout).toContain('ProductRegistrationFormPlacementFix');
    expect(layout).toContain('<ProductRegistrationFormPlacementFix />');
  });
});
