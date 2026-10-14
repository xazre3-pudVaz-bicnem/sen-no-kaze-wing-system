import { describe, expect, it } from 'vitest';
import { seedCatalog } from '@/lib/seed/catalog';
import '@/lib/seed/independent-insulation';

/**
 * 断熱（床・壁・天井）は本体の構造・製造に必要な直接原価として Base Master 側で扱い、
 * お客様が選ぶ必須項目にはしない（先方確認 2026-10-14）。必須にすると、断熱の商品を選べない
 * Wing の「本体のみ」が保存・見積依頼できなくなる。本番は管理画面のカテゴリーで「必須」を外す。
 */
describe('断熱はお客様の必須選択にしない', () => {
  it('初期データの断熱カテゴリー（床・壁・天井）は必須ではない', () => {
    const codes = ['insulation-floor', 'insulation-wall', 'insulation-ceiling'];
    const rows = seedCatalog.categories.filter((category) => codes.includes(category.code));
    expect(rows.map((category) => category.code).sort()).toEqual([...codes].sort());
    expect(rows.filter((category) => category.is_required)).toEqual([]);
  });

  it('断熱の商品自体も必須（解除不可）にはしていない', () => {
    const categoryIds = new Set(
      seedCatalog.categories
        .filter((category) => ['insulation-floor', 'insulation-wall', 'insulation-ceiling'].includes(category.code))
        .map((category) => category.id)
    );
    const options = seedCatalog.options.filter((option) => categoryIds.has(option.category_id));
    expect(options.length).toBeGreaterThan(0);
    expect(options.filter((option) => option.is_required)).toEqual([]);
  });
});
