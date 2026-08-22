import Link from 'next/link';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { CONFIGURATION_STATUS_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

export default async function AdminConfigurationsPage() {
  const store = await getStore();
  const [configurations, models] = await Promise.all([store.listAllConfigurations(), store.listModels({ includeDraft: true })]);
  const nameOf = new Map(models.map((m) => [m.id, m.name]));
  return (
    <AdminPage title="保存された仕様" lead={`全顧客の保存データ ${configurations.length} 件`}>
      <Table minWidth="48rem">
        <thead className="bg-sand/60"><tr><Th>更新日時</Th><Th>保存名</Th><Th>モデル</Th><Th>顧客</Th><Th>状態</Th><Th right>合計（税込）</Th><Th></Th></tr></thead>
        <tbody className="divide-y divide-line">
          {configurations.map((c) => (
            <tr key={c.id}>
              <Td>{formatDate(c.updated_at, true)}</Td>
              <Td className="font-semibold">{c.name}</Td>
              <Td>{nameOf.get(c.base_model_id)}</Td>
              <Td>{c.user_name}<br /><span className="text-xs text-muted">{c.user_email}</span></Td>
              <Td><Badge>{CONFIGURATION_STATUS_LABELS[c.status]}</Badge></Td>
              <Td right>{formatYen(c.total)}</Td>
              <Td right><Link href={`/admin/configurations/${c.id}`} className="btn-secondary btn-sm">確認</Link></Td>
            </tr>
          ))}
          {configurations.length === 0 && <tr><Td className="text-center text-muted">まだありません</Td></tr>}
        </tbody>
      </Table>
    </AdminPage>
  );
}
