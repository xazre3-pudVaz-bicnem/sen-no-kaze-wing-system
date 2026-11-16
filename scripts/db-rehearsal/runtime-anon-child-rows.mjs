import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 匿名・お客様に公開中の商品の子の行だけを返す（2026-11-13 の先方の依頼 A・20261110120000）の実行時検査（1 本の接続で流して rollback する）
const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function runtimeAnonChildRows(client) {
  const applied = await client.query(
    "select pg_catalog.strpos(pg_catalog.pg_get_expr(p.polqual, p.polrelid), 'options') > 0 as ok from pg_catalog.pg_policy p where p.polrelid = 'public.option_variant_groups'::regclass and p.polname = 'variant_groups_read'"
  );
  if (!applied.rows[0]?.ok) {
    return { ok: true, results: [{ step: '子の行の公開状態の検査（20261110120000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }
  const sql = fs.readFileSync(path.join(HERE, 'runtime-anon-child-rows.sql'), 'utf8').split('\r').join('');
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
