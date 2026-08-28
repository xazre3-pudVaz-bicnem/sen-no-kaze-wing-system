import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { canEditCatalog, QUOTE_REQUEST_STATUS_LABELS, QUOTE_STATUS_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { matchesRegion, parseAddress, readRegionFilter } from '@/lib/domain/address';
import { RegionFilter } from '@/components/admin/region-filter';

export default async function AdminQuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const store = await getStore();

  // 代理店は自分に割り当てられた見積だけを見る。総代理店は本部と同じく全件（本体明細を編集するため）
  if (!canEditCatalog(actor.role)) {
    const mine = await store.listDealerQuotes(actor.id);
    const latest = mine.filter((q) => q.status !== 'superseded');
    return (
      <AdminPage
        title="担当の見積"
        lead={`割り当てられた見積 ${latest.length} 件。別途工事・フリー商品を入力して確定見積を発行できます。`}
        actions={
          <Link href="/admin/quotes/new" className="btn-primary btn-sm" data-testid="new-quote-link">
            新規見積を作成
          </Link>
        }
      >
        <Table minWidth="48rem">
          <thead className="bg-sand/60">
            <tr>
              <Th>発行日</Th>
              <Th>見積番号</Th>
              <Th>顧客</Th>
              <Th right>合計（税込）</Th>
              <Th>状態</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {latest.map((q) => (
              <tr key={q.id} data-testid="dealer-quote-row">
                <Td>{formatDate(q.issued_at, true)}</Td>
                <Td className="font-mono">
                  {q.quote_no}
                  <span className="ml-1 text-xs text-muted">第{q.revision}版</span>
                </Td>
                <Td>
                  {q.customer_name}
                  <span className="block text-xs text-muted">{q.user_email}</span>
                </Td>
                <Td right>{formatYen(q.total)}</Td>
                <Td>
                  <Badge tone={q.status === 'issued' ? 'navy' : 'neutral'}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
                </Td>
                <Td right>
                  <Link href={`/admin/quotes/${q.id}`} className="btn-secondary btn-sm">
                    別途工事を入力
                  </Link>
                </Td>
              </tr>
            ))}
            {latest.length === 0 && (
              <tr>
                <Td className="text-center text-muted">割り当てられた見積はまだありません</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </AdminPage>
    );
  }

  const [requests, quotes] = await Promise.all([store.listQuoteRequests(), store.listAllQuotes()]);
  const quoteById = new Map(quotes.map((q) => [q.id, q]));

  // 地域で抽出（設置予定地を優先し、無ければ顧客住所で判定）
  const filter = readRegionFilter(sp);
  const addrOf = (r: (typeof requests)[number]) => r.contact.site_address || r.contact.address || '';
  const cityPool = filter.pref
    ? [...new Set(
        requests
          .map((r) => parseAddress(addrOf(r)))
          .filter((a) => a.prefecture === filter.pref && a.city)
          .map((a) => a.city as string)
      )].sort()
    : [];
  const shown = requests.filter((r) => matchesRegion(addrOf(r), filter));

  return (
    <AdminPage
      title="見積依頼・見積書"
      lead={`見積依頼 ${requests.length} 件`}
      actions={
        <Link href="/admin/quotes/new" className="btn-primary btn-sm" data-testid="new-quote-link">
          新規見積を作成
        </Link>
      }
    >
      <RegionFilter value={filter} cities={cityPool} total={requests.length} matched={shown.length} />
      <Table minWidth="60rem">
        <thead className="bg-sand/60">
          <tr>
            <Th>受付日時</Th>
            <Th>見積番号</Th>
            <Th>顧客</Th>
            <Th>設置予定地</Th>
            <Th>担当代理店</Th>
            <Th right>合計（税込）</Th>
            <Th>依頼状況</Th>
            <Th>見積書</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((r) => {
            const q = r.quote_id ? quoteById.get(r.quote_id) : undefined;
            return (
              <tr key={r.id} data-testid="admin-quote-row">
                <Td>{formatDate(r.created_at, true)}</Td>
                <Td className="font-mono">
                  {r.quote_no ?? '—'}
                  {q && q.revision > 1 && <span className="ml-1 text-xs text-muted">第{q.revision}版</span>}
                </Td>
                <Td>
                  {r.contact.full_name}
                  {r.contact.company_name && <span className="block text-xs text-muted">{r.contact.company_name}</span>}
                  <span className="block text-xs text-muted">{r.user_email}</span>
                </Td>
                <Td className="text-xs">{r.contact.site_address || '—'}</Td>
                <Td className="text-xs">{q?.dealer_id ? <Badge tone="success">割当済み</Badge> : <span className="text-muted">未割当</span>}</Td>
                <Td right>{q ? formatYen(q.total) : '—'}</Td>
                <Td>
                  <Badge tone={r.status === 'new' ? 'danger' : r.status === 'closed' ? 'success' : 'neutral'}>
                    {QUOTE_REQUEST_STATUS_LABELS[r.status]}
                  </Badge>
                </Td>
                <Td>{q && <Badge tone={q.status === 'issued' ? 'navy' : 'neutral'}>{QUOTE_STATUS_LABELS[q.status]}</Badge>}</Td>
                <Td right className="whitespace-nowrap">
                  {q && (
                    <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noopener" className="btn-ghost btn-sm">
                      PDF
                    </a>
                  )}
                  {q && (
                    <Link href={`/admin/quotes/${q.id}`} className="btn-secondary btn-sm ml-1">
                      詳細
                    </Link>
                  )}
                </Td>
              </tr>
            );
          })}
          {requests.length === 0 && (
            <tr>
              <Td className="text-center text-muted">見積依頼はまだありません</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </AdminPage>
  );
}
