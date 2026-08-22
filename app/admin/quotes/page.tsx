import Link from 'next/link';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { QUOTE_REQUEST_STATUS_LABELS, QUOTE_STATUS_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

export default async function AdminQuotesPage() {
  const store = await getStore();
  const [requests, quotes] = await Promise.all([store.listQuoteRequests(), store.listAllQuotes()]);
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  return (
    <AdminPage title="見積依頼・見積書" lead={`見積依頼 ${requests.length} 件`}>
      <Table minWidth="56rem">
        <thead className="bg-sand/60"><tr><Th>受付日時</Th><Th>見積番号</Th><Th>顧客</Th><Th>設置予定地</Th><Th right>合計（税込）</Th><Th>依頼状況</Th><Th>見積書</Th><Th></Th></tr></thead>
        <tbody className="divide-y divide-line">
          {requests.map((r) => {
            const q = r.quote_id ? quoteById.get(r.quote_id) : undefined;
            return (
              <tr key={r.id} data-testid="admin-quote-row">
                <Td>{formatDate(r.created_at, true)}</Td>
                <Td className="font-mono">{r.quote_no ?? '—'}</Td>
                <Td>{r.contact.full_name}{r.contact.company_name && <span className="block text-xs text-muted">{r.contact.company_name}</span>}<span className="block text-xs text-muted">{r.user_email}</span></Td>
                <Td className="text-xs">{r.contact.site_address || '—'}</Td>
                <Td right>{q ? formatYen(q.total) : '—'}</Td>
                <Td><Badge tone={r.status === 'new' ? 'danger' : r.status === 'closed' ? 'success' : 'neutral'}>{QUOTE_REQUEST_STATUS_LABELS[r.status]}</Badge></Td>
                <Td>{q && <Badge tone={q.status === 'issued' ? 'navy' : 'neutral'}>{QUOTE_STATUS_LABELS[q.status]}</Badge>}</Td>
                <Td right className="whitespace-nowrap">
                  {q && <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noopener" className="btn-ghost btn-sm">PDF</a>}
                  {q && <Link href={`/admin/quotes/${q.id}`} className="btn-secondary btn-sm ml-1">詳細</Link>}
                </Td>
              </tr>
            );
          })}
          {requests.length === 0 && <tr><Td className="text-center text-muted">見積依頼はまだありません</Td></tr>}
        </tbody>
      </Table>
    </AdminPage>
  );
}
