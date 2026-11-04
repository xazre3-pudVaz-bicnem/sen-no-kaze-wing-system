import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * v2.5 PR-D1c：Web 以外の案件で、v2.5 の標準見積の版から見積下書きを作る・発行する・改訂するの実行時検査（1 本の接続・最後に rollback）。
 * 続けて同じトランザクションの検査データで、切り替え前の確認（preflight-v25-switch.sql）が件数を数えられることを確かめる
 */
export async function runtimeV25StandardQuoteDrafts(client) {
  if ((await client.query("select to_regprocedure('public.standard_estimate_v25_quote_draft_lines(uuid, boolean)') is not null as ok")).rows[0].ok !== true) {
    return { ok: true, results: [{ step: 'v2.5 の版から作る Web 以外の見積（20261102130000 が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }
  // 最後の rollback は preflight の後に行う
  const sql = fs
    .readFileSync(path.join(HERE, 'runtime-v25-standard-quote-drafts.sql'), 'utf8')
    .split('\r')
    .join('')
    .replace(/\nrollback;\s*$/, '\n');
  try {
    const res = await client.query(sql);
    const rows = Array.isArray(res) ? res : [res];
    const results = rows.find((row) => row.rows?.[0]?.j)?.rows[0].j ?? [];
    // 検査データ：v2.5 の版を公開した標準見積 1 件（位置の枠 1）と、公開した版の無い旧来の標準見積 1 件。スイッチは切ったまま
    const preflight = (await client.query(fs.readFileSync(path.join(HERE, 'preflight-v25-switch.sql'), 'utf8'))).rows[0]?.result ?? {};
    const actual = [
      `active=${preflight.active_masters}`,
      `without=${preflight.masters_without_published}`,
      `v25=${preflight.masters_published_v25}`,
      `slots=${preflight.v25_position_slots}`,
      `switch=${preflight.switch_enabled}`,
      `ready=${preflight.ready_for_switch}`,
    ].join('/');
    const expected = 'active=2/without=1/v25=1/slots=1/switch=false/ready=false';
    results.push({
      step: 'D1c-16 切り替え前の確認（preflight）：件数だけを数え、公開した版の無い標準見積があれば ready_for_switch は false',
      expected,
      actual,
      ok: actual === expected,
    });
    await client.query('rollback');
    return { ok: results.length > 0 && results.every((item) => item.ok), results };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, results: [], error: error.message };
  }
}
