/**
 * マイグレーション適用済みの DB を検査する（CI 用。Supabase のローカル DB などへ接続）。
 *
 *   npm run db:check -- --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres [--out <json>]
 *
 * 検査内容は checks.mjs を参照。不合格なら終了コード 1。
 * 読み取り（カタログ参照）だけで、DB は変更しない。
 */
import fs from 'node:fs';
import pg from 'pg';
import { evaluate, inspect, printResult } from './checks.mjs';

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
  const out = arg('--out');
  if (out) fs.writeFileSync(out, JSON.stringify({ schema, result }, null, 1));
  process.exitCode = result.ok ? 0 : 1;
} finally {
  await client.end();
}
