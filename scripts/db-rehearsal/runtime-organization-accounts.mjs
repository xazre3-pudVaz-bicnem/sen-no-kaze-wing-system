import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// 代理店・総代理店の組織とアカウント（20261016120000）の実行時検査。
// 1 本の接続で流す検査（runtime-organization-accounts.sql）と、2 本の接続で
// 「管理者 2 人が同時にお互いを担当者にしても、管理者が 0 人にならない」ことを確かめる。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = '21000000-0000-4000-8000-000000000101';
const MGR_A = '21000000-0000-4000-8000-000000000001';
const MGR_B = '21000000-0000-4000-8000-000000000002';
const MEM_A = '21000000-0000-4000-8000-000000000201';
const MEM_B = '21000000-0000-4000-8000-000000000202';

async function runSingleConnectionChecks(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-organization-accounts.sql'), 'utf8').split('\r').join('');
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

async function withClient(connectionString, fn) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function cleanupRaceFixture(connectionString) {
  await withClient(connectionString, async (client) => {
    await client.query('begin');
    await client.query('set local session_replication_role = replica');
    await client.query(`delete from public.audit_logs where entity = 'organization' and entity_id = $1`, [ORG]);
    await client.query('delete from public.organization_memberships where organization_id = $1', [ORG]);
    await client.query('delete from public.organizations where id = $1', [ORG]);
    await client.query('delete from public.profiles where id = any($1::uuid[])', [[MGR_A, MGR_B]]);
    await client.query('delete from auth.users where id = any($1::uuid[])', [[MGR_A, MGR_B]]);
    await client.query('commit');
  });
}

async function seedRaceFixture(connectionString) {
  await cleanupRaceFixture(connectionString);
  await withClient(connectionString, async (client) => {
    await client.query('begin');
    await client.query('set local session_replication_role = replica');
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, 'org-race-a@runtime.invalid', '{}'::jsonb), ($2, 'org-race-b@runtime.invalid', '{}'::jsonb)`,
      [MGR_A, MGR_B]
    );
    await client.query(
      `insert into public.profiles (id, email, full_name, role_code)
       values ($1, 'org-race-a@runtime.invalid', '同時検査 管理者A', 'dealer'),
              ($2, 'org-race-b@runtime.invalid', '同時検査 管理者B', 'dealer')`,
      [MGR_A, MGR_B]
    );
    await client.query(
      `insert into public.organizations (id, code, name, organization_type) values ($1, 'RT-ORG-RACE', '同時検査代理店', 'dealer')`,
      [ORG]
    );
    await client.query(
      `insert into public.organization_memberships (id, organization_id, profile_id, member_role, status, is_primary)
       values ($1, $3, $4, 'admin', 'active', true), ($2, $3, $5, 'admin', 'active', true)`,
      [MEM_A, MEM_B, ORG, MGR_A, MGR_B]
    );
    await client.query('commit');
  });
}

async function beginAs(client, sub) {
  await client.query('begin');
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  await client.query('set local role authenticated');
}

async function waitUntilLockWait(observer, pid) {
  for (let i = 0; i < 50; i++) {
    const res = await observer.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (res.rows[0]?.wait_event_type === 'Lock') return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function runLastManagerRace(connectionString) {
  const results = [];
  try {
    await seedRaceFixture(connectionString);
  } catch (error) {
    return { ok: false, results, error: `fixture: ${error.message}` };
  }
  const a = new pg.Client({ connectionString });
  const b = new pg.Client({ connectionString });
  const observer = new pg.Client({ connectionString });
  await Promise.all([a.connect(), b.connect(), observer.connect()]);
  try {
    const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;

    // A が B を担当者にする（管理者の行をロックしたまま、まだ確定しない）
    await beginAs(a, MGR_A);
    await a.query(`select public.set_organization_member_role($1, 'editor')`, [MEM_B]);

    // B が同時に A を担当者にしようとする → A の確定まで待たされる
    await beginAs(b, MGR_B);
    const bPromise = b
      .query(`select public.set_organization_member_role($1, 'editor')`, [MEM_A])
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({ ok: false, error }));
    const waited = await waitUntilLockWait(observer, bPid);
    await a.query('commit');
    const bResult = await bPromise;
    await b.query('rollback').catch(() => {});

    const managers = await observer.query(
      `select count(*)::int as n from public.organization_memberships
        where organization_id = $1 and status = 'active' and member_role in ('owner', 'admin')`,
      [ORG]
    );
    const code = bResult.ok ? 'success' : bResult.error?.code ?? '(no code)';
    results.push({
      step: '24-41 管理者 2 人が同時にお互いを担当者にしても、後の操作は止まり、管理者が 1 人残る',
      expected: 'B は待たされた後に拒否（42501／P0001）・管理者 1 人',
      actual: `待機=${waited}・B=${code}・管理者 ${managers.rows[0]?.n} 人`,
      ok: waited && !bResult.ok && ['42501', 'P0001'].includes(code) && managers.rows[0]?.n === 1,
    });
  } catch (error) {
    await a.query('rollback').catch(() => {});
    await b.query('rollback').catch(() => {});
    return { ok: false, results, error: error.message };
  } finally {
    await Promise.all([a.end(), b.end(), observer.end()]);
    await cleanupRaceFixture(connectionString).catch((error) => {
      results.push({ step: '24-42 同時検査の組織を後始末する', expected: 'cleanup success', actual: error.message, ok: false });
    });
  }
  return { ok: results.length > 0 && results.every((item) => item.ok), results };
}

export async function runtimeOrganizationAccounts(client, { connectionString }) {
  const single = await runSingleConnectionChecks(client);
  if (!single.ok) return single;
  const race = await runLastManagerRace(connectionString);
  return {
    ok: single.ok && race.ok,
    results: [...single.results, ...race.results],
    ...(race.error ? { error: race.error } : {}),
  };
}
