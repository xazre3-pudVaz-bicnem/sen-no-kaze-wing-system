import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const shared = read('components/admin/product-section-heading.tsx');
const draft = read('components/admin/forms.tsx');
const published = read('components/admin/registered-option-edit-flow.tsx');
const media = read('components/admin/option-media-manager.tsx');
const variants = read('components/admin/option-variant-manager.tsx');
const editPage = read('app/admin/options/[id]/page.tsx');
const newPage = read('app/admin/options/new/page.tsx');

describe('商品登録・編集の共通セクション見出し', () => {
  it('下書き・登録済みのSTEP1見出し1〜6は共通コンポーネントから表示する', () => {
    expect(shared).toContain('export function ProductSectionHeading');
    for (const number of ['1. 基本情報', '2. 商品の詳細', '3. 商品画像', '6. 価格・対象モデル']) {
      expect(draft).toContain(number);
      expect(published).toContain(number);
    }
    expect(media).toContain('label="4. メーカー資料"');
    expect(variants).toContain('label="5. お客様選択"');
    expect(published).toContain('label="4. メーカー資料"');
    expect(published).toContain('label="5. お客様選択"');
    for (const source of [draft, media, variants, published]) {
      expect(source).toContain('<ProductSectionHeading');
    }
  });

  it('CSSで見出し文字を隠したり番号を後付けしない', () => {
    expect(editPage).not.toContain("content: '1. '");
    expect(editPage).not.toContain("content: '2. '");
    expect(editPage).not.toContain("content: '3. 商品画像'");
    expect(editPage).not.toContain("content: '5. お客様選択'");
    expect(editPage).not.toContain("content: '6. 価格・対象モデル'");
    expect(newPage).not.toContain("content: '1. '");
    expect(editPage).toContain('.registration-step1-sections > form#option-main-form { display: contents; }');
    expect(editPage).toContain('registration-step1-sections');
    expect(newPage).toContain('hideCreateSize');
  });

  it('見出し共通化に保存・公開機能を混入しない', () => {
    for (const token of ['saveOptionAction', 'saveVariantChoiceAction', 'updateOptionImageAction', 'form', 'button']) {
      expect(shared).not.toContain('<' + token);
    }
    expect(shared).not.toContain('useActionState');
    expect(draft).toContain('saveOptionAction(initial, new FormData(form))');
    expect(published).toContain('saveOptionAction(initialState, review.formData)');
    expect(variants).toContain('saveVariantChoiceAction');
    expect(media).toContain('uploadOptionManufacturerDocumentAction');
  });
});
