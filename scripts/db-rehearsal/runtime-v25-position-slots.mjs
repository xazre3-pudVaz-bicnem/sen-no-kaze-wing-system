import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** v2.5 PR-S1：窓タイプと、位置・用途ごとの選択枠・枠ごとの選べる商品の実行時検査（1 本の接続・最後に rollback） */
export async function runtimeV25PositionSlots(client) {
  if ((await client.query("select to_regclass('public.standard_estimate_revision_slot_options') is not null as ok")).rows[0].ok !== true) {
    return { ok: true, results: [{ step: 'v2.5 の位置・用途ごとの選択枠（20261102100000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }
  const sql = fs.readFileSync(path.join(HERE, 'runtime-v25-position-slots.sql'), 'utf8').split('\r').join('');
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
