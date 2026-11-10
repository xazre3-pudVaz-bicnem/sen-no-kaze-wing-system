/**
 * REVIEW-ONLY: run the proposed inclusion SQL against disposable local Supabase.
 * This script rejects ALL non-local connections before sending any query.
 * It is not a production migration, and never calls Supabase production APIs.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const dbUrl = process.env.EQUIPMENT_INCLUSION_REVIEW_DB_URL;
if (!dbUrl) throw new Error('EQUIPMENT_INCLUSION_REVIEW_DB_URL is required (disposable DB only)');
const u = new URL(dbUrl);
if (u.protocol !== 'postgresql:' ||
    !['127.0.0.1', 'localhost'].includes(u.hostname) ||
    u.port !== '54322' ||
    u.pathname !== '/postgres') {
  throw new Error('REFUSED: only the disposable local Supabase database at 127.0.0.1:54322/postgres is allowed');
}

const client = new pg.Client({ connectionString: dbUrl, statement_timeout: 10000, query_timeout: 15000 });
await client.connect();
try {
  const exists = await client.query("select to_regclass('public.option_included_categories') as inclusion_table");
  if (exists.rows[0].inclusion_table !== null) {
    throw new Error('REFUSED: inclusion table already exists; not a disposable baseline');
  }
  const proposal = fs.readFileSync(
    path.join(process.cwd(), 'docs/equipment-inclusion/proposed-schema-and-rpc.sql'),
    'utf8',
  );
  // This commits only to the disposable local database created by the CI job.
  await client.query(proposal);
  const assertions = fs.readFileSync(
    path.join(process.cwd(), 'scripts/db-rehearsal/runtime-inclusion-proposal.sql'),
    'utf8',
  );
  const response = await client.query(assertions);
  const results = Array.isArray(response) ? response : [response];
  const checks = results.find((r) => Array.isArray(r.rows) && r.rows[0]?.checks)?.rows[0]?.checks ?? [];
  for (const c of checks) console.log((c.ok ? 'PASS' : 'FAIL') + ': ' + c.step + '; expected ' + c.expected + '; actual ' + c.actual);
  if (checks.length === 0 || checks.some((c) => !c.ok)) {
    throw new Error('One or more inclusion runtime checks failed');
  }
  console.log('Passed ' + checks.length + ' inclusion RPC/schema checks on disposable local Supabase');
} catch (error) {
  await client.query('rollback').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
