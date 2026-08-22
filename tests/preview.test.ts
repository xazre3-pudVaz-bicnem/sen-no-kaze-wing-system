import { describe, expect, it } from 'vitest';
import { findMissingPreviewCombos, resolvePreview, selectedPreviewKeys } from '@/lib/domain/preview';
import { defaultSelection, toggleOption } from '@/lib/domain/rules';
import { MODEL_WING01_ID, O, seedCategories, seedConflicts, seedDependencies, seedOptions, seedPreviewRules } from '@/lib/seed/catalog';

const wingOptions = seedOptions.filter((o) => o.base_model_id === null || o.base_model_id === MODEL_WING01_ID);
const ctx = { options: wingOptions, categories: seedCategories, dependencies: seedDependencies, conflicts: seedConflicts };

describe('resolvePreview', () => {
  it('デッキなし → 標準外観、デッキあり → デッキ付き外観（完全一致）', () => {
    const none = resolvePreview(seedPreviewRules, 'exterior', []);
    expect(none.kind).toBe('exact');
    expect(none.layers[0].url).toContain('lakeside-sunset');
    const deck = resolvePreview(seedPreviewRules, 'exterior', ['deck']);
    expect(deck.kind).toBe('exact');
    expect(deck.layers[0].url).toContain('forest-deck');
  });

  it('登録のない組み合わせは最も近い画像＋未反映キーを返す（approximate）', () => {
    const r = resolvePreview(seedPreviewRules, 'water', ['bath', 'washbasin']);
    expect(r.kind).toBe('nearest');
    expect(r.approximate).toBe(true);
    expect(r.layers[0].url).toContain('washroom');
    expect(r.missing_keys).toEqual(['bath']);
  });

  it('余分な設備が写る画像より欠落のある画像を優先する', () => {
    const r = resolvePreview(seedPreviewRules, 'floorplan', ['aircon', 'shower', 'washbasin']);
    expect(r.kind).toBe('nearest');
    expect(r.extra_keys).toEqual(['toilet']);
  });

  it('画像が 1 枚もないビューは none', () => {
    expect(resolvePreview([], 'water', ['bath']).kind).toBe('none');
  });

  it('レイヤー方式: ベース層＋各キー層が揃えば合成する', () => {
    const rules = [
      { id: 'b', base_model_id: 'm', view: 'exterior' as const, kind: 'layer' as const, preview_keys: [], url: '/base.png', alt: 'base', note: null, z_index: 0, status: 'published' as const },
      { id: 'd', base_model_id: 'm', view: 'exterior' as const, kind: 'layer' as const, preview_keys: ['deck'], url: '/deck.png', alt: 'deck', note: null, z_index: 10, status: 'published' as const },
    ];
    const r = resolvePreview(rules, 'exterior', ['deck']);
    expect(r.kind).toBe('layered');
    expect(r.layers.map((l) => l.url)).toEqual(['/base.png', '/deck.png']);
    expect(resolvePreview(rules, 'exterior', ['deck', 'extra_window']).kind).toBe('nearest');
  });

  it('ユニットバスを選ぶと水まわりは未反映表示になり、エアコンで室内画像が切り替わる', () => {
    let sel = defaultSelection(ctx);
    const interior0 = resolvePreview(seedPreviewRules, 'interior', selectedPreviewKeys(wingOptions, sel, 'interior'));
    expect(interior0.layers[0].url).toContain('bedroom-seaview');
    sel = toggleOption(ctx, sel, O.aircon).next;
    const interior1 = resolvePreview(seedPreviewRules, 'interior', selectedPreviewKeys(wingOptions, sel, 'interior'));
    expect(interior1.kind).toBe('exact');
    expect(interior1.layers[0].url).toContain('bedroom-aircon');
    sel = toggleOption(ctx, sel, O.ub1216).next;
    const water = resolvePreview(seedPreviewRules, 'water', selectedPreviewKeys(wingOptions, sel, 'water'));
    expect(water.missing_keys).toContain('bath');
  });

  it('管理画面の不足一覧に「ユニットバス」を含む組み合わせが出る', () => {
    const { missing } = findMissingPreviewCombos(seedPreviewRules, wingOptions);
    expect(missing.some((m) => m.view === 'water' && m.keys.includes('bath'))).toBe(true);
    expect(missing.some((m) => m.view === 'exterior' && m.keys.length === 0)).toBe(false);
  });
});
