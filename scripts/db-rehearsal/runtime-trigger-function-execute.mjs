import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// トリガー専用の関数 26 本の EXECUTE（20261016114000）の実行時検査（1 本の接続で流して rollback する）
const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function runtimeTriggerFunctionExecute(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-trigger-function-execute.sql'), 'utf8').split('\r').join('');
  try {
    const res = await client.query(sql);
    const rows = Array.isArray(res) ? res : [res];
    const results = rows.find((row) => row.rows?.[0]?.j)?.rows[0].j ?? [];
    // 商品マスターが空でない DB では動作の確認（TFE-10〜）を省略する。合格の件数だけで見落とさないよう、省略したことを出す
    const skipped = results.some((item) => item.step.startsWith('TFE-0 '));
    return {
      ok: results.length > 0 && results.every((item) => item.ok),
      results,
      ...(skipped ? { note: 'トリガー専用の関数の検査：商品マスターが空でない DB のため、トリガーの動作の確認（TFE-10〜37）は省略しました（権限の検査 TFE-1〜3 だけ）' } : {}),
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, results: [], error: error.message };
  }
}
