import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ProductCategoryGuidance,
  productSizeMeta,
  productRegistrationGuidance,
} from '@/components/admin/product-category-guidance';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const draft = read('components/admin/forms.tsx');
const published = read('components/admin/registered-option-edit-flow.tsx');
const media = read('components/admin/option-media-manager.tsx');
const variants = read('components/admin/option-variant-manager.tsx');

describe('商品編集の余白・カテゴリー別入力補助の共通化', () => {
  it('カテゴリー別の入力ラベル・候補は下書きと登録済みで同じ定義を使う', () => {
    expect(productSizeMeta('ub').label).toBe('サイズ');
    expect(productSizeMeta('boiler').label).toContain('号数');
    expect(productSizeMeta('entrance-door').placeholder).toContain('W900');
    expect(productRegistrationGuidance('ub').sizeCandidates).toContain('1216');
    expect(productRegistrationGuidance('aircon').sizeCandidates).toContain('2.2kW（6畳程度）');
    expect(productRegistrationGuidance('not-registered').sizeCandidates).toEqual([]);
    expect(draft).toContain('<ProductCategoryGuidance categoryCode={categoryCode} />');
    expect(published).toContain('<ProductCategoryGuidance categoryCode={selectedCategoryCode} readOnlyChoices />');
    expect(draft).toContain('productSizeMeta(categoryCode)');
    expect(published).toContain('productSizeMeta(selectedCategoryCode)');
  });

  it('登録済み商品でもカテゴリー変更に応じて表示補助が切り替わるが入力値は確認まで保存しない', () => {
    expect(published).toContain('setSelectedCategoryId(event.target.value)');
    expect(published).toContain('setIdentityChanged(true)');
    expect(published).toContain('label={sizeMeta.label}');
    expect(published).toContain('placeholder={sizeMeta.placeholder}');
    expect(published).toContain('list="registered-size-note-suggestions"');
    expect(published).toContain('sizeGuidance.sizeCandidates.slice(0, 10).map');
    expect(published).toContain('setSizeNoteValue(value)');
    expect(published).toContain('type="button"');
    expect(published).toContain('saveOptionAction(initialState, review.formData)');
    expect(published).toContain('name="status" value="published"');
    expect(published).not.toContain('saveVariantChoiceAction');
    const html = renderToStaticMarkup(createElement(ProductCategoryGuidance, { categoryCode: 'ub', readOnlyChoices: true }));
    expect(html).toContain('このカテゴリーの入力目安');
    expect(html).toContain('お客様選択の追加・編集はこの画面ではできません');
  });

  it('STEP1の主要カードと入力グリッドはコンパクトな同一余白に揃える', () => {
    for (const id of ['product-identify', 'product-details', 'product-main-media', 'sales-settings']) {
      expect(draft).toMatch(new RegExp(`id="${id}" className="card space-y-4 p-4 sm:p-5`));
    }
    for (const id of [
      'registered-product-identify', 'registered-product-details', 'registered-product-main-media',
      'registered-option-pending-subedit', 'registered-option-current-choices', 'registered-product-pricing',
    ]) {
      expect(published).toContain(`className="card space-y-4 p-4 sm:p-5" data-testid="${id}"`);
    }
    expect(draft).toContain('className="grid gap-4 sm:grid-cols-2"');
    expect(published).toContain('className="grid gap-4 sm:grid-cols-2"');
    expect(media).toContain('id="manufacturer-documents" className="card space-y-4 p-4 sm:p-5');
    expect(variants).toContain('id="customer-selection" className="card space-y-4 p-4 sm:p-5');
  });

  it('共通案内部品に保存アクションを混入させず、下書きの自動保存を維持する', () => {
    const shared = read('components/admin/product-category-guidance.tsx');
    expect(shared).not.toContain('saveOptionAction');
    expect(shared).not.toContain('useActionState');
    expect(shared).not.toContain('<form');
    expect(draft).toContain('useOptionRegistrationSave()');
    expect(draft).toContain('saveOptionAction(initial, new FormData(form))');
    expect(published).toContain('入力中は自動保存されません');
    expect(published).not.toContain('saveVariantGroupAction');
  });
});
