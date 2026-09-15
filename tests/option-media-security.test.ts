import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertOwnedLocalMediaPath,
  assertOwnedPublicStoragePath,
  optionMediaPrefix,
} from '@/lib/storage/option-media';

const OPTION_A = '11111111-1111-4111-8111-111111111111';
const OPTION_B = '22222222-2222-4222-8222-222222222222';

describe('商品メディアStorage境界', () => {
  it('option ID固有prefixを生成する', () => {
    expect(optionMediaPrefix(OPTION_A, 'gallery')).toBe(`option-${OPTION_A}/gallery/`);
    expect(optionMediaPrefix(OPTION_A, 'manufacturer')).toBe(`option-${OPTION_A}/manufacturer/`);
  });

  it('自分のgallery objectだけ削除対象として許可する', () => {
    const url = `https://example.supabase.co/storage/v1/object/public/product-images/option-${OPTION_A}/gallery/a.webp`;
    expect(assertOwnedPublicStoragePath(url, 'product-images', OPTION_A, 'gallery')).toBe(
      `option-${OPTION_A}/gallery/a.webp`
    );
  });

  it('他optionのgallery URLを細工しても拒否する', () => {
    const url = `https://example.supabase.co/storage/v1/object/public/product-images/option-${OPTION_B}/gallery/a.webp`;
    expect(() => assertOwnedPublicStoragePath(url, 'product-images', OPTION_A, 'gallery')).toThrow(
      '他の商品に属するStorage objectは削除できません'
    );
  });

  it('他optionのメーカー資料URLを細工しても拒否する', () => {
    const url = `https://example.supabase.co/storage/v1/object/public/product-documents/option-${OPTION_B}/manufacturer/spec.pdf`;
    expect(() => assertOwnedPublicStoragePath(url, 'product-documents', OPTION_A, 'manufacturer')).toThrow(
      '他の商品に属するStorage objectは削除できません'
    );
  });

  it('prefix内のpath traversalを拒否する', () => {
    const url = `https://example.supabase.co/storage/v1/object/public/product-images/option-${OPTION_A}/gallery/../option-${OPTION_B}/gallery/a.webp`;
    expect(() => assertOwnedPublicStoragePath(url, 'product-images', OPTION_A, 'gallery')).toThrow(
      'Storage pathが正しくありません'
    );
  });

  it('ローカルモードでも他optionのURLを拒否する', () => {
    const url = `/api/local-files/option-${OPTION_B}/gallery/a.webp`;
    expect(() => assertOwnedLocalMediaPath(url, OPTION_A, 'gallery')).toThrow(
      '他の商品に属するローカルメディアは削除できません'
    );
  });

  it('SupabaseStoreのservice role削除は所有prefix検証を必ず通す', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/data/supabase-store.ts'), 'utf8');
    expect(source).toContain("assertOwnedPublicStoragePath(url, 'product-images', optionId, 'gallery')");
    expect(source).toContain("assertOwnedPublicStoragePath(url, 'product-documents', optionId, 'manufacturer')");
    expect(source).toContain("optionMediaPrefix(optionId, 'gallery')");
    expect(source).toContain("optionMediaPrefix(optionId, 'manufacturer')");
  });

  it('商品メディアActionは汎用deleteUploadedImageではなくoption境界付き削除を使う', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/actions/admin.ts'), 'utf8');
    const mediaSection = source.slice(source.indexOf('export async function addOptionImageAction'), source.indexOf('export async function deleteOptionAction'));
    expect(mediaSection).toContain('uploadOptionImage(');
    expect(mediaSection).toContain('deleteUploadedOptionImage(');
    expect(mediaSection).toContain('deleteUploadedProductDocument(');
    expect(mediaSection).not.toContain('deleteUploadedImage(');
  });
});
