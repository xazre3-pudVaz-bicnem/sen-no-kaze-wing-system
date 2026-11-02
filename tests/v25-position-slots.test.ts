import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeSaleViewPricing,
  splitConfigurationItems,
  v25PositionSlotCategoryIds,
  v25PositionSlots,
  v25SelectionUnit,
  v25SlotOptionIds,
  v25StandardSlotSelections,
  v25StandardVariantIds,
  type StandardEstimateSaleView,
} from '@/lib/domain/standard-estimate-sale-view';
import { buildV25SavePayload, validateV25EditorState, type V25EditorState } from '@/lib/domain/standard-estimate-v25-view';
import { v25SlotRuleIssues } from '@/lib/domain/standard-estimate-v25-workbench';
import type { CatalogBundle, SlotSelection } from '@/lib/domain/types';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8').split('\r').join('');
const MIGRATION = 'supabase/migrations/20261102100000_v25_position_slots.sql';

// DB の実行時検査（scripts/db-rehearsal/runtime-v25-position-slots.sql）と同じ版：率 1.07・1.5、経費 15%、本体 18,200 円 × 12 本。
// オプション：設備1（カテゴリー単位）32,100、サッシの位置の枠 3 つ（掃出し窓＝サッシ1 白 48,150・選べる商品にサッシ2、
// 開き窓①＝サッシ1 白 48,150、開き窓②＝同じサッシ1 の黒 52,965）。公開の後に黒の原価差額を 3,000 → 4,000 円に改定した後の表
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
  ],
  baseline: [
    { option_id: 'o1', section_code: 'option', selection_target_code: 'runtime-psl-option', quantity: '1', unit_price: 32100, price_on_request: false, variant_choice_ids: [], variant_extra: 0, amount: 32100, slot_code: null, slot_label: null, category_id: 'cat-opt', selectable_option_ids: null },
    { option_id: 's1', section_code: 'option', selection_target_code: 'runtime-psl-sash', quantity: '1', unit_price: 48150, price_on_request: false, variant_choice_ids: ['white'], variant_extra: 0, amount: 48150, slot_code: 'hakidashi', slot_label: '掃出し窓', category_id: 'cat-sash', selectable_option_ids: ['s1', 's2'] },
    { option_id: 's1', section_code: 'option', selection_target_code: 'runtime-psl-sash', quantity: '1', unit_price: 48150, price_on_request: false, variant_choice_ids: ['white'], variant_extra: 0, amount: 48150, slot_code: 'hiraki-1', slot_label: '開き窓①', category_id: 'cat-sash', selectable_option_ids: ['s1'] },
    { option_id: 's1', section_code: 'option', selection_target_code: 'runtime-psl-sash', quantity: '1', unit_price: 52965, price_on_request: false, variant_choice_ids: ['black'], variant_extra: 0, amount: 52965, slot_code: 'hiraki-2', slot_label: '開き窓②', category_id: 'cat-sash', selectable_option_ids: ['s1'] },
  ],
  prices: {
    o1: { groups: [], units: { '': 32100 } },
    // 選ばない・白・黒（黒は改定後の原価 34,000 円 → 54,570 円）
    s1: { groups: [['white', 'black']], units: { '-': 48150, '0': 48150, '1': 54570 } },
    s2: { groups: [], units: { '': 64200 } },
    s3: { por: true },
  },
};

const option = (id: string, categoryId: string) => ({
  id,
  code: `runtime-psl-${id}`,
  name: `S1 ${id}`,
  category_id: categoryId,
  base_model_id: null,
  price: 0,
  price_on_request: false,
  is_installation: false,
  status: 'published',
  image_url: null,
});

const bundle = {
  model: { id: 'model', slug: 'runtime-psl-model', base_price: 1000000, presets: [] },
  categories: [
    { id: 'cat-opt', code: 'runtime-psl-option', name: 'S1 設備' },
    { id: 'cat-sash', code: 'runtime-psl-sash', name: 'S1 サッシ', selection_mode: 'single' },
  ],
  options: [option('o1', 'cat-opt'), option('s1', 'cat-sash'), option('s2', 'cat-sash'), option('s3', 'cat-sash')],
  variantGroups: [{ id: 'g-color', option_id: 's1', code: 'color', name: '色', sort_order: 1, is_required: true, status: 'published' }],
  variantChoices: [
    { id: 'white', group_id: 'g-color', code: 'white', name: '白', kind: 'standard', extra_price: 0, price_on_request: false, status: 'published', sort_order: 1 },
    { id: 'black', group_id: 'g-color', code: 'black', name: '黒', kind: 'option', extra_price: 0, price_on_request: false, status: 'published', sort_order: 2 },
  ],
} as unknown as CatalogBundle;

const standard = (): SlotSelection[] => [
  { slot_code: 'hakidashi', option_id: 's1', variant_choice_ids: ['white'] },
  { slot_code: 'hiraki-1', option_id: 's1', variant_choice_ids: ['white'] },
  { slot_code: 'hiraki-2', option_id: 's1', variant_choice_ids: ['black'] },
];

describe('v2.5 PR-S1：位置・用途ごとの選択枠（シミュレーターに渡す形と計算）', () => {
  it('版の位置の枠を、標準の商品・選択肢と選べる商品（標準が先頭）つきで並べる。カテゴリー単位の枠は入れない', () => {
    expect(v25PositionSlots(view).map((slot) => [slot.slot_code, slot.slot_label, slot.selectable_option_ids.join(',')])).toEqual([
      ['hakidashi', '掃出し窓', 's1,s2'],
      ['hiraki-1', '開き窓①', 's1'],
      ['hiraki-2', '開き窓②', 's1'],
    ]);
    expect(v25StandardSlotSelections(view)).toEqual(standard());
    expect([...v25PositionSlotCategoryIds(view)]).toEqual(['cat-sash']);
    // 標準構成のカテゴリー単位の商品（シミュレーターの選択）に、位置の枠の商品は入れない
    expect(v25SlotOptionIds(view)).toEqual(['o1']);
    // カテゴリー単位の標準の選択肢に、位置の枠の選択肢は使わない（位置ごとに持つ）
    expect(v25StandardVariantIds(bundle.variantGroups, bundle.variantChoices, view, ['s1'])).toEqual(['white']);
    // v2.5 でない版・版が無いときは空
    expect(v25PositionSlots(null)).toEqual([]);
    expect(v25StandardSlotSelections({ ...view, pricing_model: undefined })).toEqual([]);
  });

  it('売価単価：位置の枠はその枠の標準と同じ「商品＋選択肢」だけ公開した版の売価（DB の S1-28 と同じ）', () => {
    expect(v25SelectionUnit(view, 's1', ['black'], undefined, 'hiraki-2')).toBe(52965);
    expect(v25SelectionUnit(view, 's1', ['black'], undefined, 'hiraki-1')).toBe(54570);
    expect(v25SelectionUnit(view, 's1', ['black'])).toBe(54570);
    expect(v25SelectionUnit(view, 's1', ['white'], undefined, 'hiraki-1')).toBe(48150);
    // カテゴリー単位の枠は、これまでどおり
    expect(v25SelectionUnit(view, 'o1', [])).toBe(32100);
    expect(v25SelectionUnit(view, 'o1', [], undefined, 'hakidashi')).toBe(32100);
  });

  it('標準のままなら公開した版の合計と同じ。掃出し窓を選べる商品に変えると、その位置の差額で計算する（DB の S1-37・S1-38 と同じ）', () => {
    const same = computeSaleViewPricing(bundle, view, ['o1'], [], [], undefined, standard());
    expect(same.pricing.total).toBe(672848);
    expect(same.sections.find((section) => section.code === 'option')?.delta_line).toBe(0);
    expect(same.pricing.has_price_on_request).toBe(false);

    const changed = computeSaleViewPricing(bundle, view, ['o1'], [], [], undefined, [
      { slot_code: 'hakidashi', option_id: 's2', variant_choice_ids: [] },
      ...standard().slice(1),
    ]);
    const option = changed.sections.find((section) => section.code === 'option');
    expect([option?.delta_line, option?.line_subtotal, option?.expense_amount, changed.pricing.total]).toEqual([16050, 197415, 29612, 693151]);
  });

  it('同じ商品の 2 つの位置で選択肢を入れ替えると、位置ごとの売価で差を出す（開き窓① を黒・開き窓② を白）', () => {
    const swapped = computeSaleViewPricing(bundle, view, ['o1'], [], [], undefined, [
      standard()[0],
      { slot_code: 'hiraki-1', option_id: 's1', variant_choice_ids: ['black'] },
      { slot_code: 'hiraki-2', option_id: 's1', variant_choice_ids: ['white'] },
    ]);
    // 開き窓①：54,570 − 48,150 ＝ ＋6,420、開き窓②：48,150 − 52,965 ＝ −4,815
    expect(swapped.sections.find((section) => section.code === 'option')?.delta_line).toBe(1605);
  });

  it('位置の選択の区分は、DB と同じく選んだ商品のカテゴリーと別途工事の印で決める（枠の標準の商品の区分ではない）', () => {
    const withInstall = {
      ...bundle,
      options: [...bundle.options, { ...option('s7', 'cat-sash'), is_installation: true }],
    } as unknown as CatalogBundle;
    const viewWithTable = { ...view, prices: { ...view.prices, s7: { groups: [], units: { '': 10000 } } } } as StandardEstimateSaleView;
    const result = computeSaleViewPricing(withInstall, viewWithTable, ['o1'], [], [], undefined, [
      { slot_code: 'hakidashi', option_id: 's7', variant_choice_ids: [] },
      ...standard().slice(1),
    ]);
    // 別途工事の印の商品は別途工事の区分に数える（オプションの区分からは、掃出し窓の標準 48,150 円が減る）
    expect(result.sections.find((section) => section.code === 'sitework')?.delta_line).toBe(10000);
    expect(result.sections.find((section) => section.code === 'option')?.delta_line).toBe(-48150);
  });

  it('保存したプランの明細を、カテゴリー単位の選択と位置ごとの選択に分ける（見積依頼の確認・本部の保存プランの画面）', () => {
    expect(
      splitConfigurationItems([
        { option_id: 'o1', variant_choice_ids: [], slot_code: null },
        { option_id: 's1', variant_choice_ids: ['white'], slot_code: 'hiraki-1' },
        { option_id: 's1', variant_choice_ids: ['black'], slot_code: 'hiraki-2' },
      ])
    ).toEqual({
      optionIds: ['o1'],
      variantChoiceIds: [],
      slotSelections: [
        { slot_code: 'hiraki-1', option_id: 's1', variant_choice_ids: ['white'] },
        { slot_code: 'hiraki-2', option_id: 's1', variant_choice_ids: ['black'] },
      ],
    });
    for (const page of ['app/(site)/mypage/configurations/[id]/request-quote/page.tsx', 'app/admin/configurations/[id]/page.tsx']) {
      expect(read(page)).toContain('...splitConfigurationItems(items),');
    }
  });

  it('価格未確定の商品は 0 円として別途見積の印を付け、版に無い位置（古い保存）は数えない', () => {
    const por = computeSaleViewPricing(bundle, view, ['o1'], [], [], undefined, [
      { slot_code: 'hakidashi', option_id: 's3', variant_choice_ids: [] },
      ...standard().slice(1),
    ]);
    expect(por.pricing.has_price_on_request).toBe(true);
    expect(por.sections.find((section) => section.code === 'option')?.delta_line).toBe(-48150);
    const stale = computeSaleViewPricing(bundle, view, ['o1'], [], [], undefined, [
      ...standard(),
      { slot_code: 'senmen', option_id: 's2', variant_choice_ids: [] },
    ]);
    expect(stale.pricing.total).toBe(672848);
  });
});

describe('v2.5 PR-S1：編集画面の決まり（DB の保存・公開と同じ）', () => {
  const candidates = new Map([
    ['o1', { name: '設備1', categoryId: 'cat-opt', categoryName: '設備', categoryCode: 'runtime-psl-option', singleSelect: false }],
    ['s1', { name: 'サッシ1', categoryId: 'cat-sash', categoryName: 'サッシ', categoryCode: 'sash', singleSelect: true }],
    ['s2', { name: 'サッシ2', categoryId: 'cat-sash', categoryName: 'サッシ', categoryCode: 'sash', singleSelect: true }],
    ['s4', { name: 'サッシ4', categoryId: 'cat-sash', categoryName: 'サッシ', categoryCode: 'sash', singleSelect: true, retired: true }],
    ['wall', { name: '外壁A', categoryId: 'cat-wall', categoryName: '外壁', categoryCode: 'exterior-wall', singleSelect: false }],
  ]);
  const of = (id: string) => candidates.get(id);
  const slot = (option_id: string, slot_code = '', selectable_option_ids: string[] = [], quantity = '1') => ({ option_id, quantity, slot_code, selectable_option_ids });

  it('1 つだけ選べるカテゴリーでも、位置の枠は何枠でもよい（同じ商品を 2 つの位置で使える）', () => {
    expect(v25SlotRuleIssues([slot('o1'), slot('s1', 'hakidashi', ['s2']), slot('s1', 'hiraki-1'), slot('s1', 'hiraki-2')], of)).toEqual([]);
  });

  it('カテゴリー単位の枠と位置の枠を混ぜない・外壁に位置の枠を作らない・選べる商品は同じカテゴリーの販売中の商品', () => {
    expect(v25SlotRuleIssues([slot('s1', 'hakidashi'), slot('s2')], of)).toEqual([
      'カテゴリー単位の選択枠と位置・用途の選択枠を、同じカテゴリーに混ぜられません：「サッシ」',
    ]);
    expect(v25SlotRuleIssues([slot('wall', 'front', [], '4')], of)).toEqual(['外壁・防火仕様には位置・用途の選択枠を作れません：「外壁A」']);
    expect(v25SlotRuleIssues([slot('s1', 'hakidashi', ['o1', 's4'])], of)).toEqual([
      '選べる商品は、その枠の標準の商品と同じカテゴリーの、公開中で販売停止・廃番でない商品にしてください：「設備1」・「サッシ4」',
    ]);
    // カテゴリー単位の枠が 2 つなら、これまでどおり止める（補足つき）
    expect(v25SlotRuleIssues([slot('s1'), slot('s2')], of)).toEqual([
      '1 つだけ選べるカテゴリーの選択枠は 1 つにしてください：「サッシ」（位置ごとに分けるときは、位置・用途の選択枠にします）',
    ]);
  });

  it('DB の決まりと同じ文（公開の確認・編集画面の案内）', () => {
    const migration = read(MIGRATION);
    for (const text of [
      '外壁・防火仕様には位置・用途の選択枠を作れません：',
      'カテゴリー単位の選択枠と位置・用途の選択枠を、同じカテゴリーに混ぜられません：',
      '1 つだけ選べるカテゴリーの選択枠は 1 つにしてください：',
      '（位置ごとに分けるときは、位置・用途の選択枠にします）',
      '選べる商品は、その枠の標準の商品と同じカテゴリーの、公開中で販売停止・廃番でない商品にしてください：',
    ]) {
      expect(migration).toContain(text);
      expect(read('lib/domain/standard-estimate-v25-workbench.ts')).toContain(text);
    }
  });

  const state = (slots: V25EditorState['slots']): V25EditorState => ({
    sales_fee_rate: '1.07',
    markup_rate: '1.5',
    expense_rate: '0.15',
    adjustment: '0',
    adjustment_reason: '',
    slots,
    lines: [],
  });
  const row = (key: string, option_id: string, slot_code = '', slot_label = '', selectable_option_ids: string[] = [], quantity = '1') => ({
    key,
    baseline_key: null,
    option_id,
    variant_choices: {},
    quantity,
    price_mode: 'auto' as const,
    manual_unit_price: '',
    slot_code,
    slot_label,
    selectable_option_ids,
  });

  it('保存の前の確認：識別子と名前は両方・形式・重複・数量 1・選べる商品は位置の枠だけ。同じ商品は位置が違えば使える', () => {
    expect(validateV25EditorState(state([row('a', 's1', 'hakidashi', '掃出し窓', ['s2']), row('b', 's1', 'hiraki-1', '開き窓①')]))).toBeNull();
    expect(validateV25EditorState(state([row('a', 's1', '', '掃出し窓')]))).toBe('商品 1 件目：位置・用途の識別子と名前は両方入力してください');
    expect(validateV25EditorState(state([row('a', 's1', 'Hakidashi', '掃出し窓')]))).toContain('英小文字・数字・ハイフン');
    expect(validateV25EditorState(state([row('a', 's1', 'w', '窓1'), row('b', 's2', 'w', '窓2')]))).toBe('商品 2 件目：位置・用途の識別子が重複しています（w）');
    expect(validateV25EditorState(state([row('a', 's1', 'w', '窓', [], '2')]))).toBe('商品 1 件目：位置・用途の選択枠の数量は 1 です');
    expect(validateV25EditorState(state([row('a', 'o1', '', '', ['o2'])]))).toBe('商品 1 件目：選べる商品は、位置・用途の選択枠にだけ指定できます');
    expect(validateV25EditorState(state([row('a', 'o1'), row('b', 'o1')]))).toContain('同じ商品が重複しています');
  });

  it('保存の中身：位置の枠は識別子・名前・選べる商品（標準の商品と重複は除く）、カテゴリー単位の枠は null と空', () => {
    const payload = buildV25SavePayload(state([row('a', 's1', 'hakidashi', '掃出し窓', ['s2', 's1', 's2']), row('b', 'o1')]));
    expect(payload.slots.map((slot) => [slot.slot_code, slot.slot_label, slot.selectable_option_ids])).toEqual([
      ['hakidashi', '掃出し窓', ['s2']],
      [null, null, []],
    ]);
  });
});

describe('v2.5 PR-S1：DB（migration）と保存の受け渡し', () => {
  const migration = read(MIGRATION);

  it('窓タイプ：マスターの表・初期 4 件・サッシのカテゴリーの印・商品の列（列ごとの読み取りの許可と一覧）', () => {
    expect(migration).toContain('create table public.window_types (');
    expect(migration).toContain("('fix', 'FIX窓', 10),\n  ('sliding', '引違い窓', 20),\n  ('casement', '縦すべり出し窓', 30),\n  ('awning', '横すべり出し窓', 40);");
    expect(migration).not.toContain('掃出し窓\', ');
    expect(migration).toContain("update public.option_categories set uses_window_type = true where code = 'sash';");
    expect(migration).toContain('grant select (window_type_code) on public.options to anon, authenticated;');
    const columns = JSON.parse(read('lib/data/legacy-price-columns.json')) as Record<string, { select: string[]; price: string[] }>;
    expect(columns.options.select).toContain('window_type_code');
    expect(columns.options.price).not.toContain('window_type_code');
    // 内部建具の「建具タイプ」などの商品の項目は足さない（2026-10-30 先方回答）
    expect(migration).not.toMatch(/door_type|建具タイプ（/);
  });

  it('版の位置の枠・選べる商品：識別子は版の中で一意、同じ商品を複数の位置で、公開済みの版は変えない', () => {
    expect(migration).toContain('add constraint standard_estimate_baseline_items_slot_code_key unique (revision_id, slot_code),');
    expect(migration).toContain('drop constraint standard_estimate_revision_ba_revision_id_selection_target__key;');
    expect(migration).toContain('unique nulls not distinct (revision_id, selection_target_code, option_id, slot_code);');
    expect(migration).toContain('references public.standard_estimate_revision_baseline_items (revision_id, slot_code) on delete cascade');
    expect(migration).toContain('for each row execute function public.standard_estimate_v25_child_guard();');
    expect(migration).toContain('for each row execute function public.prevent_non_draft_standard_estimate_child_write();');
    // 新しい版へ引き継ぐ
    expect(migration).toContain('price_mode, standard_cost_version_id, manual_unit_price, slot_code, slot_label');
    expect(migration).toContain('select p_to_revision_id, so.slot_code, so.option_id, so.sort_order');
  });

  it('お客様の保存：位置の枠ごとの明細（一意の条件を分ける）・スイッチの間だけ・版と 1 対 1・「1 つだけ選択」は枠の外だけ', () => {
    expect(migration).toContain('alter table public.configuration_items drop constraint configuration_items_configuration_id_option_id_key;');
    expect(migration).toContain('create unique index configuration_items_option_key on public.configuration_items (configuration_id, option_id) where slot_code is null;');
    expect(migration).toContain('create unique index configuration_items_slot_key on public.configuration_items (configuration_id, slot_code) where slot_code is not null;');
    expect(migration).toContain("p_expected_lock_version integer DEFAULT NULL::integer, p_slot_selections jsonb DEFAULT '[]'::jsonb)");
    expect(migration).toContain("raise exception 'VALIDATION: 位置ごとの選択は、新しい価格の標準見積でだけ保存できます' using errcode = 'P0001';");
    expect(migration).toContain('perform public.validate_configuration_items(p_base_model_id, v_options, v_level, v_slot_option_ids);');
    expect(migration).toContain("    where cat.selection_mode = 'single' and o.id = any (p_option_ids)");
    // 作り直した保存の関数は、これまでどおりログインした利用者だけ
    expect(migration).toContain(
      'grant execute on function public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer, jsonb)\n  to authenticated;'
    );
  });

  it('注文範囲の外の位置（本体のみのときの室内など）は選ばない。範囲の内の位置だけをすべて求める（保存・見積依頼）', () => {
    // 保存と見積依頼で共通の照らし合わせ：注文範囲の内の位置だけを求める
    expect(migration).toContain(
      '       and public.finish_level_rank(bc.finish_level) <= public.finish_level_rank(cfg.finish_level)\n       and not exists (select 1 from public.configuration_items ci where ci.configuration_id = cfg.id and ci.slot_code = bi.slot_code)'
    );
    // 位置の選択の商品は、プランの注文範囲の内のカテゴリーだけ
    expect(migration).toContain('         and public.finish_level_rank(c.finish_level) <= public.finish_level_rank(v_level)');
  });

  it('ログインなしの一時保存にも位置ごとの選択を持てる（形だけ確かめ、版との照らし合わせは保存のとき）', () => {
    expect(migration).toContain("'public.create_guest_plan(text, uuid, jsonb)'::regprocedure");
    expect(migration).toContain("'site_prefecture', 'site_municipality', 'site_location_undecided', 'slot_selections')$new$");
    expect(migration).toContain("raise exception 'VALIDATION: 位置ごとの選択の形式が正しくありません' using errcode = 'P0001';");
  });

  it('見積依頼・複製・商品の削除：既存の関数は目印を確かめて差し込む（本体を丸ごと写さない）', () => {
    expect(migration).toContain("'public.create_quote_from_configuration(uuid, jsonb, text, integer)'::regprocedure");
    expect(migration).toContain("'public.duplicate_configuration(uuid)'::regprocedure");
    expect(migration).toContain("'public.assert_option_unreferenced(uuid, text)'::regprocedure");
    expect(migration).toContain("raise exception 'POSTCONDITION: owner / security definer / search_path / ACL of % changed (% -> %)', p_target, v_before, v_after;");
    expect(migration).toContain('LOCKED: 標準の構成（窓などの位置ごとの選択）が更新されています。シミュレーターでプランを開いて保存し直してから、見積を依頼してください');
  });

  it('保存と見積依頼は、同じ関数で版の位置の枠と照らす（注文範囲・選べる商品・カテゴリー単位との重なり）', () => {
    expect(migration).toContain('create function public.standard_estimate_v25_configuration_slot_issue(p_configuration_id uuid, p_revision_id uuid)');
    expect(migration).toContain('v_missing := public.standard_estimate_v25_configuration_slot_issue(v_id, v_revision);');
    expect(migration).toContain('if public.standard_estimate_v25_configuration_slot_issue(cfg.id, v_revision) is not null then');
    expect(migration).toContain('revoke all on function public.standard_estimate_v25_configuration_slot_issue(uuid, uuid) from public, anon, authenticated, service_role;');
  });

  it('選べる商品は、この仕様で選べる商品だけ（保存と公開の決まり）。原価の固定は同じ行なら識別子を変えても引き継ぐ', () => {
    expect(migration).toContain('or not public.customer_product_spec_selectable(v_model.slug, m.spec_code, v_alt.spec_codes) then');
    expect(migration).toContain("'位置・用途の選択枠の商品と選べる商品は、この仕様で選べる商品にしてください：'");
    expect(migration).toContain("coalesce(pg_catalog.jsonb_object_agg(x.baseline_key || '#' || x.identity, x.pins), '{}'::jsonb)");
    expect(migration).toContain("then coalesce(v_old_rows -> (coalesce(v_baseline_key::text, '') || '#' || v_identity), v_old -> v_identity) end;");
  });

  it('アプリの保存：位置の選択があるときだけ渡す（migration の無い DB でも、これまでの保存は動く）。ローカル検証モードは受け付けない', () => {
    expect(read('lib/data/supabase-store.ts')).toContain(
      '...(input.slot_selections && input.slot_selections.length > 0 ? { p_slot_selections: input.slot_selections } : {}),'
    );
    // 古い保存の経路では位置の選択を持てないので、黙って落とさずに止める
    expect(read('lib/data/supabase-store.ts')).toContain(
      "throw new StoreError('VALIDATION', '位置ごとの選択を保存できませんでした。時間をおいてもう一度保存してください。');"
    );
    expect(read('lib/data/local-store.ts')).toContain("throw new StoreError('VALIDATION', '位置ごとの選択は、新しい価格の標準見積でだけ保存できます');");
  });

  it('実 DB の検査：S1 の検査を登録し、同時編集の検査は保存の関数を引数の名前で探す（引数を足しても黙って省略しない）', () => {
    expect(read('scripts/db-rehearsal/check.mjs')).toContain('runtime = mergeRuntime(runtime, await runtimeV25PositionSlots(client));');
    const concurrency = read('scripts/db-rehearsal/runtime-concurrency.mjs');
    expect(concurrency).toContain("and 'p_expected_lock_version' = any(coalesce(p.proargnames, '{}'::text[]))");
    expect(concurrency).not.toContain("to_regprocedure('public.save_configuration_atomic(");
  });
});
