import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LocalDb } from '@/lib/data/local-db';
import {
  defaultManufacturingOrganization,
  isActiveOrganizationMember,
  isCaseSalesManager,
  isCaseSupervisor,
  organizationManagers,
} from '@/lib/data/organizations/local-relations';
import { ANON_DEFINER_ALLOWLIST } from '../scripts/db-rehearsal/checks.mjs';

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261015130000_case_sales_organization.sql'), 'utf8');
const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const sectionOf = (start: string, end: string) => migration.slice(migration.indexOf(start), migration.indexOf(end, migration.indexOf(start)));

describe('案件の営業担当組織：DB の取り決め（migration 20261015130000）', () => {
  it('組織の案件では、主担当者（営業担当組織の有効なメンバー）だけが担当。これまでの案件は現在の見積の担当', () => {
    const access = sectionOf('create or replace function public.case_access(p_request_id uuid)', 'comment on function public.case_access(uuid)');
    expect(access).toContain('if w.sales_organization_id is not null then');
    expect(access).toContain('w.primary_staff_id = v_uid and public.is_active_organization_member(w.sales_organization_id, v_uid)');
    expect(access).toContain('elsif v_rank >= 1 and exists (');
    expect(access).toContain('public.is_active_organization_member(w.manufacturing_organization_id, v_uid)');
  });

  it('読み取りは case_role（管理者 manager・直属の総代理店の管理者 supervisor）で判定し、案件の表はすべて case_role を使う', () => {
    expect(migration).toContain('create function public.case_role(p_request_id uuid)');
    const policyCount = (sqlOnly.match(/create policy [a-z_]+_read on public\.[a-z_]+\nfor select to authenticated\nusing \(\n?\s*public\.case_role/g) ?? []).length;
    expect(policyCount).toBeGreaterThanOrEqual(15);
    expect(migration).toContain("public.case_role(quote_request_id) in ('admin', 'staff', 'manager', 'manufacturer')");
    // 総代理店の配下の閲覧（supervisor）は、まだどの表にも開いていない
    expect(sqlOnly).not.toMatch(/'supervisor'\)/);
  });

  it('見積は営業担当組織の管理者も読める（直属の総代理店には、顧客情報を含む見積を開かない）', () => {
    expect(migration).toContain('or (quote_request_id is not null and public.is_case_sales_manager(quote_request_id))');
    expect(migration).toContain('or (q.quote_request_id is not null and public.is_case_sales_manager(q.quote_request_id))');
    const quotesPolicy = sqlOnly.slice(sqlOnly.indexOf('create policy quotes_select'), sqlOnly.indexOf(');', sqlOnly.indexOf('create policy quotes_select')));
    const itemsPolicy = sqlOnly.slice(sqlOnly.indexOf('create policy quote_items_select'), sqlOnly.indexOf(');\n\n', sqlOnly.indexOf('create policy quote_items_select')));
    expect(quotesPolicy).toContain('is_case_sales_manager');
    expect(quotesPolicy).not.toContain('is_case_supervisor');
    expect(itemsPolicy).not.toContain('is_case_supervisor');
  });

  it('主担当者を決めると、案件の見積の担当をそろえ、見積ごとの通知は止めて 1 回だけ知らせる', () => {
    const apply = sectionOf('create function public.apply_case_main_staff', 'create function public.write_case_audit');
    expect(apply).toContain("set_config('wing.suppress_quote_assign_notify', 'on', true)");
    expect(apply).toContain('where q.quote_request_id = p_request_id');
    expect(migration).toContain("coalesce(current_setting('wing.suppress_quote_assign_notify', true), '') <> 'on'");
  });

  it('営業担当組織・製造担当を変えられるのは本部だけ。製造担当は総代理店だけで、製造依頼を送った後は変えない', () => {
    expect(migration).toContain("message = 'FORBIDDEN: 営業担当組織を決められるのは本部だけです'");
    expect(migration).toContain("message = 'FORBIDDEN: 製造担当を変えられるのは本部だけです'");
    expect(migration).toContain("message = 'VALIDATION: 製造担当は総代理店から選んでください'");
    expect(migration).toContain('製造依頼を送った後は製造担当を変えられません');
  });

  it('受付の判定は、担当でない人の NULL で拒否をすり抜けない', () => {
    expect(migration).toContain("if not (coalesce(v_access in ('admin', 'staff'), false) or public.is_case_sales_manager(p_request_id)) then");
  });

  it('営業担当組織が決まっている案件には、これまでの個人単位の割り当てを使わせない', () => {
    expect(migration).toContain('営業担当組織が決まっている案件は、組織の管理者（または本部）が主担当者を決めます');
    expect(migration).toContain('営業担当組織が決まっている案件の製造担当は、総代理店の組織から選んでください');
  });

  it('送った製造依頼は、製造の担当（利用者）か製造担当組織のどちらかが決まっていればよい', () => {
    expect(migration).toContain('(manufacturer_id is not null or manufacturing_organization_id is not null)');
  });

  it('内部の関数は利用者から呼べず、未ログインで呼べるのは見積の RLS で使う判定だけ', () => {
    expect(migration).toContain('revoke all on function public.apply_case_main_staff(uuid, uuid, uuid) from public, anon, authenticated, service_role;');
    expect(migration).toContain('grant execute on function public.is_case_sales_manager(uuid) to anon, authenticated;');
    expect(migration).toContain('grant execute on function public.case_role(uuid) to authenticated;');
    expect(ANON_DEFINER_ALLOWLIST).toContain('is_case_sales_manager');
  });
});

describe('案件の営業担当組織：ローカル検証モードの関係の判定', () => {
  const now = '2026-10-15T00:00:00.000Z';
  const org = (id: string, organization_type: 'master_dealer' | 'dealer', parent: string | null = null, status: 'active' | 'inactive' = 'active') => ({
    id, code: id, name: id, organization_type, status, parent_organization_id: parent, created_at: now, updated_at: now,
  });
  const member = (organization_id: string, profile_id: string, member_role: 'admin' | 'editor', status: 'active' | 'inactive' = 'active') => ({
    id: `${organization_id}-${profile_id}`, organization_id, profile_id, member_role, status, is_primary: true, created_at: now, updated_at: now,
  });
  const db = {
    organizations: {
      organizations: [org('md', 'master_dealer'), org('d', 'dealer', 'md'), org('stopped', 'dealer', 'md', 'inactive')],
      memberships: [member('d', 'mgr', 'admin'), member('d', 'staff', 'editor'), member('md', 'md-mgr', 'admin'), member('stopped', 'x', 'admin')],
      invitations: [],
      codeSequence: 2,
    },
    caseFlow: { workflows: [{ quote_request_id: 'r1', sales_organization_id: 'd', manufacturing_organization_id: 'md' }] },
  } as unknown as LocalDb;

  it('管理者は営業担当組織の管理者、担当者は管理者ではない。直属の総代理店の管理者は配下の確認', () => {
    expect(isCaseSalesManager(db, 'r1', 'mgr')).toBe(true);
    expect(isCaseSalesManager(db, 'r1', 'staff')).toBe(false);
    expect(isCaseSupervisor(db, 'r1', 'md-mgr')).toBe(true);
    expect(isCaseSupervisor(db, 'r1', 'mgr')).toBe(false);
  });

  it('停止中の組織のメンバーは有効なメンバーとして扱わない', () => {
    expect(isActiveOrganizationMember(db, 'd', 'staff')).toBe(true);
    expect(isActiveOrganizationMember(db, 'stopped', 'x')).toBe(false);
    expect(organizationManagers(db, 'stopped')).toEqual([]);
  });

  it('製造担当の初期値は、代理店なら直属の総代理店、総代理店なら自身', () => {
    expect(defaultManufacturingOrganization(db, 'd')).toBe('md');
    expect(defaultManufacturingOrganization(db, 'md')).toBe('md');
    expect(defaultManufacturingOrganization(db, null)).toBeNull();
  });
});
