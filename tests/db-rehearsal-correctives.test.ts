import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const readRepo = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const read = (file: string) => readRepo(path.join('supabase/migrations', file));

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

  it('DB Rehearsal は contract-check の走査範囲と実行環境変更で発火する', () => {
    const workflow = readRepo('.github/workflows/db-rehearsal.yml');
    for (const trigger of [
      'supabase/**',
      'app/**',
      'components/**',
      'lib/**',
      'scripts/**',
      'package.json',
      'package-lock.json',
      '.github/workflows/db-rehearsal.yml',
    ]) {
      expect(workflow).toContain(`- '${trigger}'`);
    }
  });

  it('lint gate は JSON 配列を取得できない出力を成功扱いしない', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-lint-gate-'));
    try {
      const invalid = path.join(dir, 'invalid.txt');
      fs.writeFileSync(invalid, 'unexpected lint output\n');
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/db-rehearsal/lint-gate.mjs'), invalid], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('JSON 配列');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lint gate は有効な空の JSON 配列なら成功する', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-lint-gate-'));
    try {
      const valid = path.join(dir, 'valid.json');
      fs.writeFileSync(valid, '[]\n');
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/db-rehearsal/lint-gate.mjs'), valid], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('plpgsql_check: エラー 0 件');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
