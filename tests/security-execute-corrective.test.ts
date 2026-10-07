import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261007120000_security_execute_corrective.sql');
const source = read('supabase/migrations/20260830091000_exterior_four_faces.sql');
const checks = read('scripts/db-rehearsal/checks.mjs');

const DOLLAR = '$' + '$';

function duplicateConfiguration(sql: string): string {
  const start = sql.indexOf('create or replace function public.duplicate_configuration(p_configuration_id uuid)');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(`${DOLLAR};`, start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/** 文字列の最初の一致を置き換える（String.replace の `$` 特殊パターンを避ける） */
function swap(text: string, from: string, to: string): string {
  const index = text.indexOf(from);
  expect(index, from).toBeGreaterThanOrEqual(0);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

describe('Security corrective: API ロールへ公開しない EXECUTE を閉じる', () => {
  it('duplicate_configuration は元の定義から 3 点だけを変更している', () => {
    // 元の定義へ意図した差分だけを当てたものと、corrective の定義が一致すること（写し間違いの検出）
    let expected = duplicateConfiguration(source);
    expected = swap(
      expected,
      `returns public.configurations language plpgsql security definer set search_path = public as ${DOLLAR}
declare
`,
      `returns public.configurations
language plpgsql
security definer
set search_path = ''
as ${DOLLAR}
declare
  v_uid uuid := auth.uid();
`
    );
    expected = swap(
      expected,
      `begin
  select * into src from public.configurations where id = p_configuration_id;`,
      `begin
  -- 未ログインは最初に拒否する
  if v_uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;

  select * into src from public.configurations where id = p_configuration_id;`
    );
    expected = swap(
      expected,
      '  if not (public.is_admin() or src.user_id = auth.uid()) then',
      `  -- 判定不能を許可に倒さない（fail closed）
  if not coalesce(public.is_admin() or src.user_id = v_uid, false) then`
    );
    // 終端の書式だけ `end $$;` → `end;` + 改行 + `$$;` に変えている
    expect(expected.endsWith('end ')).toBe(true);
    expected = `${expected.slice(0, -'end '.length)}end;
`;
    expect(duplicateConfiguration(migration)).toBe(expected);
  });

  it('duplicate_configuration は未ログインを拒否し、参照を全てスキーマ修飾している', () => {
    const body = duplicateConfiguration(migration);
    expect(body).toContain("set search_path = ''");
    expect(body.indexOf("raise exception 'UNAUTHENTICATED'")).toBeLessThan(body.indexOf('select * into src'));
    expect(body).toContain('coalesce(public.is_admin() or src.user_id = v_uid, false)');
    // from / join / insert into の対象は public. で修飾されている（CTE の wanted を除く）
    const unqualified = [...body.matchAll(/\b(?:from|join|insert into|update)\s+([a-z_]+)(?![a-z_.(])/g)]
      .map((match) => match[1])
      .filter((name) => !['wanted', 'w'].includes(name));
    expect(unqualified).toEqual([]);
  });

  it('既定権限で付く EXECUTE を、対象ロールを明示して外す', () => {
    for (const fn of [
      'duplicate_configuration(uuid)',
      'notify(uuid, text, text, text, text, text)',
      'write_audit(text, text, uuid, text, jsonb, jsonb)',
      'validate_configuration_items(uuid, uuid[])',
      'validate_configuration_items(uuid, uuid[], text)',
    ]) {
      expect(migration).toContain(`revoke execute on function public.${fn}
  from public, anon, authenticated, service_role;`);
    }
    const grants = [...migration.matchAll(/^grant execute on function public\.([a-z_]+)\([^)]*\) to ([a-z_, ]+);$/gm)].map(
      (match) => `${match[1]}:${match[2]}`
    );
    expect(grants.sort()).toEqual(['duplicate_configuration:authenticated', 'notify:service_role', 'write_audit:service_role']);
  });

  it('呼び出し元が SECURITY DEFINER であることを適用時に検算し、データは変更しない', () => {
    expect(migration).toContain('not p.prosecdef');
    expect(migration).toContain(`'search_path=""' = any(p.proconfig)`);
    const outside = migration.split(duplicateConfiguration(migration)).join('');
    expect(outside).not.toMatch(/^\s*(insert\s+into|update|delete\s+from|truncate|alter\s+table|drop)\b/im);
  });

  it('リハーサル検査の「未是正」リストを空にし、許可リストは RLS 判定用の 4 関数だけにする', () => {
    expect(checks).toContain("export const ANON_DEFINER_ALLOWLIST = ['can_edit_catalog', 'current_role_rank', 'is_admin', 'is_dealer'];");
    expect(checks).toContain('export const ANON_DEFINER_PENDING_SECURITY_CORRECTIVE = [];');
  });
});
