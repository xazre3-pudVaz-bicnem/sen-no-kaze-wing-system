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

async function beginAsAdmin(client, adminId) {
  await client.query('begin');
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: 'authenticated', sub: adminId }),
  ]);
  await client.query('set local role authenticated');
}

async function safeDelete(client, adminId, optionId) {
  await beginAsAdmin(client, adminId);
  try {
    await client.query('select public.delete_unused_published_option($1::uuid)', [optionId]);
    await client.query('commit');
    return { ok: true, code: null };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, code: error.code ?? null, message: error.message ?? String(error) };
  }
}

async function saveConfiguration(client, ids) {
  await beginAsAdmin(client, ids.admin);
  try {
    await client.query(
      `select * from public.save_configuration_atomic(
        p_configuration_id => $1::uuid,
        p_base_model_id => $2::uuid,
        p_name => 'safe-delete lock order writer',
        p_option_ids => '{}'::uuid[],
        p_preview_image_url => null,
        p_notes => null,
        p_finish_level => 'shell',
        p_variant_choice_ids => '{}'::uuid[],
        p_spec_code => 'base',
        p_exterior_faces => '[]'::jsonb,
        p_site_prefecture => null,
        p_site_municipality => null,
        p_site_location_undecided => false,
        p_expected_lock_version => 1
      )`,
      [ids.configuration, ids.model]
    );
    await client.query('commit');
    return { ok: true, code: null };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, code: error.code ?? null, message: error.message ?? String(error) };
  }
}

async function applyCatalogImport(client, ids) {
  await beginAsAdmin(client, ids.admin);
  try {
    const options = [
      {
        id: ids.target,
        base_model_id: null,
        category_id: ids.category,
        code: 'runtime-writer-order-target',
        name: 'writer order target',
        price: 0,
        status: 'published',
        affects_views: [],
        spec_codes: [],
      },
    ];
    const groups = [
      {
        id: ids.group,
        option_id: ids.target,
        code: 'runtime-writer-order-group',
        name: 'writer order group',
        status: 'published',
      },
    ];
    await client.query('select public.apply_catalog_import($1::jsonb, $2::jsonb, $3::jsonb)', [
      JSON.stringify(options),
      JSON.stringify(groups),
      JSON.stringify([]),
    ]);
    await client.query('commit');
    return { ok: true, code: null };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return { ok: false, code: error.code ?? null, message: error.message ?? String(error) };
  }
}

async function insertTarget(client, ids) {
  await client.query(
    `insert into public.options (id, category_id, code, name, status, product_no)
     values ($1::uuid, $2::uuid, 'runtime-writer-order-target', 'writer order target', 'published', 'PRD-999951')
     on conflict (id) do nothing`,
    [ids.target, ids.category]
  );
}

export async function runtimeUnusedPublishedOptionWriterOrder({ connectionString }) {
  if (!connectionString) {
    return { ok: false, results: [{ step: 'unused-delete writer order', expected: 'connectionString', actual: 'missing', ok: false }] };
  }

  const ids = {
    admin: '00000000-0000-4000-8000-00000000d401',
    model: '00000000-0000-4000-8000-00000000d402',
    category: '00000000-0000-4000-8000-00000000d403',
    target: '00000000-0000-4000-8000-00000000d404',
    group: '00000000-0000-4000-8000-00000000d405',
    configuration: '00000000-0000-4000-8000-00000000d406',
  };

  const setup = new pg.Client({ connectionString });
  const observer = new pg.Client({ connectionString });
  const configBlocker = new pg.Client({ connectionString });
  const configWriter = new pg.Client({ connectionString });
  const configDeleter = new pg.Client({ connectionString });
  const importBlocker = new pg.Client({ connectionString });
  const importer = new pg.Client({ connectionString });
  const importDeleter = new pg.Client({ connectionString });
  const clients = [setup, observer, configBlocker, configWriter, configDeleter, importBlocker, importer, importDeleter];
  const results = [];
  let requiredCategoryIds = [];

  for (const client of clients) {
    await client.connect();
    await client.query("set statement_timeout = '8s'");
  }

  const cleanup = async () => {
    await setup.query('begin');
    try {
      await setup.query("set local session_replication_role = 'replica'");
      await setup.query('delete from public.configuration_snapshots where configuration_id = $1::uuid', [ids.configuration]);
      await setup.query('delete from public.configuration_items where configuration_id = $1::uuid', [ids.configuration]);
      await setup.query('delete from public.configurations where id = $1::uuid', [ids.configuration]);
      await setup.query('delete from public.option_variant_choices where group_id = $1::uuid', [ids.group]);
      await setup.query('delete from public.option_variant_groups where id = $1::uuid', [ids.group]);
      await setup.query('delete from public.options where id = $1::uuid', [ids.target]);
      await setup.query('delete from public.option_categories where id = $1::uuid', [ids.category]);
      await setup.query('delete from public.base_models where id = $1::uuid', [ids.model]);
      await setup.query('delete from public.profiles where id = $1::uuid', [ids.admin]);
      await setup.query('delete from auth.users where id = $1::uuid', [ids.admin]);
      if (requiredCategoryIds.length) {
        await setup.query('update public.option_categories set is_required = true where id = any($1::uuid[])', [requiredCategoryIds]);
      }
      await setup.query('commit');
    } catch (error) {
      await setup.query('rollback').catch(() => {});
      throw error;
    }
  };

  try {
    requiredCategoryIds = (await setup.query('select id from public.option_categories where is_required')).rows.map((r) => r.id);
    await cleanup();

    await setup.query('begin');
    await setup.query("set local session_replication_role = 'replica'");
    if (requiredCategoryIds.length) {
      await setup.query('update public.option_categories set is_required = false where id = any($1::uuid[])', [requiredCategoryIds]);
    }
    await setup.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1::uuid, 'unused-delete-writer-order@runtime.invalid', '{}'::jsonb)`,
      [ids.admin]
    );
    await setup.query(
      `insert into public.profiles (id, email, full_name, role_code)
       values ($1::uuid, 'unused-delete-writer-order@runtime.invalid', 'writer order admin', 'admin')`,
      [ids.admin]
    );
    await setup.query(
      `insert into public.base_models (id, slug, name, base_price, status)
       values ($1::uuid, 'runtime-writer-order-model', 'writer order model', 1000000, 'published')`,
      [ids.model]
    );
    await setup.query(
      `insert into public.option_categories (id, code, name, status, is_required, finish_level)
       values ($1::uuid, 'runtime-writer-order-category', 'writer order category', 'published', false, 'full')`,
      [ids.category]
    );
    await insertTarget(setup, ids);
    await setup.query(
      `insert into public.configurations (id, user_id, base_model_id, name, status, finish_level, spec_code, lock_version)
       values ($1::uuid, $2::uuid, $3::uuid, 'writer order config', 'draft', 'shell', 'base', 1)`,
      [ids.configuration, ids.admin, ids.model]
    );
    await setup.query('commit');

    await beginAsAdmin(configWriter, ids.admin);
    let codeUpdate;
    try {
      await configWriter.query("update public.options set code = 'runtime-writer-order-target-renamed' where id = $1::uuid", [ids.target]);
      await configWriter.query('commit');
      codeUpdate = { ok: true, code: null };
    } catch (error) {
      await configWriter.query('rollback').catch(() => {});
      codeUpdate = { ok: false, code: error.code ?? null };
    }
    results.push({
      step: 'unused-delete writer order 0 options.codeの既存行変更をDBで拒否する',
      expected: 'P0001',
      actual: codeUpdate.code ?? (codeUpdate.ok ? 'success' : 'unknown'),
      ok: !codeUpdate.ok && codeUpdate.code === 'P0001',
    });

    await configBlocker.query('begin');
    await configBlocker.query('lock table public.configuration_items in share mode');
    const configWriterPid = Number((await configWriter.query('select pg_backend_pid() as pid')).rows[0].pid);
    const savePromise = saveConfiguration(configWriter, ids);
    const writerWaitsItems = await waitForRelationLock(observer, configWriterPid, 'public.configuration_items', 'RowExclusiveLock', false);
    results.push({
      step: 'unused-delete writer order 1-1 save_configuration_atomicがconfiguration_items待ちになる',
      expected: 'true', actual: String(writerWaitsItems), ok: writerWaitsItems,
    });

    const configDeletePid = Number((await configDeleter.query('select pg_backend_pid() as pid')).rows[0].pid);
    const deleteDuringSave = safeDelete(configDeleter, ids.admin, ids.target);
    const deleteWaitsConfigurations = await waitForRelationLock(observer, configDeletePid, 'public.configurations', 'ShareLock', false);
    const deleteAlreadyHoldsItems = await waitForRelationLock(observer, configDeletePid, 'public.configuration_items', 'ShareLock', true, 250);
    results.push({
      step: 'unused-delete writer order 1-2 safe-deleteはconfigurations待ちの間configuration_itemsを保持しない',
      expected: 'wait-config=true hold-items=false',
      actual: `wait-config=${deleteWaitsConfigurations} hold-items=${deleteAlreadyHoldsItems}`,
      ok: deleteWaitsConfigurations && !deleteAlreadyHoldsItems,
    });

    await configBlocker.query('commit');
    const [saveResult, deleteSaveResult] = await Promise.all([savePromise, deleteDuringSave]);
    results.push({
      step: 'unused-delete writer order 1-3 save_configuration_atomicとsafe-deleteはdeadlockせず完了する',
      expected: 'save=success delete=success',
      actual: `save=${saveResult.ok ? 'success' : saveResult.code} delete=${deleteSaveResult.ok ? 'success' : deleteSaveResult.code}`,
      ok: saveResult.ok && deleteSaveResult.ok && saveResult.code !== '40P01' && deleteSaveResult.code !== '40P01',
    });

    await insertTarget(setup, ids);

    await importBlocker.query('begin');
    await importBlocker.query('lock table public.option_variant_groups in share mode');
    const importerPid = Number((await importer.query('select pg_backend_pid() as pid')).rows[0].pid);
    const importPromise = applyCatalogImport(importer, ids);
    const importWaitsVariants = await waitForRelationLock(observer, importerPid, 'public.option_variant_groups', 'RowExclusiveLock', false);
    results.push({
      step: 'unused-delete writer order 2-1 apply_catalog_importがoption更新後にvariant group待ちになる',
      expected: 'true', actual: String(importWaitsVariants), ok: importWaitsVariants,
    });

    const importDeletePid = Number((await importDeleter.query('select pg_backend_pid() as pid')).rows[0].pid);
    const deleteDuringImport = safeDelete(importDeleter, ids.admin, ids.target);
    const deleteAlreadyHoldsVariants = await waitForRelationLock(observer, importDeletePid, 'public.option_variant_groups', 'ShareLock', true, 250);
    results.push({
      step: 'unused-delete writer order 2-2 safe-deleteはOption行待ち中にvariant SHAREを保持しない',
      expected: 'variant-share=false',
      actual: `variant-share=${deleteAlreadyHoldsVariants}`,
      ok: !deleteAlreadyHoldsVariants,
    });

    await importBlocker.query('commit');
    const [importResult, deleteImportResult] = await Promise.all([importPromise, deleteDuringImport]);
    results.push({
      step: 'unused-delete writer order 2-3 apply_catalog_importとsafe-deleteはdeadlockせず完了する',
      expected: 'import=success delete=success',
      actual: `import=${importResult.ok ? 'success' : importResult.code} delete=${deleteImportResult.ok ? 'success' : deleteImportResult.code}`,
      ok: importResult.ok && deleteImportResult.ok && importResult.code !== '40P01' && deleteImportResult.code !== '40P01',
    });
  } catch (error) {
    results.push({
      step: 'unused-delete writer order unexpected error',
      expected: 'no error',
      actual: `${error.code ?? ''} ${error.message ?? String(error)}`.trim(),
      ok: false,
    });
  } finally {
    for (const client of [configBlocker, configWriter, configDeleter, importBlocker, importer, importDeleter]) {
      await client.query('rollback').catch(() => {});
    }
    await cleanup().catch((error) => {
      results.push({ step: 'unused-delete writer order cleanup', expected: 'success', actual: error.message ?? String(error), ok: false });
    });
    for (const client of clients) await client.end().catch(() => {});
  }

  return { ok: results.length > 0 && results.every((row) => row.ok), results };
}
