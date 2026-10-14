import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('components/admin/option-media-manager.tsx', 'utf8');

describe('商品登録の画像・PDF確認UI', () => {
  it('メイン画像は軽量プレビューし、保存前の選択だけ解除できる', () => {
    expect(source).toContain("dataset.mainImageSelectionPreview = 'true'");
    expect(source).toContain("image.loading = 'lazy'");
    expect(source).toContain("clearButton.textContent = '選択を解除'");
    expect(source).toContain("fileInput.value = ''");
  });

  it('追加画像は小さいサムネイルを並べ、詳細設定を折りたためる', () => {
    expect(source).toContain('sizes="160px"');
    expect(source).toContain("gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))'");
    expect(source).toContain('<summary className="cursor-pointer text-xs font-semibold text-ink-soft">表示設定</summary>');
  });

  it('PDFは開いた時だけ表示し、枠外クリックとEscで閉じられる', () => {
    expect(source).toContain('pdfPreviewOpen && option.manufacturer_document_url');
    expect(source).toContain('event.target === event.currentTarget');
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('<iframe');
  });
});
