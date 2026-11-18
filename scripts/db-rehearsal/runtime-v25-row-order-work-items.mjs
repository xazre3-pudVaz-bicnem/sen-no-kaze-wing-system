import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 標準見積 v2.5 の商品行と手入力明細の混在の並び順・工事項目の保存（20261110140000）の実行時検査（1 本の接続・最後に rollback） */
export async function runtimeV25RowOrderWorkItems(client) {
  const applied = await client.query(
    "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'standard_estimate_revision_v25_lines' and column_name = 'display_order') as ok"
  );
  if (applied.rows[0]?.ok !== true) {
    return { ok: true, results: [{ step: '並び順・工事項目の保存（20261110140000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }
  const sql = fs.readFileSync(path.join(HERE, 'runtime-v25-row-order-work-items.sql'), 'utf8').split('\r').join('');
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
