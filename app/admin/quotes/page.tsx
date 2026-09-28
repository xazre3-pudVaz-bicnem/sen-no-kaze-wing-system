import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import {
  QUOTE_REQUEST_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
} from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { CaseWorkspace } from '@/components/admin/case-workspace';
import { ClickableCaseRow } from '@/components/admin/clickable-case-row';
import { matchesRegion, parseAddress, PREFECTURES, readRegionFilter } from '@/lib/domain/address';
import { isFormalQuote } from '@/lib/domain/quote-lifecycle';

const SPEC_LABELS: Record<string, string> = {
  base: '本体のみ',
  hotel: 'ホテル仕様',
  'hotel-single': 'ホテル・単身者',
  residence: '住宅仕様',
  'water-kit': '水回りキット',
  office: '事務所・店舗',
};

function casePhaseLabel(quote: {
  status: keyof typeof QUOTE_STATUS_LABELS;
  parent_quote_id: string | null;
  dealer_id: string | null;
}) {
  if (isFormalQuote(quote)) {
    if (quote.status === 'accepted') return 'F10/15 契約';
    if (quote.status === 'issued') return 'F8/15 正式見積';
    return 'F9/15 見積後の判断';
  }
  if (quote.status === 'issued' || quote.status === 'accepted') {
    return quote.dealer_id ? 'F7/15 現地確認' : 'F6/15 担当者決定';
  }
  return 'F5/15 見積依頼';
}

function googleMapsHref(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.7rem]" data-testid="case-summary-current">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid="case-summary-status">
          <span className="font-semibold text-[#315745]">現在案件</span>
          <span className="text-muted">案件</span>
          <strong className="text-xs text-ink">{caseCount}</strong>
          <span className="text-muted">新規依頼</span>
          <strong className={newCount > 0 ? 'rounded-full bg-[#fff1d7] px-1.5 py-0.5 text-[#8a5a20]' : 'text-ink'}>{newCount}</strong>
          <span className="text-muted">見積あり</span>
          <strong className="text-ink">{quotedCount}</strong>
          <span className="text-muted">見積承諾</span>
          <strong className="text-ink">{acceptedCount}</strong>
          <span className="text-muted">棟数</span>
          <strong className="text-muted">—</strong>
        </div>

        <span className="hidden h-4 w-px bg-line md:block" aria-hidden="true" />

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid="case-summary-finance">
          <span className="font-semibold text-[#315745]">収支</span>
          <span className="text-muted">{filtered ? '表示中の見積額' : '見積額'}</span>
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
          <span className="text-muted">完成個体登録後に供給可否を管理</span>
        </div>
      </div>

      <div
        className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line pt-1.5 text-[0.68rem]"
        data-testid="case-summary-cumulative"
      >
        <span className="font-semibold text-[#315745]">累計実績</span>
        <span className="rounded-full bg-[#edf3f6] px-1.5 py-0.5 text-[0.58rem] font-semibold text-[#536771]">未集計</span>
        <span className="text-muted">成約件数</span>
        <strong className="text-muted">—</strong>
        <span className="text-muted">引渡し棟数</span>
        <strong className="text-muted">—</strong>
        <span className="text-muted">売上</span>
        <strong className="text-muted">—</strong>
        <span className="text-muted">原価</span>
        <strong className="text-muted">—</strong>
        <span className="text-muted">利益</span>
        <strong className="text-muted">—</strong>
        <span className="text-muted">利益率</span>
        <strong className="text-muted">—</strong>
      </div>
    </section>
  );
}

function CasePageHeading({ caseCount }: { caseCount: number }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">案件管理</h1>
        <p className="mt-0.5 text-xs text-ink-soft">
          Web見積依頼と、Web以外で受けた案件をまとめて管理します。現在 {caseCount} 件。
        </p>
      </div>
      <Link
        href="/admin/quotes/new"
        className="inline-flex shrink-0 items-center rounded-lg bg-[#2f6b4f] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#285d45]"
        data-testid="new-quote-link"
      >
        ＋案件を登録
      </Link>
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

  // 総代理店・代理店は自分に割り当てられた案件だけ。本部だけが全体一覧を扱う。
  // Quote lifecycle自体は変更しない。
  if (actor.role !== 'admin') {
    const mine = await store.listDealerQuotes(actor.id);
    const latest = mine.filter((q) => q.status !== 'superseded');
    const quoteTotal = latest.reduce((sum, quote) => sum + quote.total, 0);
    const newCount = latest.filter((quote) => quote.request_status === 'new').length;
    const acceptedCount = latest.filter((quote) => quote.status === 'accepted').length;
    const requestedCase = sp.case && latest.some((quote) => quote.id === sp.case) ? sp.case : null;
    const selectedQuoteId = requestedCase;

    return (
      <div className="mx-auto w-full max-w-[96rem] space-y-2.5">
        <CasePageHeading caseCount={latest.length} />
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
              <p className="text-[0.64rem] text-muted">全体フローのF5〜F15に対応。案件を選択すると下のワークスペースが切り替わります。</p>
            </div>
            <span className="rounded-full border border-[#d7e2dc] bg-[#f3f8f5] px-2 py-0.5 text-[0.65rem] font-semibold text-[#3d6450]">
              {latest.length}件
            </span>
          </div>
          <div data-testid="case-list-scroll">
            <table className="w-full table-fixed text-[0.69rem]">
              <thead className="sticky top-0 z-10 bg-[#eef3f2] text-[#536771]">
                <tr>
                  <th className="w-[22%] px-2 py-1 text-left font-semibold">案件・顧客</th>
                  <th className="w-[16%] px-2 py-1 text-left font-semibold">現在フェーズ</th>
                  <th className="w-[20%] px-2 py-1 text-left font-semibold">設置予定地</th>
                  <th className="w-[12%] px-2 py-1 text-left font-semibold">商品モデル</th>
                  <th className="w-[14%] px-2 py-1 text-right font-semibold">見積額</th>
                  <th className="w-[16%] px-2 py-1 text-left font-semibold">担当</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((q) => {
                  const selected = q.id === selectedQuoteId;
                  return [
                    <ClickableCaseRow
                      key={`${q.id}-main`}
                      href={caseSelectionHref(q.id, sp)}
                      className={selected ? 'bg-[#fff7df] shadow-[inset_0_1px_0_#ead7a8]' : 'hover:bg-[#f8fbf9]'}
                      testId="dealer-quote-row"
                      selected={selected}
                      ariaLabel={`${q.customer_name}の案件を開く`}
                    >
                      <td className={`border-l-4 px-2 py-1 align-middle ${selected ? 'border-[#2f6b4f]' : 'border-transparent'}`}>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Link href={caseSelectionHref(q.id, sp)} className="min-w-0 truncate font-semibold text-ink hover:underline">
                            {q.customer_name}
                          </Link>
                          {q.customer_company && <span className="min-w-0 truncate text-[0.6rem] text-muted">{q.customer_company}</span>}
                          {selected && (
                            <span className="shrink-0 rounded-full bg-[#7b5a22] px-1.5 py-0.5 text-[0.54rem] font-semibold text-white">選択中</span>
                          )}
                        </div>
                        <span className="mt-0.5 block font-mono text-[0.58rem] leading-3 text-muted">見積番号 {q.quote_no}／第{q.revision}版</span>
                      </td>
                      <td className="px-2 py-1 align-middle">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="text-[0.64rem] font-semibold text-[#315745]">{casePhaseLabel(q)}</span>
                        </div>
                        <span className="mt-0.5 block whitespace-nowrap text-[0.56rem] leading-3 text-muted">
                          更新 {formatDate(q.updated_at, true)}
                        </span>
                      </td>
                      <td className="px-2 py-1 align-middle text-[0.64rem]">
                        <div className="flex min-w-0 items-center gap-1">
                          <span className="min-w-0 truncate">{q.site_address || '未登録'}</span>
                          {q.site_address && (
                            <a
                              href={googleMapsHref(q.site_address)}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 rounded p-0.5 text-[#315745] hover:bg-[#edf3ef] hover:text-[#234a39]"
                              aria-label={`${q.site_address}をGoogleマップで開く`}
                              title="Googleマップで開く"
                              data-testid="case-map-link"
                            >
                              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1 align-middle">
                        <strong>{q.base_model_name}</strong>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-right align-middle font-semibold tabular-nums">{formatYen(q.total)}</td>
                      <td className="px-2 py-1 align-middle text-[0.64rem]">{selected ? '選択中' : '担当中'}</td>
                    </ClickableCaseRow>,
                    <tr
                      key={`${q.id}-meta`}
                      className={`${selected ? 'bg-[#fffaf0]' : 'bg-[#fbfcfb]'} border-b border-line`}
                      data-testid="case-row-meta"
                    >
                      <td colSpan={6} className={`border-l-4 px-2 pb-0.5 pt-0 ${selected ? 'border-[#2f6b4f]' : 'border-transparent'}`}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.59rem] leading-4 text-muted">
                          <span>棟数 <strong className="font-semibold text-muted">—</strong></span>
                          <span>原価 <strong className="font-semibold text-muted">—</strong></span>
                          <span>利益 <strong className="font-semibold text-muted">—</strong></span>
                          <span>利益率 <strong className="font-semibold text-muted">—</strong></span>
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
            edit={sp.edit}
            embedded
            listSearchParams={sp}
          />
        )}
      </div>
    );
  }

  const [requests, quotes, dealers] = await Promise.all([
    store.listQuoteRequests(),
    store.listAllQuotes(),
    actor.role === 'admin' ? store.listCaseDealers() : Promise.resolve([]),
  ]);
  const quoteById = new Map(quotes.map((q) => [q.id, q]));
  const dealerById = new Map(dealers.map((dealer) => [dealer.id, dealer]));

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
    const modelName = quote?.base_model_name ?? request.configuration?.model_name ?? '';
    const dealer = quote?.dealer_id ? dealerById.get(quote.dealer_id) : undefined;
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

  const selectableQuoteIds = new Set(shownQuotes.map((quote) => quote.id));
  const selectablePendingRequestIds = new Set(shown.filter((request) => !request.quote_id).map((request) => request.id));
  const requestedCase = sp.case && selectableQuoteIds.has(sp.case) ? sp.case : null;
  const requestedPendingRequestId =
    sp.request && selectablePendingRequestIds.has(sp.request) ? sp.request : null;
  const selectedPendingRequest = requestedPendingRequestId
    ? shown.find((request) => request.id === requestedPendingRequestId && !request.quote_id) ?? null
    : null;
  const selectedQuoteId = selectedPendingRequest ? null : requestedCase;
  const selectedPendingConfiguration = selectedPendingRequest?.configuration;
  const selectedPendingModelName = selectedPendingConfiguration?.model_name;
  const selectedPendingSpecName = selectedPendingConfiguration?.spec_code
    ? (SPEC_LABELS[selectedPendingConfiguration.spec_code] ?? selectedPendingConfiguration.spec_code)
    : null;

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-2.5">
      <CasePageHeading caseCount={requests.length} />
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
                <p className="text-[0.64rem] text-muted">全体フローのF5〜F15に対応。案件を選択すると下のワークスペースが切り替わります。</p>
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
          <table className="w-full table-fixed text-[0.69rem]">
            <thead className="sticky top-0 z-10 bg-[#eef3f2] text-[#536771]">
              <tr>
                <th className="w-[22%] px-2 py-1 text-left font-semibold">案件・顧客</th>
                <th className="w-[16%] px-2 py-1 text-left font-semibold">現在フェーズ</th>
                <th className="w-[20%] px-2 py-1 text-left font-semibold">設置予定地</th>
                <th className="w-[12%] px-2 py-1 text-left font-semibold">商品モデル</th>
                <th className="w-[14%] px-2 py-1 text-right font-semibold">見積額</th>
                <th className="w-[16%] px-2 py-1 text-left font-semibold">担当組織／担当者</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((request) => {
                const quote = request.quote_id ? quoteById.get(request.quote_id) : undefined;
                const configuration = request.configuration;
                const modelName = quote?.base_model_name ?? configuration?.model_name;
                const specName = configuration?.spec_code
                  ? (SPEC_LABELS[configuration.spec_code] ?? configuration.spec_code)
                  : null;
                const dealer = quote?.dealer_id ? dealerById.get(quote.dealer_id) : undefined;
                const dealerName = dealer?.company_name ?? dealer?.full_name;
                const updatedAt = quote?.updated_at ?? request.updated_at;
                const selected =
                  quote?.id === selectedQuoteId ||
                  (!quote && request.id === selectedPendingRequest?.id);

                return [
                  <ClickableCaseRow
                    key={`${request.id}-main`}
                    href={quote ? caseSelectionHref(quote.id, sp) : requestSelectionHref(request.id, sp)}
                    className={selected ? 'bg-[#fff7df] shadow-[inset_0_1px_0_#ead7a8]' : 'hover:bg-[#f8fbf9]'}
                    testId="admin-quote-row"
                    selected={selected}
                    ariaLabel={`${request.contact.full_name}の案件を開く`}
                  >
                    <td className={`border-l-4 px-2 py-1 align-middle ${selected ? 'border-[#2f6b4f]' : 'border-transparent'}`}>
                      <div className="flex min-w-0 items-center gap-1.5">
                        {quote ? (
                          <Link href={caseSelectionHref(quote.id, sp)} className="min-w-0 truncate font-semibold text-ink hover:underline">
                            {request.contact.full_name}
                          </Link>
                        ) : (
                          <Link
                            href={requestSelectionHref(request.id, sp)}
                            className="min-w-0 truncate font-semibold text-ink hover:underline"
                            data-testid="pending-request-link"
                          >
                            {request.contact.full_name}
                          </Link>
                        )}
                        {request.contact.company_name && <span className="min-w-0 truncate text-[0.6rem] text-muted">{request.contact.company_name}</span>}
                        {selected && (
                          <span className="shrink-0 rounded-full bg-[#7b5a22] px-1.5 py-0.5 text-[0.54rem] font-semibold text-white">選択中</span>
                        )}
                      </div>
                      <span className="mt-0.5 block font-mono text-[0.58rem] leading-3 text-muted">
                        見積番号 {request.quote_no ?? '未発行'}
                        {quote && quote.revision > 1 && <>／第{quote.revision}版</>}
                      </span>
                    </td>
                    <td className="px-2 py-1 align-middle">
                      {quote ? (
                        <>
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className="text-[0.64rem] font-semibold text-[#315745]">{casePhaseLabel(quote)}</span>
                          </div>
                          <span className="mt-0.5 block whitespace-nowrap text-[0.56rem] leading-3 text-muted">
                            更新 {formatDate(updatedAt, true)}
                          </span>
                        </>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className="text-[0.64rem] font-semibold text-[#315745]">F5/15 見積依頼</span>
                          </div>
                          <span className="mt-0.5 block whitespace-nowrap text-[0.56rem] leading-3 text-muted">更新 {formatDate(updatedAt, true)}</span>
                        </>
                      )}
                    </td>
                    <td className="px-2 py-1 align-middle text-[0.64rem]">
                      <div className="flex min-w-0 items-center gap-1">
                        <span className="min-w-0 truncate">{request.contact.site_address || '—'}</span>
                        {request.contact.site_address && (
                          <a
                            href={googleMapsHref(request.contact.site_address)}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 rounded p-0.5 text-[#315745] hover:bg-[#edf3ef] hover:text-[#234a39]"
                            aria-label={`${request.contact.site_address}をGoogleマップで開く`}
                            title="Googleマップで開く"
                            data-testid="case-map-link"
                          >
                            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1 align-middle">
                      <strong>{modelName ?? '—'}</strong>
                      {specName ? <span className="ml-1 text-[0.6rem] text-muted">{specName}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right align-middle font-semibold tabular-nums">
                      {quote ? formatYen(quote.total) : '—'}
                    </td>
                    <td className="px-2 py-1 align-middle text-[0.64rem]">
                      {quote?.dealer_id ? dealerName ?? '割当済み' : <span className="text-muted">未割当</span>}
                    </td>
                  </ClickableCaseRow>,
                  <tr
                    key={`${request.id}-meta`}
                    className={`${selected ? 'bg-[#fffaf0]' : 'bg-[#fbfcfb]'} border-b border-line`}
                    data-testid="case-row-meta"
                  >
                    <td colSpan={6} className={`border-l-4 px-2 pb-0.5 pt-0 ${selected ? 'border-[#2f6b4f]' : 'border-transparent'}`}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.59rem] leading-4 text-muted">
                        <span>棟数 <strong className="font-semibold text-muted">—</strong></span>
                        <span>原価 <strong className="font-semibold text-muted">—</strong></span>
                        <span>利益 <strong className="font-semibold text-muted">—</strong></span>
                        <span>利益率 <strong className="font-semibold text-muted">—</strong></span>
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
          edit={sp.edit}
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
              右上の「＋案件を登録」は別の案件を新規作成するため、このWeb受付の引継ぎには使用しません。
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
