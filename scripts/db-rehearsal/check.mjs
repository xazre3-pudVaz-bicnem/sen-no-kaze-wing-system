/**
 * マイグレーション適用済みの DB を検査する（CI 用。Supabase のローカル DB などへ接続）。
 *
 *   npm run db:check -- --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres [--out <json>]
 *   npm run db:check -- --db-url postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres --runtime
 *
 * 検査内容は checks.mjs を参照。不合格なら終了コード 1。
 * 既定では読み取り（カタログ参照）だけで、DB は変更しない。
 * --runtime を付けると権限境界の実行時検査も行う（試験データを作って rollback する。
 * スーパーユーザー接続が必要。使い捨て DB 専用で、本番では使わない）。
 */
import fs from 'node:fs';
import pg from 'pg';
import { checkExitCode, evaluate, inspect, printResult, printRuntime, runtimeSecurity } from './checks.mjs';

const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const url = arg('--db-url') ?? process.env.REHEARSAL_DATABASE_URL;
if (!url) {
  console.error('--db-url（または REHEARSAL_DATABASE_URL）を指定してください');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('set default_transaction_read_only = on');
  const schema = await inspect(client);
  const result = evaluate(schema);
  printResult(result);
  let runtime = null;
  if (argv.includes('--runtime')) {
    await client.query('set default_transaction_read_only = off');
    await client.query("set statement_timeout = '5s'");
    await client.query("set lock_timeout = '2s'");
    runtime = await runtimeSecurity(client);
    printRuntime(runtime);
  }
  const out = arg('--out');
  if (out) fs.writeFileSync(out, JSON.stringify({ schema, result, runtime }, null, 1));
  process.exitCode = checkExitCode(result, runtime);
} finally {
  await client.end();
}
