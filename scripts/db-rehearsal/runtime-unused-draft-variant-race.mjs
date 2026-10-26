import pg from 'pg';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 指定の接続が、ロックを待っている（granted = false）ことを確かめる */
async function waitForLockWait(observer, pid, timeoutMs = 1500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await observer.query('select exists (select 1 from pg_locks where pid = $1 and not granted) as ok', [pid]);
    if (res.rows[0]?.ok) return true;
    await delay(20);
  }
  return false;
}

async function beginAs(client, userId) {
  await client.query('begin');
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'authenticated', sub: userId })]);
  await client.query('set local role authenticated');
}

const pidOf = async (client) => Number((await client.query('select pg_backend_pid() as pid')).rows[0].pid);
const outcome = async (promise) => {
  try {
    await promise;
    return { ok: true, code: null, message: '' };
  } catch (error) {
    return { ok: false, code: error.code ?? null, message: error.message ?? String(error) };
  }
};
const describe = (r) => (r.ok ? 'success' : `${r.code ?? 'error'} ${r.message}`.trim());

/**
 * 下書き商品の選択項目・選択肢の安全削除（20261025101000）の同時実行の試験。使い捨て DB 専用。
 * 削除の RPC は商品の行を FOR UPDATE で押さえ、商品の参照の検査で選択項目・選択肢・保存済み仕様などの表を SHARE で押さえる。
 * - 削除の途中の公開・選択肢の追加・表示条件の変更は、削除の完了を待つ（同時には書けない）
 * - 公開の途中の削除は、公開の完了を待ってから「下書き商品だけ」で止まる
 * - 同じ選択肢の二重の削除は、後の方が NOT_FOUND で止まる
 */
export async function runtimeUnusedDraftVariantRace({ connectionString }) {
  if (!connectionString) {
    return { ok: false, results: [{ step: 'variant-delete race', expected: 'connectionString', actual: 'missing', ok: false }] };
  }
  const id = (n) => `00000000-0000-4000-8000-00000000e${String(n).padStart(3, '0')}`;
  const ids = {
    admin: id(501),
    category: id(502),
    // VR-1：削除の途中の公開／VR-2：公開の途中の削除／VR-3・4：項目の削除と追加・表示条件／VR-5：二重の削除
    p1: id(511), p2: id(512), p3: id(513), p4: id(514),
    g1: id(521), g2: id(522), g3color: id(523), g3size: id(524), g3other: id(525), g4: id(526),
    c1: id(531), c2: id(532), c3red: id(533), c3small: id(534), c3new: id(535), c4a: id(536),
  };
  const products = [ids.p1, ids.p2, ids.p3, ids.p4];
  const setup = new pg.Client({ connectionString });
  const observer = new pg.Client({ connectionString });
  const deleter = new pg.Client({ connectionString });
  const writer = new pg.Client({ connectionString });
  const deleter2 = new pg.Client({ connectionString });
  const clients = [setup, observer, deleter, writer, deleter2];
  const results = [];
  const record = (step, expected, actual) => results.push({ step, expected, actual, ok: expected === actual });

  for (const client of clients) {
    await client.connect();
    await client.query("set statement_timeout = '10s'");
  }

  const cleanup = async () => {
    await setup.query('begin');
    await setup.query("set local session_replication_role = 'replica'");
    if ((await setup.query("select to_regclass('public.option_variant_cost_versions') is not null as ok")).rows[0].ok) {
      await setup.query('delete from public.option_variant_cost_versions where variant_choice_id = any($1::uuid[])', [[ids.c1, ids.c2, ids.c3red, ids.c3small, ids.c4a]]);
    }
    await setup.query(
      'delete from public.option_variant_choices vc using public.option_variant_groups vg where vc.group_id = vg.id and vg.option_id = any($1::uuid[])',
      [products]
    );
    await setup.query('delete from public.option_variant_choices where id = $1::uuid', [ids.c3new]);
    await setup.query('delete from public.option_variant_groups where option_id = any($1::uuid[])', [products]);
    await setup.query('delete from public.options where id = any($1::uuid[])', [products]);
    await setup.query('delete from public.option_categories where id = $1::uuid', [ids.category]);
    await setup.query('delete from public.profiles where id = $1::uuid', [ids.admin]);
    await setup.query('delete from auth.users where id = $1::uuid', [ids.admin]);
    await setup.query('commit');
  };

  const seed = async () => {
    await setup.query('begin');
    await setup.query("set local session_replication_role = 'replica'");
    await setup.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1::uuid, 'variant-race-admin@runtime.invalid', '{}'::jsonb)`, [ids.admin]);
    await setup.query(
      `insert into public.profiles (id, email, full_name, role_code) values ($1::uuid, 'variant-race-admin@runtime.invalid', '選択肢削除の同時実行', 'admin')`,
      [ids.admin]
    );
    await setup.query(`insert into public.option_categories (id, code, name, status) values ($1::uuid, 'runtime-variant-race', '選択肢削除の同時実行', 'published')`, [ids.category]);
    await setup.query(
      `insert into public.options (id, category_id, code, name, status, product_no) values
         ($1::uuid, $5::uuid, 'runtime-variant-race-1', '同時実行の下書き 1', 'draft', 'PRD-999981'),
         ($2::uuid, $5::uuid, 'runtime-variant-race-2', '同時実行の下書き 2', 'draft', 'PRD-999982'),
         ($3::uuid, $5::uuid, 'runtime-variant-race-3', '同時実行の下書き 3', 'draft', 'PRD-999983'),
         ($4::uuid, $5::uuid, 'runtime-variant-race-4', '同時実行の下書き 4', 'draft', 'PRD-999984')`,
      [ids.p1, ids.p2, ids.p3, ids.p4, ids.category]
    );
    await setup.query(
      `insert into public.option_variant_groups (id, option_id, code, name, status) values
         ($1::uuid, $7::uuid, 'color', '色', 'published'),
         ($2::uuid, $8::uuid, 'color', '色', 'published'),
         ($3::uuid, $9::uuid, 'color', '色', 'published'),
         ($4::uuid, $9::uuid, 'size', 'サイズ', 'published'),
         ($5::uuid, $9::uuid, 'other', '別の項目', 'published'),
         ($6::uuid, $10::uuid, 'color', '色', 'published')`,
      [ids.g1, ids.g2, ids.g3color, ids.g3size, ids.g3other, ids.g4, ids.p1, ids.p2, ids.p3, ids.p4]
    );
    await setup.query(
      `insert into public.option_variant_choices (id, group_id, code, name, status) values
         ($1::uuid, $6::uuid, 'blue', '青', 'published'),
         ($2::uuid, $7::uuid, 'red', '赤', 'published'),
         ($3::uuid, $8::uuid, 'red', '赤', 'published'),
         ($4::uuid, $9::uuid, 'small', '小', 'published'),
         ($5::uuid, $10::uuid, 'a', 'A', 'published')`,
      [ids.c1, ids.c2, ids.c3red, ids.c3small, ids.c4a, ids.g1, ids.g2, ids.g3color, ids.g3size, ids.g4]
    );
    await setup.query('commit');
  };

  const deleteChoice = (client, optionId, choiceId) => client.query('select public.delete_unused_variant_choice($1::uuid, $2::uuid)', [optionId, choiceId]);
  const deleteGroup = (client, optionId, groupId) => client.query('select public.delete_unused_variant_group($1::uuid, $2::uuid)', [optionId, groupId]);
  const exists = async (sql, params) => (await setup.query(sql, params)).rowCount > 0;
  const statusOf = async (optionId) => (await setup.query('select status from public.options where id = $1::uuid', [optionId])).rows[0]?.status;

  try {
    await cleanup();
    await seed();
    const writerPid = await pidOf(writer);
    const deleterPid = await pidOf(deleter);
    const deleter2Pid = await pidOf(deleter2);

    // VR-1：削除の途中に同じ商品を公開しようとすると、公開は削除の完了を待ち、その後に公開される
    await beginAs(deleter, ids.admin);
    const del1 = await outcome(deleteChoice(deleter, ids.p1, ids.c1));
    await beginAs(writer, ids.admin);
    const publishPromise = outcome(writer.query("update public.options set status = 'published' where id = $1::uuid", [ids.p1]));
    const publishWaits = await waitForLockWait(observer, writerPid);
    await deleter.query('commit');
    const publish = await publishPromise;
    await writer.query('commit').catch(() => {});
    record('VR-1a 削除の途中の公開は、削除の完了を待つ', 'true/success/success', `${publishWaits}/${describe(del1)}/${describe(publish)}`);
    record(
      'VR-1b 削除した選択肢は消え、商品は公開される（途中の状態を残さない）',
      'false/published',
      `${await exists('select 1 from public.option_variant_choices where id = $1::uuid', [ids.c1])}/${await statusOf(ids.p1)}`
    );

    // VR-2：公開の途中に削除すると、削除は公開の完了を待ち、公開済みになったので「下書き商品だけ」で止まる（選択肢は残る）
    await beginAs(writer, ids.admin);
    await writer.query("update public.options set status = 'published' where id = $1::uuid", [ids.p2]);
    await beginAs(deleter, ids.admin);
    const deletePromise = outcome(deleteChoice(deleter, ids.p2, ids.c2));
    const deleteWaits = await waitForLockWait(observer, deleterPid);
    await delay(150);
    await writer.query('commit');
    const del2 = await deletePromise;
    await deleter.query('rollback').catch(() => {});
    record(
      'VR-2a 公開の途中の削除は、公開の完了を待ってから「下書き商品だけ」で止まる',
      'true/P0001/draft-only',
      `${deleteWaits}/${del2.code}/${del2.message.includes('下書き商品だけ') ? 'draft-only' : del2.message}`
    );
    record('VR-2b 止めた削除の選択肢は残る', 'true/published', `${await exists('select 1 from public.option_variant_choices where id = $1::uuid', [ids.c2])}/${await statusOf(ids.p2)}`);

    // VR-3：選択項目の削除の途中に、その項目へ選択肢を足そうとすると、追加は削除の完了を待ち、項目が無いので外部キーで止まる
    await beginAs(deleter, ids.admin);
    const del3 = await outcome(deleteGroup(deleter, ids.p3, ids.g3size));
    await beginAs(writer, ids.admin);
    const insertPromise = outcome(
      writer.query(`insert into public.option_variant_choices (id, group_id, code, name, status) values ($1::uuid, $2::uuid, 'medium', '中', 'published')`, [
        ids.c3new,
        ids.g3size,
      ])
    );
    const insertWaits = await waitForLockWait(observer, writerPid);
    await deleter.query('commit');
    const ins = await insertPromise;
    await writer.query('rollback').catch(() => {});
    record('VR-3a 項目の削除の途中の選択肢の追加は、削除の完了を待つ', 'true/success', `${insertWaits}/${describe(del3)}`);
    record(
      'VR-3b 削除した項目への選択肢の追加は外部キーで止まり、項目も選択肢も残らない',
      '23503/false/false/false',
      `${ins.code}/${await exists('select 1 from public.option_variant_groups where id = $1::uuid', [ids.g3size])}/${await exists(
        'select 1 from public.option_variant_choices where id = $1::uuid',
        [ids.c3small]
      )}/${await exists('select 1 from public.option_variant_choices where id = $1::uuid', [ids.c3new])}`
    );

    // VR-4：選択肢の削除の途中に、別の項目の表示条件をその選択肢へ変えようとすると、変更は削除の完了を待つ
    //       （待った後の変更は保存される。表示条件の参照先の確認は保存の側の仕事なので、残るリスクとして記録する）
    await beginAs(deleter, ids.admin);
    const del4 = await outcome(deleteChoice(deleter, ids.p3, ids.c3red));
    await beginAs(writer, ids.admin);
    const conditionPromise = outcome(
      writer.query(`update public.option_variant_groups set depends_on_group_code = 'color', depends_on_choice_codes = array['red']::text[] where id = $1::uuid`, [
        ids.g3other,
      ])
    );
    const conditionWaits = await waitForLockWait(observer, writerPid);
    await deleter.query('commit');
    const condition = await conditionPromise;
    await writer.query('commit').catch(() => {});
    record('VR-4a 選択肢の削除の途中の表示条件の変更は、削除の完了を待つ', 'true/success', `${conditionWaits}/${describe(del4)}`);
    record('VR-4b （記録）待った後の表示条件の変更は保存される（参照先の確認は保存の側）', 'success', describe(condition));

    // VR-5：同じ選択肢の二重の削除は、後の方が削除の完了を待ってから NOT_FOUND で止まる
    await beginAs(deleter, ids.admin);
    const first = await outcome(deleteChoice(deleter, ids.p4, ids.c4a));
    await beginAs(deleter2, ids.admin);
    const secondPromise = outcome(deleteChoice(deleter2, ids.p4, ids.c4a));
    const secondWaits = await waitForLockWait(observer, deleter2Pid);
    await deleter.query('commit');
    const second = await secondPromise;
    await deleter2.query('rollback').catch(() => {});
    record(
      'VR-5 二重の削除は、後の方が待ってから NOT_FOUND で止まる',
      'true/success/P0001/NOT_FOUND',
      `${secondWaits}/${describe(first)}/${second.code}/${second.message.includes('NOT_FOUND') ? 'NOT_FOUND' : second.message}`
    );

    // VR-6：原価 Version（v2.5）がある選択肢は、外部キー（RESTRICT）で削除を止める。項目の削除も同じ（v2.5 が無い DB では省略）
    const hasCostVersions = (await setup.query("select to_regclass('public.option_variant_cost_versions') is not null as ok")).rows[0].ok;
    if (!hasCostVersions) {
      record('VR-6 原価 Version がある選択肢は削除しない（v2.5 が無い DB のため省略）', 'skipped', 'skipped');
    } else {
      await setup.query('begin');
      await setup.query("set local session_replication_role = 'replica'");
      await setup.query(
        `insert into public.option_variant_cost_versions (variant_choice_id, version_no, cost_adjustment, change_reason) values ($1::uuid, 1, 5000, '同時実行の検査')`,
        [ids.c2]
      );
      await setup.query("update public.options set status = 'draft' where id = $1::uuid", [ids.p2]);
      await setup.query('commit');
      await beginAs(deleter, ids.admin);
      const costChoice = await outcome(deleteChoice(deleter, ids.p2, ids.c2));
      await deleter.query('rollback').catch(() => {});
      await beginAs(deleter, ids.admin);
      const costGroup = await outcome(deleteGroup(deleter, ids.p2, ids.g2));
      await deleter.query('rollback').catch(() => {});
      record(
        'VR-6 原価 Version がある選択肢・その項目は、外部キーで削除を止める（選択肢も原価 Version も残る）',
        '23503/23503/true',
        `${costChoice.code}/${costGroup.code}/${await exists('select 1 from public.option_variant_choices where id = $1::uuid', [ids.c2])}`
      );
      await setup.query('begin');
      await setup.query("set local session_replication_role = 'replica'");
      await setup.query('delete from public.option_variant_cost_versions where variant_choice_id = $1::uuid', [ids.c2]);
      await setup.query('commit');
    }
  } catch (error) {
    results.push({ step: 'variant-delete race（実行時の例外）', expected: 'no error', actual: error.message ?? String(error), ok: false });
  } finally {
    for (const client of [deleter, writer, deleter2]) await client.query('rollback').catch(() => {});
    await cleanup().catch((error) => results.push({ step: 'variant-delete race cleanup', expected: 'ok', actual: error.message, ok: false }));
    for (const client of clients) await client.end().catch(() => {});
  }
  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}
