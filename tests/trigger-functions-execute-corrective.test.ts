import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const migrationFile = '20261016114000_trigger_functions_execute_corrective.sql';
const migration = read(`supabase/migrations/${migrationFile}`);
const runtime = read('scripts/db-rehearsal/runtime-trigger-function-execute.sql');
const check = read('scripts/db-rehearsal/check.mjs');
const preflight = read('scripts/db-rehearsal/preflight-trigger-functions-execute.sql');
const postflight = read('scripts/db-rehearsal/postflight-trigger-functions-execute.sql');

/** コメントを除いた SQL 本文 */
const withoutComments = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
const statements = withoutComments(migration);

/** 「関数・テーブル・トリガー」の一覧（migration・実行時検査・本番の確認 SQL で同じものを使う） */
const expectedTriggers = (sql: string) =>
  [...sql.matchAll(/^ {2,4}\('(public\.[a-z_]+\(\))', '([a-z_.]+)', '([a-z_]+)'\)[,;]?$/gm)].map((m) => `${m[1]}|${m[2]}|${m[3]}`);

const revoked = [...statements.matchAll(/^revoke execute on function (public\.[a-z_]+\(\)) from public, anon, authenticated, service_role;$/gm)].map(
  (m) => m[1],
);

describe('トリガー専用の関数 26 本の EXECUTE を外す（20261016114000）', () => {
  it('20261016113000 の直後に置く（未適用の PR の migration より前）', () => {
    const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
    const index = files.indexOf(migrationFile);
    expect(files[index - 1]).toBe('20261016113000_option_audit_trigger_execute_corrective.sql');
  });

  it('対象は 26 本の関数と、それを使う 31 本のトリガー。外すのは一覧の 26 本だけ', () => {
    const list = expectedTriggers(migration);
    expect(list).toHaveLength(31);
    const functions = [...new Set(list.map((row) => row.split('|')[0]))].sort();
    expect(functions).toHaveLength(26);
    // 一覧に無い関数（SECURITY INVOKER のトリガー関数など）は外さない
    expect([...revoked].sort()).toEqual(functions);
    expect(statements.match(/^revoke /gm)).toHaveLength(26);
  });

  it('外す前に、トリガー専用で、ほかから使われていないことを確かめる', () => {
    expect(statements).toContain("p.prorettype <> 'trigger'::regtype or not p.prosecdef");
    expect(statements).toContain('must be used only by the expected triggers');
    expect(statements).toContain("d.classid <> 'pg_catalog.pg_trigger'::regclass");
    expect(statements).toContain("p.prosrc ~ ('\\m' || (select p0.proname from pg_catalog.pg_proc p0 where p0.oid = v_oid) || '\\s*\\(')");
    expect(statements).toContain("t.tgfoid <> to_regprocedure(e.fn) or t.tgenabled <> 'O'");
  });

  it('関数の本文・トリガー・テーブル・データは変えない（権限だけ）', () => {
    const body = statements.replace(/create temp table _trigger_fn_expected[\s\S]*?;\ninsert into _trigger_fn_expected[\s\S]*?;\n/, '');
    expect(body).not.toMatch(/create (or replace )?(function|trigger)/i);
    expect(body).not.toMatch(/\b(insert into|update public\.|delete from|alter (table|function)|drop )/i);
    expect(body).not.toMatch(/\bgrant\b/i);
  });

  it('適用後に、どのロールからも実行できず、31 本のトリガーが有効のままかを確かめる', () => {
    expect(statements).toContain("has_function_privilege('anon', v_oid, 'EXECUTE')");
    expect(statements).toContain("has_function_privilege('authenticated', v_oid, 'EXECUTE')");
    expect(statements).toContain("has_function_privilege('service_role', v_oid, 'EXECUTE')");
    expect(statements).toContain("a.grantee = 0 and a.privilege_type = 'EXECUTE'");
    expect(statements).toContain("POSTCONDITION: all 31 triggers must stay enabled");
  });

  it('実 DB の検査：権限・直接の実行の拒否・31 本のトリガーの動作を、権限を外したロールの書き込みで確かめる', () => {
    expect(expectedTriggers(runtime)).toEqual(expectedTriggers(migration));
    expect(runtime).toContain('TFE-1 トリガー専用の関数 26 本は、PUBLIC・anon・authenticated・service_role から直接実行できない');
    expect(runtime).toContain("r.out not like 'ERROR 42501: permission denied for function %'");
    expect(runtime).toContain('TFE-3 31 本のトリガーは残っていて、すべて有効');
    for (const fn of new Set(expectedTriggers(migration).map((row) => row.split('|')[0].replace(/^public\.|\(\)$/g, '')))) {
      expect(runtime, fn).toMatch(new RegExp(`TFE-\\d+ [^']*${fn}`));
    }
    expect(runtime).toContain("pg_temp.tfe_run_as('service_role'");
    expect(runtime).toContain("pg_temp.tfe_run_as('authenticated', u_cust");
    expect(runtime).toContain("has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'execute')");
    expect(check).toContain("import { runtimeTriggerFunctionExecute } from './runtime-trigger-function-execute.mjs';");
    expect(check).toContain('runtime = mergeRuntime(runtime, await runtimeTriggerFunctionExecute(client));');
  });

  it('本番の適用前後の確認 SQL は読み取りだけで、同じ一覧を使う', () => {
    for (const sql of [preflight, postflight]) {
      expect(withoutComments(sql)).not.toMatch(/\b(insert|update|delete|alter|drop|grant|revoke|create|truncate)\b/i);
      expect(expectedTriggers(sql)).toEqual(expectedTriggers(migration));
    }
    expect(preflight).toContain('as non_trigger_dependents');
    expect(preflight).toContain('as call_references');
    expect(preflight).toContain('as function_attributes');
    expect(postflight).toContain('as still_executable');
    expect(postflight).toContain('as expected_triggers_enabled');
  });
});
