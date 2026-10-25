import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);

/** DB Rehearsal使い捨てDBでのみ実行。全検証データはtransaction内でROLLBACKする。 */
export async function runtimeUnusedDraftVariantDelete(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-unused-draft-variant-delete.sql'), 'utf8');
  try {
    const response = await client.query(sql);
    const rows = (Array.isArray(response) ? response : [response]).find((row) => row.rows?.[0]?.j)?.rows[0].j ?? [];
    return { ok: rows.length > 0 && rows.every((r) => r.ok), results: rows };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, results: [], error: error.message };
  }
}
