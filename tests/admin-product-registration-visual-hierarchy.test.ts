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

  it('入力導線と画像・PDF・原価の表示をコンパクトにする', () => {
    expect(css).toContain('.registration-compact-step-flow');
    expect(css).not.toContain('.registration-section-nav-items a');
    expect(css).toContain('.registration-check-jump');
    expect(css).toContain("[data-main-image-selection-preview='true']");
    expect(css).toContain('.registration-pdf-replace-toggle');
    expect(css).toContain(":has([data-testid='option-registration-hq-cost'])");
    expect(css).toContain("content: '6. 価格・原価'");
  });

  it('選択肢追加を入力欄の下に置き、候補を手動開閉にして入れ子の枠を減らす', () => {
    expect(refinement).toContain('＋ 選択肢を追加');
    expect(refinement).toContain('data-testid="compact-variant-choices"');
    expect(refinement).toContain('border-b border-line/70 py-2');
    expect(refinement).toContain('data-testid="inline-variant-suggestions"');
    expect(refinement).not.toContain('候補を見る');
    expect(refinement).not.toContain('rounded-lg border px-2 py-1.5');
    expect(css).not.toContain('display: contents !important;');
    expect(css).not.toContain('order: 30;');
  });

  it('作成ボタンを下部の右側に置き、スマホでは全幅にする', () => {
    expect(refinement).toContain('この選択項目を作成');
    expect(refinement).toContain('data-testid="compact-variant-footer"');
    expect(refinement).toContain('className="ml-auto"');
    expect(css).toContain("[data-testid='compact-variant-footer']");
    expect(css).toContain('@media (max-width: 639px)');
    expect(css).toContain('width: 100%;');
  });
});
