import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { QUOTE_STATUS_LABELS } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';
import { AdminPage } from '@/components/admin/ui';
import { QuoteManagementTabs } from '@/components/admin/quote-management-tabs';

type CaseEstimateRow = {
  key: string;
  href: string;
  caseName: string;
  customerName: string;
  customerCompany: string | null;
  quoteNo: string | null;
  revision: number | null;
  modelName: string;
  statusLabel: string;
  total: number | null;
  updatedAt: string;
  draft: boolean;
};

function matchesQuery(row: CaseEstimateRow, query: string) {
  if (!query) return true;
  const haystack = [
    row.caseName,
    row.customerName,
    row.customerCompany ?? '',
    row.quoteNo ?? '',
    row.modelName,
    row.statusLabel,
  ]
    .join(' ')
    .toLocaleLowerCase('ja-JP');
  return haystack.includes(query.toLocaleLowerCase('ja-JP'));
}

export default async function AdminQuoteManagementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireAdmin('/admin/quote-management');
  const sp = await searchParams;
  const store = await getStore();

  const [quotes, requests, draftResumes] = await Promise.all([
    store.listAllQuotes(),
    store.listQuoteRequests(),
    store.listInitialQuoteDraftResumes(actor),
  ]);

  const requestById = new Map(requests.map((request) => [request.id, request] as const));

  const formalRows: CaseEstimateRow[] = quotes
    .filter((quote) => quote.status !== 'superseded')
    .map((quote) => {
      const request = requestById.get(quote.quote_request_id);
      return {
        key: `quote-${quote.id}`,
        href: `/admin/quotes?case=${quote.id}&tab=estimate#case-workspace`,
        caseName: request?.case_name || quote.customer_name || '案件名未設定',
        customerName: quote.customer_name || request?.contact.full_name || '未登録',
        customerCompany: quote.customer_company ?? request?.contact.company_name ?? null,
        quoteNo: quote.quote_no,
        revision: quote.revision,
        modelName: quote.base_model_name || request?.configuration?.model_name || '—',
        statusLabel: QUOTE_STATUS_LABELS[quote.status],
        total: quote.total,
        updatedAt: quote.updated_at,
        draft: false,
      };
    });

  const draftRows: CaseEstimateRow[] = draftResumes.map((draft) => {
    const request = requestById.get(draft.quote_request_id);
    return {
      key: `draft-${draft.draft_id}`,
      href: `/admin/quotes/drafts/${draft.draft_id}`,
      caseName: request?.case_name || request?.contact.full_name || '案件名未設定',
      customerName: request?.contact.full_name || '未登録',
      customerCompany: request?.contact.company_name ?? null,
      quoteNo: null,
      revision: null,
      modelName: request?.configuration?.model_name || '—',
      statusLabel: '下書き',
      total: null,
      updatedAt: draft.updated_at,
      draft: true,
    };
  });

  const query = (sp.q ?? '').trim();
  const rows = [...draftRows, ...formalRows]
    .filter((row) => matchesQuery(row, query))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <AdminPage
      title="見積書管理"
      lead="案件見積"
      actions={
        <Link href="/admin/quotes/new" className="btn-primary btn-sm">
          ＋ 新しい案件見積
        </Link>
      }
    >
      <QuoteManagementTabs active="case" />

      <section className="rounded-lg border border-line bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-semibold">案件見積一覧</h2>
            <p className="mt-0.5 text-xs text-muted">
              作成途中のDraftと、発行済みの現在Revisionを同じ一覧から開けます。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-line bg-sand px-2.5 py-1">
              全体 <strong>{draftRows.length + formalRows.length}</strong>
            </span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-900">
              下書き <strong>{draftRows.length}</strong>
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-900">
              正式見積 <strong>{formalRows.length}</strong>
            </span>
          </div>
        </div>

        <form method="get" className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="案件名・顧客名・会社名・見積番号・商品モデルで検索"
            className="h-9 min-w-[18rem] flex-1 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-forest"
          />
          <button type="submit" className="btn-secondary btn-sm">
            検索
          </button>
          {query && (
            <Link href="/admin/quote-management" className="btn-secondary btn-sm">
              クリア
            </Link>
          )}
        </form>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[62rem] table-fixed text-sm lg:min-w-0">
            <thead className="bg-[#eef3f2] text-[#536771]">
              <tr>
                <th className="w-[31%] px-3 py-2 text-left font-semibold">案件・顧客</th>
                <th className="w-[14%] px-2 py-2 text-left font-semibold">見積番号</th>
                <th className="w-[12%] px-2 py-2 text-left font-semibold">商品モデル</th>
                <th className="w-[10%] px-2 py-2 text-left font-semibold">状態</th>
                <th className="w-[14%] px-2 py-2 text-right font-semibold">金額</th>
                <th className="w-[12%] px-2 py-2 text-left font-semibold">更新</th>
                <th className="w-[7%] px-2 py-2 text-center font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-line hover:bg-[#f8faf9]">
                  <td className="px-3 py-2 align-middle">
                    <p className="truncate font-semibold">{row.caseName}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {row.customerName}
                      {row.customerCompany ? ` ／ ${row.customerCompany}` : ''}
                    </p>
                  </td>
                  <td className="px-2 py-2 align-middle font-mono text-xs">
                    {row.draft ? (
                      <span className="text-muted">未発行</span>
                    ) : (
                      <>
                        {row.quoteNo}
                        <span className="ml-1 text-muted">Rev{row.revision}</span>
                      </>
                    )}
                  </td>
                  <td className="truncate px-2 py-2 align-middle">{row.modelName}</td>
                  <td className="px-2 py-2 align-middle">
                    <span
                      className={
                        row.draft
                          ? 'rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900'
                          : 'rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900'
                      }
                    >
                      {row.statusLabel}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right align-middle font-semibold tabular-nums">
                    {row.total == null ? '—' : formatYen(row.total)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 align-middle text-xs text-muted">
                    {formatDate(row.updatedAt, true)}
                  </td>
                  <td className="px-2 py-2 text-center align-middle">
                    <Link href={row.href} className="text-sm font-semibold text-forest underline underline-offset-4">
                      開く
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted">
                    {query ? '検索条件に一致する案件見積がありません。' : '案件見積はまだありません。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminPage>
  );
}
