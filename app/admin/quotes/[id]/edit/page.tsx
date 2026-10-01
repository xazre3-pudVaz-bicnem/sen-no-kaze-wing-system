import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { FREE_PRODUCT_CATEGORY_CODE, canEditCatalog } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { QuoteManagementTabs } from '@/components/admin/quote-management-tabs';
import { DealerRevisionForm } from '@/components/admin/dealer-forms';
import { Badge } from '@/components/ui';

export default async function AdminQuoteRevisionEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaff();
  const { id } = await params;
  const store = await getStore();
  const detail = await store.getQuote(id, actor);
  if (!detail) notFound();

  const { quote, request } = detail;
  const canAccess = actor.role === 'admin' || quote.dealer_id === actor.id;
  const isLegacyWebRevision =
    quote.configuration_id !== null &&
    quote.status === 'issued' &&
    canAccess;

  if (!isLegacyWebRevision) notFound();

  const [categories, options] = await Promise.all([
    store.listCategories(),
    store.listOptions(),
  ]);

  const freeCategory = categories.find((category) => category.code === FREE_PRODUCT_CATEGORY_CODE);
  const freeProducts = options
    .filter(
      (option) =>
        option.category_id === freeCategory?.id &&
        option.status === 'published' &&
        (actor.role === 'admin' || option.owner_id === actor.id)
    )
    .map((option) => ({ code: option.code, name: option.name, price: option.price }));

  const catalogByCategory = new Map(categories.map((category) => [category.id, category.name]));
  const catalog = options
    .filter((option) => option.status === 'published')
    .map((option) => ({
      code: option.code,
      name: option.name,
      category: catalogByCategory.get(option.category_id) ?? 'その他',
      price: option.price,
      price_on_request: option.price_on_request,
      image_url: option.image_url,
      manufacturer: option.manufacturer,
    }));

  const caseName =
    request?.case_name?.trim() ||
    request?.contact.company_name ||
    request?.contact.full_name ||
    quote.customer_company ||
    quote.customer_name;

  const returnHref = `/admin/quotes?case=${encodeURIComponent(quote.id)}&tab=estimate#case-workspace`;

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-3" data-testid="legacy-revision-edit-page">
      <QuoteManagementTabs active="case" />

      <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-[#f7faf8] px-4 py-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">第{quote.revision + 1}版 見積編集</h1>
              <Badge tone="neutral">未発行</Badge>
            </div>
            <p className="mt-1 text-xs text-muted">
              発行済みの第{quote.revision}版は変更せず、次の版として編集します。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={returnHref} className="btn-secondary btn-sm" data-testid="revision-edit-return-case">
              案件へ戻る
            </Link>
            <a
              href={`/api/quotes/${quote.id}/pdf`}
              target="_blank"
              rel="noopener"
              className="btn-secondary btn-sm"
            >
              現在の見積PDF
            </a>
          </div>
        </div>

        <div className="grid gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-2 text-[11px] sm:grid-cols-2 lg:grid-cols-5">
          <div><span className="text-muted">案件</span><strong className="ml-1">{caseName}</strong></div>
          <div><span className="text-muted">お客様</span><strong className="ml-1">{request?.contact.full_name || quote.customer_name}</strong></div>
          <div><span className="text-muted">商品モデル</span><strong className="ml-1">{quote.base_model_name}</strong></div>
          <div><span className="text-muted">現在の発行済み見積</span><strong className="ml-1">第{quote.revision}版</strong></div>
          <div><span className="text-muted">現在の見積金額</span><strong className="ml-1">{formatYen(quote.total)}</strong></div>
        </div>

        <DealerRevisionForm
          quote={quote}
          items={detail.items}
          freeProducts={freeProducts}
          catalog={catalog}
          canEditBase={canEditCatalog(actor.role)}
          sheetMode
        />
      </section>
    </div>
  );
}
