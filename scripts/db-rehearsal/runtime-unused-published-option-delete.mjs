import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function safeDeleteAsAdmin(client, adminId, optionId) {
  await client.query('begin');
  try {
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: 'authenticated', sub: adminId }),
    ]);
    await client.query('set local role authenticated');
    await client.query('select public.delete_unused_published_option($1::uuid)', [optionId]);
    await client.query('commit');
    return { ok: true, code: null, message: null };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, code: error.code ?? null, message: error.message ?? String(error) };
  }
}

async function cleanupConcurrencyFixtures(client, ids) {
  await client.query('begin');
  try {
    await client.query("set local session_replication_role = 'replica'");
    await client.query('delete from public.configuration_items where id = $1::uuid', [ids.item]);
    await client.query('delete from public.option_variant_choices where id = $1::uuid', [ids.choice]);
    await client.query('delete from public.option_variant_groups where id = any($1::uuid[])', [[ids.targetGroup, ids.peerGroup]]);
    await client.query('delete from public.options where id = any($1::uuid[])', [[ids.target, ids.peer, ids.timeoutTarget]]);
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
         ($1::uuid, $4::uuid, 'runtime-delete-race-target', '並行削除対象', 'published', 'PRD-999971'),
         ($2::uuid, $4::uuid, 'runtime-delete-race-peer', '並行参照用', 'published', 'PRD-999972'),
         ($3::uuid, $4::uuid, 'runtime-delete-timeout-target', 'lock timeout検査対象', 'published', 'PRD-999973')`,
      [ids.target, ids.peer, ids.timeoutTarget, ids.category]
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
  const results = [];

  for (const client of [setup, blocker, deleter, mover, observer, timeoutBlocker, timeoutDeleter]) {
    await client.connect();
    await client.query("set statement_timeout = '8s'");
  }

  try {
    await setupConcurrencyFixtures(setup, ids);

    // variant所属変更race:
    // canonical orderではsafe-deleteが対象Option行を先に確保する。そこでvariant choice
    // tableをACCESS EXCLUSIVEで一時停止し、safe-deleteを先にSHARE待ちへ並べてから
    // group_id変更writerを後ろへ並べる。解放後はsafe-deleteが先に完了し、待機writerは
    // 削除済みtarget groupへのFK変更を23503で拒否されることを確認する。
    await blocker.query('begin');
    await blocker.query('lock table public.option_variant_choices in access exclusive mode');

    const deleterPid = Number((await deleter.query('select pg_backend_pid() as pid')).rows[0].pid);
    const deletePromise = safeDeleteAsAdmin(deleter, ids.admin, ids.target);
    const deleteWaitsForShare = await waitForRelationLock(
      observer,
      deleterPid,
      'public.option_variant_choices',
      'ShareLock',
      false
    );
    results.push({
      step: 'unused-delete concurrency 1-1 safe-deleteはOption行確保後にvariant choiceのSHARE lockを待つ',
      expected: 'true',
      actual: String(deleteWaitsForShare),
      ok: deleteWaitsForShare,
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

    const moverWaitsForShare = await waitForRelationLock(
      observer,
      moverPid,
      'public.option_variant_choices',
      'RowExclusiveLock',
      false
    );
    results.push({
      step: 'unused-delete concurrency 1-2 variant所属変更raceのwriterはsafe-deleteの後ろで待機する',
      expected: 'true',
      actual: String(moverWaitsForShare),
      ok: moverWaitsForShare,
    });

    await blocker.query('commit');
    const [deleteResult, moveResult] = await Promise.all([deletePromise, movePromise]);
    results.push({
      step: 'unused-delete concurrency 1-3 未使用targetのsafe-deleteは成功する',
      expected: 'success',
      actual: deleteResult.ok ? 'success' : `${deleteResult.code ?? 'error'} ${deleteResult.message ?? ''}`.trim(),
      ok: deleteResult.ok,
    });
    results.push({
      step: 'unused-delete concurrency 1-4 待機していたvariant所属変更はFKで失敗する',
      expected: '23503',
      actual: moveResult.code ?? (moveResult.ok ? 'success' : 'unknown'),
      ok: !moveResult.ok && moveResult.code === '23503',
    });

    const raceState = await setup.query(
      `select
         exists(select 1 from public.options where id = $1::uuid) as target_exists,
         (select group_id::text from public.option_variant_choices where id = $2::uuid) as choice_group,
         exists(
           select 1 from public.configuration_items
           where id = $3::uuid and $2::uuid = any(variant_choice_ids)
         ) as configuration_ref_intact`,
      [ids.target, ids.choice, ids.item]
    );
    const raceRow = raceState.rows[0];
    results.push({
      step: 'unused-delete concurrency 1-5 Configurationのchoice参照はpeer groupのまま保全される',
      expected: `target=false group=${ids.peerGroup} ref=true`,
      actual: `target=${raceRow.target_exists} group=${raceRow.choice_group} ref=${raceRow.configuration_ref_intact}`,
      ok:
        raceRow.target_exists === false &&
        raceRow.choice_group === ids.peerGroup &&
        raceRow.configuration_ref_intact === true,
    });

    // lock_timeout: target optionを別transactionが保持し続けても、後続の広いtable lockへ進まず安全停止する。
    await timeoutBlocker.query('begin');
    await timeoutBlocker.query('select 1 from public.options where id = $1::uuid for update', [ids.timeoutTarget]);
    const timeoutResult = await safeDeleteAsAdmin(timeoutDeleter, ids.admin, ids.timeoutTarget);
    results.push({
      step: 'unused-delete concurrency 2-1 option行競合はlock_timeoutでfail-safeする',
      expected: '55P03',
      actual: timeoutResult.code ?? (timeoutResult.ok ? 'success' : 'unknown'),
      ok: !timeoutResult.ok && timeoutResult.code === '55P03',
    });
    await timeoutBlocker.query('rollback');
    const timeoutStillExists = Boolean(
      (await setup.query('select exists(select 1 from public.options where id = $1::uuid) as ok', [ids.timeoutTarget])).rows[0]
        .ok
    );
    results.push({
      step: 'unused-delete concurrency 2-2 lock timeout時は商品を削除しない',
      expected: 'true',
      actual: String(timeoutStillExists),
      ok: timeoutStillExists,
    });
  } catch (error) {
    results.push({
      step: 'unused-delete concurrency unexpected error',
      expected: 'no error',
      actual: `${error.code ?? ''} ${error.message ?? String(error)}`.trim(),
      ok: false,
    });
  } finally {
    for (const client of [blocker, mover, timeoutBlocker, deleter, timeoutDeleter]) {
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
    for (const client of [setup, blocker, deleter, mover, observer, timeoutBlocker, timeoutDeleter]) {
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
