import { describe, expect, it } from 'vitest';
import { findMissingPreviewCombos, resolvePreview, selectedPreviewKeys } from '@/lib/domain/preview';
import { defaultSelection, toggleOption } from '@/lib/domain/rules';
import { MODEL_WING01_ID, O, seedCategories, seedConflicts, seedDependencies, seedOptions, seedPreviewRules } from '@/lib/seed/catalog';

const wingOptions = seedOptions.filter((o) => o.base_model_id === null || o.base_model_id === MODEL_WING01_ID);
const wingRules = seedPreviewRules.filter((r) => r.base_model_id === MODEL_WING01_ID);
const ctx = { options: wingOptions, categories: seedCategories, dependencies: seedDependencies, conflicts: seedConflicts };

describe('resolvePreview', () => {
  it('デッキなし → 標準外観、デッキあり → デッキ付き外観（完全一致）', () => {
    const none = resolvePreview(wingRules, 'exterior', ['exterior_galva']);
    expect(none.kind).toBe('exact');
    expect(none.layers[0].url).toContain('wing-lakeside.jpg');
    const deck = resolvePreview(wingRules, 'exterior', ['deck', 'exterior_galva']);
    expect(deck.kind).toBe('exact');
    expect(deck.layers[0].url).toContain('wing-lakeside-deck');
  });

  it('ユニットバス・3点ユニットは水まわり画像が完全一致で切り替わる', () => {
    const bath = resolvePreview(wingRules, 'water', ['bath']);
    expect(bath.kind).toBe('exact');
    expect(bath.layers[0].url).toContain('unit-bath.png');
    const ub3 = resolvePreview(wingRules, 'water', ['ub3']);
    expect(ub3.kind).toBe('exact');
    expect(ub3.layers[0].url).toContain('unit-bath-3point');
  });

  it('登録のない組み合わせは最も近い画像＋未反映キーを返す（approximate）', () => {
    // 水まわりに shower の画像は未登録
    const r = resolvePreview(wingRules, 'water', ['shower', 'washbasin']);
    expect(r.kind).toBe('nearest');
    expect(r.approximate).toBe(true);
    expect(r.missing_keys).toContain('shower');
  });

  it('余分な設備が写る画像より欠落のある画像を優先する', () => {
    // 平面図の登録は {aircon,bath,toilet,washbasin} と {aircon,kitchen,toilet,ub3} と {}
    const r = resolvePreview(wingRules, 'floorplan', ['aircon', 'bath', 'toilet']);
    expect(r.kind).toBe('nearest');
    expect(r.extra_keys).toEqual(['washbasin']);
    expect(r.missing_keys).toEqual([]);
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

  it('仕様の標準構成では平面図・室内が完全一致で表示される', () => {
    // ホテル仕様（先頭 preset）の標準構成
    const byCode = new Map(wingOptions.map((o) => [o.code, o.id]));
    let sel: string[] = [];
    for (const code of ['aircon', 'ub-1216', 'toilet-washlet', 'washbasin-kb']) {
      const oid = byCode.get(code);
      if (!oid) continue;
      const r = toggleOption(ctx, sel, oid);
      if (!r.rejected) sel = r.next;
    }
    const plan = resolvePreview(wingRules, 'floorplan', selectedPreviewKeys(wingOptions, sel, 'floorplan'));
    expect(plan.kind).toBe('exact');
    expect(plan.layers[0].url).toContain('wing-hotel');

    const interior = resolvePreview(wingRules, 'interior', selectedPreviewKeys(wingOptions, sel, 'interior'));
    expect(interior.kind).toBe('exact');
    expect(interior.layers[0].url).toContain('wing-room-aircon');
  });

  it('初期選択（標準構成）に検証エラーがない', () => {
    const sel = defaultSelection(ctx);
    expect(sel.length).toBeGreaterThan(0);
    // 必須カテゴリー（床・壁天井・外壁・サッシ・建具・造作・防火）が満たされる
    for (const code of ['floor', 'wall-ceiling', 'exterior-wall', 'sash', 'interior-door', 'carpentry', 'fireproof']) {
      const cat = seedCategories.find((c) => c.code === code)!;
      expect(sel.some((id) => wingOptions.find((o) => o.id === id)?.category_id === cat.id)).toBe(true);
    }
  });

  it('管理画面の不足一覧に未登録の組み合わせが出る', () => {
    const { missing } = findMissingPreviewCombos(wingRules, wingOptions);
    expect(missing.length).toBeGreaterThan(0);
    // 標準構成（ガルバリウム外壁）の外観は登録済みなので不足に出ない
    expect(missing.some((m) => m.view === 'exterior' && m.keys.join(',') === 'exterior_galva')).toBe(false);
    // 写真のない木板下見板張り（キーなし）は不足として管理者に出る
    expect(missing.some((m) => m.view === 'exterior' && m.keys.length === 0)).toBe(true);
  });

  it('選択キーの抽出は affects_views に従う', () => {
    const sel = [O.aircon, O.woodDeck];
    expect(selectedPreviewKeys(wingOptions, sel, 'exterior')).toEqual(['deck']);
    expect(selectedPreviewKeys(wingOptions, sel, 'interior')).toEqual(['aircon']);
  });
});
