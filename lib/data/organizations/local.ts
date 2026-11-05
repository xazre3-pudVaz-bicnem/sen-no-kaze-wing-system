import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { StoreError, type SessionUser } from '@/lib/data/store';
import { loadDb, saveDb, type LocalDb } from '@/lib/data/local-db';
import type { RoleCode } from '@/lib/domain/types';
import {
  INVITATION_DAYS,
  INVITATION_TOKEN,
  isManagerRole,
  isValidEmail,
  maskEmail,
  normalizeEmail,
  type AssignableMemberRole,
  type InvitationPreview,
  type IssuedInvitation,
  type MyOrganization,
  type OrganizationDetail,
  type OrganizationInput,
  type OrganizationInvitation,
  type OrganizationMember,
  type OrganizationSummary,
  type OrganizationUpdateInput,
} from '@/lib/domain/organizations';
import type { LocalInvitation, LocalMembership, LocalOrganization, LocalOrganizationTables } from './local-tables';
import type { OrganizationStore } from './store';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const now = () => new Date().toISOString();

function tables(db: LocalDb): LocalOrganizationTables {
  db.organizations ??= { organizations: [], memberships: [], invitations: [], codeSequence: 0 };
  return db.organizations;
}

function roleCodeOf(db: LocalDb, profileId: string): RoleCode | null {
  return db.profiles.find((p) => p.id === profileId)?.role_code ?? null;
}

function isAdmin(db: LocalDb, actor: SessionUser): boolean {
  return roleCodeOf(db, actor.id) === 'admin';
}

function isManager(db: LocalDb, actor: SessionUser, organizationId: string): boolean {
  const t = tables(db);
  const org = t.organizations.find((o) => o.id === organizationId);
  if (!org || org.status !== 'active') return false;
  return t.memberships.some(
    (m) => m.organization_id === organizationId && m.profile_id === actor.id && m.status === 'active' && isManagerRole(m.member_role)
  );
}

function activeManagers(t: LocalOrganizationTables, organizationId: string): LocalMembership[] {
  return t.memberships.filter((m) => m.organization_id === organizationId && m.status === 'active' && isManagerRole(m.member_role));
}

function audit(db: LocalDb, actor: SessionUser, action: string, organizationId: string, summary: string) {
  db.auditLogs.push({
    id: randomUUID(),
    actor_id: actor.id,
    actor_email: actor.email,
    action,
    entity: 'organization',
    entity_id: organizationId,
    summary,
    created_at: now(),
  });
}

function requireActor(actor: SessionUser | null | undefined): asserts actor is SessionUser {
  if (!actor?.id) throw new StoreError('UNAUTHENTICATED', 'ログインが必要です');
}

function validateName(name: string): string {
  const value = name.trim();
  if (value.length < 1 || value.length > 100) throw new StoreError('VALIDATION', '組織名は 1〜100 文字で入力してください');
  return value;
}

function validateParent(t: LocalOrganizationTables, parentId: string | null, mustBeActive: boolean) {
  if (!parentId) return;
  const parent = t.organizations.find((o) => o.id === parentId);
  if (!parent || parent.organization_type !== 'master_dealer' || (mustBeActive && parent.status !== 'active')) {
    throw new StoreError('VALIDATION', '直属の総代理店が見つかりません（停止中の総代理店は選べません）');
  }
}

const roleLabel = (role: AssignableMemberRole) => (role === 'admin' ? '管理者' : '担当者');

export class LocalOrganizationStore implements OrganizationStore {
  async listOrganizations(actor: SessionUser): Promise<OrganizationSummary[]> {
    const db = loadDb();
    if (!isAdmin(db, actor)) throw new StoreError('FORBIDDEN', '組織の一覧は本部だけが見られます');
    const t = tables(db);
    const typeOrder = { headquarters: 0, master_dealer: 1, dealer: 2 } as const;
    const nameOf = (id: string | null) => (id ? t.organizations.find((o) => o.id === id)?.name ?? null : null);
    return t.organizations
      .map((o) => ({
        id: o.id,
        code: o.code,
        name: o.name,
        organization_type: o.organization_type,
        status: o.status,
        parent_organization_id: o.parent_organization_id,
        parent_name: nameOf(o.parent_organization_id),
        active_members: t.memberships.filter((m) => m.organization_id === o.id && m.status === 'active').length,
        active_managers: activeManagers(t, o.id).length,
        open_invitations: t.invitations.filter(
          (i) => i.organization_id === o.id && !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date()
        ).length,
        created_at: o.created_at,
      }))
      .sort(
        (a, b) =>
          typeOrder[a.organization_type] - typeOrder[b.organization_type] ||
          (a.parent_name ?? a.name).localeCompare(b.parent_name ?? b.name, 'ja') ||
          a.name.localeCompare(b.name, 'ja')
      );
  }

  async getOrganization(actor: SessionUser, organizationId: string): Promise<OrganizationDetail | null> {
    const db = loadDb();
    const t = tables(db);
    const org = t.organizations.find((o) => o.id === organizationId);
    if (!org) return null;
    const member = t.memberships.some((m) => m.organization_id === org.id && m.profile_id === actor.id && m.status === 'active');
    if (!isAdmin(db, actor) && !member) return null;
    return {
      id: org.id,
      code: org.code,
      name: org.name,
      organization_type: org.organization_type,
      status: org.status,
      parent_organization_id: org.parent_organization_id,
      parent_name: org.parent_organization_id ? t.organizations.find((o) => o.id === org.parent_organization_id)?.name ?? null : null,
    };
  }

  async createOrganization(actor: SessionUser, input: OrganizationInput): Promise<string> {
    requireActor(actor);
    const db = loadDb();
    if (!isAdmin(db, actor)) throw new StoreError('FORBIDDEN', '組織を登録できるのは本部の管理者だけです');
    if (input.organization_type !== 'master_dealer' && input.organization_type !== 'dealer') {
      throw new StoreError('VALIDATION', '組織の種類は「総代理店」か「代理店」を選んでください');
    }
    const name = validateName(input.name);
    const t = tables(db);
    if (input.organization_type === 'master_dealer' && input.parent_organization_id) {
      throw new StoreError('VALIDATION', '総代理店には直属の組織を設定できません');
    }
    validateParent(t, input.parent_organization_id, true);
    let code: string;
    do {
      t.codeSequence += 1;
      code = `${input.organization_type === 'master_dealer' ? 'MD' : 'D'}-${String(t.codeSequence).padStart(4, '0')}`;
    } while (t.organizations.some((o) => o.code === code));
    const org: LocalOrganization = {
      id: randomUUID(),
      code,
      name,
      organization_type: input.organization_type,
      status: 'active',
      parent_organization_id: input.parent_organization_id,
      created_at: now(),
      updated_at: now(),
    };
    t.organizations.push(org);
    audit(db, actor, 'organization_create', org.id, `組織を登録：${name}`);
    saveDb(db);
    return org.id;
  }

  async updateOrganization(actor: SessionUser, organizationId: string, input: OrganizationUpdateInput): Promise<void> {
    requireActor(actor);
    const db = loadDb();
    if (!isAdmin(db, actor)) throw new StoreError('FORBIDDEN', '組織を変更できるのは本部の管理者だけです');
    const t = tables(db);
    const org = t.organizations.find((o) => o.id === organizationId);
    if (!org) throw new StoreError('NOT_FOUND', '組織が見つかりません');
    if (org.organization_type === 'headquarters') throw new StoreError('VALIDATION', '本部の組織はここでは変更できません');
    const name = validateName(input.name);
    if (input.status !== 'active' && input.status !== 'inactive') throw new StoreError('VALIDATION', '状態は「有効」か「停止」を選んでください');
    if (org.organization_type === 'master_dealer' && input.parent_organization_id) {
      throw new StoreError('VALIDATION', '総代理店には直属の組織を設定できません');
    }
    if (input.parent_organization_id === org.id) throw new StoreError('VALIDATION', '自分自身を直属の総代理店にはできません');
    if (input.parent_organization_id !== org.parent_organization_id) validateParent(t, input.parent_organization_id, true);
    if (
      org.organization_type === 'master_dealer' &&
      input.status === 'inactive' &&
      org.status === 'active' &&
      t.organizations.some((c) => c.parent_organization_id === org.id && c.status === 'active')
    ) {
      throw new StoreError('VALIDATION', '有効な配下の代理店がある総代理店は停止できません（先に代理店の直属の総代理店を変えてください）');
    }
    org.name = name;
    org.parent_organization_id = input.parent_organization_id;
    org.status = input.status;
    org.updated_at = now();
    audit(db, actor, 'organization_update', org.id, `組織を変更：${name}`);
    saveDb(db);
  }

  async getMyOrganization(actor: SessionUser): Promise<MyOrganization | null> {
    const db = loadDb();
    const t = tables(db);
    const membership = t.memberships.find((m) => m.profile_id === actor.id && m.status === 'active');
    if (!membership) return null;
    const org = t.organizations.find((o) => o.id === membership.organization_id);
    if (!org) return null;
    return {
      organization_id: org.id,
      code: org.code,
      name: org.name,
      organization_type: org.organization_type,
      status: org.status,
      parent_organization_id: org.parent_organization_id,
      parent_name: org.parent_organization_id ? t.organizations.find((o) => o.id === org.parent_organization_id)?.name ?? null : null,
      membership_id: membership.id,
      member_role: membership.member_role,
    };
  }

  async listMembers(actor: SessionUser, organizationId: string): Promise<OrganizationMember[]> {
    const db = loadDb();
    const t = tables(db);
    const canSeeEmail = isAdmin(db, actor) || isManager(db, actor, organizationId);
    const isMember = t.memberships.some((m) => m.organization_id === organizationId && m.profile_id === actor.id && m.status === 'active');
    if (!canSeeEmail && !isMember) throw new StoreError('FORBIDDEN', 'この組織のメンバーは見られません');
    return t.memberships
      .filter((m) => m.organization_id === organizationId && (canSeeEmail || m.status === 'active'))
      .map((m) => {
        const profile = db.profiles.find((p) => p.id === m.profile_id);
        return {
          membership_id: m.id,
          profile_id: m.profile_id,
          full_name: profile?.full_name ?? '',
          email: canSeeEmail ? profile?.email ?? null : null,
          member_role: m.member_role,
          status: m.status,
          joined_at: m.created_at,
          updated_at: m.updated_at,
        };
      })
      .sort(
        (a, b) =>
          Number(a.status !== 'active') - Number(b.status !== 'active') ||
          Number(!isManagerRole(a.member_role)) - Number(!isManagerRole(b.member_role)) ||
          a.full_name.localeCompare(b.full_name, 'ja')
      );
  }

  /** 管理者が 0 人になる変更を止める（DB はロックで同時実行も防ぐ。ローカルは 1 プロセスで順に処理する） */
  private guardLastManager(t: LocalOrganizationTables, member: LocalMembership, nextRole: AssignableMemberRole | null) {
    const losesManager = isManagerRole(member.member_role) && (nextRole === null || nextRole === 'editor');
    if (losesManager && activeManagers(t, member.organization_id).length <= 1) {
      throw new StoreError(
        'VALIDATION',
        nextRole === null ? '管理者が 1 人もいなくなるため、所属を外せません' : '管理者が 1 人もいなくなるため、この変更はできません'
      );
    }
  }

  private memberForChange(db: LocalDb, actor: SessionUser, membershipId: string, action: string) {
    requireActor(actor);
    const t = tables(db);
    const member = t.memberships.find((m) => m.id === membershipId);
    if (!member) throw new StoreError('NOT_FOUND', 'メンバーが見つかりません');
    const org = t.organizations.find((o) => o.id === member.organization_id);
    if (!org || org.organization_type === 'headquarters') throw new StoreError('VALIDATION', `本部の組織の${action}はここでは変更できません`);
    if (!isAdmin(db, actor) && !isManager(db, actor, org.id)) {
      throw new StoreError('FORBIDDEN', `${action === '役割' ? '役割を変更' : '所属を外せる'}のは、本部とその組織の管理者だけです`);
    }
    return { t, member, org };
  }

  async setMemberRole(actor: SessionUser, membershipId: string, role: AssignableMemberRole): Promise<void> {
    const db = loadDb();
    const { t, member, org } = this.memberForChange(db, actor, membershipId, '役割');
    if (role !== 'admin' && role !== 'editor') throw new StoreError('VALIDATION', '役割は「管理者」か「担当者」を選んでください');
    if (member.status !== 'active') throw new StoreError('VALIDATION', '所属を外れているメンバーの役割は変えられません');
    this.guardLastManager(t, member, role);
    if (member.member_role === role) return;
    member.member_role = role;
    member.updated_at = now();
    audit(db, actor, 'organization_member_role', org.id, `組織のメンバーの役割を変更：${org.name}`);
    saveDb(db);
  }

  async deactivateMember(actor: SessionUser, membershipId: string): Promise<void> {
    const db = loadDb();
    const { t, member, org } = this.memberForChange(db, actor, membershipId, '所属');
    if (member.status !== 'active') throw new StoreError('VALIDATION', 'このメンバーはすでに所属を外れています');
    this.guardLastManager(t, member, null);
    member.status = 'inactive';
    member.is_primary = false;
    member.updated_at = now();
    const profile = db.profiles.find((p) => p.id === member.profile_id);
    if (profile && (profile.role_code === 'dealer' || profile.role_code === 'master_dealer')) {
      profile.role_code = 'customer';
      profile.updated_at = now();
    }
    audit(db, actor, 'organization_member_remove', org.id, `組織のメンバーの所属を外す：${org.name}`);
    saveDb(db);
  }

  async listInvitations(actor: SessionUser, organizationId: string): Promise<OrganizationInvitation[]> {
    const db = loadDb();
    if (!isAdmin(db, actor) && !isManager(db, actor, organizationId)) {
      throw new StoreError('FORBIDDEN', '招待は、本部とその組織の管理者だけが見られます');
    }
    const t = tables(db);
    return t.invitations
      .filter((i) => i.organization_id === organizationId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50)
      .map((i) => ({
        invitation_id: i.id,
        email: i.email,
        member_role: i.member_role,
        invited_by_name: i.invited_by ? db.profiles.find((p) => p.id === i.invited_by)?.full_name ?? null : null,
        created_at: i.created_at,
        expires_at: i.expires_at,
        accepted_at: i.accepted_at,
        revoked_at: i.revoked_at,
      }));
  }

  async inviteMember(actor: SessionUser, organizationId: string, email: string, role: AssignableMemberRole): Promise<IssuedInvitation> {
    requireActor(actor);
    const db = loadDb();
    const t = tables(db);
    const org = t.organizations.find((o) => o.id === organizationId);
    if (!org) throw new StoreError('NOT_FOUND', '組織が見つかりません');
    if (!isAdmin(db, actor) && !isManager(db, actor, org.id)) {
      throw new StoreError('FORBIDDEN', '招待できるのは、本部とその組織の管理者だけです');
    }
    if (org.organization_type === 'headquarters') throw new StoreError('VALIDATION', '招待できるのは総代理店・代理店の組織だけです');
    if (org.status !== 'active') throw new StoreError('VALIDATION', '停止中の組織には招待できません');
    if (role !== 'admin' && role !== 'editor') throw new StoreError('VALIDATION', '役割は「管理者」か「担当者」を選んでください');
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) throw new StoreError('VALIDATION', 'メールアドレスの形式を確かめてください');
    const alreadyMember = t.memberships.some(
      (m) =>
        m.organization_id === org.id &&
        m.status === 'active' &&
        normalizeEmail(db.profiles.find((p) => p.id === m.profile_id)?.email ?? '') === normalized
    );
    if (alreadyMember) throw new StoreError('VALIDATION', 'このメールアドレスの方は、すでにこの組織に所属しています');

    const issuedAt = now();
    for (const open of t.invitations.filter((i) => i.organization_id === org.id && i.email === normalized && !i.accepted_at && !i.revoked_at)) {
      open.revoked_at = issuedAt;
      open.revoked_by = actor.id;
    }
    const token = randomBytes(32).toString('hex');
    const invitation: LocalInvitation = {
      id: randomUUID(),
      organization_id: org.id,
      email: normalized,
      member_role: role,
      token_hash: sha256(token),
      invited_by: actor.id,
      created_at: issuedAt,
      expires_at: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      accepted_at: null,
      accepted_by: null,
      revoked_at: null,
      revoked_by: null,
    };
    t.invitations.push(invitation);
    audit(db, actor, 'organization_invite', org.id, `組織へ招待：${org.name}（${roleLabel(role)}）`);
    saveDb(db);
    return { invitation_id: invitation.id, token, expires_at: invitation.expires_at };
  }

  async revokeInvitation(actor: SessionUser, invitationId: string): Promise<void> {
    requireActor(actor);
    const db = loadDb();
    const t = tables(db);
    const invitation = t.invitations.find((i) => i.id === invitationId);
    if (!invitation) throw new StoreError('NOT_FOUND', '招待が見つかりません');
    if (!isAdmin(db, actor) && !isManager(db, actor, invitation.organization_id)) {
      throw new StoreError('FORBIDDEN', '招待を取り消せるのは、本部とその組織の管理者だけです');
    }
    if (invitation.accepted_at || invitation.revoked_at) throw new StoreError('VALIDATION', 'この招待はすでに使われたか、取り消されています');
    invitation.revoked_at = now();
    invitation.revoked_by = actor.id;
    audit(db, actor, 'organization_invite_revoke', invitation.organization_id, '組織への招待を取り消し');
    saveDb(db);
  }

  async previewInvitation(actor: SessionUser, token: string): Promise<InvitationPreview | null> {
    requireActor(actor);
    if (!INVITATION_TOKEN.test(token)) return null;
    const db = loadDb();
    const t = tables(db);
    const invitation = t.invitations.find((i) => i.token_hash === sha256(token));
    if (!invitation) return null;
    const org = t.organizations.find((o) => o.id === invitation.organization_id);
    if (!org) return null;
    const state = invitation.revoked_at
      ? 'revoked'
      : invitation.accepted_at
        ? 'accepted'
        : new Date(invitation.expires_at) < new Date()
          ? 'expired'
          : org.status !== 'active'
            ? 'organization_inactive'
            : 'open';
    return {
      organization_name: org.name,
      organization_type: org.organization_type,
      member_role: invitation.member_role,
      email_hint: maskEmail(invitation.email),
      expires_at: invitation.expires_at,
      state,
    };
  }

  async acceptInvitation(actor: SessionUser, token: string): Promise<string> {
    requireActor(actor);
    if (!INVITATION_TOKEN.test(token)) throw new StoreError('VALIDATION', '招待のリンクが正しくありません');
    const db = loadDb();
    const t = tables(db);
    const invitation = t.invitations.find((i) => i.token_hash === sha256(token));
    if (!invitation) throw new StoreError('NOT_FOUND', '招待が見つかりません。リンクを確かめてください');
    if (invitation.revoked_at) throw new StoreError('VALIDATION', 'この招待は取り消されています');
    if (invitation.accepted_at) throw new StoreError('VALIDATION', 'この招待はすでに使われています');
    if (new Date(invitation.expires_at) < new Date()) {
      throw new StoreError('VALIDATION', '招待の有効期限が切れています。招待した方に、もう一度送ってもらってください');
    }
    // ログインに使うメールアドレス（本人が変えられるプロフィールのメールアドレスではない）と照合する
    const loginEmail = normalizeEmail(db.users.find((u) => u.id === actor.id)?.email ?? '');
    if (loginEmail !== invitation.email) throw new StoreError('FORBIDDEN', '招待されたメールアドレスでログインしてください');
    const org = t.organizations.find((o) => o.id === invitation.organization_id);
    if (!org || org.status !== 'active') throw new StoreError('VALIDATION', '組織が停止中のため参加できません');
    const profile = db.profiles.find((p) => p.id === actor.id);
    if (!profile) throw new StoreError('NOT_FOUND', 'アカウントが見つかりません');
    if (profile.role_code === 'admin') throw new StoreError('VALIDATION', '本部の管理者は、代理店・総代理店に所属できません');
    if (t.memberships.some((m) => m.profile_id === actor.id && m.status === 'active' && m.organization_id === org.id)) {
      throw new StoreError('VALIDATION', 'すでにこの組織に所属しています');
    }
    if (t.memberships.some((m) => m.profile_id === actor.id && m.status === 'active')) {
      throw new StoreError('VALIDATION', 'ほかの組織に所属しています。本部にご相談ください');
    }
    const existing = t.memberships.find((m) => m.organization_id === org.id && m.profile_id === actor.id);
    if (existing) {
      existing.member_role = invitation.member_role;
      existing.status = 'active';
      existing.is_primary = true;
      existing.updated_at = now();
    } else {
      t.memberships.push({
        id: randomUUID(),
        organization_id: org.id,
        profile_id: actor.id,
        member_role: invitation.member_role,
        status: 'active',
        is_primary: true,
        created_at: now(),
        updated_at: now(),
      });
    }
    profile.role_code = org.organization_type === 'master_dealer' ? 'master_dealer' : 'dealer';
    profile.updated_at = now();
    invitation.accepted_at = now();
    invitation.accepted_by = actor.id;
    audit(db, actor, 'organization_join', org.id, `組織に参加：${org.name}（${roleLabel(invitation.member_role)}）`);
    saveDb(db);
    return org.id;
  }
}
