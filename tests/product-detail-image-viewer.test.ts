import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const detail = readFileSync('components/simulator/product-detail.tsx', 'utf8');
const lightbox = readFileSync('components/simulator/product-image-lightbox.tsx', 'utf8');

describe('共通商品詳細の画像名と拡大表示', () => {
  it('メイン画像の直下に13pxの画像名と画像番号を表示し、サムネイル下では繰り返さない', () => {
    const imagePanel = detail.indexOf('id="product-media-panel"');
    const caption = detail.indexOf('data-testid="product-detail-image-caption"');
    const thumbnails = detail.indexOf('aria-label="商品画像一覧"');
    expect(imagePanel).toBeGreaterThan(0);
    expect(caption).toBeGreaterThan(imagePanel);
    expect(thumbnails).toBeGreaterThan(caption);
    expect(detail).toContain('text-[13px] font-semibold');
    expect(detail).toContain('表示中の画像');
    expect(detail).toContain('{safeImageIndex + 1} / {galleryImages.length}');
    expect(detail).not.toContain('className="mt-1 truncate text-[0.65rem] text-muted"');
    expect(detail).not.toContain('absolute bottom-2 right-2 rounded-full bg-ink/70');
  });

  it('画像をクリックして拡大し、スワイプ・矢印・サムネイル切替を維持する', () => {
    expect(detail).toContain('setImageLightboxOpen(true)');
    expect(detail).toContain('aria-label={`${activeImage.label}を拡大表示`}');
    expect(detail).toContain('onClick={() => moveImage(-1)}');
    expect(detail).toContain('onClick={() => moveImage(1)}');
    expect(detail).toContain('onClick={() => setActiveImageIndex(index)}');
    expect(detail).toContain('onTouchStart={(event) => {');
    expect(detail).toContain('onTouchEnd={(event) => {');
    expect(detail).toContain('swipeHandled.current = true');
    expect(detail).toContain('<ProductImageLightbox');
  });

  it('ネイティブダイアログを使い、親の商品選択dialogより前面に開く', () => {
    expect(lightbox).toContain('<dialog');
    expect(lightbox).toContain('dialog.showModal()');
    expect(lightbox).toContain('aria-modal="true"');
    expect(lightbox).toContain('data-testid="product-detail-image-lightbox"');
    expect(lightbox).toContain('onCancel={(event) => {');
    expect(lightbox).toContain('event.preventDefault()');
    expect(lightbox).toContain('previouslyFocused?.focus()');
    expect(lightbox).toContain('ref={closeButtonRef}');
    expect(lightbox).toContain('event.target !== event.currentTarget');
  });

  it('拡大画面では100%〜400%の拡大縮小・スクロール・前後切替ができる', () => {
    expect(lightbox).toContain('Math.max(1, value - 0.5)');
    expect(lightbox).toContain('Math.min(4, value + 0.5)');
    expect(lightbox).toContain('style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}');
    expect(lightbox).toContain('overflow-auto overscroll-contain');
    expect(lightbox).toContain('onSelect((index + direction + images.length) % images.length)');
    expect(lightbox).toContain('aria-label="拡大画像の前の画像"');
    expect(lightbox).toContain('aria-label="拡大画像の次の画像"');
    expect(lightbox).toContain('aria-label="拡大表示を閉じる"');
  });

  it('拡大画像のクリック・タップとキーボード操作で閉じられ、他の操作は維持する', () => {
    const scrollArea = lightbox.slice(lightbox.indexOf('data-testid="product-detail-image-zoom-area"'));
    const imageButton = scrollArea.slice(
      scrollArea.indexOf('aria-label="拡大画像をクリックして閉じる"'),
      scrollArea.indexOf('</button>')
    );
    expect(imageButton).toContain('onClick={onClose}');
    expect(imageButton).toContain('cursor-zoom-out');
    expect(imageButton).toContain('type="button"');
    expect(imageButton).toContain('<SmartImage');
    expect(imageButton).toContain('style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}');
    expect(lightbox).toContain('aria-label="拡大表示を閉じる"');
    expect(lightbox).toContain('onCancel={(event) => {');
    expect(lightbox).toContain('aria-label="画像を拡大"');
    expect(lightbox).toContain('aria-label="拡大画像の次の画像"');
  });

  it('画像操作で商品仕様・金額・PDF表示の動作を変更しない', () => {
    expect(detail).toContain('const handleVariantChange = (choiceId: string, groupId: string) => {');
    expect(detail).toContain('onVariantChange(choiceId, groupId);');
    expect(detail).toContain('showImages={false}');
    expect(detail).toContain('onChange={handleVariantChange}');
    expect(detail).toContain('<ManufacturerDocumentModal');
    expect(detail).not.toContain('setActiveImageIndex(imageIndex);');
    expect(lightbox).not.toContain('onVariantChange');
    expect(lightbox).not.toContain('selectedVariantIds');
  });
});
