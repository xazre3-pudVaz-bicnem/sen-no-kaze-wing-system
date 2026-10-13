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

describe('商品登録 STEP1 の見やすさと選択肢操作', () => {
  it('入力文字と補足文に読みやすい文字階層を設定する', () => {
    expect(css).toContain(".registration-step1-sections .text-sm {");
    expect(css).toContain('font-size: 0.9375rem !important;');
    expect(css).toContain(".registration-step1-sections .text-xs {");
    expect(css).toContain('font-size: 0.8125rem !important;');
    expect(css).toContain("font-size: 1rem !important;");
  });

  it('選択肢追加を入力済み選択肢の後ろに置く', () => {
    expect(refinement).toContain('＋ 選択肢を追加');
    expect(css).toContain('display: contents !important;');
    expect(css).toContain('order: 20;');
    expect(css).toContain('order: 30;');
  });

  it('選択項目作成を最後の主操作として右寄せしスマホでは全幅にする', () => {
    expect(refinement).toContain('この選択項目を作成');
    expect(css).toContain('order: 50;');
    expect(css).toContain('margin-left: auto !important;');
    expect(css).toContain('@media (max-width: 639px)');
    expect(css).toContain('width: 100%;');
  });
});
