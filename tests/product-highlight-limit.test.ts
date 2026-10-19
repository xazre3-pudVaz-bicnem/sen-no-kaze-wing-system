import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductHighlightTextarea } from '@/components/admin/product-highlight-textarea';
import { PRODUCT_HIGHLIGHT_MAX_LENGTH } from '@/lib/domain/product-highlight';
import { optionSchema } from '@/lib/validation';

const baseOption = {
  id: null,
  base_model_id: null,
  category_id: '00000000-0000-4000-8000-000000000001',
  code: 'test-option',
  name: 'テスト商品',
  description: '',
  price: 0,
  image_url: '',
  selection_type: 'radio',
  is_required: false,
  is_default: false,
  is_installation: false,
  price_on_request: false,
  preview_key: '',
  affects_views: [],
  spec_codes: [],
  sort_order: 0,
  status: 'draft',
  owner_id: '',
  manufacturer: '',
  model_no: '',
  size_note: '',
  list_price: '',
  highlight: '',
};

describe('メーカー記載の特徴', () => {
  it('既存の短文と300文字を保存でき、301文字はサーバーで拒否する', () => {
    expect(PRODUCT_HIGHLIGHT_MAX_LENGTH).toBe(300);
    for (const length of [0, 80, 300]) {
      expect(optionSchema.safeParse({ ...baseOption, highlight: 'あ'.repeat(length) }).success).toBe(true);
    }
    expect(optionSchema.safeParse({ ...baseOption, highlight: 'あ'.repeat(301) }).success).toBe(false);
    expect(optionSchema.safeParse({ ...baseOption, highlight: null }).success).toBe(true);
  });

  it('改行入りの特徴を保持し、商品説明の500文字制限はそのまま', () => {
    const highlight = '浴槽の保温性能\nお手入れしやすい床\n省エネ水栓';
    const parsed = optionSchema.parse({ ...baseOption, highlight });
    expect(parsed.highlight).toBe(highlight);
    expect(optionSchema.safeParse({ ...baseOption, description: 'あ'.repeat(500) }).success).toBe(true);
    expect(optionSchema.safeParse({ ...baseOption, description: 'あ'.repeat(501) }).success).toBe(false);
  });

  it('STEP1・公開済み商品の再編集で共通の4行テキストエリアと文字数を表示する', () => {
    const html = renderToStaticMarkup(createElement(ProductHighlightTextarea, {
      id: 'highlight-test',
      initialValue: 'メーカー記載の特徴\n2行目',
    }));
    expect(html).toContain('<textarea');
    expect(html).toMatch(/maxlength="300"/i);
    expect(html).toContain('rows="4"');
    expect(html).toContain('name="highlight"');
    expect(html).toContain('メーカー記載の特徴\n2行目');
    expect(html).toContain('highlight-test-count');
    expect(html).toContain('13/300文字');

    const draft = readFileSync('components/admin/forms.tsx', 'utf8');
    const published = readFileSync('components/admin/registered-option-edit-flow.tsx', 'utf8');
    expect(draft).toContain("initialValue={option?.highlight ?? ''}");
    expect(published).toContain("initialValue={option.highlight ?? ''}");
    expect(draft).toContain('<ProductHighlightTextarea');
    expect(published).toContain('<ProductHighlightTextarea');
  });

  it('STEP2とお客様の商品詳細は共通ProductDetailで改行・長文を表示する', () => {
    const detail = readFileSync('components/simulator/product-detail.tsx', 'utf8');
    const preview = readFileSync('components/admin/option-customer-preview.tsx', 'utf8');
    const editor = readFileSync('components/admin/registered-option-edit-flow.tsx', 'utf8');
    expect(detail).toContain('{option.highlight && (');
    expect(detail).toContain('data-testid="product-detail-highlight"');
    expect(detail).toContain('whitespace-pre-wrap break-words [overflow-wrap:anywhere]');
    expect(detail).not.toContain('inline-flex rounded-full bg-ivory px-2.5 py-1 text-[0.7rem] font-semibold text-brown');
    expect(preview).toContain('<ProductDetail');
    expect(editor).toContain('whitespace-pre-wrap break-words [overflow-wrap:anywhere]');
  });
});
