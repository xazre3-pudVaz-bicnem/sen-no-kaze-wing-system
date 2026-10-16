import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const action = read('lib/actions/product-media-url.ts');
const importer = read('components/admin/product-main-image-url-importer.tsx');
const host = read('components/admin/product-power-spec.tsx');
const units = read('components/admin/product-price-unit.tsx');
const media = read('components/admin/option-media-manager.tsx');

describe('商品メディア URL 取込', () => {
  it('メイン画像URLは外部URLを正式値にせず自社ストレージへ取り込んで image_url だけ更新する', () => {
    expect(action).toContain('uploadOptionMainImageFromUrlAction');
    expect(action).toContain("fetchRemoteMedia(url, 'image', MAX_IMAGE_BYTES)");
    expect(action).toContain("await store.uploadImage(");
    expect(action).toContain("'options'");
    expect(action).toContain(".update({ image_url: uploadedUrl })");
    expect(action).toContain('deleteUploadedImage(previousUrl)');
    expect(action).toContain('savedImageUrl: uploadedUrl');
  });

  it('STEP1の既存メイン画像URL欄にURL取込ボタンを追加して保存後URLとプレビューを同期する', () => {
    expect(importer).toContain("input[name=\"image_url\"]");
    expect(importer).toContain('URLから取り込んで保存');
    expect(importer).toContain('uploadOptionMainImageFromUrlAction');
    expect(importer).toContain('input.value = result.savedImageUrl');
    expect(importer).toContain("new Event('input', { bubbles: true })");
    expect(host).toContain('<ProductMainImageUrlImporter optionId={optionId} />');
  });

  it('価格単位を変更していない別項目保存では価格単位専用列へ書き込まない', () => {
    expect(units).toContain('const unitDirtyRef = useRef(false)');
    expect(units).toContain('if (!unitDirtyRef.current) return true');
    expect(units).toContain('unitDirtyRef.current = true');
    expect(units).toContain('if (result.ok) unitDirtyRef.current = false');
  });

  it('電源仕様を変更していない別項目保存では電源仕様専用列へ書き込まない', () => {
    expect(host).toContain('const powerSpecDirtyRef = useRef(false)');
    expect(host).toContain('if (!powerSpecDirtyRef.current) return true');
    expect(host).toContain('powerSpecDirtyRef.current = true');
    expect(host).toContain('if (result.ok) powerSpecDirtyRef.current = false');
  });

  it('メーカーPDF URL登録は既存のSSRF対策済み取込Actionを継続利用する', () => {
    expect(media).toContain('uploadOptionManufacturerDocumentFromUrlAction');
    expect(action).toContain("fetchRemoteMedia(url, 'pdf', MAX_PRODUCT_DOCUMENT_BYTES)");
    expect(action).toContain('setOptionManufacturerDocument(optionId, uploadedUrl)');
  });
});
