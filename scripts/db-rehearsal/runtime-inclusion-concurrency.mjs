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
  const insertedCategoryIds = [];
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
    // Only a disposable DB can be used; never overwrite existing fixture products.
    const existing = await setup.query('select count(*)::int as n from public.options where id = $1::uuid', [ids.source]);
    if (existing.rows[0].n !== 0) throw new Error('REFUSED: race fixture already exists');

    await setup.query('begin');
    await setup.query("set local session_replication_role = 'replica'");
    // Some local migration baselines have no catalog records; seed only missing codes.
    const seeded = await setup.query(
      "insert into public.option_categories(id,code,name,group_code,group_name,status) values ($1::uuid,'ub','検証浴室','equipment','設備機器','published'), ($2::uuid,'toilet','検証トイレ','equipment','設備機器','published'), ($3::uuid,'washbasin','検証洗面','equipment','設備機器','published') on conflict (code) do nothing returning id",
      [ids.ub, ids.toilet, ids.wash],
    );
    insertedCategoryIds.push(...seeded.rows.map((row) => row.id));
    const categories = await setup.query(
      "select code,id from public.option_categories where code = any($1::text[]) and status='published'",
      [['ub', 'toilet', 'washbasin']],
    );
    const byCode = new Map(categories.rows.map((row) => [row.code, row.id]));
    if (byCode.size !== 3) throw new Error('REFUSED: canonical ub/toilet/washbasin categories missing or unpublished');
    ids.ub = byCode.get('ub');
    ids.toilet = byCode.get('toilet');
    ids.wash = byCode.get('washbasin');
    await setup.query(
      "insert into auth.users (id,email,raw_user_meta_data) values ($1::uuid,'inclusion-race@runtime.invalid','{}'::jsonb)",
      [ids.admin],
    );
    await setup.query(
      "insert into public.profiles (id,email,full_name,role_code) values ($1::uuid,'inclusion-race@runtime.invalid','設備包含同時保存','admin')",
      [ids.admin],
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

    // Category change racing an inclusion save must not leave a self-inclusive product.
    await beginAsAdmin(first);
    await first.query(saveSql, [ids.source, [ids.toilet, ids.wash], [ids.wash]]);
    await beginAsAdmin(second);
    const categoryWriterPid = Number((await second.query('select pg_backend_pid() as pid')).rows[0].pid);
    let categorySettled = false;
    const categoryUpdate = second.query(
      'update public.options set category_id=$1::uuid where id=$2::uuid returning category_id',
      [ids.wash, ids.source],
    ).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    ).finally(() => { categorySettled = true; });
    let categoryWaited = false;
    for (let i = 0; i < 35 && !categorySettled; i += 1) {
      const observed = await setup.query(
        'select exists(select 1 from pg_locks where pid=$1 and not granted) as waiting',
        [categoryWriterPid],
      );
      if (observed.rows[0].waiting) { categoryWaited = true; break; }
      await wait(20);
    }
    record('Category update waits for inclusion save', true, categoryWaited && !categorySettled);
    await first.query('commit');
    const categoryResult = await categoryUpdate;
    await second.query(categoryResult.ok ? 'commit' : 'rollback');
    record('Category update cannot create self-inclusion after concurrent save', true,
      !categoryResult.ok && /VALIDATION:/.test(categoryResult.error?.message ?? ''));
    const invariant = await setup.query(
      'select o.category_id, array_agg(rel.included_category_id) as included_ids from public.options o join public.option_included_categories rel on rel.option_id=o.id where o.id=$1::uuid group by o.category_id',
      [ids.source],
    );
    record('Concurrent update preserves original product category', ids.ub,
      invariant.rows[0]?.category_id ?? 'missing product');
    record('Concurrent update preserves non-self-inclusion', true,
      !(invariant.rows[0]?.included_ids ?? []).includes(invariant.rows[0]?.category_id));

    // Category-first race: target code edit wins its row lock before the
    // inclusion RPC tries FOR SHARE. The RPC must wait and re-validate code.
    await beginAsAdmin(second);
    const changedToiletCode = await second.query(
      "update public.option_categories set code='runtime-toilet-renamed' where id=$1::uuid returning code",
      [ids.toilet],
    );
    record('Unreferenced target code update starts normally', 'runtime-toilet-renamed',
      changedToiletCode.rows[0]?.code);
    await beginAsAdmin(first);
    const categoryFirstSavePid = Number((await first.query('select pg_backend_pid() as pid')).rows[0].pid);
    let saveSettled = false;
    const waitingSave = first.query(saveSql, [ids.source, [ids.wash], [ids.toilet, ids.wash]])
      .then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
      .finally(() => { saveSettled = true; });
    let saveWaited = false;
    for (let i = 0; i < 35 && !saveSettled; i += 1) {
      const observed = await setup.query(
        'select exists(select 1 from pg_locks where pid=$1 and not granted) as waiting',
        [categoryFirstSavePid],
      );
      if (observed.rows[0].waiting) { saveWaited = true; break; }
      await wait(20);
    }
    record('Save waits for in-flight category code change', true, saveWaited && !saveSettled);
    await second.query('commit');
    const codeChangeSave = await waitingSave;
    await first.query(codeChangeSave.ok ? 'commit' : 'rollback');
    record('Save rejects renamed target after category update commits', true,
      !codeChangeSave.ok && /VALIDATION:/.test(codeChangeSave.error?.message ?? ''));
    const rejectedSaveLinks = await setup.query(
      'select included_category_id from public.option_included_categories where option_id=$1::uuid',
      [ids.source],
    );
    record('Failed target-race save keeps original washbasin-only relation', ids.wash,
      rejectedSaveLinks.rows.length === 1 ? rejectedSaveLinks.rows[0].included_category_id : 'unexpected rows');
    await setup.query("update public.option_categories set code='toilet' where id=$1::uuid", [ids.toilet]);

    // Save-first race: the RPC's FOR SHARE on target rows must make a
    // concurrent category status update wait; after commit the trigger refuses.
    await beginAsAdmin(first);
    await first.query(saveSql, [ids.source, [ids.wash], [ids.wash, ids.toilet]]);
    await beginAsAdmin(second);
    const categoryStatusPid = Number((await second.query('select pg_backend_pid() as pid')).rows[0].pid);
    let statusSettled = false;
    const waitingStatus = second.query(
      "update public.option_categories set status='draft' where id=$1::uuid returning status",
      [ids.toilet],
    ).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
      .finally(() => { statusSettled = true; });
    let statusWaited = false;
    for (let i = 0; i < 35 && !statusSettled; i += 1) {
      const observed = await setup.query(
        'select exists(select 1 from pg_locks where pid=$1 and not granted) as waiting',
        [categoryStatusPid],
      );
      if (observed.rows[0].waiting) { statusWaited = true; break; }
      await wait(20);
    }
    record('Category status update waits for in-flight inclusion save', true,
      statusWaited && !statusSettled);
    await first.query('commit');
    const categoryStatusUpdate = await waitingStatus;
    await second.query(categoryStatusUpdate.ok ? 'commit' : 'rollback');
    record('Referenced category cannot become draft after save commits', true,
      !categoryStatusUpdate.ok && /VALIDATION:/.test(categoryStatusUpdate.error?.message ?? ''));
    const targetStatus = await setup.query(
      'select status from public.option_categories where id=$1::uuid', [ids.toilet],
    );
    record('Concurrent category state remains published', 'published', targetStatus.rows[0]?.status);

    // Source category has the same protection, including no-op inclusion saves.
    await beginAsAdmin(first);
    const noChange = await first.query(saveSql,
      [ids.source, [ids.wash, ids.toilet], [ids.wash, ids.toilet]]);
    record('Unchanged inclusion save is allowed during source guard check', 2,
      noChange.rows[0].categories.length);
    await beginAsAdmin(second);
    const sourceCategoryPid = Number((await second.query('select pg_backend_pid() as pid')).rows[0].pid);
    let sourceSettled = false;
    const waitingSource = second.query(
      "update public.option_categories set code='runtime-renamed-ub' where id=$1::uuid returning code",
      [ids.ub],
    ).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))
      .finally(() => { sourceSettled = true; });
    let sourceWaited = false;
    for (let i = 0; i < 35 && !sourceSettled; i += 1) {
      const observed = await setup.query(
        'select exists(select 1 from pg_locks where pid=$1 and not granted) as waiting',
        [sourceCategoryPid],
      );
      if (observed.rows[0].waiting) { sourceWaited = true; break; }
      await wait(20);
    }
    record('UB source rename waits for inclusion transaction', true,
      sourceWaited && !sourceSettled);
    await first.query('commit');
    const sourceResult = await waitingSource;
    await second.query(sourceResult.ok ? 'commit' : 'rollback');
    record('Referenced UB category cannot be renamed', true,
      !sourceResult.ok && /VALIDATION:/.test(sourceResult.error?.message ?? ''));
    const sourceCode = await setup.query(
      'select code from public.option_categories where id=$1::uuid', [ids.ub],
    );
    record('Concurrent UB source category code stays unchanged', 'ub', sourceCode.rows[0]?.code);
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
    if (connected.includes(setup)) await setup.query('rollback').catch(() => {});
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
        if (insertedCategoryIds.length > 0) {
          await setup.query('delete from public.option_categories where id = any($1::uuid[])', [insertedCategoryIds]);
        }
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
