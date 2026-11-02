import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** v2.5 PR-D1c：Web 以外の案件で、v2.5 の標準見積の版から見積下書きを作る・発行する・改訂するの実行時検査（1 本の接続・最後に rollback） */
export async function runtimeV25StandardQuoteDrafts(client) {
  if ((await client.query("select to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid)') is not null as ok")).rows[0].ok !== true) {
    return { ok: true, results: [{ step: 'v2.5 の版から作る Web 以外の見積（20261102130000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }
  const sql = fs.readFileSync(path.join(HERE, 'runtime-v25-standard-quote-drafts.sql'), 'utf8').split('\r').join('');
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
