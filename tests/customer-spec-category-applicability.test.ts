import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyCustomerCategoryApplicability,
  customerCategorySelectable,
  CUSTOMER_SPEC_DENY_ALL,
  effectiveCustomerSpecCodes,
} from '@/lib/domain/customer-category-applicability';
import {
  buildEstimateSpecSelection,
  optionAvailableForSpec,
  ruleContextForSpec,
} from '@/lib/domain/estimate-template';
import type { RuleContext } from '@/lib/domain/rules';
import type { BaseModel, CatalogBundle, OptionCategory, ProductOption } from '@/lib/domain/types';

const category = (patch: Partial<OptionCategory> & Pick<OptionCategory, 'id' | 'code' | 'name'>): OptionCategory =>
  ({
    description: null,
    selection_mode: 'single',
    is_required: false,
    sort_order: 1,
    status: 'published',
    group_code: patch.code,
    group_name: patch.name,
    group_sort: 1,
    finish_level: 'full',
    customer_visible: true,
    ...patch,
  }) as OptionCategory;

const option = (
  patch: Partial<ProductOption> & Pick<ProductOption, 'id' | 'code' | 'name' | 'category_id'>
): ProductOption =>
  ({
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

const businessCategories = [
  'roof', 'exterior-wall', 'floor', 'wall-ceiling', 'carpentry',
  'entrance-door', 'sash', 'ub', 'kitchen', 'washbasin', 'toilet', 'interior-door',
] as const;

const rows: Array<[string, string, readonly string[]]> = [
  ['wing-01', 'hotel', ['roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash','ub','washbasin','toilet','interior-door']],
  ['wing-01', 'residence', ['roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash','ub','kitchen','washbasin','toilet','interior-door']],
  ['wing-01', 'room', ['roof','exterior-wall','floor','wall-ceiling','carpentry','interior-door']],
  ['wing-01', 'office', ['roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash','ub','kitchen','toilet']],
  ['box', 'hotel', ['roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash','ub','washbasin','toilet','interior-door']],
  ['box', 'residence', ['roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash','ub','kitchen','washbasin','toilet','interior-door']],
  ['box', 'room', ['roof','exterior-wall','floor','wall-ceiling','carpentry','interior-door']],
  ['box', 'office', ['roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash','ub','kitchen','toilet']],
  ['box', 'water-kit', ['roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash','ub','kitchen','washbasin','toilet']],
  ['box', 'storage', ['roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash']],
  ['flat', 'office', ['roof','exterior-wall','floor','wall-ceiling','carpentry','entrance-door','sash']],
];

describe('confirmed classification-sheet category matrix', () => {
  it.each(rows)('%s / %s matches 選択 / ×', (modelSlug, specCode, selected) => {
    for (const code of businessCategories) {
      expect(customerCategorySelectable(modelSlug, specCode, code), code).toBe(selected.includes(code));
    }
    expect(customerCategorySelectable(modelSlug, specCode, 'service-door')).toBe(selected.includes('sash'));
  });

  it('keeps legacy BOX hotel-single as the residence-compatible combined row', () => {
    for (const code of businessCategories) {
      expect(customerCategorySelectable('box', 'hotel-single', code)).toBe(
        customerCategorySelectable('box', 'residence', code)
      );
    }
  });

  it('does not invent a classification-sheet row for base', () => {
    expect(customerCategorySelectable('wing-01', 'base', 'sash')).toBe(true);
    expect(customerCategorySelectable('flat', 'base', 'ub')).toBe(true);
  });

  it('fails closed for an unknown business spec while unrelated categories keep existing behavior', () => {
    expect(customerCategorySelectable('wing-01', 'future-spec', 'sash')).toBe(false);
    expect(customerCategorySelectable('future-model', 'office', 'toilet')).toBe(false);
    expect(customerCategorySelectable('future-model', 'future-spec', 'lighting')).toBe(true);
  });
});

function fixture(): RuleContext {
  const interiorDoor = category({ id: 'cat-interior-door', code: 'interior-door', name: '内部建具', is_required: true });
  const entranceDoor = category({ id: 'cat-entrance-door', code: 'entrance-door', name: '玄関ドア', finish_level: 'shell' });
  return {
    categories: [interiorDoor, entranceDoor],
    options: [
      option({ id: 'door-standard', code: 'door-standard', name: '内部建具 標準', category_id: interiorDoor.id, is_default: true, spec_codes: ['hotel','residence','room','hotel-single'] }),
      option({ id: 'entrance-standard', code: 'entrance-standard', name: '玄関ドア 標準', category_id: entranceDoor.id, spec_codes: ['base','hotel','residence','office','hotel-single','water-kit','storage'] }),
    ],
    dependencies: [],
    conflicts: [],
  };
}

describe('customer spec product eligibility', () => {
  it('keeps raw spec_codes semantics as universal-or-whitelist', () => {
    expect(optionAvailableForSpec(option({ id:'u', code:'u', name:'u', category_id:'cat', spec_codes:[] }), 'office')).toBe(true);
    expect(optionAvailableForSpec(option({ id:'h', code:'h', name:'h', category_id:'cat', spec_codes:['hotel'] }), 'office')).toBe(false);
  });

  it('intersects product suitability with category applicability without persisting the derived values', () => {
    expect(effectiveCustomerSpecCodes('wing-01', 'kitchen', [])).toEqual(['base','residence','office']);
    expect(effectiveCustomerSpecCodes('wing-01', 'kitchen', ['hotel','residence'])).toEqual(['residence']);
    expect(effectiveCustomerSpecCodes('flat', 'ub', [])).toEqual(['base']);
    expect(effectiveCustomerSpecCodes('flat', 'lighting', [])).toEqual([]);
    expect(effectiveCustomerSpecCodes('future-model', 'ub', ['office'])).toEqual([CUSTOMER_SPEC_DENY_ALL]);
  });

  it('applies model-specific category applicability before simulator rule evaluation', () => {
    const ub = category({ id:'cat-ub', code:'ub', name:'浴室' });
    const lighting = category({ id:'cat-lighting', code:'lighting', name:'照明' });
    const bundle = {
      model: { id:'flat-id', slug:'flat' }, categories:[ub, lighting],
      options:[
        option({ id:'ub-1', code:'ub-1', name:'UB', category_id:ub.id, spec_codes:[] }),
        option({ id:'light-1', code:'light-1', name:'照明', category_id:lighting.id, spec_codes:[] }),
      ],
      images:[], dependencies:[], conflicts:[], previewRules:[], hotspots:[], variantGroups:[], variantChoices:[], baseBreakdowns:[],
    } as unknown as CatalogBundle;
    const applied = applyCustomerCategoryApplicability(bundle);
    expect(applied.options.find((row) => row.code === 'ub-1')?.spec_codes).toEqual(['base']);
    expect(ruleContextForSpec(applied, 'office').options.map((row) => row.code)).toEqual(['light-1']);
  });

  it('does not re-add an ineligible preset product to a standard selection', () => {
    const model = {
      slug:'wing-01',
      presets:[{ code:'office', name:'事務所仕様', description:'', option_codes:['door-standard','entrance-standard'] }],
    } as Pick<BaseModel, 'slug' | 'presets'>;
    expect(buildEstimateSpecSelection(fixture(), model, 'office')).toEqual(['entrance-standard']);
  });
});

describe('corrective migration contract', () => {
  const migration = readFileSync('supabase/migrations/20261006183000_customer_spec_category_applicability_corrective.sql', 'utf8');
  const simulator = readFileSync('components/simulator/simulator-app.tsx', 'utf8');
  const equipment = readFileSync('components/simulator/equipment-board.tsx', 'utf8');
  const publicCatalog = readFileSync('lib/data/public-catalog.ts', 'utf8');

  it('moves only explicitly audited doors and does not depend on a product count or generated category id', () => {
    expect(migration).toContain("'door-glass', 'sash-lixil-prose-kamachi'");
    expect(migration).toContain("'sash-door-katteguchi'");
    expect(migration).toContain("'sash-door-katteguchi-koshi-panel'");
    expect(migration).toContain("'sash-door-katteguchi-zen-panel'");
    expect(migration).not.toContain('20000000-0000-4000-8000-000000000025');
    expect(migration).not.toMatch(/count\s*\(\s*\*\s*\)/i);
    expect(equipment).toContain("'service-door'");
  });

  it('keeps the classification matrix separate from raw product spec_codes', () => {
    expect(migration).not.toMatch(/update\s+public\.options[\s\S]{0,160}set\s+spec_codes\s*=/i);
    expect(migration).toContain('create or replace function public.customer_category_selectable');
    expect(migration).toContain('configuration_items_customer_category_guard');
    expect(migration).toContain('configurations_customer_category_guard');
    expect(migration).toContain('cardinality(v_option_spec_codes) > 0');
    expect(migration).toContain('deferrable initially deferred');
  });

  it('applies spec eligibility even when a Standard Estimate template is active', () => {
    expect(simulator).toContain('if (!readOnly) return activeSpecCtx.options;');
    expect(simulator).not.toContain('if (activeEstimateTemplate || !hasPreset) return bundle.options;');
    expect(simulator).toContain('validateSelection(activeSpecCtx, selected, finishLevel)');
    expect(simulator).toContain('toggleOption(activeSpecCtx, cur, oid)');
    expect(publicCatalog).toContain('applyCustomerCategoryApplicability');
    expect(publicCatalog).toContain('public-catalog-v4-customer-category-matrix');
  });

  it('filters baseline totals at calculation time without rewriting template baselines', () => {
    expect(migration).toContain('create or replace function public.estimate_baseline_master_section_total');
    expect(migration).toContain('public.customer_category_selectable(m.slug, t.spec_code, cat.code)');
    expect(migration).toContain('t.spec_code = any(o.spec_codes)');
    expect(migration).not.toMatch(/update\s+public\.estimate_templates\b/i);
    expect(migration).not.toContain('create or replace function public.replace_estimate_templates_with_baselines');
  });

  it('hardens internal functions and does not rewrite formal/historical records', () => {
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain('from public, anon, authenticated, service_role');
    expect(migration).not.toMatch(/^\s*begin;\s*$/im);
    expect(migration).not.toMatch(/^\s*commit;\s*$/im);
    expect(migration).not.toMatch(/update\s+public\.configurations\b/i);
    expect(migration).not.toMatch(/update\s+public\.quotes\b/i);
    expect(migration).not.toMatch(/update\s+public\.quote_items\b/i);
    expect(migration).not.toMatch(/update\s+public\.configuration_items\b/i);
  });
});
