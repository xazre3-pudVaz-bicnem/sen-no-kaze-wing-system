import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getStore, StoreError } from '@/lib/data/store';
import { canEditCatalog, QUOTE_STATUS_LABELS } from '@/lib/domain/types';
import { QuoteDraftEditor } from '@/components/admin/quote-draft-editor';
import { Alert } from '@/components/ui';
import { QuoteManagementTabs } from '@/components/admin/quote-management-tabs';

export default async function AdminQuoteDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const store = await getStore();

  let detail;
  try {
    detail = await store.getQuoteDraft(id, actor);
  } catch (error) {
    if (error instanceof StoreError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  if (!detail) notFound();

  const model = await store.getModelById(detail.draft.base_model_id, { includeDraft: true });

  const estimates =
    actor.role === 'admin'
      ? await (async () => {
          const [quotes, requests] = await Promise.all([
            store.listAllQuotes(),
            store.listQuoteRequests(),
          ]);
          const requestById = new Map(requests.map((request) => [request.id, request] as const));
          return quotes
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
        })()
      : (await store.listDealerQuotes(actor.id))
          .filter((quote) => quote.status !== 'superseded')
          .map((quote) => ({
            id: quote.id,
            quote_no: quote.quote_no,
            case_name: null,
            customer_name: quote.customer_name,
            customer_company: quote.customer_company,
            base_model_name: quote.base_model_name,
            revision: quote.revision,
            total: quote.total,
            status_label: QUOTE_STATUS_LABELS[quote.status],
            updated_at: quote.updated_at,
          }));

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-2">
      <QuoteManagementTabs active="case" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/quotes" className="text-sm text-ink-soft underline-offset-4 hover:underline">
          ← 案件一覧へ戻る
        </Link>
        <span className="rounded-lg bg-[#edf3f6] px-3 py-2 text-xs font-semibold text-[#365467]">
          Draft編集中
        </span>
      </div>

      {sp.created && (
        <Alert tone="success">
          案件を登録しました。まだ見積Revisionは発行していません。Draftを編集・保存してください。
        </Alert>
      )}
      {sp.revisionDraft && (
        <Alert tone="success">
          現在の正式Revisionをコピーして改訂Draftを作成しました。Draft保存だけでは正式Revisionは増えません。
        </Alert>
      )}

      <QuoteDraftEditor
        detail={detail}
        modelName={model?.name ?? '商品モデル'}
        canEditBase={canEditCatalog(actor.role)}
        estimates={estimates}
      />
    </div>
  );
}
