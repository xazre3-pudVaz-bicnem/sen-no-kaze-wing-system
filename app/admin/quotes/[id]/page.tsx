import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { FREE_PRODUCT_CATEGORY_CODE, QUOTE_REQUEST_STATUS_LABELS, QUOTE_STATUS_LABELS } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { QuoteStatusForm } from '@/components/admin/forms';
import { AssignDealerForm, DealerRevisionForm } from '@/components/admin/dealer-forms';
import { QuoteTable } from '@/components/mypage/quote-table';

export default async function AdminQuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireStaff();
  const store = await getStore();
  const detail = await store.getQuote(id, actor);
  if (!detail) notFound();
  const { quote, items, request, profile, document } = detail;
  const isAdmin = actor.role === 'admin';
  // 代理店は自分に割り当てられた見積だけ
  if (!isAdmin && quote.dealer_id !== actor.id) notFound();

  const canRevise = quote.status !== 'superseded' && (isAdmin || quote.dealer_id === actor.id);
  const [profiles, categories, options] = await Promise.all([
    isAdmin ? store.listProfiles() : Promise.resolve([]),
    store.listCategories(),
    store.listOptions(),
  ]);
  const dealers = profiles.filter((p) => p.role_code === 'dealer' || p.role_code === 'master_dealer');
  const freeCategory = categories.find((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const freeProducts = options
    .filter((o) => o.category_id === freeCategory?.id && o.status === 'published' && (isAdmin || o.owner_id === actor.id))
    .map((o) => ({ code: o.code, name: o.name, price: o.price }));
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
      {/* grid の子は既定で min-width:auto。中の表（min-w-[44rem]）に押し広げられるので min-w-0 を付ける */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <div className="card overflow-hidden">
            <QuoteTable quote={quote} items={items} totalTestId="admin-quote-total" />
          </div>
          <p className="text-xs text-muted">
            金額は発行時点のスナップショットです。マスター価格を変更しても変わりません。
            別途工事・フリー商品を入れる場合は、書き換えではなく次の版として発行します。
          </p>
          {canRevise && <DealerRevisionForm quote={quote} items={items} freeProducts={freeProducts} />}
          {quote.status === 'superseded' && (
            <Alert tone="info">この版は改訂済みです。最新の版から編集してください。</Alert>
          )}
          {isAdmin && <QuoteStatusForm quote={quote} request={request} />}
        </div>
        <aside className="min-w-0 space-y-4">
          {isAdmin && <AssignDealerForm quote={quote} dealers={dealers} />}
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
