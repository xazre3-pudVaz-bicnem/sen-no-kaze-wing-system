import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const corrective = read('supabase/migrations/20261013090000_formal_compat_permission_first_corrective.sql');
const previousCorrective = read('supabase/migrations/20261009090000_assignment_and_legacy_kind_fail_closed_corrective.sql');
const legacyCompat = read('supabase/migrations/20261005090000_legacy_accepted_formal_compat.sql');
const runtime = read('scripts/db-rehearsal/runtime-security.sql');

const SIGNATURE = 'public.create_formal_quote_from_accepted_preliminary(uuid, jsonb, text)';

/** corrective の `v_xxx constant text := E'...' || E'...';` を、SQL と同じ規則で文字列へ戻す */
function textConstant(name: string): string {
  const declaration = corrective.match(new RegExp(`${name} constant text :=([\\s\\S]*?);\\n`));
  expect(declaration, name).not.toBeNull();
  const pieces = [...declaration![1].matchAll(/E'((?:[^'\\]|''|\\.)*)'/g)];
  expect(pieces.length, name).toBeGreaterThan(0);
  return pieces.map((piece) => piece[1].split("''").join("'").split('\\n').join('\n')).join('');
}

/** 20261005090000 の関数本文に、20261009090000 の置き換え（この関数の分）を当てた「適用済みの定義」 */
function definitionBeforeThisCorrective(): string {
  const start = legacyCompat.indexOf('create or replace function public.create_formal_quote_from_accepted_preliminary(');
  const end = legacyCompat.indexOf('$formalize_legacy_accepted$;', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  let body = legacyCompat.slice(start, end);
  const patches = [
    ...previousCorrective.matchAll(/\((\d+),\s*\n\s*'([^']+)',\s*\n\s*'((?:[^']|'')+)',\s*\n\s*'((?:[^']|'')+)'\)/g),
  ].filter((row) => row[2] === SIGNATURE);
  expect(patches.map((row) => Number(row[1]))).toEqual([4, 5]);
  for (const row of patches) {
    const oldText = row[3].split("''").join("'");
    const newText = row[4].split("''").join("'");
    expect(body.split(oldText).length - 1).toBe(1);
    body = body.replace(oldText, newText);
  }
  return body;
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('概算→確定の互換処理で、担当権限を状態判定より前に確認する corrective', () => {
  const check = textConstant('v_check');
  const anchor = textConstant('v_anchor');
  const comment = textConstant('v_comment');
  const before = definitionBeforeThisCorrective();
  const after = before.replace(check, '').replace(anchor, comment + check + anchor);

  it('移す対象は 20261009090000 適用後の権限確認そのもので、適用済みの定義にちょうど 1 箇所ずつある', () => {
    expect(check).toContain('coalesce(parent.dealer_id = v_uid, false)');
    expect(check).toContain("raise exception 'FORBIDDEN: この案件の確定見積を発行できません' using errcode = '42501';");
    expect(count(before, check)).toBe(1);
    expect(count(before, anchor)).toBe(1);
    // 是正前は、権限確認が状態判定（LOCKED）・整合性判定（VALIDATION）より後にある
    expect(before.indexOf(check)).toBeGreaterThan(before.indexOf("'LOCKED:"));
    expect(before.indexOf(check)).toBeGreaterThan(before.indexOf("'VALIDATION:"));
  });

  it('是正後は「見積の存在確認 → 担当権限 → QuoteRequest の lock → 状態判定」の順になる', () => {
    const at = (needle: string) => after.indexOf(needle);
    expect(at("'NOT_FOUND'")).toBeLessThan(at(check));
    expect(at(check)).toBeLessThan(at(anchor));
    expect(at(anchor)).toBeLessThan(at("'LOCKED:"));
    expect(at(check)).toBeLessThan(at("'VALIDATION:"));
    // lock の順序（Quote → QuoteRequest）は変えない
    expect(at('   for update;')).toBeLessThan(at(check));
  });

  it('変更は権限確認ブロックの移動（と説明コメント 1 行）だけで、権限の条件・それ以外の行は変えない', () => {
    expect(after.split(comment + check).join('')).toBe(before.split(check).join(''));
    expect(comment.trim().startsWith('--')).toBe(true);
    expect(count(after, check)).toBe(1);
  });

  it('想定と違う定義なら何もせず停止し、置き換え後の定義・順序・owner・EXECUTE を検算する', () => {
    expect(corrective).toContain(`v_signature constant text := '${SIGNATURE}';`);
    expect(corrective).toContain('pg_catalog.pg_get_functiondef(v_oid)');
    expect(corrective).toContain('permission check or lock anchor is not unique');
    expect(corrective).toContain('already checks permission before state');
    expect(corrective).toContain('if v_definition is distinct from v_expected then');
    expect(corrective).toContain('v_after.proowner is distinct from v_before.proowner');
    expect(corrective).toContain('v_after.prosecdef is distinct from v_before.prosecdef');
    expect(corrective).toContain('v_after.proconfig is distinct from v_before.proconfig');
    expect(corrective).toContain('v_after.acl is distinct from v_before.acl');
    expect(corrective).toContain("pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')");
    expect(corrective).toContain("pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')");
    expect(corrective).toContain("not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')");
    // テーブル・データは変更しない。権限の付け替えもしない
    expect(corrective).not.toMatch(/^\s*(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop|grant|revoke)\b/im);
  });

  it('実行時検査で、権限のない利用者には状態にかかわらず 42501 だけが返ることを確認している', () => {
    for (const step of [
      '8-1 担当外の代理店には、互換処理済みの概算見積でも権限の拒否だけを返す',
      '8-2 担当外の代理店には、辞退済みの見積でも権限の拒否だけを返す',
      '8-3 担当外の代理店には、担当未割当の見積でも権限の拒否だけを返す',
      '8-4 担当外の総代理店には、承諾済みの改訂版でも権限の拒否だけを返す',
      '8-5 お客様本人にも、承諾済みの確定見積で権限の拒否だけを返す',
      '8-6 担当代理店には、従来どおり状態に応じた判定を返す（互換処理済みは LOCKED）',
      '8-7 本部には、従来どおり状態に応じた判定を返す（辞退済みは LOCKED）',
      '8-8 拒否された互換処理では見積が増えていない',
    ]) {
      expect(runtime).toContain(step);
    }
  });
});
