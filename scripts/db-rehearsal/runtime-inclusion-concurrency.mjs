/**
 * Equipment inclusion optimistic-lock test, running on disposable local Supabase ONLY.
 * Uses two real DB sessions. Seeded fixtures are committed so both can read them,
 * then removed. This must never run against a production or remote database.
 */
import pg from 'pg';

const ids = {
  admin: '00000000-0000-4000-8000-00000000f801',
  source: '00000000-0000-4000-8000-00000000f820',
  ub: '00000000-0000-4000-8000-00000000f810',
  toilet: '00000000-0000-4000-8000-00000000f811',
  wash: '00000000-0000-4000-8000-00000000f812',
};
const saveSql = 'select public.set_option_included_categories($1::uuid,$2::uuid[],$3::uuid[]) as categories';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function beginAsAdmin(client) {
  await client.query('begin');
  await client.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ role: 'authenticated', sub: ids.admin }),
  ]);
  await client.query('set local role authenticated');
}

export async function runtimeInclusionConcurrentSave(connectionString) {
  const u = new URL(connectionString);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) ||
      u.port !== '54322' || u.pathname !== '/postgres' ||
      u.protocol !== 'postgresql:') {
    throw new Error('REFUSED: concurrency test requires disposable local Supabase');
  }
  const setup = new pg.Client({ connectionString, statement_timeout: 10000 });
  const first = new pg.Client({ connectionString, statement_timeout: 10000 });
  const second = new pg.Client({ connectionString, statement_timeout: 10000 });
  const connected = [];
  let fixturesCreated = false;
  const results = [];
  const record = (step, expected, actual) => {
    const value = String(actual);
    results.push({ step, expected: String(expected), actual: value, ok: String(expected) === value });
  };

  try {
    for (const client of [setup, first, second]) {
      await client.connect();
      connected.push(client);
    }
    // The CI runner starts with a fresh database. Never run against existing fixtures.
    const existing = await setup.query('select count(*)::int as n from public.options where id = $1::uuid', [ids.source]);
    if (existing.rows[0].n !== 0) throw new Error('REFUSED: race fixture already exists');

    await setup.query('begin');
    await setup.query("set local session_replication_role = 'replica'");
    await setup.query(
      "insert into auth.users (id,email,raw_user_meta_data) values ($1::uuid,'inclusion-race@runtime.invalid','{}'::jsonb)",
      [ids.admin],
    );
    await setup.query(
      "insert into public.profiles (id,email,full_name,role_code) values ($1::uuid,'inclusion-race@runtime.invalid','設備包含同時保存','admin')",
      [ids.admin],
    );
    await setup.query(
      "insert into public.option_categories (id,code,name,group_code,group_name,status) values ($1::uuid,'runtime-inclusion-race-ub','浴室','equipment','設備機器','published'), ($2::uuid,'runtime-inclusion-race-toilet','トイレ','equipment','設備機器','published'), ($3::uuid,'runtime-inclusion-race-wash','洗面','equipment','設備機器','published')",
      [ids.ub, ids.toilet, ids.wash],
    );
    await setup.query(
      "insert into public.options (id,category_id,code,name,status,product_no) values ($1::uuid,$2::uuid,'runtime-inclusion-race-source','同時保存の3点ユニット','published','PRD-999991')",
      [ids.source, ids.ub],
    );
    await setup.query('commit');
    fixturesCreated = true;

    await beginAsAdmin(first);
    const a = await first.query(saveSql, [ids.source, [], [ids.toilet]]);
    record('A saves first category', ids.toilet, a.rows[0].categories[0]);

    await beginAsAdmin(second);
    const pid = Number((await second.query('select pg_backend_pid() as pid')).rows[0].pid);
    let settled = false;
    const pending = second.query(saveSql, [ids.source, [], [ids.wash]])
      .then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
      .finally(() => { settled = true; });

    let waitingForLock = false;
    for (let i = 0; i < 35 && !settled; i += 1) {
      const observed = await setup.query(
        'select exists (select 1 from pg_locks where pid=$1 and not granted) as waiting', [pid],
      );
      if (observed.rows[0].waiting) { waitingForLock = true; break; }
      await wait(20);
    }
    record('Second session waits on row lock', true, waitingForLock && !settled);

    await first.query('commit');
    const b = await pending;
    await second.query(b.ok ? 'commit' : 'rollback');
    record('Stale save cannot overwrite successful save', true,
      !b.ok && /CONFLICT:/.test(b.error?.message ?? ''));

    const current = await setup.query(
      'select included_category_id from public.option_included_categories where option_id=$1::uuid',
      [ids.source],
    );
    record('Only first category is present', ids.toilet,
      current.rows.length === 1 ? current.rows[0].included_category_id : 'unexpected row count');

    const audit = await setup.query(
      "select count(*)::int as n from public.audit_logs where entity_id=$1::uuid and action='option.included_categories.save'",
      [ids.source],
    );
    record('Only successful save is audited', 1, audit.rows[0].n);

    await beginAsAdmin(second);
    const retry = await second.query(saveSql, [ids.source, [ids.toilet], [ids.toilet, ids.wash]]);
    await second.query('commit');
    record('Refreshed save succeeds', 2, retry.rows[0].categories.length);
    const final = await setup.query(
      'select count(*)::int as n from public.option_included_categories where option_id=$1::uuid',
      [ids.source],
    );
    record('Both categories persist after retry', 2, final.rows[0].n);
    for (const test of results) {
      console.log((test.ok ? 'PASS ' : 'FAIL ') + test.step + ' [expected=' + test.expected + ', actual=' + test.actual + ']');
    }
    if (!results.length || results.some((test) => !test.ok)) {
      throw new Error('Inclusion concurrency checks failed');
    }
    return results;
  } finally {
    await first.query('rollback').catch(() => {});
    await second.query('rollback').catch(() => {});
    if (fixturesCreated && connected.includes(setup)) {
      await setup.query('rollback').catch(() => {});
      try {
        await setup.query('begin');
        await setup.query("set local session_replication_role = 'replica'");
        await setup.query('delete from public.option_included_categories where option_id=$1::uuid', [ids.source]);
        await setup.query(
          "delete from public.audit_logs where entity_id=$1::uuid and action='option.included_categories.save'",
          [ids.source],
        );
        await setup.query('delete from public.options where id=$1::uuid', [ids.source]);
        await setup.query('delete from public.option_categories where id=any($1::uuid[])', [[ids.ub, ids.toilet, ids.wash]]);
        await setup.query('delete from public.profiles where id=$1::uuid', [ids.admin]);
        await setup.query('delete from auth.users where id=$1::uuid', [ids.admin]);
        await setup.query('commit');
      } catch (error) {
        await setup.query('rollback').catch(() => {});
        throw new Error('Inclusion race cleanup failed: ' + String(error));
      }
    }
    for (const client of connected.reverse()) await client.end().catch(() => {});
  }
}
