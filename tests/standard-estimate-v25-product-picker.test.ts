import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StandardEstimateV25ProductPicker, v25PickerChoicesValid, v25PickerStandardCostLabel } from '@/components/admin/standard-estimate-v25-product-picker';
import { readFileSync } from 'node:fs';
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
      sectionLabel: 'オプション', candidates: [sample], productCosts: { sample: 480000 },
      currentSlot: null, onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('data-testid="v25-wb-product-picker"');
    expect(html).toContain('data-testid="v25-wb-picker-candidate"');
    expect(html).toContain('sample.jpg');
    expect(html).toContain('メーカーA ／ X-1');
    expect(html).toContain('商品名・メーカー・型番');
    expect(html).toContain('明細に反映');
    expect(html).toContain('disabled=""');
    expect(html).toContain('商品標準原価（税別）');
    expect(html).toContain('¥480,000');
    expect(html).toContain('data-testid="v25-wb-picker-list-cost"');
  });

  it('同じ商品への切替では既存の仕様を保持する設計', () => {
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      sectionLabel: 'オプション', candidates: [sample], productCosts: { sample: 480000 },
      currentSlot: { option_id: sample.id, variant_choices: { color: 'black' } },
      onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('現在：テスト用ドア');
    expect(html).toContain('現在の商品');
  });

  it('未登録は0円と誤表示せず、登録済0円・正の原価は区別する', () => {
    expect(v25PickerStandardCostLabel(null)).toBe('原価未設定');
    expect(v25PickerStandardCostLabel(undefined)).toBe('原価未設定');
    expect(v25PickerStandardCostLabel(Number.NaN)).toBe('原価未設定');
    expect(v25PickerStandardCostLabel(0)).toBe('¥0');
    expect(v25PickerStandardCostLabel(480000)).toBe('¥480,000');
    const html = renderToStaticMarkup(createElement(StandardEstimateV25ProductPicker, {
      sectionLabel: 'オプション', candidates: [{ ...sample, id: 'not-priced' }],
      productCosts: {}, currentSlot: null, onChoose: () => {}, onClose: () => {},
    }));
    expect(html).toContain('原価未設定');
  });

  it('商品編集を別タブで開き、最新原価のみ表示し計算・保存処理を変えない', () => {
    const picker = readFileSync('components/admin/standard-estimate-v25-product-picker.tsx', 'utf8');
    const workbench = readFileSync('components/admin/standard-estimate-v25-workbench.tsx', 'utf8');
    expect(picker).toContain('data-testid="v25-wb-picker-detail-cost"');
    expect(picker).toContain('data-testid="v25-wb-picker-edit-product"');
    expect(picker).toContain('encodeURIComponent(selected.id)');
    expect(picker).toContain('target="_blank" rel="noopener noreferrer"');
    expect(picker).toContain('選択肢の原価差額・見積売価は含みません');
    expect(picker).toContain('未保存入力を保存してから画面を再読込');
    expect(workbench).toContain('productCosts={costs.currentProduct}');
    expect(workbench).toContain('onChoose={choose}');
  });

  it('選択肢の不正な値を拒否し、未選択は従来どおり許可する', () => {
    expect(v25PickerChoicesValid(sample, { color: 'white' })).toBe(true);
    expect(v25PickerChoicesValid(sample, { color: 'black' })).toBe(true);
    expect(v25PickerChoicesValid(sample, { color: '' })).toBe(true);
    expect(v25PickerChoicesValid(sample, { color: 'invalid' })).toBe(false);
    expect(v25PickerChoicesValid({ variantGroups: [] }, {})).toBe(true);
  });
});
