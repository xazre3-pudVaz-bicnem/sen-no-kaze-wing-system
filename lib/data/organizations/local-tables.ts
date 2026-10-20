import type { AssignableMemberRole, MemberRole, OrganizationStatus, OrganizationType } from '@/lib/domain/organizations';

/** ローカル検証モードの JSON DB（.wing-local/db.json）の organizations。DB の 20261016120000 に対応する */
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
