/**
 * `supabase db lint`（plpgsql_check）の結果を判定する（CI 用）。
 *
 *   supabase db lint --local --schema public --level warning --fail-on none > db-lint.json
 *   node scripts/db-rehearsal/lint-gate.mjs db-lint.json
 *
 * level=error が 1 件でもあれば終了コード 1。ただし下の KNOWN に載せた既知の事象は除く。
 * KNOWN は「直さない理由が説明できるもの」だけにする。新しいエラーを黙らせるために足さないこと。
 *
 * Supabase CLI は workflow で 2.120.0 に固定しており、現在の db lint 出力は JSON 配列そのもの。
 * 前後に別テキストが混ざった場合や配列要素の構造が想定外の場合は、異常出力として fail closed にする。
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

const raw = fs.readFileSync(file, 'utf8').trim();
if (!raw.startsWith('[') || !raw.endsWith(']')) {
  console.error('plpgsql_check の lint 出力が期待する JSON 配列形式ではありません');
  process.exit(1);
}

let results;
try {
  results = JSON.parse(raw);
} catch (error) {
  console.error('plpgsql_check の JSON 配列を解析できませんでした');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
if (!Array.isArray(results)) {
  console.error('plpgsql_check の lint 結果が JSON 配列ではありません');
  process.exit(1);
}

const validResult = (result) =>
  result !== null &&
  typeof result === 'object' &&
  typeof result.function === 'string' &&
  Array.isArray(result.issues) &&
  result.issues.every(
    (issue) =>
      issue !== null &&
      typeof issue === 'object' &&
      typeof issue.level === 'string' &&
      typeof issue.message === 'string' &&
      typeof issue.sqlState === 'string',
  );

if (!results.every(validResult)) {
  console.error('plpgsql_check の lint 結果に想定外の要素構造があります');
  process.exit(1);
}

const isKnown = (fn, issue) => KNOWN.some((k) => k.function === fn && k.sqlState === issue.sqlState && issue.message === k.message);
const errors = [];
const known = [];
let warnings = 0;
for (const r of results) {
  for (const issue of r.issues) {
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
