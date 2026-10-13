import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const variants = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-variant-manager.tsx'),
  'utf8'
);
const enhancer = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-registration-ui-enhancer.tsx'),
  'utf8'
);
const adminLayout = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/layout.tsx'),
  'utf8'
);
const registrationCss = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/product-registration-refinements.css'),
  'utf8'
);

describe('商品登録のお客様選択・価格UI', () => {
  it('お客様選択は1つの入口から部位ごとの項目を追加し、最初の選択肢へ続ける', () => {
    expect(variants).not.toContain("const QUICK_GROUPS = ['カラー', '柄', 'サイズ']");
    expect(variants).toContain('＋ 選択項目を追加');
    expect(variants).toContain('選択項目名');
    expect(variants).toContain('例：床／カウンター／アクセントパネル／浴槽');
    expect(variants).toContain('選択肢名');
    expect(variants).toContain('最初の選択肢を追加');
    expect(variants).toContain('表示などの詳細設定');
    expect(variants).toContain('標準の選択肢にする');
  });

  it('STEP1の価格欄では対象モデルと公開状態を前面に出さず、価格だけを表示する', () => {
    expect(adminLayout).toContain("import './product-registration-refinements.css';");
    expect(registrationCss).toContain("content: '6. 価格' !important;");
    expect(registrationCss).toContain("content: '商品価格を設定します。公開はSTEP 2で行います。';");
    expect(registrationCss).toContain("#sales-settings [data-testid='option-normal-settings']");
    expect(registrationCss).toContain('display: none !important;');
    expect(enhancer).toContain('0円のまま下書き保存できます。公開時に0円でよいか確認します。');
  });

  it('DOM補助処理自身の変更でMutationObserverが再帰し続けない', () => {
    expect(enhancer).toContain('function setTextIfChanged');
    expect(enhancer).toContain("if (element.textContent !== value) element.textContent = value");
    expect(enhancer).toContain('observer.disconnect();\n      enhance();\n      observer.observe(document.body, { childList: true, subtree: true });');
  });
});
