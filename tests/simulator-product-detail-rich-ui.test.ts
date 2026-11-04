import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const productDetail = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/product-detail.tsx'),
  'utf8'
);
const manufacturerDocumentModal = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/manufacturer-document-modal.tsx'),
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
  it('共通商品詳細で画像がある選択項目だけ見本カード、画像がない項目は文字カードにする', () => {
    expect(productDetail).toContain('showImages');
    expect(productDetail).not.toContain('showImages={false}');
    expect(productDetail).toContain('色・柄の見本画像は拡大できます。');
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

  it('商品本体画像・サブ画像・メーカー資料を確認できる', () => {
    expect(productDetail).toContain('option.image_url');
    expect(productDetail).toContain('option.gallery_images');
    expect(productDetail).toContain('option.manufacturer_document_url');
    expect(productDetail).toContain('商品画像');
    expect(productDetail).toContain('メーカー資料を見る');
    expect(productDetail).toContain('onClick={() => setManufacturerDocumentOpen(true)}');
    expect(productDetail).toContain('onClick={() => setActiveImageIndex(index)}');
    expect(productDetail).toContain('onClick={() => moveImage(-1)}');
    expect(productDetail).toContain('onClick={() => moveImage(1)}');
  });

  it('メーカー資料は1クリックで大きなPDFモーダルを開き、開いた時だけ読み込む', () => {
    expect(productDetail).toContain('<ManufacturerDocumentModal');
    expect(productDetail).not.toContain("activeMedia === 'document'");
    expect(manufacturerDocumentModal).toContain("if (!open || !url) return null;");
    expect(manufacturerDocumentModal).toContain('data-testid="manufacturer-document-modal"');
    expect(manufacturerDocumentModal).toContain('h-[88vh]');
    expect(manufacturerDocumentModal).toContain('<iframe');
    expect(manufacturerDocumentModal).toContain('loading="lazy"');
    expect(manufacturerDocumentModal).toContain('別タブで開く');
    expect(manufacturerDocumentModal).toContain("event.key === 'Escape'");
    expect(manufacturerDocumentModal).toContain('event.target === event.currentTarget');
    expect(manufacturerDocumentModal).toContain('aria-label="メーカー資料を閉じる"');
  });

  it('PDFを見ながらカラー・仕様を選び、商品詳細と同じ選択状態へ反映する', () => {
    expect(productDetail).toContain('groups={editableGroups}');
    expect(productDetail).toContain('choices={choices}');
    expect(productDetail).toContain('selectedVariantIds={selectedVariantIds}');
    expect(productDetail).toContain('onVariantChange={handleVariantChange}');
    expect(manufacturerDocumentModal).toContain('data-testid="manufacturer-document-variant-panel"');
    expect(manufacturerDocumentModal).toContain('カラー・仕様を選ぶ');
    expect(manufacturerDocumentModal).toContain('ここでの選択は商品詳細にもそのまま反映されます。');
    expect(manufacturerDocumentModal).toContain('<VariantPicker');
    expect(manufacturerDocumentModal).toContain('selected={selectedVariantIds}');
    expect(manufacturerDocumentModal).toContain('onChange={onVariantChange}');
    expect(manufacturerDocumentModal).toContain('showImages');
  });

  it('PDFと仕様選択はPCで左右、スマホでは上下に同時表示する', () => {
    expect(manufacturerDocumentModal).toContain('grid-rows-[minmax(15rem,1.35fr)_minmax(12rem,1fr)]');
    expect(manufacturerDocumentModal).toContain('md:grid-cols-[minmax(0,1.8fr)_minmax(19rem,0.8fr)]');
    expect(manufacturerDocumentModal).toContain('md:grid-rows-1');
    expect(manufacturerDocumentModal).toContain('md:border-l md:border-t-0');
  });

  it('仕様選択がない商品では従来どおりPDFを全面表示する', () => {
    expect(manufacturerDocumentModal).toContain('const hasSelectableVariants = groups.length > 0;');
    expect(manufacturerDocumentModal).toContain('{hasSelectableVariants ? (');
  });

  it('外壁4面の専用UIは画像付き仕様選択を維持する', () => {
    expect(exteriorWallFacesDialog).toContain('data-testid="exterior-wall-faces-dialog"');
    expect(exteriorWallFacesDialog).toContain('<VariantPicker');
    expect(exteriorWallFacesDialog).not.toContain('showImages={false}');
    expect(variantPicker).toContain('showImages = true');
    expect(variantPicker).toContain('<ChoiceThumbnail');
    expect(variantPicker).toContain('<ProductImageLightbox');
    expect(variantPicker).toContain('aria-label={`${c.name}の色・柄見本を拡大`}');
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
