import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { FINISH_LEVEL_INFO, FREE_PRODUCT_CATEGORY_CODE, QUOTE_REQUEST_STATUS_LABELS, QUOTE_STATUS_LABELS, canEditCatalog } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { QuoteStatusForm } from '@/components/admin/forms';
import { AssignDealerForm, DealerRevisionForm } from '@/components/admin/dealer-forms';
import { QuoteTable } from '@/components/mypage/quote-table';

export default async function AdminQuoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireStaff();
  const store = await getStore();
  const detail = await store.getQuote(id, actor);
  if (!detail) notFound();
  const { quote, items, request, profile, document } = detail;
  const isAdmin = actor.role === 'admin';
  // 案件見積は代理店以上が直接編集できる。代理店は担当案件、総代理店以上は全案件。
  const canManageAllQuotes = canEditCatalog(actor.role);
  const canEditBase = canEditCatalog(actor.role);
  if (!canManageAllQuotes && quote.dealer_id !== actor.id) notFound();

  const canRevise = quote.status === 'issued' && (canManageAllQuotes || quote.dealer_id === actor.id);
  const [profiles, categories, options] = await Promise.all([
    isAdmin ? store.listProfiles() : Promise.resolve([]),
    store.listCategories(),
    store.listOptions(),
  ]);
  const dealers = profiles.filter((p) => p.role_code === 'dealer' || p.role_code === 'master_dealer');
  const assignedDealer = dealers.find((dealer) => dealer.id === quote.dealer_id);
  const freeCategory = categories.find((c) => c.code === FREE_PRODUCT_CATEGORY_CODE);
  const freeProducts = options
    .filter((o) => o.category_id === freeCategory?.id && o.status === 'published' && (isAdmin || o.owner_id === actor.id))
    .map((o) => ({ code: o.code, name: o.name, price: o.price }));
  // 見積の行を商品台帳から選んで追加できるようにする（公開中の商品すべて）
  const catalogByCat = new Map(categories.map((c) => [c.id, c.name]));
  const catalog = options
    .filter((o) => o.status === 'published')
    .map((o) => ({
      code: o.code,
      name: o.name,
      category: catalogByCat.get(o.category_id) ?? 'その他',
      price: o.price,
      price_on_request: o.price_on_request,
      image_url: o.image_url,
      manufacturer: o.manufacturer,
    }));
  return (
    <AdminPage
      title="案件詳細"
      lead={`${request?.contact.full_name ?? quote.customer_name}／${quote.base_model_name}／見積番号 ${quote.quote_no}（第${quote.revision}版）`}
      actions={
        <>
          <a href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noopener" className="btn-secondary btn-sm" data-testid="admin-pdf-link">見積書PDF</a>
          <a href={`/api/quotes/${quote.id}/pdf?regenerate=1`} target="_blank" rel="noopener" className="btn-ghost btn-sm" title="レイアウト変更後に PDF を作り直す（金額は変わりません）">PDF再生成</a>
        </>
      }
    >
      <BackLink href="/admin/quotes" label="案件一覧へ戻る" />
      <nav aria-label="案件詳細の業務領域" className="overflow-x-auto border-y border-line py-3">
        <div className="flex w-max gap-2 whitespace-nowrap text-sm">
          <a href="#case-overview" className="btn-ghost btn-sm">案件概要</a>
          <a href="#quote-document" className="btn-ghost btn-sm">見積書</a>
          <a href="#plan-board" className="btn-ghost btn-sm">プランボード</a>
          <a href="#case-documents" className="btn-ghost btn-sm">契約・図面・資料</a>
          <a href="#manufacturing" className="btn-ghost btn-sm">製造・施工</a>
          <a href="#handover" className="btn-ghost btn-sm">引渡し・アフター</a>
        </div>
      </nav>

      <section id="case-overview" className="scroll-mt-6">
        <h2 className="mb-3 text-lg">案件概要</h2>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="card p-5 text-sm">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div><dt className="text-xs text-muted">顧客番号</dt><dd className="mt-1 font-mono">{quote.customer_no ?? profile?.customer_no ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">顧客名</dt><dd className="mt-1">{request?.contact.full_name ?? quote.customer_name}</dd></div>
              <div><dt className="text-xs text-muted">法人名</dt><dd className="mt-1">{request?.contact.company_name ?? quote.customer_company ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">メール</dt><dd className="mt-1 break-all">{request?.contact.email ?? profile?.email ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">電話</dt><dd className="mt-1">{request?.contact.phone ?? profile?.phone ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">住所</dt><dd className="mt-1">{request?.contact.address ?? profile?.address ?? '—'}</dd></div>
              <div><dt className="text-xs text-muted">設置予定地</dt><dd className="mt-1">{request?.contact.site_address || '—'}</dd></div>
              <div><dt className="text-xs text-muted">対象モデル</dt><dd className="mt-1">{quote.base_model_name}</dd></div>
              <div><dt className="text-xs text-muted">注文範囲</dt><dd className="mt-1">{FINISH_LEVEL_INFO[quote.finish_level].name}</dd></div>
            </dl>
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-xs text-muted">ご要望</p>
              <p className="mt-1 whitespace-pre-wrap text-ink-soft">{request?.message || '—'}</p>
            </div>
          </div>
          <aside className="space-y-4">
            <div className="card p-4 text-sm">
              <p className="font-semibold">現在の状態</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="navy">見積：{QUOTE_STATUS_LABELS[quote.status]}</Badge>
                {request && <Badge>依頼：{QUOTE_REQUEST_STATUS_LABELS[request.status]}</Badge>}
              </div>
              <dl className="mt-4 space-y-2 text-ink-soft">
                <div><dt className="inline text-muted">担当代理店：</dt><dd className="inline">{assignedDealer?.company_name ?? assignedDealer?.full_name ?? (quote.dealer_id ? '割当済み' : '未割当')}</dd></div>
                <div><dt className="inline text-muted">見積番号：</dt><dd className="inline font-mono">{quote.quote_no}（第{quote.revision}版）</dd></div>
                <div><dt className="inline text-muted">見積発行日：</dt><dd className="inline">{formatDate(quote.issued_at)}</dd></div>
                <div><dt className="inline text-muted">有効期限：</dt><dd className="inline">{formatDate(quote.valid_until)}</dd></div>
              </dl>
            </div>
            {isAdmin && <AssignDealerForm quote={quote} dealers={dealers} />}
          </aside>
        </div>
      </section>

      <section id="quote-document" className="scroll-mt-6">
        <h2 className="mb-3 text-lg">見積書</h2>
        <div className="space-y-6">
          <div className="card overflow-hidden">
            <QuoteTable quote={quote} items={items} totalTestId="admin-quote-total" showBaseDetail />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-sand/30 px-4 py-3 text-xs">
            <div>
              <span className="font-semibold text-ink">見積書PDF</span>
              <span className="ml-2 text-muted">
                {document ? `${document.file_name}（${formatDate(document.generated_at, true)}）` : '初回表示時に生成されます'}
              </span>
            </div>
            <a href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noopener" className="btn-ghost btn-sm">
              PDFを開く
            </a>
          </div>
          <p className="text-xs text-muted">
            金額は発行時点の確定内容です。マスター価格を変更しても変わりません。
            別途工事・フリー商品を入れる場合は、書き換えではなく次の版として発行します。
          </p>
          {sp.created && (
            <Alert tone="success" title="見積を作成しました">
              下の入力表（エクセル表）で本体・オプション・別途工事の行を確認し、必要に応じて編集して発行してください。
            </Alert>
          )}
          {sp.from === 'mail' && canRevise && (
            <Alert tone="info" title="メールからお越しの方へ">
              この画面で案件見積を編集し、確定見積を発行できます。代理店は本体を閲覧のみ、オプション・別途工事等を編集できます。入力表は下にあります。
            </Alert>
          )}
          {canRevise && (
            <DealerRevisionForm quote={quote} items={items} freeProducts={freeProducts} catalog={catalog} canEditBase={canEditBase} />
          )}
          {quote.status === 'superseded' && (
            <Alert tone="info">この版は改訂済みです。最新の版から編集してください。</Alert>
          )}
          {isAdmin && <QuoteStatusForm quote={quote} request={request} />}
        </div>
      </section>

      <section id="plan-board" className="scroll-mt-6">
        <h2 className="mb-3 text-lg">プランボード</h2>
        <div className="card p-5 text-sm">
          <p className="font-semibold">{quote.base_model_name}</p>
          <p className="mt-1 text-ink-soft">この案件に紐づく保存済みの仕様を確認します。</p>
          {isAdmin ? (
            <Link href={`/admin/configurations/${quote.configuration_id}`} className="btn-secondary btn-sm mt-4">保存された仕様を確認</Link>
          ) : (
            <p className="mt-4 text-xs text-muted">保存された仕様の確認は、閲覧権限のある利用者が行います。</p>
          )}
        </div>
      </section>

      <section id="case-documents" className="scroll-mt-6">
        <h2 className="mb-3 text-lg">契約・図面・資料</h2>
        <div className="card p-5 text-sm text-muted">
          契約書・図面・案件資料の正式な保存・管理機能は、今後の工程で対応予定です。
        </div>
      </section>

      <section id="manufacturing" className="scroll-mt-6">
        <h2 className="mb-3 text-lg">製造・施工</h2>
        <div className="card p-5 text-sm text-muted">製造・施工の正式な進捗管理機能は、今後の工程で対応予定です。</div>
      </section>

      <section id="handover" className="scroll-mt-6">
        <h2 className="mb-3 text-lg">引渡し・アフター</h2>
        <div className="card p-5 text-sm text-muted">引渡し・アフター対応の正式な管理機能は、今後の工程で対応予定です。</div>
      </section>
    </AdminPage>
  );
}
