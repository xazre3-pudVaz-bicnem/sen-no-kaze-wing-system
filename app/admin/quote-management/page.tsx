import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import type { QuoteStatus } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';
import { AdminPage } from '@/components/admin/ui';
import { QuoteManagementTabs } from '@/components/admin/quote-management-tabs';
import { CaseEstimateSelectableRow } from '@/components/admin/case-estimate-selectable-row';
import {
  CASE_ESTIMATE_SPEC_LABELS,
  CaseEstimateReview,
  type CaseEstimateReviewSelection,
} from '@/components/admin/case-estimate-review';

const CASE_ESTIMATE_STATUS_LABELS: Record<QuoteStatus, string> = {
  issued: 'お客様確認待ち',
  accepted: 'お客様承諾済み',
  expired: '期限切れ',
  superseded: '旧版（新しい版あり）',
  cancelled: '取消済み',
  declined: 'お客様辞退',
};

type CaseEstimateRow = {
  key: string;
  selection: CaseEstimateReviewSelection;
  caseName: string;
  customerName: string;
  customerCompany: string | null;
  quoteNo: string | null;
  revision: number | null;
  modelName: string;
  specCode: string | null;
  statusLabel: string;
  total: number | null;
  updatedAt: string;
  draft: boolean;
  dealerId: string | null;
  dealerCompany: string | null;
  dealerName: string | null;
};

function specLabel(specCode: string | null) {
  if (!specCode) return '—';
  return CASE_ESTIMATE_SPEC_LABELS[specCode] ?? specCode;
}

function dealerPrimary(row: CaseEstimateRow) {
  if (!row.dealerId) return '未担当';
  return row.dealerCompany?.trim() || row.dealerName?.trim() || '担当者情報未取得';
}

function dealerSecondary(row: CaseEstimateRow) {
  if (!row.dealerId || !row.dealerCompany?.trim() || !row.dealerName?.trim()) return null;
  return row.dealerName.trim();
}

function matchesQuery(row: CaseEstimateRow, query: string) {
  if (!query) return true;
  const haystack = [
    row.dealerCompany ?? '',
    row.dealerName ?? '',
    row.caseName,
    row.customerName,
    row.customerCompany ?? '',
    row.quoteNo ?? '',
    row.modelName,
    specLabel(row.specCode),
    row.statusLabel,
  ]
    .join(' ')
    .toLocaleLowerCase('ja-JP');
  return haystack.includes(query.toLocaleLowerCase('ja-JP'));
}

function matchesDealer(row: CaseEstimateRow, dealerFilter: string) {
  if (!dealerFilter) return true;
  if (dealerFilter === 'unassigned') return row.dealerId === null;
  return row.dealerId === dealerFilter;
}

function selectionHref(row: CaseEstimateRow, query: string, dealerFilter: string) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (dealerFilter) params.set('dealer', dealerFilter);
  params.set(row.selection.kind, row.selection.id);
  return `/admin/quote-management?${params.toString()}#case-estimate-review`;
}

export default async function AdminQuoteManagementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireAdmin('/admin/quote-management');
  const sp = await searchParams;
  const store = await getStore();
  const showStandardDraftPreparation = actor.role === 'admin';

  const [quotes, requests, draftResumes, dealers, models] = await Promise.all([
    store.listAllQuotes(),
    store.listQuoteRequests(),
    store.listInitialQuoteDraftResumes(actor),
    store.listCaseDealers(),
    store.listModels({ includeDraft: true }),
  ]);

  const draftDetails = await Promise.all(
    draftResumes.map(async (resume) => ({
      draftId: resume.draft_id,
      detail: await store.getQuoteDraft(resume.draft_id, actor),
    }))
  );

  const requestById = new Map(requests.map((request) => [request.id, request] as const));
  const dealerById = new Map(dealers.map((dealer) => [dealer.id, dealer] as const));
  const modelById = new Map(models.map((model) => [model.id, model.name] as const));
  const draftDetailById = new Map(
    draftDetails
      .filter((entry) => entry.detail !== null)
      .map((entry) => [entry.draftId, entry.detail!] as const)
  );

  const formalRows: CaseEstimateRow[] = quotes.map((quote) => {
    const request = requestById.get(quote.quote_request_id);
    const dealer = quote.dealer_id ? dealerById.get(quote.dealer_id) : null;
    return {
      key: `quote-${quote.id}`,
      selection: { kind: 'quote' as const, id: quote.id },
      caseName: request?.case_name || quote.customer_name || '案件名未設定',
      customerName: quote.customer_name || request?.contact.full_name || '未登録',
      customerCompany: quote.customer_company ?? request?.contact.company_name ?? null,
      quoteNo: quote.quote_no,
      revision: quote.revision,
      modelName: quote.base_model_name || request?.configuration?.model_name || '—',
      specCode: quote.spec_code ?? null,
      statusLabel: CASE_ESTIMATE_STATUS_LABELS[quote.status],
      total: quote.total,
      updatedAt: quote.updated_at,
      draft: false,
      dealerId: quote.dealer_id,
      dealerCompany: dealer?.company_name ?? null,
      dealerName: dealer?.full_name ?? null,
    };
  });

  const draftRows: CaseEstimateRow[] = draftResumes.map((resume) => {
    const detail = draftDetailById.get(resume.draft_id);
    const request = requestById.get(resume.quote_request_id);
    return {
      key: `draft-${resume.draft_id}`,
      selection: { kind: 'draft' as const, id: resume.draft_id },
      caseName: request?.case_name || request?.contact.full_name || '案件名未設定',
      customerName: request?.contact.full_name || '未登録',
      customerCompany: request?.contact.company_name ?? null,
      quoteNo: null,
      revision: null,
      modelName:
        (detail ? modelById.get(detail.draft.base_model_id) : null) ||
        request?.configuration?.model_name ||
        '—',
      specCode: detail?.draft.spec_code ?? null,
      statusLabel: '下書き',
      total: detail?.draft.total ?? null,
      updatedAt: resume.updated_at,
      draft: true,
      dealerId: null,
      dealerCompany: null,
      dealerName: null,
    };
  });

  const query = (sp.q ?? '').trim();
  const dealerFilter = (sp.dealer ?? '').trim();
  const allRows = [...draftRows, ...formalRows];
  const rows = allRows
    .filter((row) => matchesQuery(row, query))
    .filter((row) => matchesDealer(row, dealerFilter))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const requestedKey = sp.quote
    ? `quote-${sp.quote}`
    : sp.draft
      ? `draft-${sp.draft}`
      : null;
  const selectedRow =
    (requestedKey ? rows.find((row) => row.key === requestedKey) : null) ??
    rows[0] ??
    null;

  return (
    <AdminPage title="見積書管理">
      <QuoteManagementTabs active="case" />

      <section className="rounded-lg border border-line bg-white shadow-sm">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-semibold">案件見積一覧</h2>
          <p className="mt-0.5 text-xs text-muted">
            見積を選択すると下部で確認できます。編集は案件管理から行います。
          </p>
        </div>

        <form method="get" className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="担当代理店・案件名・顧客名・会社名・商品モデルで検索"
            className="h-9 min-w-[18rem] flex-1 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-forest"
          />
          <select
            name="dealer"
            defaultValue={dealerFilter}
            aria-label="担当代理店で絞り込み"
            className="h-9 min-w-[12rem] rounded-lg border border-line bg-white px-2.5 text-sm outline-none focus:border-forest"
          >
            <option value="">担当代理店：すべて</option>
            <option value="unassigned">未担当</option>
            {dealers.map((dealer) => {
              const company = dealer.company_name?.trim();
              const name = dealer.full_name?.trim();
              const label = company ? (name ? `${company} ／ ${name}` : company) : name || '名称未登録';
              return (
                <option key={dealer.id} value={dealer.id}>
                  {label}
                </option>
              );
            })}
          </select>
          <button type="submit" className="btn-secondary btn-sm">
            検索
          </button>
          {(query || dealerFilter) && (
            <Link href="/admin/quote-management" className="btn-secondary btn-sm">
              クリア
            </Link>
          )}
          <span className="ml-auto text-xs text-muted">
            表示 {rows.length}件 / 全{allRows.length}件
          </span>
        </form>

        <div className="overflow-hidden">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-[#eef3f2] text-[#536771]">
              <tr>
                <th className="w-[18%] px-2 py-2 text-left font-semibold">担当代理店</th>
                <th className="w-[31%] px-2 py-2 text-left font-semibold">顧客・案件</th>
                <th className="w-[9%] px-2 py-2 text-left font-semibold">モデル</th>
                <th className="w-[10%] px-2 py-2 text-left font-semibold">仕様</th>
                <th className="w-[7%] px-2 py-2 text-center font-semibold">版</th>
                <th className="w-[14%] px-2 py-2 text-left font-semibold">状態</th>
                <th className="w-[11%] px-2 py-2 text-right font-semibold">金額（税込）</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selected = selectedRow?.key === row.key;
                const href = selectionHref(row, query, dealerFilter);
                const secondaryDealer = dealerSecondary(row);
                return (
                  <CaseEstimateSelectableRow
                    key={row.key}
                    href={href}
                    selected={selected}
                  >
                    <td className="px-2 py-2 align-middle">
                      <p className={row.dealerId ? 'truncate font-semibold' : 'truncate font-semibold text-muted'}>
                        {dealerPrimary(row)}
                      </p>
                      {secondaryDealer ? (
                        <p className="mt-0.5 truncate text-[11px] text-muted">{secondaryDealer}</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {row.customerName}
                          {row.customerCompany ? ` ／ ${row.customerCompany}` : ''}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted">{row.caseName}</p>
                      </div>
                    </td>
                    <td className="truncate px-2 py-2 align-middle">{row.modelName}</td>
                    <td className="truncate px-2 py-2 align-middle">{specLabel(row.specCode)}</td>
                    <td className="px-2 py-2 text-center align-middle font-semibold">
                      {row.draft ? '—' : `第${row.revision}版`}
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <span
                        className={
                          row.draft
                            ? 'rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900'
                            : row.statusLabel === '旧版（新しい版あり）'
                              ? 'rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600'
                              : 'rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900'
                        }
                      >
                        {row.statusLabel}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right align-middle">
                      <p className="font-semibold tabular-nums">{row.total == null ? '—' : formatYen(row.total)}</p>
                      <p className="mt-0.5 whitespace-nowrap text-[10px] text-muted">更新 {formatDate(row.updatedAt, true)}</p>
                    </td>
                  </CaseEstimateSelectableRow>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted">
                    {query || dealerFilter ? '検索・絞り込み条件に一致する案件見積がありません。' : '案件見積はまだありません。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedRow ? (
        <>
          {showStandardDraftPreparation &&
            selectedRow.selection.kind === 'quote' &&
            (!sp.detail_tab || sp.detail_tab === 'estimate') && (
              <div
                className="flex flex-wrap items-center justify-end gap-2"
                data-testid="case-estimate-standard-draft-entry"
              >
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="btn-secondary btn-sm cursor-not-allowed opacity-50"
                  data-testid="case-estimate-standard-draft-button"
                >
                  この見積から標準案を作る
                </button>
                <span className="text-xs font-semibold text-muted">準備中</span>
              </div>
            )}
          <CaseEstimateReview
            selection={selectedRow.selection}
            actor={actor}
            query={query}
            dealerFilter={dealerFilter}
            requestedTab={sp.detail_tab}
            listModelName={selectedRow.modelName}
          />
        </>
      ) : (
        <div className="rounded-lg border border-line bg-white px-4 py-3 text-xs text-muted">
          案件見積を選択すると、ここに見積書・プランボード・図面の確認内容を表示します。
        </div>
      )}
    </AdminPage>
  );
}
