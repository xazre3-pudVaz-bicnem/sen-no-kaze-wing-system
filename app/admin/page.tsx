import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { QUOTE_REQUEST_STATUS_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, Stat, Table, Td, Th } from '@/components/admin/ui';

export default async function AdminDashboard() {
  const actor = await requireStaff();
  const store = await getStore();
  const notifications = await store.listNotifications(actor, { limit: 30 });
  const unread = notifications.filter((n) => !n.read_at);

  // 代理店は自分の担当分だけを見る
  if (actor.role !== 'admin') {
    const mineAll = await store.listDealerQuotes(actor.id);
    const mine = mineAll.filter((q) => q.status === 'issued');
    return (
      <AdminPage title="案件管理" lead="担当案件を確認し、必要に応じて見積書を更新・発行します。">
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label="未読のお知らせ" value={unread.length} href="/admin/notifications" />
          <Stat label="対応が必要な案件" value={mine.length} href="/admin/quotes" />
        </div>
        {mine.length > 0 ? (
          <Alert tone="warn" title={`対応が必要な案件：${mine.length} 件`}>
            <Link href="/admin/quotes" className="underline">担当案件</Link>から内容を確認し、必要に応じて次の版を発行してください。
          </Alert>
        ) : (
          <Alert tone="success">対応が必要な案件はありません。</Alert>
        )}
        <section>
          <h2 className="mb-3 text-lg">最近のお知らせ</h2>
          <ul className="space-y-2">
            {notifications.slice(0, 8).map((n) => (
              <li key={n.id} className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <span>
                  {!n.read_at && <Badge tone="danger">未読</Badge>} {n.title}
                  <span className="block text-xs text-muted">{formatDate(n.created_at, true)}</span>
                </span>
                {n.link && <Link href={n.link} className="btn-ghost btn-sm">開く</Link>}
              </li>
            ))}
            {notifications.length === 0 && <li className="card p-6 text-center text-sm text-muted">お知らせはまだありません</li>}
          </ul>
        </section>
      </AdminPage>
    );
  }

  const [requests, contacts] = await Promise.all([store.listQuoteRequests(), store.listContactMessages()]);

  return (
    <AdminPage title="案件管理" lead="見積依頼・担当状況・お問い合わせを確認します。">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="未読のお知らせ" value={unread.length} href="/admin/notifications" />
        <Stat label="未対応の見積依頼" value={requests.filter((r) => r.status === 'new').length} href="/admin/quotes" />
        <Stat label="未対応のお問い合わせ" value={contacts.filter((c) => c.status === 'new').length} href="/admin/contacts" />
      </div>

      <section>
        <h2 className="mb-3 text-lg">最近の見積依頼</h2>
        <Table>
          <thead className="bg-sand/60"><tr><Th>受付日時</Th><Th>見積番号</Th><Th>顧客</Th><Th>状態</Th><Th></Th></tr></thead>
          <tbody className="divide-y divide-line">
            {requests.slice(0, 8).map((r) => (
              <tr key={r.id}>
                <Td>{formatDate(r.created_at, true)}</Td>
                <Td className="font-mono">{r.quote_no ?? '—'}</Td>
                <Td>{r.contact.full_name}{r.contact.company_name ? `（${r.contact.company_name}）` : ''}<br /><span className="text-xs text-muted">{r.user_email}</span></Td>
                <Td><Badge tone={r.status === 'new' ? 'danger' : r.status === 'closed' ? 'success' : 'neutral'}>{QUOTE_REQUEST_STATUS_LABELS[r.status]}</Badge></Td>
                <Td right>{r.quote_id && <Link href={`/admin/quotes/${r.quote_id}`} className="btn-ghost btn-sm">詳細</Link>}</Td>
              </tr>
            ))}
            {requests.length === 0 && <tr><Td className="text-center text-muted">見積依頼はまだありません</Td></tr>}
          </tbody>
        </Table>
      </section>

    </AdminPage>
  );
}
