import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCustomerCategoryMatrix, customerCategorySelectable } from '@/lib/domain/customer-category-applicability';
import { MATRIX_CATEGORY_ITEM_SEED, buildSeedMatrix } from '@/lib/seed/matrix';

// 本体分類表の正本は DB の本体仕様マトリクス（PR A）。テストは確定 seed から同じ可否表を組み立てて使う
const SEED_MODELS = [
  { id: 'model-wing', slug: 'wing-01' },
  { id: 'model-box', slug: 'box' },
  { id: 'model-flat', slug: 'flat' },
];
const SEED_CATEGORIES = MATRIX_CATEGORY_ITEM_SEED.map(([code]) => ({ id: `seed-cat-${code}`, code }));
const SEED_MATRIX = buildCustomerCategoryMatrix(buildSeedMatrix(SEED_MODELS, SEED_CATEGORIES), SEED_CATEGORIES, SEED_MODELS)!;

const hardening = readFileSync(
  'supabase/migrations/20261013121000_customer_spec_category_guard_hardening.sql',
  'utf8'
);
const simulator = readFileSync('components/simulator/simulator-app.tsx', 'utf8');

describe('customer spec category guard hardening', () => {
  it('keeps the BOX hotel-single technical alias after normal product saves', () => {
    expect(hardening).toContain('create or replace function public.ensure_hotel_single_spec_alias()');
    expect(hardening).toContain('before insert or update of spec_codes on public.options');
    expect(hardening).toContain("'residence' = any(new.spec_codes)");
    expect(hardening).toContain("array_append(new.spec_codes, 'hotel-single')");
    expect(hardening).toContain('options_hotel_single_spec_alias_guard');
  });

  it('locks both old and new Configuration parents in a deterministic order', () => {
    expect(hardening).toContain('old.configuration_id, new.configuration_id');
    expect(hardening).toContain('select distinct parent_id');
    expect(hardening).toContain('order by cfg.id');
    expect(hardening).toContain('for update of cfg');
    expect(hardening).toContain("v_parent.status <> 'draft'");
    expect(hardening).toContain('v_parent_count <> cardinality(v_parent_ids)');
  });

  it('keeps normal Draft Configuration deletion compatible with FK ON DELETE CASCADE', () => {
    expect(hardening).toContain("if tg_op = 'DELETE' and v_parent_count = 0 then");
    expect(hardening).toContain('FK ON DELETE CASCADE');
    expect(hardening).toContain('return old;');
  });

  it('keeps non-draft Configuration history read-only at ACL and RLS layers', () => {
    expect(hardening).toMatch(/revoke insert, update, truncate on public\.configurations from authenticated;/);
    expect(hardening).toMatch(/revoke insert, update, delete, truncate on public\.configuration_items from anon, authenticated;/);
    expect(hardening).toMatch(/create policy configurations_update[\s\S]*status = 'draft'/);
    expect(hardening).toMatch(/create policy configurations_delete[\s\S]*status = 'draft'/);
    expect(hardening).toMatch(/create policy configuration_items_write[\s\S]*c\.status = 'draft'/);
  });

  it('fails fast against the actual BOX hotel-single Standard Estimate when it exists', () => {
    for (const code of [
      'interior-standard-box',
      'carpentry-box',
      'shower-unit-1116',
      'mini-kitchen',
      'folding-bed',
    ]) {
      expect(hardening).toContain(`'${code}'`);
    }
    expect(hardening).toContain('baseline_option_ids do not match the audited five products');
    expect(hardening).toContain('3812600');
    expect(hardening).toContain('1518904');
    expect(hardening).toContain('estimate_baseline_master_section_total');
  });

  it('shows saved historical categories in read-only mode without reopening them for editing', () => {
    expect(customerCategorySelectable(SEED_MATRIX, 'wing-01', 'office', 'interior-door')).toBe(false);
    expect(simulator).toContain('const historicalSelectedCategoryIds = useMemo');
    expect(simulator).toContain('(readOnly && historicalSelectedCategoryIds.has(c.id))');
    expect(simulator).toContain('if (readOnly) {');
    expect(simulator).toContain('見積依頼済みの仕様は編集できません。マイページから複製してください。');
  });

  it('does not regress the current exterior-wall catalog while adding history compatibility', () => {
    // 今の外壁の商品の一覧は exterior-wall.ts に 1 つにまとめ、シミュレーターと /plans の入口が使う（v2.5 PR-C1）
    expect(readFileSync('lib/domain/exterior-wall.ts', 'utf8')).toContain("'exterior-nichiha-m-flat-premium18'");
    expect(simulator).toContain('const currentExteriorCodes = CURRENT_EXTERIOR_CODES;');
  });
});
