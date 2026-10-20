/**
 * 商品の取扱終了と、保存・提出・発行が同時に来たときの実行時検査（20261015113000）。使い捨て DB 専用。
 *
 * 2 本の接続を使い、片方が取扱終了（商品の行ロック）を持ったまま、もう片方が保存・見積依頼・見積 Draft の保存・発行をする順と、
 * その逆の順の両方を確かめる。成立時点（linearization point）は商品の行のロックで、
 * - 取扱終了が先：後から来た保存は待たされ、取扱終了の確定後に「新しく選べない」で拒否される
 * - 保存が先：後から来た取扱終了は待たされ、保存の確定後に成功する（保存済みの明細は、その後は保持の扱い）
 * 状態の変更どうし（取扱終了・再開・シミュレーター表示）は、画面が読んだ版（updated_at）と一致する更新だけが成功し、
 * 古い画面の操作は 0 件の更新として失敗する（成功扱いにしない）。
 *
 * 2 本の接続から見える必要があるため、試験データは commit して最後に削除する。本番では実行しない（ループバック以外は拒否）。
 * 商品マスターが空の DB を前提にする（必須カテゴリーの検証に掛からない、検査用のカテゴリーと商品だけで保存するため）。
 */
import pg from 'pg';

const ADMIN = '79000000-0000-4000-8000-000000000001';
const CUST = '79000000-0000-4000-8000-000000000002';
const MODEL = '79100000-0000-4000-8000-000000000001';
const CATEGORY = '79200000-0000-4000-8000-000000000001';
const OPT = {
  a: '79300000-0000-4000-8000-000000000001', // 取扱終了 対 構成の保存
  b: '79300000-0000-4000-8000-000000000002', // 取扱終了 対 見積依頼
  c: '79300000-0000-4000-8000-000000000003', // 取扱終了 対 見積 Draft の保存
  d: '79300000-0000-4000-8000-000000000004', // 取扱終了 対 見積の発行
  e: '79300000-0000-4000-8000-000000000005', // 状態の変更どうし
  f: '79300000-0000-4000-8000-000000000006', // 同じ Draft の同時保存（保持した取扱終了の明細）
};
const REQUEST = '79400000-0000-4000-8000-000000000001';
const DRAFT = '79500000-0000-4000-8000-000000000001';
const QUOTE_REQUEST = '79400000-0000-4000-8000-000000000002';
const QUOTE = '79600000-0000-4000-8000-000000000001';

const SAVE = `
  select x.id, x.lock_version from public.save_configuration_atomic(
    p_configuration_id => $1, p_base_model_id => '${MODEL}', p_name => '同時実行の検査', p_option_ids => $2::uuid[],
    p_preview_image_url => null, p_notes => null, p_finish_level => 'shell', p_variant_choice_ids => '{}'::uuid[],
    p_spec_code => 'base', p_exterior_faces => '[]'::jsonb, p_site_prefecture => null, p_site_municipality => null,
    p_site_location_undecided => false, p_expected_lock_version => $3) x`;
const QUOTE_FROM_CFG = `
  select x.id from public.create_quote_from_configuration(
    p_configuration_id => $1, p_contact => '{"full_name": "同時実行"}'::jsonb, p_message => null, p_expected_lock_version => $2) as x(id)`;
const SAVE_DRAFT = `select public.save_quote_draft($1, $2, null, $3::jsonb, 0, null, null, null) as lock_version`;
// 画面の状態変更（Server Action）と同じ形：読んだ版（updated_at）と一致する行だけを更新し、更新件数で成否を決める
const RETIRE = `update public.options set archived_at = now() where id = $1 and updated_at = $2 returning id`;
const RESUME = `update public.options set archived_at = null where id = $1 and updated_at = $2 returning id`;
const HIDE = `update public.options set simulator_visible = false where id = $1 and updated_at = $2 returning id`;

async function beginAs(client, sub) {
  await client.query('begin');
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
  await client.query('set local role authenticated');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (promise) => {
  const state = { settled: false };
  const wrapped = promise.then(
    (r) => ({ ok: true, rows: r.rows, rowCount: r.rowCount }),
    (e) => ({ ok: false, error: `${e.code}: ${e.message}` })
  ).finally(() => { state.settled = true; });
  return { state, wrapped };
};

/**
 * @param {import('pg').ClientConfig} config スーパーユーザーで接続できる設定（使い捨て DB）
 */
export async function runtimeLifecycleConcurrency(config) {
  const results = [];
  const check = (step, expected, actual) => results.push({ step, expected, actual: String(actual), ok: String(actual) === String(expected) });

  const host = config.host ?? (config.connectionString ? new URL(config.connectionString).hostname : '');
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    return { ok: false, skipped: true, results, error: `接続先（${host || '不明'}）がローカルの使い捨て DB ではないため、同時実行の検査は実行しません` };
  }
  const admin = new pg.Client(config);
  const a = new pg.Client(config);
  const b = new pg.Client(config);
  await admin.connect();
  const ready = (await admin.query(`select
      (select count(*) from public.options where code not like 'runtime-%') as options,
      to_regprocedure('public.product_lifecycle_capability()') is not null as has_guards`)).rows[0];
  if (!ready.has_guards) {
    await admin.end();
    return { ok: true, skipped: true, results, note: '20261015113000 が無いため対象外' };
  }
  if (Number(ready.options) > 0) {
    await admin.end();
    return { ok: true, skipped: true, results, note: '商品マスターが空ではないため省略（空の DB で実行する検査）' };
  }

  const ids = Object.values(OPT);
  const cleanup = async () => {
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`delete from public.quote_items where quote_id in (select id from public.quotes where quote_request_id in (select id from public.quote_requests where user_id = $1 or id = $2)) or quote_id = $3`, [CUST, QUOTE_REQUEST, QUOTE]);
    await admin.query(`delete from public.quotes where quote_request_id in (select id from public.quote_requests where user_id = $1) or id = $2`, [CUST, QUOTE]);
    await admin.query(`delete from public.quote_draft_items where draft_id = $1`, [DRAFT]);
    await admin.query(`delete from public.quote_drafts where id = $1`, [DRAFT]);
    await admin.query(`delete from public.quote_requests where user_id = $1 or id in ($2, $3)`, [CUST, REQUEST, QUOTE_REQUEST]);
    await admin.query(`delete from public.configuration_snapshots where configuration_id in (select id from public.configurations where user_id = $1)`, [CUST]);
    await admin.query(`delete from public.configuration_items where configuration_id in (select id from public.configurations where user_id = $1)`, [CUST]);
    await admin.query(`delete from public.configurations where user_id = $1`, [CUST]);
    await admin.query(`delete from public.options where id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from public.option_categories where id = $1`, [CATEGORY]);
    await admin.query(`delete from public.base_models where id = $1`, [MODEL]);
    await admin.query(`delete from public.profiles where id in ($1, $2)`, [ADMIN, CUST]);
    await admin.query(`delete from auth.users where id in ($1, $2)`, [ADMIN, CUST]);
    await admin.query('commit');
  };
  // 画面と同じく、読んだ版は DB の文字列のまま渡す（JS の Date にするとマイクロ秒が落ちて一致しない）
  const version = async (id) => (await admin.query('select updated_at::text as v from public.options where id = $1', [id])).rows[0].v;
  const state = async (id) =>
    (await admin.query('select public.product_lifecycle_state(status, archived_at) || \'/\' || simulator_visible::text as s from public.options where id = $1', [id])).rows[0].s;
  const resetOption = async (id) => {
    await admin.query('update public.options set archived_at = null where id = $1 and archived_at is not null', [id]);
  };

  try {
    await cleanup();
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    await admin.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'plc-admin@runtime.invalid', '{}'), ($2, 'plc-cust@runtime.invalid', '{}')`, [ADMIN, CUST]);
    await admin.query(`insert into public.profiles (id, email, full_name, role_code) values ($1, 'plc-admin@runtime.invalid', '本部', 'admin'), ($2, 'plc-cust@runtime.invalid', 'お客様', 'customer')`, [ADMIN, CUST]);
    await admin.query(`insert into public.base_models (id, slug, name, base_price, status) values ($1, 'runtime-plc-model', '同時実行検査用モデル', 1000000, 'published')`, [MODEL]);
    await admin.query(`insert into public.option_categories (id, code, name, selection_mode, is_required, finish_level, status) values ($1, 'runtime-plc-items', '同時実行検査の商品', 'multi', false, 'shell', 'published')`, [CATEGORY]);
    let n = 0;
    for (const [key, id] of Object.entries(OPT)) {
      n += 1;
      await admin.query(
        `insert into public.options (id, base_model_id, category_id, code, name, price, status, product_no) values ($1, $2, $3, $4, $5, 1000, 'published', $6)`,
        [id, MODEL, CATEGORY, `runtime-plc-${key}`, `同時実行の商品${key.toUpperCase()}`, `PRD-99000${n}`]
      );
    }
    await admin.query(`insert into public.quote_requests (id, status, contact) values ($1, 'new', '{}'::jsonb), ($2, 'new', '{}'::jsonb)`, [REQUEST, QUOTE_REQUEST]);
    await admin.query(
      `insert into public.quote_drafts (id, quote_request_id, base_model_id, spec_code, quote_kind, tax_rate, lock_version, source_kind, finish_level, created_at)
       values ($1, $2, $3, 'base', 'formal', 0.10, 0, 'manual', 'full', now() - interval '1 day')`,
      [DRAFT, REQUEST, MODEL]
    );
    await admin.query(
      `insert into public.quotes (id, quote_no, quote_request_id, valid_until, customer_name, base_model_name, base_price, option_subtotal,
                                  installation_subtotal, subtotal, tax_rate, tax, total, status, quote_kind, base_model_id, spec_code)
       values ($1, 'RT-PLC-Q1', $2, now() + interval '30 days', '検査', '同時実行検査用モデル', 0, 0, 0, 0, 0.10, 0, 0, 'issued', 'formal', $3, 'base')`,
      [QUOTE, QUOTE_REQUEST, MODEL]
    );
    await admin.query('commit');
    await a.connect();
    await b.connect();

    // ---------- 1. 取扱終了 対 構成の保存 ----------
    // 1-A：取扱終了が先（未 commit）→ 保存は待たされ、確定後に拒否される
    await a.query('begin');
    await a.query(RETIRE, [OPT.a, await version(OPT.a)]);
    await beginAs(b, CUST);
    let race = settle(b.query(SAVE, [null, [OPT.a], null]));
    await sleep(400);
    check('PLC-1 取扱終了が先：構成の保存は、取扱終了の確定まで待たされる', 'true', !race.state.settled);
    await a.query('commit');
    let r = await race.wrapped;
    await b.query(r.ok ? 'commit' : 'rollback');
    check('PLC-2 取扱終了が先：確定後、構成の保存は「新しく選べない」で拒否される', 'true', !r.ok && /RETIRED/.test(r.error ?? ''));
    // 1-B：保存が先（未 commit）→ 取扱終了は待たされ、保存の確定後に成功する
    await resetOption(OPT.a);
    await beginAs(b, CUST);
    const saved = await b.query(SAVE, [null, [OPT.a], null]);
    await a.query('begin');
    race = settle(a.query(RETIRE, [OPT.a, await version(OPT.a)]));
    await sleep(400);
    check('PLC-3 保存が先：取扱終了は、保存の確定まで待たされる', 'true', !race.state.settled);
    await b.query('commit');
    r = await race.wrapped;
    await a.query(r.ok ? 'commit' : 'rollback');
    check('PLC-4 保存が先：保存は確定し、取扱終了も成功する（保存済みの明細として残る）', 'true/1/retired/true',
      `${r.ok}/${r.rowCount ?? 0}/${(await state(OPT.a)).split('/')[0]}/${(await admin.query('select count(*)::int as n from public.configuration_items where configuration_id = $1 and option_id = $2', [saved.rows[0].id, OPT.a])).rows[0].n === 1}`);

    // ---------- 2. 取扱終了 対 見積依頼 ----------
    await beginAs(b, CUST);
    const cfg = (await b.query(SAVE, [null, [OPT.b], null])).rows[0];
    await b.query('commit');
    // 2-A：取扱終了が先 → 見積依頼は待たされ、確定後に拒否される（見積は作られない）
    await a.query('begin');
    await a.query(RETIRE, [OPT.b, await version(OPT.b)]);
    await beginAs(b, CUST);
    race = settle(b.query(QUOTE_FROM_CFG, [cfg.id, cfg.lock_version]));
    await sleep(400);
    check('PLC-5 取扱終了が先：見積依頼は、取扱終了の確定まで待たされる', 'true', !race.state.settled);
    await a.query('commit');
    r = await race.wrapped;
    await b.query(r.ok ? 'commit' : 'rollback');
    check('PLC-6 取扱終了が先：確定後、見積依頼は拒否され、見積は作られない', 'true/0',
      `${!r.ok && /RETIRED/.test(r.error ?? '')}/${(await admin.query('select count(*)::int as n from public.quotes where configuration_id = $1', [cfg.id])).rows[0].n}`);
    // 2-B：見積依頼が先 → 取扱終了は待たされ、見積依頼の確定後に成功する
    await resetOption(OPT.b);
    await beginAs(b, CUST);
    await b.query(QUOTE_FROM_CFG, [cfg.id, cfg.lock_version]);
    await a.query('begin');
    race = settle(a.query(RETIRE, [OPT.b, await version(OPT.b)]));
    await sleep(400);
    check('PLC-7 見積依頼が先：取扱終了は、見積依頼の確定まで待たされる', 'true', !race.state.settled);
    await b.query('commit');
    r = await race.wrapped;
    await a.query(r.ok ? 'commit' : 'rollback');
    check('PLC-8 見積依頼が先：見積は作られ、その後に取扱終了も成功する（発行済みの見積は変えない）', 'true/1',
      `${r.ok && r.rowCount === 1}/${(await admin.query('select count(*)::int as n from public.quotes where configuration_id = $1', [cfg.id])).rows[0].n}`);

    // ---------- 3. 取扱終了 対 見積 Draft の保存 ----------
    const draftItems = (option, qty = 1, key = null) =>
      JSON.stringify([{ kind: 'option', name: '同時実行の商品', option_id: option, quantity: qty, unit_price: 1000, ...(key ? { line_key: key } : {}) }]);
    // 3-A：取扱終了が先 → Draft の保存は待たされ、確定後に拒否される
    await a.query('begin');
    await a.query(RETIRE, [OPT.c, await version(OPT.c)]);
    await beginAs(b, ADMIN);
    race = settle(b.query(SAVE_DRAFT, [DRAFT, 0, draftItems(OPT.c)]));
    await sleep(400);
    check('PLC-9 取扱終了が先：見積 Draft の保存は、取扱終了の確定まで待たされる', 'true', !race.state.settled);
    await a.query('commit');
    r = await race.wrapped;
    await b.query(r.ok ? 'commit' : 'rollback');
    check('PLC-10 取扱終了が先：確定後、見積 Draft の保存は拒否される（古い画面からの新しい選択）', 'true', !r.ok && /RETIRED/.test(r.error ?? ''));
    // 3-B：Draft の保存が先 → 取扱終了は待たされ、保存の確定後に成功する
    await resetOption(OPT.c);
    await beginAs(b, ADMIN);
    await b.query(SAVE_DRAFT, [DRAFT, 0, draftItems(OPT.c)]);
    await a.query('begin');
    race = settle(a.query(RETIRE, [OPT.c, await version(OPT.c)]));
    await sleep(400);
    check('PLC-11 Draft の保存が先：取扱終了は、保存の確定まで待たされる', 'true', !race.state.settled);
    await b.query('commit');
    r = await race.wrapped;
    await a.query(r.ok ? 'commit' : 'rollback');
    check('PLC-12 Draft の保存が先：保存は確定し、取扱終了も成功する', 'true/1',
      `${r.ok && r.rowCount === 1}/${(await admin.query('select count(*)::int as n from public.quote_draft_items where draft_id = $1 and option_id = $2', [DRAFT, OPT.c])).rows[0].n}`);

    // ---------- 4. 取扱終了 対 見積の発行（すべての発行の RPC が通る、見積の明細の追加） ----------
    const ISSUE = `insert into public.quote_items (quote_id, kind, name, unit_price, quantity, amount, sort_order, option_id) values ($1, 'option', '発行', 1000, 1, 1000, 1, $2) returning id`;
    await a.query('begin');
    await a.query(RETIRE, [OPT.d, await version(OPT.d)]);
    await b.query('begin');
    race = settle(b.query(ISSUE, [QUOTE, OPT.d]));
    await sleep(400);
    check('PLC-13 取扱終了が先：見積の発行は、取扱終了の確定まで待たされる', 'true', !race.state.settled);
    await a.query('commit');
    r = await race.wrapped;
    await b.query(r.ok ? 'commit' : 'rollback');
    check('PLC-14 取扱終了が先：確定後、取扱終了の商品を含む発行は拒否される', 'true', !r.ok && /RETIRED/.test(r.error ?? ''));
    await resetOption(OPT.d);
    await b.query('begin');
    await b.query(ISSUE, [QUOTE, OPT.d]);
    await a.query('begin');
    race = settle(a.query(RETIRE, [OPT.d, await version(OPT.d)]));
    await sleep(400);
    check('PLC-15 発行が先：取扱終了は、発行の確定まで待たされる', 'true', !race.state.settled);
    await b.query('commit');
    r = await race.wrapped;
    await a.query(r.ok ? 'commit' : 'rollback');
    check('PLC-16 発行が先：発行は確定し、その後に取扱終了も成功する（発行済みの明細は変えない）', 'true/1',
      `${r.ok && r.rowCount === 1}/${(await admin.query('select count(*)::int as n from public.quote_items where quote_id = $1 and option_id = $2', [QUOTE, OPT.d])).rows[0].n}`);

    // ---------- 5. 状態の変更どうし（取扱終了・再開・シミュレーター表示） ----------
    // 5-A：取扱終了が先 → 同じ版を読んだシミュレーター表示の変更は待たされ、確定後は 0 件（古い画面）として失敗する
    let seen = await version(OPT.e);
    await a.query('begin');
    await a.query(RETIRE, [OPT.e, seen]);
    await b.query('begin');
    race = settle(b.query(HIDE, [OPT.e, seen]));
    await sleep(400);
    check('PLC-17 取扱終了が先：同じ版を読んだシミュレーター表示の変更は待たされる', 'true', !race.state.settled);
    await a.query('commit');
    r = await race.wrapped;
    await b.query(r.ok ? 'commit' : 'rollback');
    check('PLC-18 取扱終了が先：確定後、古い版のシミュレーター表示の変更は 0 件で失敗する（成功扱いにしない）', 'true/0/retired/true',
      `${r.ok}/${r.rowCount ?? -1}/${await state(OPT.e)}`);
    // 5-B：再開が先 → 同じ（取扱終了中の）版を読んだ取扱終了・再開は 0 件
    seen = await version(OPT.e);
    await a.query('begin');
    await a.query(RESUME, [OPT.e, seen]);
    await b.query('begin');
    race = settle(b.query(RESUME, [OPT.e, seen]));
    await sleep(400);
    check('PLC-19 再開が先：同じ版を読んだ再開は待たされる', 'true', !race.state.settled);
    await a.query('commit');
    r = await race.wrapped;
    await b.query(r.ok ? 'commit' : 'rollback');
    check('PLC-20 再開が先：確定後、古い版の再開は 0 件で失敗する', 'true/0/registered/true', `${r.ok}/${r.rowCount ?? -1}/${await state(OPT.e)}`);
    // 5-C：シミュレーター表示の変更が先 → 同じ版を読んだ取扱終了は 0 件
    seen = await version(OPT.e);
    await a.query('begin');
    await a.query(HIDE, [OPT.e, seen]);
    await b.query('begin');
    race = settle(b.query(RETIRE, [OPT.e, seen]));
    await sleep(400);
    check('PLC-21 シミュレーター表示の変更が先：同じ版を読んだ取扱終了は待たされる', 'true', !race.state.settled);
    await a.query('commit');
    r = await race.wrapped;
    await b.query(r.ok ? 'commit' : 'rollback');
    check('PLC-22 シミュレーター表示の変更が先：確定後、古い版の取扱終了は 0 件で失敗する', 'true/0/registered/false', `${r.ok}/${r.rowCount ?? -1}/${await state(OPT.e)}`);
    // 5-D：取扱終了 → 再開 を挟んだ古い取扱終了（ABA）も、版が違うので 0 件
    const aba = await version(OPT.e);
    await admin.query(RETIRE, [OPT.e, aba]);
    await admin.query(RESUME, [OPT.e, await version(OPT.e)]);
    const stale = await admin.query(RETIRE, [OPT.e, aba]);
    check('PLC-23 取扱終了 → 再開を挟んだ古い画面の取扱終了は、版が違うので 0 件（ABA を検出する）', '0/registered/false', `${stale.rowCount}/${await state(OPT.e)}`);

    // ---------- 6. 同じ Draft の同時保存（保持した取扱終了の明細） ----------
    await beginAs(b, CUST);
    const keep = (await b.query(SAVE, [null, [OPT.f], null])).rows[0];
    await b.query('commit');
    await admin.query(RETIRE, [OPT.f, await version(OPT.f)]);
    await beginAs(a, CUST);
    await a.query(SAVE, [keep.id, [OPT.f], keep.lock_version]); // A は構成の行ロックを持ったまま未 commit
    await beginAs(b, CUST);
    race = settle(b.query(SAVE, [keep.id, [OPT.f], keep.lock_version]));
    await sleep(400);
    check('PLC-24 同じ Draft の同時保存：後から来た保存は、先の保存が終わるまで待たされる', 'true', !race.state.settled);
    await a.query('commit');
    r = await race.wrapped;
    await b.query(r.ok ? 'commit' : 'rollback');
    check('PLC-25 同じ Draft の同時保存：先の保存（保持した取扱終了の明細）は確定し、後から来た同じ版の保存は拒否される', 'true/1',
      `${!r.ok && /LOCKED/.test(r.error ?? '')}/${(await admin.query('select count(*)::int as n from public.configuration_items where configuration_id = $1 and option_id = $2', [keep.id, OPT.f])).rows[0].n}`);
  } catch (e) {
    results.push({ step: 'PLC-x 同時実行の検査を完了できませんでした', expected: '完了', actual: e.message, ok: false });
  } finally {
    await a.query('rollback').catch(() => {});
    await b.query('rollback').catch(() => {});
    await cleanup().catch((e) => results.push({ step: 'PLC-y 試験データの削除', expected: '削除', actual: e.message, ok: false }));
    await a.end().catch(() => {});
    await b.end().catch(() => {});
    await admin.end().catch(() => {});
  }
  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}
