import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { QUOTE_REQUEST_STATUS_LABELS, QUOTE_STATUS_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { QuoteStatusForm } from '@/components/admin/forms';
import { QuoteTable } from '@/components/mypage/quote-table';

export default async function AdminQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin();
  const store = await getStore();
  const detail = await store.getQuote(id, admin);
  if (!detail) notFound();
  const { quote, items, request, profile, document } = detail;
  return (
    <AdminPage
      title={`見積書 ${quote.quote_no}`}
      lead={`顧客番号 ${quote.customer_no ?? '—'}／発行 ${formatDate(quote.issued_at)}／有効期限 ${formatDate(quote.valid_until)}`}
      actions={
        <>
          <a href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noopener" className="btn-primary btn-sm" data-testid="admin-pdf-link">見積書PDF</a>
          <a href={`/api/quotes/${quote.id}/pdf?regenerate=1`} target="_blank" rel="noopener" className="btn-ghost btn-sm" title="レイアウト変更後に PDF を作り直す（金額は変わりません）">PDF再生成</a>
        </>
      }
    >
      <BackLink href="/admin/quotes" label="一覧へ戻る" />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <div className="card overflow-hidden">
            <QuoteTable quote={quote} items={items} totalTestId="admin-quote-total" />
          </div>
          <p className="text-xs text-muted">金額は発行時点のスナップショットです。マスター価格を変更しても変わりません。別途工事の金額入力（代理店）は第二段階で追加予定です。</p>
          <QuoteStatusForm quote={quote} request={request} />
        </div>
        <aside className="space-y-4">
          <div className="card p-4 text-sm">
            <p className="font-semibold">状態</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="navy">{QUOTE_STATUS_LABELS[quote.status]}</Badge>
              {request && <Badge>{QUOTE_REQUEST_STATUS_LABELS[request.status]}</Badge>}
            </div>
            <p className="mt-3 text-xs text-muted">PDF：{document ? `生成済み（${formatDate(document.generated_at, true)}）` : '未生成（初回表示時に生成）'}</p>
          </div>
          <div className="card p-4 text-sm">
            <p className="font-semibold">顧客情報</p>
            <dl className="mt-2 space-y-1 text-ink-soft">
              <div><dt className="inline text-muted">顧客番号：</dt><dd className="inline font-mono">{quote.customer_no ?? profile?.customer_no ?? '—'}</dd></div>
              <div><dt className="inline text-muted">氏名：</dt><dd className="inline">{request?.contact.full_name ?? quote.customer_name}</dd></div>
              <div><dt className="inline text-muted">法人：</dt><dd className="inline">{request?.contact.company_name ?? quote.customer_company ?? '—'}</dd></div>
              <div><dt className="inline text-muted">メール：</dt><dd className="inline">{request?.contact.email ?? profile?.email}</dd></div>
              <div><dt className="inline text-muted">電話：</dt><dd className="inline">{request?.contact.phone ?? profile?.phone}</dd></div>
              <div><dt className="inline text-muted">住所：</dt><dd className="inline">{request?.contact.address ?? profile?.address}</dd></div>
              <div><dt className="inline text-muted">設置予定地：</dt><dd className="inline">{request?.contact.site_address || '—'}</dd></div>
            </dl>
          </div>
          <div className="card p-4 text-sm">
            <p className="font-semibold">ご要望</p>
            <p className="mt-2 whitespace-pre-wrap text-ink-soft">{request?.message || '—'}</p>
          </div>
        </aside>
      </div>
    </AdminPage>
  );
}
