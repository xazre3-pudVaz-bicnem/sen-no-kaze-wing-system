/**
 * マイグレーションのローカル実 DB リハーサル（docker 不要）。
 *
 *   npm run db:rehearse -- [--label <name>] [--extra <dir>]... [--seed <json>] [--prod-catalog <json>]
 *                          [--applied-through <version>] [--baseline-only] [--runtime] [--keep]
 *
 * 1. PostgreSQL 17 を一時ディレクトリに初期化して起動（embedded-postgres）
 * 2. bootstrap.sql で本番 Supabase と同じロール／既定権限／auth・storage の前提を作る
 * 3. supabase/migrations を postgres ロールで 1 本ずつ適用（Supabase CLI の db push と同じ単位）
 *    --applied-through を指定すると、そこまでを「本番適用済み」、以降を「未適用」として区切り、
 *    区切りの時点で --prod-catalog（本番で catalog.sql を実行した結果）との差分と --seed の投入を行う
 * 4. 適用後の DB を checks.mjs で検査（RLS・EXECUTE 権限・アプリとの突き合わせ）
 *    --runtime を付けると、権限境界の実行時検査（runtime-security.sql）も行う
 *
 * 結果は .wing-local/db-rehearsal/<label>/ に出力する。失敗があれば終了コード 1。
 *
 * embedded-postgres は本体の依存に入れていない（プラットフォーム別バイナリが大きいため）。初回だけ:
 *   npm i --no-save embedded-postgres@17.6.0-beta.15
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { REPO, evaluate, inspect, mergeRuntime, printResult, printRuntime, runtimeSecurity } from './checks.mjs';
import { runtimeConcurrency } from './runtime-concurrency.mjs';

const HERE = path.join(REPO, 'scripts', 'db-rehearsal');
const PORT = Number(process.env.REHEARSAL_PG_PORT ?? 54329);

const opt = { label: 'latest', extra: [], seed: null, prodCatalog: null, appliedThrough: null, baselineOnly: false, runtime: false, keep: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--label') opt.label = argv[++i];
  else if (a === '--extra') opt.extra.push(path.resolve(argv[++i]));
  else if (a === '--seed') opt.seed = path.resolve(argv[++i]);
  else if (a === '--prod-catalog') opt.prodCatalog = path.resolve(argv[++i]);
  else if (a === '--applied-through') opt.appliedThrough = argv[++i];
  else if (a === '--baseline-only') opt.baselineOnly = true;
  else if (a === '--runtime') opt.runtime = true;
  else if (a === '--keep') opt.keep = true;
  else throw new Error(`不明な引数: ${a}`);
}

let EmbeddedPostgres;
try {
  ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
} catch {
  console.error('embedded-postgres が見つかりません。次を実行してから再度お試しください:\n  npm i --no-save embedded-postgres@17.6.0-beta.15');
  process.exit(1);
}

const OUT = path.join(REPO, '.wing-local', 'db-rehearsal', opt.label);
const DATA = path.join(REPO, '.wing-local', 'db-rehearsal', '.pgdata');
fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(...a);
const writeJson = (name, value) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 1));
/** git の正本は LF。作業ツリーが CRLF でも同じ内容で適用する */
const readSql = (file) => fs.readFileSync(file, 'utf8').split('\r').join('');

function listMigrations() {
  const files = new Map();
  for (const dir of [path.join(REPO, 'supabase', 'migrations'), ...opt.extra]) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) files.set(f, path.join(dir, f));
  }
  return [...files.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([file, full]) => ({ file, full, version: file.split('_')[0], name: file.replace(/\.sql$/, '').split('_').slice(1).join('_') }));
}

/** 本番カタログとマイグレーション再現の差分。関数本体は改行コードを除いて比較する */
function diffCatalog(prod, local) {
  const out = [];
  const cmp = (kind, pRows, lRows, keyFn, fields) => {
    const p = new Map((pRows ?? []).map((r) => [keyFn(r), r]));
    const l = new Map((lRows ?? []).map((r) => [keyFn(r), r]));
    for (const k of p.keys()) if (!l.has(k)) out.push({ kind, key: k, diff: '本番にあり、マイグレーションには無い' });
    for (const k of l.keys()) if (!p.has(k)) out.push({ kind, key: k, diff: 'マイグレーションにあり、本番には無い' });
    for (const [k, pv] of p) {
      const lv = l.get(k);
      if (!lv) continue;
      for (const f of fields) {
        if (JSON.stringify(pv[f] ?? null) !== JSON.stringify(lv[f] ?? null)) out.push({ kind, key: k, field: f, prod: pv[f] ?? null, local: lv[f] ?? null });
      }
    }
  };
  // rls_auto_enable は Supabase 側が作成した関数（リポジトリのマイグレーション外）
  const fn = (rows) => (rows ?? []).filter((r) => r.f !== 'rls_auto_enable()').map((r) => ({ ...r, src: r.src.split('\r').join('') }));
  cmp('table', prod.tables, local.tables, (r) => r.t, ['kind', 'owner', 'rls', 'force', 'acl']);
  cmp('column', prod.columns, local.columns, (r) => `${r.t}.${r.c}`, ['type', 'notnull', 'default', 'gen', 'ident']);
  cmp('constraint', prod.constraints, local.constraints, (r) => `${r.t}:${r.name}`, ['type', 'def']);
  cmp('index', prod.indexes, local.indexes, (r) => r.name, ['def']);
  cmp('function', fn(prod.functions), fn(local.functions), (r) => r.f, ['kind', 'ret', 'lang', 'secdef', 'vol', 'config', 'owner', 'acl', 'src']);
  cmp('policy', prod.policies, local.policies, (r) => `${r.t}:${r.name}`, ['permissive', 'cmd', 'roles', 'qual', 'check']);
  cmp('trigger', prod.triggers, local.triggers, (r) => `${r.t}:${r.name}`, ['enabled', 'def']);
  cmp('bucket', prod.buckets, local.buckets, (r) => r.id, ['public', 'limit', 'mime']);
  return out;
}

const server = new EmbeddedPostgres({
  databaseDir: DATA,
  user: 'supabase_admin',
  password: 'supabase_admin',
  port: PORT,
  persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=icu', '--icu-locale=en-US'],
  postgresFlags: ['-c', 'timezone=UTC', '-c', 'listen_addresses=127.0.0.1'],
  onLog: () => {},
  onError: (e) => fs.appendFileSync(path.join(OUT, 'server.log'), `${String(e)}\n`),
});

async function connect(user, password) {
  const client = new pg.Client({ host: '127.0.0.1', port: PORT, user, password, database: 'postgres' });
  await client.connect();
  return client;
}

const report = { label: opt.label, startedAt: new Date().toISOString(), migrations: [] };
let failed = false;

try {
  await server.initialise();
  await server.start();
  const admin = await connect('supabase_admin', 'supabase_admin');
  report.server = (await admin.query('select version() as v')).rows[0].v;
  log(report.server);
  await admin.query(readSql(path.join(HERE, 'bootstrap.sql')));

  const all = listMigrations();
  const baseline = opt.appliedThrough ? all.filter((m) => m.version <= opt.appliedThrough) : [];
  const pending = all.filter((m) => !baseline.includes(m));
  log(`migrations: ${opt.appliedThrough ? `適用済み ${baseline.length}／未適用 ${pending.length}` : `${all.length} 本`}`);

  // Supabase CLI と同じく postgres ロール（スーパーユーザーではない）で適用する
  const migrator = await connect('postgres', 'postgres');
  async function apply(m, phase) {
    const sql = readSql(m.full);
    const started = Date.now();
    const rec = { phase, file: m.file, ok: true };
    try {
      await migrator.query(sql);
      await migrator.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)', [m.version, m.name]);
    } catch (e) {
      rec.ok = false;
      rec.error = { code: e.code, message: e.message, detail: e.detail, hint: e.hint, where: e.where, line: e.position ? sql.slice(0, Number(e.position)).split('\n').length : undefined };
      await migrator.query('rollback').catch(() => {});
    }
    rec.ms = Date.now() - started;
    report.migrations.push(rec);
    log(`${rec.ok ? 'ok  ' : 'FAIL'} ${m.file} (${rec.ms}ms)${rec.ok ? '' : `\n     → ${rec.error.code}: ${rec.error.message}${rec.error.line ? `（${rec.error.line} 行目付近）` : ''}`}`);
    return rec.ok;
  }

  let ok = true;
  for (const m of baseline) {
    ok = await apply(m, 'applied');
    if (!ok) break;
  }

  if (ok && baseline.length) {
    const catalog = (await admin.query(readSql(path.join(HERE, 'catalog.sql')))).rows[0].j;
    writeJson('catalog-applied.json', catalog);
    if (opt.prodCatalog) {
      const drift = diffCatalog(JSON.parse(fs.readFileSync(opt.prodCatalog, 'utf8')), catalog);
      writeJson('drift.json', drift);
      report.drift = drift.length;
      log(`本番カタログとの差分: ${drift.length} 件${drift.length ? '（drift.json を確認）' : ''}`);
      if (drift.length) failed = true;
    }
  }

  if (ok && opt.seed) {
    // マスターデータの投入（トリガーと外部キー検査を止めて、ID をそのまま入れる）
    const seed = JSON.parse(fs.readFileSync(opt.seed, 'utf8'));
    await admin.query('set session_replication_role = replica');
    report.seed = {};
    for (const [table, rows] of Object.entries(seed.tables)) {
      if (!rows.length) continue;
      const cols = (await admin.query("select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped and attgenerated = ''", [`public.${table}`])).rows.map((r) => r.attname);
      const list = cols.filter((c) => rows.some((r) => Object.hasOwn(r, c))).map((c) => `"${c}"`).join(', ');
      await admin.query(`delete from public."${table}"`);
      const r = await admin.query(`insert into public."${table}" (${list}) select ${list} from jsonb_populate_recordset(null::public."${table}", $1::jsonb)`, [JSON.stringify(rows)]);
      report.seed[table] = r.rowCount;
    }
    await admin.query('set session_replication_role = origin');
    log(`seed: ${JSON.stringify(report.seed)}`);
  }

  if (ok && !opt.baselineOnly) {
    for (const m of pending) {
      ok = await apply(m, 'pending');
      if (!ok) break;
    }
  }
  if (!ok) failed = true;
  report.applied = report.migrations.filter((m) => m.ok).length;
  report.total = all.length;

  if (ok) {
    const schema = await inspect(admin);
    writeJson('schema.json', schema);
    const result = evaluate(schema);
    report.checks = result;
    printResult(result, log);
    // 途中までの状態（--baseline-only）では、アプリとの不整合があるのが前提なので失敗扱いにしない
    if (!result.ok && !opt.baselineOnly) failed = true;

    if (opt.runtime && !opt.baselineOnly) {
      const runtime = mergeRuntime(
        await runtimeSecurity(admin),
        await runtimeConcurrency({ host: '127.0.0.1', port: PORT, user: 'supabase_admin', password: 'supabase_admin', database: 'postgres' })
      );
      report.runtime = runtime;
      printRuntime(runtime, log);
      if (!runtime.ok) failed = true;
    }
  }

  if (opt.keep) {
    log(`--keep: 127.0.0.1:${PORT} で起動したままです（supabase_admin / supabase_admin）。停止するには ${path.join(OUT, 'STOP')} を作成してください。`);
    while (!fs.existsSync(path.join(OUT, 'STOP'))) await new Promise((r) => setTimeout(r, 1000));
  }
  await migrator.end();
  await admin.end();
} catch (e) {
  report.fatal = e.message;
  console.error('FATAL', e.message);
  failed = true;
} finally {
  await server.stop().catch(() => {});
  fs.rmSync(DATA, { recursive: true, force: true });
}

report.finishedAt = new Date().toISOString();
writeJson('report.json', report);
log(`${failed ? '失敗' : '成功'}: ${report.applied ?? 0}/${report.total ?? '?'} 本を適用。結果: ${path.relative(REPO, OUT)}`);
process.exit(failed ? 1 : 0);
