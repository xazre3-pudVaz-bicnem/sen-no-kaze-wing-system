import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getOrganizationStore } from '@/lib/data/organizations/store';
import {
  INVITATION_STATE_LABEL,
  ORGANIZATION_STATUS_LABEL,
  ORGANIZATION_TYPE_LABEL,
  invitationState,
  isManagerRole,
  memberRoleLabel,
} from '@/lib/domain/organizations';
import { deactivateMemberAction, revokeInvitationAction, setMemberRoleAction } from '@/lib/actions/organizations';
import { Alert, Badge, Button, Select } from '@/components/ui';
import { AdminPage, BackLink, Table, Td, Th } from '@/components/admin/ui';
import { InviteMemberForm, UpdateOrganizationForm } from '@/components/admin/organization-forms';

export const metadata: Metadata = { title: '組織 | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

const dateText = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric' }) : '—';

export default async function OrganizationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireStaff(`/admin/organizations/${id}`);
  const store = await getOrganizationStore();
  const organization = await store.getOrganization(actor, id);
  if (!organization) notFound();

  const isAdmin = actor.role === 'admin';
  const mine = isAdmin ? null : await store.getMyOrganization(actor);
  const canManage =
    organization.organization_type !== 'headquarters' &&
    (isAdmin || (mine?.organization_id === organization.id && isManagerRole(mine.member_role) && organization.status === 'active'));
  const [members, invitations, parents] = await Promise.all([
    store.listMembers(actor, organization.id),
    canManage ? store.listInvitations(actor, organization.id) : Promise.resolve([]),
    isAdmin ? store.listOrganizations(actor) : Promise.resolve([]),
  ]);
  const activeManagers = members.filter((m) => m.status === 'active' && isManagerRole(m.member_role)).length;
  const masterDealers = parents
    .filter((row) => row.organization_type === 'master_dealer')
    .map((row) => ({ id: row.id, name: row.name, status: row.status }));

  return (
    <AdminPage
      title={organization.name}
      lead={`${ORGANIZATION_TYPE_LABEL[organization.organization_type]}・${organization.code}${
        organization.organization_type === 'dealer' ? `・直属の総代理店：${organization.parent_name ?? '未設定'}` : ''
      }`}
      actions={isAdmin ? <BackLink href="/admin/organizations" label="組織・代理店" /> : undefined}
    >
      {sp.created && <Alert tone="success">組織を登録しました。次に、最初の管理者を招待してください。</Alert>}
      {sp.joined && <Alert tone="success">{organization.name}に参加しました。</Alert>}
      {sp.saved && <Alert tone="success">保存しました。</Alert>}
      {sp.removed && <Alert tone="success">所属を外しました。</Alert>}
      {sp.revoked && <Alert tone="success">招待を取り消しました。</Alert>}
      {sp.error && <Alert tone="danger">{sp.error}</Alert>}
      {organization.status !== 'active' && (
        <Alert tone="warn">この組織は停止中です。招待とメンバーの変更はできません。</Alert>
      )}
      {canManage && activeManagers === 0 && organization.status === 'active' && (
        <Alert tone="warn">管理者がいません。下の「招待する」から、最初の管理者を招待してください。</Alert>
      )}

      {isAdmin && organization.organization_type !== 'headquarters' && (
        <UpdateOrganizationForm organization={organization} parents={masterDealers} />
      )}

      <section className="space-y-3" aria-labelledby="members-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="members-heading" className="text-lg font-semibold">
            メンバー
          </h2>
          <p className="text-xs text-muted">
            <Badge tone="navy">管理者</Badge> は自社の全案件を確認し、担当者の追加・役割の変更ができます。
            <Badge className="ml-1">担当者</Badge> は自分の担当案件を扱います。
          </p>
        </div>
        <Table minWidth="44rem">
          <thead className="border-b border-line bg-sand/40">
            <tr>
              <Th>氏名</Th>
              {canManage && <Th>メールアドレス</Th>}
              <Th>役割</Th>
              <Th>参加日</Th>
              {canManage && <Th>操作</Th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const active = member.status === 'active';
              const lastManager = active && isManagerRole(member.member_role) && activeManagers <= 1;
              return (
                <tr key={member.membership_id} className="border-t border-line" data-testid="organization-member-row">
                  <Td>
                    <span className={active ? 'font-medium' : 'text-muted line-through'}>{member.full_name || '（氏名未登録）'}</span>
                    {member.profile_id === actor.id && <span className="ml-2 text-xs text-muted">（自分）</span>}
                  </Td>
                  {canManage && <Td className="break-all text-ink-soft">{member.email ?? '—'}</Td>}
                  <Td>
                    {active ? (
                      <Badge tone={isManagerRole(member.member_role) ? 'navy' : 'neutral'}>{memberRoleLabel(member.member_role)}</Badge>
                    ) : (
                      <span className="text-xs text-muted">所属を外れた</span>
                    )}
                  </Td>
                  <Td>{dateText(member.joined_at)}</Td>
                  {canManage && (
                    <Td>
                      {active ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={setMemberRoleAction} className="flex items-center gap-1">
                            <input type="hidden" name="organization_id" value={organization.id} />
                            <input type="hidden" name="membership_id" value={member.membership_id} />
                            <Select
                              name="member_role"
                              aria-label={`${member.full_name}の役割`}
                              defaultValue={isManagerRole(member.member_role) ? 'admin' : 'editor'}
                              className="w-28 py-1 text-xs"
                            >
                              <option value="admin">管理者</option>
                              <option value="editor">担当者</option>
                            </Select>
                            <Button type="submit" size="sm" variant="secondary">
                              役割を変える
                            </Button>
                          </form>
                          {lastManager ? (
                            <span className="text-xs text-muted">最後の管理者のため外せません</span>
                          ) : (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-danger">所属を外す</summary>
                              <form action={deactivateMemberAction} className="mt-2 space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-3">
                                <input type="hidden" name="organization_id" value={organization.id} />
                                <input type="hidden" name="membership_id" value={member.membership_id} />
                                <p className="leading-5 text-ink-soft">
                                  所属を外すと、この方は管理画面に入れなくなります（通常の会員に戻ります）。
                                </p>
                                <Button type="submit" size="sm" variant="secondary" data-testid="organization-member-deactivate">
                                  所属を外す
                                </Button>
                              </form>
                            </details>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <Td colSpan={canManage ? 5 : 3} className="py-6 text-center text-muted">
                  まだメンバーがいません。
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>

      {canManage && organization.status === 'active' && (
        <section className="card space-y-4 p-5" aria-labelledby="invite-heading">
          <h2 id="invite-heading" className="text-lg font-semibold">
            {activeManagers === 0 ? '最初の管理者を招待する' : 'メンバーを招待する'}
          </h2>
          <InviteMemberForm organizationId={organization.id} firstManager={activeManagers === 0} />
        </section>
      )}

      {canManage && invitations.length > 0 && (
        <section className="space-y-3" aria-labelledby="invitations-heading">
          <h2 id="invitations-heading" className="text-lg font-semibold">
            招待
          </h2>
          <Table minWidth="44rem">
            <thead className="border-b border-line bg-sand/40">
              <tr>
                <Th>メールアドレス</Th>
                <Th>役割</Th>
                <Th>状態</Th>
                <Th>有効期限</Th>
                <Th>招待した人</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => {
                const state = invitationState(invitation);
                return (
                  <tr key={invitation.invitation_id} className="border-t border-line" data-testid="organization-invitation-row">
                    <Td className="break-all">{invitation.email}</Td>
                    <Td>{memberRoleLabel(invitation.member_role)}</Td>
                    <Td>
                      <Badge tone={state === 'open' ? 'warn' : state === 'accepted' ? 'success' : 'neutral'}>{INVITATION_STATE_LABEL[state]}</Badge>
                    </Td>
                    <Td>{dateText(invitation.expires_at)}</Td>
                    <Td>{invitation.invited_by_name ?? '—'}</Td>
                    <Td>
                      {state === 'open' && (
                        <form action={revokeInvitationAction}>
                          <input type="hidden" name="organization_id" value={organization.id} />
                          <input type="hidden" name="invitation_id" value={invitation.invitation_id} />
                          <Button type="submit" size="sm" variant="ghost">
                            取り消す
                          </Button>
                        </form>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </section>
      )}

      {!canManage && organization.organization_type !== 'headquarters' && (
        <p className="text-xs text-muted">担当者の追加・役割の変更は、この組織の管理者が行います。</p>
      )}
      <p className="text-xs text-muted">状態：{ORGANIZATION_STATUS_LABEL[organization.status]}</p>
    </AdminPage>
  );
}
