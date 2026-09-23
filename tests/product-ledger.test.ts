import { describe, expect, it } from 'vitest';
import { findProductDuplicateCandidates, needsProductAttention, optionMatchesLedgerFilters, selectedOptionAfterFilter } from '@/lib/domain/product-ledger';
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
  it('商品名・メーカー・型番・商品管理番号で検索できる', () => {
    expect(optionMatchesLedgerFilters(option({ product_no: 'PRD-000123' }), { query: 'メーカー A-1', categoryId: '', status: '', quick: 'all' })).toBe(true);
    expect(optionMatchesLedgerFilters(option({ product_no: 'PRD-000123' }), { query: 'prd-000123', categoryId: '', status: '', quick: 'all' })).toBe(true);
  });

  it('使用中・非公開の重複クイックフィルターを持たない', () => {
    expect(optionMatchesLedgerFilters(option(), { query: '', categoryId: '', status: '', quick: 'draft' })).toBe(false);
  });
});


describe('商品登録の重複候補', () => {
  it('メーカー＋型番が一致する商品を最優先の重複候補として返す', () => {
    const rows = [
      option({ id: 'a', manufacturer: 'TOTO', model_no: 'CS-123', name: 'トイレA' }),
      option({ id: 'b', manufacturer: 'LIXIL', model_no: 'CS-123', name: 'トイレB' }),
    ];
    const result = findProductDuplicateCandidates(rows, {
      categoryId: 'c1',
      manufacturer: 'ＴＯＴＯ',
      name: '',
      modelNo: ' CS-123 ',
    });
    expect(result.map((row) => [row.option.id, row.reason])).toEqual([['a', 'manufacturer-model']]);
  });

  it('型番がなくても同一カテゴリー・メーカー・商品名の一致を候補にする', () => {
    const rows = [
      option({ id: 'a', category_id: 'c1', manufacturer: 'LIXIL', model_no: null, name: '洗面化粧台 A' }),
      option({ id: 'b', category_id: 'c2', manufacturer: 'LIXIL', model_no: null, name: '洗面化粧台 A' }),
    ];
    const result = findProductDuplicateCandidates(rows, {
      categoryId: 'c1',
      manufacturer: 'LIXIL',
      name: '洗面化粧台　A',
      modelNo: '',
    });
    expect(result.map((row) => [row.option.id, row.reason])).toEqual([['a', 'category-manufacturer-name']]);
  });

  it('編集中の商品自身は候補から除外する', () => {
    const result = findProductDuplicateCandidates([option({ id: 'a' })], {
      categoryId: 'c1',
      manufacturer: 'メーカー',
      name: 'テスト商品',
      modelNo: 'A-1',
      excludeId: 'a',
    });
    expect(result).toEqual([]);
  });
});
