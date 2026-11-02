import { describe, expect, it } from 'vitest';
import { casePlanSlotTiles, type CasePlanPositionSlot } from '@/lib/domain/case-plan-position-slots';
import type { OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';

const option = (id: string, name: string, categoryId = 'cat-sash') => ({ id, name, category_id: categoryId }) as unknown as ProductOption;
const options = [option('s1', 'サッシ1'), option('s2', 'サッシ2'), option('o1', '設備1', 'cat-opt')];
const variantGroups = [{ id: 'g-color', option_id: 's1' }] as unknown as OptionVariantGroup[];
const variantChoices = [
  { id: 'c-white', group_id: 'g-color', name: '白' },
  { id: 'c-black', group_id: 'g-color', name: '黒' },
] as unknown as OptionVariantChoice[];

const slot = (patch: Partial<CasePlanPositionSlot> = {}): CasePlanPositionSlot => ({
  slot_code: 'hakidashi',
  slot_label: '掃出し窓',
  section_code: 'option',
  category_id: 'cat-sash',
  standard_option_id: 's1',
  standard_variant_choice_ids: ['c-white'],
  ...patch,
});

const context = { options, variantGroups, variantChoices, inScope: () => true };

describe('案件のプランボードの位置ごとのタイル（v2.5 PR-S2b）', () => {
  it('位置の明細を位置ごとのタイルにする（標準のまま／変更を区別。金額は出さない）', () => {
    const tiles = casePlanSlotTiles(
      [slot(), slot({ slot_code: 'hiraki-1', slot_label: '開き窓①' })],
      [
        { option_id: 's2', variant_choice_ids: [], slot_code: 'hakidashi' },
        { option_id: 's1', variant_choice_ids: ['c-white'], slot_code: 'hiraki-1' },
        { option_id: 'o1', variant_choice_ids: [], slot_code: null },
      ],
      context
    );
    expect(tiles.map((tile) => `${tile.label}:${tile.option?.name}:${tile.variantNames.join('・')}:${tile.state}`)).toEqual([
      '掃出し窓:サッシ2::changed',
      '開き窓①:サッシ1:白:standard',
    ]);
    expect(tiles.every((tile) => tile.deltaLabel === null && tile.categoryId === 'cat-sash')).toBe(true);
  });

  it('同じ商品でも選択肢が違えば変更（黒）。位置の明細が無ければ版の標準を出す', () => {
    const tiles = casePlanSlotTiles(
      [slot(), slot({ slot_code: 'hiraki-1', slot_label: '開き窓①' })],
      [{ option_id: 's1', variant_choice_ids: ['c-black'], slot_code: 'hakidashi' }],
      context
    );
    expect(tiles.map((tile) => `${tile.label}:${tile.variantNames.join('・')}:${tile.state}`)).toEqual(['掃出し窓:黒:changed', '開き窓①:白:standard']);
  });

  it('注文範囲の外のカテゴリーの位置は出さない。カテゴリーが無い枠は標準の商品のカテゴリーで見る', () => {
    expect(casePlanSlotTiles([slot()], [], { ...context, inScope: () => false })).toEqual([]);
    const tiles = casePlanSlotTiles([slot({ category_id: null })], [], context);
    expect(tiles.map((tile) => tile.categoryId)).toEqual(['cat-sash']);
  });

  it('位置の枠が無い（v2.5 でない見積）ときはタイルを作らない', () => {
    expect(casePlanSlotTiles([], [{ option_id: 'o1', variant_choice_ids: [], slot_code: null }], context)).toEqual([]);
  });
});
