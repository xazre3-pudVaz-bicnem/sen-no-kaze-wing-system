import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEstimateSpecSelection, buildV25SpecSelection } from '@/lib/domain/estimate-template';
import { v25BaseTotalFrom, type V25BaseTotalRow } from '@/lib/domain/public-base-price';
import { buildSimulatorEntryState } from '@/lib/domain/simulator-entry';
import { v25SlotOptionIds, type StandardEstimateSaleView } from '@/lib/domain/standard-estimate-sale-view';
import { standardSlotQuantity, v25SlotRuleIssues } from '@/lib/domain/standard-estimate-v25-workbench';
import type { RuleContext } from '@/lib/domain/rules';
import type { BaseModel, CatalogBundle, OptionCategory, ProductOption } from '@/lib/domain/types';
import { productJsonLd } from '@/lib/seo';

// 2026-10-29 先方回答（C1 の判断）：
//   ④ 公開中の標準見積の版の選択枠の商品・バリエーションを、モデル・仕様・防火条件のシミュレーターの初期構成にする
//   ⑤ 商品ページ・商品一覧・SEO の「本体価格計〜」は、公開中の v2.5 の版を基準に統一する
//   ③ 外壁は 4 面、それ以外のシミュレーター連携の選択枠は数量 1

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8').split('\r').join('');
const AT = '2026-10-29T00:00:00Z';

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

function option(id: string, categoryId: string, patch: Partial<ProductOption> = {}): ProductOption {
  return {
    id,
    base_model_id: null,
    category_id: categoryId,
    code: id,
    name: id,
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

const categories = [
  category('lights', { name: '照明' }),
  category('interior', { name: '内装', selection_mode: 'single', is_required: true }),
  category('fireproof', { name: '防火仕様', selection_mode: 'single', is_required: true }),
];
const options = [
  option('light-a', 'lights'),
  option('light-b', 'lights'),
  option('interior-std', 'interior', { is_default: true, sort_order: 1 }),
  option('interior-wood', 'interior', { sort_order: 2 }),
  option('interior-stopped', 'interior', { sort_order: 3, archived_at: AT }),
  option('fire-standard', 'fireproof', { is_default: true, sort_order: 1 }),
  option('fire-proof', 'fireproof', { sort_order: 2 }),
];
const ctx: RuleContext = { options, categories, dependencies: [], conflicts: [] };
// 旧来の標準構成（プリセット）は照明 b
const model = {
  id: 'model',
  slug: 'runtime-model',
  name: '検査モデル',
  presets: [{ code: 'office', name: '事務所', description: '', option_codes: ['light-b'] }],
} as unknown as BaseModel;

describe('v2.5：公開中の版の選択枠をシミュレーターの標準構成にする（2026-10-29 先方回答 ④）', () => {
  it('選択枠の商品をそのまま標準構成にし、旧来のプリセットでは補わない（必須だけ補う）', () => {
    expect(buildEstimateSpecSelection(ctx, model, 'office')).toContain('light-b');
    const selection = buildV25SpecSelection(ctx, model, 'office', ['light-a', 'interior-wood'], null);
    expect([...selection].sort()).toEqual(['fire-standard', 'interior-wood', 'light-a']);
  });

  it('選択枠が無い版は必須だけ（旧来のプリセットに戻らない）', () => {
    expect([...buildV25SpecSelection(ctx, model, 'office', [], null)].sort()).toEqual(['fire-standard', 'interior-std']);
  });

  it('防火の条件は防火仕様の商品で表す（選択枠に無くても入れ、非防火の既定値は入れない）', () => {
    const selection = buildV25SpecSelection(ctx, model, 'office', ['light-a'], 'fire-proof');
    expect(selection).toContain('fire-proof');
    expect(selection).not.toContain('fire-standard');
  });

  it('販売停止の商品の選択枠は入れず、そのカテゴリーを既定値で補わない（その仕様は受付停止）', () => {
    const selection = buildV25SpecSelection(ctx, model, 'office', ['light-a', 'interior-stopped'], null);
    expect(selection).not.toContain('interior-stopped');
    expect(selection).not.toContain('interior-std');
  });

  it('公開中の v2.5 の版の選択枠の商品だけを使う（v2.5 以前の版・版が無いときは旧来の標準構成）', () => {
    const v25 = { pricing_model: 'v2.5', baseline: [{ option_id: 'light-a' }, { option_id: 'interior-wood' }, { option_id: 'light-a' }] } as unknown as StandardEstimateSaleView;
    const legacy = { baseline: [{ option_id: 'light-a' }] } as unknown as StandardEstimateSaleView;
    expect(v25SlotOptionIds(v25)).toEqual(['light-a', 'interior-wood']);
    expect(v25SlotOptionIds(legacy)).toBeNull();
    expect(v25SlotOptionIds(null)).toBeNull();
  });

  it('/plans から仕様を指定して開くときも、選択枠の商品を標準構成にする（版が無い仕様は旧来どおり）', () => {
    const bundle = {
      model,
      options,
      categories,
      dependencies: [],
      conflicts: [],
      customerCategoryMatrix: null,
      variantGroups: [],
      variantChoices: [],
    } as unknown as CatalogBundle;
    const v25 = buildSimulatorEntryState(bundle, [], 'office', undefined, () => ['light-a', 'interior-wood']);
    expect([...(v25?.option_ids ?? [])].sort()).toEqual(['fire-standard', 'interior-wood', 'light-a']);
    const legacy = buildSimulatorEntryState(bundle, [], 'office', undefined, () => null);
    expect(legacy?.option_ids).toContain('light-b');
  });

  it('シミュレーターは仕様・防火の条件ごとの標準構成を使い、防火の切り替えでは標準構成のままなら新しい条件の標準構成を読み込む', () => {
    const app = read('components/simulator/simulator-app.tsx');
    expect(app).toContain('buildV25SpecSelection(ctx, model, choice.code, slotOptionIds, fire ? fireProofOptionId : null)');
    expect(app).toContain('const specSelections = fireSelected ? fireSpecSelections : nonFireSpecSelections;');
    // 仕様の読み込みは今の防火の条件の標準構成
    expect(app).toContain('const next = standardStateFor(code, fireSelected);');
    // 防火の切り替え：標準構成のままなら読み込み、変えていれば防火仕様だけを入れ替える
    expect(app).toContain('if (nextId && nextId !== fireproofChosen?.id) changeFireSpec(fireproofCat.id, nextId);');
    expect(app).toContain('if (atStandard && next && next.selection.includes(nextId)) {');
    expect(app).toContain('applyPicker(fireproofCategoryId, [nextId]);');
    // 受付停止の判定にも選択枠の商品を含める（DB の get_spec_acceptance_state と同じ）
    expect(app).toContain('...((v25Pricing && v25SlotOptionIds(pickSaleView(saleViews, model.slug, specCode, fireSelected))) || []),');
    const page = read('app/(site)/simulator/[slug]/page.tsx');
    expect(page).toContain('sale.v25 ? (specCode) => v25SlotOptionIds(pickSaleView(saleViews, model.slug, specCode, false)) : undefined');
  });
});

describe('本体価格計〜は公開中の v2.5 の版に統一する（2026-10-29 先方回答 ⑤）', () => {
  const rows: V25BaseTotalRow[] = [
    { base_model_id: 'a', spec_code: 'office', fire_spec_code: 'non_fire', base_total: 403111, has_por: false },
    { base_model_id: 'a', spec_code: 'hotel', fire_spec_code: 'non_fire', base_total: 380000, has_por: true },
    { base_model_id: 'a', spec_code: 'office', fire_spec_code: 'fire', base_total: 450000, has_por: false },
    { base_model_id: 'b', spec_code: 'office', fire_spec_code: 'non_fire', base_total: 150000, has_por: false },
  ];

  it('モデルの公開中の版の本体の合計の最小。本体に価格未確定がある版は使わず、版が無ければ出さない', () => {
    expect(v25BaseTotalFrom(rows, 'a')).toBe(403111);
    expect(v25BaseTotalFrom(rows, 'b')).toBe(150000);
    expect(v25BaseTotalFrom(rows, 'c')).toBeNull();
  });

  it('構造化データの価格も同じ値。金額を出さないときは価格（offers）を付けない', () => {
    const withPrice = productJsonLd(model, [], 403111) as { offers?: { price: number } };
    expect(withPrice.offers?.price).toBe(403111);
    expect('offers' in productJsonLd(model, [], null)).toBe(false);
  });

  it('商品一覧・商品ページ（表示・説明文・構造化データ）は同じ価格元を使い、固定の金額を持たない', () => {
    const data = read('lib/data/standard-estimate-sale-views.ts');
    expect(data).toContain('if (!(await getSimulatorStandardPricingEnabled())) return legacy();');
    expect(data).toContain("db.rpc('get_public_v25_base_totals')");
    const list = read('app/(site)/products/page.tsx');
    expect(list).toContain('const baseTotals = await getPublicBaseTotals(models);');
    expect(list).toContain('baseTotal: baseTotals[m.id] ?? null,');
    const product = read('app/(site)/products/[slug]/page.tsx');
    expect(product).toContain('const baseTotal = (await getPublicBaseTotals([model]))[model.id] ?? null;');
    expect(product).toContain('productJsonLd(model, [hero?.url, ...gallery.map((g) => g.url)].filter((u): u is string => Boolean(u)), baseTotal)');
    expect(product).not.toContain('baseTotalOf');
    expect(read('components/sections/product-chapters.tsx')).not.toContain('baseTotalOf');
    expect(read('lib/seo.ts')).not.toContain('baseTotalOf');
    // 使っていない比較の部品（CostSection）も固定の金額を持たない
    expect(read('data/site-content.ts')).not.toMatch(/本体 \d[\d,]*万円/);
    expect(read('components/sections/cost.tsx')).toContain('baseTotalsBySlug');
  });

  it('DB：本体価格計の元は公開中の v2.5 の版の本体の区分だけを、サーバー（service_role）だけに返す', () => {
    const migration = read('supabase/migrations/20261029100000_simulator_v25_pricing.sql');
    expect(migration).toContain('create function public.get_public_v25_base_totals()');
    expect(migration).toContain("join public.standard_estimate_revisions r on r.id = m.current_published_revision_id and r.status = 'published' and r.pricing_model = 'v2.5'\n    join public.standard_estimate_revision_sections s on s.revision_id = r.id and s.section_code = 'base'");
    expect(migration).toContain('grant execute on function public.get_public_v25_base_totals() to service_role;');
  });
});

describe('シミュレーターと連携する選択枠の数量（2026-10-29 先方回答 ③）', () => {
  type Candidate = { name: string; categoryId: string; categoryName: string; categoryCode: string; singleSelect: boolean; unavailable?: boolean };
  const candidate = (id: string, categoryCode: string, singleSelect = false, categoryId = categoryCode): Candidate => ({
    name: id,
    categoryId,
    categoryName: categoryCode,
    categoryCode,
    singleSelect,
  });
  const candidates = new Map([
    ['wall', candidate('外壁A', 'exterior-wall', true)],
    ['sash', candidate('サッシA', 'sash', true)],
    ['sash2', candidate('サッシB', 'sash', true)],
    ['light', candidate('照明', 'lighting')],
    ['light2', candidate('照明2', 'lighting')],
    ['gone', { ...candidate('選べない商品', ''), unavailable: true }],
  ]);
  const of = (id: string) => candidates.get(id);

  it('外壁は 4（面）、それ以外は 1', () => {
    expect(standardSlotQuantity('exterior-wall')).toBe(4);
    expect(standardSlotQuantity('sash')).toBe(1);
  });

  it('決まりに合えば問題なし（複数選べるカテゴリーは選択枠を分けて各数量 1）', () => {
    expect(
      v25SlotRuleIssues(
        [{ option_id: 'wall', quantity: '4' }, { option_id: 'sash', quantity: '1' }, { option_id: 'light', quantity: '1' }, { option_id: 'light2', quantity: '1' }],
        of
      )
    ).toEqual([]);
  });

  it('外壁が 4 でない・ほかが 1 でない・1 つだけ選べるカテゴリーに 2 枠、を挙げる（選べない商品の行は別の案内）', () => {
    const issues = v25SlotRuleIssues(
      [
        { option_id: 'wall', quantity: '1' },
        { option_id: 'sash', quantity: '2' },
        { option_id: 'sash2', quantity: '1' },
        { option_id: 'gone', quantity: '3' },
      ],
      of
    );
    expect(issues).toEqual([
      '外壁の選択枠は数量 4（面）にしてください：「外壁A」',
      '外壁以外の選択枠は数量 1 にしてください（個別に変えるものは選択枠を分け、個別に選ばない数量は明細にします）：「サッシA」',
      '1 つだけ選べるカテゴリーの選択枠は 1 つにしてください：「sash」',
    ]);
  });

  it('編集画面は外壁の選択枠を数量 4 で足し、決まりに合わなければ公開できない。DB も公開とスイッチで止める', () => {
    const workbench = read('components/admin/standard-estimate-v25-workbench.tsx');
    expect(workbench).toContain('const quantity = String(standardSlotQuantity(candidate.categoryCode));');
    expect(workbench).toContain("...(slotRuleIssues.length > 0 ? ['選択枠がシミュレーターと連携する決まりに合いません（表の下の案内を確認してください）'] : []),");
    const migration = read('supabase/migrations/20261029100000_simulator_v25_pricing.sql');
    expect(migration).toContain('create function public.standard_estimate_v25_slot_rule_issues(p_revision_id uuid)');
    expect(migration).toContain("when (new.status = 'published' and old.status is distinct from 'published' and new.pricing_model = 'v2.5')");
    expect(migration).toContain('cross join lateral (select public.standard_estimate_v25_slot_rule_issues(r.id) as issues) x');
  });
});
