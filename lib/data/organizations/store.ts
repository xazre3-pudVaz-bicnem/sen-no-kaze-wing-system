import 'server-only';
import type { SessionUser } from '@/lib/data/store';
import { isLocalMode } from '@/lib/data/store';
import type {
  AssignableMemberRole,
  InvitationPreview,
  IssuedInvitation,
  MyOrganization,
  OrganizationDetail,
  OrganizationInput,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationSummary,
  OrganizationUpdateInput,
} from '@/lib/domain/organizations';

/**
 * 代理店・総代理店の組織とアカウント（migration 20261016120000）。
 * 権限の正本は DB の RPC（本部・その組織の管理者の判定、管理者が 0 人にならない、招待はメールアドレスが一致する本人だけ）。
 * ローカル検証モードは同じ規則を lib/data/organizations/local.ts で再現する。
 */
export interface OrganizationStore {
  /** 本部だけ */
  listOrganizations(actor: SessionUser): Promise<OrganizationSummary[]>;
  /** 本部と、その組織のメンバー。見られないときは null */
  getOrganization(actor: SessionUser, organizationId: string): Promise<OrganizationDetail | null>;
  createOrganization(actor: SessionUser, input: OrganizationInput): Promise<string>;
  updateOrganization(actor: SessionUser, organizationId: string, input: OrganizationUpdateInput): Promise<void>;

  getMyOrganization(actor: SessionUser): Promise<MyOrganization | null>;
  listMembers(actor: SessionUser, organizationId: string): Promise<OrganizationMember[]>;
  setMemberRole(actor: SessionUser, membershipId: string, role: AssignableMemberRole): Promise<void>;
  deactivateMember(actor: SessionUser, membershipId: string): Promise<void>;

  listInvitations(actor: SessionUser, organizationId: string): Promise<OrganizationInvitation[]>;
  inviteMember(actor: SessionUser, organizationId: string, email: string, role: AssignableMemberRole): Promise<IssuedInvitation>;
  revokeInvitation(actor: SessionUser, invitationId: string): Promise<void>;
  previewInvitation(actor: SessionUser, token: string): Promise<InvitationPreview | null>;
  acceptInvitation(actor: SessionUser, token: string): Promise<string>;
}

let cached: OrganizationStore | null = null;

export async function getOrganizationStore(): Promise<OrganizationStore> {
  if (cached) return cached;
  if (isLocalMode()) {
    const { LocalOrganizationStore } = await import('./local');
    cached = new LocalOrganizationStore();
  } else {
    const { SupabaseOrganizationStore } = await import('./supabase');
    cached = new SupabaseOrganizationStore();
  }
  return cached;
}
