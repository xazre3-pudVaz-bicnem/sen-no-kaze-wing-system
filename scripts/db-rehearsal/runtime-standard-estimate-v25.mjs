import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = '25000000-0000-4000-8000-000000000041';
const EDITOR = '25000000-0000-4000-8000-000000000042';
const ORG = '25000000-0000-4000-8000-000000000141';
const MODEL = '25000000-0000-4000-8000-000000000651';
const MATRIX_ROW = '25000000-0000-4000-8000-000000000661';
const CATEGORY = '25000000-0000-4000-8000-000000000241';
const PRODUCT = '25000000-0000-4000-8000-000000000341';

async function runSingleConnectionChecks(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-standard-estimate-v25.sql'), 'utf8').split('\r').join('');
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

async function actAs(client, userId) {
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'authenticated', sub: userId })]);
  await client.query('set local role authenticated');
}

async function asUser(client, userId, sql, params = []) {
  await actAs(client, userId);
  try {
    return await client.query(sql, params);
  } finally {
    await client.query('reset role');
    await client.query("select set_config('request.jwt.claims', '', true)");
  }
}

/** 本部・商品・本体・v2.5 以前の標準見積（公開）・v2.5 の下書き（商品 1 つ）を commit して作る */
async function seedFixture(connectionString) {
  return withClient(connectionString, async (client) => {
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica');
      await client.query(
        `insert into auth.users (id, email, raw_user_meta_data)
         values ($1, 'sev-race-admin@runtime.invalid', '{}'::jsonb), ($2, 'sev-race-editor@runtime.invalid', '{}'::jsonb)`,
        [ADMIN, EDITOR]
      );
      await client.query(
        `insert into public.profiles (id, email, full_name, role_code)
         values ($1, 'sev-race-admin@runtime.invalid', 'race admin', 'admin'), ($2, 'sev-race-editor@runtime.invalid', 'race editor', 'customer')`,
        [ADMIN, EDITOR]
      );
      await client.query(
        `insert into public.organizations (id, code, name, organization_type, status) values ($1, 'runtime-sev-race-hq', 'SE v2.5 Race HQ', 'headquarters', 'active')`,
        [ORG]
      );
      await client.query(
        `insert into public.organization_memberships (organization_id, profile_id, member_role, status) values ($1, $2, 'editor', 'active')`,
        [ORG, EDITOR]
      );
      await client.query(
        `insert into public.base_models (id, slug, name, base_price, status) values ($1, 'runtime-sev-race-model', 'v2.5 Race モデル', 1000000, 'published')`,
        [MODEL]
      );
      await client.query(
        `insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable) values ($1, $2, 'office', '2100x4550', false)`,
        [MATRIX_ROW, MODEL]
      );
      await client.query(
        `insert into public.option_categories (id, code, name, status) values ($1, 'runtime-sev-race-category', 'v2.5 Race', 'published')`,
        [CATEGORY]
      );
      await client.query(
        `insert into public.options (id, category_id, code, name, price, status, product_no)
         values ($1, $2, 'runtime-sev-race-product', 'v2.5 Race 商品', 50000, 'published', 'PRD-925041')`,
        [PRODUCT, CATEGORY]
      );
      await client.query('set local session_replication_role = origin');

      await asUser(client, ADMIN, `select changed from public.set_option_hq_standard_cost($1, 10000, 0, '初回設定')`, [PRODUCT]);
      const bmr = (await asUser(client, EDITOR,
        `select public.create_base_master_draft($1, $2, 'v2.5 Race 本体', 'non_fire', null, $3)::text as id`, [MODEL, ORG, MATRIX_ROW])).rows[0].id;
      await asUser(client, EDITOR, `select (public.save_base_master_draft($1, 'v2.5 Race 本体', 'non_fire', 'none', null, 0,
        '[{"section":"1．金物","name":"伸縮脚","quantity":12,"unit":"本","unit_price":18200}]'::jsonb)).id`, [bmr]);
      await asUser(client, EDITOR, `select (public.publish_base_master_draft($1)).id`, [bmr]);
      const se = (await asUser(client, EDITOR, `select public.create_standard_estimate_draft($1)::text as id`, [bmr])).rows[0].id;
      await asUser(client, EDITOR, `select (public.save_standard_estimate_draft($1, 1.07, 0.15, 1.5, 0, null,
        '{"base":"rate","interior_exterior":"rate","option":"rate","sitework":"none"}'::jsonb, '[]'::jsonb, 1)).id`, [se]);
      await asUser(client, EDITOR, `select (public.publish_standard_estimate_revision($1, 2)).id`, [se]);
      const master = (await client.query(`select standard_estimate_master_id as id from public.standard_estimate_revisions where id = $1`, [se])).rows[0].id;
      const draft = (await asUser(client, EDITOR, `select public.start_standard_estimate_v25_draft($1)::text as id`, [master])).rows[0].id;
      const payload = {
        rates: { sales_fee_rate: '1.07', markup_rate: '1.5', expense_rate: '0.15' },
        adjustment: 0,
        slots: [{ option_id: PRODUCT, quantity: 1 }],
        lines: [],
      };
      const lock = (await asUser(client, EDITOR, `select (public.save_standard_estimate_v25_draft($1, 1, $2::jsonb)).lock_version as v`,
        [draft, JSON.stringify(payload)])).rows[0].v;
      await client.query('commit');
      return { master, draft, lock, payload };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
  });
}

// session_replication_role = replica では連鎖削除・トリガーが動かないので、子から順に消す
async function cleanupFixture(connectionString) {
  await withClient(connectionString, async (client) => {
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica');
      const revisions = `select r.id from public.standard_estimate_revisions r
                           join public.standard_estimate_masters m on m.id = r.standard_estimate_master_id
                          where m.base_model_id = $1`;
      await client.query(`delete from public.standard_estimate_revision_baseline_variants where baseline_item_id in
        (select b.id from public.standard_estimate_revision_baseline_items b where b.revision_id in (${revisions}))`, [MODEL]);
      await client.query(`delete from public.standard_estimate_revision_baseline_items where revision_id in (${revisions})`, [MODEL]);
      await client.query(`delete from public.standard_estimate_revision_v25_lines where revision_id in (${revisions})`, [MODEL]);
      await client.query(`delete from public.standard_estimate_revision_lines where revision_id in (${revisions})`, [MODEL]);
      await client.query(`delete from public.standard_estimate_revision_sections where revision_id in (${revisions})`, [MODEL]);
      await client.query(`update public.standard_estimate_masters set current_published_revision_id = null where base_model_id = $1`, [MODEL]);
      await client.query(`delete from public.standard_estimate_revisions where id in (${revisions})`, [MODEL]);
      await client.query(`delete from public.standard_estimate_masters where base_model_id = $1`, [MODEL]);
      await client.query(`delete from public.base_master_revision_lines where revision_id in
        (select r.id from public.base_master_revisions r join public.base_masters b on b.id = r.base_master_id where b.base_model_id = $1)`, [MODEL]);
      await client.query(`update public.base_masters set current_published_revision_id = null where base_model_id = $1`, [MODEL]);
      await client.query(`delete from public.base_master_revisions where base_master_id in (select b.id from public.base_masters b where b.base_model_id = $1)`, [MODEL]);
      await client.query(`delete from public.base_masters where base_model_id = $1`, [MODEL]);
      await client.query(`delete from public.matrix_cells where matrix_row_id = $1`, [MATRIX_ROW]);
      await client.query(`delete from public.matrix_rows where id = $1`, [MATRIX_ROW]);
      await client.query(`delete from public.audit_logs where actor_id = any($1::uuid[]) or entity_id = $2`, [[ADMIN, EDITOR], PRODUCT]);
      await client.query(`delete from public.option_hq_standard_costs where option_id = $1`, [PRODUCT]);
      await client.query(`delete from public.option_standard_cost_versions where option_id = $1`, [PRODUCT]);
      await client.query(`delete from public.options where id = $1`, [PRODUCT]);
      await client.query(`delete from public.option_categories where id = $1`, [CATEGORY]);
      await client.query(`delete from public.base_models where id = $1`, [MODEL]);
      await client.query(`delete from public.organization_memberships where organization_id = $1`, [ORG]);
      await client.query(`delete from public.organizations where id = $1`, [ORG]);
      await client.query(`delete from public.profiles where id = any($1::uuid[])`, [[ADMIN, EDITOR]]);
      await client.query(`delete from auth.users where id = any($1::uuid[])`, [[ADMIN, EDITOR]]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
  });
}

async function waitUntilBlocked(verify, pid) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const res = await verify.query('select wait_event_type from pg_stat_activity where pid = $1', [pid]);
    if (res.rows[0]?.wait_event_type === 'Lock') return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** 先行（first）が lock を持ったまま後続（second）を走らせ、後続が待っていることを確かめてから先行を commit する */
async function race(connectionString, firstUser, first, secondUser, second) {
  const a = new pg.Client({ connectionString });
  const b = new pg.Client({ connectionString });
  const verify = new pg.Client({ connectionString });
  await Promise.all([a.connect(), b.connect(), verify.connect()]);
  try {
    await a.query('begin');
    await actAs(a, firstUser);
    const firstResult = await first(a);
    await b.query('begin');
    await actAs(b, secondUser);
    const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    const secondPromise = second(b).then((value) => ({ ok: true, value })).catch((error) => ({ ok: false, error }));
    const blocked = await waitUntilBlocked(verify, bPid);
    await a.query('commit');
    const secondResult = await secondPromise;
    if (secondResult.ok) await b.query('commit');
    else await b.query('rollback').catch(() => {});
    return { firstResult, secondResult, blocked };
  } catch (error) {
    await a.query('rollback').catch(() => {});
    await b.query('rollback').catch(() => {});
    throw error;
  } finally {
    await Promise.all([a.end(), b.end(), verify.end()]);
  }
}

function errorKind(result) {
  if (result.ok) return 'success';
  return `${result.error?.code ?? '(no code)'} ${String(result.error?.message ?? '').split(':')[0]}`;
}

async function readRevision(connectionString, id) {
  return withClient(connectionString, async (client) => (await client.query(
    `select r.status, r.lock_version, r.pricing_model,
            (select b.standard_cost_version_id from public.standard_estimate_revision_baseline_items b where b.revision_id = r.id limit 1) as pin,
            (select v.id from public.option_standard_cost_versions v where v.option_id = $2 and v.superseded_at is null) as current_version,
            (select count(*)::int from public.option_standard_cost_versions v where v.option_id = $2) as versions,
            (select m.current_published_revision_id = r.id from public.standard_estimate_masters m where m.id = r.standard_estimate_master_id) as is_current
       from public.standard_estimate_revisions r where r.id = $1`,
    [id, PRODUCT]
  )).rows[0]);
}

async function runRaces(connectionString) {
  const results = [];
  const push = (step, expected, actual) => results.push({ step, expected, actual, ok: actual === expected });
  let fixture;
  try {
    fixture = await seedFixture(connectionString);
    const { draft, master } = fixture;

    // 1. 原価の切替（先行・商品の行を FOR UPDATE）と公開（後続）：公開は待ち、確定後の状態で古い原価として止める
    const r1 = await race(
      connectionString,
      ADMIN, (a) => a.query(`select changed from public.set_option_hq_standard_cost($1, 12000, 1, '同時の原価改定')`, [PRODUCT]),
      EDITOR, (b) => b.query(`select status from public.publish_standard_estimate_v25_revision($1, $2)`, [draft, fixture.lock])
    );
    push('原価の切替が先：公開は商品の行の lock を待つ', 'true', String(r1.blocked));
    push('原価の切替が先：確定後の状態で古い原価として公開を止める', 'P0001 LOCKED', errorKind(r1.secondResult));
    let rev = await readRevision(connectionString, draft);
    push('原価の切替が先：下書きのまま・固定した原価は古い Version', `draft/${fixture.lock}/true`,
      `${rev.status}/${rev.lock_version}/${rev.pin !== rev.current_version}`);

    // 最新原価を取り込んで、次の競合に備える
    const lockAfterRefresh = await withClient(connectionString, async (client) => {
      await client.query('begin');
      const value = (await asUser(client, EDITOR, `select (public.refresh_standard_estimate_v25_costs($1, $2)).lock_version as v`, [draft, fixture.lock])).rows[0].v;
      await client.query('commit');
      return value;
    });

    // 2. 公開（先行・商品の行を FOR SHARE）と原価の切替（後続）：切替は公開の確定を待ち、公開は取り込んだ原価で成立する
    const r2 = await race(
      connectionString,
      EDITOR, (a) => a.query(`select status from public.publish_standard_estimate_v25_revision($1, $2)`, [draft, lockAfterRefresh]),
      ADMIN, (b) => b.query(`select changed from public.set_option_hq_standard_cost($1, 13000, 2, '公開と同時の原価改定')`, [PRODUCT])
    );
    push('公開が先：原価の切替は公開の確定を待つ', 'true', String(r2.blocked));
    push('公開が先：公開は成功し、後続の原価の切替も成功する', 'published/success', `${r2.firstResult.rows[0]?.status}/${errorKind(r2.secondResult)}`);
    rev = await readRevision(connectionString, draft);
    push('公開が先：公開した Revision は公開の時点の原価 Version を固定し、原価は新しい Version へ進む', 'published/true/true/3',
      `${rev.status}/${rev.is_current}/${rev.pin !== rev.current_version}/${rev.versions}`);

    // 3. 保存（先行）と公開（後続）：同じ版を読んだ公開は、保存の確定後に版の不一致で止まる
    const next = await withClient(connectionString, async (client) => {
      await client.query('begin');
      const id = (await asUser(client, EDITOR, `select public.start_standard_estimate_v25_draft($1)::text as id`, [master])).rows[0].id;
      await client.query('commit');
      return id;
    });
    const nextRev = await readRevision(connectionString, next);
    const r3 = await race(
      connectionString,
      EDITOR, (a) => a.query(`select lock_version from public.save_standard_estimate_v25_draft($1, $2, $3::jsonb)`,
        [next, nextRev.lock_version, JSON.stringify(fixture.payload)]),
      EDITOR, (b) => b.query(`select status from public.publish_standard_estimate_v25_revision($1, $2)`, [next, nextRev.lock_version])
    );
    push('保存が先：同じ版を読んだ公開は保存を待つ', 'true', String(r3.blocked));
    push('保存が先：保存の確定後、古い版の公開は止まる', 'P0001 LOCKED', errorKind(r3.secondResult));
    rev = await readRevision(connectionString, next);
    push('保存が先：次の下書きは下書きのまま版が 1 つ進む', `draft/${nextRev.lock_version + 1}`, `${rev.status}/${rev.lock_version}`);
  } catch (error) {
    return { ok: false, results, error: error.message };
  } finally {
    await cleanupFixture(connectionString).catch((error) => {
      results.push({ step: '標準見積 v2.5 の同時実行 fixture を後始末する', expected: 'cleanup success', actual: error.message, ok: false });
    });
  }
  return { ok: results.length > 0 && results.every((item) => item.ok), results };
}

export async function runtimeStandardEstimateV25(client, { connectionString }) {
  const single = await runSingleConnectionChecks(client);
  if (!single.ok) return single;
  const races = await runRaces(connectionString);
  return {
    ok: single.ok && races.ok,
    results: [...single.results, ...races.results],
    ...(races.error ? { error: races.error } : {}),
  };
}
