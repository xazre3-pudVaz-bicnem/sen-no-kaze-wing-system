import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * A-3（2026-11-04 の先方回答）：別途工事 9 品目の削除（remove_sitework_catalog）と見積の初期明細（quote_initial_lines）の実行時検査
 * （1 本の接続・最後に rollback）。止める条件・写し・写しからの戻し方も確かめる
 */
export async function runtimeA3RemoveSitework(client) {
  if ((await client.query("select to_regprocedure('public.remove_sitework_catalog(jsonb)') is not null as ok")).rows[0].ok !== true) {
    return { ok: true, results: [{ step: '別途工事 9 品目の削除（20261111100000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }
  const sql = fs.readFileSync(path.join(HERE, 'runtime-a3-remove-sitework.sql'), 'utf8').split('\r').join('');
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
