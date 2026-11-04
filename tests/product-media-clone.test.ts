import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filesDir, loadDb, saveDb } from '@/lib/data/local-db';
import { LocalStore } from '@/lib/data/local-store';
import type { OptionImage, ProductOption } from '@/lib/domain/types';
import {
  managedPublicObjectPath,
  managedLocalObjectPath,
  markKeepCopiedDraft,
  MAX_CLONE_GALLERY_IMAGES,
  safeCloneExtension,
  shouldKeepCopiedDraft,
} from '@/lib/storage/product-media-copy';

const read = (pathName: string) => fs.readFileSync(path.resolve(process.cwd(), pathName), 'utf8');
const probe = 'https://example.supabase.co/storage/v1/object/public/product-images/__clone_probe__';

describe('商品メディアの独立複製：URLの出所', () => {
  it('同一Supabase projectのStorage画像だけを対象にする', () => {
    expect(managedPublicObjectPath('https://example.supabase.co/storage/v1/object/public/product-images/options/a.png', probe)).toBe('options/a.png');
    expect(managedPublicObjectPath('https://different.supabase.co/storage/v1/object/public/product-images/options/a.png', probe)).toBeNull();
    expect(managedPublicObjectPath('https://attacker.test/storage/v1/object/public/product-images/options/a.png', probe)).toBeNull();
    expect(managedPublicObjectPath('https://example.supabase.co/other/options/a.png', probe)).toBeNull();
    expect(managedPublicObjectPath('https://example.supabase.co/storage/v1/object/public/product-images/options/a.png?token=abc', probe)).toBeNull();
  });

  it('ディレクトリ脱出やURLエンコードの抜け道を拒否する', () => {
    const base = 'https://example.supabase.co/storage/v1/object/public/product-images/';
    expect(managedPublicObjectPath(base + 'options/%2e%2e/secret.png', probe)).toBeNull();
    expect(managedPublicObjectPath(base + 'options/%2fsecret.png', probe)).toBeNull();
    expect(managedLocalObjectPath('/api/local-files/options/a.png')).toBe('options/a.png');
    expect(managedLocalObjectPath('/api/local-files/option-123/%2e%2e/x.png')).toBeNull();
    expect(managedLocalObjectPath('https://attacker.test/api/local-files/options/a.png')).toBeNull();
  });

  it('未知の拡張子・任意ファイルをStorage内でもコピーしない', () => {
    expect(safeCloneExtension('options/a.png', 'image')).toBe('png');
    expect(safeCloneExtension('options/a.PDF', 'pdf')).toBe('pdf');
    expect(safeCloneExtension('options/a.svg', 'image')).toBeNull();
    expect(safeCloneExtension('options/a.exe', 'image')).toBeNull();
    expect(safeCloneExtension('options/a.png', 'pdf')).toBeNull();
  });
});

describe('商品メディア複製の保存導線', () => {
  const form = read('components/admin/forms.tsx');
  const newPage = read('app/admin/options/new/page.tsx');
  const action = read('lib/actions/admin.ts');
  const editPage = read('app/admin/options/[id]/page.tsx');
  const supabase = read('lib/data/supabase-store.ts');
  const local = read('lib/data/local-store.ts');
  const ledger = read('lib/actions/product-ledger.ts');

  it('複製元IDを新規フォームでだけ送り、サーバーで権限とコピー元を再検証する（複製先のカテゴリーは変えてよい）', () => {
    expect(form).toContain('copySource && <input type="hidden" name="copy_from" value={copySource.id} />');
    expect(action).toContain('if (optionId || !catalogEditor)');
    expect(action).not.toContain('source.category_id !== String(formData.get(\'category_id\') ?? \'\').trim()');
    expect(action).toContain('sourceCategory.code === FREE_PRODUCT_CATEGORY_CODE');
    expect(action).toContain('sourceCategory.code === LEGACY_FIRE_SPEC_CATEGORY_CODE');
  });
  it('新商品ができてからコピーし、失敗時は新しい下書きだけ削除する', () => {
    expect(action).toContain('await store.copyOptionMediaToNewDraft(copyFrom, createdId)');
    expect(action).toContain('await store.deleteOption(createdId)');
    // 取り消しに失敗して下書き・ファイルを残すときは、下書きを消さない
    expect(action).toContain('if (copyFrom && createdId && !shouldKeepCopiedDraft(e))');
    expect(action).toContain("params.set('copy_missing', copySkipped.join(','))");
    expect(newPage).toContain('外部URLやStorage外のファイルは複製されません');
    expect(editPage).toContain('sp.copy_missing');
    expect(ledger).toContain('await store.deleteOption(id)');
  });
  it('両ストアがコピー元と複製先を検証し、別ファイルを作ってからコピー先だけ更新する', () => {
    for (const store of [supabase, local]) {
      expect(store).toContain('copyOptionMediaToNewDraft(sourceId: string, newDraftId: string)');
      expect(store).toContain('target.status !== \'draft\'');
      expect(store).toContain("optionMediaPrefix(newDraftId, 'gallery')");
      expect(store).toContain("optionMediaPrefix(newDraftId, 'manufacturer')");
      expect(store).toContain('copiedGallery: galleryRows.length');
      expect(store).not.toContain('copyOptionMediaToNewDraft(sourceId, sourceId)');
    }
    expect(supabase).toContain('bucket.copy(job.from, job.to)');
    expect(supabase).toContain('copied.filter((job) => job.bucket === bucketName)');
    expect(local).toContain('fs.copyFileSync(from, to)');
  });
});

describe('商品メディアの独立複製：失敗した 1 件だけ飛ばす・上限・下書きを残す印', () => {
  const SRC = '00000000-0000-4000-8000-0000000005c1';
  const DST = '00000000-0000-4000-8000-0000000005d1';
  let dir = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-media-clone-'));
    process.env.WING_LOCAL_DIR = dir;
  });
  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** コピー元（公開中）と、メディア未登録の新しい下書きを作る。missing の追加画像はファイルを置かない */
  function seed(galleryCount: number, missing: number[] = []) {
    const db = loadDb();
    const categoryId = db.categories[0].id;
    const base = db.options[0];
    const option = (id: string, status: string, patchValues: Partial<ProductOption>) =>
      ({ ...base, id, code: 'clone-' + id.slice(-4), name: '複製の検査 ' + id.slice(-4), category_id: categoryId, status, ...patchValues }) as ProductOption;
    const write = (relative: string) => {
      const file = path.join(filesDir(), ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'x');
    };
    write('products/main.png');
    write('option-' + SRC + '/manufacturer/doc.pdf');
    db.options.push(
      option(SRC, 'published', { image_url: '/api/local-files/products/main.png', manufacturer_document_url: '/api/local-files/option-' + SRC + '/manufacturer/doc.pdf' }),
      option(DST, 'draft', { image_url: null, manufacturer_document_url: null })
    );
    for (let i = 0; i < galleryCount; i++) {
      const relative = 'option-' + SRC + '/gallery/g' + String(i).padStart(2, '0') + '.png';
      if (!missing.includes(i)) write(relative);
      db.optionImages.push({ id: '00000000-0000-4000-8000-' + String(100000000000 + i), option_id: SRC, url: '/api/local-files/' + relative, alt: 'alt' + i, caption: null, sort_order: i, created_at: new Date().toISOString() } as OptionImage);
    }
    saveDb(db);
  }

  it('コピー元のファイルが無い追加画像だけ飛ばし、残りは別ファイルとして複製する（下書きは消さない）', async () => {
    seed(3, [1]);
    const result = await new LocalStore().copyOptionMediaToNewDraft(SRC, DST);
    expect(result).toMatchObject({ copiedMain: true, copiedGallery: 2, copiedPdf: true });
    expect(result.skipped).toEqual(['追加画像']);
    const draft = await new LocalStore().getOption(DST);
    expect(draft?.image_url).toMatch(new RegExp('^/api/local-files/option-' + DST + '/main/'));
    expect(draft?.gallery_images?.map((image) => image.alt)).toEqual(['alt0', 'alt2']);
    // コピー元は変えない
    const source = await new LocalStore().getOption(SRC);
    expect(source?.gallery_images).toHaveLength(3);
  });

  it('追加画像は並び順で上限まで複製し、上限を超えた分は「複製できなかったメディア」に出す', async () => {
    seed(MAX_CLONE_GALLERY_IMAGES + 2);
    const result = await new LocalStore().copyOptionMediaToNewDraft(SRC, DST);
    expect(result.copiedGallery).toBe(MAX_CLONE_GALLERY_IMAGES);
    expect(result.skipped).toEqual(['追加画像（' + (MAX_CLONE_GALLERY_IMAGES + 1) + '枚目以降）']);
  });

  it('下書きを残す印は、印を付けたエラーだけに付く', () => {
    expect(shouldKeepCopiedDraft(markKeepCopiedDraft(new Error('rollback failed')))).toBe(true);
    expect(shouldKeepCopiedDraft(new Error('copy failed'))).toBe(false);
    expect(shouldKeepCopiedDraft(null)).toBe(false);
  });
});
