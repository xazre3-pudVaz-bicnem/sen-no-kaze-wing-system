import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const previous = fs
  .readFileSync(
    path.join(root, 'supabase/migrations/20261005090000_legacy_accepted_formal_compat.sql'),
    'utf8'
  )
  .replace(/\r\n/g, '\n');
const corrective = fs
  .readFileSync(
    path.join(root, 'supabase/migrations/20261008090000_respond_to_quote_security_corrective.sql'),
    'utf8'
  )
  .replace(/\r\n/g, '\n');

function respondToQuoteDefinition(sql: string) {
  const start = sql.indexOf('create or replace function public.respond_to_quote(');
  expect(start).toBeGreaterThanOrEqual(0);
  const terminator = '$respond_to_quote$;';
  const end = sql.indexOf(terminator, start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + terminator.length).trim();
}

const previousDefinition = respondToQuoteDefinition(previous);
const correctiveDefinition = respondToQuoteDefinition(corrective);

describe('respond_to_quote security corrective', () => {
  it('changes only the authentication guard and the NULL-safe acceptance condition inside the final lifecycle definition', () => {
    const expected = previousDefinition
      .replace(
        '  v_current_quote_id uuid;\nbegin\n',
        [
          '  v_current_quote_id uuid;',
          '  v_uid uuid;',
          'begin',
          '  v_uid := auth.uid();',
          '  if v_uid is null then',
          "    raise exception 'UNAUTHENTICATED' using errcode = '42501';",
          '  end if;',
          '',
          '',
        ].join('\n')
      )
      .replace('  if q.user_id <> auth.uid() then', '  if q.user_id is distinct from v_uid then')
      // 承諾条件：quote_kind が NULL の旧形式で条件全体が NULL になり、拒否できない穴を塞ぐ（fail closed）
      .replace(
        "  if p_status = 'accepted' and not (\n    q.quote_kind = 'formal'\n",
        [
          "  -- quote_kind が NULL の旧形式（legacy）では `q.quote_kind = 'formal'` が NULL になる。",
          '  -- NULL のまま判定すると条件全体が NULL になり承諾を拒否できないため、false に倒す（fail closed）。',
          '  -- 旧形式の第1版・概算見積（親なし）は承諾不可、旧形式でも正しい親を持つ改訂版は従来どおり承諾可。',
          "  if p_status = 'accepted' and not (",
          "    coalesce(q.quote_kind = 'formal', false)",
          '',
        ].join('\n')
      );

    expect(correctiveDefinition).toBe(expected);
  });

  it('rejects missing auth before validating action or reading a Quote', () => {
    const authLookup = correctiveDefinition.indexOf('v_uid := auth.uid();');
    const nullReject = correctiveDefinition.indexOf('if v_uid is null then');
    const actionValidation = correctiveDefinition.indexOf("if p_status not in ('accepted', 'declined') then");
    const quoteLock = correctiveDefinition.indexOf('from public.quotes');

    expect(authLookup).toBeGreaterThanOrEqual(0);
    expect(nullReject).toBeGreaterThan(authLookup);
    expect(actionValidation).toBeGreaterThan(nullReject);
    expect(quoteLock).toBeGreaterThan(actionValidation);
    expect(correctiveDefinition).toContain('if q.user_id is distinct from v_uid then');
    expect(correctiveDefinition).not.toContain('q.user_id <> auth.uid()');
  });

  it('keeps current-revision and acceptance checks behind row locks', () => {
    const quoteLock = correctiveDefinition.indexOf('from public.quotes');
    const quoteForUpdate = correctiveDefinition.indexOf('for update;', quoteLock);
    const issuedCheck = correctiveDefinition.indexOf("if q.status <> 'issued' then");
    const requestLock = correctiveDefinition.indexOf('from public.quote_requests');
    const requestForUpdate = correctiveDefinition.indexOf('for update;', requestLock);
    const currentCheck = correctiveDefinition.indexOf('v_current_quote_id is distinct from q.id');
    const formalCheck = correctiveDefinition.indexOf("if p_status = 'accepted' and not (");
    const quoteUpdate = correctiveDefinition.indexOf('update public.quotes set status = p_status');

    expect(quoteForUpdate).toBeGreaterThan(quoteLock);
    expect(issuedCheck).toBeGreaterThan(quoteForUpdate);
    expect(requestLock).toBeGreaterThan(issuedCheck);
    expect(requestForUpdate).toBeGreaterThan(requestLock);
    expect(currentCheck).toBeGreaterThan(requestForUpdate);
    expect(formalCheck).toBeGreaterThan(currentCheck);
    expect(quoteUpdate).toBeGreaterThan(formalCheck);
  });

  it('preserves double-answer, superseded/current-pointer, formal accept, and decline behavior', () => {
    expect(correctiveDefinition).toContain("if q.status <> 'issued' then");
    expect(correctiveDefinition).toContain('v_current_quote_id is distinct from q.id');
    expect(correctiveDefinition).toContain("q.quote_kind = 'formal'");
    expect(correctiveDefinition).toContain('q.quote_kind is null');
    expect(correctiveDefinition).toContain('q.parent_quote_id is not null');
    expect(correctiveDefinition).toContain('from public.quotes parent');
    expect(correctiveDefinition).toContain("if p_status = 'accepted' and not (");
    expect(correctiveDefinition).not.toContain("if p_status = 'declined'");
  });

  it('rejects acceptance of a legacy first-version preliminary quote (quote_kind NULL, no parent)', () => {
    // quote_kind が NULL だと `q.quote_kind = 'formal'` は NULL。NULL のままだと `not (NULL or false)` が NULL になり、
    // 承諾を拒否できない（実 DB の実行時検査で、旧形式の第1版を承諾できてしまうことを確認した）。
    expect(correctiveDefinition).toContain("coalesce(q.quote_kind = 'formal', false)");
    expect(correctiveDefinition).not.toMatch(/and not \(\s*q\.quote_kind = 'formal'/);
    // 2 つ目の条件は is null / is not null / exists だけで構成され、NULL にならない
    const legacyBranch = correctiveDefinition.slice(
      correctiveDefinition.indexOf('q.quote_kind is null'),
      correctiveDefinition.indexOf("raise exception 'LOCKED: 現地条件と施工金額を反映した確定見積の発行後に承諾できます'")
    );
    expect(legacyBranch).toContain('and q.parent_quote_id is not null');
    expect(legacyBranch).toContain('and exists (');
  });

  it('pins SECURITY DEFINER, empty search_path, schema-qualified relations, owner and ACL', () => {
    expect(correctiveDefinition).toContain("security definer\nset search_path = ''");
    expect(correctiveDefinition).toContain('from public.quotes');
    expect(correctiveDefinition).toContain('from public.quote_requests');
    expect(correctiveDefinition).toContain('update public.quotes');
    expect(correctiveDefinition).toContain('update public.configurations');

    expect(corrective).toContain('alter function public.respond_to_quote(uuid, text) owner to postgres;');
    expect(corrective).toContain(
      'revoke execute on function public.respond_to_quote(uuid, text)\n  from public, anon, authenticated, service_role;'
    );
    expect(corrective).toContain(
      'grant execute on function public.respond_to_quote(uuid, text) to authenticated;'
    );
    expect(corrective).not.toContain(
      'grant execute on function public.respond_to_quote(uuid, text) to anon'
    );
    expect(corrective).not.toContain(
      'grant execute on function public.respond_to_quote(uuid, text) to service_role'
    );
  });

  it('fails migration application when owner, search_path or execution ACL drift', () => {
    expect(corrective).toContain("v_owner is distinct from 'postgres'");
    expect(corrective).toContain('v_security_definer is distinct from true');
    expect(corrective).toContain("cfg.value in ('search_path=', 'search_path=\"\"')");
    expect(corrective).toContain("has_function_privilege('anon', v_oid, 'EXECUTE')");
    expect(corrective).toContain("has_function_privilege('authenticated', v_oid, 'EXECUTE')");
    expect(corrective).toContain("has_function_privilege('service_role', v_oid, 'EXECUTE')");
    expect(corrective).toContain('acl.grantee = 0');
    expect(corrective).toContain("acl.privilege_type = 'EXECUTE'");
  });
});
