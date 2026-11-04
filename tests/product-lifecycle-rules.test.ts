import { describe, expect, it } from 'vitest';
import { buildEstimateSpecSelection, estimateSpecStoppedProductNames } from '@/lib/domain/estimate-template';
import { buildPresetSelection } from '@/lib/domain/preset';
import { isQuoteSelectableProduct } from '@/lib/domain/product-lifecycle';
import { defaultSelection, toggleOption, validateSelection, type RuleContext } from '@/lib/domain/rules';
import type { ModelPreset, OptionCategory, ProductOption } from '@/lib/domain/types';

// PR #500：取扱終了・シミュレーター非表示の商品は options に残したまま（保存済みの明細の表示・保持のため）、
// 新しい選択・初期選択・前提商品の自動追加だけを止める。見積の場面では非表示の商品も選べる。

const AT = '2026-10-15T00:00:00Z';

function category(id: string, patch: Partial<OptionCategory> = {}): OptionCategory {
  return {
    id,
    code: id,
    name: id,
    group_code: 'equipment',
    group_name: '設備機器',
    group_sort: 0,
    description: null,
    selection_mode: 'multi',
    finish_level: 'full',
    is_required: false,
    customer_visible: true,
    sort_order: 0,
    status: 'published',
    ...patch,
  };
}

function option(id: string, name: string, categoryId: string, patch: Partial<ProductOption> = {}): ProductOption {
  return {
    id,
    base_model_id: null,
    category_id: categoryId,
    code: id,
    name,
    description: null,
    price: 10000,
    image_url: null,
    selection_type: 'checkbox',
    is_required: false,
    is_default: false,
    is_installation: false,
    price_on_request: false,
    spec_codes: [],
    owner_id: null,
    manufacturer: null,
    model_no: null,
    size_note: null,
    list_price: null,
    highlight: null,
    preview_key: null,
    affects_views: [],
    sort_order: 0,
    status: 'published',
    simulator_visible: true,
    archived_at: null,
    created_at: AT,
    updated_at: AT,
    ...patch,
  };
}

const HIDDEN = { simulator_visible: false };
const RETIRED = { archived_at: AT };

const categories = [
  category('lights', { name: '照明' }),
  category('interior', { name: '内装', selection_mode: 'single', is_required: true }),
  category('fixtures', { name: '建具', selection_mode: 'single', is_required: true }),
];
const options = [
  option('light-visible', '照明（表示）', 'lights'),
  option('light-hidden', '照明（非表示）', 'lights', HIDDEN),
  option('light-retired', '照明（取扱終了）', 'lights', RETIRED),
  option('light-draft', '照明（下書き）', 'lights', { status: 'draft' }),
  option('light-hidden-default', '照明（非表示・初期選択）', 'lights', { ...HIDDEN, is_default: true }),
  option('light-retired-default', '照明（取扱終了・初期選択）', 'lights', { ...RETIRED, is_default: true }),
  option('dimmer', '調光スイッチ', 'lights'),
  option('interior-std', '内装（標準）', 'interior', { is_default: true, sort_order: 1 }),
  option('interior-retired', '内装（取扱終了）', 'interior', { ...RETIRED, sort_order: 2 }),
  // 必須の単一カテゴリーだが、新しく選べる商品が無い（非表示と取扱終了だけ）
  option('fixture-hidden', '建具（非表示）', 'fixtures', HIDDEN),
  option('fixture-retired', '建具（取扱終了）', 'fixtures', RETIRED),
];
const ctx: RuleContext = {
  options,
  categories,
  dependencies: [{ id: 'dep-1', option_id: 'dimmer', requires_option_id: 'light-hidden', message: null }],
  conflicts: [],
};
const quoteCtx: RuleContext = { ...ctx, canSelectNew: isQuoteSelectableProduct };

const requiredMessages = (selected: string[], context = ctx) =>
  validateSelection(context, selected)
    .filter((issue) => issue.type === 'required')
    .map((issue) => issue.message);

describe('新しく選べる商品の判定（RuleContext.canSelectNew）', () => {
  it('シミュレーターでは、非表示・取扱終了・下書きの商品を新しく選べず、理由を返す', () => {
    expect(toggleOption(ctx, [], 'light-visible')).toMatchObject({ rejected: false, next: ['light-visible'] });

    const hidden = toggleOption(ctx, [], 'light-hidden');
    expect(hidden.rejected).toBe(true);
    expect(hidden.next).toEqual([]);
    expect(hidden.notices).toEqual(['「照明（非表示）」はシミュレーターでは新しく選べません。']);

    const retired = toggleOption(ctx, [], 'light-retired');
    expect(retired.rejected).toBe(true);
    expect(retired.notices).toEqual(['「照明（取扱終了）」は販売停止中のため、新しく選べません。']);

    expect(toggleOption(ctx, [], 'light-draft').rejected).toBe(true);
  });

  it('見積の場面では、非表示の商品も選べる（見積不可ではない）が、取扱終了は選べない', () => {
    expect(toggleOption(quoteCtx, [], 'light-hidden')).toMatchObject({ rejected: false, next: ['light-hidden'] });
    expect(toggleOption(quoteCtx, [], 'light-retired').rejected).toBe(true);
    expect(toggleOption(quoteCtx, [], 'light-draft').rejected).toBe(true);
  });

  it('保存済みの取扱終了・非表示の明細は外せるが、外した後に足し直せない', () => {
    const removedRetired = toggleOption(ctx, ['light-retired', 'light-visible'], 'light-retired');
    expect(removedRetired).toMatchObject({ rejected: false, next: ['light-visible'] });
    expect(toggleOption(ctx, removedRetired.next, 'light-retired').rejected).toBe(true);

    const removedHidden = toggleOption(ctx, ['light-hidden'], 'light-hidden');
    expect(removedHidden).toMatchObject({ rejected: false, next: [] });
    expect(toggleOption(ctx, removedHidden.next, 'light-hidden').rejected).toBe(true);
  });

  it('単一カテゴリーで、保存済みの取扱終了から別の商品へ替えられるが、取扱終了へは替えられない', () => {
    const switched = toggleOption(ctx, ['interior-retired'], 'interior-std');
    expect(switched).toMatchObject({ rejected: false, next: ['interior-std'] });
    expect(toggleOption(ctx, ['interior-std'], 'interior-retired')).toMatchObject({ rejected: true, next: ['interior-std'] });
  });

  it('前提商品がシミュレーターで選べないときは、自動で足さずに選択を断る（見積では前提商品を自動で足す）', () => {
    const simulator = toggleOption(ctx, [], 'dimmer');
    expect(simulator.rejected).toBe(true);
    expect(simulator.notices[0]).toContain('必要な商品が、このモデル・仕様では選択できない');

    const quote = toggleOption(quoteCtx, [], 'dimmer');
    expect(quote.rejected).toBe(false);
    expect(quote.next).toEqual(expect.arrayContaining(['dimmer', 'light-hidden']));
  });
});

describe('選択内容の検証（保存済みの明細は選ばれている限り数える）', () => {
  it('保存済みの取扱終了の明細だけでも、必須カテゴリーは満たす', () => {
    expect(requiredMessages(['interior-retired'])).not.toContain('「内装」を選択してください。');
    expect(requiredMessages([])).toContain('「内装」を選択してください。');
  });

  it('保存済みの取扱終了と新しい商品が同じ単一カテゴリーにあれば、重複として止める', () => {
    const issues = validateSelection(ctx, ['interior-retired', 'interior-std']);
    expect(issues.some((issue) => issue.type === 'single')).toBe(true);
  });

  it('新しく選べる商品が無い必須カテゴリーは、シミュレーターでは必須にしない（DB の validate_configuration_items と同じ）', () => {
    expect(requiredMessages(['interior-std'])).not.toContain('「建具」を選択してください。');
    // 見積の場面では非表示の商品を選べるので、必須のまま
    expect(requiredMessages(['interior-std'], quoteCtx)).toContain('「建具」を選択してください。');
  });
});

describe('初期選択', () => {
  it('シミュレーターでは非表示・取扱終了の初期選択商品を入れず、見積では非表示の初期選択商品を入れる', () => {
    const simulator = defaultSelection(ctx);
    expect(simulator).toContain('interior-std');
    expect(simulator).not.toContain('light-hidden-default');
    expect(simulator).not.toContain('light-retired-default');

    const quote = defaultSelection(quoteCtx);
    expect(quote).toContain('light-hidden-default');
    expect(quote).not.toContain('light-retired-default');
  });
});

describe('標準構成の組み立て（非表示の標準商品は標準として保持する）', () => {
  const preset: ModelPreset = {
    code: 'hotel',
    name: 'ホテル仕様',
    description: '',
    option_codes: ['light-hidden', 'light-retired', 'light-visible'],
  };
  const model = { slug: 'wing-lifecycle-test', presets: [preset] };

  it('プランの標準構成は、シミュレーター非表示の商品も入れ、取扱終了は入れない', () => {
    const selection = buildPresetSelection(ctx, preset);
    expect(selection).toEqual(expect.arrayContaining(['light-hidden', 'light-visible', 'interior-std']));
    expect(selection).not.toContain('light-retired');
    // 標準として入った非表示の商品は、外せるが、シミュレーターで足し直せない（DB の保存境界と同じ）
    const removed = toggleOption(ctx, selection, 'light-hidden');
    expect(removed.rejected).toBe(false);
    expect(toggleOption(ctx, removed.next, 'light-hidden').rejected).toBe(true);
  });

  it('Excel 標準見積の基準商品も、保存済みの基準商品・プランの商品構成のどちらから組み立てても同じ扱いにする', () => {
    const fromSaved = buildEstimateSpecSelection(ctx, model, 'hotel', ['light-hidden', 'light-retired']);
    expect(fromSaved).toEqual(expect.arrayContaining(['light-hidden', 'interior-std']));
    expect(fromSaved).not.toContain('light-retired');

    const fromPreset = buildEstimateSpecSelection(ctx, model, 'hotel');
    expect(fromPreset).toEqual(expect.arrayContaining(['light-hidden', 'light-visible', 'interior-std']));
    expect(fromPreset).not.toContain('light-retired');
  });

  it('標準構成の販売停止の商品は、同じカテゴリーの既定の商品で自動的に補わない（2026-10-19 の先方回答 ③ の ①：その仕様は受付停止）', () => {
    const stoppedPreset: ModelPreset = { code: 'office', name: '事務所', description: '', option_codes: ['interior-retired', 'light-visible'] };
    const stoppedModel = { slug: 'wing-lifecycle-test', presets: [stoppedPreset] };
    // 本体の仕様から組み立てる（必須の単一カテゴリーの内装は、販売停止の商品だけが標準）
    const fromPlan = buildPresetSelection(ctx, stoppedPreset);
    expect(fromPlan).toContain('light-visible');
    expect(fromPlan).not.toContain('interior-retired');
    expect(fromPlan).not.toContain('interior-std');
    // Excel 標準見積・標準見積の基準商品から組み立てても同じ
    const fromSaved = buildEstimateSpecSelection(ctx, stoppedModel, 'office', ['interior-retired', 'light-visible']);
    expect(fromSaved).not.toContain('interior-retired');
    expect(fromSaved).not.toContain('interior-std');
    // 受付停止の案内に出す名前（基準商品・本体の仕様のどちらにあっても数える）
    expect(estimateSpecStoppedProductNames(ctx, stoppedModel, 'office', ['interior-retired', 'light-visible'])).toEqual(['内装（取扱終了）']);
    expect(estimateSpecStoppedProductNames(ctx, stoppedModel, 'office')).toEqual(['内装（取扱終了）']);
    // 販売停止の商品が無い仕様は空（従来どおり必須カテゴリーは既定の商品で補う）。ホテル仕様は本体の仕様に販売停止の照明があるので受付停止
    const cleanPreset: ModelPreset = { code: 'clean', name: '販売停止なし', description: '', option_codes: ['light-hidden', 'light-visible'] };
    const cleanModel = { slug: 'wing-lifecycle-test', presets: [cleanPreset] };
    expect(estimateSpecStoppedProductNames(ctx, cleanModel, 'clean', ['light-hidden', 'light-visible'])).toEqual([]);
    expect(buildEstimateSpecSelection(ctx, cleanModel, 'clean', ['light-hidden', 'light-visible'])).toContain('interior-std');
    expect(estimateSpecStoppedProductNames(ctx, model, 'hotel')).toEqual(['照明（取扱終了）']);
  });
});
