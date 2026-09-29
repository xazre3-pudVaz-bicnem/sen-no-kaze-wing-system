import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { QUOTE_STATUS_LABELS } from '@/lib/domain/types';
import { AdminPage } from '@/components/admin/ui';
import { ManualQuoteWorkbench } from '@/components/admin/manual-quote-workbench';

/**
 * 案件管理・見積書管理のどちらからでも開く、正式な見積編集ワークスペース。
 * Quote Draft lifecycleは変更せず、案件情報とExcel型明細を同じ画面で扱う。
 */
export default async function AdminNewQuotePage() {
  await requireAdmin('/admin/quotes/new');
  const store = await getStore();
  const [models, quotes, requests] = await Promise.all([
    store.listModels(),
    store.listAllQuotes(),
    store.listQuoteRequests(),
  ]);
  const requestById = new Map(requests.map((request) => [request.id, request] as const));

  const estimates = quotes
    .filter((quote) => quote.status !== 'superseded')
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

  return (
    <AdminPage
      title="見積書管理"
      lead="見積書を作成"
    >
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
        canEditBase
      />
    </AdminPage>
  );
}
