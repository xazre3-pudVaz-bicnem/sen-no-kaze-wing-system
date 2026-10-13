import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261013160000_matrix_admin_edit.sql');
const actions = read('lib/actions/matrix.ts');
const runtime = read('scripts/db-rehearsal/runtime-security.sql');

function functionBody(name: string) {
  const start = migration.indexOf(`create function public.${name}(`);
  return migration.slice(start, migration.indexOf('$$;', migration.indexOf('as $$', start)));
}

describe('本体仕様マトリクスの変更 RPC（PR D2）', () => {
  it('3 つとも本部だけで、権限確認は状態判定より前（権限のない利用者に状態を返さない）', () => {
    for (const name of ['update_matrix_row', 'create_matrix_row', 'set_matrix_row_status']) {
      const body = functionBody(name);
      const forbidden = body.indexOf("raise exception 'FORBIDDEN");
      expect(forbidden, name).toBeGreaterThan(0);
      for (const later of ["raise exception 'LOCKED", "raise exception 'NOT_FOUND", 'for update']) {
        const at = body.indexOf(later);
        if (at >= 0) expect(forbidden, `${name}: ${later}`).toBeLessThan(at);
      }
      expect(migration).toContain(`grant execute on function public.${name}(`);
    }
    expect(migration).not.toMatch(/grant execute[^;]*to (anon|service_role)/);
  });

  it('行の変更は版の一致を確かめ、有効な項目すべてのセルを明示的に書き、監査ログに残す', () => {
    const body = functionBody('update_matrix_row');
    expect(body).toContain('if r.lock_version is distinct from p_expected_lock_version then');
    expect(body).toContain("select r.id, i.code, i.code = any(p_selectable_items)");
    expect(body).toContain('on conflict (matrix_row_id, matrix_item_code) do update set selectable = excluded.selectable;');
    expect(body).toContain('lock_version = lock_version + 1');
    expect(body).toContain("perform public.write_audit('matrix_row.update', 'matrix_rows'");
    // 防火の本体がある行は防火不可にできない
    expect(body).toContain("where b.matrix_row_id = r.id and b.fire_spec_code = 'fire' and b.status = 'active'");
  });

  it('画面の操作は本部だけで、保存後にシミュレーター（公開カタログ）を更新する', () => {
    expect(actions.match(/await requireAdmin\('\/admin\/matrix'\)/g)).toHaveLength(3);
    expect(actions).toContain('updateTag(CATALOG_TAG);');
    expect(read('components/admin/admin-nav.tsx')).toContain("'/admin/matrix',");
    expect(read('app/admin/base-masters/page.tsx')).toContain('href="/admin/matrix"');
  });

  it('実行時検査で、権限・版・無効な項目・防火の本体・重複・停止と監査ログを確認している', () => {
    for (const step of [
      '13-1 お客様はマトリクスを変更できない',
      '13-2 本部は版が一致すれば変更でき、版が進み、選択できる項目が置き換わる',
      '13-3 古い版のままの変更は拒否される',
      '13-4 有効でない項目（防火など）は選択できる項目にできない',
      '13-5 防火の本体がある行は、防火不可へ変更できない',
      '13-6 同じ機種・仕様・サイズの行は追加できない',
      '13-7 本部は行を停止でき、変更は監査ログに残る',
    ]) {
      expect(runtime).toContain(step);
    }
  });
});

describe.sequential('本体仕様マトリクスの変更：ローカル検証モード（SQL と同じ判定）', () => {
  let dir = '';
  const admin = { id: 'matrix-admin', email: 'a@example.com', role: 'admin' as const, full_name: '本部' };
  const customer = { id: 'matrix-customer', email: 'c@example.com', role: 'customer' as const, full_name: '顧客' };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-matrix-edit-'));
    process.env.WING_LOCAL_DIR = dir;
    process.env.WING_LOCAL_MODE = '1';
  });
  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    delete process.env.WING_LOCAL_MODE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('本部は版が一致すれば保存でき、古い版・無効な項目・お客様は拒否する。変更はすぐに判定へ反映される', async () => {
    const store = new LocalStore();
    const matrix = (await store.getSpecMatrix())!;
    const row = matrix.rows[0];
    const input = { row_id: row.id, fire_selectable: false, selectable_items: ['roof-exterior'], expected_lock_version: row.lock_version };
    await expect(store.updateMatrixRow(customer, input)).rejects.toThrow('本部だけ');
    await expect(store.updateMatrixRow(admin, { ...input, selectable_items: ['fireproof'] })).rejects.toThrow('有効な項目ではありません');
    const saved = await store.updateMatrixRow(admin, input);
    expect(saved).toMatchObject({ fire_selectable: false, lock_version: row.lock_version + 1 });
    await expect(store.updateMatrixRow(admin, input)).rejects.toThrow('他の画面でこの行が更新されています');

    const after = (await store.getSpecMatrix())!;
    const selectable = after.cells.filter((cell) => cell.matrix_row_id === row.id && cell.selectable).map((cell) => cell.matrix_item_code);
    expect(selectable).toEqual(['roof-exterior']);
    expect(after.cells.filter((cell) => cell.matrix_row_id === row.id)).toHaveLength(15);
  });

  it('同じ機種・仕様・サイズの行は追加できず、停止・再開は版を進める', async () => {
    const store = new LocalStore();
    const matrix = (await store.getSpecMatrix())!;
    const row = matrix.rows[0];
    await expect(
      store.createMatrixRow(admin, { base_model_id: row.base_model_id, spec_code: row.spec_code, size_code: row.size_code, fire_selectable: true, selectable_items: [] })
    ).rejects.toThrow('同じ機種・仕様・サイズの行がすでにあります');
    const retired = await store.setMatrixRowStatus(admin, row.id, 'retired', row.lock_version);
    expect(retired).toMatchObject({ status: 'retired', lock_version: row.lock_version + 1 });
    await expect(store.setMatrixRowStatus(admin, row.id, 'active', row.lock_version)).rejects.toThrow('他の画面でこの行が更新されています');
  });
});
