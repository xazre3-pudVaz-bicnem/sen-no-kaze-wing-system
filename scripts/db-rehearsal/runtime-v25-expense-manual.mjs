import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * A-2 ⑥：v2.5 の経費を「率で計算」か「金額を手動」で決める（標準見積・シミュレーター・Web の見積・Web 以外の下書き）の
 * 実行時検査（1 本の接続・最後に rollback）
 */
export async function runtimeV25ExpenseManual(client) {
  if ((await client.query("select to_regprocedure('public.standard_estimate_v25_expense_settings(uuid)') is not null as ok")).rows[0].ok !== true) {
    return { ok: true, results: [{ step: '経費の手動指定（20261104113000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }
  const sql = fs.readFileSync(path.join(HERE, 'runtime-v25-expense-manual.sql'), 'utf8').split('\r').join('');
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
