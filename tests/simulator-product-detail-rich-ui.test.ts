import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const productDetail = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/product-detail.tsx'),
  'utf8'
);
const optionPickerDialog = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/option-picker-dialog.tsx'),
  'utf8'
);
const variantPicker = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/variant-picker.tsx'),
  'utf8'
);
const exteriorWallFacesDialog = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/exterior-wall-faces-dialog.tsx'),
  'utf8'
);

describe('シミュレーター商品詳細の情報表示', () => {
  it('通常の商品詳細は全カテゴリーで仕様選択をコンパクトな文字カードにする', () => {
    expect(productDetail).toContain('showImages={false}');
    expect(productDetail).toContain('名称と追加金額を確認して選択してください。商品画像・メーカー資料は左側で確認できます。');
    expect(productDetail).not.toContain('EQUIPMENT_TEXT_VARIANT_CATEGORY_CODES');
    expect(productDetail).not.toContain('useTextVariantCards');
    expect(variantPicker).toContain('const withImage = showImages && list.some((c) => c.image_url);');
    expect(variantPicker).toContain("'grid grid-cols-1 sm:grid-cols-2'");
    expect(variantPicker).toContain("'min-h-10 py-2 pr-2.5 pl-8'");
  });

  it('通常の商品詳細では仕様画像を左ギャラリーへ自動追加しない', () => {
    expect(productDetail).toContain("...(option.image_url ? [{ url: option.image_url, label: '商品全体' }] : []),");
    expect(productDetail).toContain('...(option.gallery_images ?? []).map((image) => ({');
    expect(productDetail).not.toContain('choice.image_url');
    expect(productDetail).not.toContain('groupNameById');
  });

  it('仕様を選んでも左の商品画像を自動切替しない', () => {
    expect(productDetail).toContain('const handleVariantChange = (choiceId: string, groupId: string) => {');
    expect(productDetail).toContain('onVariantChange(choiceId, groupId);');
    expect(productDetail).not.toContain('setActiveImageIndex(imageIndex);');
    expect(productDetail).not.toContain('const imageIndex = galleryImages.findIndex');
    expect(productDetail).toContain('onChange={handleVariantChange}');
  });

  it('商品本体画像・サブ画像・メーカー資料を左側で確認できる', () => {
    expect(productDetail).toContain('option.image_url');
    expect(productDetail).toContain('option.gallery_images');
    expect(productDetail).toContain('option.manufacturer_document_url');
    expect(productDetail).toContain('商品画像');
    expect(productDetail).toContain('メーカー資料');
    expect(productDetail).toContain('onClick={() => setActiveImageIndex(index)}');
    expect(productDetail).toContain('onClick={() => moveImage(-1)}');
    expect(productDetail).toContain('onClick={() => moveImage(1)}');
  });

  it('外壁4面の専用UIは画像付き仕様選択を維持する', () => {
    expect(exteriorWallFacesDialog).toContain('data-testid="exterior-wall-faces-dialog"');
    expect(exteriorWallFacesDialog).toContain('<VariantPicker');
    expect(exteriorWallFacesDialog).not.toContain('showImages={false}');
    expect(variantPicker).toContain('showImages = true');
    expect(variantPicker).toContain('<SmartImage src={c.image_url} alt={c.name} fill sizes="120px" className="object-cover" />');
  });

  it('お客様向け特徴・説明・型番・サイズ・メーカー参考価格を維持する', () => {
    expect(productDetail).toContain('data-testid="product-detail-highlight"');
    expect(productDetail).toContain('{option.description && (');
    expect(productDetail).toContain("{ label: 'シリーズ・型番', value: option.model_no }");
    expect(productDetail).toContain('{ label: sizeLabel(category.code), value: option.size_note }');
    expect(productDetail).toContain('メーカー参考価格 {formatYen(option.list_price)}');
    expect(productDetail).toContain('現在選択中');
    expect(productDetail).toContain('今回の選択内容');
  });

  it('768px以上で左右2カラムとし右側だけをスクロールする', () => {
    expect(productDetail).toContain('md:grid-cols-[minmax(0,1.85fr)_minmax(18rem,1fr)]');
    expect(productDetail).toContain('md:self-start');
    expect(productDetail).toContain('md:overflow-y-auto md:pr-2');
    expect(productDetail).toContain('sizes="(min-width: 768px) 62vw, 90vw"');
    expect(optionPickerDialog).toContain('md:h-[64vh] md:max-h-[42rem] md:overflow-hidden');
    expect(optionPickerDialog).not.toContain('lg:h-[64vh] lg:max-h-[42rem] lg:overflow-hidden');
  });
});
