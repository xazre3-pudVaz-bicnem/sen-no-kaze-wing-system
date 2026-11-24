import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Issue #707：空調・照明器具を「その他」から独立させた後（20261123150000）の実行時検査（1 本の接続・最後に rollback） */
export async function runtimeMatrixAirconLightingSplit(client) {
  const applied = await client.query(
    "select exists (select 1 from public.matrix_items where code = 'aircon') and exists (select 1 from public.matrix_items where code = 'lighting') as ok"
  );
  if (applied.rows[0]?.ok !== true) {
    return { ok: true, results: [{ step: '空調・照明器具の独立（20261123150000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }
  const sql = fs.readFileSync(path.join(HERE, 'runtime-matrix-aircon-lighting-split.sql'), 'utf8').split('\r').join('');
  try {
    const res = await client.query(sql);
    const rows = Array.isArray(res) ? res : [res];
    const results = rows.find((row) => row.rows?.[0]?.j)?.rows[0].j ?? [];
    return { ok: results.length > 0 && results.every((item) => item.ok), results };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, results: [], error: error.message };
  }
}
