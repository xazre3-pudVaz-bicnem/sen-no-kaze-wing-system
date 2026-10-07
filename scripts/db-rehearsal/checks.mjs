/**
 * マイグレーション適用後の DB に対する検査（リハーサル・CI 共通）。
 *
 *   1. public の全テーブルで RLS が有効
 *   2. 未ログイン（anon）が実行できる SECURITY DEFINER 関数は許可リストの範囲だけ
 *   3. SECURITY DEFINER 関数は search_path を固定している
 *   4. アプリの Supabase 呼び出し（RPC・テーブル・列）が DB と一致している
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractCheck } from './contract-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');

/**
 * anon から実行できてよい SECURITY DEFINER 関数。
 * RLS ポリシーの中で評価される判定関数と、読み取りだけの検証関数に限る。
 * ここへ足す前に「未ログインの第三者が API から直接呼んでも安全か」を確認すること。
 */
export const ANON_DEFINER_ALLOWLIST = ['can_edit_catalog', 'current_role_rank', 'is_admin', 'is_dealer', 'validate_configuration_items'];

const isTriggerFn = (f) => f.ret === 'trigger' || f.ret === 'event_trigger';

export async function inspect(client) {
  const sql = fs.readFileSync(path.join(HERE, 'inspect.sql'), 'utf8');
  return (await client.query(sql)).rows[0].j;
}

export function evaluate(schema, repo = REPO) {
  const failures = [];
  const callable = schema.signatures.filter((f) => !isTriggerFn(f));

  const noRls = schema.tables.filter((t) => !t.rls).map((t) => t.t);
  if (noRls.length) failures.push({ check: 'rls', message: `RLS が無効のテーブル: ${noRls.join(', ')}` });

  const anonDefiner = callable.filter((f) => f.secdef && f.anon && !ANON_DEFINER_ALLOWLIST.includes(f.name));
  if (anonDefiner.length) {
    failures.push({
      check: 'anon-execute',
      message: `anon が実行できる SECURITY DEFINER 関数（許可リスト外）: ${anonDefiner.map((f) => `${f.name}(${f.types})`).join(' / ')}`,
      hint: 'Supabase は public の関数へ anon / authenticated の EXECUTE を既定で付与する。`revoke ... from public` では外れないので `from public, anon, authenticated, service_role` と明示してから必要なロールへ grant する。',
    });
  }

  const noSearchPath = callable.filter((f) => f.secdef && !(f.config ?? []).some((c) => c.startsWith('search_path=')));
  if (noSearchPath.length) failures.push({ check: 'search-path', message: `search_path を固定していない SECURITY DEFINER 関数: ${noSearchPath.map((f) => f.name).join(', ')}` });

  const contract = contractCheck(repo, schema);
  if (contract.issues.length) {
    failures.push({
      check: 'contract',
      message: `アプリと DB の不整合 ${contract.issues.length} 件（無い RPC ${contract.missingRpc.length}／無いテーブル ${contract.missingTables.length}／無い列 ${contract.missingColumns.length}／引数不一致 ${contract.argMismatches.length}）`,
      details: contract.issues.map((i) => `${i.where}  ${i.detail}`),
    });
  }

  return {
    ok: failures.length === 0,
    failures,
    summary: {
      tables: schema.tables.length,
      functions: callable.length,
      definer: callable.filter((f) => f.secdef).length,
      anonExecutable: callable.filter((f) => f.anon).map((f) => f.name),
      rlsWithoutPolicy: schema.tables.filter((t) => t.rls && Number(t.policies) === 0).map((t) => t.t),
      contract: { ...contract.stats, missingRpc: contract.missingRpc, missingTables: contract.missingTables, missingColumns: contract.missingColumns },
    },
  };
}

export function printResult(result, log = console.log) {
  const s = result.summary;
  log(`テーブル ${s.tables}（RLS 有効・ポリシー 0 件: ${s.rlsWithoutPolicy.join(', ') || 'なし'}）`);
  log(`関数 ${s.functions}（SECURITY DEFINER ${s.definer}／anon 実行可: ${[...new Set(s.anonExecutable)].join(', ') || 'なし'}）`);
  log(`アプリ突き合わせ: rpc ${s.contract.rpc}・from ${s.contract.from}・select ${s.contract.select}（動的で未検査 ${s.contract.dynamic}）`);
  if (result.ok) {
    log('検査: すべて通過');
    return;
  }
  for (const f of result.failures) {
    log(`✗ [${f.check}] ${f.message}`);
    if (f.hint) log(`    ${f.hint}`);
    for (const d of f.details ?? []) log(`    ${d}`);
  }
}
