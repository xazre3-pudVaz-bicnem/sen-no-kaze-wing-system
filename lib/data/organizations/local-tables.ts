import type { AssignableMemberRole, MemberRole, OrganizationStatus, OrganizationType } from '@/lib/domain/organizations';

/** ローカル検証モードの JSON DB（.wing-local/db.json）の organizations。DB の 20261111110000 に対応する */
export interface LocalOrganizationTables {
  organizations: LocalOrganization[];
  memberships: LocalMembership[];
  invitations: LocalInvitation[];
  /** 組織コード（MD-0001／D-0001）の採番 */
  codeSequence: number;
}

export interface LocalOrganization {
  id: string;
  code: string;
  name: string;
  organization_type: OrganizationType;
  status: OrganizationStatus;
  parent_organization_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalMembership {
  id: string;
  organization_id: string;
  profile_id: string;
  member_role: MemberRole;
  status: OrganizationStatus;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * 所属から決まる利用者の種類（DB のトリガー enforce_profile_role_matches_organization と同じ決まり）。
 * 代理店・総代理店に有効な所属があれば組織の種類（組織が停止中なら customer）、所属が無ければ null（決まりなし）
 */
export function organizationRoleCodeFor(
  tables: LocalOrganizationTables | undefined,
  profileId: string
): 'dealer' | 'master_dealer' | 'customer' | null {
  for (const membership of tables?.memberships ?? []) {
    if (membership.profile_id !== profileId || membership.status !== 'active') continue;
    const org = tables?.organizations.find((o) => o.id === membership.organization_id);
    if (!org || org.organization_type === 'headquarters') continue;
    if (org.status !== 'active') return 'customer';
    return org.organization_type === 'master_dealer' ? 'master_dealer' : 'dealer';
  }
  return null;
}

export interface LocalInvitation {
  id: string;
  organization_id: string;
  email: string;
  member_role: AssignableMemberRole;
  /** 鍵の SHA-256（鍵そのものは残さない） */
  token_hash: string;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}
