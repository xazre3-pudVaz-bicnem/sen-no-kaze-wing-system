/**
 * 代理店・総代理店の組織とアカウント（2026-10-15 先方確定・migration 20261104120000）。
 *
 * - 1 代理店＝1 組織、担当者ごとの個別アカウント。代理店には直属の総代理店がある
 * - 代理店・総代理店とも、本部が組織と最初の管理者を登録し、その後の担当者はその組織の管理者が追加する（管理者は複数可）
 * - 役割は「管理者」（admin。従来の owner も管理者）と「担当者」（editor）
 * - 有効な所属は 1 人 1 つ。所属すると利用者の種類は dealer／master_dealer になり、外れると customer に戻る
 * - 組織を停止すると、メンバーは会員と同じ扱い（所属は残し、再開で戻す）。未使用の招待は取り消す
 * - 所属している人の利用者の種類は、本部の会員一覧から変えられない（組織の画面で所属を外す）
 */

export type OrganizationType = 'headquarters' | 'master_dealer' | 'dealer';
export type OrganizationStatus = 'active' | 'inactive';
export type MemberRole = 'owner' | 'admin' | 'editor' | 'viewer';
/** 招待・役割の変更で選べる役割 */
export type AssignableMemberRole = 'admin' | 'editor';
export type InvitationState = 'open' | 'accepted' | 'revoked' | 'expired' | 'organization_inactive';

export const INVITATION_DAYS = 7;
/** 招待の鍵（64 桁の 16 進数）。DB にはハッシュだけを残す */
export const INVITATION_TOKEN = /^[0-9a-f]{64}$/;
/**
 * 招待のリンク（/invite/鍵）を開いたら、鍵をこの Cookie に移して /invite へ進める。
 * 鍵をログインの next・ブラウザーの履歴に残さない。/invite にだけ送り、JavaScript からは読めない
 */
export const INVITATION_COOKIE = 'wing_invitation';
/** Cookie を持っておく時間（会員登録・ログインの間。招待そのものの期限は INVITATION_DAYS） */
export const INVITATION_COOKIE_MAX_AGE = 60 * 60 * 24;
/** 所属している人の利用者の種類を、本部の会員一覧から変えようとしたとき（DB のトリガーと同じ文言） */
export const ORGANIZATION_ROLE_LOCKED_MESSAGE =
  '代理店・総代理店に所属している方の権限は変えられません。組織の画面で所属を外してから変えてください（所属を外すと会員に戻ります）';
/** 本部の会員一覧から総代理店にしようとしたとき。総代理店のアカウントは組織の登録と招待で作る（2026-10-15 先方確定） */
export const MASTER_DEALER_VIA_ORGANIZATION_MESSAGE =
  '総代理店のアカウントは、組織（総代理店）を登録して招待で作ります。会員一覧からは総代理店にできません';
/** 招待の送りすぎの上限（DB の invite_organization_member と同じ。取り消した招待も数える） */
export const INVITATION_LIMITS = {
  /** 同じ組織から同じメールアドレスへ、24 時間に（本部も同じ） */
  perEmail: 3,
  /** 1 つの組織から、24 時間に（本部は数えない） */
  perOrganization: 20,
} as const;

export const ORGANIZATION_TYPE_LABEL: Record<OrganizationType, string> = {
  headquarters: '本部',
  master_dealer: '総代理店',
  dealer: '代理店',
};

export const ORGANIZATION_STATUS_LABEL: Record<OrganizationStatus, string> = {
  active: '有効',
  inactive: '停止中',
};

export const ASSIGNABLE_MEMBER_ROLES: AssignableMemberRole[] = ['admin', 'editor'];

export const INVITATION_STATE_LABEL: Record<InvitationState, string> = {
  open: '未使用',
  accepted: '参加済み',
  revoked: '取り消し',
  expired: '期限切れ',
  organization_inactive: '組織が停止中',
};

export function isManagerRole(role: MemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export function memberRoleLabel(role: MemberRole): string {
  if (isManagerRole(role)) return '管理者';
  return role === 'editor' ? '担当者' : '閲覧のみ';
}

export interface OrganizationSummary {
  id: string;
  code: string;
  name: string;
  organization_type: OrganizationType;
  status: OrganizationStatus;
  parent_organization_id: string | null;
  parent_name: string | null;
  active_members: number;
  active_managers: number;
  open_invitations: number;
  created_at: string;
}

/** 組織の詳細画面の見出し（本部と、その組織のメンバーが見る） */
export interface OrganizationDetail {
  id: string;
  code: string;
  name: string;
  organization_type: OrganizationType;
  status: OrganizationStatus;
  parent_organization_id: string | null;
  parent_name: string | null;
}

export interface MyOrganization {
  organization_id: string;
  code: string;
  name: string;
  organization_type: OrganizationType;
  status: OrganizationStatus;
  parent_organization_id: string | null;
  parent_name: string | null;
  membership_id: string;
  member_role: MemberRole;
}

export interface OrganizationMember {
  membership_id: string;
  profile_id: string;
  full_name: string;
  /** 本部とその組織の管理者にだけ返る。担当者には null */
  email: string | null;
  member_role: MemberRole;
  status: OrganizationStatus;
  joined_at: string;
  updated_at: string;
}

export interface OrganizationInvitation {
  invitation_id: string;
  email: string;
  member_role: AssignableMemberRole;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

/** 招待のリンクを開いた人に見せる内容（メールアドレスは伏せる） */
export interface InvitationPreview {
  organization_name: string;
  organization_type: OrganizationType;
  member_role: AssignableMemberRole;
  email_hint: string;
  expires_at: string;
  state: InvitationState;
}

export interface OrganizationInput {
  organization_type: Exclude<OrganizationType, 'headquarters'>;
  name: string;
  parent_organization_id: string | null;
}

export interface OrganizationUpdateInput {
  name: string;
  parent_organization_id: string | null;
  status: OrganizationStatus;
}

export interface IssuedInvitation {
  invitation_id: string;
  token: string;
  expires_at: string;
}

export function invitationState(
  invitation: Pick<OrganizationInvitation, 'accepted_at' | 'revoked_at' | 'expires_at'>,
  now: Date = new Date()
): Exclude<InvitationState, 'organization_inactive'> {
  if (invitation.revoked_at) return 'revoked';
  if (invitation.accepted_at) return 'accepted';
  if (new Date(invitation.expires_at).getTime() < now.getTime()) return 'expired';
  return 'open';
}

/** 招待のメールアドレスを伏せる（例：t…@example.com） */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${(local ?? '').slice(0, 1)}…@${domain ?? ''}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length >= 3 && email.length <= 254 && /^[^@\s]+@[^@\s]+$/.test(email);
}
