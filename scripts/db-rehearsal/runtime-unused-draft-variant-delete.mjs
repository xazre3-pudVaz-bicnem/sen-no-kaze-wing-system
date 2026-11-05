import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** DB Rehearsal使い捨てDBでのみ実行。全検証データはtransaction内でROLLBACKする。 */
export async function runtimeUnusedDraftVariantDelete(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-unused-draft-variant-delete.sql'), 'utf8');
  try {
    const response = await client.query(sql);
    const rows = (Array.isArray(response) ? response : [response]).find((row) => row.rows?.[0]?.j)?.rows[0].j ?? [];
    // ほかの検査と同じ形（step）にそろえて、検査の名前を表示する
    const results = rows.map((r) => ({ step: r.step ?? r.test, expected: r.expected, actual: r.actual, ok: r.ok }));
    return { ok: results.length > 0 && results.every((r) => r.ok), results };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, results: [], error: error.message };
  }
}
