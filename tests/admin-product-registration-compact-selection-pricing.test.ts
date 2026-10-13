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
const finalRefinements = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/product-registration-final-refinements.tsx'),
  'utf8'
);
const variantCreateAction = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/actions/product-registration-variants.ts'),
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
  it('お客様選択は標準とその他の選択肢を同時入力し、選択肢画像は要求しない', () => {
    expect(variants).not.toContain("const QUICK_GROUPS = ['カラー', '柄', 'サイズ']");
    expect(finalRefinements).toContain('＋ 選択項目を追加');
    expect(finalRefinements).toContain('選択項目名');
    expect(finalRefinements).toContain('標準の選択肢');
    expect(finalRefinements).toContain('その他の選択肢');
    expect(finalRefinements).toContain('＋ 選択肢を追加');
    expect(finalRefinements).toContain('name="additional_choice_name"');
    expect(finalRefinements).not.toContain('label="最初の選択肢"');
    expect(finalRefinements).toContain('メーカー資料の正式名称を優先してください。');
    expect(finalRefinements).toContain('選択肢ごとの画像は登録しません。');
    expect(finalRefinements).not.toContain('name="image_file"');
    expect(variantCreateAction).toContain("kind: 'standard' as const");
    expect(variantCreateAction).toContain("kind: 'option' as const");
    expect(variantCreateAction).toContain("getAll('additional_choice_name')");
    expect(variantCreateAction).toContain('upsertVariantGroup');
    expect(variantCreateAction).toContain('upsertVariantChoice');
  });

  it('選択肢保存では検証用option_idをDB payloadへ送らない', () => {
    expect(variantCreateAction).toContain('option_id: option.id');
    expect(variantCreateAction).not.toContain('upsertVariantChoice({ ...choice.data');
    expect(variantCreateAction).toContain('group_id: choice.group_id');
    expect(variantCreateAction).toContain('name: choice.name');
    expect(variantCreateAction).toContain('kind: choice.kind');
  });

  it('カテゴリーに応じて選択項目名と各選択肢の候補を表示し、自由入力も残す', () => {
    expect(finalRefinements).toContain('CATEGORY_SUGGESTIONS');
    expect(finalRefinements).toContain("groups: ['床', 'カウンター', 'アクセントパネル', '周辺パネル', '浴槽', '水栓']");
    expect(finalRefinements).toContain("groups: ['色', '柄', '張り方', '仕上げ']");
    expect(finalRefinements).toContain("groups: ['デザイン', '色', 'ハンドル', 'ガラス']");
    expect(finalRefinements).toContain('selectedOptions[0]?.textContent?.trim()');
    expect(finalRefinements).toContain("setActiveSuggestions('group')");
    expect(finalRefinements).toContain("setActiveSuggestions('standard')");
    expect(finalRefinements).toContain('setActiveSuggestions(index)');
    expect(finalRefinements).toContain('候補外も自由入力できます。');
  });

  it('メイン画像と追加画像の実際の余白を測り、同じカードに見える位置まで詰める', () => {
    expect(finalRefinements).toContain("'.registration-step1-sections #product-main-media'");
    expect(finalRefinements).toContain("'.registration-step1-sections #product-sub-images'");
    expect(finalRefinements).toContain('extra.getBoundingClientRect().top - main.getBoundingClientRect().bottom');
    expect(finalRefinements).toContain('currentMargin - gap');
    expect(finalRefinements).toContain("main.style.borderBottomWidth = '0px'");
  });

  it('STEP1の価格欄では対象モデルと公開状態を前面に出さず、価格だけを表示する', () => {
    expect(adminLayout).toContain("import './product-registration-refinements.css';");
    expect(adminLayout).toContain('ProductRegistrationFinalRefinements');
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
