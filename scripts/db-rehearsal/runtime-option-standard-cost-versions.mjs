import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RACE_USER = '25000000-0000-4000-8000-000000000011';
const RACE_CATEGORY = '25000000-0000-4000-8000-000000000211';
const RACE_OPTION = '25000000-0000-4000-8000-000000000311';
const RACE_GROUP = '25000000-0000-4000-8000-000000000411';
const RACE_CHOICE_1 = '25000000-0000-4000-8000-000000000511';
const RACE_CHOICE_2 = '25000000-0000-4000-8000-000000000512';

async function runSingleConnectionChecks(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-option-standard-cost-versions.sql'), 'utf8').split('\r').join('');
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

async function seedRaceFixture(connectionString) {
  await withClient(connectionString, async (client) => {
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica');
      await client.query(
        `insert into auth.users (id, email, raw_user_meta_data)
         values ($1, 'scv-race@runtime.invalid', '{}'::jsonb)`,
        [RACE_USER]
      );
      await client.query(
        `insert into public.profiles (id, email, full_name, role_code)
         values ($1, 'scv-race@runtime.invalid', 'standard cost version race admin', 'admin')`,
        [RACE_USER]
      );
      await client.query(
        `insert into public.option_categories (id, code, name, status)
         values ($1, 'runtime-scv-race-category', '標準原価Version Race', 'published')`,
        [RACE_CATEGORY]
      );
      await client.query(
        `insert into public.options (id, category_id, code, name, price, status, product_no)
         values ($1, $2, 'runtime-scv-race-option', '標準原価Version Race商品', 150000, 'draft', 'PRD-925011')`,
        [RACE_OPTION, RACE_CATEGORY]
      );
      await client.query(
        `insert into public.option_variant_groups (id, option_id, code, name, sort_order, is_required, status)
         values ($1, $2, 'size', 'サイズ', 1, true, 'published')`,
        [RACE_GROUP, RACE_OPTION]
      );
      await client.query(
        `insert into public.option_variant_choices (id, group_id, code, name, kind, extra_price, status)
         values ($1, $3, 'small', '小', 'option', 0, 'published'),
                ($2, $3, 'large', '大', 'option', 0, 'published')`,
        [RACE_CHOICE_1, RACE_CHOICE_2, RACE_GROUP]
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
  });
}

// session_replication_role = replica では FK の連鎖削除も Version を守るトリガーも動かないので、子から順に消す
async function cleanupRaceFixture(connectionString) {
  await withClient(connectionString, async (client) => {
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica');
      await client.query('delete from public.audit_logs where entity_id = $1', [RACE_OPTION]);
      await client.query('delete from public.option_hq_standard_costs where option_id = $1', [RACE_OPTION]);
      await client.query('delete from public.option_variant_cost_versions where variant_choice_id = any($1::uuid[])', [
        [RACE_CHOICE_1, RACE_CHOICE_2],
      ]);
      await client.query('delete from public.option_standard_cost_versions where option_id = $1', [RACE_OPTION]);
      await client.query('delete from public.option_variant_choices where group_id = $1', [RACE_GROUP]);
      await client.query('delete from public.option_variant_groups where id = $1', [RACE_GROUP]);
      await client.query('delete from public.options where id = $1', [RACE_OPTION]);
      await client.query('delete from public.option_categories where id = $1', [RACE_CATEGORY]);
      await client.query('delete from public.profiles where id = $1', [RACE_USER]);
      await client.query('delete from auth.users where id = $1', [RACE_USER]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
  });
}

async function beginAuthenticated(client) {
  await client.query('begin');
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: 'authenticated', sub: RACE_USER }),
  ]);
  await client.query('set local role authenticated');
}

async function setProductCost(client, cost, expectedLockVersion, reason) {
  return client.query(
    `select standard_cost, lock_version, changed
       from public.set_option_hq_standard_cost($1, $2, $3, $4)`,
    [RACE_OPTION, cost, expectedLockVersion, reason]
  );
}

async function setVariantAdjustment(client, choiceId, adjustment, expectedVersionId, reason) {
  return client.query(
    `select version_id, version_no, cost_adjustment, changed
       from public.set_option_variant_cost_adjustment($1, $2, $3, $4)`,
    [choiceId, adjustment, expectedVersionId, reason]
  );
}

async function commitAlone(connectionString, fn) {
  await withClient(connectionString, async (client) => {
    await beginAuthenticated(client);
    try {
      await fn(client);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
  });
}

// 後続の transaction が lock を待っている（先に通り抜けていない）ことを確かめてから先行を commit する
async function waitUntilBlocked(verify, pid) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const res = await verify.query(
      `select wait_event_type from pg_stat_activity where pid = $1`,
      [pid]
    );
    if (res.rows[0]?.wait_event_type === 'Lock') return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * 先行 transaction（first）が lock を持ったまま、後続（second）を走らせ、後続が待っていることを確かめてから先行を commit する。
 * 戻り値：先行の結果、後続の結果（成功／失敗）、後続が待ったか
 */
async function race(connectionString, first, second) {
  const a = new pg.Client({ connectionString });
  const b = new pg.Client({ connectionString });
  const verify = new pg.Client({ connectionString });
  await Promise.all([a.connect(), b.connect(), verify.connect()]);
  try {
    await beginAuthenticated(a);
    const firstResult = await first(a);
    await beginAuthenticated(b);
    const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    const secondPromise = second(b)
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({ ok: false, error }));
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
  const code = result.error?.code ?? '(no code)';
  const kind = String(result.error?.message ?? '').split(':')[0];
  return `${code} ${kind}`;
}

async function readState(connectionString) {
  return withClient(connectionString, async (client) => {
    const res = await client.query(
      `select
         (select count(*) from public.option_standard_cost_versions where option_id = $1)::int as product_versions,
         (select count(*) from public.option_standard_cost_versions where option_id = $1 and superseded_at is null)::int as product_current,
         (select standard_cost from public.option_hq_standard_costs where option_id = $1) as mirror_cost,
         (select lock_version from public.option_hq_standard_costs where option_id = $1) as mirror_lock_version,
         (select c.current_version_id = v.id and c.standard_cost = v.standard_cost
            from public.option_hq_standard_costs c
            join public.option_standard_cost_versions v on v.option_id = c.option_id and v.superseded_at is null
           where c.option_id = $1) as mirror_matches,
         (select count(*) from public.audit_logs where entity = 'option_hq_standard_cost' and entity_id = $1)::int as product_audits,
         (select count(*) from public.option_variant_cost_versions where variant_choice_id = $2)::int as c1_versions,
         (select count(*) from public.option_variant_cost_versions where variant_choice_id = $2 and superseded_at is null)::int as c1_current,
         (select cost_adjustment from public.option_variant_cost_versions where variant_choice_id = $2 and superseded_at is null) as c1_adjustment,
         (select id from public.option_variant_cost_versions where variant_choice_id = $2 and superseded_at is null) as c1_version_id,
         (select count(*) from public.option_variant_cost_versions where variant_choice_id = $3)::int as c2_versions`,
      [RACE_OPTION, RACE_CHOICE_1, RACE_CHOICE_2]
    );
    return res.rows[0];
  });
}

async function runRaces(connectionString) {
  const results = [];
  const push = (step, expected, actual) => results.push({ step, expected, actual, ok: actual === expected });

  await seedRaceFixture(connectionString);
  try {
    // 1. 同じ版を読んだ 2 人が商品の原価を同時に変える：後勝ちにせず、後続は競合で止まる
    await commitAlone(connectionString, (client) => setProductCost(client, 10000, 0, '同時変更の準備'));
    const r1 = await race(
      connectionString,
      (a) => setProductCost(a, 12000, 1, '同時変更A'),
      (b) => setProductCost(b, 13000, 1, '同時変更B')
    );
    push('商品の原価の同時変更：後続は先行のlockを待つ', 'true', String(r1.blocked));
    push('商品の原価の同時変更：先行は新しいVersionで成功する', '12000/2/true',
      `${r1.firstResult.rows[0]?.standard_cost}/${r1.firstResult.rows[0]?.lock_version}/${r1.firstResult.rows[0]?.changed}`);
    push('商品の原価の同時変更：後続は競合で拒否する', 'P0001 CONFLICT', errorKind(r1.secondResult));
    let s = await readState(connectionString);
    push('商品の原価の同時変更：Versionは2つ・現在は1つ・写しが一致・監査は2件', '2/1/12000/2/true/2',
      `${s.product_versions}/${s.product_current}/${s.mirror_cost}/${s.mirror_lock_version}/${s.mirror_matches}/${s.product_audits}`);

    // 2. 未設定の選択肢へ 2 人が同時に調整額を初回設定する：後続は競合で止まる
    const r2 = await race(
      connectionString,
      (a) => setVariantAdjustment(a, RACE_CHOICE_1, -1000, null, '同時初回設定A'),
      (b) => setVariantAdjustment(b, RACE_CHOICE_1, -2000, null, '同時初回設定B')
    );
    push('調整額の同時初回設定：後続は先行のlockを待つ', 'true', String(r2.blocked));
    push('調整額の同時初回設定：後続は競合で拒否する', 'P0001 CONFLICT', errorKind(r2.secondResult));
    s = await readState(connectionString);
    push('調整額の同時初回設定：先行の値だけがVersion 1で残る', '1/1/-1000', `${s.c1_versions}/${s.c1_current}/${s.c1_adjustment}`);

    // 3. 原価の引き下げ（先行）と、マイナスの調整額（後続）が同時に来る：合わせると 0 円未満なので後続を止める
    const r3 = await race(
      connectionString,
      (a) => setProductCost(a, 5000, 2, '原価の引き下げ'),
      (b) => setVariantAdjustment(b, RACE_CHOICE_2, -8000, null, '大サイズの原価差')
    );
    push('原価の引き下げが先：後続の調整額は先行のlockを待つ', 'true', String(r3.blocked));
    push('原価の引き下げが先：先行は成功する', '5000/3/true',
      `${r3.firstResult.rows[0]?.standard_cost}/${r3.firstResult.rows[0]?.lock_version}/${r3.firstResult.rows[0]?.changed}`);
    push('原価の引き下げが先：合わせて0円未満になる後続の調整額を拒否する', 'P0001 VALIDATION', errorKind(r3.secondResult));
    s = await readState(connectionString);
    push('原価の引き下げが先：調整額のVersionは作られない', '0/5000/true', `${s.c2_versions}/${s.mirror_cost}/${s.mirror_matches}`);

    // 4. マイナスの調整額（先行）と、原価の引き下げ（後続）が同時に来る：逆の順でも後続を止める
    const r4 = await race(
      connectionString,
      (a) => setVariantAdjustment(a, RACE_CHOICE_1, -4000, s.c1_version_id, '小サイズの原価差の見直し'),
      (b) => setProductCost(b, 3000, 3, '原価の引き下げ')
    );
    push('調整額が先：後続の原価の変更は先行のlockを待つ', 'true', String(r4.blocked));
    push('調整額が先：先行は新しいVersionで成功する', '2/-4000/true',
      `${r4.firstResult.rows[0]?.version_no}/${r4.firstResult.rows[0]?.cost_adjustment}/${r4.firstResult.rows[0]?.changed}`);
    push('調整額が先：合わせて0円未満になる後続の原価の変更を拒否する', 'P0001 VALIDATION', errorKind(r4.secondResult));
    s = await readState(connectionString);
    push('調整額が先：商品の原価は先行前のまま（Version 3つ・写しのversion 3）', '3/1/5000/3/true',
      `${s.product_versions}/${s.product_current}/${s.mirror_cost}/${s.mirror_lock_version}/${s.mirror_matches}`);
    push('調整額が先：調整額はVersion 2が現在', '2/1/-4000', `${s.c1_versions}/${s.c1_current}/${s.c1_adjustment}`);
  } catch (error) {
    return { ok: false, results, error: error.message };
  } finally {
    await cleanupRaceFixture(connectionString).catch((error) => {
      results.push({ step: '標準原価Versionの同時実行fixtureを後始末する', expected: 'cleanup success', actual: error.message, ok: false });
    });
  }
  return { ok: results.length > 0 && results.every((item) => item.ok), results };
}

export async function runtimeOptionStandardCostVersions(client, { connectionString }) {
  const single = await runSingleConnectionChecks(client);
  if (!single.ok) return single;
  const races = await runRaces(connectionString);
  return {
    ok: single.ok && races.ok,
    results: [...single.results, ...races.results],
    ...(races.error ? { error: races.error } : {}),
  };
}
