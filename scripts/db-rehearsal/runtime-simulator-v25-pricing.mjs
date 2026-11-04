import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** v2.5 PR-C1：シミュレーター・保存した仕様・見積依頼の v2.5 の売価の実行時検査（1 本の接続・最後に rollback） */
export async function runtimeSimulatorV25Pricing(client) {
  if ((await client.query("select to_regprocedure('public.get_simulator_v25_sale_views(uuid)') is not null as ok")).rows[0].ok !== true) {
    return { ok: true, results: [{ step: 'v2.5 のシミュレーターの売価（20261029100000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }
  const sql = fs.readFileSync(path.join(HERE, 'runtime-simulator-v25-pricing.sql'), 'utf8').split('\r').join('');
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
