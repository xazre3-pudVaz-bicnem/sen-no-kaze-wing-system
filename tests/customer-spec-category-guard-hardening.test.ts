import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { customerCategorySelectable } from '@/lib/domain/customer-category-applicability';

const hardening = readFileSync(
  'supabase/migrations/20261006220000_customer_spec_category_guard_hardening.sql',
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
    expect(customerCategorySelectable('wing-01', 'office', 'interior-door')).toBe(false);
    expect(simulator).toContain('const historicalSelectedCategoryIds = useMemo');
    expect(simulator).toContain('(readOnly && historicalSelectedCategoryIds.has(c.id))');
    expect(simulator).toContain('if (readOnly) {');
    expect(simulator).toContain('見積依頼済みの仕様は編集できません。マイページから複製してください。');
  });

  it('does not regress the current exterior-wall catalog while adding history compatibility', () => {
    expect(simulator).toContain("'exterior-nichiha-m-flat-premium18'");
  });
});
