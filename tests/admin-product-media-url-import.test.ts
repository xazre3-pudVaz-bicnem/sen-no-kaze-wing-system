import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mediaManager = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-media-manager.tsx'),
  'utf8'
);
const urlActions = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/actions/product-media-url.ts'),
  'utf8'
);
const remoteMedia = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/http/remote-media.ts'),
  'utf8'
);

describe('商品登録のメディアURL取込', () => {
  it('追加画像をURLから登録できる導線を表示する', () => {
    expect(mediaManager).toContain('または画像URLから登録');
    expect(mediaManager).toContain('addOptionImageFromUrlAction');
    expect(mediaManager).toContain('URL先の画像を取得し、千の風側のストレージへ保存します。');
  });

  it('メーカーPDFを直接URLから登録できる導線を表示する', () => {
    expect(mediaManager).toContain('またはPDFのURLから登録');
    expect(mediaManager).toContain('uploadOptionManufacturerDocumentFromUrlAction');
    expect(mediaManager).toContain('カタログ閲覧ページではなく、PDF本体のURLを入力してください。');
  });

  it('取得した画像とPDFを既存の自社ストレージ保存処理へ渡す', () => {
    expect(urlActions).toContain("fetchRemoteMedia(url, 'image', MAX_IMAGE_BYTES)");
    expect(urlActions).toContain('store.uploadOptionImage(');
    expect(urlActions).toContain("fetchRemoteMedia(url, 'pdf', MAX_PRODUCT_DOCUMENT_BYTES)");
    expect(urlActions).toContain('store.uploadProductDocument(');
    expect(urlActions).toContain('store.setOptionManufacturerDocument(optionId, uploadedUrl)');
  });

  it('外部取得はURL・接続先・サイズ・実ファイル形式を検証する', () => {
    expect(remoteMedia).toContain("url.protocol !== 'https:' && url.protocol !== 'http:'");
    expect(remoteMedia).toContain('validatePublicHost(current)');
    expect(remoteMedia).toContain('readWithLimit(response, maxBytes)');
    expect(remoteMedia).toContain("detected !== 'application/pdf'");
    expect(remoteMedia).toContain("!IMAGE_TYPES.has(detected)");
  });
});
