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
});
