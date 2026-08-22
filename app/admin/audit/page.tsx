import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

/** 価格・公開状態・権限の変更履歴。総代理店も価格を触れるため、誰がいつ変えたかを残す */
export default async function AdminAuditPage() {
  await requireAdmin();
  const store = await getStore();
  const logs = await store.listAuditLogs({ limit: 300 });

  return (
    <AdminPage
      title="変更履歴"
      lead="商品・本体の価格と公開状態、ユーザーの権限が変更された記録です。発行済みの見積金額は変わりません。"
    >
      <Table minWidth="48rem">
        <thead className="bg-sand/60">
          <tr>
            <Th>日時</Th>
            <Th>操作者</Th>
            <Th>種別</Th>
            <Th>対象</Th>
            <Th>内容</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {logs.map((l) => (
            <tr key={l.id} data-testid={`audit-${l.action}`}>
              <Td className="whitespace-nowrap">{formatDate(l.created_at, true)}</Td>
              <Td className="text-xs">{l.actor_email ?? '—'}</Td>
              <Td>
                <Badge tone={l.action === 'price' ? 'warn' : l.action === 'role' ? 'navy' : 'neutral'}>
                  {AUDIT_ACTION_LABELS[l.action] ?? l.action}
                </Badge>
              </Td>
              <Td className="text-xs text-muted">{AUDIT_ENTITY_LABELS[l.entity] ?? l.entity}</Td>
              <Td>{l.summary}</Td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <Td className="text-center text-muted">変更履歴はまだありません</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </AdminPage>
  );
}
