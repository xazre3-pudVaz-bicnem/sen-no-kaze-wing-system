import { describe, expect, it } from 'vitest';
import {
  dropIncludedSelections,
  equipmentInclusionIssues,
  includedCategorySources,
  includedDuplicateMessage,
  inclusionQuoteNoteLines,
} from '@/lib/domain/equipment-separate-room';
import { computePricing } from '@/lib/domain/pricing';
import { validateSelection, type RuleContext } from '@/lib/domain/rules';
import { splitConfigurationItems } from '@/lib/domain/standard-estimate-sale-view';
import { normalizeGuestPlanInput } from '@/lib/domain/case-flow';
import { readBrowserDraft } from '@/lib/domain/simulator-browser-drafts';
import { saveConfigurationSchema } from '@/lib/validation';
import type { OptionCategory, OptionIncludedCategory, ProductOption } from '@/lib/domain/types';

// 設備包含（#628 の続き・A 案）：ユニットに含まれるカテゴリーの二重の選択の防止と「別室に追加」。
// DB（20261127100000 の validate_configuration_items・write_configuration_inclusion_quote_notes）と同じ判定・同じ文言を確かめる
const category = (id: string, code: string, name: string, sort_order: number, selection_mode: 'single' | 'multi' = 'multi') =>
  ({ id, code, name, sort_order, selection_mode, is_required: false, status: 'published', finish_level: 'full', group_sort: 0 }) as unknown as OptionCategory;
const option = (id: string, category_id: string, name: string, price: number, sort_order = 1) =>
  ({
    id, category_id, name, price, sort_order, code: id, status: 'published', base_model_id: null, price_on_request: false,
    is_installation: false, is_required: false, image_url: null, spec_codes: [],
  }) as unknown as ProductOption;

const C = {
  ub: category('cat-ub', 'ub', '浴室', 60, 'single'),
  washbasin: category('cat-wash', 'washbasin', '洗面', 70),
  toilet: category('cat-toilet', 'toilet', 'トイレ', 80),
  other: category('cat-other', 'aircon', '空調', 90),
};
const O = {
  ubInc: option('ub-inc', C.ub.id, '3点ユニット（トイレ・洗面つき）', 600000),
  ubToilet: option('ub-toilet', C.ub.id, 'シャワートイレユニット', 500000),
  ubPlain: option('ub-plain', C.ub.id, 'シャワーユニット', 450000),
  toiletA: option('toilet-a', C.toilet.id, 'トイレA', 120000),
  toiletB: option('toilet-b', C.toilet.id, 'トイレB', 150000, 2),
  washA: option('wash-a', C.washbasin.id, '洗面A', 80000),
  air: option('air', C.other.id, 'エアコン', 50000),
};
const categories = Object.values(C);
const options = Object.values(O);
const relations: OptionIncludedCategory[] = [
  { option_id: O.ubInc.id, included_category_id: C.toilet.id },
  { option_id: O.ubInc.id, included_category_id: C.washbasin.id },
  { option_id: O.ubToilet.id, included_category_id: C.toilet.id },
];

describe('設備包含：ユニットに含まれるカテゴリーの判定', () => {
  it('印なしで選んだユニットが含むカテゴリーを返す（別室の明細や、選んでいないユニットは包含元にしない）', () => {
    expect(Object.fromEntries(includedCategorySources([O.ubInc.id, O.toiletA.id], relations))).toEqual({
      [C.toilet.id]: [O.ubInc.id],
      [C.washbasin.id]: [O.ubInc.id],
    });
    expect(includedCategorySources([O.ubPlain.id], relations).size).toBe(0);
    expect(includedCategorySources([O.ubInc.id], undefined).size).toBe(0);
  });

  it('T3：含まれるカテゴリーの印の無い選択は、DB と同じ文言で止める（カテゴリーの並び順）', () => {
    const issues = equipmentInclusionIssues({ options, categories, relations, selectedIds: [O.ubInc.id, O.toiletA.id, O.washA.id] });
    expect(issues.map((issue) => issue.message)).toEqual([
      '「洗面」は「3点ユニット（トイレ・洗面つき）」に含まれています。別の部屋に追加する場合は「別室に追加する」から選んでください',
      '「トイレ」は「3点ユニット（トイレ・洗面つき）」に含まれています。別の部屋に追加する場合は「別室に追加する」から選んでください',
    ]);
    expect(issues.map((issue) => issue.option_ids)).toEqual([[O.washA.id], [O.toiletA.id]]);
    expect(includedDuplicateMessage('トイレ', ['A', 'B'])).toContain('「A・B」に含まれています');
  });

  it('T1・T2・T5：ユニットだけ・別室に追加・トイレだけを含むユニットと洗面は止めない', () => {
    expect(equipmentInclusionIssues({ options, categories, relations, selectedIds: [O.ubInc.id] })).toEqual([]);
    expect(equipmentInclusionIssues({ options, categories, relations, selectedIds: [O.ubInc.id], separateRoomIds: [O.toiletA.id] })).toEqual([]);
    expect(equipmentInclusionIssues({ options, categories, relations, selectedIds: [O.ubToilet.id, O.washA.id] })).toEqual([]);
    expect(equipmentInclusionIssues({ options, categories, relations, selectedIds: [O.ubToilet.id, O.toiletB.id] })[0].message)
      .toContain('「トイレ」は「シャワートイレユニット」に含まれています');
  });

  it('別室に追加できるのはトイレ・洗面の商品だけ', () => {
    expect(equipmentInclusionIssues({ options, categories, relations, selectedIds: [O.ubInc.id], separateRoomIds: [O.air.id] })[0]).toMatchObject({
      type: 'separate_room',
      message: '「エアコン」は別室に追加できません（別室に追加できるのはトイレ・洗面の商品です）',
    });
  });

  it('包含元を選んだ操作では、含まれるカテゴリーの印なしの選択を外す（外したものを返して画面で知らせる）', () => {
    expect(dropIncludedSelections({ options, relations, selectedIds: [O.ubInc.id, O.toiletA.id, O.washA.id, O.air.id] })).toEqual({
      next: [O.ubInc.id, O.air.id],
      dropped: [O.toiletA.id, O.washA.id],
    });
    expect(dropIncludedSelections({ options, relations, selectedIds: [O.ubPlain.id, O.toiletA.id] })).toEqual({
      next: [O.ubPlain.id, O.toiletA.id],
      dropped: [],
    });
  });
});

describe('設備包含：選び方の検査（保存・見積依頼・ローカル検証モードで共通）', () => {
  const ctx: RuleContext = { options, categories, dependencies: [], conflicts: [], includedCategories: relations };

  it('別室の明細は「1 つだけ選択」に数えず、包含の重複だけを止める', () => {
    const single = { ...ctx, categories: categories.map((row) => (row.id === C.toilet.id ? { ...row, selection_mode: 'single' as const } : row)) };
    expect(validateSelection(single, [O.ubPlain.id, O.toiletA.id], 'full', [O.toiletB.id])).toEqual([]);
    expect(validateSelection(ctx, [O.ubInc.id, O.toiletA.id]).map((issue) => issue.type)).toEqual(['included']);
  });

  it('別室の明細も同時に選べない組み合わせ（旧排他）に数える', () => {
    const conflict = { ...ctx, conflicts: [{ id: 'c1', option_id: O.ubInc.id, conflicts_with_option_id: O.toiletA.id, message: '同時に選べません' }] };
    expect(validateSelection(conflict as RuleContext, [O.ubInc.id], 'full', [O.toiletA.id]).map((issue) => issue.type)).toEqual(['conflict']);
  });

  it('包含の表が無ければ今までどおり（ユニットとトイレを一緒に選べる）', () => {
    expect(validateSelection({ ...ctx, includedCategories: undefined }, [O.ubInc.id, O.toiletA.id])).toEqual([]);
  });
});

describe('設備包含：金額（DB の明細の行と同じ数え方）', () => {
  const model = { id: 'model', base_price: 1000000, expense_rate: 0.15 };

  it('T4：同じ商品を印なしと別室の両方で選ぶと 2 行として数え、別室の行は名前に「（別室）」を付ける', () => {
    const pricing = computePricing(model, options, categories, [
      { option_id: O.ubPlain.id },
      { option_id: O.toiletA.id },
      { option_id: O.toiletA.id, separate_room: true },
      // 同じ明細の重ね送りは今までどおり 1 回だけ
      { option_id: O.toiletA.id },
    ]);
    expect(pricing.option_subtotal).toBe(450000 + 120000 * 2);
    expect(pricing.lines.map((line) => [line.code, line.name, line.separate_room ?? false])).toEqual([
      [O.ubPlain.id, 'シャワーユニット', false],
      [O.toiletA.id, 'トイレA', false],
      [`${O.toiletA.id}__separate_room`, 'トイレA（別室）', true],
    ]);
  });

  it('T1・T2：ユニットだけなら含まれるカテゴリーは計上せず、別室の追加は普通の追加の設備として入る', () => {
    expect(computePricing(model, options, categories, [{ option_id: O.ubInc.id }]).option_subtotal).toBe(600000);
    expect(
      computePricing(model, options, categories, [{ option_id: O.ubInc.id }, { option_id: O.toiletA.id, separate_room: true }]).option_subtotal
    ).toBe(720000);
  });
});

describe('設備包含：見積の写しの 0 円の行（DB の write_configuration_inclusion_quote_notes と同じ）', () => {
  it('含まれるカテゴリーは注記、別室の明細は写し（旧仕様の明細を 1 行ずつ写すときは写さない）', () => {
    const items = [
      { option_id: O.ubInc.id },
      { option_id: O.toiletA.id, separate_room: true, variant_label: '色：白' },
    ];
    const lines = inclusionQuoteNoteLines({ options, categories, relations, items, copySeparateRoom: true });
    expect(lines.map((line) => [line.kind, line.name, line.description, line.sort_order])).toEqual([
      ['option', '洗面（ユニットに含まれています）', '「3点ユニット（トイレ・洗面つき）」に含まれています', 2881],
      ['option', 'トイレ（ユニットに含まれています）', '「3点ユニット（トイレ・洗面つき）」に含まれています', 2882],
      ['option', 'トイレ（別室）', 'トイレA ／ 色：白', 2861],
    ]);
    expect(inclusionQuoteNoteLines({ options, categories, relations, items, copySeparateRoom: false }).map((line) => line.name)).toEqual([
      '洗面（ユニットに含まれています）',
      'トイレ（ユニットに含まれています）',
    ]);
  });

  it('含まれるカテゴリーの商品を印なしで選んでいれば（前からある重複）、そのカテゴリーの注記は出さない', () => {
    const lines = inclusionQuoteNoteLines({
      options, categories, relations, items: [{ option_id: O.ubInc.id }, { option_id: O.toiletA.id }], copySeparateRoom: true,
    });
    expect(lines.map((line) => line.name)).toEqual(['洗面（ユニットに含まれています）']);
  });
});

describe('設備包含：保存・一時保存・下書きの形', () => {
  it('保存したプランの明細は、印なしの選択と別室の明細に分け、同じ商品の選択肢を重ねない', () => {
    expect(
      splitConfigurationItems([
        { option_id: O.ubPlain.id, variant_choice_ids: [], slot_code: null },
        { option_id: O.toiletA.id, variant_choice_ids: ['white'], slot_code: null },
        { option_id: O.toiletA.id, variant_choice_ids: ['white'], slot_code: null, separate_room: true },
      ])
    ).toEqual({
      optionIds: [O.ubPlain.id, O.toiletA.id],
      variantChoiceIds: ['white'],
      separateRoomOptionIds: [O.toiletA.id],
      slotSelections: [],
    });
  });

  it('保存の入力：別室の商品は 10 件まで・同じ商品は 1 回・未指定は空', () => {
    const base = { id: null, base_model_id: '10000000-0000-4000-8000-000000000001', name: 'p', option_ids: [], preview_image_url: null, notes: null };
    const ids = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i + 10)}`);
    expect(saveConfigurationSchema.parse(base).separate_room_option_ids).toEqual([]);
    expect(saveConfigurationSchema.safeParse({ ...base, separate_room_option_ids: ids.slice(0, 10) }).success).toBe(true);
    expect(saveConfigurationSchema.safeParse({ ...base, separate_room_option_ids: ids }).success).toBe(false);
    expect(saveConfigurationSchema.safeParse({ ...base, separate_room_option_ids: [ids[0], ids[0]] }).success).toBe(false);
  });

  it('一時保存は別室の商品を持てる（形だけ確かめ、10 件まで）', () => {
    const id = '00000000-0000-4000-8000-000000000099';
    expect(normalizeGuestPlanInput({ name: 'p', separate_room_option_ids: [id] }).separate_room_option_ids).toEqual([id]);
    expect(normalizeGuestPlanInput({ name: 'p' })).not.toHaveProperty('separate_room_option_ids');
    expect(() => normalizeGuestPlanInput({ name: 'p', separate_room_option_ids: 'x' })).toThrow('別室に追加する設備の形式が正しくありません');
  });

  it('ブラウザの下書きは別室の商品の配列を持て、形が違えば読まない', () => {
    const storage = (value: unknown) => ({ getItem: () => JSON.stringify(value) });
    expect(readBrowserDraft(storage({ selected: [], separateRoomIds: ['a'] }), 'k')?.separateRoomIds).toEqual(['a']);
    expect(readBrowserDraft(storage({ selected: [], separateRoomIds: 'a' }), 'k')).toBeNull();
    expect(readBrowserDraft(storage({ selected: [] }), 'k')).not.toBeNull();
  });
});
