import 'server-only';
import type { LocalDb } from '@/lib/data/local-db';
import { isManagerRole } from '@/lib/domain/organizations';

/**
 * ローカル検証モードで、組織と案件の関係を調べる（DB の is_active_organization_member／is_case_sales_manager／
 * is_case_supervisor／default_manufacturing_organization と同じ規則。20261016130000）。
 */

export function isActiveOrganizationMember(db: LocalDb, organizationId: string | null | undefined, profileId: string): boolean {
  if (!organizationId) return false;
  const t = db.organizations;
  if (!t) return false;
  const org = t.organizations.find((o) => o.id === organizationId);
  if (!org || org.status !== 'active') return false;
  return t.memberships.some((m) => m.organization_id === organizationId && m.profile_id === profileId && m.status === 'active');
}

export function isActiveOrganizationManager(db: LocalDb, organizationId: string | null | undefined, profileId: string): boolean {
  if (!organizationId) return false;
  const t = db.organizations;
  if (!t) return false;
  const org = t.organizations.find((o) => o.id === organizationId);
  if (!org || org.status !== 'active') return false;
  return t.memberships.some(
    (m) => m.organization_id === organizationId && m.profile_id === profileId && m.status === 'active' && isManagerRole(m.member_role)
  );
}

export function caseWorkflowOf(db: LocalDb, requestId: string | null | undefined) {
  if (!requestId) return undefined;
  return db.caseFlow?.workflows.find((w) => w.quote_request_id === requestId);
}

/** 自分が案件の営業担当組織（総代理店・代理店）の管理者か */
export function isCaseSalesManager(db: LocalDb, requestId: string | null | undefined, profileId: string): boolean {
  const workflow = caseWorkflowOf(db, requestId);
  if (!workflow?.sales_organization_id) return false;
  const org = db.organizations?.organizations.find((o) => o.id === workflow.sales_organization_id);
  if (!org || org.organization_type === 'headquarters') return false;
  return isActiveOrganizationManager(db, org.id, profileId);
}

/** 自分が、案件の営業担当（代理店）の直属の総代理店の管理者か */
export function isCaseSupervisor(db: LocalDb, requestId: string | null | undefined, profileId: string): boolean {
  const workflow = caseWorkflowOf(db, requestId);
  if (!workflow?.sales_organization_id) return false;
  const sales = db.organizations?.organizations.find((o) => o.id === workflow.sales_organization_id);
  if (!sales || sales.organization_type !== 'dealer' || !sales.parent_organization_id) return false;
  return isActiveOrganizationManager(db, sales.parent_organization_id, profileId);
}

/** 営業担当組織から決まる製造担当（代理店なら直属の総代理店、総代理店なら自身、本部なら未定） */
export function defaultManufacturingOrganization(db: LocalDb, salesOrganizationId: string | null | undefined): string | null {
  if (!salesOrganizationId) return null;
  const org = db.organizations?.organizations.find((o) => o.id === salesOrganizationId);
  if (!org) return null;
  if (org.organization_type === 'dealer') return org.parent_organization_id;
  if (org.organization_type === 'master_dealer') return org.id;
  return null;
}

/**
 * 紹介ページの代理店（利用者）が所属する、お客様が選べる組織（有効で管理者がいる代理店・総代理店）。
 * DB の set_quote_request_preferences と同じ（20261016160000）。所属は 1 人 1 つ
 */
export function selectableOrganizationOfMember(db: LocalDb, profileId: string): string | null {
  const t = db.organizations;
  if (!t) return null;
  for (const membership of t.memberships.filter((m) => m.profile_id === profileId && m.status === 'active')) {
    const org = t.organizations.find((o) => o.id === membership.organization_id);
    if (!org || org.status !== 'active' || org.organization_type === 'headquarters') continue;
    if (organizationManagers(db, org.id).length > 0) return org.id;
  }
  return null;
}

export function organizationManagers(db: LocalDb, organizationId: string): string[] {
  const t = db.organizations;
  if (!t) return [];
  const org = t.organizations.find((o) => o.id === organizationId);
  if (!org || org.status !== 'active') return [];
  return t.memberships
    .filter((m) => m.organization_id === organizationId && m.status === 'active' && isManagerRole(m.member_role))
    .map((m) => m.profile_id);
}
