type AuditRow = Record<string, unknown>;

const text = (value: unknown) => String(value ?? '').trim().toLowerCase();
const numeric = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const token = (value: unknown) => value === null || value === undefined ? '∅' : String(value);

const specKey = (row: AuditRow) => `${String(row.base_model_id ?? '')}::${String(row.legacy_spec_code ?? '')}`;

function bodySignature(rows: AuditRow[]) {
  return JSON.stringify(
    rows
      .filter((row) => row.review_status === 'approved' && row.target_classification === 'base')
      .map((row) => ({
        section: text(row.legacy_section),
        name: text(row.legacy_name),
        quantity: numeric(row.legacy_quantity),
        unit: text(row.legacy_unit),
        unitPrice: numeric(row.legacy_unit_price),
        amount: numeric(row.legacy_amount),
        remark: text(row.legacy_remark),
        group: text(row.target_group_label),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );
}

const REQUIRED_SNAPSHOT_FIELDS = [
  'legacy_template_id',
  'legacy_base_expense',
  'legacy_base_total',
  'legacy_interior_line_total',
  'legacy_interior_expense',
  'legacy_interior_total',
  'legacy_option_line_total',
  'legacy_option_expense',
  'legacy_option_total',
  'legacy_sitework_line_total',
  'legacy_sitework_expense',
  'legacy_sitework_total',
  'subtotal_raw',
  'adjustment',
  'subtotal',
  'tax_rate',
  'tax',
  'total',
  'source_file_name',
  'source_sheet_name',
  'source_sha256',
  'source_imported_at',
] as const;

export interface LegacyBaseMigrationReadiness {
  pendingMappings: number;
  pendingSpecs: number;
  pendingDuplicates: number;
  zeroBaseSpecs: number;
  incompatibleBodyGroups: number;
  incompatibleExpenseGroups: number;
  incompleteSnapshots: number;
  amountMismatches: number;
  nonIntegerBaseTotals: number;
  canAttemptFinalize: boolean;
}

export function assessLegacyBaseMigrationReadiness(input: {
  mappings: AuditRow[];
  specs: AuditRow[];
  duplicates: AuditRow[];
  snapshots: AuditRow[];
}): LegacyBaseMigrationReadiness {
  const { mappings, specs, duplicates, snapshots } = input;

  const pendingMappings = mappings.filter(
    (row) => row.review_status !== 'approved' || row.target_classification === 'review'
  ).length;
  const pendingSpecs = specs.filter(
    (row) => row.decision_status !== 'approved' || !text(row.proposed_group_key)
  ).length;
  const pendingDuplicates = duplicates.filter((row) => row.resolution === 'pending').length;

  const mappingsBySpec = new Map<string, AuditRow[]>();
  for (const row of mappings) {
    const key = specKey(row);
    const list = mappingsBySpec.get(key) ?? [];
    list.push(row);
    mappingsBySpec.set(key, list);
  }

  const snapshotBySpec = new Map(snapshots.map((row) => [specKey(row), row]));
  const zeroBaseSpecs = specs.filter((spec) => {
    const rows = mappingsBySpec.get(specKey(spec)) ?? [];
    return !rows.some((row) => row.review_status === 'approved' && row.target_classification === 'base');
  }).length;

  const approvedSpecs = specs.filter(
    (row) => row.decision_status === 'approved' && text(row.proposed_group_key)
  );
  const groups = new Map<string, AuditRow[]>();
  for (const spec of approvedSpecs) {
    const key = `${String(spec.base_model_id ?? '')}::${text(spec.proposed_group_key)}`;
    const list = groups.get(key) ?? [];
    list.push(spec);
    groups.set(key, list);
  }

  let incompatibleBodyGroups = 0;
  let incompatibleExpenseGroups = 0;
  for (const groupSpecs of groups.values()) {
    if (groupSpecs.length < 2) continue;
    const signatures = new Set(
      groupSpecs.map((spec) => bodySignature(mappingsBySpec.get(specKey(spec)) ?? []))
    );
    if (signatures.size > 1) incompatibleBodyGroups += 1;

    const expenseSignatures = new Set(groupSpecs.map((spec) => {
      const snapshot = snapshotBySpec.get(specKey(spec));
      return JSON.stringify([
        token(snapshot?.legacy_base_expense_rate),
        token(snapshot?.legacy_base_expense),
        token(snapshot?.legacy_base_total),
      ]);
    }));
    if (expenseSignatures.size > 1) incompatibleExpenseGroups += 1;
  }

  const existingIncompleteSnapshots = snapshots.filter((row) =>
    REQUIRED_SNAPSHOT_FIELDS.some((field) => row[field] === null || row[field] === undefined)
  ).length;
  const missingSnapshotSpecs = specs.filter((spec) => !snapshotBySpec.has(specKey(spec))).length;
  const incompleteSnapshots = existingIncompleteSnapshots + missingSnapshotSpecs;

  const amountMismatches = mappings.filter((row) => {
    if (row.review_status !== 'approved' || row.target_classification !== 'base') return false;
    const quantity = numeric(row.legacy_quantity);
    const unitPrice = numeric(row.legacy_unit_price);
    const amount = numeric(row.legacy_amount);
    if (quantity === null || unitPrice === null || amount === null) return true;
    return Math.round(quantity * unitPrice) !== amount;
  }).length;

  const nonIntegerBaseTotals = snapshots.filter((row) => {
    const expense = numeric(row.legacy_base_expense);
    const total = numeric(row.legacy_base_total);
    return (expense !== null && !Number.isInteger(expense)) || (total !== null && !Number.isInteger(total));
  }).length;

  const canAttemptFinalize =
    snapshots.length > 0 &&
    pendingMappings === 0 &&
    pendingSpecs === 0 &&
    pendingDuplicates === 0 &&
    zeroBaseSpecs === 0 &&
    incompatibleBodyGroups === 0 &&
    incompatibleExpenseGroups === 0 &&
    incompleteSnapshots === 0 &&
    amountMismatches === 0 &&
    nonIntegerBaseTotals === 0;

  return {
    pendingMappings,
    pendingSpecs,
    pendingDuplicates,
    zeroBaseSpecs,
    incompatibleBodyGroups,
    incompatibleExpenseGroups,
    incompleteSnapshots,
    amountMismatches,
    nonIntegerBaseTotals,
    canAttemptFinalize,
  };
}
