import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** #647：標準見積 v2.5 の選択枠の「選ぶ数」と「計上数量」を分ける（20261110130000）の実行時検査（1 本の接続・最後に rollback） */
export async function runtimeV25SlotQuantity(client) {
  const applied = await client.query(
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'standard_estimate_revision_baseline_items' and column_name = 'unit_snapshot') as ok"
  );
  if (applied.rows[0]?.ok !== true) {
    return { ok: true, results: [{ step: '#647 選択枠の計上数量（20261110130000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }
  const sql = fs.readFileSync(path.join(HERE, 'runtime-v25-slot-quantity.sql'), 'utf8').split('\r').join('');
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
