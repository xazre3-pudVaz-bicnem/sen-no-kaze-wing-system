import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 子の行の読み取りの条件の実行時検査（1 本の接続で流して rollback する）
// 20261110120000（依頼 A：匿名・お客様は親が公開中の行だけ）と 20261110121000（H2-C ①：代理店以上は親が読める行だけ）
const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function runtimeAnonChildRows(client) {
  // migration の記録で判断する（読み取りの条件が後から元に戻っても、省略にならず失敗として見つかるように）
  const applied = await client.query(
    "select to_regclass('supabase_migrations.schema_migrations') is not null and exists (select 1 from supabase_migrations.schema_migrations where version = '20261110121000') as ok"
  );
  if (!applied.rows[0]?.ok) {
    return { ok: true, results: [{ step: '子の行の読み取りの条件の検査（20261110120000・20261110121000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
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
