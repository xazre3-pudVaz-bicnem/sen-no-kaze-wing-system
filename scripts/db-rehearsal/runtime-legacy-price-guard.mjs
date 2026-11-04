import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 旧価格の列の保護（v2.5 PR-C1b・20261030100000）の実行時検査（1 本の接続で流して rollback する）
const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function runtimeLegacyPriceGuard(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-legacy-price-guard.sql'), 'utf8').split('\r').join('');
  try {
    const res = await client.query(sql);
    const rows = Array.isArray(res) ? res : [res];
    const results = rows.find((row) => row.rows?.[0]?.j)?.rows[0].j ?? [];
    // 商品マスターが空でない DB では読み取り・書き込みの動作の確認（LPG-10〜）を省略する。省略したことを出す
    const skipped = results.some((item) => item.step.startsWith('LPG-0 '));
    return {
      ok: results.length > 0 && results.every((item) => item.ok),
      results,
      ...(skipped ? { note: '旧価格の列の保護の検査：商品マスターが空でない DB のため、読み取り・書き込みの動作の確認（LPG-10〜31）は省略しました（権限の検査 LPG-1〜3 だけ）' } : {}),
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, results: [], error: error.message };
  }
}
