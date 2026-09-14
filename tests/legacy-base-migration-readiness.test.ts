import { describe, expect, it } from 'vitest';
import { assessLegacyBaseMigrationReadiness } from '@/lib/domain/legacy-base-migration';

const modelId = 'model-1';

function validSnapshot(spec = 'hotel') {
  return {
    base_model_id: modelId,
    legacy_spec_code: spec,
    legacy_template_id: `template-${spec}`,
    legacy_base_line_total: 1000,
    legacy_base_expense_rate: 0.15,
    legacy_base_expense: 150,
    legacy_base_total: 1150,
    legacy_interior_line_total: 200,
    legacy_interior_expense: 30,
    legacy_interior_total: 230,
    legacy_option_line_total: 300,
    legacy_option_expense: 45,
    legacy_option_total: 345,
    legacy_sitework_line_total: 400,
    legacy_sitework_expense: 60,
    legacy_sitework_total: 460,
    subtotal_raw: 2185,
    adjustment: -185,
    subtotal: 2000,
    tax_rate: 0.1,
    tax: 200,
    total: 2200,
    source_file_name: 'estimate.xlsx',
    source_sheet_name: spec,
    source_sha256: 'abc',
    source_imported_at: '2026-09-14T00:00:00Z',
  };
}

function baseMapping(spec = 'hotel', overrides: Record<string, unknown> = {}) {
  return {
    base_model_id: modelId,
    legacy_spec_code: spec,
    legacy_section: '２．プレカット',
    legacy_name: '・204材L=12f',
    legacy_quantity: 2,
    legacy_unit: '本',
    legacy_unit_price: 500,
    legacy_amount: 1000,
    legacy_remark: '屋根タルキ',
    target_group_label: null,
    target_classification: 'base',
    review_status: 'approved',
    ...overrides,
  };
}

function approvedSpec(spec = 'hotel', group = 'wing-body') {
  return {
    base_model_id: modelId,
    legacy_spec_code: spec,
    proposed_group_key: group,
    decision_status: 'approved',
  };
}

describe('移行監査ready判定', () => {
  it('全条件が揃えばDB最終検証を試行できる', () => {
    const result = assessLegacyBaseMigrationReadiness({
      mappings: [baseMapping()],
      specs: [approvedSpec()],
      duplicates: [],
      snapshots: [validSnapshot()],
    });

    expect(result.canAttemptFinalize).toBe(true);
  });

  it('siteworkの未解決duplicateもreadyを止める', () => {
    const result = assessLegacyBaseMigrationReadiness({
      mappings: [baseMapping()],
      specs: [approvedSpec()],
      duplicates: [{ resolution: 'pending', candidate_section_code: 'sitework' }],
      snapshots: [validSnapshot()],
    });

    expect(result.pendingDuplicates).toBe(1);
    expect(result.canAttemptFinalize).toBe(false);
  });

  it('本体amountが単価×数量と違えばreadyを止める', () => {
    const result = assessLegacyBaseMigrationReadiness({
      mappings: [baseMapping('hotel', { legacy_amount: 999 })],
      specs: [approvedSpec()],
      duplicates: [],
      snapshots: [validSnapshot()],
    });

    expect(result.amountMismatches).toBe(1);
    expect(result.canAttemptFinalize).toBe(false);
  });

  it('同じgroupでもsectionが違うBOMは互換扱いしない', () => {
    const result = assessLegacyBaseMigrationReadiness({
      mappings: [
        baseMapping('hotel'),
        baseMapping('residence', { legacy_section: '３．構造用面材等' }),
      ],
      specs: [
        approvedSpec('hotel', 'same-body'),
        approvedSpec('residence', 'same-body'),
      ],
      duplicates: [],
      snapshots: [
        validSnapshot('hotel'),
        validSnapshot('residence'),
      ],
    });

    expect(result.incompatibleBodyGroups).toBe(1);
    expect(result.canAttemptFinalize).toBe(false);
  });

  it('同じBOMでも本体諸費用条件が違えばreadyを止める', () => {
    const residence = validSnapshot('residence');
    residence.legacy_base_expense_rate = 0.1;
    residence.legacy_base_expense = 100;
    residence.legacy_base_total = 1100;

    const result = assessLegacyBaseMigrationReadiness({
      mappings: [baseMapping('hotel'), baseMapping('residence')],
      specs: [
        approvedSpec('hotel', 'same-body'),
        approvedSpec('residence', 'same-body'),
      ],
      duplicates: [],
      snapshots: [validSnapshot('hotel'), residence],
    });

    expect(result.incompatibleExpenseGroups).toBe(1);
    expect(result.canAttemptFinalize).toBe(false);
  });

  it('標準見積snapshotが欠けていればreadyを止める', () => {
    const snapshot = validSnapshot();
    snapshot.legacy_template_id = null as unknown as string;

    const result = assessLegacyBaseMigrationReadiness({
      mappings: [baseMapping()],
      specs: [approvedSpec()],
      duplicates: [],
      snapshots: [snapshot],
    });

    expect(result.incompleteSnapshots).toBe(1);
    expect(result.canAttemptFinalize).toBe(false);
  });
});
