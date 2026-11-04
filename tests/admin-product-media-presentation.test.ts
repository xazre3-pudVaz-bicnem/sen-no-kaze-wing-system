import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const shared = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/product-media-presentation.tsx'), 'utf8');
const draft = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/option-media-manager.tsx'), 'utf8');
const published = fs.readFileSync(path.resolve(process.cwd(), 'components/admin/registered-option-edit-flow.tsx'), 'utf8');

describe('商品画像・PDFの下書き／登録済み共通表示', () => {
  it('画像サムネイル・画像枚数・PDF登録状態は同一部品を使用する', () => {
    expect(shared).toContain('export function ProductGalleryThumbnail');
    expect(shared).toContain('export function ProductGalleryCount');
    expect(shared).toContain('export function ProductDocumentStatus');
    expect(shared).toContain('src={image.url}');
    expect(shared).toContain("data-registered={registered ? 'true' : 'false'}");
    expect(draft).toContain('<ProductGalleryThumbnail image={image} />');
    expect(published).toContain('<ProductGalleryThumbnail image={image} showCaption />');
    expect(draft).toContain('<ProductGalleryCount count={images.length} />');
    expect(published).toContain('<ProductGalleryCount count={galleryImages.length} />');
    expect(draft).toContain('testId="manufacturer-document-status"');
    expect(published).toContain('testId="registered-manufacturer-document-status"');
  });

  it('追加画像とPDFの書き込み操作は下書きだけに残す', () => {
    expect(draft).toContain('updateOptionImageAction');
    expect(draft).toContain('deleteOptionImageAction');
    expect(draft).toContain('uploadOptionManufacturerDocumentAction');
    expect(draft).toContain('deleteOptionManufacturerDocumentAction');
    expect(published).not.toContain('deleteOptionImageAction');
    expect(published).not.toContain('uploadOptionManufacturerDocumentAction');
    expect(published).toContain('登録済みPDFを別タブで確認');
    expect(published).toContain('追加画像は改版機能の準備ができるまで参照専用です');
    expect(published).toContain('saveOptionAction(initialState, review.formData)');
  });

  it('共通表示部品には登録・削除アクションを入れない', () => {
    expect(shared).not.toContain('useActionState');
    expect(shared).not.toContain('saveOptionAction');
    expect(shared).not.toContain('deleteOptionImageAction');
    expect(shared).not.toContain('uploadOptionManufacturerDocumentAction');
    expect(shared).not.toContain('<form');
    expect(shared).not.toContain('<button');
  });
});
