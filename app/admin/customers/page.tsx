import { getStore } from '@/lib/data/store';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

export default async function AdminCustomersPage() {
  const store = await getStore();
  const [profiles, configurations] = await Promise.all([store.listProfiles(), store.listAllConfigurations()]);
  const countByUser = new Map<string, number>();
  for (const c of configurations) countByUser.set(c.user_id, (countByUser.get(c.user_id) ?? 0) + 1);
  return (
    <AdminPage title="顧客一覧" lead={`登録ユーザー ${profiles.length} 名`}>
      <Table minWidth="52rem">
        <thead className="bg-sand/60"><tr><Th>氏名 / 法人</Th><Th>メール</Th><Th>電話</Th><Th>住所</Th><Th right>保存仕様</Th><Th>登録日</Th><Th>権限</Th></tr></thead>
        <tbody className="divide-y divide-line">
          {profiles.map((p) => (
            <tr key={p.id}>
              <Td className="font-semibold">{p.full_name}{p.company_name && <span className="block text-xs font-normal text-muted">{p.company_name}</span>}</Td>
              <Td>{p.email}</Td>
              <Td>{p.phone ?? '—'}</Td>
              <Td className="text-xs">{[p.postal_code, p.address].filter(Boolean).join(' ') || '—'}</Td>
              <Td right>{countByUser.get(p.id) ?? 0}</Td>
              <Td>{formatDate(p.created_at)}</Td>
              <Td>{p.role_code === 'admin' ? <Badge tone="navy">管理者</Badge> : <Badge>顧客</Badge>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </AdminPage>
  );
}
