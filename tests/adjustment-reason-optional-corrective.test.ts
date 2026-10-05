import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { manualQuoteWorkbenchSchema, quoteDraftSaveSchema } from '@/lib/validation';

const root = process.cwd();
const source = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260929124500_unified_manual_quote_authoring.sql'),
  'utf8'
);
const corrective = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261005050213_adjustment_reason_optional_corrective.sql'),
  'utf8'
).replace(/\r\n/g, '\n');
const foundation = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260928130000_quote_draft_revision_foundation.sql'),
  'utf8'
);
const financialUi = fs.readFileSync(path.join(root, 'components/admin/quote-authoring-ui.tsx'), 'utf8');
const draftEditor = fs.readFileSync(path.join(root, 'components/admin/quote-draft-editor.tsx'), 'utf8');
const newCaseEditor = fs.readFileSync(path.join(root, 'components/admin/manual-quote-workbench.tsx'), 'utf8');

const manualInput = {
  customer_name: '山田太郎',
  customer_company: '',
  site_address: '',
  base_model_id: '11111111-1111-4111-8111-111111111111',
  spec_code: 'hotel',
  finish_level: 'full',
  memo: '',
  case_name: '',
  base_master_revision_id: null,
  items: [],
  adjustment_reason: null,
};
const draftInput = {
  draft_id: '22222222-2222-4222-8222-222222222222',
  expected_lock_version: 0,
  base_master_revision_id: null,
  items: [],
  adjustment_reason: null,
  dealer_note: null,
  notes: null,
};

describe.each([
  ['new case', manualQuoteWorkbenchSchema, manualInput],
  ['saved Draft and Revision Draft', quoteDraftSaveSchema, draftInput],
])('%s adjustment reason validation', (_name, schema, input) => {
  it.each([null, '', '   '])('normalizes an empty reason to null at zero adjustment: %s', (reason) => {
    const result = schema.safeParse({ ...input, adjustment: 0, adjustment_reason: reason });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.adjustment_reason).toBeNull();
  });

  it.each([-1, 1])('accepts a nonzero adjustment without a reason: %i', (adjustment) => {
    const result = schema.safeParse({ ...input, adjustment });
    expect(result.success).toBe(true);
  });

  it.each([-1, 1])('normalizes whitespace with nonzero adjustment: %i', (adjustment) => {
    const result = schema.safeParse({ ...input, adjustment, adjustment_reason: '   ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.adjustment_reason).toBeNull();
  });

  it.each([-1, 1])('preserves a supplied reason with nonzero adjustment: %i', (adjustment) => {
    const result = schema.safeParse({ ...input, adjustment, adjustment_reason: '顧客合意' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.adjustment_reason).toBe('顧客合意');
  });

  it('retains the 500-character limit after trimming', () => {
    expect(schema.safeParse({ ...input, adjustment: 1, adjustment_reason: ` ${'あ'.repeat(500)} ` }).success).toBe(true);
    expect(schema.safeParse({ ...input, adjustment: 1, adjustment_reason: 'あ'.repeat(501) }).success).toBe(false);
  });

  it('retains the adjustment bounds', () => {
    expect(schema.safeParse({ ...input, adjustment: -2_000_000_001 }).success).toBe(false);
    expect(schema.safeParse({ ...input, adjustment: 2_000_000_001 }).success).toBe(false);
  });
});

function saveDefinition(sql: string) {
  sql = sql.replace(/\r\n/g, '\n');
  const start = sql.indexOf('create or replace function public.save_quote_draft(');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('alter function public.save_quote_draft(', start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end).trim();
}

describe('adjustment-reason corrective migration', () => {
  it('removes only the old reason-required branch from the current RPC definition', () => {
    const requiredBranch =
      "  if v_adjustment <> 0 and v_reason is null then\n" +
      "    raise exception 'VALIDATION: 調整額を設定する場合は理由を入力してください'\n" +
      "      using errcode = 'P0001';\n" +
      '  end if;\n';
    const previous = saveDefinition(source);
    expect(previous.split(requiredBranch)).toHaveLength(2);
    expect(saveDefinition(corrective)).toBe(previous.replace(requiredBranch, ''));
  });

  it('fails closed unless exactly the known Draft reason CHECK is found', () => {
    expect(foundation).toContain("or nullif(btrim(coalesce(adjustment_reason, '')), '') is not null");
    expect(corrective).toContain("c.conrelid = 'public.quote_drafts'::regclass");
    expect(corrective).toContain("c.contype = 'c'");
    expect(corrective).toContain('pg_catalog.pg_get_constraintdef(c.oid)');
    expect(corrective).toContain('v_match_count <> 1 or v_related_count <> 1');
    expect(corrective).toContain("format('alter table public.quote_drafts drop constraint %I', v_name)");
    expect(corrective).not.toContain('standard_adjustment_reason');
    expect(corrective.slice(0, corrective.indexOf('create or replace function'))).not.toMatch(/update\s+public\./i);
  });

  it('keeps the amount CHECKs and RPC security contract', () => {
    for (const condition of [
      'subtotal = subtotal_raw + adjustment',
      'tax = floor(subtotal::numeric * tax_rate)::integer',
      'total = subtotal + tax',
    ]) expect(foundation).toContain(condition);
    expect(corrective).toContain('security definer\nset search_path = \'\'');
    expect(corrective).toContain(') owner to postgres;');
    expect(corrective).toContain(') from public, anon, authenticated, service_role;');
    expect(corrective).toContain(') to authenticated;');
    expect(corrective).toContain("v_reason text := nullif(btrim(coalesce(p_adjustment_reason, '')), '');");
    expect(corrective).toContain('v_amount_numeric := round(v_unit_price_raw * v_qty)');
    expect(corrective).toContain('v_subtotal := v_subtotal_raw + v_adjustment');
    expect(corrective).toContain('v_tax := floor(v_subtotal * d.tax_rate)');
    expect(corrective).toContain('v_total := v_subtotal + v_tax');
    expect(corrective).toContain('d.lock_version is distinct from p_expected_lock_version');
  });
});

describe('adjustment reason UI', () => {
  it('uses the formal label and optional placeholder only in the existing Draft editor', () => {
    expect(draftEditor).toContain('adjustmentLabel="値引き等調整額"');
    expect(financialUi).toContain("placeholder={adjustment === 0 ? '調整なし' : '任意'}");
    expect(financialUi).not.toContain("placeholder={adjustment === 0 ? '調整なし' : '必須'}");
    expect(newCaseEditor).toContain('showAdjustmentReason={false}');
  });
});
