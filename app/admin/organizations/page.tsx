import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getOrganizationStore } from '@/lib/data/organizations/store';
import { ORGANIZATION_STATUS_LABEL, ORGANIZATION_TYPE_LABEL } from '@/lib/domain/organizations';
import { Badge } from '@/components/ui';
import { AdminPage, BackLink, Table, Td, Th } from '@/components/admin/ui';
import { CreateOrganizationForm } from '@/components/admin/organization-forms';

export const metadata: Metadata = { title: '組織・代理店 | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function OrganizationsPage() {
  const actor = await requireAdmin('/admin/organizations');
  const store = await getOrganizationStore();
  const rows = await store.listOrganizations(actor);
  const parents = rows
    .filter((row) => row.organization_type === 'master_dealer')
    .map((row) => ({ id: row.id, name: row.name, status: row.status }));

  return (
    <AdminPage
      title="組織・代理店"
      lead="総代理店・代理店の組織を登録し、最初の管理者を招待します。管理者は、自分の組織の担当者を追加できます。"
      actions={<BackLink href="/admin/settings" label="管理設定" />}
    >
      <CreateOrganizationForm parents={parents} />

      <Table minWidth="52rem">
        <thead className="border-b border-line bg-sand/40">
          <tr>
            <Th>種類</Th>
            <Th>組織名</Th>
            <Th>直属の総代理店</Th>
            <Th right>メンバー</Th>
            <Th right>管理者</Th>
            <Th right>未使用の招待</Th>
            <Th>状態</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-line" data-testid="organization-row">
              <Td>{ORGANIZATION_TYPE_LABEL[row.organization_type]}</Td>
              <Td>
                {row.organization_type === 'headquarters' ? (
                  <span className="font-medium">{row.name}</span>
                ) : (
                  <Link href={`/admin/organizations/${row.id}`} className="font-medium underline-offset-4 hover:underline">
                    {row.name}
                  </Link>
                )}
                <span className="ml-2 text-xs text-muted">{row.code}</span>
              </Td>
              <Td>{row.organization_type === 'dealer' ? row.parent_name ?? <span className="text-warn">未設定</span> : '—'}</Td>
              <Td right>{row.active_members}</Td>
              <Td right>
                {row.organization_type !== 'headquarters' && row.active_managers === 0 ? (
                  <span className="text-warn">0（招待してください）</span>
                ) : (
                  row.active_managers
                )}
              </Td>
              <Td right>{row.open_invitations}</Td>
              <Td>
                <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>{ORGANIZATION_STATUS_LABEL[row.status]}</Badge>
              </Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={7} className="py-8 text-center text-muted">
                まだ組織がありません。上のフォームから総代理店・代理店を登録してください。
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
    </AdminPage>
  );
}
