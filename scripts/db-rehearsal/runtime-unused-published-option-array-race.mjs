import pg from 'pg';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRelationLock(client, pid, relation, mode, granted, timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await client.query(
      `select exists (
         select 1 from pg_locks
          where pid = $1 and relation = $2::regclass and mode = $3 and granted = $4
       ) as ok`,
      [pid, relation, mode, granted]
    );
    if (res.rows[0]?.ok) return true;
    await delay(25);
  }
  return false;
}

async function deleteAsAdmin(client, adminId, optionId) {
  await client.query('begin');
  try {
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: 'authenticated', sub: adminId }),
    ]);
    await client.query('set local role authenticated');
    await client.query('select public.delete_unused_published_option($1::uuid)', [optionId]);
    await client.query('commit');
    return { ok: true, code: null };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, code: error.code ?? null, message: error.message ?? String(error) };
  }
}

async function cleanup(client, ids) {
  await client.query('begin');
  try {
    await client.query("set local session_replication_role = 'replica'");
    await client.query('delete from public.configuration_items where id = $1::uuid', [ids.item]);
    await client.query('delete from public.configurations where id = $1::uuid', [ids.configuration]);
    await client.query('delete from public.option_variant_choices where id = $1::uuid', [ids.choice]);
    await client.query('delete from public.option_variant_groups where id = $1::uuid', [ids.group]);
    await client.query('delete from public.options where id = any($1::uuid[])', [[ids.target, ids.peer]]);
    await client.query('delete from public.option_categories where id = $1::uuid', [ids.category]);
    await client.query('delete from public.profiles where id = $1::uuid', [ids.admin]);
    await client.query('delete from auth.users where id = $1::uuid', [ids.admin]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function setup(client, ids) {
  await cleanup(client, ids);
  await client.query('begin');
  try {
    await client.query("set local session_replication_role = 'replica'");
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1::uuid, 'unused-delete-array-race-admin@runtime.invalid', '{}'::jsonb)`,
      [ids.admin]
    );
    await client.query(
      `insert into public.profiles (id, email, full_name, role_code)
       values ($1::uuid, 'unused-delete-array-race-admin@runtime.invalid', '配列race検査管理者', 'admin')`,
      [ids.admin]
    );
    await client.query(
      `insert into public.option_categories (id, code, name, status)
       values ($1::uuid, 'runtime-unused-delete-array-race', '配列race検査', 'published')`,
      [ids.category]
    );
    await client.query(
      `insert into public.options (id, category_id, code, name, status, product_no)
       values
         ($1::uuid, $3::uuid, 'runtime-array-race-target', '配列race削除対象', 'published', 'PRD-999961'),
         ($2::uuid, $3::uuid, 'runtime-array-race-peer', '配列race参照用', 'published', 'PRD-999962')`,
      [ids.target, ids.peer, ids.category]
    );
    await client.query(
      `insert into public.option_variant_groups (id, option_id, code, name, status)
       values ($1::uuid, $2::uuid, 'array-race-group', '配列race group', 'published')`,
      [ids.group, ids.target]
    );
    await client.query(
      `insert into public.option_variant_choices (id, group_id, code, name, status)
       values ($1::uuid, $2::uuid, 'array-race-choice', '配列race choice', 'published')`,
      [ids.choice, ids.group]
    );
    await client.query(
      `insert into public.configurations (id, user_id, base_model_id, name, status, exterior_faces)
       values ($1::uuid, $2::uuid, $3::uuid, '配列race検査Configuration', 'draft', '[]'::jsonb)`,
      [ids.configuration, ids.admin, ids.baseModel]
    );
    await client.query(
      `insert into public.configuration_items (id, configuration_id, option_id, quantity, variant_choice_ids)
       values ($1::uuid, $2::uuid, $3::uuid, 1, '{}'::uuid[])`,
      [ids.item, ids.configuration, ids.peer]
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

export async function runtimeUnusedPublishedOptionArrayRace({ connectionString }) {
  if (!connectionString) {
    return {
      ok: false,
      results: [{ step: 'unused-delete array race', expected: 'connectionString', actual: 'missing', ok: false }],
    };
  }

  const ids = {
    admin: '00000000-0000-4000-8000-00000000d301',
    category: '00000000-0000-4000-8000-00000000d310',
    target: '00000000-0000-4000-8000-00000000d311',
    peer: '00000000-0000-4000-8000-00000000d312',
    group: '00000000-0000-4000-8000-00000000d320',
    choice: '00000000-0000-4000-8000-00000000d321',
    item: '00000000-0000-4000-8000-00000000d322',
    configuration: '00000000-0000-4000-8000-00000000d323',
    baseModel: '00000000-0000-4000-8000-00000000d324',
  };

  const setupClient = new pg.Client({ connectionString });
  const blocker = new pg.Client({ connectionString });
  const deleter = new pg.Client({ connectionString });
  const writer = new pg.Client({ connectionString });
  const observer = new pg.Client({ connectionString });
  const results = [];

  for (const client of [setupClient, blocker, deleter, writer, observer]) {
    await client.connect();
    await client.query("set statement_timeout = '8s'");
  }

  try {
    await setup(setupClient, ids);

    // New canonical order locks the target Option first. Block the non-FK table
    // instead, then queue safe-delete before the stale writer. After release,
    // safe-delete gets SHARE first, deletes the Option/Choice, and the writer's
    // validation trigger must reject the now-dangling UUID.
    await blocker.query('begin');
    await blocker.query('lock table public.configuration_items in access exclusive mode');

    const deleterPid = Number((await deleter.query('select pg_backend_pid() as pid')).rows[0].pid);
    const deletePromise = deleteAsAdmin(deleter, ids.admin, ids.target);
    const deleterWaitsForShare = await waitForRelationLock(
      observer,
      deleterPid,
      'public.configuration_items',
      'ShareLock',
      false
    );
    results.push({
      step: 'unused-delete array race 1-1 safe-deleteはOption行確保後にconfiguration_itemsのSHARE lockを待つ',
      expected: 'true',
      actual: String(deleterWaitsForShare),
      ok: deleterWaitsForShare,
    });

    await writer.query('begin');
    const writerPid = Number((await writer.query('select pg_backend_pid() as pid')).rows[0].pid);
    const writePromise = writer
      .query('update public.configuration_items set variant_choice_ids = array[$1::uuid] where id = $2::uuid', [ids.choice, ids.item])
      .then(async () => {
        await writer.query('commit');
        return { ok: true, code: null };
      })
      .catch(async (error) => {
        await writer.query('rollback').catch(() => {});
        return { ok: false, code: error.code ?? null, message: error.message ?? String(error) };
      });

    const writerWaits = await waitForRelationLock(
      observer,
      writerPid,
      'public.configuration_items',
      'RowExclusiveLock',
      false
    );
    results.push({
      step: 'unused-delete array race 1-2 variant_choice_ids書込みはsafe-deleteの後ろで待機する',
      expected: 'true',
      actual: String(writerWaits),
      ok: writerWaits,
    });

    await blocker.query('commit');
    const [deleteResult, writeResult] = await Promise.all([deletePromise, writePromise]);
    results.push({
      step: 'unused-delete array race 1-3 未使用targetのsafe-deleteは成功する',
      expected: 'success',
      actual: deleteResult.ok ? 'success' : `${deleteResult.code ?? 'error'} ${deleteResult.message ?? ''}`.trim(),
      ok: deleteResult.ok,
    });
    results.push({
      step: 'unused-delete array race 1-4 待機書込みは保存時validationで拒否される',
      expected: 'P0001',
      actual: writeResult.code ?? (writeResult.ok ? 'success' : 'unknown'),
      ok: !writeResult.ok && writeResult.code === 'P0001',
    });

    const state = (
      await setupClient.query(
        `select
           exists(select 1 from public.options where id = $1::uuid) as target_exists,
           coalesce((select cardinality(variant_choice_ids) from public.configuration_items where id = $2::uuid), -1) as variant_count`,
        [ids.target, ids.item]
      )
    ).rows[0];
    results.push({
      step: 'unused-delete array race 1-5 削除後にdangling Choice UUIDは残らない',
      expected: 'target=false variants=0',
      actual: `target=${state.target_exists} variants=${state.variant_count}`,
      ok: state.target_exists === false && Number(state.variant_count) === 0,
    });
  } catch (error) {
    results.push({
      step: 'unused-delete array race unexpected error',
      expected: 'no error',
      actual: `${error.code ?? ''} ${error.message ?? String(error)}`.trim(),
      ok: false,
    });
  } finally {
    for (const client of [blocker, writer, deleter]) await client.query('rollback').catch(() => {});
    await cleanup(setupClient, ids).catch((error) => {
      results.push({
        step: 'unused-delete array race cleanup',
        expected: 'success',
        actual: error.message ?? String(error),
        ok: false,
      });
    });
    for (const client of [setupClient, blocker, deleter, writer, observer]) await client.end().catch(() => {});
  }

  return { ok: results.length > 0 && results.every((row) => row.ok), results };
}
