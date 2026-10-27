import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const variant = read('components/admin/option-variant-manager.tsx');
const css = read('app/admin/product-registration-refinements.css');
const registered = read('components/admin/registered-option-edit-flow.tsx');

describe('商品登録の選択肢をコンパクトにして、主要セクションを交互色にする', () => {
  it('グループ単位で折り畳み、選択肢の一覧を開いて編集する', () => {
    expect(variant).toContain('data-testid="variant-group-compact"');
    expect(variant).toContain('data-testid="variant-choice-price-editor"');
    expect(variant).toContain('<details\n                key={group.id}');
    expect(variant).toContain('<details\n      ref={editorDetailsRef}');
    expect(variant).toContain('groupChoices.length}選択肢');
    expect(variant).toContain('choice.name');
    expect(variant).toContain("choice.kind === 'standard'");
    expect(variant).toContain("choice.price_on_request ? '別途見積'");
    expect(variant).toContain('choice.extra_price.toLocaleString');
    expect(variant).toContain('choice.status === \'draft\'');
    expect(variant).toContain('編集 <span aria-hidden="true">▾</span>');
    expect(variant).toContain('editor.open = true');
    expect(variant).toContain("editor.closest<HTMLDetailsElement>('details[data-testid=\"variant-group-compact\"]')");
    expect(variant).toContain('groupDetails.open = true');
  });

  it('既存の選択肢保存・新規追加・画像・標準指定の処理をそのまま利用する', () => {
    expect(variant).toContain('saveVariantChoiceAction');
    expect(variant).toContain('saveVariantGroupAction');
    expect(variant).toContain('<form action={action}');
    expect(variant).toContain('name="extra_price"');
    expect(variant).toContain('name="image_url"');
    expect(variant).toContain('name="image_file"');
    expect(variant).toContain('name="kind"');
    expect(variant).toContain('name="status"');
    expect(variant).toContain('＋ 選択肢を追加（追加金額も入力）');
    expect(variant).toContain('この項目の名前・詳細設定');
    expect(variant).toContain('key={`${choice.id}:${choice.image_url ??');
  });

  it('下書きと登録済み商品に限って白・アイボリーを交互に表示する', () => {
    expect(css).toContain('/* 登録画面の主要なカードを白／淡いアイボリーで交互表示する。');
    expect(css).toContain("#product-details,");
    expect(css).toContain("#manufacturer-documents,");
    expect(css).toContain("#sales-settings");
    expect(css).toContain("#product-main-media,");
    expect(css).toContain("#product-sub-images,");
    expect(css).toContain("#customer-selection,");
    expect(css).toContain("background-color: #f7f4ed;");
    expect(css).toContain("background-color: #fff;");
    expect(css).toContain("[data-testid='registered-product-details']");
    expect(css).toContain("[data-testid='registered-option-pending-subedit']");
    expect(css).toContain("[data-testid='registered-option-current-choices']");
    expect(css).toContain("[data-testid='registered-product-pricing']");
    expect(registered).toContain('data-testid="registered-option-current-choices"');
    expect(css).not.toContain('form > div.rounded-xl.border.border-line.bg-white.p-4');
  });
});
