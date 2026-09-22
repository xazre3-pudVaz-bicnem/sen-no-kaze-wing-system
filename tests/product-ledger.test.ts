import { describe, expect, it } from 'vitest';
import { needsProductAttention, optionMatchesLedgerFilters, selectedOptionAfterFilter } from '@/lib/domain/product-ledger';
import type { ProductOption } from '@/lib/domain/types';

const option = (overrides: Partial<ProductOption> = {}): ProductOption => ({ id: 'o1', base_model_id: null, category_id: 'c1', code: 'test', name: 'テスト商品', description: null, price: 0, image_url: 'https://example.test/a.png', selection_type: 'radio', is_required: false, is_default: false, is_installation: false, price_on_request: false, spec_codes: [], owner_id: null, manufacturer: 'メーカー', model_no: 'A-1', size_note: null, list_price: null, highlight: null, preview_key: null, affects_views: [], sort_order: 0, status: 'published', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...overrides });

describe('商品台帳の絞り込み', () => {
  it('要確認は保存済みの未設定項目と下書きだけで判定し、非公開だけでは該当しない', () => {
    expect(needsProductAttention(option({ status: 'draft' }))).toBe(true);
    expect(needsProductAttention(option({ image_url: null }))).toBe(true);
    expect(needsProductAttention(option())).toBe(false);
  });
  it('フィルター後に選択中の商品がなければ未選択へ戻す', () => {
    expect(selectedOptionAfterFilter('o1', ['o2'])).toBeNull();
    expect(selectedOptionAfterFilter('o1', ['o1'])).toBe('o1');
  });
  it('商品名・メーカー・型番で検索できる', () => {
    expect(optionMatchesLedgerFilters(option(), { query: 'メーカー A-1', categoryId: '', status: '', quick: 'all' })).toBe(true);
  });
});
