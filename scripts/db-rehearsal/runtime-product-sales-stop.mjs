import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 販売停止・廃番（20261016112000）の実行時検査（1 本の接続で流して rollback する）
const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function runtimeProductSalesStop(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-product-sales-stop.sql'), 'utf8').split('\r').join('');
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
