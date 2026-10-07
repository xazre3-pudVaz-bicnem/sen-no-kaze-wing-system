import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import {
  applyCustomerCategoryApplicability,
  CUSTOMER_CATEGORY_MATRIX,
  customerCategorySelectable,
} from '@/lib/domain/customer-category-applicability';
import { buildEstimateSpecSelection, ruleContextForSpec } from '@/lib/domain/estimate-template';
import {
  defaultSelection,
  explainBlocked,
  toggleOption,
  unsatisfiableDependencyOf,
  validateSelection,
  type RuleContext,
} from '@/lib/domain/rules';
import type { OptionCategory, ProductOption } from '@/lib/domain/types';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261006230000_customer_spec_required_history_corrective.sql'),
  'utf8'
);

function functionBody(name: string): string {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} definition`).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf('\n$$;', start);
  expect(end, `${name} terminator`).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe('required validation / historical non-draft corrective migration', () => {
  it('changes function definitions only and never rewrites saved data', () => {
    expect(migration).not.toMatch(/^\s*(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop\s+table)\b/im);
    expect(migration).not.toMatch(/is_required\s*=\s*false/i);
    expect(migration).toContain("PRECONDITION: preceding customer-spec correctives are not applied");
  });

  it('keeps conflict / dependency / scope / single checks and limits the global required check to categories outside the classification sheet', () => {
    const body = functionBody('validate_configuration_items');
    expect(body).toContain("set search_path = ''");
    expect(body).toContain("raise exception 'CONFLICT: %'");
    expect(body).toContain("raise exception 'DEPENDENCY: %'");
    expect(body).toContain('not (d.requires_option_id = any (p_option_ids))');
    expect(body).toContain("raise exception 'SINGLE: 「%」は 1 つだけ選択してください'");
    expect(body).toContain('public.customer_business_item_for_category(cat.code) is null');
    // 依存ルールは仕様・分類表で絞り込まない
    expect(body.slice(body.indexOf('option_dependencies'), body.indexOf("raise exception 'DEPENDENCY"))).not.toContain(
      'customer_category_selectable'
    );
  });

  it('applies the required rule with the same source of truth as the classification sheet when model/spec are known', () => {
    const body = functionBody('enforce_configuration_customer_categories');
    const required = body.slice(body.indexOf('-- 必須カテゴリーの判定'));
    expect(required).toContain('cat.is_required');
    expect(required).toContain('public.customer_business_item_for_category(cat.code) is not null');
    expect(required).toContain('public.customer_category_selectable(v_model_slug, new.spec_code, cat.code)');
    expect(required).toContain(
      "public.customer_product_spec_selectable(v_model_slug, new.spec_code, coalesce(o.spec_codes, '{}'::text[]))"
    );
    expect(required).toContain('public.finish_level_rank(cat.finish_level) <= public.finish_level_rank(new.finish_level)');
    expect(required).toContain("raise exception 'REQUIRED: 「%」を選択してください', v_missing");
    // 編集可能な Draft の保存と、Draft からの提出だけが対象
    expect(required).toContain("(new.status = 'draft' or (tg_op = 'UPDATE' and old.status = 'draft'))");
  });

  it('does not re-validate status-only transitions of existing non-draft history, but still validates model/spec changes', () => {
    const body = functionBody('enforce_configuration_customer_categories');
    const skip = body.slice(body.indexOf("if tg_op = 'UPDATE'"), body.indexOf('select m.slug into v_model_slug'));
    expect(skip).toContain("old.status <> 'draft'");
    expect(skip).toContain("new.status <> 'draft'");
    expect(skip).toContain('new.base_model_id is not distinct from old.base_model_id');
    expect(skip).toContain('new.spec_code is not distinct from old.spec_code');
    expect(skip).toContain('return new;');
    // 仕様なしの編集可能 Draft は引き続き拒否
    expect(body).toContain("new.status = 'draft' and new.spec_code is null");
    // 履歴の保存内容を現在の分類表へ合わせて書き換えない
    expect(body).not.toMatch(/\b(update|delete\s+from|insert\s+into)\s+public\./i);
  });

  it('keeps both functions postgres-owned SECURITY DEFINER with an empty search_path and closed to API roles', () => {
    expect(migration).toContain('alter function public.validate_configuration_items(uuid, uuid[], text) owner to postgres;');
    expect(migration).toContain('alter function public.enforce_configuration_customer_categories() owner to postgres;');
    expect(migration).toContain(
      'revoke all on function public.enforce_configuration_customer_categories()\n  from public, anon, authenticated, service_role;'
    );
    expect(migration).toContain("'search_path=\"\"' = any(v_fn.proconfig)");
  });
});

// ---------- rule engine: dependency must not be dropped by the candidate filter ----------

const category = (code: string, patch: Partial<OptionCategory> = {}): OptionCategory =>
  ({
    id: `cat-${code}`,
    code,
    name: code,
    description: null,
    selection_mode: 'single',
    is_required: false,
    sort_order: 1,
    status: 'published',
    group_code: code,
    group_name: code,
    group_sort: 1,
    finish_level: 'full',
    customer_visible: true,
    ...patch,
  }) as OptionCategory;

const option = (code: string, categoryCode: string, patch: Partial<ProductOption> = {}): ProductOption =>
  ({
    id: code,
    code,
    name: code,
    category_id: `cat-${categoryCode}`,
    base_model_id: null,
    description: null,
    price: 0,
    image_url: null,
    selection_type: 'radio',
    is_required: false,
    is_default: false,
    is_installation: false,
    price_on_request: false,
    preview_key: null,
    affects_views: [],
    spec_codes: [],
    sort_order: 1,
    status: 'published',
    owner_id: null,
    manufacturer: null,
    model_no: null,
    size_note: null,
    list_price: null,
    highlight: null,
    gallery_images: [],
    ...patch,
  }) as ProductOption;

function dependencyFixture(boilerSpecCodes: string[]): RuleContext {
  return {
    categories: [category('ub'), category('kitchen'), category('boiler'), category('floor', { is_required: true })],
    options: [
      option('ub-1216', 'ub', { is_default: true }),
      option('mini-kitchen', 'kitchen'),
      option('gas-boiler-16', 'boiler', { spec_codes: boilerSpecCodes }),
      option('floor-standard', 'floor', { is_default: true, spec_codes: ['hotel', 'residence'] }),
    ],
    dependencies: [
      { id: 'd1', option_id: 'ub-1216', requires_option_id: 'gas-boiler-16', message: null },
      { id: 'd2', option_id: 'mini-kitchen', requires_option_id: 'gas-boiler-16', message: null },
    ],
    conflicts: [],
  } as RuleContext;
}

describe('dependency rules survive the model/spec candidate filter', () => {
  it('keeps the rule when the required product is filtered out, instead of silently dropping it', () => {
    const ctx = ruleContextForSpec(dependencyFixture(['hotel', 'residence']), 'office', 'wing-01');
    expect(ctx.options.map((o) => o.code)).not.toContain('gas-boiler-16');
    expect(ctx.dependencies.map((d) => d.option_id).sort()).toEqual(['mini-kitchen', 'ub-1216']);
    expect(unsatisfiableDependencyOf(ctx, 'ub-1216')).toBe('ub-1216');
  });

  it('rejects the selection with an explicit reason when the dependency cannot be satisfied', () => {
    const ctx = ruleContextForSpec(dependencyFixture(['hotel', 'residence']), 'office', 'wing-01');
    const result = toggleOption(ctx, [], 'ub-1216');
    expect(result.rejected).toBe(true);
    expect(result.next).toEqual([]);
    expect(result.notices.join('')).toContain('このモデル・仕様では選択できない');
    expect(explainBlocked(ctx, []).get('ub-1216')).toContain('このモデル・仕様では選択できない');
    // 既定商品でも、前提を満たせないものは標準選択へ入れない
    expect(defaultSelection(ctx)).not.toContain('ub-1216');
  });

  it('reports an already-saved selection whose dependency became unsatisfiable (no silent pass)', () => {
    const ctx = ruleContextForSpec(dependencyFixture(['hotel', 'residence']), 'office', 'wing-01');
    const issues = validateSelection(ctx, ['ub-1216']);
    const dependency = issues.find((issue) => issue.type === 'dependency');
    expect(dependency?.option_ids).toEqual(['ub-1216']);
    expect(dependency?.message).toContain('外してください');
  });

  it('still auto-adds the required product when it is a valid candidate', () => {
    const ctx = ruleContextForSpec(dependencyFixture([]), 'office', 'wing-01');
    const result = toggleOption(ctx, [], 'mini-kitchen');
    expect(result.rejected).toBe(false);
    expect(result.next.sort()).toEqual(['gas-boiler-16', 'mini-kitchen']);
    expect(unsatisfiableDependencyOf(ctx, 'mini-kitchen')).toBeNull();
  });

  it('follows dependency chains', () => {
    const base = dependencyFixture(['hotel']);
    const ctx = ruleContextForSpec(
      {
        ...base,
        options: [...base.options, option('kitchen-set', 'kitchen')],
        dependencies: [...base.dependencies, { id: 'd3', option_id: 'kitchen-set', requires_option_id: 'mini-kitchen', message: null }],
      } as RuleContext,
      'office',
      'wing-01'
    );
    expect(unsatisfiableDependencyOf(ctx, 'kitchen-set')).toBe('mini-kitchen');
    expect(toggleOption(ctx, [], 'kitchen-set').rejected).toBe(true);
  });

  it('does not require a required category that has no candidate for the spec', () => {
    // floor は必須だが、office に適合する商品が無い → 必須にしない（保存不能にしない）
    const office = ruleContextForSpec(dependencyFixture([]), 'office', 'wing-01');
    expect(validateSelection(office, []).filter((issue) => issue.type === 'required')).toEqual([]);
    const hotel = ruleContextForSpec(dependencyFixture([]), 'hotel', 'wing-01');
    expect(validateSelection(hotel, []).some((issue) => issue.type === 'required')).toBe(true);
  });
});

// ---------- seed catalog × classification sheet ----------

describe.sequential('seed catalog on the classification sheet (local store parity with the DB guards)', () => {
  let dir = '';
  const actor = { id: 'required-matrix-user', email: 'matrix@example.com', role: 'customer' as const, full_name: '分類表テスト' };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-required-matrix-'));
    process.env.WING_LOCAL_DIR = dir;
    process.env.WING_LOCAL_MODE = '1';
  });

  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    delete process.env.WING_LOCAL_MODE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function customerBundle(slug: string) {
    const store = new LocalStore();
    const model = (await store.listModels()).find((row) => row.slug === slug)!;
    const bundle = applyCustomerCategoryApplicability((await store.getCatalogBundle(model.id))!);
    return { store, model, bundle };
  }

  it('has no dependency whose required product is unavailable where the dependent product is selectable', async () => {
    for (const [slug, rows] of Object.entries(CUSTOMER_CATEGORY_MATRIX)) {
      const { model, bundle } = await customerBundle(slug);
      for (const specCode of Object.keys(rows).filter((code) => code !== 'base')) {
        const ctx = ruleContextForSpec(bundle, specCode, model.slug);
        for (const dependency of ctx.dependencies) {
          expect(unsatisfiableDependencyOf(ctx, dependency.option_id), `${slug}/${specCode}/${dependency.option_id}`).toBeNull();
        }
      }
    }
  });

  it('lets BOX water-kit pick a unit bath together with its boiler (boiler follows UB/SWR, not the other-items column)', async () => {
    const { model, bundle } = await customerBundle('box');
    const ctx = ruleContextForSpec(bundle, 'water-kit', model.slug);
    const ub = ctx.options.find((row) => row.code === 'ub-1216')!;
    const boiler = ctx.options.find((row) => row.code === 'gas-boiler-16');
    expect(ub, 'ub-1216 is a candidate').toBeTruthy();
    expect(boiler, 'gas-boiler-16 is a candidate').toBeTruthy();
    const result = toggleOption(ctx, [], ub.id);
    expect(result.rejected).toBe(false);
    expect(result.next).toContain(boiler!.id);
  });

  it('saves a Wing office plan without interior doors, and still requires them for the hotel spec', async () => {
    const { store, model, bundle } = await customerBundle('wing-01');
    expect(customerCategorySelectable('wing-01', 'office', 'interior-door')).toBe(false);
    const interiorDoor = bundle.categories.find((row) => row.code === 'interior-door')!;
    expect(interiorDoor.is_required).toBe(true);

    const officeIds = buildEstimateSpecSelection(bundle, model, 'office');
    const officeOptions = officeIds.map((id) => bundle.options.find((row) => row.id === id)!);
    expect(officeOptions.some((row) => row.category_id === interiorDoor.id)).toBe(false);
    const saved = await store.saveConfiguration(actor, {
      id: null,
      base_model_id: model.id,
      name: '事務所用（室内建具なし）',
      option_ids: officeIds,
      preview_image_url: null,
      notes: null,
      finish_level: 'full',
      spec_code: 'office',
      variant_choice_ids: [],
    });
    expect(saved.status).toBe('draft');

    const hotelIds = buildEstimateSpecSelection(bundle, model, 'hotel');
    const withoutDoor = hotelIds.filter((id) => bundle.options.find((row) => row.id === id)?.category_id !== interiorDoor.id);
    expect(withoutDoor.length).toBeLessThan(hotelIds.length);
    await expect(
      store.saveConfiguration(actor, {
        id: null,
        base_model_id: model.id,
        name: 'ホテル仕様（室内建具なし）',
        option_ids: withoutDoor,
        preview_image_url: null,
        notes: null,
        finish_level: 'full',
        spec_code: 'hotel',
        variant_choice_ids: [],
      })
    ).rejects.toThrow(interiorDoor.name);
  });

  it('rejects a product from a category that is × for the model/spec', async () => {
    const { store, model, bundle } = await customerBundle('wing-01');
    const officeIds = buildEstimateSpecSelection(bundle, model, 'office');
    const door = (await store.listOptions()).find((row) => row.code === 'door-standard')!;
    await expect(
      store.saveConfiguration(actor, {
        id: null,
        base_model_id: model.id,
        name: '事務所用（室内建具あり）',
        option_ids: [...officeIds, door.id],
        preview_image_url: null,
        notes: null,
        finish_level: 'full',
        spec_code: 'office',
        variant_choice_ids: [],
      })
    ).rejects.toThrow('選択できない商品');
  });
});
