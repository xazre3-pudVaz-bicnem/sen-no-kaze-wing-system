import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// 案件の営業担当組織・主担当者・製造担当組織（20261111120000）の実行時検査。
// 1 本の接続で流す検査（runtime-case-sales-organization.sql）と、2 本の接続で
// 「本部が営業担当組織を変えている最中に、前の組織の管理者が主担当者を決めても、前の組織の担当者が主担当者にならない」ことを確かめる。
const HERE = path.dirname(fileURLToPath(import.meta.url));

const ADMIN = '3a000000-0000-4000-8000-000000000001';
const MGR = '3a000000-0000-4000-8000-000000000002';
const STAFF = '3a000000-0000-4000-8000-000000000003';
const CUSTOMER = '3a000000-0000-4000-8000-000000000004';
const USERS = [ADMIN, MGR, STAFF, CUSTOMER];
const ORG_MD = '3b000000-0000-4000-8000-000000000001';
const ORG_D = '3b000000-0000-4000-8000-000000000002';
const ORG_D2 = '3b000000-0000-4000-8000-000000000003';
const ORGS = [ORG_D, ORG_D2, ORG_MD];
const MODEL_SLUG = 'runtime-cs-race-model';
const CONFIG = '3c000000-0000-4000-8000-000000000001';
const REQUEST = '3d000000-0000-4000-8000-000000000001';
const QUOTE = '3e000000-0000-4000-8000-000000000001';

async function runSingleConnectionChecks(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-case-sales-organization.sql'), 'utf8').split('\r').join('');
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
    await client.query(`delete from public.audit_logs where entity = 'quote_request' and entity_id = $1`, [REQUEST]);
    await client.query('delete from public.notifications where recipient_id = any($1::uuid[])', [USERS]);
    await client.query('delete from public.case_workflows where quote_request_id = $1', [REQUEST]);
    await client.query('delete from public.quotes where id = $1', [QUOTE]);
    await client.query('delete from public.quote_requests where id = $1', [REQUEST]);
    await client.query('delete from public.configurations where id = $1', [CONFIG]);
    await client.query('delete from public.base_models where slug = $1', [MODEL_SLUG]);
    await client.query('delete from public.organization_memberships where organization_id = any($1::uuid[])', [ORGS]);
    await client.query('delete from public.organizations where id = any($1::uuid[])', [ORGS]);
    await client.query('delete from public.profiles where id = any($1::uuid[])', [USERS]);
    await client.query('delete from auth.users where id = any($1::uuid[])', [USERS]);
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
       select u.id, u.email, '{}'::jsonb from unnest($1::uuid[], $2::text[]) as u(id, email)`,
      [USERS, ['cs-race-admin@runtime.invalid', 'cs-race-mgr@runtime.invalid', 'cs-race-staff@runtime.invalid', 'cs-race-cust@runtime.invalid']]
    );
    await client.query(
      `insert into public.profiles (id, email, full_name, role_code)
       values ($1, 'cs-race-admin@runtime.invalid', '同時検査 本部', 'admin'),
              ($2, 'cs-race-mgr@runtime.invalid', '同時検査 代理店管理者', 'dealer'),
              ($3, 'cs-race-staff@runtime.invalid', '同時検査 代理店担当者', 'dealer'),
              ($4, 'cs-race-cust@runtime.invalid', '同時検査 お客様', 'customer')`,
      USERS
    );
    await client.query(
      `insert into public.organizations (id, code, name, organization_type, parent_organization_id)
       values ($1, 'RT-CSR-MD', '同時検査総代理店', 'master_dealer', null),
              ($2, 'RT-CSR-D', '同時検査代理店', 'dealer', $1),
              ($3, 'RT-CSR-D2', '同時検査代理店2', 'dealer', $1)`,
      [ORG_MD, ORG_D, ORG_D2]
    );
    await client.query(
      `insert into public.organization_memberships (organization_id, profile_id, member_role, status, is_primary)
       values ($1, $2, 'admin', 'active', true), ($1, $3, 'editor', 'active', true)`,
      [ORG_D, MGR, STAFF]
    );
    const model = await client.query(
      `insert into public.base_models (slug, name, base_price, status) values ($1, '同時検査用モデル', 1000000, 'published') returning id`,
      [MODEL_SLUG]
    );
    await client.query(
      `insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
       values ($1, $2, $3, '同時検査の案件', 'quote_requested', 'office', 'full')`,
      [CONFIG, CUSTOMER, model.rows[0].id]
    );
    await client.query(
      `insert into public.quote_requests (id, configuration_id, user_id, quote_id, status) values ($1, $2, $3, $4, 'sent')`,
      [REQUEST, CONFIG, CUSTOMER, QUOTE]
    );
    await client.query(
      `insert into public.quotes (id, quote_no, quote_request_id, configuration_id, user_id, dealer_id, status, valid_until,
                                  customer_name, base_model_name, base_price, option_subtotal, installation_subtotal,
                                  subtotal, tax_rate, tax, total, revision, parent_quote_id)
       values ($1, 'RT-CSR-1', $2, $3, $4, null, 'issued', now() + interval '30 days', '同時検査 お客様', '同時検査用モデル',
               1000000, 0, 0, 1000000, 0.10, 100000, 1100000, 1, null)`,
      [QUOTE, REQUEST, CONFIG, CUSTOMER]
    );
    await client.query(
      `insert into public.case_workflows (quote_request_id, sales_organization_id, sales_assigned_at, manufacturing_organization_id, manufacturing_auto)
       values ($1, $2, now(), $3, true)`,
      [REQUEST, ORG_D, ORG_MD]
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

async function runAssignDuringSalesChange(connectionString) {
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

    // A（本部）が営業担当組織を別の代理店に変える（案件の行をロックしたまま、まだ確定しない）
    await beginAs(a, ADMIN);
    await a.query('select public.set_case_sales_organization($1, $2)', [REQUEST, ORG_D2]);

    // B（前の代理店の管理者）が同時に主担当者を決めようとする → A の確定まで待たされ、変わった後の組織で判定される
    await beginAs(b, MGR);
    const bPromise = b
      .query('select public.assign_case_primary_staff($1, $2)', [REQUEST, STAFF])
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({ ok: false, error }));
    const waited = await waitUntilLockWait(observer, bPid);
    await a.query('commit');
    const bResult = await bPromise;
    await b.query(bResult.ok ? 'commit' : 'rollback').catch(() => {});

    const state = await observer.query(
      `select w.sales_organization_id::text as sales, coalesce(w.primary_staff_id::text, '(none)') as staff,
              (select count(*)::int from public.quotes q where q.quote_request_id = w.quote_request_id and q.dealer_id is not null) as dealers
         from public.case_workflows w where w.quote_request_id = $1`,
      [REQUEST]
    );
    const row = state.rows[0] ?? {};
    const code = bResult.ok ? 'success' : bResult.error?.code ?? '(no code)';
    results.push({
      step: '25-46 本部が営業担当組織を変えている最中に前の組織の管理者が主担当者を決めても、待たされた後に拒否され、前の組織の担当者は主担当者にならない',
      expected: '待機=true・B=42501・営業担当組織は新しい代理店・主担当者なし・見積の担当なし',
      actual: `待機=${waited}・B=${code}・営業担当組織=${row.sales === ORG_D2 ? '新しい代理店' : row.sales}・主担当者=${row.staff}・見積の担当=${row.dealers}`,
      ok: waited && code === '42501' && row.sales === ORG_D2 && row.staff === '(none)' && row.dealers === 0,
    });
  } catch (error) {
    await a.query('rollback').catch(() => {});
    await b.query('rollback').catch(() => {});
    return { ok: false, results, error: error.message };
  } finally {
    await Promise.all([a.end(), b.end(), observer.end()]);
    await cleanupRaceFixture(connectionString).catch((error) => {
      results.push({ step: '25-47 同時検査の案件を後始末する', expected: 'cleanup success', actual: error.message, ok: false });
    });
  }
  return { ok: results.length > 0 && results.every((item) => item.ok), results };
}

export async function runtimeCaseSalesOrganization(client, { connectionString } = {}) {
  const single = await runSingleConnectionChecks(client);
  if (!single.ok || !connectionString) return single;
  const race = await runAssignDuringSalesChange(connectionString);
  return {
    ok: single.ok && race.ok,
    results: [...single.results, ...race.results],
    ...(race.error ? { error: race.error } : {}),
  };
}
