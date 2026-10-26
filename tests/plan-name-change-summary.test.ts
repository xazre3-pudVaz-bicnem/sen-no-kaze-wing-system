import { describe, expect, it } from 'vitest';
import { suggestPlanName, isLegacyAutomaticPlanName } from '../lib/domain/plan-name';
import { summarizePlanChanges, type PlanSelections } from '../lib/domain/plan-change-summary';
import type { CatalogBundle, OptionCategory, ProductOption, OptionVariantGroup, OptionVariantChoice } from '../lib/domain/types';

const cats = [
  { id: 'wall', code: 'exterior-wall', name: '外壁', group_sort: 1, sort_order: 1 },
  { id: 'door', code: 'entrance-door', name: '玄関ドア', group_sort: 2, sort_order: 1 },
  { id: 'bath', code: 'unit-bath', name: 'ユニットバス', group_sort: 3, sort_order: 1 },
] as unknown as OptionCategory[];
const options = [
  { id: 'wall-1', category_id: 'wall', name: '標準外壁' },
  { id: 'wall-2', category_id: 'wall', name: '別の外壁' },
  { id: 'door-1', category_id: 'door', name: '玄関ドア' },
  { id: 'bath-1', category_id: 'bath', name: '標準UB' },
  { id: 'bath-2', category_id: 'bath', name: '変更UB' },
] as unknown as ProductOption[];
const variantGroups = [{ id: 'door-color', option_id: 'door-1', name: '扉色' }] as unknown as OptionVariantGroup[];
const variantChoices = [
  { id: 'color-white', group_id: 'door-color', name: '白' },
  { id: 'color-black', group_id: 'door-color', name: '黒' },
] as unknown as OptionVariantChoice[];
const catalog: Pick<CatalogBundle, 'options' | 'categories' | 'variantGroups' | 'variantChoices'> =
  { options, categories: cats, variantGroups, variantChoices };
const baseline: PlanSelections = {
  optionIds: ['wall-1', 'door-1', 'bath-1'],
  variantChoiceIds: ['color-white'],
};
const current = (changes: Partial<PlanSelections> = {}): PlanSelections => ({ ...baseline, ...changes });

describe('プラン名の初期提案', () => {
  it('モデル・用途・防火・日本時間の日時を表示し、60文字以内にする', () => {
    const date = new Date('2026-10-26T02:18:00Z');
    expect(suggestPlanName('Wing', '住宅仕様', '非防火', date)).toBe('Wing｜住宅仕様｜非防火｜10/26 11:18');
    expect(suggestPlanName('Flat', '本体のみ', null, date)).toBe('Flat｜本体のみ｜10/26 11:18');
    expect(suggestPlanName('X'.repeat(80), '長い仕様', '防火', date)).toHaveLength(60);
  });
  it('お客様が付けた名前や保存済み名は初期提案で上書きしない', () => {
    expect(isLegacyAutomaticPlanName('Wing の仕様', 'Wing')).toBe(true);
    expect(isLegacyAutomaticPlanName('自分の計画', 'Wing')).toBe(false);
    expect(isLegacyAutomaticPlanName('Wing｜住宅仕様｜非防火｜10/26', 'Wing')).toBe(false);
  });
});

describe('現在の標準構成からの変更概要', () => {
  it('標準との差分なしは0項目', () => {
    expect(summarizePlanChanges(catalog, current(), baseline)).toEqual({ items: [], complete: true });
  });
  it('商品変更はカテゴリー1項目、選択肢だけの変更は別カテゴリー1項目', () => {
    const result = summarizePlanChanges(catalog, current({
      optionIds: ['wall-1', 'door-1', 'bath-2'],
      variantChoiceIds: ['color-black'],
    }), baseline);
    expect(result).toEqual({
      complete: true,
      items: [
        { category: '玄関ドア', kind: '選択肢変更', detail: '扉色' },
        { category: 'ユニットバス', kind: '商品変更', detail: null },
      ],
    });
  });
  it('追加と取り外しを区別する', () => {
    expect(summarizePlanChanges(catalog, current({ optionIds: ['wall-1', 'door-1'] }), baseline).items)
      .toContainEqual({ category: 'ユニットバス', kind: '取り外し', detail: null });
    expect(summarizePlanChanges(catalog, current({ optionIds: ['wall-1', 'door-1', 'bath-1'] }), {
      ...baseline, optionIds: ['wall-1', 'door-1'],
    }).items).toContainEqual({ category: 'ユニットバス', kind: '追加', detail: null });
  });
  it('外壁4面だけ変更も1項目として数え、既存外壁の旧方式は誤判定しない', () => {
    const faces = (optionId: string) => (['front', 'right', 'back', 'left'] as const).map(face_code =>
      ({ face_code, option_id: optionId, variant_choice_ids: [] }));
    expect(summarizePlanChanges(catalog, current({
      exteriorFaces: faces('wall-1').map((f) => f.face_code === 'front' ? { ...f, option_id: 'wall-2' } : f),
    }), baseline).items).toContainEqual({ category: '外壁', kind: '外壁4面変更', detail: null });
    expect(summarizePlanChanges(catalog, current({ exteriorFaces: [] }), baseline).items).toEqual([]);
  });
  it('不明な商品IDがある場合に標準のままと断定しない', () => {
    const result = summarizePlanChanges(catalog, current({ optionIds: ['archived-not-in-bundle'] }), baseline);
    expect(result.complete).toBe(false);
  });
});
