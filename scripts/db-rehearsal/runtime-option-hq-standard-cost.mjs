import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RACE_USER = '10000000-0000-4000-8000-000000000011';
const RACE_CATEGORY = '10000000-0000-4000-8000-000000000211';
const RACE_OPTION = '10000000-0000-4000-8000-000000000311';

async function runSingleConnectionChecks(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-option-hq-standard-cost.sql'), 'utf8').split('\r').join('');
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

async function seedRaceFixture(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local session_replication_role = replica');
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, 'hq-cost-race@runtime.invalid', '{}'::jsonb)`,
      [RACE_USER]
    );
    await client.query(
      `insert into public.profiles (id, email, full_name, role_code)
       values ($1, 'hq-cost-race@runtime.invalid', 'HQ cost race admin', 'admin')`,
      [RACE_USER]
    );
    await client.query(
      `insert into public.option_categories (id, code, name, status)
       values ($1, 'runtime-hq-cost-race-category', '本部基準原価Race', 'published')`,
      [RACE_CATEGORY]
    );
    await client.query(
      `insert into public.options (id, category_id, code, name, price, status, product_no)
       values ($1, $2, 'runtime-hq-cost-race-option', '原価Race商品', 150000, 'draft', 'PRD-999993')`,
      [RACE_OPTION, RACE_CATEGORY]
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function cleanupRaceFixture(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local session_replication_role = replica');
    await client.query('delete from public.audit_logs where entity_id = $1', [RACE_OPTION]);
    await client.query('delete from public.option_hq_standard_costs where option_id = $1', [RACE_OPTION]);
    await client.query('delete from public.options where id = $1', [RACE_OPTION]);
    await client.query('delete from public.option_categories where id = $1', [RACE_CATEGORY]);
    await client.query('delete from public.profiles where id = $1', [RACE_USER]);
    await client.query('delete from auth.users where id = $1', [RACE_USER]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function beginAuthenticated(client) {
  await client.query('begin');
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: 'authenticated', sub: RACE_USER }),
  ]);
  await client.query('set local role authenticated');
}

async function runFirstSetRace(connectionString) {
  const results = [];
  const a = new pg.Client({ connectionString });
  const b = new pg.Client({ connectionString });
  const verify = new pg.Client({ connectionString });

  await seedRaceFixture(connectionString);
  await Promise.all([a.connect(), b.connect(), verify.connect()]);

  try {
    await beginAuthenticated(a);
    const aResult = await a.query(
      `select standard_cost, lock_version, changed
         from public.set_option_hq_standard_cost($1, 111000, 0, '同時初回設定A')`,
      [RACE_OPTION]
    );

    await beginAuthenticated(b);
    const bPromise = b
      .query(
        `select standard_cost, lock_version, changed
           from public.set_option_hq_standard_cost($1, 222000, 0, '同時初回設定B')`,
        [RACE_OPTION]
      )
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({ ok: false, error }));

    await new Promise((resolve) => setTimeout(resolve, 150));
    await a.query('commit');

    const bResult = await bPromise;
    await b.query('rollback').catch(() => {});

    const first = aResult.rows[0];
    results.push({
      step: '同時初回設定の先行transactionはversion 1で成功する',
      expected: '111000/1/true',
      actual: `${first?.standard_cost}/${first?.lock_version}/${first?.changed}`,
      ok: Number(first?.standard_cost) === 111000 && Number(first?.lock_version) === 1 && first?.changed === true,
    });

    results.push({
      step: '同時初回設定の後続transactionはexpected=0競合で失敗する',
      expected: 'P0001',
      actual: bResult.ok ? 'success' : bResult.error?.code ?? '(no code)',
      ok: !bResult.ok && bResult.error?.code === 'P0001',
    });

    const persisted = await verify.query(
      `select standard_cost, lock_version,
              (select count(*) from public.audit_logs where entity='option_hq_standard_cost' and entity_id=$1) as audits
         from public.option_hq_standard_costs
        where option_id=$1`,
      [RACE_OPTION]
    );
    const row = persisted.rows[0];
    results.push({
      step: '競合後も先行値だけが残り監査も1件だけ残る',
      expected: '111000/1/1',
      actual: `${row?.standard_cost}/${row?.lock_version}/${row?.audits}`,
      ok: Number(row?.standard_cost) === 111000 && Number(row?.lock_version) === 1 && Number(row?.audits) === 1,
    });
  } catch (error) {
    await a.query('rollback').catch(() => {});
    await b.query('rollback').catch(() => {});
    return { ok: false, results, error: error.message };
  } finally {
    await Promise.all([a.end(), b.end(), verify.end()]);
    await cleanupRaceFixture(connectionString).catch((error) => {
      results.push({
        step: '同時初回設定fixtureを後始末する',
        expected: 'cleanup success',
        actual: error.message,
        ok: false,
      });
    });
  }

  return { ok: results.length > 0 && results.every((item) => item.ok), results };
}

export async function runtimeOptionHqStandardCost(client, { connectionString }) {
  const single = await runSingleConnectionChecks(client);
  if (!single.ok) return single;
  const race = await runFirstSetRace(connectionString);
  return {
    ok: single.ok && race.ok,
    results: [...single.results, ...race.results],
    ...(race.error ? { error: race.error } : {}),
  };
}
