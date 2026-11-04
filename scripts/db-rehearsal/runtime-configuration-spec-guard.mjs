/**
 * #389（本体分類表の仕様別カテゴリー選択の corrective。10/13 に PR B #441 へそのまま移植・本番適用済み）で
 * 「本番適用前に業者側で実 DB で確かめる」とした安全機構の実行時検査。使い捨て DB 専用。
 *
 * - 1 本の接続で確かめるもの（runtime-configuration-spec-guard.sql・最後に rollback）：
 *   仕様なしの Draft・本体分類表の × ・商品の対象仕様とモデル・履歴の明細の保護・API ロールの直接書き込み・
 *   Draft 削除の CASCADE・履歴の状態の遷移と仕様の変更・hotel-single の別名
 * - 2 本の接続で確かめるもの（ここ）：親の Configuration の仕様・状態の変更と、明細の書き込みが直列になること
 *   （明細の保護は親の行を FOR UPDATE してから判定するので、後から来た方は先の確定を待ち、確定後の仕様・状態で判定される）
 *
 * 2 本の接続から見える必要があるため、同時実行の試験データは commit して最後に削除する。
 * そのため接続先がこのマシン上（ループバック）の DB でなければ同時実行の検査は実行しない。本番では実行しない。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const USER = '28900000-0000-4000-8000-0000000010c1';
const MODEL = '28900000-0000-4000-8000-0000000010b1';
const ROW_OK = '28900000-0000-4000-8000-0000000010d1';
const ROW_NG = '28900000-0000-4000-8000-0000000010d2';
const CATEGORY = '28900000-0000-4000-8000-0000000010e1';
const PRODUCT = '28900000-0000-4000-8000-0000000010f1';
const DRAFT = '28900000-0000-4000-8000-000000001101';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 1 本の接続の検査（SQL ファイル・最後に rollback） */
async function runSingleConnection(client) {
  const sql = fs.readFileSync(path.join(HERE, 'runtime-configuration-spec-guard.sql'), 'utf8').split('\r').join('');
  try {
    const res = await client.query(sql);
    const rows = Array.isArray(res) ? res : [res];
    return rows.find((row) => row.rows?.[0]?.j)?.rows[0].j ?? [];
  } catch (error) {
    await client.query('rollback').catch(() => {});
    return [{ step: 'CSG-x 本体分類表のガードの検査を完了できませんでした', expected: '完了', actual: error.message, ok: false }];
  }
}

/** 指定した接続が行 lock を待っているか（最大 5 秒待つ） */
async function waitingForLock(admin, pid) {
  for (let i = 0; i < 50; i++) {
    const row = (await admin.query('select wait_event_type from pg_stat_activity where pid = $1', [pid])).rows[0];
    if (row?.wait_event_type === 'Lock') return true;
    await sleep(100);
  }
  return false;
}

async function settle(promise) {
  try {
    await promise;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `${error.code}: ${error.message}` };
  }
}

/**
 * @param {import('pg').Client} client 1 本目の接続（スーパーユーザー）
 * @param {import('pg').ClientConfig} config 同時実行の検査に使う接続の設定
 */
export async function runtimeConfigurationSpecGuard(client, config) {
  const ready = (await client.query(`select
      to_regprocedure('public.enforce_configuration_item_draft_parent()') is not null
      and to_regprocedure('public.customer_category_selectable(text, text, text)') is not null
      and to_regclass('public.matrix_rows') is not null as ok`)).rows[0].ok;
  if (ready !== true) {
    return { ok: true, results: [{ step: '本体分類表のガード（#389 の移植が無い DB のため省略）', expected: 'skipped', actual: 'skipped', ok: true }] };
  }

  const results = await runSingleConnection(client);
  const check = (step, expected, actual) => results.push({ step, expected, actual: String(actual), ok: String(actual) === String(expected) });

  const host = config.host ?? (config.connectionString ? new URL(config.connectionString).hostname : '');
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    check('CSG-C 同時実行の検査（ローカルの使い捨て DB でだけ実行）', 'skipped', 'skipped');
    return { ok: results.every((item) => item.ok), results };
  }

  const admin = new pg.Client(config);
  const a = new pg.Client(config);
  const b = new pg.Client(config);
  await admin.connect();

  const cleanup = async () => {
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`delete from public.configuration_items where configuration_id = '${DRAFT}'`);
    await admin.query(`delete from public.configurations where id = '${DRAFT}'`);
    await admin.query(`delete from public.options where id = '${PRODUCT}'`);
    await admin.query(`delete from public.option_category_matrix_items where category_id = '${CATEGORY}'`);
    await admin.query(`delete from public.option_categories where id = '${CATEGORY}'`);
    await admin.query(`delete from public.matrix_cells where matrix_row_id in ('${ROW_OK}', '${ROW_NG}')`);
    await admin.query(`delete from public.matrix_rows where id in ('${ROW_OK}', '${ROW_NG}')`);
    await admin.query(`delete from public.base_models where id = '${MODEL}'`);
    await admin.query(`delete from public.matrix_items where code = 'rtcsgc-item'`);
    await admin.query(`delete from public.matrix_specs where code in ('rtcsgc-ok', 'rtcsgc-ng')`);
    await admin.query(`delete from public.matrix_sizes where code = '9980x9980'`);
    await admin.query(`delete from public.profiles where id = '${USER}'`);
    await admin.query(`delete from auth.users where id = '${USER}'`);
    await admin.query('commit');
  };

  /** Draft を「選べる仕様・明細なし」に戻す（毎回の前提） */
  const resetDraft = async () => {
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`delete from public.configuration_items where configuration_id = '${DRAFT}'`);
    await admin.query(`update public.configurations set spec_code = 'rtcsgc-ok', status = 'draft' where id = '${DRAFT}'`);
    await admin.query('commit');
  };

  const insertItem = `insert into public.configuration_items (configuration_id, option_id) values ('${DRAFT}', '${PRODUCT}')`;

  try {
    await cleanup();
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`insert into auth.users (id, email, raw_user_meta_data) values ('${USER}', 'csgc@runtime.invalid', '{}')`);
    await admin.query(`insert into public.profiles (id, email, full_name, role_code) values ('${USER}', 'csgc@runtime.invalid', 'csgc', 'customer')`);
    await admin.query(`insert into public.base_models (id, slug, name, base_price, status) values ('${MODEL}', 'runtime-csgc-model', '#389 同時実行の検査用モデル', 1000000, 'published')`);
    await admin.query(`insert into public.matrix_specs (code, label) values ('rtcsgc-ok', 'RT 選択'), ('rtcsgc-ng', 'RT ×')`);
    await admin.query(`insert into public.matrix_sizes (code, width_mm, depth_mm, label) values ('9980x9980', 9980, 9980, 'RT')`);
    await admin.query(`insert into public.matrix_items (code, label) values ('rtcsgc-item', 'RT 項目')`);
    await admin.query(`insert into public.matrix_rows (id, base_model_id, spec_code, size_code, fire_selectable)
      values ('${ROW_OK}', '${MODEL}', 'rtcsgc-ok', '9980x9980', false), ('${ROW_NG}', '${MODEL}', 'rtcsgc-ng', '9980x9980', false)`);
    await admin.query(`insert into public.matrix_cells (matrix_row_id, matrix_item_code, selectable)
      values ('${ROW_OK}', 'rtcsgc-item', true), ('${ROW_NG}', 'rtcsgc-item', false)`);
    await admin.query(`insert into public.option_categories (id, code, name, status) values ('${CATEGORY}', 'runtime-csgc-matrix', '#389 同時実行 マトリクス対象', 'published')`);
    await admin.query(`insert into public.option_category_matrix_items (category_id, matrix_item_code) values ('${CATEGORY}', 'rtcsgc-item')`);
    await admin.query(`insert into public.options (id, category_id, code, name, price, status, spec_codes, product_no)
      values ('${PRODUCT}', '${CATEGORY}', 'runtime-csgc-matrix', '対象カテゴリーの商品', 1000, 'published', '{}', 'PRD-928911')`);
    await admin.query(`insert into public.configurations (id, user_id, base_model_id, name, status, spec_code, finish_level)
      values ('${DRAFT}', '${USER}', '${MODEL}', '同時実行の Draft', 'draft', 'rtcsgc-ok', 'full')`);
    await admin.query('commit');
    await a.connect();
    await b.connect();
    const bPid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;

    // C-1：仕様の変更（×へ）が先 → 明細の追加は待ち、確定後の仕様（×）で止まる
    await a.query('begin');
    await a.query(`update public.configurations set spec_code = 'rtcsgc-ng' where id = '${DRAFT}'`);
    await b.query('begin');
    const c1 = settle(b.query(insertItem));
    check('CSG-C1 仕様の変更中に届いた明細の追加は、仕様の変更の確定を待つ', 'true', await waitingForLock(admin, bPid));
    await a.query('commit');
    const c1Result = await c1;
    await b.query('rollback');
    check('CSG-C2 確定後の仕様（×）で判定され、明細の追加は止まる', 'true', !c1Result.ok && /VALIDATION/.test(c1Result.error ?? ''));
    check('CSG-C3 止まった追加で明細は増えていない', '0',
      (await admin.query(`select count(*)::int as n from public.configuration_items where configuration_id = '${DRAFT}'`)).rows[0].n);

    // C-2：明細の追加が先 → 仕様の変更（×へ）は待ち、確定の時点の検査で止まる
    await resetDraft();
    await a.query('begin');
    await a.query(insertItem);
    await b.query('begin');
    const c2 = settle(b.query(`update public.configurations set spec_code = 'rtcsgc-ng' where id = '${DRAFT}'`).then(() => b.query('commit')));
    check('CSG-C4 明細の追加中に届いた仕様の変更は、追加の確定を待つ', 'true', await waitingForLock(admin, bPid));
    await a.query('commit');
    const c2Result = await c2;
    if (!c2Result.ok) await b.query('rollback').catch(() => {});
    check('CSG-C5 追加の確定後、明細が × になる仕様の変更は止まる', 'true', !c2Result.ok && /VALIDATION/.test(c2Result.error ?? ''));
    check('CSG-C6 仕様は選べる仕様のまま・明細は 1 件',
      'rtcsgc-ok/1',
      (await admin.query(`select spec_code || '/' || (select count(*) from public.configuration_items where configuration_id = c.id) as v
        from public.configurations c where c.id = '${DRAFT}'`)).rows[0].v);

    // C-3：見積依頼などで Draft でなくなるのが先 → 明細の追加は待ち、確定後に履歴として止まる
    await resetDraft();
    await a.query('begin');
    await a.query(`update public.configurations set status = 'quote_requested' where id = '${DRAFT}'`);
    await b.query('begin');
    const c3 = settle(b.query(insertItem));
    check('CSG-C7 Draft でなくなる変更の途中に届いた明細の追加は、確定を待つ', 'true', await waitingForLock(admin, bPid));
    await a.query('commit');
    const c3Result = await c3;
    await b.query('rollback');
    check('CSG-C8 確定後は履歴として明細の追加が止まる', 'true', !c3Result.ok && /LOCKED/.test(c3Result.error ?? ''));
  } catch (error) {
    results.push({ step: 'CSG-Cx 同時実行の検査を完了できませんでした', expected: '完了', actual: error.message, ok: false });
    await a.query('rollback').catch(() => {});
    await b.query('rollback').catch(() => {});
  } finally {
    await cleanup().catch((error) => results.push({ step: 'CSG-Cy 試験データの削除', expected: '削除', actual: error.message, ok: false }));
    await a.end().catch(() => {});
    await b.end().catch(() => {});
    await admin.end().catch(() => {});
  }
  return { ok: results.length > 0 && results.every((item) => item.ok), results };
}
