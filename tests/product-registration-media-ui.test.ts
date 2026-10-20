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

  it('登録済PDFは閲覧を優先し、差し替える時だけ入力を表示する', () => {
    expect(source).toContain('pdfReplaceOpen');
    expect(source).toContain('aria-expanded={pdfReplaceOpen}');
    expect(source).toContain('aria-controls="manufacturer-document-replace-fields"');
    expect(source).toContain('PDFを差し替える');
    expect(source).toContain("option.manufacturer_document_url && !pdfReplaceOpen ? 'hidden' : 'grid gap-4 md:grid-cols-2 md:items-start'");
    expect(source).toContain('setPdfReplaceOpen(false)');
    expect(source).toContain('option.manufacturer_document_url && (');
  });

  it('追加画像とメーカーPDFはURLを左、ファイルを右に並べて画面幅に応じて折り返す', () => {
    expect(source).toContain('data-testid="additional-image-input-layout"');
    expect(source).toContain('data-testid="manufacturer-pdf-input-layout"');
    expect(source).toContain('md:grid-cols-2 md:items-start');
    const extra = source.slice(source.indexOf('data-testid="additional-image-input-layout"'), source.indexOf('</section>', source.indexOf('data-testid="additional-image-input-layout"')));
    expect(extra.indexOf('id="option-sub-image-url"')).toBeGreaterThanOrEqual(0);
    expect(extra.indexOf('id="option-sub-image"')).toBeGreaterThan(extra.indexOf('id="option-sub-image-url"'));
    const pdf = source.slice(source.indexOf('data-testid="manufacturer-pdf-input-layout"'), source.indexOf('{docPending && (', source.indexOf('data-testid="manufacturer-pdf-input-layout"')));
    expect(pdf.indexOf('id="manufacturer-document-url"')).toBeGreaterThanOrEqual(0);
    expect(pdf.indexOf('id="manufacturer-document"')).toBeGreaterThan(pdf.indexOf('id="manufacturer-document-url"'));
  });

  it('PDFは開いた時だけ表示し、枠外クリックとEscで閉じられる', () => {
    expect(source).toContain('pdfPreviewOpen && option.manufacturer_document_url');
    expect(source).toContain('event.target === event.currentTarget');
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('<iframe');
  });
});
