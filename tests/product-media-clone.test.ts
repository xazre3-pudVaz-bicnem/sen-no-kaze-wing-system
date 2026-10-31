import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { managedPublicObjectPath, managedLocalObjectPath, safeCloneExtension } from '@/lib/storage/product-media-copy';

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

  it('複製元IDを新規フォームでだけ送り、サーバーで権限とカテゴリーを再検証する', () => {
    expect(form).toContain('copySource && <input type="hidden" name="copy_from" value={copySource.id} />');
    expect(action).toContain('if (optionId || !catalogEditor)');
    expect(action).toContain('source.category_id !== String(formData.get(\'category_id\') ?? \'\').trim()');
    expect(action).toContain('sourceCategory.code === FREE_PRODUCT_CATEGORY_CODE');
    expect(action).toContain('sourceCategory.code === LEGACY_FIRE_SPEC_CATEGORY_CODE');
  });
  it('新商品ができてからコピーし、失敗時は新しい下書きだけ削除する', () => {
    expect(action).toContain('await store.copyOptionMediaToNewDraft(copyFrom, createdId)');
    expect(action).toContain('await store.deleteOption(createdId)');
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
