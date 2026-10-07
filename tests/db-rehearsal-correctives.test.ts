import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8').split('\r').join('');

/** 文字列リテラルとコメントを除いた上で、丸括弧の対応が取れているか */
function parenthesesBalanced(sql: string): boolean {
  const code = sql
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''");
  let depth = 0;
  for (const ch of code) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

describe('実 DB リハーサルで見つかった是正（2026-10-07）', () => {
  it('pgcrypto の digest は extensions スキーマを明示して呼ぶ', () => {
    // Supabase の pgcrypto は extensions にあり、set search_path = public の関数からは修飾なしで解決できない
    const sql = read('20260914170000_legacy_base_migration_audit.sql');
    expect(sql.match(/extensions\.digest\(/g)?.length).toBe(2);
    expect(sql).not.toMatch(/(^|[^.\w])digest\(/m);
  });

  it('save_configuration_atomic の括弧が対応している', () => {
    const sql = read('20260928100000_configuration_atomic_save_corrective.sql');
    expect(sql).toContain('and not (p_spec_code = any(o.spec_codes)))');
    expect(parenthesesBalanced(sql)).toBe(true);
  });

  it('全マイグレーションで丸括弧の対応が取れている', () => {
    const dir = path.join(root, 'supabase/migrations');
    const broken = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => !parenthesesBalanced(read(f)));
    expect(broken).toEqual([]);
  });

  it('内部専用関数は API ロールから実行できないようにする', () => {
    const sql = read('20261007120000_internal_function_execute_corrective.sql');
    for (const fn of ['notify(uuid, text, text, text, text, text)', 'write_audit(text, text, uuid, text, jsonb, jsonb)', 'duplicate_configuration(uuid)']) {
      // 既定権限で付く anon / authenticated を明示して外す（from public だけでは外れない）
      expect(sql).toContain(`revoke execute on function public.${fn}\n  from public, anon, authenticated, service_role;`);
    }
    expect(sql).toContain('grant execute on function public.duplicate_configuration(uuid) to authenticated, service_role;');
    expect(sql).not.toMatch(/grant execute on function public\.(notify|write_audit)\([^)]*\) to (anon|authenticated)/);
    // 呼び出し元が SECURITY DEFINER であることを適用時に検算する
    expect(sql).toContain('not p.prosecdef');
    expect(sql).not.toMatch(/\b(insert into|update|delete from|drop|truncate|alter table)\b/i);
  });
});
