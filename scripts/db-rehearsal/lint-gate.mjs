/**
 * `supabase db lint`（plpgsql_check）の結果を判定する（CI 用）。
 *
 *   supabase db lint --local --schema public --level warning --fail-on none > db-lint.json
 *   node scripts/db-rehearsal/lint-gate.mjs db-lint.json
 *
 * level=error が 1 件でもあれば終了コード 1。ただし下の KNOWN に載せた既知の事象は除く。
 * KNOWN は「直さない理由が説明できるもの」だけにする。新しいエラーを黙らせるために足さないこと。
 */
import fs from 'node:fs';

const KNOWN = [
  {
    // 0002 の旧 6 引数 save_configuration。validate_configuration_items の 2 引数版と
    // 既定値つき 3 引数版が並んだ時点で呼び分けできなくなった。保存は save_configuration_atomic へ移行済みで、
    // 旧オーバーロードは 20260928100000 で全 API ロールから EXECUTE を外してあり、到達しない。
    function: 'public.save_configuration',
    sqlState: '42725',
    message: 'function public.validate_configuration_items(uuid, uuid[]) is not unique',
  },
];

const file = process.argv[2];
if (!file) {
  console.error('lint 結果の JSON ファイルを指定してください');
  process.exit(1);
}
const raw = fs.readFileSync(file, 'utf8');
// CLI は JSON の前後に案内文を出すことがあるので、配列部分だけを取り出す
const start = raw.indexOf('[');
const results = start < 0 ? [] : JSON.parse(raw.slice(start, raw.lastIndexOf(']') + 1));

const isKnown = (fn, issue) => KNOWN.some((k) => k.function === fn && k.sqlState === issue.sqlState && issue.message === k.message);
const errors = [];
const known = [];
let warnings = 0;
for (const r of results) {
  for (const issue of r.issues ?? []) {
    if (issue.level !== 'error') {
      warnings++;
      continue;
    }
    (isKnown(r.function, issue) ? known : errors).push({ fn: r.function, issue });
  }
}

console.log(`plpgsql_check: エラー ${errors.length} 件／既知 ${known.length} 件／警告 ${warnings} 件`);
for (const { fn, issue } of errors) {
  console.log(`✗ ${fn}: ${issue.message}${issue.query?.text ? `\n    ${issue.query.text.replace(/\s+/g, ' ').slice(0, 200)}` : ''}${issue.hint ? `\n    hint: ${issue.hint}` : ''}`);
}
const unused = KNOWN.filter((k) => !known.some((x) => x.fn === k.function && x.issue.sqlState === k.sqlState));
for (const k of unused) console.log(`（既知リストの ${k.function} は検出されませんでした。解消済みなら KNOWN から外してください）`);
process.exit(errors.length ? 1 : 0);
