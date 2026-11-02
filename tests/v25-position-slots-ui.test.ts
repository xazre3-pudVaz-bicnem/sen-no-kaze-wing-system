import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  activeV25SlotSelections,
  sameSlotSelection,
  standardSlotSelection,
  switchPositionCategories,
  v25StandardLineNotes,
  withoutPositionCategoryOptions,
} from '@/lib/domain/simulator-position-slots';
import { computeSaleViewPricing, v25PositionSlots, v25SlotUnitForDisplay, type StandardEstimateSaleView } from '@/lib/domain/standard-estimate-sale-view';
import { buildV25SpecSelection } from '@/lib/domain/estimate-template';
import { summarizePlanChanges } from '@/lib/domain/plan-change-summary';
import { normalizeGuestPlanInput } from '@/lib/domain/case-flow';
import { saveConfigurationSchema } from '@/lib/validation';
import { canUsePositionSlot, slotCostForWorkbench, type V25WorkbenchCosts } from '@/lib/domain/standard-estimate-v25-workbench';
import type { RuleContext } from '@/lib/domain/rules';
import type { CatalogBundle, OptionCategory, ProductOption, SlotSelection } from '@/lib/domain/types';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8').split('\r').join('');

// S1 の単体試験（tests/v25-position-slots.test.ts）と同じ版：設備1（カテゴリー単位）と、サッシの位置の枠 3 つ
// （掃出し窓＝サッシ1 白・選べる商品にサッシ2、開き窓①＝サッシ1 白、開き窓②＝サッシ1 黒）
const view: StandardEstimateSaleView = {
  pricing_model: 'v2.5',
  revision_id: 'rev-s1',
  version: 2,
  base_model_id: 'model',
  spec_code: 'office',
  size_code: '2100x4550',
  fire_spec_code: 'non_fire',
  tax_rate: '0.100000',
  expense_rate: '0.1500',
  subtotal_raw: 611680,
  adjustment: 0,
  subtotal: 611680,
  tax: 61168,
  total: 672848,
  has_por: false,
  sections: [
    { code: 'base', expense_method: 'rate', line_subtotal: 350532, expense_amount: 52579, total: 403111, has_por: false },
    { code: 'interior_exterior', expense_method: 'rate', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
    { code: 'option', expense_method: 'rate', line_subtotal: 181365, expense_amount: 27204, total: 208569, has_por: false },
    { code: 'sitework', expense_method: 'none', line_subtotal: 0, expense_amount: 0, total: 0, has_por: false },
  ],
  base_lines: [{ section: '1．金物', name: '伸縮脚', quantity: 12, unit: '本', unit_price: 29211, amount: 350532 }],
  lines: [
    { section_code: 'option', group_label: 'S1 設備', name: 'S1 設備1', quantity: '1', unit: '式', unit_price: 32100, amount: 32100, is_por: false, option_id: 'o1', slot_code: null },
    { section_code: 'option', group_label: 'S1 サッシ（掃出し窓）', name: 'S1 サッシ1 ／ 白', quantity: '1', unit: '式', unit_price: 48150, amount: 48150, is_por: false, option_id: 's1', slot_code: 'hakidashi' },
    { section_code: 'option', group_label: 'S1 サッシ（開き窓①）', name: 'S1 サッシ1 ／ 白', quantity: '1', unit: '式', unit_price: 48150, amount: 48150, is_por: false, option_id: 's1', slot_code: 'hiraki-1' },
    { section_code: 'option', group_label: 'S1 サッシ（開き窓②）', name: 'S1 サッシ1 ／ 黒', quantity: '1', unit: '式', unit_price: 52965, amount: 52965, is_por: false, option_id: 's1', slot_code: 'hiraki-2' },
    { section_code: 'option', group_label: null, name: '取付費', quantity: '1', unit: '式', unit_price: 10000, amount: 10000, is_por: false, option_id: null, slot_code: null },
  ],
  baseline: [
    { option_id: 'o1', section_code: 'option', selection_target_code: 'runtime-psl-option', quantity: '1', unit_price: 32100, price_on_request: false, variant_choice_ids: [], variant_extra: 0, amount: 32100, slot_code: null, slot_label: null, category_id: 'cat-opt', selectable_option_ids: null },
    { option_id: 's1', section_code: 'option', selection_target_code: 'runtime-psl-sash', quantity: '1', unit_price: 48150, price_on_request: false, variant_choice_ids: ['white'], variant_extra: 0, amount: 48150, slot_code: 'hakidashi', slot_label: '掃出し窓', category_id: 'cat-sash', selectable_option_ids: ['s1', 's2'] },
    { option_id: 's1', section_code: 'option', selection_target_code: 'runtime-psl-sash', quantity: '1', unit_price: 48150, price_on_request: false, variant_choice_ids: ['white'], variant_extra: 0, amount: 48150, slot_code: 'hiraki-1', slot_label: '開き窓①', category_id: 'cat-sash', selectable_option_ids: ['s1'] },
    { option_id: 's1', section_code: 'option', selection_target_code: 'runtime-psl-sash', quantity: '1', unit_price: 52965, price_on_request: false, variant_choice_ids: ['black'], variant_extra: 0, amount: 52965, slot_code: 'hiraki-2', slot_label: '開き窓②', category_id: 'cat-sash', selectable_option_ids: ['s1'] },
  ],
  prices: {
    o1: { groups: [], units: { '': 32100 } },
    s1: { groups: [['white', 'black']], units: { '-': 48150, '0': 48150, '1': 54570 } },
    s2: { groups: [], units: { '': 64200 } },
    s3: { por: true },
  },
};

const option = (id: string, categoryId: string, extra: Partial<ProductOption> = {}) =>
  ({
    id,
    code: `runtime-psl-${id}`,
    name: `S1 ${id}`,
    category_id: categoryId,
    base_model_id: null,
    price: 0,
    price_on_request: false,
    is_installation: false,
    is_required: false,
    is_default: false,
    status: 'published',
    spec_codes: [],
    sort_order: 1,
    image_url: null,
    ...extra,
  }) as unknown as ProductOption;

const category = (id: string, code: string, extra: Partial<OptionCategory> = {}) =>
  ({
    id,
    code,
    name: code === 'runtime-psl-sash' ? 'サッシ' : '設備',
    status: 'published',
    finish_level: 'equipment',
    selection_mode: 'multi',
    is_required: false,
    sort_order: 1,
    group_sort: 1,
    customer_visible: true,
    ...extra,
  }) as unknown as OptionCategory;

const bundle = {
  model: { id: 'model', slug: 'runtime-psl-model', base_price: 0, presets: [] },
  categories: [category('cat-opt', 'runtime-psl-option'), category('cat-sash', 'runtime-psl-sash', { is_required: true })],
  options: [option('o1', 'cat-opt'), option('s1', 'cat-sash', { is_default: true }), option('s2', 'cat-sash'), option('s3', 'cat-sash')],
  variantGroups: [{ id: 'g-color', option_id: 's1', code: 'color', name: '色', sort_order: 1, is_required: true, status: 'published' }],
  variantChoices: [
    { id: 'white', group_id: 'g-color', code: 'white', name: '白', kind: 'standard', extra_price: 0, price_on_request: false, status: 'published', sort_order: 1 },
    { id: 'black', group_id: 'g-color', code: 'black', name: '黒', kind: 'option', extra_price: 0, price_on_request: false, status: 'published', sort_order: 2 },
  ],
  dependencies: [],
  conflicts: [],
} as unknown as CatalogBundle;

const slots = v25PositionSlots(view);
const context = (overrides: Partial<Parameters<typeof activeV25SlotSelections>[2]> = {}) => ({
  inScope: () => true,
  canSelect: (id: string) => id !== 's3',
  variantGroups: bundle.variantGroups,
  variantChoices: bundle.variantChoices,
  ...overrides,
});

describe('v2.5 PR-S2：シミュレーターの位置ごとの選択', () => {
  it('選んでいない位置は版の標準（商品と選択肢）でそろえ、版の枠の順に並べる', () => {
    const { selections, reverted } = activeV25SlotSelections(slots, [], context());
    expect(selections).toEqual([
      { slot_code: 'hakidashi', option_id: 's1', variant_choice_ids: ['white'] },
      { slot_code: 'hiraki-1', option_id: 's1', variant_choice_ids: ['white'] },
      { slot_code: 'hiraki-2', option_id: 's1', variant_choice_ids: ['black'] },
    ]);
    expect(reverted).toEqual([]);
  });

  it('その位置で選べる商品はそのまま、選べない商品・版に無い位置は標準に戻す（戻した位置の名前を返す）', () => {
    const { selections, reverted } = activeV25SlotSelections(
      slots,
      [
        { slot_code: 'hakidashi', option_id: 's2', variant_choice_ids: [] },
        // 開き窓①ではサッシ2 を選べない（枠の選べる商品に無い）
        { slot_code: 'hiraki-1', option_id: 's2', variant_choice_ids: [] },
        // 版に無い位置は数えない
        { slot_code: 'old-window', option_id: 's1', variant_choice_ids: ['white'] },
      ],
      context()
    );
    expect(selections.map((row) => [row.slot_code, row.option_id])).toEqual([
      ['hakidashi', 's2'],
      ['hiraki-1', 's1'],
      ['hiraki-2', 's1'],
    ]);
    expect(reverted).toEqual(['開き窓①']);
  });

  it('選べる商品でも、今は選べない（販売停止・仕様で選べない）商品は標準に戻す。標準の商品は常に選べる', () => {
    const withS3 = slots.map((slot) => (slot.slot_code === 'hakidashi' ? { ...slot, selectable_option_ids: ['s1', 's2', 's3'] } : slot));
    const stopped = activeV25SlotSelections(withS3, [{ slot_code: 'hakidashi', option_id: 's3', variant_choice_ids: [] }], context());
    expect(stopped.selections[0].option_id).toBe('s1');
    expect(stopped.reverted).toEqual(['掃出し窓']);
    const standardHidden = activeV25SlotSelections(slots, [{ slot_code: 'hiraki-2', option_id: 's1', variant_choice_ids: ['white'] }], context({ canSelect: () => false }));
    expect(standardHidden.selections[2]).toEqual({ slot_code: 'hiraki-2', option_id: 's1', variant_choice_ids: ['white'] });
    expect(standardHidden.reverted).toEqual([]);
  });

  it('注文範囲の外の位置は選ばない（DB は範囲の外の位置の商品を受け付けない）', () => {
    expect(activeV25SlotSelections(slots, [], context({ inScope: () => false })).selections).toEqual([]);
  });

  it('選択肢はその商品の選択項目のものだけにそろえ、足りない項目は標準の選択肢で補う', () => {
    const { selections } = activeV25SlotSelections(slots, [{ slot_code: 'hiraki-1', option_id: 's1', variant_choice_ids: ['black', 'stray'] }], context());
    expect(selections[1]).toEqual({ slot_code: 'hiraki-1', option_id: 's1', variant_choice_ids: ['black'] });
    const filled = activeV25SlotSelections(slots, [{ slot_code: 'hakidashi', option_id: 's1', variant_choice_ids: [] }], context());
    expect(filled.selections[0].variant_choice_ids).toEqual(['white']);
  });

  it('標準の選択：今のカタログに無い（非公開の）選択肢は外す。同じ選択の判定は選択肢の順によらない', () => {
    const hidden = { ...slots[2], standard_variant_choice_ids: ['black', 'retired-choice'] };
    expect(standardSlotSelection(hidden, bundle.variantGroups, bundle.variantChoices).variant_choice_ids).toEqual(['black']);
    expect(sameSlotSelection({ option_id: 's1', variant_choice_ids: ['a', 'b'] }, { option_id: 's1', variant_choice_ids: ['b', 'a'] })).toBe(true);
    expect(sameSlotSelection({ option_id: 's1', variant_choice_ids: ['a'] }, { option_id: 's2', variant_choice_ids: ['a'] })).toBe(false);
  });

  it('位置ごとに選ぶカテゴリーの商品は、カテゴリー単位の選択から外す（DB の category_mixed にしない）', () => {
    expect(withoutPositionCategoryOptions(bundle.options, ['o1', 's1', 's2'], new Set(['cat-sash']))).toEqual(['o1']);
    expect(withoutPositionCategoryOptions(bundle.options, ['o1', 's1'], new Set())).toEqual(['o1', 's1']);
  });

  it('使う版が変わったとき：新しい版で位置ごとに選ぶカテゴリーは外し、カテゴリー単位に戻ったカテゴリーは新しい版の標準で補う', () => {
    const ctx = { options: bundle.options, categories: bundle.categories, dependencies: [], conflicts: [] } as unknown as RuleContext;
    expect(switchPositionCategories(ctx, ['o1', 's2'], new Set(), new Set(['cat-sash']), ['o1'])).toEqual(['o1']);
    expect(switchPositionCategories(ctx, ['o1'], new Set(['cat-sash']), new Set(), ['o1', 's1']).sort()).toEqual(['o1', 's1']);
    // 前の版でもカテゴリー単位だったカテゴリーは、お客様の選択のまま（補わない）
    expect(switchPositionCategories(ctx, ['o1'], new Set(), new Set(), ['o1', 's1'])).toEqual(['o1']);
  });

  it('標準構成：位置ごとに選ぶカテゴリーは、カテゴリー単位では必須でも補わない', () => {
    const ctx = { options: bundle.options, categories: bundle.categories, dependencies: [], conflicts: [], customerCategoryMatrix: null } as unknown as RuleContext;
    const model = { slug: 'runtime-psl-model', presets: [] };
    // 位置の枠が無ければ、必須のサッシのカテゴリーを標準の商品で補う（これまでどおり）
    expect(buildV25SpecSelection(ctx, model, 'office', ['o1'], null).sort()).toEqual(['o1', 's1']);
    expect(buildV25SpecSelection(ctx, model, 'office', ['o1'], null, new Set(['cat-sash']))).toEqual(['o1']);
  });

  it('商品明細（見積依頼の確認画面など）に、位置の枠の商品を位置ごとの行で出す（金額は区分の合計のまま）', () => {
    const selections: SlotSelection[] = [
      { slot_code: 'hakidashi', option_id: 's2', variant_choice_ids: [] },
      { slot_code: 'hiraki-1', option_id: 's1', variant_choice_ids: ['white'] },
      { slot_code: 'hiraki-2', option_id: 's1', variant_choice_ids: ['black'] },
    ];
    const result = computeSaleViewPricing(bundle, view, ['o1'], [], [], undefined, selections);
    const slotLines = result.pricing.lines.filter((line) => line.code.includes('__slot_'));
    expect(slotLines.map((line) => [line.name, line.unit_price, line.variants.map((variant) => variant.choice).join(',')])).toEqual([
      ['S1 s2（掃出し窓）', 64200, ''],
      ['S1 s1（開き窓①）', 48150, '白'],
      ['S1 s1（開き窓②）', 52965, '黒'],
    ]);
    // 掃出し窓だけ 48,150 → 64,200 円（+16,050 円）。明細の行を足しても二重には数えない
    expect(result.sections.find((section) => section.code === 'option')?.delta_line).toBe(16050);
  });

  it('位置の枠の売価（表示用）：その枠の標準なら公開した版の売価、変えたら売価の表、価格未確定は null', () => {
    expect(v25SlotUnitForDisplay(view, { slot_code: 'hiraki-2', option_id: 's1', variant_choice_ids: ['black'] })).toBe(52965);
    expect(v25SlotUnitForDisplay(view, { slot_code: 'hakidashi', option_id: 's2', variant_choice_ids: [] })).toBe(64200);
    expect(v25SlotUnitForDisplay(view, { slot_code: 'hakidashi', option_id: 's3', variant_choice_ids: [] })).toBeNull();
  });
});

describe('v2.5 PR-S2：御見積書の標準の明細の注記・変更点の一覧', () => {
  const catalog = {
    optionName: (id: string) => bundle.options.find((row) => row.id === id)?.name,
    choiceName: (id: string) => bundle.variantChoices.find((row) => row.id === id)?.name,
    optionOfChoice: (id: string) => (['white', 'black'].includes(id) ? 's1' : undefined),
  };
  const standardSlots: SlotSelection[] = activeV25SlotSelections(slots, [], context()).selections;

  it('標準のままなら注記なし。位置の商品・選択肢を変えた行と、外した行に注記を付ける（金額は変更差額の行のまま）', () => {
    expect(v25StandardLineNotes(view, { optionIds: ['o1'], variantChoiceIds: [], slotSelections: standardSlots }, catalog)).toEqual({});
    const notes = v25StandardLineNotes(
      view,
      {
        optionIds: [],
        variantChoiceIds: [],
        slotSelections: [
          { slot_code: 'hakidashi', option_id: 's2', variant_choice_ids: [] },
          { slot_code: 'hiraki-1', option_id: 's1', variant_choice_ids: ['black'] },
        ],
      },
      catalog
    );
    expect(notes).toEqual({
      'rev-s1-line-0': '選択から外しています（変更差額に含みます）',
      'rev-s1-line-1': '変更：S1 s2（変更差額に含みます）',
      'rev-s1-line-2': '変更：S1 s1（黒）（変更差額に含みます）',
      'rev-s1-line-3': '選択なし（変更差額に含みます）',
    });
  });

  it('保存の前の変更点の一覧：位置ごとに数える（標準のままの位置は数えない）', () => {
    const summary = summarizePlanChanges(
      bundle,
      { optionIds: ['o1'], variantChoiceIds: [] },
      { optionIds: ['o1'], variantChoiceIds: [] },
      [
        { label: 'サッシ（掃出し窓）', current: { slot_code: 'hakidashi', option_id: 's2', variant_choice_ids: [] }, standard: standardSlots[0] },
        { label: 'サッシ（開き窓①）', current: { slot_code: 'hiraki-1', option_id: 's1', variant_choice_ids: ['black'] }, standard: standardSlots[1] },
        { label: 'サッシ（開き窓②）', current: standardSlots[2], standard: standardSlots[2] },
      ]
    );
    expect(summary.complete).toBe(true);
    expect(summary.items).toEqual([
      { category: 'サッシ（掃出し窓）', kind: '商品変更', detail: null },
      { category: 'サッシ（開き窓①）', kind: '選択肢変更', detail: null },
    ]);
  });
});

describe('v2.5 PR-S2：保存・一時保存の形', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('保存のアクション：位置ごとの選択を受け取る（識別子の形は DB の check と同じ）', () => {
    const base = { id: null, base_model_id: uuid(1), name: 'プラン', option_ids: [], preview_image_url: null, notes: null };
    const parsed = saveConfigurationSchema.parse({ ...base, slot_selections: [{ slot_code: 'hakidashi', option_id: uuid(2), variant_choice_ids: [uuid(3)] }] });
    expect(parsed.slot_selections).toEqual([{ slot_code: 'hakidashi', option_id: uuid(2), variant_choice_ids: [uuid(3)] }]);
    expect(saveConfigurationSchema.parse(base).slot_selections).toEqual([]);
    expect(saveConfigurationSchema.safeParse({ ...base, slot_selections: [{ slot_code: 'Bad Code', option_id: uuid(2) }] }).success).toBe(false);
  });

  it('一時保存：位置ごとの選択を持てる（形だけ確かめる。重複した位置・形の違う識別子は止める）', () => {
    const plan = normalizeGuestPlanInput({ name: 'x', slot_selections: [{ slot_code: 'hakidashi', option_id: uuid(2).toUpperCase(), variant_choice_ids: [uuid(3)] }] });
    expect(plan.slot_selections).toEqual([{ slot_code: 'hakidashi', option_id: uuid(2), variant_choice_ids: [uuid(3)] }]);
    expect(normalizeGuestPlanInput({ name: 'x' }).slot_selections).toBeUndefined();
    expect(() => normalizeGuestPlanInput({ slot_selections: [{ slot_code: 'a', option_id: uuid(2) }, { slot_code: 'a', option_id: uuid(2) }] })).toThrow();
    expect(() => normalizeGuestPlanInput({ slot_selections: [{ slot_code: '-x', option_id: uuid(2) }] })).toThrow();
  });
});

describe('v2.5 PR-S2：本部の編集画面（位置の枠・行ごとの原価の固定）', () => {
  it('外壁・防火仕様は位置・用途の選択枠にできない（DB と同じ）', () => {
    expect(canUsePositionSlot('sash')).toBe(true);
    expect(canUsePositionSlot('exterior-wall')).toBe(false);
    expect(canUsePositionSlot('fireproof')).toBe(false);
  });

  it('同じ商品＋選択肢が複数の位置の枠にあるときは、その行の固定を先に使う（DB の保存の v_old_rows → v_old と同じ）', () => {
    const costs: V25WorkbenchCosts = {
      pinned: { 's1|white': { standard_cost: 30000, variant_adjustments: { white: 0 } } },
      pinnedByRow: {
        'key-a#s1|white': { standard_cost: 30000, variant_adjustments: { white: 0 } },
        'key-b#s1|white': { standard_cost: 28000, variant_adjustments: { white: 0 } },
      },
      currentProduct: { s1: 32000 },
      currentChoice: { white: 0 },
    };
    const row = (baseline_key: string | null) => ({ baseline_key, option_id: 's1', variant_choices: { 'g-color': 'white' } });
    expect(slotCostForWorkbench(row('key-b'), costs)).toEqual({ status: 'ok', standard_cost: 28000, variant_adjustment: 0, pinned: true });
    expect(slotCostForWorkbench(row('key-a'), costs)).toEqual({ status: 'ok', standard_cost: 30000, variant_adjustment: 0, pinned: true });
    // 新しい行（同じ商品で位置を足した行）は、同じ「商品＋選択肢」のほかの行の固定
    expect(slotCostForWorkbench(row(null), costs)).toEqual({ status: 'ok', standard_cost: 30000, variant_adjustment: 0, pinned: true });
  });

  it('編集画面に位置の欄・選べる商品の選択・同じ商品で位置を足すボタンがある', () => {
    const source = read('components/admin/standard-estimate-v25-workbench.tsx');
    for (const testId of ['v25-wb-slot-code', 'v25-wb-slot-label', 'v25-wb-slot-selectable-open', 'v25-wb-slot-add-position', 'v25-wb-selectable-window-type']) {
      expect(source).toContain(`data-testid="${testId}"`);
    }
  });
});
