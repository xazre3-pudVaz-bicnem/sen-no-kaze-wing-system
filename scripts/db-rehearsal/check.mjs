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
import { checkExitCode, evaluate, inspect, mergeRuntime, printResult, printRuntime, runtimeSecurity } from './checks.mjs';
import { runtimeConcurrency } from './runtime-concurrency.mjs';
import { runtimeOptionHqStandardCost } from './runtime-option-hq-standard-cost.mjs';
import { runtimeOptionStandardCostVersions } from './runtime-option-standard-cost-versions.mjs';
import { runtimePricingV25 } from './runtime-pricing-v25.mjs';
import { runtimeUnusedPublishedOptionDelete } from './runtime-unused-published-option-delete.mjs';
import { runtimeUnusedPublishedOptionArrayRace } from './runtime-unused-published-option-array-race.mjs';
import { runtimeUnusedPublishedOptionWriterOrder } from './runtime-unused-published-option-writer-order.mjs';
import { runtimeConfigurationVariantAssignment } from './runtime-configuration-variant-assignment.mjs';
import { runtimeProductLifecycle } from './runtime-product-lifecycle.mjs';
import { runtimeLifecycleConcurrency } from './runtime-product-lifecycle-concurrency.mjs';
import { runtimeConfigurationSpecGuard } from './runtime-configuration-spec-guard.mjs';

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
    runtime = mergeRuntime(runtime, await runtimeUnusedPublishedOptionDelete(client, { connectionString: url }));
    runtime = mergeRuntime(runtime, await runtimeUnusedPublishedOptionArrayRace({ connectionString: url }));
    runtime = mergeRuntime(runtime, await runtimeUnusedPublishedOptionWriterOrder({ connectionString: url }));
    // 同時編集（optimistic locking）は 2 本の接続が必要なため、別の接続で実行する
    runtime = mergeRuntime(runtime, await runtimeConcurrency({ connectionString: url }));
    runtime = mergeRuntime(runtime, await runtimeOptionHqStandardCost(client, { connectionString: url }));
    runtime = mergeRuntime(runtime, await runtimeOptionStandardCostVersions(client, { connectionString: url }));
    // 正式計算は DB の結果を、手で検算した値と TypeScript の同じ計算の両方と突き合わせる
    runtime = mergeRuntime(runtime, await runtimePricingV25(client));
    runtime = mergeRuntime(runtime, await runtimeConfigurationVariantAssignment(client));
    runtime = mergeRuntime(runtime, await runtimeProductLifecycle(client));
    // 取扱終了と保存・提出・発行の同時実行は 2 本の接続が必要なため、別の接続で実行する
    runtime = mergeRuntime(runtime, await runtimeLifecycleConcurrency({ connectionString: url }));
    // #389 の安全機構（本体分類表・明細の保護）を今のマトリクス方式で確かめる。同時実行は 2 本の接続を使う
    runtime = mergeRuntime(runtime, await runtimeConfigurationSpecGuard(client, { connectionString: url }));
    printRuntime(runtime);
  }
  const out = arg('--out');
  if (out) fs.writeFileSync(out, JSON.stringify({ schema, result, runtime }, null, 1));
  process.exitCode = checkExitCode(result, runtime);
} finally {
  await client.end();
}
