import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasPanasonicLightingAttribution } from '@/lib/domain/panasonic-lighting-attribution';

describe('パナソニック照明の商品画像提供元表示', () => {
  it.each(['パナソニック', 'パナソニック エレクトリックワークス株式会社', ' パナソニック　エレクトリックワークス株式会社 '])('登録済みメーカー表記 %s に対応する', (manufacturer) => {
    expect(hasPanasonicLightingAttribution('lighting', manufacturer, 1)).toBe(true);
  });

  it('他のメーカーや未設定のメーカーには表示しない', () => {
    for (const manufacturer of ['株式会社セキノ興産', '三菱電機', 'パナソニックAWエンジニアリング株式会社', '他社パナソニック', null, undefined, '']) {
      expect(hasPanasonicLightingAttribution('lighting', manufacturer, 1)).toBe(false);
    }
  });

  it('照明以外または画像なしの場合は表示しない', () => {
    for (const category of ['aircon', 'toilet', 'washbasin', 'ub', 'entrance-storage']) {
      expect(hasPanasonicLightingAttribution(category, 'パナソニック', 1)).toBe(false);
    }
    expect(hasPanasonicLightingAttribution('lighting', 'パナソニック', 0)).toBe(false);
  });

  it('共通商品詳細で画像の下に表示し、既存のセキノ興産表示も保持する', () => {
    const component = readFileSync('components/simulator/product-detail.tsx', 'utf8');
    expect(component).toContain('hasPanasonicLightingAttribution(category.code, option.manufacturer, galleryImages.length)');
    expect(component).toContain('data-testid="panasonic-lighting-image-attribution"');
    expect(component).toContain('画像提供元：パナソニック エレクトリックワークス株式会社');
    expect(component).toContain('isSekinoKosan && galleryImages.length > 0');
    expect(component).toContain('画像提供：株式会社セキノ興産');
    expect(component).toContain('※画面上の色は実物と異なる場合があります。');
    expect(component.indexOf('data-testid="panasonic-lighting-image-attribution"')).toBeGreaterThan(component.indexOf('aria-label="商品画像一覧"'));
  });
});
