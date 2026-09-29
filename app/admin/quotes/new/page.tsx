import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { QUOTE_STATUS_LABELS } from '@/lib/domain/types';
import { AdminPage } from '@/components/admin/ui';
import { ManualQuoteWorkbench } from '@/components/admin/manual-quote-workbench';

/**
 * 案件管理から直接開く、見積書作成の共通ワークスペース。
 * 案件情報を別画面で先に登録せず、Excel型明細と同じ画面で初回Draftを作る。
 */
export default async function AdminNewQuotePage() {
  const actor = await requireAdmin('/admin/quotes/new');
  const store = await getStore();
  const [models, quotes] = await Promise.all([
    store.listModels(),
    store.listAllQuotes(),
  ]);

  const estimates = quotes
    .filter((quote) => quote.status !== 'superseded')
    .map((quote) => ({
      id: quote.id,
      quote_no: quote.quote_no,
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
      title="見積書を作成"
      lead="案件情報と見積明細を同じ画面で入力します。下書き保存までは正式な見積Revisionを発行しません。"
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
