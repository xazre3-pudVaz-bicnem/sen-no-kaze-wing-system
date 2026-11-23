import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { buildCustomerCategoryMatrix, customerCategorySelectable } from '@/lib/domain/customer-category-applicability';
import { MATRIX_CURRENT_CATEGORY_ITEM_SEED, MATRIX_CURRENT_ITEM_SEED, buildSeedMatrix } from '@/lib/seed/matrix';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261123150000_matrix_aircon_lighting_split.sql'),
  'utf8'
);

describe('Issue #707: atomic split contract', () => {
  it('new items inherit other; only aircon and lighting move; row versions invalidate stale clients', () => {
    expect(migration).toContain("lock table public.matrix_items, public.matrix_rows, public.matrix_cells");
    expect(migration).toContain("c.matrix_item_code = 'other'");
    expect(migration).toContain("cross join (values ('aircon'), ('lighting'))");
    expect(migration).toContain("and c.code in ('aircon','lighting')");
    expect(migration).toContain('lock_version = lock_version + 1');
    expect(migration).toContain('matrix_707_before');
    expect(migration).toContain('matrix_707_other_before');
    expect(migration).toContain('customer_category_selectable');
    expect(migration).toContain("raise exception 'STOP 707:");
    expect(migration).toContain('commit;');
    expect(MATRIX_CURRENT_ITEM_SEED).toHaveLength(17);
    expect(MATRIX_CURRENT_CATEGORY_ITEM_SEED).toHaveLength(24);
  });

  it('all six local rows preserve the four category answers at cutover; BOX alias remains unchanged', () => {
    const models = [
      { id:'model-wing', slug:'wing-01' },
      { id:'model-box', slug:'box' },
      { id:'model-flat', slug:'flat' },
    ];
    const categories = MATRIX_CURRENT_CATEGORY_ITEM_SEED.map(([code]) => ({ id:'cat-'+code, code }));
    const matrix = buildSeedMatrix(models, categories);
    const rules = buildCustomerCategoryMatrix(matrix, categories, models)!;
    expect(matrix.rows).toHaveLength(6);
    expect(matrix.cells).toHaveLength(102);
    expect(rules.itemByCategoryCode).toMatchObject({
      aircon: 'aircon', lighting: 'lighting', smartlock: 'other', 'exterior-parts': 'other',
    });
    for (const row of matrix.rows) {
      const original = matrix.cells.find((cell) => cell.matrix_row_id === row.id && cell.matrix_item_code === 'other')!;
      for (const code of ['aircon', 'lighting']) {
        const added = matrix.cells.find((cell) => cell.matrix_row_id === row.id && cell.matrix_item_code === code);
        expect(added?.selectable, row.id + ':' + code).toBe(original.selectable);
      }
      const model = models.find((model) => model.id === row.base_model_id)!;
      for (const categoryCode of ['aircon','lighting','smartlock','exterior-parts']) {
        expect(customerCategorySelectable(rules, model.slug, row.spec_code, categoryCode),
          model.slug + '/' + row.spec_code + '/' + categoryCode).toBe(original.selectable);
      }
    }
    for (const code of ['aircon','lighting','smartlock','exterior-parts']) {
      expect(customerCategorySelectable(rules, 'box','hotel-single',code))
        .toBe(customerCategorySelectable(rules,'box','hotel',code));
      expect(customerCategorySelectable(rules, 'wing-01','base',code)).toBe(false);
    }
  });
});

describe.sequential('Issue #707: independent 17-column edits in isolated local store', () => {
  let temp = '';
  const admin = { id: 'matrix-707-admin', email: 'a@example.com', role: 'admin' as const, full_name:'本部' };
  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-matrix-707-'));
    process.env.WING_LOCAL_DIR = temp;
    process.env.WING_LOCAL_MODE = '1';
  });
  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    delete process.env.WING_LOCAL_MODE;
    fs.rmSync(temp,{ recursive:true, force:true });
  });

  it('turning off aircon only keeps lighting and other enabled; stale version fails', async () => {
    const store = new LocalStore();
    const initial = (await store.getSpecMatrix())!;
    const row = initial.rows.find((row) =>
      initial.cells.some((cell) => cell.matrix_row_id === row.id && cell.matrix_item_code === 'other' && cell.selectable)
    )!;
    const selected = initial.cells.filter((cell) => cell.matrix_row_id === row.id && cell.selectable)
      .map((cell) => cell.matrix_item_code);
    expect(selected).toEqual(expect.arrayContaining(['aircon','lighting','other']));
    const changed = { row_id:row.id, fire_selectable: row.fire_selectable,
      selectable_items:selected.filter((code) => code !== 'aircon'), expected_lock_version:row.lock_version };
    const saved = await store.updateMatrixRow(admin, changed);
    expect(saved.lock_version).toBe(row.lock_version + 1);
    await expect(store.updateMatrixRow(admin, changed)).rejects.toThrow('他の画面でこの行が更新されています');
    const actual = (await store.getSpecMatrix())!;
    const active = actual.cells.filter((cell) => cell.matrix_row_id === row.id && cell.selectable)
      .map((cell) => cell.matrix_item_code);
    expect(active).not.toContain('aircon');
    expect(active).toEqual(expect.arrayContaining(['lighting','other']));
    expect(actual.cells.filter((cell) => cell.matrix_row_id === row.id)).toHaveLength(17);
  });
});
