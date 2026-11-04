import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** v2.5 PR-S2b：案件の画面のプランボードに、位置・用途の選択枠ごとの商品を出す（get_case_plan_configuration）の実行時検査（1 本の接続・最後に rollback） */
export async function runtimeCasePlanPositionSlots(client) {
  const applied = (
    await client.query(
      "select pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.get_case_plan_configuration(uuid)'::regprocedure), '''position_slots''') > 0 as ok"
    )
  ).rows[0].ok;
  if (applied !== true) {
    return { ok: true, results: [{ step: '案件のプランボードの位置ごとの表示（20261102140000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }
  const sql = fs.readFileSync(path.join(HERE, 'runtime-case-plan-position-slots.sql'), 'utf8').split('\r').join('');
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
