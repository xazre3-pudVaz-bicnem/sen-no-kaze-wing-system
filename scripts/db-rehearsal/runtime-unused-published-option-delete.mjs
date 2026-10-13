import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function runtimeUnusedPublishedOptionDelete(client) {
  const sql = fs
    .readFileSync(path.join(HERE, 'runtime-unused-published-option-delete.sql'), 'utf8')
    .split('\r')
    .join('');
  let results = [];
  try {
    const res = await client.query(sql);
    results = (Array.isArray(res) ? res : [res]).find((row) => row.rows?.[0]?.j)?.rows[0].j ?? [];
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, results, error: error.message };
  }
  return { ok: results.length > 0 && results.every((row) => row.ok), results };
}
