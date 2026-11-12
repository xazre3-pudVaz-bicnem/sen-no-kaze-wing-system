import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { StoreError, type SessionUser } from '@/lib/data/store';
import { isMissingNamedFunction, isMissingRelation } from '@/lib/data/schema-compat';
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
import { INVITATION_TOKEN } from '@/lib/domain/organizations';
import type { OrganizationStore } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public', any>;

/** DB のエラーを画面向けの StoreError にする。RPC の文言（VALIDATION:／CONFLICT:／FORBIDDEN: など）はそのまま見せる */
function fail(e: { code?: string; message?: string } | null): never {
  const msg = e?.message ?? '不明なエラー';
  const detail = (prefix: RegExp, fallback: string) => {
    const text = msg.replace(prefix, '').trim();
    return text && text !== msg ? text : fallback;
  };
  if (msg.startsWith('VALIDATION:')) throw new StoreError('VALIDATION', detail(/^VALIDATION:\s*/, '入力を確かめてください'));
  if (msg.startsWith('CONFLICT:')) throw new StoreError('VALIDATION', detail(/^CONFLICT:\s*/, 'すでに登録されています'));
  if (msg.startsWith('UNAUTHENTICATED') || (e?.code === '42501' && msg.startsWith('UNAUTHENTICATED'))) {
    throw new StoreError('UNAUTHENTICATED', 'ログインが必要です');
  }
  if (msg.startsWith('FORBIDDEN') || e?.code === '42501') throw new StoreError('FORBIDDEN', detail(/^FORBIDDEN:?\s*/, '権限がありません'));
  if (msg.startsWith('NOT_FOUND') || e?.code === 'P0002') throw new StoreError('NOT_FOUND', detail(/^NOT_FOUND:\s*/, 'データが見つかりません'));
  if (e?.code === '23505') throw new StoreError('VALIDATION', 'ほかの組織に所属しているか、同じ内容がすでにあります');
  throw new StoreError('INTERNAL', msg);
}

/** migration 未適用の DB では、組織の機能はまだ使えない */
function notReady(error: { code?: string; message?: string }, fn: string): boolean {
  return isMissingRelation(error) || isMissingNamedFunction(error, fn);
}

export class SupabaseOrganizationStore implements OrganizationStore {
  private async db(): Promise<Db> {
    return (await createClient()) as unknown as Db;
  }

  private async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const db = await this.db();
    const { data, error } = await db.rpc(name, args);
    if (error) {
      if (notReady(error, name)) throw new StoreError('VALIDATION', '組織の機能は DB の反映待ちです。反映後にもう一度お試しください');
      fail(error);
    }
    return data as T;
  }

  async listOrganizations(_actor: SessionUser): Promise<OrganizationSummary[]> {
    const db = await this.db();
    const { data, error } = await db.rpc('list_organizations_for_admin');
    if (error) {
      if (notReady(error, 'list_organizations_for_admin')) return [];
      fail(error);
    }
    return ((data ?? []) as OrganizationSummary[]).map((row) => ({
      ...row,
      active_members: Number(row.active_members),
      active_managers: Number(row.active_managers),
      open_invitations: Number(row.open_invitations),
    }));
  }

  async getOrganization(actor: SessionUser, organizationId: string): Promise<OrganizationDetail | null> {
    if (actor.role !== 'admin') {
      const mine = await this.getMyOrganization(actor);
      if (!mine || mine.organization_id !== organizationId) return null;
    }
    const db = await this.db();
    const { data, error } = await db
      .from('organizations')
      .select('id, code, name, organization_type, status, parent_organization_id')
      .eq('id', organizationId)
      .maybeSingle();
    if (error) {
      if (isMissingRelation(error)) return null;
      fail(error);
    }
    if (!data) return null;
    const row = data as Omit<OrganizationDetail, 'parent_name'>;
    let parentName: string | null = null;
    if (row.parent_organization_id) {
      const parent = await db.from('organizations').select('name').eq('id', row.parent_organization_id).maybeSingle();
      parentName = (parent.data as { name?: string } | null)?.name ?? null;
    }
    return { ...row, parent_name: parentName };
  }

  async createOrganization(_actor: SessionUser, input: OrganizationInput): Promise<string> {
    return this.rpc<string>('create_organization', {
      p_organization_type: input.organization_type,
      p_name: input.name,
      p_parent_organization_id: input.parent_organization_id,
    });
  }

  async updateOrganization(_actor: SessionUser, organizationId: string, input: OrganizationUpdateInput): Promise<void> {
    await this.rpc('update_organization', {
      p_organization_id: organizationId,
      p_name: input.name,
      p_parent_organization_id: input.parent_organization_id,
      p_status: input.status,
    });
  }

  async getMyOrganization(_actor: SessionUser): Promise<MyOrganization | null> {
    const db = await this.db();
    const { data, error } = await db.rpc('get_my_organization');
    if (error) {
      if (notReady(error, 'get_my_organization')) return null;
      fail(error);
    }
    const rows = (data ?? []) as MyOrganization[];
    return rows[0] ?? null;
  }

  async listMembers(_actor: SessionUser, organizationId: string): Promise<OrganizationMember[]> {
    return (await this.rpc<OrganizationMember[] | null>('list_organization_members', { p_organization_id: organizationId })) ?? [];
  }

  async setMemberRole(_actor: SessionUser, membershipId: string, role: AssignableMemberRole): Promise<void> {
    await this.rpc('set_organization_member_role', { p_membership_id: membershipId, p_member_role: role });
  }

  async deactivateMember(_actor: SessionUser, membershipId: string): Promise<void> {
    await this.rpc('deactivate_organization_member', { p_membership_id: membershipId });
  }

  async listInvitations(_actor: SessionUser, organizationId: string): Promise<OrganizationInvitation[]> {
    return (await this.rpc<OrganizationInvitation[] | null>('list_organization_invitations', { p_organization_id: organizationId })) ?? [];
  }

  async inviteMember(_actor: SessionUser, organizationId: string, email: string, role: AssignableMemberRole): Promise<IssuedInvitation> {
    const rows = await this.rpc<IssuedInvitation[] | null>('invite_organization_member', {
      p_organization_id: organizationId,
      p_email: email,
      p_member_role: role,
    });
    const row = rows?.[0];
    if (!row || !INVITATION_TOKEN.test(row.token)) throw new StoreError('INTERNAL', '招待を発行できませんでした');
    return row;
  }

  async revokeInvitation(_actor: SessionUser, invitationId: string): Promise<void> {
    await this.rpc('revoke_organization_invitation', { p_invitation_id: invitationId });
  }

  async previewInvitation(_actor: SessionUser, token: string): Promise<InvitationPreview | null> {
    if (!INVITATION_TOKEN.test(token)) return null;
    const rows = await this.rpc<InvitationPreview[] | null>('get_organization_invitation', { p_token: token });
    return rows?.[0] ?? null;
  }

  async acceptInvitation(_actor: SessionUser, token: string): Promise<string> {
    if (!INVITATION_TOKEN.test(token)) throw new StoreError('VALIDATION', '招待のリンクが正しくありません');
    return this.rpc<string>('accept_organization_invitation', { p_token: token });
  }
}
