import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const migrationFile = '20261016113000_option_audit_trigger_execute_corrective.sql';
const migration = read(`supabase/migrations/${migrationFile}`);
const runtime = read('scripts/db-rehearsal/runtime-product-sales-stop.sql');
const preflight = read('scripts/db-rehearsal/preflight-product-sales-stop.sql');
const postflight = read('scripts/db-rehearsal/postflight-product-sales-stop.sql');

/** コメントを除いた SQL 本文 */
const statements = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('商品の変更履歴のトリガー関数の EXECUTE を外す（20261016113000）', () => {
  it('販売停止・廃番（20261016112000）の直後、次の未適用の migration より前に置く', () => {
    const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
    const index = files.indexOf(migrationFile);
    expect(files[index - 1]).toBe('20261016112000_product_sales_stop_discontinue.sql');
  });

  it('トリガー専用であることを確かめてから、PUBLIC・anon・authenticated・service_role の EXECUTE を外す', () => {
    expect(statements).toContain("if (select p.prorettype <> 'trigger'::regtype from pg_catalog.pg_proc p where p.oid = v_oid) then");
    expect(statements).toContain("t.tgrelid = 'public.options'::regclass and t.tgname = 'trg_options_audit'");
    expect(statements).toContain("p.prosrc like '%trg_audit_option%'");
    expect(statements).toContain('revoke execute on function public.trg_audit_option() from public, anon, authenticated, service_role;');
  });

  it('関数の本文・テーブル・データは変えない（権限だけ）', () => {
    expect(statements).not.toMatch(/create (or replace )?function/i);
    expect(statements).not.toMatch(/\b(insert into|update public\.|delete from|alter table|drop )/i);
    expect(statements).not.toMatch(/\bgrant\b/i);
  });

  it('適用後に、どのロールからも実行できず、トリガーが有効のままかを確かめる', () => {
    expect(statements).toContain("has_function_privilege('anon', v_oid, 'EXECUTE')");
    expect(statements).toContain("has_function_privilege('authenticated', v_oid, 'EXECUTE')");
    expect(statements).toContain("has_function_privilege('service_role', v_oid, 'EXECUTE')");
    expect(statements).toContain("a.grantee = 0 and a.privilege_type = 'EXECUTE'");
    expect(statements).toContain("t.tgenabled = 'O'");
  });

  it('実 DB の検査：直接の実行は権限で拒否し、トリガーは変更履歴を書き続ける', () => {
    expect(runtime).toContain('PSS-27 商品の変更履歴のトリガー関数は、PUBLIC・anon・authenticated・service_role から直接実行できない');
    expect(runtime).toContain("'42501', 'permission denied for function trg_audit_option'");
    expect(runtime).toContain('PSS-29 トリガーは有効のまま');
    // 変更履歴の書き込み（PSS-24）は、この migration を適用した後の DB で流れる
    expect(runtime.indexOf('PSS-24')).toBeGreaterThan(0);
  });

  it('本番の適用前後の確認 SQL は読み取りだけ', () => {
    for (const sql of [preflight, postflight]) {
      const body = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
      expect(body).not.toMatch(/\b(insert|update|delete|alter|drop|grant|revoke|create|truncate)\b/i);
    }
    expect(preflight).toContain('as audit_function_trigger_only');
    expect(preflight).toContain('as specs_that_would_stop_accepting');
    expect(postflight).toContain('as audit_function_closed');
    expect(postflight).toContain('as internal_functions_closed');
  });
});
