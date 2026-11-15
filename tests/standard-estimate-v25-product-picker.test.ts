import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StandardEstimateV25ProductPicker, v25PickerChoicesValid } from '@/components/admin/standard-estimate-v25-product-picker';
import type { V25WorkbenchCandidate } from '@/lib/domain/standard-estimate-v25-workbench';

const sample: V25WorkbenchCandidate = {
  id: 'sample', name: 'テスト用ドア', categoryId: 'door', categoryName: '玄関ドア',
  categoryCode: 'entrance', singleSelect: false, manufacturer: 'メーカーA',
  modelNo: 'X-1', imageUrl: 'https://example.com/sample.jpg', section: 'option',
  defaultChoices: { color: 'white' },
  variantGroups: [{ id: 'color', name: '扉色', choices: [{ id: 'white', name: 'ホワイト' }, { id: 'black', name: 'ブラック' }] }],
};

describe('v2.5商品選択のUI', () => {
  it('商品画像・メーカー・型番と、選択→仕様確認→明細反映の領域を示す', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      sectionLabel: 'オプション', candidates: [sample], currentSlot: null, onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('data-testid="v25-wb-product-picker"');
    expect(html).toContain('data-testid="v25-wb-picker-candidate"');
    expect(html).toContain('sample.jpg');
    expect(html).toContain('メーカーA ／ X-1');
    expect(html).toContain('商品名・メーカー・型番');
    expect(html).toContain('明細に反映');
    expect(html).toContain('disabled=""');
  });

  it('同じ商品への切替では既存の仕様を保持する設計', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      sectionLabel: 'オプション', candidates: [sample],
      currentSlot: { option_id: sample.id, variant_choices: { color: 'black' } },
      onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('現在：テスト用ドア');
    expect(html).toContain('現在の商品');
  });

  it('旧明細置換では商品カテゴリーの選択を必須とし、通常の商品選択は維持する', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      sectionLabel: '内外装工事', candidates: [sample], currentSlot: null,
      requireCategory: true, replaceLineName: '旧玄関ドア',
      onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('旧明細を商品に置き換える');
    expect(html).toContain('旧玄関ドア');
    expect(html).toContain('置換先カテゴリーを選択（必須）');
    expect(html).toContain('data-testid="v25-wb-replacement-category-required"');
    expect(html).toContain('disabled=""');
  });

  it('選択肢の不正な値を拒否し、未選択は従来どおり許可する', () => {
    expect(v25PickerChoicesValid(sample, { color: 'white' })).toBe(true);
    expect(v25PickerChoicesValid(sample, { color: 'black' })).toBe(true);
    expect(v25PickerChoicesValid(sample, { color: '' })).toBe(true);
    expect(v25PickerChoicesValid(sample, { color: 'invalid' })).toBe(false);
    expect(v25PickerChoicesValid({ variantGroups: [] }, {})).toBe(true);
  });
});
