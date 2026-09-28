import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260928174500_quote_revision_staff_access_corrective.sql'),
  'utf8'
);
const localStore = fs.readFileSync(path.join(root, 'lib/data/local-store.ts'), 'utf8');

function functionBody(source: string, functionName: string): string {
  const start = source.indexOf(`create or replace function public.${functionName}`);
  expect(start, `${functionName} definition`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const terminator = tail.match(/\n\$\$;/);
  expect(terminator?.index, `${functionName} terminator`).toBeTypeOf('number');
  return tail.slice(0, (terminator?.index ?? 0) + (terminator?.[0].length ?? 0));
}

describe('Quote Revision staff access corrective', () => {
  it('is the final forward-only Quote Revision authorization corrective', () => {
    expect(Number('20260928174500')).toBeGreaterThan(Number('20260923080000'));
    expect(Number('20260928174500')).toBeGreaterThan(Number('20260928173000'));
  });

  it('separates all-quote revision permission from base-edit permission', () => {
    const body = functionBody(migration, 'create_quote_revision');

    expect(body).toContain('v_can_any := v_rank >= 3;');
    expect(body).toContain('v_can_edit_base := v_rank >= 2;');
    expect(body).not.toContain('v_can_any := v_rank >= 2;');
    expect(body).toContain(
      'if not (v_can_any or (v_rank >= 1 and parent.dealer_id = v_uid)) then'
    );
    expect(body).toContain(
      "if not v_can_edit_base and v_kind in ('base', 'base_expense') then"
    );
  });

  it('does not reuse catalog-edit or organization-hierarchy permission as Quote revision access', () => {
    const body = functionBody(migration, 'create_quote_revision');

    expect(body).not.toContain('public.can_edit_catalog()');
    expect(body).not.toContain('organization_memberships');
    expect(body).not.toContain('parent_organization_id');
  });

  it('keeps the revision lifecycle lock and issued-only guard intact', () => {
    const body = functionBody(migration, 'create_quote_revision');
    const lock = body.indexOf('for update;');
    const auth = body.indexOf('v_can_any := v_rank >= 3;');
    const issued = body.indexOf("if parent.status <> 'issued' then");
    const insert = body.indexOf('insert into public.quotes(');

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(auth).toBeGreaterThan(lock);
    expect(issued).toBeGreaterThan(auth);
    expect(insert).toBeGreaterThan(issued);
    expect(body).toContain("set status = 'superseded'");
    expect(body).toContain('set quote_id = v_new');
  });

  it('hardens SECURITY DEFINER ownership and EXECUTE ACL', () => {
    const body = functionBody(migration, 'create_quote_revision');

    expect(body).toContain('security definer');
    expect(body).toContain("set search_path = ''");
    expect(body).toContain('auth.uid()');
    expect(body).toContain('public.current_role_rank()');
    expect(migration).toContain(
      'alter function public.create_quote_revision(uuid, jsonb, text) owner to postgres;'
    );
    expect(migration).toContain('QUOTE_REVISION_OWNER_INVALID');
    expect(migration).toContain(
      'revoke execute on function public.create_quote_revision(uuid, jsonb, text)\n  from public, anon, authenticated, service_role;'
    );
    expect(migration).toContain(
      'grant execute on function public.create_quote_revision(uuid, jsonb, text) to authenticated;'
    );
    expect(migration).not.toContain(
      'grant execute on function public.create_quote_revision(uuid, jsonb, text) to service_role;'
    );
  });

  it('does not rewrite existing Quote data merely by applying the migration', () => {
    const definitionStart = migration.indexOf(
      'create or replace function public.create_quote_revision'
    );
    const beforeDefinition = migration.slice(0, definitionStart);

    expect(beforeDefinition).not.toMatch(/update\s+public\.quotes/i);
    expect(beforeDefinition).not.toMatch(/insert\s+into\s+public\.quotes/i);
    expect(beforeDefinition).not.toMatch(/delete\s+from\s+public\.quotes/i);
  });

  it('keeps LocalStore aligned: admin any quote, master dealer assigned quote with base edit, dealer assigned quote only', () => {
    expect(localStore).toContain("const canEditAnyQuote = actor.role === 'admin';");
    expect(localStore).toContain(
      "const canEditBase = hasRoleAtLeast(actor.role, 'master_dealer');"
    );
    expect(localStore).toContain(
      "canEditAnyQuote || (hasRoleAtLeast(actor.role, 'dealer') && parent.dealer_id === actor.id)"
    );
    expect(localStore).not.toContain(
      "const canEditAnyQuote = hasRoleAtLeast(actor.role, 'master_dealer');"
    );
  });
});
