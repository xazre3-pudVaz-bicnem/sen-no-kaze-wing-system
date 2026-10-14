import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BUSY_MESSAGE = '現在ほかの処理で使用中のため削除できません';

async function waitForRelationLock(client, pid, relation, mode, granted, timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await client.query(
      `select exists (
         select 1
           from pg_locks
          where pid = $1
            and relation = $2::regclass
            and mode = $3
            and granted = $4
       ) as ok`,
      [pid, relation, mode, granted]
    );
    if (res.rows[0]?.ok) return true;
    await delay(25);
  }
  return false;
}

/** safe-deleteが表のlockを待たず、間をおいてやり直している（pg_sleep中）ことを確かめる */
async function waitForRetrySleep(client, pid, timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await client.query(
      "select exists (select 1 from pg_stat_activity where pid = $1 and wait_event = 'PgSleep') as ok",
      [pid]
    );
    if (res.rows[0]?.ok) return true;
    await delay(20);
  }
  return false;
}

async function safeDeleteAsAdmin(client, adminId, optionId) {
  const started = Date.now();
  await client.query('begin');
  try {
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: 'authenticated', sub: adminId }),
    ]);
    await client.query('set local role authenticated');
    await client.query('select public.delete_unused_published_option($1::uuid)', [optionId]);
    await client.query('commit');
    return { ok: true, code: null, message: null, ms: Date.now() - started };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, code: error.code ?? null, message: error.message ?? String(error), ms: Date.now() - started };
  }
}

const isBusyAbort = (result) =>
  !result.ok && result.code === 'P0001' && String(result.message ?? '').includes(BUSY_MESSAGE);

async function cleanupConcurrencyFixtures(client, ids) {
  await client.query('begin');
  try {
    await client.query("set local session_replication_role = 'replica'");
    await client.query('delete from public.configuration_items where id = $1::uuid', [ids.item]);
    await client.query('delete from public.option_variant_choices where id = $1::uuid', [ids.choice]);
    await client.query('delete from public.option_variant_groups where id = any($1::uuid[])', [[ids.targetGroup, ids.peerGroup]]);
    await client.query('delete from public.options where id = any($1::uuid[])', [[ids.target, ids.peer, ids.timeoutTarget, ids.busyTarget]]);
    await client.query('delete from public.option_categories where id = $1::uuid', [ids.category]);
    await client.query('delete from public.profiles where id = $1::uuid', [ids.admin]);
    await client.query('delete from auth.users where id = $1::uuid', [ids.admin]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function setupConcurrencyFixtures(client, ids) {
  await cleanupConcurrencyFixtures(client, ids);
  await client.query('begin');
  try {
    await client.query("set local session_replication_role = 'replica'");
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1::uuid, 'unused-delete-concurrency-admin@runtime.invalid', '{}'::jsonb)`,
      [ids.admin]
    );
    await client.query(
      `insert into public.profiles (id, email, full_name, role_code)
       values ($1::uuid, 'unused-delete-concurrency-admin@runtime.invalid', '削除並行検査管理者', 'admin')`,
      [ids.admin]
    );
    await client.query(
      `insert into public.option_categories (id, code, name, status)
       values ($1::uuid, 'runtime-unused-delete-concurrency', '安全削除並行検査', 'published')`,
      [ids.category]
    );
    await client.query(
      `insert into public.options (id, category_id, code, name, status, product_no)
       values
         ($1::uuid, $5::uuid, 'runtime-delete-race-target', '並行削除対象', 'published', 'PRD-999971'),
         ($2::uuid, $5::uuid, 'runtime-delete-race-peer', '並行参照用', 'published', 'PRD-999972'),
         ($3::uuid, $5::uuid, 'runtime-delete-timeout-target', 'lock timeout検査対象', 'published', 'PRD-999973'),
         ($4::uuid, $5::uuid, 'runtime-delete-busy-target', '表の使用中検査対象', 'published', 'PRD-999974')`,
      [ids.target, ids.peer, ids.timeoutTarget, ids.busyTarget, ids.category]
    );
    await client.query(
      `insert into public.option_variant_groups (id, option_id, code, name, status)
       values
         ($1::uuid, $3::uuid, 'target-group', '削除対象group', 'published'),
         ($2::uuid, $4::uuid, 'peer-group', '参照元group', 'published')`,
      [ids.targetGroup, ids.peerGroup, ids.target, ids.peer]
    );
    await client.query(
      `insert into public.option_variant_choices (id, group_id, code, name, status)
       values ($1::uuid, $2::uuid, 'race-choice', '並行検査choice', 'published')`,
      [ids.choice, ids.peerGroup]
    );
    await client.query(
      `insert into public.configuration_items (id, configuration_id, option_id, quantity, variant_choice_ids)
       values ($1::uuid, $2::uuid, $3::uuid, 1, array[$4::uuid])`,
      [ids.item, ids.configuration, ids.peer, ids.choice]
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function runtimeSafeDeleteConcurrency({ connectionString }) {
  if (!connectionString) {
    return {
      ok: false,
      results: [{ step: 'unused-delete concurrency', expected: 'connectionString', actual: 'missing', ok: false }],
    };
  }

  const ids = {
    admin: '00000000-0000-4000-8000-00000000d201',
    category: '00000000-0000-4000-8000-00000000d210',
    target: '00000000-0000-4000-8000-00000000d211',
    peer: '00000000-0000-4000-8000-00000000d212',
    timeoutTarget: '00000000-0000-4000-8000-00000000d213',
    busyTarget: '00000000-0000-4000-8000-00000000d214',
    targetGroup: '00000000-0000-4000-8000-00000000d220',
    peerGroup: '00000000-0000-4000-8000-00000000d221',
    choice: '00000000-0000-4000-8000-00000000d222',
    item: '00000000-0000-4000-8000-00000000d223',
    configuration: '00000000-0000-4000-8000-00000000d224',
  };

  const setup = new pg.Client({ connectionString });
  const blocker = new pg.Client({ connectionString });
  const deleter = new pg.Client({ connectionString });
  const mover = new pg.Client({ connectionString });
  const observer = new pg.Client({ connectionString });
  const timeoutBlocker = new pg.Client({ connectionString });
  const timeoutDeleter = new pg.Client({ connectionString });
  const busyBlocker = new pg.Client({ connectionString });
  const busyDeleter = new pg.Client({ connectionString });
  const clients = [setup, blocker, deleter, mover, observer, timeoutBlocker, timeoutDeleter, busyBlocker, busyDeleter];
  const results = [];

  for (const client of clients) {
    await client.connect();
    await client.query("set statement_timeout = '8s'");
  }

  try {
    await setupConcurrencyFixtures(setup, ids);

    // variant所属変更race:
    // safe-deleteは対象Option行を確保した後、表のSHARE lockを待たずに取りにいき、取れなければ間をおいてやり直す。
    // variant choice tableをACCESS EXCLUSIVEで一時停止してsafe-deleteをやり直し中にし、group_id変更writerを後ろへ並べる。
    // 解放後はwriterが先に通り、移ったchoiceはConfigurationから参照されているので、safe-deleteは使用中として削除しない。
    await blocker.query('begin');
    await blocker.query('lock table public.option_variant_choices in access exclusive mode');

    const deleterPid = Number((await deleter.query('select pg_backend_pid() as pid')).rows[0].pid);
    const deletePromise = safeDeleteAsAdmin(deleter, ids.admin, ids.target);
    const deleteRetries = await waitForRetrySleep(observer, deleterPid);
    const deleteWaitsForShare = await waitForRelationLock(observer, deleterPid, 'public.option_variant_choices', 'ShareLock', false, 200);
    results.push({
      step: 'unused-delete concurrency 1-1 safe-deleteは使用中の表のlockを待たず、間をおいてやり直す',
      expected: 'retry=true wait=false',
      actual: `retry=${deleteRetries} wait=${deleteWaitsForShare}`,
      ok: deleteRetries && !deleteWaitsForShare,
    });

    await mover.query('begin');
    const moverPid = Number((await mover.query('select pg_backend_pid() as pid')).rows[0].pid);
    const movePromise = mover
      .query('update public.option_variant_choices set group_id = $1::uuid where id = $2::uuid', [ids.targetGroup, ids.choice])
      .then(async () => {
        await mover.query('commit');
        return { ok: true, code: null };
      })
      .catch(async (error) => {
        await mover.query('rollback').catch(() => {});
        return { ok: false, code: error.code ?? null, message: error.message ?? String(error) };
      });

    const moverWaits = await waitForRelationLock(observer, moverPid, 'public.option_variant_choices', 'RowExclusiveLock', false);
    results.push({
      step: 'unused-delete concurrency 1-2 variant所属変更raceのwriterは表の解放を待つ',
      expected: 'true',
      actual: String(moverWaits),
      ok: moverWaits,
    });

    await blocker.query('commit');
    const [deleteResult, moveResult] = await Promise.all([deletePromise, movePromise]);
    const raceState = (
      await setup.query(
        `select
           exists(select 1 from public.options where id = $1::uuid) as target_exists,
           (select group_id::text from public.option_variant_choices where id = $2::uuid) as choice_group,
           exists(
             select 1 from public.configuration_items ci
             join public.option_variant_choices vc on vc.id = $2::uuid
             where ci.id = $3::uuid and $2::uuid = any(ci.variant_choice_ids)
           ) as configuration_ref_intact`,
        [ids.target, ids.choice, ids.item]
      )
    ).rows[0];
    // 安全な結果は2通りだけ：(a) writerが先に通り、使用中になったtargetは削除しない
    //                       (b) safe-deleteが先に通り、待っていたwriterは削除済みgroupへのFK変更を23503で拒否される
    const targetExists = raceState.target_exists === true;
    const writerFirst = moveResult.ok && !deleteResult.ok && targetExists && raceState.choice_group === ids.targetGroup;
    const deleteFirst =
      deleteResult.ok && !moveResult.ok && moveResult.code === '23503' && !targetExists && raceState.choice_group === ids.peerGroup;
    results.push({
      step: 'unused-delete concurrency 1-3 variant所属変更raceは使用中の商品を削除せず、どちらかが安全に止まる',
      expected: 'writer-first(delete=VALIDATION) or delete-first(move=23503)',
      actual: `delete=${deleteResult.ok ? 'success' : `${deleteResult.code} ${deleteResult.message ?? ''}`.trim()} move=${moveResult.ok ? 'success' : moveResult.code} target=${raceState.target_exists} group=${raceState.choice_group}`,
      ok: (writerFirst && String(deleteResult.message ?? '').startsWith('VALIDATION:')) || deleteFirst,
    });
    results.push({
      step: 'unused-delete concurrency 1-4 Configurationのchoice参照は存在するchoiceを指したまま保全される',
      expected: 'true',
      actual: String(raceState.configuration_ref_intact),
      ok: raceState.configuration_ref_intact === true,
    });

    // 商品行のlock：targetを別transactionが保持し続けても、lock_timeoutで待ちを打ち切り、
    // rawの55P03ではなく再試行できる業務エラーで安全に止まる。
    await timeoutBlocker.query('begin');
    await timeoutBlocker.query('select 1 from public.options where id = $1::uuid for update', [ids.timeoutTarget]);
    const timeoutResult = await safeDeleteAsAdmin(timeoutDeleter, ids.admin, ids.timeoutTarget);
    results.push({
      step: 'unused-delete concurrency 2-1 option行競合はlock_timeoutで打ち切り、使用中として安全に止まる',
      expected: `P0001 ${BUSY_MESSAGE}`,
      actual: timeoutResult.ok ? 'success' : `${timeoutResult.code} ${timeoutResult.message ?? ''}`.trim(),
      ok: isBusyAbort(timeoutResult),
    });
    await timeoutBlocker.query('rollback');
    const timeoutStillExists = Boolean(
      (await setup.query('select exists(select 1 from public.options where id = $1::uuid) as ok', [ids.timeoutTarget])).rows[0].ok
    );
    results.push({
      step: 'unused-delete concurrency 2-2 lock timeout時は商品を削除しない',
      expected: 'true',
      actual: String(timeoutStillExists),
      ok: timeoutStillExists,
    });

    // 表の使用中：保存中のtransactionがconfigurationsを書込みlockしたまま長く続いても、
    // safe-deleteは待ち続けず、やり直しの上限で使用中として止まる。
    await busyBlocker.query('begin');
    await busyBlocker.query('lock table public.configurations in row exclusive mode');
    const busyResult = await safeDeleteAsAdmin(busyDeleter, ids.admin, ids.busyTarget);
    await busyBlocker.query('rollback');
    const busyStillExists = Boolean(
      (await setup.query('select exists(select 1 from public.options where id = $1::uuid) as ok', [ids.busyTarget])).rows[0].ok
    );
    results.push({
      step: 'unused-delete concurrency 3-1 表が使用中のままなら待ち続けず、使用中として商品を残す',
      expected: `P0001 ${BUSY_MESSAGE} / 5秒未満 / 商品あり`,
      actual: `${busyResult.ok ? 'success' : `${busyResult.code} ${busyResult.message ?? ''}`.trim()} / ${busyResult.ms}ms / 商品${busyStillExists ? 'あり' : 'なし'}`,
      ok: isBusyAbort(busyResult) && busyResult.ms < 5000 && busyStillExists,
    });
  } catch (error) {
    results.push({
      step: 'unused-delete concurrency unexpected error',
      expected: 'no error',
      actual: `${error.code ?? ''} ${error.message ?? String(error)}`.trim(),
      ok: false,
    });
  } finally {
    for (const client of [blocker, mover, timeoutBlocker, busyBlocker, deleter, timeoutDeleter, busyDeleter]) {
      await client.query('rollback').catch(() => {});
    }
    await cleanupConcurrencyFixtures(setup, ids).catch((error) => {
      results.push({
        step: 'unused-delete concurrency cleanup',
        expected: 'success',
        actual: error.message ?? String(error),
        ok: false,
      });
    });
    for (const client of clients) {
      await client.end().catch(() => {});
    }
  }

  return { ok: results.length > 0 && results.every((row) => row.ok), results };
}

export async function runtimeUnusedPublishedOptionDelete(client, { connectionString } = {}) {
  const sql = fs
    .readFileSync(path.join(HERE, 'runtime-unused-published-option-delete.sql'), 'utf8')
    .split('\r')
    .join('');
  let results = [];
  try {
    const res = await client.query(sql);
    results = (Array.isArray(res) ? res : [res]).find((row) => row.rows?.[0]?.j)?.rows[0].j ?? [];
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, results, error: error.message };
  }

  const concurrency = await runtimeSafeDeleteConcurrency({ connectionString });
  results = [...results, ...concurrency.results];
  return { ok: results.length > 0 && results.every((row) => row.ok), results };
}
