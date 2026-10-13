import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { findMatrixRow, isFireSelectable, isMatrixItemSelectable } from '@/lib/domain/spec-matrix';
import type { SpecMatrix } from '@/lib/domain/types';
import { MATRIX_CATEGORY_ITEM_SEED, MATRIX_ITEM_SEED, MATRIX_ROW_SEED, MATRIX_SIZE_SEED, MATRIX_SPEC_SEED, buildSeedMatrix } from '@/lib/seed/matrix';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261013110000_matrix_identity_foundation.sql');
const TABLES = ['matrix_specs', 'matrix_sizes', 'matrix_items', 'matrix_rows', 'matrix_cells', 'option_category_matrix_items'];

/** `insert into public.<table> (...) values ...;` の各行を、文字列・数値の配列として取り出す */
function seedValues(table: string): string[][] {
  const block = migration.match(new RegExp(`insert into public\\.${table} \\([^)]*\\) values\\n([\\s\\S]*?);\\n`));
  expect(block, table).not.toBeNull();
  return [...block![1].matchAll(/\(([^()]*)\)/g)].map((row) =>
    [...row[1].matchAll(/'((?:[^']|'')*)'|(-?\d+)/g)].map((value) => value[1] ?? value[2])
  );
}

function sqlRowSeed() {
  return [...migration.matchAll(/\('([a-z0-9-]+)', '([a-z-]+)', '(\d+x\d+)', (true|false),\s*array\[([^\]]*)\]\)/g)].map((row) => ({
    model_slug: row[1],
    spec_code: row[2],
    size_code: row[3],
    fire_selectable: row[4] === 'true',
    selectable_items: [...row[5].matchAll(/'([a-z-]+)'/g)].map((item) => item[1]),
  }));
}

describe('本体仕様マトリクス（PR A）: migration', () => {
  it('6 つの表を作り、RLS を有効にして、API ロールは読み取りだけにする', () => {
    for (const table of TABLES) {
      expect(migration).toContain(`create table public.${table} (`);
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
      expect(migration).toMatch(new RegExp(`create policy ${table}_read on public\\.${table} for select to anon, authenticated using \\(true\\);`));
    }
    // 書き込みのポリシーは作らない。権限も select だけを付け直す
    expect(migration).not.toMatch(/create policy [a-z_]+ on public\.[a-z_]+ for (insert|update|delete|all)/);
    expect(migration).toContain('from public, anon, authenticated;');
    expect(migration).toMatch(/grant select on public\.matrix_specs, [\s\S]*?to anon, authenticated;/);
    expect(migration).not.toMatch(/grant (insert|update|delete|all)/i);
    expect(migration).toContain("POSTCONDITION: % must be read-only for API roles");
  });

  it('欠けたセルは選択不可として扱う前提で、初期登録は全 15 項目のセルを明示的に入れる', () => {
    expect(migration).toContain('cross join public.matrix_items i;');
    expect(migration).toContain('select r.id, i.code, i.code = any(s.selectable_items)');
    expect(migration).toContain('or (select count(*) from public.matrix_cells) <> 6 * 15');
    expect(migration).toContain('if (select count(*) from public.matrix_cells where selectable) <> 13 + 14 + 10 + 13 + 9 + 4 then');
  });

  it('初期登録は確定 seed だけ：15 項目・6 行。hotel-single・防火などの項目・Category→Item の対応は入れない', () => {
    expect(seedValues('matrix_items').map(([code]) => code)).toEqual([
      'roof-exterior', 'interior', 'entrance-door', 'sash', 'bath', 'kitchen', 'washbasin', 'toilet', 'boiler',
      'entrance-storage', 'interior-door', 'closet', 'bed', 'furnishings', 'other',
    ]);
    const rows = sqlRowSeed();
    expect(rows.map((row) => `${row.model_slug}/${row.spec_code}/${row.size_code}/${row.fire_selectable}`)).toEqual([
      'wing-01/hotel/3640x4550/true',
      'wing-01/residence/3640x4550/true',
      'wing-01/office/3640x4550/true',
      'box/hotel/2100x4550/true',
      'box/water-kit/2100x4550/true',
      'flat/office/2100x4550/false',
    ]);
    expect(migration).not.toMatch(/'hotel-single'\s*,/);
    expect(migration).toContain("where code in ('insulation', 'sitework', 'free-product', 'fireproof')) then");
    expect(migration).not.toMatch(/insert into public\.option_category_matrix_items/);
    expect(migration).toContain('POSTCONDITION: category -> item mapping must not be seeded in PR A');
  });

  it('既存の表・データは変更しない（機種が空の DB では行の初期登録だけを省略、一部だけ欠けていれば停止）', () => {
    expect(migration).not.toMatch(/^\s*(alter table|update|delete from|truncate|drop)\s+public\.(?!matrix_|option_category_matrix_items)/im);
    expect(migration).not.toMatch(/insert into public\.(?!matrix_)/);
    expect(migration).toContain("raise notice 'MATRIX_SEED: base_models is empty; matrix rows / cells are not seeded (empty database)';");
    expect(migration).toContain("from unnest(array['wing-01', 'box', 'flat']) as expected(slug)");
  });
});

describe('本体仕様マトリクス: 初期データの一致', () => {
  it('ローカル検証モードの初期データは migration の確定 seed と同じ', () => {
    expect(seedValues('matrix_specs')).toEqual(MATRIX_SPEC_SEED.map((row) => [row.code, row.label, String(row.sort_order)]));
    expect(seedValues('matrix_sizes')).toEqual(
      MATRIX_SIZE_SEED.map((row) => [row.code, String(row.width_mm), String(row.depth_mm), row.label, String(row.sort_order)])
    );
    expect(seedValues('matrix_items')).toEqual(MATRIX_ITEM_SEED.map((row) => [row.code, row.label, String(row.sort_order)]));
    expect(sqlRowSeed()).toEqual(MATRIX_ROW_SEED);
  });

  it('管理画面の確定サンプル（岩上さんの UI）と同じ選択可否・防火の可否', () => {
    const demo = read('components/admin/base-master-excel-demo.tsx');
    const start = demo.indexOf('const INITIAL_MATRIX_ROWS');
    if (start < 0) return; // サンプルが DB 表示へ置き換わった後は照合しない
    const block = demo.slice(start, demo.indexOf('];', start));
    const identity: Record<string, string> = {
      'matrix-wing-hotel': 'wing-01/hotel',
      'matrix-wing-residence': 'wing-01/residence',
      'matrix-wing-office': 'wing-01/office',
      'matrix-box-hotel': 'box/hotel',
      'matrix-box-water-kit': 'box/water-kit',
      'matrix-flat-office': 'flat/office',
    };
    const kebab = (key: string) => key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
    const demoRows = [...block.matchAll(/id: '([a-z-]+)'[\s\S]*?fireSelectable: (true|false),\s*availability: \{([\s\S]*?)\}/g)].map((row) => ({
      key: identity[row[1]],
      fire: row[2] === 'true',
      selectable: [...row[3].matchAll(/(\w+): true/g)].map((entry) => kebab(entry[1])),
    }));
    expect(demoRows).toHaveLength(6);
    expect(demoRows).toEqual(
      MATRIX_ROW_SEED.map((row) => ({ key: `${row.model_slug}/${row.spec_code}`, fire: row.fire_selectable, selectable: row.selectable_items }))
    );
  });
});

describe('本体仕様マトリクス: 選択可否の判定（fail closed）', () => {
  const models = [
    { id: 'm-wing', slug: 'wing-01' },
    { id: 'm-box', slug: 'box' },
    { id: 'm-flat', slug: 'flat' },
  ];
  const fresh = (): SpecMatrix => buildSeedMatrix(models);
  const wingHotel = { base_model_id: 'm-wing', spec_code: 'hotel', size_code: '3640x4550' };
  const flatOffice = { base_model_id: 'm-flat', spec_code: 'office', size_code: '2100x4550' };

  it('確定 seed どおりに判定する', () => {
    const matrix = fresh();
    expect(isMatrixItemSelectable(matrix, wingHotel, 'bed')).toBe(true);
    expect(isMatrixItemSelectable(matrix, wingHotel, 'kitchen')).toBe(false);
    expect(isMatrixItemSelectable(matrix, flatOffice, 'sash')).toBe(true);
    expect(isMatrixItemSelectable(matrix, flatOffice, 'bath')).toBe(false);
    expect(isFireSelectable(matrix, wingHotel)).toBe(true);
    expect(isFireSelectable(matrix, flatOffice)).toBe(false);
  });

  it('行が無い・サイズや仕様が違う・hotel-single は選択できない', () => {
    const matrix = fresh();
    expect(findMatrixRow(matrix, { ...wingHotel, size_code: '2100x4550' })).toBeNull();
    expect(isMatrixItemSelectable(matrix, { ...wingHotel, spec_code: 'hotel-single' }, 'bed')).toBe(false);
    expect(isFireSelectable(matrix, { base_model_id: 'm-box', spec_code: 'hotel-single', size_code: '2100x4550' })).toBe(false);
    expect(isMatrixItemSelectable(matrix, wingHotel, 'insulation')).toBe(false);
  });

  it('セルが欠けている・行／仕様／サイズ／項目が retired なら選択できない', () => {
    const missingCell = fresh();
    const rowId = findMatrixRow(missingCell, wingHotel)!.id;
    missingCell.cells = missingCell.cells.filter((cell) => !(cell.matrix_row_id === rowId && cell.matrix_item_code === 'bed'));
    expect(isMatrixItemSelectable(missingCell, wingHotel, 'bed')).toBe(false);

    const retiredRow = fresh();
    retiredRow.rows.find((row) => row.id === rowId)!.status = 'retired';
    expect(isMatrixItemSelectable(retiredRow, wingHotel, 'bed')).toBe(false);
    expect(isFireSelectable(retiredRow, wingHotel)).toBe(false);

    const retiredSpec = fresh();
    retiredSpec.specs.find((spec) => spec.code === 'hotel')!.status = 'retired';
    expect(isMatrixItemSelectable(retiredSpec, wingHotel, 'bed')).toBe(false);

    const retiredSize = fresh();
    retiredSize.sizes.find((size) => size.code === '3640x4550')!.status = 'retired';
    expect(isMatrixItemSelectable(retiredSize, wingHotel, 'bed')).toBe(false);

    const retiredItem = fresh();
    retiredItem.items.find((item) => item.code === 'bed')!.status = 'retired';
    expect(isMatrixItemSelectable(retiredItem, wingHotel, 'bed')).toBe(false);
  });
});

describe.sequential('本体仕様マトリクス: ローカル検証モード', () => {
  let dir = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-matrix-'));
    process.env.WING_LOCAL_DIR = dir;
    process.env.WING_LOCAL_MODE = '1';
  });
  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    delete process.env.WING_LOCAL_MODE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('空のローカル DB は確定 seed のマトリクス（6 行 × 15 項目）を持ち、機種 ID が解決されている', async () => {
    const store = new LocalStore();
    const matrix = (await store.getSpecMatrix())!;
    const models = await store.listModels({ includeDraft: true });
    expect(matrix.items).toHaveLength(15);
    expect(matrix.rows).toHaveLength(6);
    expect(matrix.cells).toHaveLength(90);
    // Category → Item はローカルにあるカテゴリーの分だけ（PR B の確定対応）
    const categories = (await store.getCatalogBundle(models[0].id, { includeDraft: true }))!.categories;
    const localMapped = MATRIX_CATEGORY_ITEM_SEED.filter(([code]) => categories.some((category) => category.code === code));
    expect(matrix.categoryItems).toHaveLength(localMapped.length);
    expect(localMapped.length).toBeGreaterThan(0);
    const flat = models.find((model) => model.slug === 'flat')!;
    expect(isFireSelectable(matrix, { base_model_id: flat.id, spec_code: 'office', size_code: '2100x4550' })).toBe(false);
    for (const row of matrix.rows) expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
