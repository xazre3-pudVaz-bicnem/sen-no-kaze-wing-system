/**
 * Configuration 保存の同時編集（optimistic locking）の実行時検査。使い捨て DB 専用。
 *
 * 2 本の接続から同じ Draft を保存し、「読み込んだ時点の版と一致する保存だけが成功する」
 * 「同時に届いた保存は必ず片方だけ成功する」ことを、実際の行 lock とトランザクションで確かめる。
 * 見積依頼も同じく、「確認画面を表示した時点の版と一致する依頼だけが見積を作る」
 * 「保存と同時に届いた依頼・依頼と同時に届いた保存は、後から来た方が拒否される」ことを確かめる。
 *
 * 2 本の接続から見える必要があるため、試験データは commit して最後に削除する。
 * そのため接続先がこのマシン上（ループバック）の DB でなければ実行しない。本番では実行しない。
 * 商品マスターが空の DB を前提にしている（必須カテゴリーの検証に掛からない最小の保存を使うため）。
 */
import pg from 'pg';

const USER = '00000000-0000-4000-8000-0000000010c1';
const OTHER = '00000000-0000-4000-8000-0000000010c2';
const MODEL = '00000000-0000-4000-8000-0000000010b1';

// `(f()).*` は列の数だけ関数を呼び出すため、必ず FROM 句で 1 回だけ呼ぶ（PostgREST の RPC と同じ形）
const SAVE = `
  select * from public.save_configuration_atomic(
    p_configuration_id => $1, p_base_model_id => '${MODEL}', p_name => $2, p_option_ids => '{}'::uuid[],
    p_preview_image_url => null, p_notes => null, p_finish_level => 'shell', p_variant_choice_ids => '{}'::uuid[],
    p_spec_code => 'base', p_exterior_faces => '[]'::jsonb, p_site_prefecture => null, p_site_municipality => null,
    p_site_location_undecided => false, p_expected_lock_version => $3)`;

// 見積依頼（確認画面を表示した時点の版を渡す）。保存と同じく FROM 句で 1 回だけ呼ぶ
const REQUEST = `
  select * from public.create_quote_from_configuration(
    p_configuration_id => $1, p_contact => $2::jsonb, p_message => null, p_expected_lock_version => $3) as t(id)`;
const CONTACT = JSON.stringify({ full_name: '同時編集A', company_name: null, email: 'lock-a@runtime.invalid', phone: '000-0000-0000', address: '検査用住所', site_address: null });

/** API と同じロール・JWT でトランザクションを開始する */
async function beginAs(client, sub) {
  await client.query('begin');
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  await client.query('set local role authenticated');
}

/** 1 回の保存を 1 トランザクションで行う。成功なら保存後の行、失敗ならエラー文字列を返す */
async function saveOnce(client, sub, id, name, expected) {
  await beginAs(client, sub);
  try {
    const row = (await client.query(SAVE, [id, name, expected])).rows[0];
    await client.query('commit');
    return { ok: true, row };
  } catch (e) {
    await client.query('rollback');
    return { ok: false, error: `${e.code}: ${e.message}` };
  }
}

/** 1 回の見積依頼を 1 トランザクションで行う。成功なら見積 ID、失敗ならエラー文字列を返す */
async function requestOnce(client, sub, id, expected) {
  await beginAs(client, sub);
  try {
    const row = (await client.query(REQUEST, [id, CONTACT, expected])).rows[0];
    await client.query('commit');
    return { ok: true, row };
  } catch (e) {
    await client.query('rollback');
    return { ok: false, error: `${e.code}: ${e.message}` };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {import('pg').ClientConfig} config スーパーユーザーで接続できる設定（使い捨て DB）
 */
export async function runtimeConcurrency(config) {
  const results = [];
  const check = (step, expected, actual) => results.push({ step, expected, actual: String(actual), ok: String(actual) === String(expected) });

  // 試験データを commit するため、このマシン上の DB（ループバック接続）以外では実行しない
  const host = config.host ?? (config.connectionString ? new URL(config.connectionString).hostname : '');
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    return { ok: false, skipped: true, results, error: `接続先（${host || '不明'}）がローカルの使い捨て DB ではないため、同時編集の検査は実行しません` };
  }

  const admin = new pg.Client(config);
  const a = new pg.Client(config);
  const b = new pg.Client(config);
  await admin.connect();

  const where = (await admin.query(`select (select count(*) from public.options) as options,
    to_regprocedure('public.save_configuration_atomic(uuid, uuid, text, uuid[], text, text, text, uuid[], text, jsonb, text, text, boolean, integer)') is not null as has_lock`)).rows[0];
  if (!where.has_lock) {
    await admin.end();
    return { ok: true, skipped: true, results, note: 'save_configuration_atomic に p_expected_lock_version が無いため対象外' };
  }
  if (Number(where.options) > 0) {
    await admin.end();
    return { ok: true, skipped: true, results, note: '商品マスターが空ではないため省略（空の DB で実行する検査）' };
  }

  const cleanup = async () => {
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`delete from public.quote_items where quote_id in (select id from public.quotes where user_id in ('${USER}', '${OTHER}'))`);
    await admin.query(`delete from public.quotes where user_id in ('${USER}', '${OTHER}')`);
    await admin.query(`delete from public.quote_requests where user_id in ('${USER}', '${OTHER}')`);
    await admin.query(`delete from public.configuration_snapshots where configuration_id in (select id from public.configurations where user_id in ('${USER}', '${OTHER}'))`);
    await admin.query(`delete from public.configuration_items where configuration_id in (select id from public.configurations where user_id in ('${USER}', '${OTHER}'))`);
    await admin.query(`delete from public.configurations where user_id in ('${USER}', '${OTHER}')`);
    await admin.query(`delete from public.profiles where id in ('${USER}', '${OTHER}')`);
    await admin.query(`delete from auth.users where id in ('${USER}', '${OTHER}')`);
    await admin.query(`delete from public.base_models where id = '${MODEL}'`);
    await admin.query('commit');
  };

  try {
    await cleanup();
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`insert into public.base_models (id, slug, name, base_price, status) values ('${MODEL}', 'runtime-lock-check', '同時編集検査用モデル', 1000000, 'published')`);
    await admin.query(`insert into auth.users (id, email, raw_user_meta_data) values ('${USER}', 'lock-a@runtime.invalid', '{}'), ('${OTHER}', 'lock-b@runtime.invalid', '{}')`);
    await admin.query(`insert into public.profiles (id, email, full_name, role_code) values ('${USER}', 'lock-a@runtime.invalid', '同時編集A', 'customer'), ('${OTHER}', 'lock-b@runtime.invalid', '同時編集B', 'customer')`);
    await admin.query('commit');
    await a.connect();
    await b.connect();

    // 1. 新規保存は版の指定なしで作成でき、版は 1 から始まる
    const created = await saveOnce(a, USER, null, '新規', null);
    check('L-1 新規保存は版 1 で作成される', '1', created.ok ? created.row.lock_version : created.error);
    const id = created.ok ? created.row.id : null;
    if (!id) throw new Error(`新規保存に失敗したため続行できません: ${created.error}`);

    // 2. 読み込んだ版と一致する保存は成功し、版が進む
    const first = await saveOnce(a, USER, id, '画面Aの保存', 1);
    check('L-2 読み込んだ版（1）での保存は成功し、版が 2 になる', '2', first.ok ? first.row.lock_version : first.error);

    // 3. 古い版のままの画面からの保存は拒否する（後勝ちで上書きしない）
    const stale = await saveOnce(b, USER, id, '画面Bの古い保存', 1);
    check('L-3 古い版（1）のままの保存は拒否される', 'true', !stale.ok && /LOCKED: 他の画面でこのプランが更新されています/.test(stale.error ?? ''));
    check('L-4 拒否された保存で内容は上書きされていない', '画面Aの保存/2',
      (await admin.query('select name, lock_version from public.configurations where id = $1', [id])).rows.map((r) => `${r.name}/${r.lock_version}`)[0]);

    // 4. 版の指定が無い保存も拒否する
    const missing = await saveOnce(b, USER, id, '版の指定なし', null);
    check('L-5 版の指定が無い保存は拒否される', 'true', !missing.ok && /LOCKED/.test(missing.error ?? ''));

    // 5. 最新の版を読み直せば保存できる
    const retry = await saveOnce(b, USER, id, '画面Bが読み直して保存', 2);
    check('L-6 最新の版（2）を読み直した保存は成功し、版が 3 になる', '3', retry.ok ? retry.row.lock_version : retry.error);

    // 6. 同時保存：A が保存を commit する前に B が同じ版で保存する
    await beginAs(a, USER);
    await a.query(SAVE, [id, '同時保存A', 3]); // A は行 lock を持ったまま未 commit
    await beginAs(b, USER);
    let bSettled = false;
    const bPromise = b.query(SAVE, [id, '同時保存B', 3]).then(
      (r) => ({ ok: true, row: r.rows[0] }),
      (e) => ({ ok: false, error: `${e.code}: ${e.message}` })
    ).finally(() => { bSettled = true; });
    await sleep(400);
    check('L-7 同時保存：後から来た保存は、先の保存が終わるまで待たされる', 'true', !bSettled);
    await a.query('commit');
    const bResult = await bPromise;
    await b.query(bResult.ok ? 'commit' : 'rollback');
    check('L-8 同時保存：先の保存が commit された後、後から来た保存は拒否される', 'true', !bResult.ok && /LOCKED/.test(bResult.error ?? ''));
    check('L-9 同時保存：成功したのは片方だけ（版は 1 つだけ進む）', '同時保存A/4',
      (await admin.query('select name, lock_version from public.configurations where id = $1', [id])).rows.map((r) => `${r.name}/${r.lock_version}`)[0]);

    // 7. 他人は版が合っていても保存できない／版を直接書き換えられない
    const other = await saveOnce(b, OTHER, id, '他人の保存', 4);
    check('L-10 他人は版が一致していても保存できない', 'true', !other.ok && /^42501/.test(other.error ?? ''));
    await beginAs(b, USER);
    let direct;
    try {
      const r = await b.query('update public.configurations set lock_version = 99 where id = $1 returning lock_version', [id]);
      direct = r.rowCount === 0 ? '0 行' : `更新できた(${r.rows[0].lock_version})`;
    } catch (e) {
      direct = `${e.code}`;
    }
    await b.query('rollback');
    check('L-11 本人でも版を直接書き換えられない（保存は RPC のみ）', 'true', direct === '42501' || direct === '0 行');

    // 8. 見積依頼：確認画面を表示した時点の版と DB の版が一致しなければ、見積を作らずに拒否する
    const quoteCount = async () =>
      (await admin.query('select count(*)::int as n from public.quotes where configuration_id = $1', [id])).rows[0].n;
    const staleRequest = await requestOnce(b, USER, id, 3);
    check('L-12 古い版（3）のままの見積依頼は拒否される', 'true', !staleRequest.ok && /LOCKED: 他の画面でこのプランが更新されています/.test(staleRequest.error ?? ''));
    const missingRequest = await requestOnce(b, USER, id, null);
    check('L-13 版の指定が無い見積依頼は拒否される', 'true', !missingRequest.ok && /LOCKED/.test(missingRequest.error ?? ''));
    const otherRequest = await requestOnce(b, OTHER, id, 4);
    check('L-14 他人は版が一致していても見積依頼できない', 'true', !otherRequest.ok && /^42501/.test(otherRequest.error ?? ''));
    check('L-15 拒否された見積依頼では、見積は作られずプランも Draft のまま', '0/draft/4',
      `${await quoteCount()}/${(await admin.query('select status, lock_version from public.configurations where id = $1', [id])).rows.map((r) => `${r.status}/${r.lock_version}`)[0]}`);

    // 9. 同時：保存（版 4）が commit される前に、同じ版を表示していた確認画面から見積依頼が届く
    await beginAs(a, USER);
    await a.query(SAVE, [id, '依頼直前の保存', 4]); // A は行 lock を持ったまま未 commit
    await beginAs(b, USER);
    let requestSettled = false;
    const requestPromise = b.query(REQUEST, [id, CONTACT, 4]).then(
      (r) => ({ ok: true, row: r.rows[0] }),
      (e) => ({ ok: false, error: `${e.code}: ${e.message}` })
    ).finally(() => { requestSettled = true; });
    await sleep(400);
    check('L-16 同時：見積依頼は、先の保存が終わるまで待たされる', 'true', !requestSettled);
    await a.query('commit');
    const requestResult = await requestPromise;
    await b.query(requestResult.ok ? 'commit' : 'rollback');
    check('L-17 同時：保存が commit された後、古い版の見積依頼は拒否され、見積は作られない', 'true/0',
      `${!requestResult.ok && /LOCKED/.test(requestResult.error ?? '')}/${await quoteCount()}`);

    // 10. 同時：見積依頼（最新の版 5）が commit される前に、同じ版で保存が届く
    await beginAs(b, USER);
    const requested = (await b.query(REQUEST, [id, CONTACT, 5])).rows[0]; // B は行 lock を持ったまま未 commit
    await beginAs(a, USER);
    let saveSettled = false;
    const savePromise = a.query(SAVE, [id, '依頼中の保存', 5]).then(
      (r) => ({ ok: true, row: r.rows[0] }),
      (e) => ({ ok: false, error: `${e.code}: ${e.message}` })
    ).finally(() => { saveSettled = true; });
    await sleep(400);
    check('L-18 同時：保存は、先の見積依頼が終わるまで待たされる', 'true', !saveSettled);
    await b.query('commit');
    const saveResult = await savePromise;
    await a.query(saveResult.ok ? 'commit' : 'rollback');
    check('L-19 同時：見積依頼が commit された後、保存は拒否される（Draft ではなくなった）', 'true', !saveResult.ok && /LOCKED/.test(saveResult.error ?? ''));
    check('L-20 最新の版での見積依頼は成功し、見積は 1 件・プランは依頼済み（版は進めない）', `1/quote_requested/5/${requested?.id ? 'id' : 'none'}`,
      `${await quoteCount()}/${(await admin.query('select status, lock_version from public.configurations where id = $1', [id])).rows.map((r) => `${r.status}/${r.lock_version}`)[0]}/${requested?.id ? 'id' : 'none'}`);
  } catch (e) {
    results.push({ step: 'L-x 同時編集の検査を完了できませんでした', expected: '完了', actual: e.message, ok: false });
  } finally {
    await a.query('rollback').catch(() => {});
    await b.query('rollback').catch(() => {});
    await cleanup().catch((e) => results.push({ step: 'L-y 試験データの削除', expected: '削除', actual: e.message, ok: false }));
    await a.end().catch(() => {});
    await b.end().catch(() => {});
    await admin.end().catch(() => {});
  }
  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}
