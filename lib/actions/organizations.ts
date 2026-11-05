'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin, requireStaff, requireUser } from '@/lib/auth/session';
import { StoreError } from '@/lib/data/store';
import { getOrganizationStore } from '@/lib/data/organizations/store';
import { sendDirectEmail } from '@/lib/mail/send';
import { getSiteUrl } from '@/lib/site';
import {
  INVITATION_TOKEN,
  ORGANIZATION_TYPE_LABEL,
  isValidEmail,
  memberRoleLabel,
  normalizeEmail,
} from '@/lib/domain/organizations';

export interface OrganizationFormState {
  ok: boolean;
  error?: string;
  message?: string;
  /** 発行した招待のリンク（メールが届かないときに手で渡せるよう、画面にも出す） */
  inviteUrl?: string;
  emailStatus?: 'sent' | 'skipped' | 'failed';
}

const id = z.uuid();
const role = z.enum(['admin', 'editor']);

function messageOf(e: unknown): string {
  if (e instanceof StoreError) return e.message;
  console.error('[wing] organization action error', e);
  return '処理中にエラーが発生しました。';
}

const text = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim();
const optionalId = (formData: FormData, key: string) => {
  const value = text(formData, key);
  return value === '' ? null : value;
};
const detailPath = (organizationId: string) => `/admin/organizations/${organizationId}`;
const withParam = (path: string, key: string, value: string) => `${path}?${key}=${encodeURIComponent(value)}`;

export async function createOrganizationAction(_prev: OrganizationFormState, formData: FormData): Promise<OrganizationFormState> {
  const actor = await requireAdmin('/admin/organizations');
  const type = z.enum(['master_dealer', 'dealer']).safeParse(text(formData, 'organization_type'));
  const parent = optionalId(formData, 'parent_organization_id');
  if (!type.success) return { ok: false, error: '組織の種類は「総代理店」か「代理店」を選んでください' };
  if (parent && !id.safeParse(parent).success) return { ok: false, error: '直属の総代理店を選び直してください' };
  let createdId: string;
  try {
    const store = await getOrganizationStore();
    createdId = await store.createOrganization(actor, {
      organization_type: type.data,
      name: text(formData, 'name'),
      parent_organization_id: type.data === 'dealer' ? parent : null,
    });
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  revalidatePath('/admin/organizations');
  redirect(withParam(detailPath(createdId), 'created', '1'));
}

export async function updateOrganizationAction(_prev: OrganizationFormState, formData: FormData): Promise<OrganizationFormState> {
  const organizationId = text(formData, 'organization_id');
  const actor = await requireAdmin(id.safeParse(organizationId).success ? detailPath(organizationId) : '/admin/organizations');
  const status = z.enum(['active', 'inactive']).safeParse(text(formData, 'status'));
  const parent = optionalId(formData, 'parent_organization_id');
  if (!id.safeParse(organizationId).success) return { ok: false, error: '組織が見つかりません' };
  if (!status.success) return { ok: false, error: '状態は「有効」か「停止」を選んでください' };
  if (parent && !id.safeParse(parent).success) return { ok: false, error: '直属の総代理店を選び直してください' };
  try {
    const store = await getOrganizationStore();
    await store.updateOrganization(actor, organizationId, { name: text(formData, 'name'), parent_organization_id: parent, status: status.data });
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  revalidatePath('/admin/organizations');
  revalidatePath(detailPath(organizationId));
  return { ok: true, message: '保存しました。' };
}

export async function inviteMemberAction(_prev: OrganizationFormState, formData: FormData): Promise<OrganizationFormState> {
  const organizationId = text(formData, 'organization_id');
  const actor = await requireStaff(id.safeParse(organizationId).success ? detailPath(organizationId) : '/admin');
  const memberRole = role.safeParse(text(formData, 'member_role'));
  const email = normalizeEmail(text(formData, 'email'));
  if (!id.safeParse(organizationId).success) return { ok: false, error: '組織が見つかりません' };
  if (!memberRole.success) return { ok: false, error: '役割は「管理者」か「担当者」を選んでください' };
  if (!isValidEmail(email)) return { ok: false, error: 'メールアドレスの形式を確かめてください' };

  try {
    const store = await getOrganizationStore();
    const organization = await store.getOrganization(actor, organizationId);
    const issued = await store.inviteMember(actor, organizationId, email, memberRole.data);
    const base = getSiteUrl();
    const inviteUrl = `${base ?? ''}/invite/${issued.token}`;
    const expires = new Date(issued.expires_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'long', timeStyle: 'short' });
    const orgLabel = organization ? `${organization.name}（${ORGANIZATION_TYPE_LABEL[organization.organization_type]}）` : '';
    const emailStatus = base
      ? await sendDirectEmail(
          email,
          `【千の風 Wing】${organization?.name ?? '組織'}への招待`,
          [
            '千の風プロジェクト（Wing）の管理画面へ招待されました。',
            '',
            `組織：${orgLabel}`,
            `役割：${memberRoleLabel(memberRole.data)}`,
            '',
            `次のリンクを開き、このメールアドレス（${email}）でログイン、または会員登録してから「参加する」を押してください。`,
            inviteUrl,
            '',
            `リンクの有効期限：${expires}`,
            '心当たりがない場合は、このメールを破棄してください。',
          ].join('\n')
        )
      : 'skipped';
    revalidatePath(detailPath(organizationId));
    return {
      ok: true,
      message:
        emailStatus === 'sent'
          ? `${email} に招待メールを送りました（有効期限：${expires}）。`
          : `招待を発行しました（有効期限：${expires}）。メールは送っていないため、下のリンクを本人に伝えてください。`,
      inviteUrl,
      emailStatus,
    };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const organizationId = text(formData, 'organization_id');
  const back = id.safeParse(organizationId).success ? detailPath(organizationId) : '/admin';
  const actor = await requireStaff(back);
  const invitationId = text(formData, 'invitation_id');
  let error: string | null = null;
  try {
    if (!id.safeParse(invitationId).success) throw new StoreError('NOT_FOUND', '招待が見つかりません');
    const store = await getOrganizationStore();
    await store.revokeInvitation(actor, invitationId);
  } catch (e) {
    error = messageOf(e);
  }
  revalidatePath(back);
  redirect(error ? withParam(back, 'error', error) : withParam(back, 'revoked', '1'));
}

export async function setMemberRoleAction(formData: FormData): Promise<void> {
  const organizationId = text(formData, 'organization_id');
  const back = id.safeParse(organizationId).success ? detailPath(organizationId) : '/admin';
  const actor = await requireStaff(back);
  const membershipId = text(formData, 'membership_id');
  const memberRole = role.safeParse(text(formData, 'member_role'));
  let error: string | null = null;
  try {
    if (!id.safeParse(membershipId).success) throw new StoreError('NOT_FOUND', 'メンバーが見つかりません');
    if (!memberRole.success) throw new StoreError('VALIDATION', '役割は「管理者」か「担当者」を選んでください');
    const store = await getOrganizationStore();
    await store.setMemberRole(actor, membershipId, memberRole.data);
  } catch (e) {
    error = messageOf(e);
  }
  revalidatePath(back);
  redirect(error ? withParam(back, 'error', error) : withParam(back, 'saved', '1'));
}

export async function deactivateMemberAction(formData: FormData): Promise<void> {
  const organizationId = text(formData, 'organization_id');
  const back = id.safeParse(organizationId).success ? detailPath(organizationId) : '/admin';
  const actor = await requireStaff(back);
  const membershipId = text(formData, 'membership_id');
  let error: string | null = null;
  try {
    if (!id.safeParse(membershipId).success) throw new StoreError('NOT_FOUND', 'メンバーが見つかりません');
    const store = await getOrganizationStore();
    await store.deactivateMember(actor, membershipId);
  } catch (e) {
    error = messageOf(e);
  }
  revalidatePath(back);
  redirect(error ? withParam(back, 'error', error) : withParam(back, 'removed', '1'));
}

export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = text(formData, 'token');
  const back = INVITATION_TOKEN.test(token) ? `/invite/${token}` : '/mypage';
  const actor = await requireUser(back);
  let error: string | null = null;
  try {
    if (!INVITATION_TOKEN.test(token)) throw new StoreError('VALIDATION', '招待のリンクが正しくありません');
    const store = await getOrganizationStore();
    await store.acceptInvitation(actor, token);
  } catch (e) {
    error = messageOf(e);
  }
  if (error) redirect(withParam(back, 'error', error));
  revalidatePath('/', 'layout');
  redirect('/admin/organization?joined=1');
}
