import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260928170000_accessible_customer_management.sql'),
  'utf8'
);
const supabaseStore = fs.readFileSync(path.join(root, 'lib/data/supabase-store.ts'), 'utf8');
const localStore = fs.readFileSync(path.join(root, 'lib/data/local-store.ts'), 'utf8');
const store = fs.readFileSync(path.join(root, 'lib/data/store.ts'), 'utf8');

function functionBody(name: string): string {
  const start = migration.indexOf(`create or replace function public.${name}`);
  expect(start, `${name} definition`).toBeGreaterThanOrEqual(0);
  const tail = migration.slice(start);
  const match = tail.match(/\n\$\$;/);
  expect(match?.index, `${name} terminator`).toBeTypeOf('number');
  return tail.slice(0, (match?.index ?? 0) + (match?.[0].length ?? 0));
}

describe('担当案件限定の顧客管理 security contract', () => {
  it('adds exactly the two external SECURITY DEFINER RPCs with empty search_path', () => {
    const definitions = migration.match(/create or replace function public\./g) ?? [];
    expect(definitions).toHaveLength(2);

    for (const name of ['list_accessible_customers()', 'get_accessible_customer_detail(p_customer_id uuid)']) {
      const body = functionBody(name);
      expect(body).toContain('security definer');
      expect(body).toContain("set search_path = ''");
      expect(body).toContain('v_uid uuid := auth.uid();');
      expect(body).toContain("raise exception 'UNAUTHENTICATED'");
      expect(body).toContain('v_rank := public.current_role_rank();');
      expect(body).toContain('if v_rank < 1 then');
    }
  });

  it('allows admin globally but restricts master dealer and dealer by quote_request series assignment', () => {
    for (const name of ['list_accessible_customers()', 'get_accessible_customer_detail(p_customer_id uuid)']) {
      const body = functionBody(name);
      expect(body).toContain('where v_rank >= 3');
      expect(body).toContain('where aq.quote_request_id = r.id');
      expect(body).toContain('and aq.dealer_id = v_uid');
      expect(body).not.toContain('public.can_edit_catalog()');
      expect(body).not.toContain('organization_memberships');
      expect(body).not.toContain('parent_organization_id');
    }
  });

  it('does not broaden table RLS or direct profile access', () => {
    expect(migration).not.toMatch(/create\s+policy/i);
    expect(migration).not.toMatch(/drop\s+policy/i);
    expect(migration).not.toMatch(/alter\s+table\s+public\.(profiles|quote_requests|configurations|quotes)\s+enable\s+row\s+level\s+security/i);
    expect(migration).not.toMatch(/grant\s+select\s+on\s+public\.(profiles|quote_requests|configurations|quotes)/i);
  });

  it('limits customer identity linking to consistent customer user_ids and keeps ambiguous cases separate', () => {
    for (const name of ['list_accessible_customers()', 'get_accessible_customer_detail(p_customer_id uuid)']) {
      const body = functionBody(name);
      expect(body).toContain('iq.user_id <> r.user_id');
      expect(body).toContain("then 'inconsistent_user_id'");
      expect(body).toContain("then 'missing_profile'");
      expect(body).toContain("and ip.role_code = 'customer'");
      expect(body).toContain("then 'non_customer_profile'");
    }
    const list = functionBody('list_accessible_customers()');
    expect(list).toContain("where uc.identity_issue <> 'none'");
  });

  it('returns only assigned request-series cases and revision history in customer detail', () => {
    const detail = functionBody('get_accessible_customer_detail(p_customer_id uuid)');
    expect(detail).toContain('from case_rows as cr');
    expect(detail).toContain('join public.quotes as q');
    expect(detail).toContain('on q.quote_request_id = cr.case_id');
    expect(detail).toContain("'can_open_quote', v_rank >= 3 or q.dealer_id = v_uid");
    expect(detail).toContain('and cr.request_user_id = p.id');
    expect(detail).toContain('return v_result;');
  });

  it('does not pre-empt non-Web Draft assignment or organization hierarchy', () => {
    expect(migration).not.toContain('quote_drafts');
    expect(migration).not.toContain('created_by');
    expect(migration).not.toContain('parent_organization_id');
    expect(migration).not.toContain('organization_relationship');
  });

  it('revokes default EXECUTE and grants only authenticated', () => {
    for (const signature of [
      'public.list_accessible_customers()',
      'public.get_accessible_customer_detail(uuid)',
    ]) {
      expect(migration).toContain(
        `revoke execute on function ${signature}\n  from public, anon, authenticated, service_role;`
      );
      expect(migration).toContain(`grant execute on function ${signature} to authenticated;`);
      expect(migration).not.toContain(`grant execute on function ${signature} to anon;`);
      expect(migration).not.toContain(`grant execute on function ${signature} to service_role;`);
    }
  });

  it('pins both RPC owners to postgres and verifies ownership in migration', () => {
    expect(migration).toContain('alter function public.list_accessible_customers() owner to postgres;');
    expect(migration).toContain('alter function public.get_accessible_customer_detail(uuid) owner to postgres;');
    expect(migration).toContain('ACCESSIBLE_CUSTOMER_LIST_OWNER_INVALID');
    expect(migration).toContain('ACCESSIBLE_CUSTOMER_DETAIL_OWNER_INVALID');
  });

  it('connects production store only through the dedicated RPCs with no broad fallback', () => {
    expect(supabaseStore).toContain("db.rpc('list_accessible_customers')");
    expect(supabaseStore).toContain("db.rpc('get_accessible_customer_detail'");
    expect(supabaseStore).not.toContain('isMissingNamedFunction(error, \'list_accessible_customers\')');
    expect(supabaseStore).not.toContain('isMissingNamedFunction(error, \'get_accessible_customer_detail\')');
    expect(store).toContain('listAccessibleCustomers(actor: SessionUser)');
    expect(store).toContain('getAccessibleCustomerDetail(customerId: string, actor: SessionUser)');
  });

  it('keeps local-mode access aligned with the same quote_request assignment boundary', () => {
    expect(localStore).toContain("actor.role === 'admin'");
    expect(localStore).toContain("db.quotes.filter((quote) => quote.dealer_id === actor.id).map((quote) => quote.quote_request_id)");
    expect(localStore).toContain("customer.cases.length > 0");
    expect(localStore).toContain("can_open_quote: actor.role === 'admin' || quote.dealer_id === actor.id");
  });
});
