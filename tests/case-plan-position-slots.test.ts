import { describe, expect, it } from 'vitest';
import { casePlanSlotView, type CasePlanPositionSlot } from '@/lib/domain/case-plan-position-slots';
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
const twoSlots = [slot(), slot({ slot_code: 'hiraki-1', slot_label: '開き窓①' })];

const context = { options, variantGroups, variantChoices, inScope: () => true };
const label = (view: ReturnType<typeof casePlanSlotView>) =>
  view.tiles.map((tile) => `${tile.label}:${tile.option?.name}:${tile.variantNames.join('・')}:${tile.state}`);

describe('案件のプランボードの位置ごとのタイル（v2.5 PR-S2b）', () => {
  it('位置の明細を位置ごとのタイルにし、カテゴリー単位の明細とは分ける（標準のまま／変更。金額は出さない）', () => {
    const view = casePlanSlotView(
      twoSlots,
      [
        { option_id: 's2', variant_choice_ids: [], slot_code: 'hakidashi' },
        { option_id: 's1', variant_choice_ids: ['c-white'], slot_code: 'hiraki-1' },
        { option_id: 'o1', variant_choice_ids: [], slot_code: null },
      ],
      context
    );
    expect(label(view)).toEqual(['掃出し窓:サッシ2::changed', '開き窓①:サッシ1:白:standard']);
    expect(view.categoryItems.map((item) => item.option_id)).toEqual(['o1']);
    expect([...view.positionCategoryIds]).toEqual(['cat-sash']);
    expect(view.slotsAtStandard).toBe(false);
    expect(view.tiles.every((tile) => tile.deltaLabel === null)).toBe(true);
  });

  it('すべての位置が標準のままなら slotsAtStandard。同じ商品でも選択肢が違えば変更（黒）', () => {
    const atStandard = casePlanSlotView(
      twoSlots,
      [
        { option_id: 's1', variant_choice_ids: ['c-white'], slot_code: 'hakidashi' },
        { option_id: 's1', variant_choice_ids: ['c-white'], slot_code: 'hiraki-1' },
      ],
      context
    );
    expect(atStandard.slotsAtStandard).toBe(true);
    const black = casePlanSlotView(twoSlots, [{ option_id: 's1', variant_choice_ids: ['c-black'], slot_code: 'hakidashi' }], context);
    // 開き窓① は位置の明細が無いので版の標準を出す（同じカテゴリーのほかの位置には明細がある）
    expect(label(black)).toEqual(['掃出し窓:サッシ1:黒:changed', '開き窓①:サッシ1:白:standard']);
  });

  it('位置の枠が無い見積（v2.5 でない・版を固定していない）は、位置の明細もカテゴリー単位で出す（消さない）', () => {
    const items = [
      { option_id: 's1', variant_choice_ids: ['c-white'], slot_code: 'hakidashi' },
      { option_id: 'o1', variant_choice_ids: [], slot_code: null },
    ];
    const view = casePlanSlotView([], items, context);
    expect(view.tiles).toEqual([]);
    expect(view.categoryItems).toEqual(items);
    expect(view.positionCategoryIds.size).toBe(0);
    expect(view.slotsAtStandard).toBe(true);
  });

  it('版の枠に合わない位置の明細はカテゴリー単位で出す。位置の明細の無いカテゴリーは位置のタイルにしない（保存のまま見せる）', () => {
    const stray = casePlanSlotView(twoSlots, [{ option_id: 's2', variant_choice_ids: [], slot_code: 'old-slot' }], context);
    expect(stray.tiles).toEqual([]);
    expect(stray.categoryItems.map((item) => item.option_id)).toEqual(['s2']);
    // 位置の枠ができる前の保存（サッシをカテゴリー単位で s2）：版の標準 s1 を「標準」と出さず、保存した s2 をカテゴリーのタイルに出す
    const legacy = casePlanSlotView(twoSlots, [{ option_id: 's2', variant_choice_ids: [], slot_code: null }], context);
    expect(legacy.tiles).toEqual([]);
    expect(legacy.categoryItems.map((item) => item.option_id)).toEqual(['s2']);
  });

  it('非公開になった選択肢は比べない（版の標準と同じく今のカタログで比べ、「変更済」にしない）', () => {
    const withoutWhite = variantChoices.filter((choice) => choice.id !== 'c-white');
    const view = casePlanSlotView([slot()], [{ option_id: 's1', variant_choice_ids: ['c-white'], slot_code: 'hakidashi' }], {
      ...context,
      variantChoices: withoutWhite,
    });
    expect(label(view)).toEqual(['掃出し窓:サッシ1::standard']);
  });

  it('注文範囲の外のカテゴリーの位置は出さない。カテゴリーが無い枠は標準の商品のカテゴリーで見る', () => {
    const items = [{ option_id: 's1', variant_choice_ids: ['c-white'], slot_code: 'hakidashi' }];
    const outOfScope = casePlanSlotView([slot()], items, { ...context, inScope: () => false });
    expect(outOfScope.tiles).toEqual([]);
    expect(outOfScope.categoryItems).toEqual(items);
    expect(casePlanSlotView([slot({ category_id: null })], items, context).tiles.map((tile) => tile.categoryId)).toEqual(['cat-sash']);
  });
});
