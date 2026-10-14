import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261014080000_audit_logs_acl_hardening.sql'),
  'utf8'
);
const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

describe('audit_logs ACL hardening', () => {
  it('removes browser-role table privileges and restores only authenticated SELECT', () => {
    expect(migration).toContain('revoke all on table public.audit_logs from public;');
    expect(migration).toContain('revoke all on table public.audit_logs from anon;');
    expect(migration).toContain('revoke all on table public.audit_logs from authenticated;');
    expect(migration).toContain('grant select on table public.audit_logs to authenticated;');

    expect(sqlOnly).not.toMatch(/grant\s+(insert|update|delete|truncate|references|trigger|maintain|all)\s+on\s+table\s+public\.audit_logs\s+to\s+(anon|authenticated)/i);
  });

  it('checks TRUNCATE, MAINTAIN and the other non-RLS table privileges in the postcondition', () => {
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
        expect(migration).toContain(`has_table_privilege('${role}', 'public.audit_logs', '${privilege}')`);
      }
    }
    expect(migration).toContain("has_table_privilege('anon', 'public.audit_logs', 'SELECT')");
    expect(migration).toContain("has_table_privilege('authenticated', 'public.audit_logs', 'SELECT')");
  });

  it('preserves RLS and the existing admin read policy contract', () => {
    expect(migration).toContain("c.relname = 'audit_logs'");
    expect(migration).toContain('c.relrowsecurity');
    expect(migration).toContain("p.polname = 'audit_logs_admin'");
    expect(migration).toContain("p.polcmd = 'r'");

    expect(sqlOnly).not.toMatch(/drop\s+policy/i);
    expect(sqlOnly).not.toMatch(/create\s+policy/i);
  });

  it('does not broaden this corrective into function, service-role, or default-privilege changes', () => {
    expect(sqlOnly).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(sqlOnly).not.toMatch(/alter\s+default\s+privileges/i);
    expect(sqlOnly).not.toMatch(/(?:grant|revoke)[^;]*on\s+table\s+public\.audit_logs[^;]*service_role/i);
  });
});
