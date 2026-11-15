import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StandardEstimateV25ProductPicker, v25PickerChoicesComplete } from '@/components/admin/standard-estimate-v25-product-picker';
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

  it('すべての選択項目を選んだ場合だけ確定可能（値の一致も検査）', () => {
    expect(v25PickerChoicesComplete(sample, { color: 'white' })).toBe(true);
    expect(v25PickerChoicesComplete(sample, { color: 'black' })).toBe(true);
    expect(v25PickerChoicesComplete(sample, { color: '' })).toBe(false);
    expect(v25PickerChoicesComplete(sample, { color: 'invalid' })).toBe(false);
    expect(v25PickerChoicesComplete({ variantGroups: [] }, {})).toBe(true);
  });
});
