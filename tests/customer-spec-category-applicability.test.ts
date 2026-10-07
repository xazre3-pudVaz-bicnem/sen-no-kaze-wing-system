import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyCustomerCategoryApplicability,
  customerCategorySelectable,
  CUSTOMER_CATEGORY_BUSINESS_ITEM,
  CUSTOMER_CATEGORY_MATRIX,
  CUSTOMER_SPEC_DENY_ALL,
  effectiveCustomerSpecCodes,
  productSpecCodesAllow,
  type CustomerBusinessItemCode,
} from '@/lib/domain/customer-category-applicability';
import {
  buildEstimateSpecSelection,
  optionAvailableForSpec,
  ruleContextForSpec,
} from '@/lib/domain/estimate-template';
import { computeStandardEstimatePricing } from '@/lib/domain/standard-estimate-pricing';
import type { RuleContext } from '@/lib/domain/rules';
import type {
  BaseModel,
  CatalogBundle,
  EstimateTemplateBundle,
  OptionCategory,
  ProductOption,
} from '@/lib/domain/types';

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

const controlledCategoryCodes = Object.keys(CUSTOMER_CATEGORY_BUSINESS_ITEM);

const matrixRows: Array<[string, string, readonly CustomerBusinessItemCode[]]> = [
  ['wing-01', 'hotel', ['roof-exterior','interior','entrance-door','sash','bath','washbasin','toilet','boiler','entrance-storage','interior-door','bed','furnishings','other']],
  ['wing-01', 'residence', ['roof-exterior','interior','entrance-door','sash','bath','kitchen','washbasin','toilet','boiler','entrance-storage','interior-door','bed','furnishings','other']],
  ['wing-01', 'room', ['roof-exterior','interior','interior-door','closet','bed','furnishings','other']],
  ['wing-01', 'office', ['roof-exterior','interior','entrance-door','sash','bath','kitchen','toilet','boiler','furnishings','other']],
  ['box', 'hotel', ['roof-exterior','interior','entrance-door','sash','bath','washbasin','toilet','boiler','entrance-storage','interior-door','bed','furnishings','other']],
  ['box', 'residence', ['roof-exterior','interior','entrance-door','sash','bath','kitchen','washbasin','toilet','boiler','entrance-storage','interior-door','bed','furnishings','other']],
  ['box', 'room', ['roof-exterior','interior','interior-door','closet','bed','furnishings','other']],
  ['box', 'office', ['roof-exterior','interior','entrance-door','sash','bath','kitchen','toilet','boiler','furnishings','other']],
  ['box', 'water-kit', ['roof-exterior','interior','entrance-door','sash','bath','kitchen','washbasin','toilet','boiler']],
  ['box', 'storage', ['roof-exterior','interior','entrance-door','sash']],
  ['flat', 'office', ['roof-exterior','interior','entrance-door','sash']],
];

describe('confirmed classification-sheet business-item matrix', () => {
  it.each(matrixRows)('%s / %s matches all 15 business columns', (modelSlug, specCode, selectedItems) => {
    for (const categoryCode of controlledCategoryCodes) {
      const businessItem = CUSTOMER_CATEGORY_BUSINESS_ITEM[categoryCode];
      expect(customerCategorySelectable(modelSlug, specCode, categoryCode), categoryCode).toBe(
        selectedItems.includes(businessItem)
      );
    }
  });

  it('maps the combined Excel columns and service door explicitly', () => {
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM.roof).toBe('roof-exterior');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM['exterior-wall']).toBe('roof-exterior');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM.floor).toBe('interior');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM['wall-ceiling']).toBe('interior');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM.carpentry).toBe('interior');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM.sash).toBe('sash');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM['service-door']).toBe('sash');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM['entrance-storage']).toBe('entrance-storage');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM.closet).toBe('closet');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM.bed).toBe('bed');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM.furniture).toBe('furnishings');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM.appliances).toBe('furnishings');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM['office-supplies']).toBe('furnishings');
    for (const code of ['aircon','lighting','smartlock','exterior-parts']) {
      expect(CUSTOMER_CATEGORY_BUSINESS_ITEM[code]).toBe('other');
    }
  });

  it('has exactly the 15 confirmed business items with boiler as its own item', () => {
    expect([...new Set(Object.values(CUSTOMER_CATEGORY_BUSINESS_ITEM))].sort()).toEqual(
      [
        'roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'kitchen', 'washbasin', 'toilet',
        'boiler', 'entrance-storage', 'interior-door', 'closet', 'bed', 'furnishings', 'other',
      ].sort()
    );
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM.boiler).toBe('boiler');
    expect(CUSTOMER_CATEGORY_BUSINESS_ITEM.boiler).not.toBe('other');
  });

  it('gives boiler the same selectability as UB/SWR on every model/spec row, not the other-items column', () => {
    for (const [modelSlug, rows] of Object.entries(CUSTOMER_CATEGORY_MATRIX)) {
      for (const specCode of Object.keys(rows)) {
        expect(customerCategorySelectable(modelSlug, specCode, 'boiler'), `${modelSlug}/${specCode}`).toBe(
          customerCategorySelectable(modelSlug, specCode, 'ub')
        );
      }
    }
    // UB/SWR が × の居室では給湯器も ×（「その他」は選択のまま）
    expect(customerCategorySelectable('wing-01', 'room', 'boiler')).toBe(false);
    expect(customerCategorySelectable('wing-01', 'room', 'aircon')).toBe(true);
    // UB/SWR が選択の BOX 水回りキットでは給湯器も選択（「その他」は × のまま）
    expect(customerCategorySelectable('box', 'water-kit', 'boiler')).toBe(true);
    expect(customerCategorySelectable('box', 'water-kit', 'aircon')).toBe(false);
  });

  it('keeps legacy BOX hotel-single as the residence-compatible business row', () => {
    for (const categoryCode of controlledCategoryCodes) {
      expect(customerCategorySelectable('box', 'hotel-single', categoryCode)).toBe(
        customerCategorySelectable('box', 'residence', categoryCode)
      );
    }
  });

  it('keeps base as an explicit compatibility row instead of inventing an Excel row', () => {
    expect(customerCategorySelectable('wing-01', 'base', 'roof')).toBe(true);
    expect(customerCategorySelectable('wing-01', 'base', 'sash')).toBe(true);
    expect(customerCategorySelectable('wing-01', 'base', 'ub')).toBe(false);
    expect(customerCategorySelectable('flat', 'base', 'lighting')).toBe(false);
  });

  it('fails closed for controlled categories on unknown model/spec but preserves unrelated categories', () => {
    expect(customerCategorySelectable('wing-01', 'future-spec', 'sash')).toBe(false);
    expect(customerCategorySelectable('future-model', 'office', 'toilet')).toBe(false);
    expect(customerCategorySelectable('future-model', 'future-spec', 'sitework')).toBe(true);
  });
});

function fixture(): RuleContext {
  const interiorDoor = category({ id: 'cat-interior-door', code: 'interior-door', name: '内部建具', is_required: true });
  const entranceDoor = category({ id: 'cat-entrance-door', code: 'entrance-door', name: '玄関ドア', finish_level: 'shell' });
  return {
    categories: [interiorDoor, entranceDoor],
    options: [
      option({ id: 'door-standard', code: 'door-standard', name: '内部建具 標準', category_id: interiorDoor.id, is_default: true, spec_codes: ['hotel','residence','room'] }),
      option({ id: 'entrance-standard', code: 'entrance-standard', name: '玄関ドア 標準', category_id: entranceDoor.id, spec_codes: ['base','hotel','residence','office','water-kit','storage'] }),
    ],
    dependencies: [],
    conflicts: [],
  };
}

describe('customer spec product eligibility', () => {
  it('keeps raw spec_codes as universal-or-whitelist and limits hotel-single alias to BOX', () => {
    const universal = option({ id:'u', code:'u', name:'u', category_id:'cat', spec_codes:[] });
    const residenceOnly = option({ id:'r', code:'r', name:'r', category_id:'cat', spec_codes:['residence'] });
    expect(optionAvailableForSpec(universal, 'office', 'wing-01')).toBe(true);
    expect(optionAvailableForSpec(residenceOnly, 'hotel-single', 'box')).toBe(true);
    expect(optionAvailableForSpec(residenceOnly, 'hotel-single', 'wing-01')).toBe(false);
    expect(productSpecCodesAllow(['hotel'], 'hotel-single', 'box')).toBe(false);
  });

  it('intersects individual product suitability with category availability without inventing product fit', () => {
    expect(effectiveCustomerSpecCodes('wing-01', 'kitchen', [])).toEqual(['residence','office']);
    expect(effectiveCustomerSpecCodes('wing-01', 'kitchen', ['hotel','residence'])).toEqual(['residence']);
    expect(effectiveCustomerSpecCodes('flat', 'ub', [])).toEqual([CUSTOMER_SPEC_DENY_ALL]);
    expect(effectiveCustomerSpecCodes('flat', 'lighting', [])).toEqual([CUSTOMER_SPEC_DENY_ALL]);
    expect(effectiveCustomerSpecCodes('future-model', 'ub', ['office'])).toEqual([CUSTOMER_SPEC_DENY_ALL]);
    expect(effectiveCustomerSpecCodes('wing-01', 'sitework', [])).toEqual([]);
  });

  it('keeps room bed category selectable even when the current folding-bed product is not room-compatible', () => {
    expect(customerCategorySelectable('wing-01', 'room', 'bed')).toBe(true);
    expect(effectiveCustomerSpecCodes('wing-01', 'bed', ['hotel','residence'])).toEqual(['hotel','residence']);
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
    expect(applied.options.find((row) => row.code === 'ub-1')?.spec_codes).toEqual([CUSTOMER_SPEC_DENY_ALL]);
    expect(applied.options.find((row) => row.code === 'light-1')?.spec_codes).toEqual([CUSTOMER_SPEC_DENY_ALL]);
    expect(ruleContextForSpec(applied, 'office', 'flat').options).toEqual([]);
  });

  it('does not re-add an ineligible preset product to a standard selection', () => {
    const model = {
      slug:'wing-01',
      presets:[{ code:'office', name:'事務所仕様', description:'', option_codes:['door-standard','entrance-standard'] }],
    } as Pick<BaseModel, 'slug' | 'presets'>;
    expect(buildEstimateSpecSelection(fixture(), model, 'office')).toEqual(['entrance-standard']);
  });
});

function boxHotelSinglePricingFixture() {
  const wall = category({ id:'cat-wall', code:'wall-ceiling', name:'壁・天井' });
  const carpentry = category({ id:'cat-carpentry', code:'carpentry', name:'造作工事' });
  const ub = category({ id:'cat-ub', code:'ub', name:'浴室', finish_level:'equipment' });
  const kitchen = category({ id:'cat-kitchen', code:'kitchen', name:'キッチン', finish_level:'equipment' });
  const bed = category({ id:'cat-bed', code:'bed', name:'ベッド', selection_mode:'multi', finish_level:'equipment' });
  const options = [
    option({ id:'interior-standard-box', code:'interior-standard-box', name:'内装工事一式（標準）', category_id:wall.id, price:321654, spec_codes:[] }),
    option({ id:'carpentry-box', code:'carpentry-box', name:'室内造作工事', category_id:carpentry.id, price:79750, spec_codes:[] }),
    option({ id:'shower-unit-1116', code:'shower-unit-1116', name:'シャワーユニット 1116', category_id:ub.id, price:810000, spec_codes:['hotel','residence'] }),
    option({ id:'mini-kitchen', code:'mini-kitchen', name:'ミニキッチン', category_id:kitchen.id, price:187500, spec_codes:['residence','office'] }),
    option({ id:'folding-bed', code:'folding-bed', name:'折り畳み式ベッド', category_id:bed.id, price:120000, spec_codes:['hotel','residence'] }),
  ];
  const model = {
    id:'box-id', slug:'box', name:'BOX', base_price:0, expense_rate:0, presets:[],
  } as unknown as BaseModel;
  const bundle = {
    model,
    categories:[wall, carpentry, ub, kitchen, bed],
    options,
    images:[], dependencies:[], conflicts:[], previewRules:[], hotspots:[], variantGroups:[], variantChoices:[], baseBreakdowns:[],
  } as unknown as CatalogBundle;
  const baselineIds = options.map((row) => row.id);
  const template = {
    template: {
      id:'template-box-hotel-single', base_model_id:model.id, spec_code:'hotel-single', name:'BOX（ホテル単身者）',
      source_file_name:'classification.xlsx', source_sheet_name:'BOX（ホテル単身者）', source_sha256:'test',
      baseline_option_ids:baselineIds, tax_rate:0.1, subtotal_raw:3466000, adjustment:0,
      subtotal:3466000, tax:346600, total:3812600, imported_at:'2026-10-06', updated_at:'2026-10-06',
    },
    sections:[
      { id:'sec-base', template_id:'template-box-hotel-single', code:'base', label:'本体', line_subtotal:1947096, expense_label:null, expense_rate:0, expense_amount:0, total:1947096, sort_order:1 },
      { id:'sec-interior', template_id:'template-box-hotel-single', code:'interior_exterior', label:'内外装', line_subtotal:401404, expense_label:null, expense_rate:0, expense_amount:0, total:401404, sort_order:2 },
      { id:'sec-option', template_id:'template-box-hotel-single', code:'option', label:'オプション', line_subtotal:1117500, expense_label:null, expense_rate:0, expense_amount:0, total:1117500, sort_order:3 },
      { id:'sec-site', template_id:'template-box-hotel-single', code:'sitework', label:'別途工事', line_subtotal:0, expense_label:null, expense_rate:0, expense_amount:0, total:0, sort_order:4 },
    ],
    lines:[], base_breakdown_items:[], baseline_option_ids:baselineIds,
  } as unknown as EstimateTemplateBundle;
  return { bundle, model, options, baselineIds, template };
}

describe('BOX hotel-single Standard Estimate compatibility', () => {
  it('keeps all five curated baseline products and the audited 1,518,904 yen master baseline', () => {
    const { bundle, model, options, baselineIds } = boxHotelSinglePricingFixture();
    const selection = buildEstimateSpecSelection(
      { options, categories:bundle.categories, dependencies:[], conflicts:[] },
      model,
      'hotel-single',
      baselineIds
    );
    expect(selection.sort()).toEqual([...baselineIds].sort());
    expect(selection.reduce((sum, id) => sum + (options.find((row) => row.id === id)?.price ?? 0), 0)).toBe(1518904);
  });

  it('keeps the Excel standard total 3,812,600 yen unchanged at standard state', () => {
    const { bundle, baselineIds, template } = boxHotelSinglePricingFixture();
    const result = computeStandardEstimatePricing(bundle, template, baselineIds, [], [], 'full');
    expect(result.has_changes).toBe(false);
    expect(result.pricing.total).toBe(3812600);
  });

  it('calculates product-change delta from the complete curated baseline', () => {
    const { bundle, baselineIds, template } = boxHotelSinglePricingFixture();
    const withoutMiniKitchen = baselineIds.filter((id) => id !== 'mini-kitchen');
    const result = computeStandardEstimatePricing(bundle, template, withoutMiniKitchen, [], [], 'full');
    expect(result.has_changes).toBe(true);
    expect(result.sections.find((section) => section.code === 'option')?.delta_line).toBe(-187500);
    expect(result.pricing.total).toBe(3605800);
  });
});

describe('corrective migration and simulator contract', () => {
  const migration = readFileSync('supabase/migrations/20261006183000_customer_spec_category_applicability_corrective.sql', 'utf8');
  const simulator = readFileSync('components/simulator/simulator-app.tsx', 'utf8');
  const equipment = readFileSync('components/simulator/equipment-board.tsx', 'utf8');
  const publicCatalog = readFileSync('lib/data/public-catalog.ts', 'utf8');

  it('creates dedicated mixed-furniture business categories and moves only audited products', () => {
    for (const code of ['service-door','entrance-storage','closet','bed']) {
      expect(migration).toContain(`'${code}'`);
    }
    expect(migration).toContain("'door-glass', 'sash-lixil-prose-kamachi'");
    expect(migration).toContain("'shoebox-daiken-ieria-low800'");
    expect(migration).toContain("where code = 'hanger-pipe'");
    expect(migration).toContain("where code = 'folding-bed'");
    expect(migration).not.toContain('20000000-0000-4000-8000-000000000025');
    expect(migration).not.toMatch(/count\s*\(\s*\*\s*\)/i);
    expect(equipment).toContain("'entrance-storage'");
    expect(equipment).toContain("'closet'");
    expect(equipment).toContain("'bed'");
  });

  it('keeps the SQL matrix and business-item mapping identical to the TS helper', () => {
    const sqlRows = [...migration.matchAll(/^\s+\('([a-z0-9-]+)', '([a-z-]+)', array\[([^\]]*)\]::text\[\]\),?$/gm)].map(
      (m) => [m[1], m[2], m[3].split(',').map((item) => item.trim().replace(/'/g, ''))] as const
    );
    expect(sqlRows).toHaveLength(15);
    for (const [modelSlug, specCode, items] of sqlRows) {
      expect([...items].sort(), `${modelSlug}/${specCode}`).toEqual([...CUSTOMER_CATEGORY_MATRIX[modelSlug][specCode]].sort());
    }
    const sqlMapping = Object.fromEntries(
      [...migration.matchAll(/^\s+when '([a-z-]+)' then '([a-z-]+)'$/gm)].map((m) => [m[1], m[2]])
    );
    expect(sqlMapping).toEqual({ ...CUSTOMER_CATEGORY_BUSINESS_ITEM });
    expect(migration).toContain("when 'boiler' then 'boiler'");
    expect(migration).not.toContain("when 'boiler' then 'other'");
    expect(migration).toContain('POSTCONDITION: boiler selectability must equal UB/SWR on every model/spec row');
  });

  it('uses the same hotel-single compatibility rule in TS/SQL and keeps the existing save RPC literal check compatible', () => {
    expect(migration).toContain('create or replace function public.customer_product_spec_selectable');
    expect(migration).toContain("set spec_codes = array_append(spec_codes, 'hotel-single')");
    expect(migration).toContain("where 'residence' = any(spec_codes)");
    expect(migration).toContain('1518904');
    expect(migration).toContain('public.customer_product_spec_selectable(m.slug, t.spec_code');
  });

  it('rejects NULL spec on editable drafts while preserving historical non-draft read compatibility', () => {
    expect(migration).toContain("v_status = 'draft' and v_spec_code is null");
    expect(migration).toContain("new.status = 'draft' and new.spec_code is null");
    expect(migration).toContain('after insert or update on public.configurations');
    expect(migration).toContain('deferrable initially deferred');
    expect(migration).toContain('when p_spec_code is null then true');
  });

  it('separates category visibility from product candidate availability in the simulator', () => {
    expect(simulator).toContain('customerBusinessItemForCategory(c.code)');
    expect(simulator).toContain('customerCategorySelectable(model.slug, specCode, c.code)');
    expect(simulator).toContain('if (!readOnly) return activeSpecCtx.options;');
    expect(simulator).not.toContain('if (activeEstimateTemplate || !hasPreset) return bundle.options;');
    expect(equipment).toContain("const shown = categories.filter((c) => c.code !== 'sitework');");
    expect(publicCatalog).toContain('applyCustomerCategoryApplicability');
    expect(publicCatalog).toContain('public-catalog-v4-customer-category-matrix');
  });

  it('filters baseline totals at calculation time without rewriting template or formal historical records', () => {
    expect(migration).toContain('create or replace function public.estimate_baseline_master_section_total');
    expect(migration).toContain('public.customer_category_selectable(m.slug, t.spec_code, cat.code)');
    expect(migration).not.toMatch(/update\s+public\.estimate_templates\b/i);
    expect(migration).not.toMatch(/update\s+public\.configurations\b/i);
    expect(migration).not.toMatch(/update\s+public\.quotes\b/i);
    expect(migration).not.toMatch(/update\s+public\.quote_items\b/i);
    expect(migration).not.toMatch(/update\s+public\.configuration_items\b/i);
  });

  it('hardens internal helpers and leaves transaction ownership to the migration runner', () => {
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toContain('from public, anon, authenticated, service_role');
    expect(migration).not.toMatch(/^\s*begin;\s*$/im);
    expect(migration).not.toMatch(/^\s*commit;\s*$/im);
  });
});