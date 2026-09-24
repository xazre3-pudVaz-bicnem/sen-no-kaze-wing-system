import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import {
  canEditCatalog,
  FINISH_LEVEL_INFO,
  QUOTE_REQUEST_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  ROLE_LABELS,
} from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { CaseManagementNav } from '@/components/admin/case-management-nav';
import { CaseWorkspace } from '@/components/admin/case-workspace';
import { matchesRegion, parseAddress, PREFECTURES, readRegionFilter } from '@/lib/domain/address';

const SPEC_LABELS: Record<string, string> = {
  base: '本体のみ',
  hotel: 'ホテル仕様',
  'hotel-single': 'ホテル・単身者',
  residence: '住宅仕様',
  'water-kit': '水回りキット',
  office: '事務所・店舗',
};

function quoteStatusTone(status: keyof typeof QUOTE_STATUS_LABELS) {
  if (status === 'accepted') return 'success' as const;
  if (status === 'issued') return 'navy' as const;
  return 'neutral' as const;
}

function CaseSummary({
  caseCount,
  newCount,
  quotedCount,
  acceptedCount,
  quoteTotal,
  filtered,
}: {
  caseCount: number;
  newCount: number;
  quotedCount: number;
  acceptedCount: number;
  quoteTotal: number;
  filtered: boolean;
}) {
  return (
    <section
      aria-label="案件集計"
      className="rounded-lg border border-[#dbe4df] bg-white px-3 py-2 shadow-sm"
      data-testid="case-summary-strip"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.7rem]">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid="case-summary-status">
          <span className="font-semibold text-[#315745]">案件状況</span>
          <span className="text-muted">案件</span>
          <strong className="text-xs text-ink">{caseCount}</strong>
          <span className="text-muted">新規依頼</span>
          <strong className={newCount > 0 ? 'rounded-full bg-[#fff1d7] px-1.5 py-0.5 text-[#8a5a20]' : 'text-ink'}>{newCount}</strong>
          <span className="text-muted">見積あり</span>
          <strong className="text-ink">{quotedCount}</strong>
          <span className="text-muted">承諾</span>
          <strong className="text-ink">{acceptedCount}</strong>
        </div>

        <span className="hidden h-4 w-px bg-line md:block" aria-hidden="true" />

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid="case-summary-finance">
          <span className="font-semibold text-[#315745]">収支</span>
          <span className="text-muted">{filtered ? '表示中の見積金額合計' : '各案件の現在金額合計'}</span>
          <strong className="text-xs tabular-nums text-ink">{formatYen(quoteTotal)}</strong>
          <span className="text-muted">原価</span>
          <strong className="text-muted">—</strong>
          <span className="text-muted">利益</span>
          <strong className="text-muted">—</strong>
          <span className="text-muted">利益率</span>
          <strong className="text-muted">—</strong>
        </div>

        <span className="hidden h-4 w-px bg-line md:block" aria-hidden="true" />

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid="case-summary-disaster">
          <span className="font-semibold text-[#315745]">災害時供給</span>
          <span className="text-muted">登録</span>
          <strong className="text-muted">—</strong>
          <span className="text-muted">供給可</span>
          <strong className="text-muted">—</strong>
          <span className="text-muted">要確認</span>
          <strong className="rounded-full border border-[#ead6a9] bg-[#fff8e8] px-1.5 py-0.5 text-[#8a5a20]">未登録</strong>
        </div>
      </div>
    </section>
  );
}

function CasePageHeading({ role, caseCount }: { role: keyof typeof ROLE_LABELS; caseCount: number }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">案件管理</h1>
        <p className="mt-0.5 text-xs text-ink-soft">
          Web見積依頼と、対面・電話・紹介で受け付けた案件をまとめて管理します。案件を選択すると下に作業領域を表示します。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link
          href="/admin/quotes/new"
          className="inline-flex items-center rounded-lg bg-[#2f6b4f] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#285d45]"
          data-testid="new-quote-link"
        >
          ＋対面・電話・紹介の案件受付
        </Link>
        <span className="rounded-lg bg-[#edf3f6] px-3 py-2 text-[0.68rem] font-semibold text-[#365467]">{ROLE_LABELS[role]}</span>
      </div>
    </div>
  );
}

function caseSelectionHref(quoteId: string, sp: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const key of ['q', 'status', 'dealer', 'pref', 'city']) {
    const value = sp[key];
    if (value) query.set(key, value);
  }
  query.set('case', quoteId);
  return `/admin/quotes?${query.toString()}`;
}

function requestSelectionHref(requestId: string, sp: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const key of ['q', 'status', 'dealer', 'pref', 'city']) {
    const value = sp[key];
    if (value) query.set(key, value);
  }
  query.set('request', requestId);
  return `/admin/quotes?${query.toString()}#pending-quote-request`;
}

export default async function AdminQuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const store = await getStore();

  // 代理店は自分に割り当てられた案件だけ。既存の権限・Quote lifecycleは変更しない。
  if (!canEditCatalog(actor.role)) {
    const mine = await store.listDealerQuotes(actor.id);
    const latest = mine.filter((q) => q.status !== 'superseded');
    const details = await Promise.all(latest.map((q) => store.getQuote(q.id, actor)));
    const requestByQuoteId = new Map(
      details.flatMap((detail) => (detail?.request ? [[detail.quote.id, detail.request] as const] : []))
    );
    const quoteTotal = latest.reduce((sum, quote) => sum + quote.total, 0);
    const newCount = latest.filter((quote) => requestByQuoteId.get(quote.id)?.status === 'new').length;
    const acceptedCount = latest.filter((quote) => quote.status === 'accepted').length;
    const requestedCase = sp.case && latest.some((quote) => quote.id === sp.case) ? sp.case : null;
    const selectedQuoteId = requestedCase ?? latest[0]?.id ?? null;

    return (
      <div className="mx-auto w-full max-w-[96rem] space-y-2.5">
        <CasePageHeading role={actor.role} caseCount={latest.length} />
        <CaseManagementNav role={actor.role} active="cases" />
        <CaseSummary
          caseCount={latest.length}
          newCount={newCount}
          quotedCount={latest.length}
          acceptedCount={acceptedCount}
          quoteTotal={quoteTotal}
          filtered={false}
        />

        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-3 py-2">
            <div>
              <h2 className="text-sm font-semibold">担当案件</h2>
              <p className="text-[0.68rem] text-muted">案件を選択すると、下のワークスペースが切り替わります。</p>
            </div>
            <span className="rounded-full border border-[#d7e2dc] bg-[#f3f8f5] px-2 py-0.5 text-[0.65rem] font-semibold text-[#3d6450]">
              {latest.length}件
            </span>
          </div>
          <div data-testid="case-list-scroll">
            <table className="w-full table-fixed text-[0.72rem]">
              <thead className="sticky top-0 z-10 bg-[#eef3f2] text-[#536771]">
                <tr>
                  <th className="w-[22%] px-2.5 py-1.5 text-left font-semibold">案件・顧客</th>
                  <th className="w-[16%] px-2.5 py-1.5 text-left font-semibold">状態</th>
                  <th className="w-[20%] px-2.5 py-1.5 text-left font-semibold">設置予定地</th>
                  <th className="w-[12%] px-2.5 py-1.5 text-left font-semibold">商品モデル</th>
                  <th className="w-[14%] px-2.5 py-1.5 text-right font-semibold">見積額</th>
                  <th className="w-[16%] px-2.5 py-1.5 text-left font-semibold">担当</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((q) => {
                  const request = requestByQuoteId.get(q.id);
                  const selected = q.id === selectedQuoteId;
                  return [
                    <tr
                      key={`${q.id}-main`}
                      className={selected ? 'bg-[#fff7df] shadow-[inset_0_1px_0_#ead7a8]' : 'hover:bg-[#f8fbf9]'}
                      data-testid="dealer-quote-row"
                      data-selected={selected ? 'true' : undefined}
                    >
                      <td className={`border-l-4 px-2.5 py-1.5 align-top ${selected ? 'border-[#2f6b4f]' : 'border-transparent'}`}>
                        <div className="flex items-center gap-1.5">
                          <Link href={caseSelectionHref(q.id, sp)} className="min-w-0 truncate font-semibold text-ink hover:underline">
                            {q.customer_name}
                          </Link>
                          {selected && (
                            <span className="shrink-0 rounded-full bg-[#7b5a22] px-1.5 py-0.5 text-[0.56rem] font-semibold text-white">選択中</span>
                          )}
                        </div>
                        {q.customer_company && <span className="ml-1 text-[0.64rem] text-muted">{q.customer_company}</span>}
                        <span className="mt-0.5 block font-mono text-[0.62rem] text-muted">見積番号 {q.quote_no}／第{q.revision}版</span>
                      </td>
                      <td className="px-2.5 py-1.5 align-top">
                        <Badge tone={quoteStatusTone(q.status)}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
                        {request && <span className="ml-1 text-[0.62rem] text-muted">依頼：{QUOTE_REQUEST_STATUS_LABELS[request.status]}</span>}
                        <span className="mt-1 block whitespace-nowrap text-[0.6rem] text-muted">更新 {formatDate(q.updated_at, true)}</span>
                      </td>
                      <td className="px-2.5 py-1.5 align-top text-[0.68rem]">{request?.contact.site_address || '—'}</td>
                      <td className="px-2.5 py-1.5 align-top">
                        <strong>{q.base_model_name}</strong>
                        <span className="ml-1 text-[0.62rem] text-muted">{FINISH_LEVEL_INFO[q.finish_level].name}</span>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-right align-top font-semibold tabular-nums">{formatYen(q.total)}</td>
                      <td className="px-2.5 py-1.5 align-top text-[0.68rem]">{selected ? '選択中' : '担当中'}</td>
                    </tr>,
                    <tr
                      key={`${q.id}-meta`}
                      className={`${selected ? 'bg-[#fffaf0]' : 'bg-[#fbfcfb]'} border-b border-line`}
                      data-testid="case-row-meta"
                    >
                      <td colSpan={6} className={`border-l-4 px-2.5 pb-1.5 pt-0.5 ${selected ? 'border-[#2f6b4f]' : 'border-transparent'}`}>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.64rem] text-muted">
                          <span>棟数 <strong className="font-semibold text-muted">—</strong></span>
                          <span>原価 <strong className="font-semibold text-muted">—</strong></span>
                          <span>利益 <strong className="font-semibold text-muted">—</strong></span>
                          <span>利益率 <strong className="font-semibold text-muted">—</strong></span>
                          <span>災害時供給 <strong className="rounded-full border border-[#ead6a9] bg-[#fff8e8] px-1.5 py-0.5 font-semibold text-[#8a5a20]">未登録</strong></span>
                        </div>
                      </td>
                    </tr>,
                  ];
                })}
                {latest.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">割り当てられた案件はまだありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {selectedQuoteId && (
          <CaseWorkspace
            quoteId={selectedQuoteId}
            actor={actor}
            tab={sp.tab}
            revised={sp.revised}
            embedded
            listSearchParams={sp}
          />
        )}
      </div>
    );
  }

  const [requests, quotes, configurations, models, profiles, contacts] = await Promise.all([
    store.listQuoteRequests(),
    store.listAllQuotes(),
    actor.role === 'admin' ? store.listAllConfigurations() : Promise.resolve([]),
    actor.role === 'admin' ? store.listModels({ includeDraft: true }) : Promise.resolve([]),
    actor.role === 'admin' ? store.listProfiles() : Promise.resolve([]),
    actor.role === 'admin' ? store.listContactMessages() : Promise.resolve([]),
  ]);
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  const configurationById = new Map(configurations.map((configuration) => [configuration.id, configuration]));
  const modelNameById = new Map(models.map((model) => [model.id, model.name]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const dealers = profiles.filter((profile) => profile.role_code === 'dealer' || profile.role_code === 'master_dealer');

  const filter = readRegionFilter(sp);
  const addrOf = (r: (typeof requests)[number]) => r.contact.site_address || r.contact.address || '';
  const cityPool = filter.pref
    ? [...new Set(
        requests
          .map((r) => parseAddress(addrOf(r)))
          .filter((a) => a.prefecture === filter.pref && a.city)
          .map((a) => a.city as string)
      )].sort()
    : [];

  const textQuery = (sp.q ?? '').trim().toLocaleLowerCase('ja');
  const statusFilter = sp.status ?? '';
  const dealerFilter = sp.dealer ?? '';

  const shown = requests.filter((request) => {
    if (!matchesRegion(addrOf(request), filter)) return false;

    const quote = request.quote_id ? quoteById.get(request.quote_id) : undefined;
    const configuration = configurationById.get(request.configuration_id);
    const modelName = quote?.base_model_name ?? (configuration ? modelNameById.get(configuration.base_model_id) : undefined) ?? '';
    const dealer = quote?.dealer_id ? profileById.get(quote.dealer_id) : undefined;
    const dealerName = dealer?.company_name ?? dealer?.full_name ?? '';

    if (textQuery) {
      const haystack = [
        request.contact.full_name,
        request.contact.company_name,
        request.contact.site_address,
        request.contact.address,
        request.user_email,
        request.quote_no,
        modelName,
        dealerName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ja');
      if (!haystack.includes(textQuery)) return false;
    }

    if (statusFilter.startsWith('request:') && request.status !== statusFilter.slice('request:'.length)) return false;
    if (statusFilter.startsWith('quote:') && quote?.status !== statusFilter.slice('quote:'.length)) return false;

    if (dealerFilter === 'unassigned' && quote?.dealer_id) return false;
    if (dealerFilter && dealerFilter !== 'unassigned' && quote?.dealer_id !== dealerFilter) return false;

    return true;
  });

  const shownQuotes = shown.flatMap((request) => {
    const quote = request.quote_id ? quoteById.get(request.quote_id) : undefined;
    return quote ? [quote] : [];
  });
  const shownQuoteTotal = shownQuotes.reduce((sum, quote) => sum + quote.total, 0);
  const newCount = shown.filter((request) => request.status === 'new').length;
  const acceptedCount = shownQuotes.filter((quote) => quote.status === 'accepted').length;
  const filtersActive = Boolean(textQuery || statusFilter || dealerFilter || filter.block || filter.pref || filter.city);
  const savedCount = configurations.length;
  const inquiryCount = contacts.filter((contact) => contact.status === 'new').length;

  const selectableQuoteIds = new Set(shownQuotes.map((quote) => quote.id));
  const selectablePendingRequestIds = new Set(shown.filter((request) => !request.quote_id).map((request) => request.id));
  const requestedCase = sp.case && selectableQuoteIds.has(sp.case) ? sp.case : null;
  const requestedPendingRequestId =
    sp.request && selectablePendingRequestIds.has(sp.request) ? sp.request : null;
  const selectedPendingRequest = requestedPendingRequestId
    ? shown.find((request) => request.id === requestedPendingRequestId && !request.quote_id) ?? null
    : null;
  const selectedQuoteId = selectedPendingRequest ? null : requestedCase ?? shownQuotes[0]?.id ?? null;
  const selectedPendingConfiguration = selectedPendingRequest
    ? configurationById.get(selectedPendingRequest.configuration_id)
    : undefined;
  const selectedPendingModelName = selectedPendingConfiguration
    ? modelNameById.get(selectedPendingConfiguration.base_model_id)
    : undefined;
  const selectedPendingSpecName = selectedPendingConfiguration?.spec_code
    ? (SPEC_LABELS[selectedPendingConfiguration.spec_code] ?? selectedPendingConfiguration.spec_code)
    : null;

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-2.5">
      <CasePageHeading role={actor.role} caseCount={requests.length} />
      <CaseManagementNav role={actor.role} active="cases" savedCount={savedCount} inquiryCount={inquiryCount} />
      <CaseSummary
        caseCount={shown.length}
        newCount={newCount}
        quotedCount={shownQuotes.length}
        acceptedCount={acceptedCount}
        quoteTotal={shownQuoteTotal}
        filtered={filtersActive}
      />

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <div className="border-b border-line px-3 py-2">
          <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <h2 className="text-sm font-semibold">案件一覧</h2>
                <p className="text-[0.68rem] text-muted">案件を選択すると、下のワークスペースが切り替わります。</p>
              </div>
              <span className="mb-0.5 rounded-full border border-[#d7e2dc] bg-[#f3f8f5] px-2 py-0.5 text-[0.65rem] font-semibold text-[#3d6450]">
                表示 {shown.length}件 / 全{requests.length}件
              </span>
            </div>
            {filtersActive && <Link href="/admin/quotes" className="text-[0.68rem] text-[#315745] underline underline-offset-4">条件を解除</Link>}
          </div>

          <form
            method="get"
            className="grid gap-1.5 md:grid-cols-[minmax(15rem,1.5fr)_minmax(8.5rem,.7fr)_minmax(8.5rem,.7fr)_auto_auto]"
          >
            <input
              name="q"
              type="search"
              defaultValue={sp.q ?? ''}
              placeholder="顧客・住所・見積番号・商品モデル"
              className="min-w-0 rounded-lg border border-line bg-white px-3 py-1.5 text-xs outline-none focus:border-[#6d9480]"
            />
            <select name="status" defaultValue={statusFilter} className="min-w-0 rounded-lg border border-line bg-white px-3 py-1.5 text-xs">
              <option value="">状態：すべて</option>
              <optgroup label="見積依頼">
                {Object.entries(QUOTE_REQUEST_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={`request:${value}`}>依頼：{label}</option>
                ))}
              </optgroup>
              <optgroup label="見積書">
                {Object.entries(QUOTE_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={`quote:${value}`}>見積：{label}</option>
                ))}
              </optgroup>
            </select>
            <select name="dealer" defaultValue={dealerFilter} className="min-w-0 rounded-lg border border-line bg-white px-3 py-1.5 text-xs">
              <option value="">担当：すべて</option>
              <option value="unassigned">未割当</option>
              {dealers.map((dealer) => (
                <option key={dealer.id} value={dealer.id}>{dealer.company_name ?? dealer.full_name}</option>
              ))}
            </select>

            <details className="relative" open={Boolean(filter.pref || filter.city)}>
              <summary className="flex h-full min-h-[2rem] cursor-pointer list-none items-center justify-center gap-1 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-[#f8fbf9] [&::-webkit-details-marker]:hidden">
                詳細条件 <span aria-hidden="true">▼</span>
              </summary>
              <div className="mt-1.5 flex flex-wrap gap-1.5 rounded-lg border border-line bg-white p-2 shadow-sm md:absolute md:right-0 md:z-20 md:w-[32rem] md:shadow-lg">
                <select name="pref" defaultValue={filter.pref ?? ''} className="min-w-[9rem] flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-xs">
                  <option value="">都道府県：すべて</option>
                  {PREFECTURES.map((prefecture) => <option key={prefecture} value={prefecture}>{prefecture}</option>)}
                </select>
                <select name="city" defaultValue={filter.city ?? ''} disabled={!filter.pref} className="min-w-[9rem] flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-xs disabled:bg-sand disabled:text-muted">
                  <option value="">市区町村：すべて</option>
                  {cityPool.map((city) => <option key={city} value={city}>{city}</option>)}
                </select>
                <span className="w-full text-[0.65rem] text-muted">地域は設置予定地を優先し、未登録時は顧客住所で判定します。</span>
              </div>
            </details>

            <button type="submit" className="rounded-lg border border-[#a9bdb3] bg-white px-3 py-1.5 text-xs font-semibold text-[#315745] hover:bg-[#f4f8f6]">
              絞り込む
            </button>
          </form>
        </div>

        <div data-testid="case-list-scroll">
          <table className="w-full table-fixed text-[0.72rem]">
            <thead className="sticky top-0 z-10 bg-[#eef3f2] text-[#536771]">
              <tr>
                <th className="w-[22%] px-2.5 py-1.5 text-left font-semibold">案件・顧客</th>
                <th className="w-[16%] px-2.5 py-1.5 text-left font-semibold">状態</th>
                <th className="w-[20%] px-2.5 py-1.5 text-left font-semibold">設置予定地</th>
                <th className="w-[12%] px-2.5 py-1.5 text-left font-semibold">商品モデル</th>
                <th className="w-[14%] px-2.5 py-1.5 text-right font-semibold">見積額</th>
                <th className="w-[16%] px-2.5 py-1.5 text-left font-semibold">担当組織／担当者</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((request) => {
                const quote = request.quote_id ? quoteById.get(request.quote_id) : undefined;
                const configuration = configurationById.get(request.configuration_id);
                const modelName = quote?.base_model_name ?? (configuration ? modelNameById.get(configuration.base_model_id) : undefined);
                const specName = configuration?.spec_code
                  ? (SPEC_LABELS[configuration.spec_code] ?? configuration.spec_code)
                  : null;
                const dealer = quote?.dealer_id ? profileById.get(quote.dealer_id) : undefined;
                const dealerName = dealer?.company_name ?? dealer?.full_name;
                const updatedAt = quote?.updated_at ?? request.updated_at;
                const selected =
                  quote?.id === selectedQuoteId ||
                  (!quote && request.id === selectedPendingRequest?.id);

                return [
                  <tr
                    key={`${request.id}-main`}
                    className={selected ? 'bg-[#fff7df] shadow-[inset_0_1px_0_#ead7a8]' : 'hover:bg-[#f8fbf9]'}
                    data-testid="admin-quote-row"
                    data-selected={selected ? 'true' : undefined}
                  >
                    <td className={`border-l-4 px-2.5 py-1.5 align-top ${selected ? 'border-[#2f6b4f]' : 'border-transparent'}`}>
                      {quote ? (
                        <div className="flex items-center gap-1.5">
                          <Link href={caseSelectionHref(quote.id, sp)} className="min-w-0 truncate font-semibold text-ink hover:underline">
                            {request.contact.full_name}
                          </Link>
                          {selected && (
                            <span className="shrink-0 rounded-full bg-[#7b5a22] px-1.5 py-0.5 text-[0.56rem] font-semibold text-white">選択中</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={requestSelectionHref(request.id, sp)}
                            className="min-w-0 truncate font-semibold text-ink hover:underline"
                            data-testid="pending-request-link"
                          >
                            {request.contact.full_name}
                          </Link>
                          {selected && (
                            <span className="shrink-0 rounded-full bg-[#7b5a22] px-1.5 py-0.5 text-[0.56rem] font-semibold text-white">選択中</span>
                          )}
                        </div>
                      )}
                      {request.contact.company_name && <span className="ml-1 text-[0.64rem] text-muted">{request.contact.company_name}</span>}
                      <span className="mt-0.5 block font-mono text-[0.62rem] text-muted">
                        見積番号 {request.quote_no ?? '未発行'}
                        {quote && quote.revision > 1 && <>／第{quote.revision}版</>}
                      </span>
                    </td>
                    <td className="px-2.5 py-1.5 align-top">
                      {quote ? (
                        <>
                          <Badge tone={quoteStatusTone(quote.status)}>{QUOTE_STATUS_LABELS[quote.status]}</Badge>
                          <span className="ml-1 text-[0.62rem] text-muted">依頼：{QUOTE_REQUEST_STATUS_LABELS[request.status]}</span>
                        </>
                      ) : (
                        <Badge tone={request.status === 'new' ? 'danger' : request.status === 'closed' ? 'success' : 'neutral'}>
                          {QUOTE_REQUEST_STATUS_LABELS[request.status]}
                        </Badge>
                      )}
                      <span className="mt-1 block whitespace-nowrap text-[0.6rem] text-muted">更新 {formatDate(updatedAt, true)}</span>
                    </td>
                    <td className="px-2.5 py-1.5 align-top text-[0.68rem]">{request.contact.site_address || '—'}</td>
                    <td className="px-2.5 py-1.5 align-top">
                      <strong>{modelName ?? '—'}</strong>
                      {specName ? (
                        <span className="ml-1 text-[0.62rem] text-muted">{specName}</span>
                      ) : quote ? (
                        <span className="ml-1 text-[0.62rem] text-muted">{FINISH_LEVEL_INFO[quote.finish_level].name}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right align-top font-semibold tabular-nums">
                      {quote ? formatYen(quote.total) : '—'}
                    </td>
                    <td className="px-2.5 py-1.5 align-top text-[0.68rem]">
                      {quote?.dealer_id ? dealerName ?? '割当済み' : <span className="text-muted">未割当</span>}
                    </td>
                  </tr>,
                  <tr
                    key={`${request.id}-meta`}
                    className={`${selected ? 'bg-[#fffaf0]' : 'bg-[#fbfcfb]'} border-b border-line`}
                    data-testid="case-row-meta"
                  >
                    <td colSpan={6} className={`border-l-4 px-2.5 pb-1.5 pt-0.5 ${selected ? 'border-[#2f6b4f]' : 'border-transparent'}`}>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.64rem] text-muted">
                        <span>棟数 <strong className="font-semibold text-muted">—</strong></span>
                        <span>原価 <strong className="font-semibold text-muted">—</strong></span>
                        <span>利益 <strong className="font-semibold text-muted">—</strong></span>
                        <span>利益率 <strong className="font-semibold text-muted">—</strong></span>
                        <span>災害時供給 <strong className="rounded-full border border-[#ead6a9] bg-[#fff8e8] px-1.5 py-0.5 font-semibold text-[#8a5a20]">未登録</strong></span>
                      </div>
                    </td>
                  </tr>,
                ];
              })}
              {shown.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">条件に合う案件はありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedQuoteId ? (
        <CaseWorkspace
          quoteId={selectedQuoteId}
          actor={actor}
          tab={sp.tab}
          revised={sp.revised}
          embedded
          listSearchParams={sp}
        />
      ) : selectedPendingRequest ? (
        <section
          id="pending-quote-request"
          className="scroll-mt-3 space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm"
          data-testid="pending-quote-request-workspace"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">見積依頼</h2>
                <Badge tone={selectedPendingRequest.status === 'new' ? 'danger' : 'neutral'}>
                  {QUOTE_REQUEST_STATUS_LABELS[selectedPendingRequest.status]}
                </Badge>
                <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 text-[0.62rem] font-semibold text-[#8a6416]">
                  見積未発行
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">
                受付 {formatDate(selectedPendingRequest.created_at, true)}／更新 {formatDate(selectedPendingRequest.updated_at, true)}
              </p>
            </div>
            <span className="rounded-full bg-sand px-2 py-1 text-[0.65rem] font-semibold text-muted">
              次工程：見積作成
            </span>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-lg border border-line bg-[#fbfcfb] p-3" data-testid="pending-request-customer">
              <h3 className="text-sm font-semibold">お客様・設置先</h3>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted">お客様名</dt><dd className="mt-0.5 font-semibold">{selectedPendingRequest.contact.full_name}</dd></div>
                <div><dt className="text-xs text-muted">会社名</dt><dd className="mt-0.5 font-semibold">{selectedPendingRequest.contact.company_name || '—'}</dd></div>
                <div><dt className="text-xs text-muted">メール</dt><dd className="mt-0.5 break-all">{selectedPendingRequest.contact.email || selectedPendingRequest.user_email || '—'}</dd></div>
                <div><dt className="text-xs text-muted">電話</dt><dd className="mt-0.5">{selectedPendingRequest.contact.phone || '—'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-muted">設置予定地</dt><dd className="mt-0.5 font-semibold">{selectedPendingRequest.contact.site_address || '未登録'}</dd></div>
              </dl>
            </section>

            <section className="rounded-lg border border-line bg-[#fbfcfb] p-3" data-testid="pending-request-configuration">
              <h3 className="text-sm font-semibold">保存済み仕様</h3>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted">案件・仕様名</dt><dd className="mt-0.5 font-semibold">{selectedPendingConfiguration?.name || '詳細未取得'}</dd></div>
                <div><dt className="text-xs text-muted">本体</dt><dd className="mt-0.5 font-semibold">{selectedPendingModelName || '詳細未取得'}</dd></div>
                <div><dt className="text-xs text-muted">仕様</dt><dd className="mt-0.5">{selectedPendingSpecName || '未登録'}</dd></div>
                <div><dt className="text-xs text-muted">注文範囲</dt><dd className="mt-0.5">{selectedPendingConfiguration ? FINISH_LEVEL_INFO[selectedPendingConfiguration.finish_level].name : '詳細未取得'}</dd></div>
              </dl>
              {!selectedPendingConfiguration && (
                <p className="mt-2 text-xs leading-5 text-muted">
                  この権限では保存済み仕様の詳細を一覧から取得していません。見積依頼との紐付け自体は保持されています。
                </p>
              )}
            </section>
          </div>

          <section className="rounded-lg border border-line bg-white p-3" data-testid="pending-request-message">
            <h3 className="text-sm font-semibold">ご要望・受付メモ</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-soft">
              {selectedPendingRequest.message?.trim() || 'メモはありません。'}
            </p>
          </section>

          <section className="rounded-lg border border-[#e6d8a8] bg-[#fffaf0] p-3" data-testid="pending-request-next-step">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[#765d1f]">この依頼から見積を作成</h3>
              <span className="rounded-full bg-white px-2 py-0.5 text-[0.62rem] font-semibold text-[#8a6416]">正式処理は未実装</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-soft">
              この受付・お客様・保存済み仕様を保持したまま正式見積を発行する処理には、Quote lifecycle用のDB/RPC対応が必要です。
              右上の「対面・電話・紹介の案件受付」は別の案件を新規作成するため、このWeb受付の引継ぎには使用しません。
            </p>
          </section>
        </section>
      ) : (
        shown.length > 0 && (
          <div className="rounded-lg border border-line bg-white px-4 py-3 text-xs text-muted">
            案件または見積依頼を選択すると、下に作業領域を表示します。
          </div>
        )
      )}
    </div>
  );
}
