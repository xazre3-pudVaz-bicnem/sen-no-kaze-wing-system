import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migrationsDir = path.join(root, 'supabase/migrations');
const corrective = read('supabase/migrations/20261009090000_assignment_and_legacy_kind_fail_closed_corrective.sql');
const runtime = read('scripts/db-rehearsal/runtime-security.sql');

/** corrective の置き換え表（署名・置き換え前・置き換え後）を SQL から読み取る */
function patchTable() {
  const rows = [
    ...corrective.matchAll(/\((\d+),\s*\n\s*'([^']+)',\s*\n\s*'((?:[^']|'')+)',\s*\n\s*'((?:[^']|'')+)'\)/g),
  ];
  return rows.map((row) => ({
    seq: Number(row[1]),
    signature: row[2],
    oldText: row[3].split("''").join("'"),
    newText: row[4].split("''").join("'"),
  }));
}

/** その関数を最後に定義している migration から、関数定義の本文を取り出す */
function latestDefinition(functionName: string): { file: string; body: string } {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql') && file < '20261009090000')
    .sort();
  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const sql = read(path.join('supabase/migrations', file));
    const start = sql.lastIndexOf(`create or replace function public.${functionName}(`);
    if (start < 0) continue;
    const opener = sql.slice(start).match(/\bas (\$[a-z_]*\$)/);
    if (!opener) continue;
    const bodyStart = start + (opener.index ?? 0) + opener[0].length;
    const bodyEnd = sql.indexOf(`${opener[1]};`, bodyStart);
    found = { file, body: sql.slice(start, bodyEnd) };
  }
  expect(found, `${functionName} definition`).not.toBeNull();
  return found as { file: string; body: string };
}

describe('NULL で判定が素通りする条件を fail closed にする corrective', () => {
  const patches = patchTable();

  it('担当判定 4 箇所と旧形式の種別判定 1 箇所を、coalesce(..., false) で包むだけの置き換えにしている', () => {
    expect(patches.map((patch) => `${patch.seq}:${patch.signature}`)).toEqual([
      '1:public.create_quote_revision(uuid, jsonb, text)',
      '2:public.get_case_plan_configuration(uuid)',
      '3:public.get_legacy_accepted_formalization_state(uuid)',
      '4:public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)',
      '5:public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)',
    ]);
    for (const patch of patches) {
      const comparison = patch.oldText.match(/([a-z_]+\.(?:dealer_id = v_uid|quote_kind = 'preliminary'))/);
      expect(comparison, patch.oldText).not.toBeNull();
      // 置き換え後は、同じ比較を coalesce(..., false) で包んだものと一致する（それ以外は変えない）
      expect(patch.newText).toBe(patch.oldText.replace(comparison![1], `coalesce(${comparison![1]}, false)`));
      // 1 行の中だけで完結している（改行コードの違いに左右されない）
      expect(patch.oldText).not.toContain('\n');
    }
  });

  it('置き換え対象の行は、各関数の最新定義にちょうど 1 箇所ずつ存在する（適用時の前提条件が成立する）', () => {
    for (const patch of patches) {
      const name = patch.signature.replace(/^public\./, '').replace(/\(.*$/, '');
      const { file, body } = latestDefinition(name);
      expect(body.split(patch.oldText).length - 1, `${name} in ${file}`).toBe(1);
      expect(body, `${name} in ${file}`).not.toContain(patch.newText);
    }
  });

  it('想定と違う定義には何も変更せず停止し、owner・SECURITY DEFINER・search_path・EXECUTE が変わらないことを検算する', () => {
    expect(corrective).toContain('pg_catalog.pg_get_functiondef(v_oid)');
    expect(corrective).toContain('if v_occurrences <> 1 then');
    expect(corrective).toContain('FAIL_CLOSED_CORRECTIVE: expected exactly one target line');
    expect(corrective).toContain('v_after.proowner is distinct from v_before.proowner');
    expect(corrective).toContain('v_after.prosecdef is distinct from v_before.prosecdef');
    expect(corrective).toContain('v_after.proconfig is distinct from v_before.proconfig');
    expect(corrective).toContain('v_after.acl is distinct from v_before.acl');
    // テーブル・データは変更しない。権限の付け替えもしない
    expect(corrective).not.toMatch(/^\s*(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop|grant|revoke)\b/im);
  });

  it('実行時検査が、担当未割当の見積と旧形式の見積の境界を確認している', () => {
    for (const step of [
      '7-1 担当外の代理店は、担当未割当の見積のプランを読めない',
      '7-3 担当外の代理店は、担当未割当の見積を改訂できない',
      '7-4 担当外の総代理店も、担当未割当の見積を改訂できない',
      '7-5 担当外の代理店は、担当未割当の見積の互換状態を問い合わせできない',
      '7-7 本部は担当未割当の見積のプランを読める',
      '7-8 旧形式で承諾済みの改訂版（確定見積）には、概算→確定の互換処理を実行できない',
      '7-10 旧形式で承諾済みの第1版（概算）には、担当代理店が互換処理を実行できる',
    ]) {
      expect(runtime).toContain(step);
    }
    // 担当未割当（dealer_id が NULL）の見積を試験データに含めている
    expect(runtime).toMatch(/\(q_u,\s+'RT-0100', r_u,\s+c_u,\s+u_cust_x, null,/);
  });
});
