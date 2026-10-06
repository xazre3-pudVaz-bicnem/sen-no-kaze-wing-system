import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildEstimateSpecSelection,
  optionAvailableForSpec,
  ruleContextForSpec,
} from '@/lib/domain/estimate-template';
import type { RuleContext } from '@/lib/domain/rules';
import type { BaseModel, OptionCategory, ProductOption } from '@/lib/domain/types';

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

function fixture(): RuleContext {
  const interiorDoor = category({
    id: 'cat-interior-door',
    code: 'interior-door',
    name: '内部建具',
    is_required: true,
  });
  const entranceDoor = category({
    id: 'cat-entrance-door',
    code: 'entrance-door',
    name: '玄関ドア',
    finish_level: 'shell',
  });

  return {
    categories: [interiorDoor, entranceDoor],
    options: [
      option({
        id: 'door-standard',
        code: 'door-standard',
        name: '内部建具 標準',
        category_id: interiorDoor.id,
        is_default: true,
        spec_codes: ['hotel', 'residence', 'room', 'hotel-single'],
      }),
      option({
        id: 'entrance-standard',
        code: 'entrance-standard',
        name: '玄関ドア 標準',
        category_id: entranceDoor.id,
        spec_codes: ['base', 'hotel', 'residence', 'office', 'hotel-single', 'water-kit', 'storage'],
      }),
    ],
    dependencies: [],
    conflicts: [],
  };
}

describe('customer spec applicability', () => {
  it('treats empty spec_codes as universal and non-empty values as a whitelist', () => {
    const universal = option({ id: 'u', code: 'u', name: 'u', category_id: 'cat', spec_codes: [] });
    const hotelOnly = option({ id: 'h', code: 'h', name: 'h', category_id: 'cat', spec_codes: ['hotel'] });

    expect(optionAvailableForSpec(universal, 'office')).toBe(true);
    expect(optionAvailableForSpec(hotelOnly, 'hotel')).toBe(true);
    expect(optionAvailableForSpec(hotelOnly, 'office')).toBe(false);
  });

  it('removes × products from the rule context before required/default validation', () => {
    const ctx = fixture();
    const office = ruleContextForSpec(ctx, 'office');
    const room = ruleContextForSpec(ctx, 'room');

    expect(office.options.map((row) => row.code)).toEqual(['entrance-standard']);
    expect(room.options.map((row) => row.code)).toEqual(['door-standard']);
  });

  it('does not re-add an ineligible preset product to a standard selection', () => {
    const ctx = fixture();
    const model = {
      slug: 'wing-01',
      presets: [
        {
          code: 'office',
          name: '事務所仕様',
          description: '',
          option_codes: ['door-standard', 'entrance-standard'],
        },
      ],
    } as Pick<BaseModel, 'slug' | 'presets'>;

    expect(buildEstimateSpecSelection(ctx, model, 'office')).toEqual(['entrance-standard']);
  });
});

describe('corrective migration contract', () => {
  const migration = readFileSync(
    'supabase/migrations/20261006183000_customer_spec_category_applicability_corrective.sql',
    'utf8'
  );
  const simulator = readFileSync('components/simulator/simulator-app.tsx', 'utf8');
  const equipment = readFileSync('components/simulator/equipment-board.tsx', 'utf8');

  it('creates the service-door category and moves only the explicitly audited door products', () => {
    expect(migration).toContain("'service-door'");
    expect(migration).toContain("'door-glass', 'sash-lixil-prose-kamachi'");
    expect(migration).toContain("'sash-door-katteguchi'");
    expect(migration).toContain("'sash-door-katteguchi-koshi-panel'");
    expect(migration).toContain("'sash-door-katteguchi-zen-panel'");
    expect(equipment).toContain("'service-door'");
  });

  it('makes customer_visible a global gate and applies spec eligibility even with an estimate template', () => {
    expect(migration).toContain('options.base_model_id / options.spec_codes');
    expect(simulator).toContain('if (!readOnly) return activeSpecCtx.options;');
    expect(simulator).not.toContain('if (activeEstimateTemplate || !hasPreset) return bundle.options;');
    expect(simulator).toContain('validateSelection(activeSpecCtx, selected, finishLevel)');
    expect(simulator).toContain('toggleOption(activeSpecCtx, cur, oid)');
  });

  it('filters both stored and future standard-estimate baselines with the same model/spec eligibility', () => {
    expect(migration).toContain('update public.estimate_templates t');
    expect(migration).toContain('create or replace function public.replace_estimate_templates_with_baselines');
    expect(migration).toContain('create or replace function public.estimate_baseline_master_section_total');
    expect(migration).toContain('o.base_model_id is null or o.base_model_id = et.base_model_id');
    expect(migration).toContain('et.spec_code = any(o.spec_codes)');
    expect(migration).toContain('o.base_model_id is null or o.base_model_id = t.base_model_id');
    expect(migration).toContain('t.spec_code = any(o.spec_codes)');
  });

  it('does not rewrite configuration, quote, revision, or snapshot data', () => {
    expect(migration).not.toMatch(/update\s+public\.configurations\b/i);
    expect(migration).not.toMatch(/update\s+public\.quotes\b/i);
    expect(migration).not.toMatch(/update\s+public\.quote_items\b/i);
    expect(migration).not.toMatch(/update\s+public\.configuration_items\b/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.(quotes|configurations|configuration_items)\b/i);
  });
});
