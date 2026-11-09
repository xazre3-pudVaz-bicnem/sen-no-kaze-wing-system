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
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261104130000_case_sales_organization.sql'), 'utf8');
const sqlOnly = migration
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const sectionOf = (start: string, end: string) => migration.slice(migration.indexOf(start), migration.indexOf(end, migration.indexOf(start)));

describe('案件の営業担当組織：DB の取り決め（migration 20261104130000）', () => {
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

  it('製造担当組織のメンバーには、顧客情報の項目が決まるまで製造・施工の記録だけを見せる（これまでの個人の製造担当は従来どおり）', () => {
    const policy = (name: string) => {
      const start = sqlOnly.indexOf(`create policy ${name} `);
      return sqlOnly.slice(start, sqlOnly.indexOf(');\n\n', start));
    };
    expect(policy('case_notes_read')).toMatch(/kind = 'tech_review' or public\.is_case_legacy_manufacturer\(quote_request_id\)/);
    expect(policy('case_files_read')).toMatch(/context = 'progress' or public\.is_case_legacy_manufacturer\(quote_request_id\)/);
    expect(policy('site_surveys_read')).not.toContain("'manufacturer'");
    expect(policy('site_surveys_read')).toContain('public.is_case_legacy_manufacturer(quote_request_id)');
    const siteProfile = sectionOf(
      'create or replace function public.configuration_site_profile_access',
      'do $case_plan_manager$'
    );
    expect(siteProfile).toContain("public.case_access(r.id) = 'staff' or public.is_case_legacy_manufacturer(r.id)");
    expect(siteProfile).not.toContain("'manufacturer'");
    const legacy = sectionOf('create function public.is_case_legacy_manufacturer', '-- ---------- 読み取りの権限');
    expect(legacy).toContain('w.manufacturing_organization_id is null');
    expect(legacy).toContain('w.manufacturer_id = auth.uid()');
  });

  it('案件のプランボードの読み取りは作り直さず、担当の判定だけを差し込む（v2.5 の S2b の明細の位置・位置の枠を消さない）', () => {
    expect(migration).not.toContain('create or replace function public.get_case_plan_configuration');
    const block = sectionOf('do $case_plan_manager$', '$case_plan_manager$;');
    expect(block).toContain("v_old constant text := 'if not (v_rank >= 3 or (v_rank >= 1 and coalesce(v_quote.dealer_id = v_uid, false))) then';");
    expect(block).toContain('or (v_rank >= 1 and coalesce(v_quote.dealer_id = v_uid, false))');
    expect(block).toContain('or (v_quote.quote_request_id is not null and public.is_case_sales_manager(v_quote.quote_request_id))');
    expect(block).toContain("pg_catalog.strpos(v_def, '''position_slots''') = 0");
  });

  it('見積は営業担当組織の管理者も読める（直属の総代理店には、顧客情報を含む見積を開かない）', () => {
    // quotes.quote_request_id は NOT NULL のため、NULL の確かめは要らない
    expect(migration).toContain('  or public.is_case_sales_manager(quote_request_id)\n);');
    expect(migration).toContain('         or public.is_case_sales_manager(q.quote_request_id)\n');
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

  it('お客様はこの migration では営業担当組織を決められない（ご依頼の希望の関数は作り直さず、組織の列も足さない）', () => {
    expect(sqlOnly).not.toContain('function public.set_quote_request_preferences');
    expect(sqlOnly).not.toContain('preferred_organization_id');
  });

  it('所属を外れたメンバーが主担当者の案件は、主担当者と見積の担当を外し、管理者へ知らせる（組織の停止では外さない）', () => {
    const fn = sectionOf('create function public.release_cases_of_departed_member()', 'create trigger organization_memberships_release_cases');
    expect(fn).toContain("if old.status = 'active' and new.status is distinct from 'active' then");
    expect(fn).toContain('w.sales_organization_id = new.organization_id');
    expect(fn).toContain('w.primary_staff_id = new.profile_id');
    expect(fn).toContain('perform public.apply_case_main_staff(v_request, null, auth.uid());');
    expect(fn).toContain("'case_primary_released'");
    expect(migration).toContain('after update of status on public.organization_memberships');
    expect(migration).toContain('revoke all on function public.release_cases_of_departed_member() from public, anon, authenticated, service_role;');
  });

  it('製造依頼を送った後は、製造担当が変わる営業担当組織の変更をしない。これまでの案件に製造担当組織は付けない', () => {
    const sales = sectionOf('create function public.set_case_sales_organization', 'create function public.set_case_manufacturing_organization');
    expect(sales.indexOf("o.status not in ('draft', 'canceled')")).toBeGreaterThan(sales.indexOf('v_mfg := case'));
    expect(sales.indexOf("o.status not in ('draft', 'canceled')")).toBeLessThan(sales.indexOf('update public.case_workflows cw'));
    const manufacturing = sectionOf('create function public.set_case_manufacturing_organization', '-- ---------- 主担当者');
    expect(manufacturing).toContain('if w.sales_organization_id is null then');
  });

  it('製造担当の初期値は有効な総代理店だけ（停止中の総代理店は未定にする）', () => {
    const fn = sectionOf('create function public.default_manufacturing_organization', '-- 組織の有効な管理者へ通知する');
    expect(fn).toContain("m.organization_type = 'master_dealer'");
    expect(fn).toContain("m.status = 'active'");
  });

  it('主担当者を決めるときは、案件の受付・担当の行をロックしてから判定する', () => {
    const fn = sectionOf('create or replace function public.assign_case_primary_staff', '-- ---------- 受付');
    const lock = fn.indexOf('select * into w from public.case_workflows cw where cw.quote_request_id = p_request_id for update;');
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(fn.indexOf('public.is_case_sales_manager(p_request_id)'));
    expect(fn).toContain("raise exception 'LOCKED: 案件の営業担当組織が決まりました。");
  });

  it('一覧の関数は、管理者として見られる案件をまとめて 1 回だけ求める（行ごとに判定の関数を呼ばない）', () => {
    const list = sectionOf('CREATE OR REPLACE FUNCTION public.list_dealer_quote_request_meta()', '$function$;');
    expect(list).toContain('r.id in (select public.my_sales_managed_request_ids())');
    for (const name of ['list_accessible_customers', 'get_accessible_customer_detail']) {
      const fn = sectionOf(`CREATE OR REPLACE FUNCTION public.${name}(`, '$function$;');
      expect(fn).toContain('v_managed := array(select public.my_sales_managed_request_ids());');
      expect(fn).not.toContain('is_case_sales_manager');
    }
    expect(migration).toContain('revoke all on function public.my_sales_managed_request_ids() from public, anon, authenticated, service_role;');
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

  it('製造担当の初期値は、代理店なら直属の総代理店、総代理店なら自身（停止中の総代理店は未定）', () => {
    expect(defaultManufacturingOrganization(db, 'd')).toBe('md');
    expect(defaultManufacturingOrganization(db, 'md')).toBe('md');
    expect(defaultManufacturingOrganization(db, null)).toBeNull();
    const stoppedParent = {
      ...db,
      organizations: {
        ...db.organizations!,
        organizations: [org('md', 'master_dealer', null, 'inactive'), org('d', 'dealer', 'md')],
      },
    } as LocalDb;
    expect(defaultManufacturingOrganization(stoppedParent, 'd')).toBeNull();
  });
});
