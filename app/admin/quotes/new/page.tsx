import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { QUOTE_STATUS_LABELS } from '@/lib/domain/types';
import { AdminPage } from '@/components/admin/ui';
import { ManualQuoteWorkbench } from '@/components/admin/manual-quote-workbench';
import { QuoteManagementTabs } from '@/components/admin/quote-management-tabs';

/**
 * 対面・電話・紹介など、Web見積依頼を経由しない案件を新規登録する入口。
 * 案件情報と最初のQuote Draftを作り、登録後の業務は案件管理へ引き継ぐ。
 */
export default async function AdminNewQuotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin('/admin/quotes/new');
  const sp = await searchParams;
  const returnTo = sp.return_to === '/admin/quote-management' ? '/admin/quote-management' : '/admin/quotes';
  const store = await getStore();
  const [models, quotes, requests, options, categories] = await Promise.all([
    store.listModels(),
    store.listAllQuotes(),
    store.listQuoteRequests(),
    store.listOptions(),
    store.listCategories(),
  ]);
  const requestById = new Map(requests.map((request) => [request.id, request] as const));

  const estimates = quotes
    .map((quote) => ({
      id: quote.id,
      quote_no: quote.quote_no,
      case_name: requestById.get(quote.quote_request_id)?.case_name ?? null,
      customer_name: quote.customer_name,
      customer_company: quote.customer_company,
      base_model_name: quote.base_model_name,
      revision: quote.revision,
      total: quote.total,
      status_label: QUOTE_STATUS_LABELS[quote.status],
      updated_at: quote.updated_at,
    }));

  const categoryMap = new Map(categories.map((category) => [category.id, category] as const));
  const products = options
    .filter((option) => option.status === 'published')
    .map((option) => ({
      id: option.id,
      baseModelId: option.base_model_id,
      categoryId: option.category_id,
      categoryCode: categoryMap.get(option.category_id)?.code ?? '',
      categoryName: categoryMap.get(option.category_id)?.name ?? '未分類',
      name: option.name,
      manufacturer: option.manufacturer ?? '',
      modelNo: option.model_no ?? '',
      sizeNote: option.size_note ?? '',
      price: option.price,
      priceOnRequest: option.price_on_request,
      imageUrl: option.image_url,
      specCodes: option.spec_codes ?? [],
    }));

  return (
    <AdminPage
      title="新規案件登録・初回見積"
      lead="対面・電話・紹介などの非Web案件を登録し、案件管理へ引き継ぐための最初の見積下書きを作成"
    >
      <QuoteManagementTabs active="case" />
      <ManualQuoteWorkbench
        models={models.map((model) => ({
          id: model.id,
          name: model.name,
          presets: (model.presets ?? []).map((preset) => ({
            code: preset.code,
            name: preset.name,
            description: preset.description,
          })),
        }))}
        estimates={estimates}
        products={products}
        returnTo={returnTo}
        canEditBase
      />
    </AdminPage>
  );
}