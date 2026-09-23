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
      className="overflow-x-auto rounded-lg border border-[#dbe4df] bg-white shadow-sm [scrollbar-width:thin]"
      data-testid="case-summary-strip"
    >
      <div className="flex min-w-max items-center gap-4 px-3 py-2 text-[0.7rem]">
        <span className="font-semibold text-[#315745]">案件状況</span>
        <span className="text-muted">案件</span>
        <strong className="text-xs text-ink">{caseCount}</strong>
        <span className="text-muted">新規依頼</span>
        <strong className={newCount > 0 ? 'rounded-full bg-[#fff1d7] px-1.5 py-0.5 text-[#8a5a20]' : 'text-ink'}>{newCount}</strong>
        <span className="text-muted">見積あり</span>
        <strong className="text-ink">{quotedCount}</strong>
        <span className="text-muted">承諾</span>
        <strong className="text-ink">{acceptedCount}</strong>
        <span className="h-4 w-px bg-line" aria-hidden="true" />
        <span className="font-semibold text-[#315745]">見積</span>
        <span className="text-muted">{filtered ? '表示中の見積金額合計' : '現在の見積金額合計'}</span>
        <strong className="text-xs tabular-nums text-ink">{formatYen(quoteTotal)}</strong>
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
          見積依頼を起点にした案件 {caseCount} 件。案件を選択すると下に作業領域を表示します。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link
          href="/admin/quotes/new"
          className="inline-flex items-center rounded-lg bg-[#2f6b4f] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#285d45]"
          data-testid="new-quote-link"
        >
          ＋新規案件／見積作成
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
          <div className="max-h-[20rem] overflow-auto [scrollbar-width:thin]" data-testid="case-list-scroll">
            <table className="w-full min-w-[104rem] table-fixed text-[0.72rem]">
              <thead className="sticky top-0 z-10 bg-[#eef3f2] text-[#536771]">
                <tr>
                  <th className="w-[15rem] px-2.5 py-1.5 text-left font-semibold">案件・顧客</th>
                  <th className="w-[9rem] px-2.5 py-1.5 text-left font-semibold">状態</th>
                  <th className="w-[9rem] px-2.5 py-1.5 text-left font-semibold">更新</th>
                  <th className="w-[16rem] px-2.5 py-1.5 text-left font-semibold">設置予定地</th>
                  <th className="w-[10rem] px-2.5 py-1.5 text-left font-semibold">商品モデル</th>
                  <th className="w-[5rem] px-2.5 py-1.5 text-center font-semibold">棟数</th>
                  <th className="w-[9rem] px-2.5 py-1.5 text-right font-semibold">見積・契約額</th>
                  <th className="w-[8rem] px-2.5 py-1.5 text-right font-semibold">原価</th>
                  <th className="w-[8rem] px-2.5 py-1.5 text-right font-semibold">利益</th>
                  <th className="w-[6rem] px-2.5 py-1.5 text-right font-semibold">利益率</th>
                  <th className="w-[11rem] px-2.5 py-1.5 text-left font-semibold">担当組織／担当者</th>
                  <th className="w-[8rem] px-2.5 py-1.5 text-left font-semibold">災害時供給</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {latest.map((q) => {
                  const request = requestByQuoteId.get(q.id);
                  const selected = q.id === selectedQuoteId;
                  return (
                    <tr
                      key={q.id}
                      className={selected ? 'bg-[#fff7df] shadow-[inset_0_1px_0_#ead7a8,inset_0_-1px_0_#ead7a8]' : 'hover:bg-[#f8fbf9]'}
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
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 align-top text-[0.68rem]">{formatDate(q.updated_at, true)}</td>
                      <td className="max-w-56 px-2.5 py-1.5 align-top text-[0.68rem]">{request?.contact.site_address || '—'}</td>
                      <td className="px-2.5 py-1.5 align-top">
                        <strong>{q.base_model_name}</strong>
                        <span className="ml-1 text-[0.62rem] text-muted">{FINISH_LEVEL_INFO[q.finish_level].name}</span>
                      </td>
                      <td className="px-2.5 py-1.5 text-center align-top text-muted">—</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-right align-top font-semibold tabular-nums">{formatYen(q.total)}</td>
                      <td className="px-2.5 py-1.5 text-right align-top text-muted">—</td>
                      <td className="px-2.5 py-1.5 text-right align-top text-muted">—</td>
                      <td className="px-2.5 py-1.5 text-right align-top text-muted">—</td>
                      <td className="px-2.5 py-1.5 align-top text-[0.68rem]">{selected ? '選択中' : '担当中'}</td>
                      <td className="px-2.5 py-1.5 align-top text-[0.68rem] text-muted">未登録</td>
                    </tr>
                  );
                })}
                {latest.length === 0 && (
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-muted">割り当てられた案件はまだありません</td></tr>
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
  const requestedCase = sp.case && selectableQuoteIds.has(sp.case) ? sp.case : null;
  const selectedQuoteId = requestedCase ?? shownQuotes[0]?.id ?? null;

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

        <div className="max-h-[20rem] overflow-auto [scrollbar-width:thin]" data-testid="case-list-scroll">
          <table className="w-full min-w-[108rem] table-fixed text-[0.72rem]">
            <thead className="sticky top-0 z-10 bg-[#eef3f2] text-[#536771]">
              <tr>
                <th className="w-[15rem] px-2.5 py-1.5 text-left font-semibold">案件・顧客</th>
                <th className="w-[10rem] px-2.5 py-1.5 text-left font-semibold">状態</th>
                <th className="w-[9rem] px-2.5 py-1.5 text-left font-semibold">更新</th>
                <th className="w-[17rem] px-2.5 py-1.5 text-left font-semibold">設置予定地</th>
                <th className="w-[10rem] px-2.5 py-1.5 text-left font-semibold">商品モデル</th>
                <th className="w-[5rem] px-2.5 py-1.5 text-center font-semibold">棟数</th>
                <th className="w-[9rem] px-2.5 py-1.5 text-right font-semibold">見積・契約額</th>
                <th className="w-[8rem] px-2.5 py-1.5 text-right font-semibold">原価</th>
                <th className="w-[8rem] px-2.5 py-1.5 text-right font-semibold">利益</th>
                <th className="w-[6rem] px-2.5 py-1.5 text-right font-semibold">利益率</th>
                <th className="w-[11rem] px-2.5 py-1.5 text-left font-semibold">担当組織／担当者</th>
                <th className="w-[8rem] px-2.5 py-1.5 text-left font-semibold">災害時供給</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
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
                const selected = quote?.id === selectedQuoteId;

                return (
                  <tr
                    key={request.id}
                    className={selected ? 'bg-[#fff7df] shadow-[inset_0_1px_0_#ead7a8,inset_0_-1px_0_#ead7a8]' : 'hover:bg-[#f8fbf9]'}
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
                        <strong>{request.contact.full_name}</strong>
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
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 align-top text-[0.68rem]">{formatDate(updatedAt, true)}</td>
                    <td className="max-w-64 px-2.5 py-1.5 align-top text-[0.68rem]">{request.contact.site_address || '—'}</td>
                    <td className="px-2.5 py-1.5 align-top">
                      <strong>{modelName ?? '—'}</strong>
                      {specName ? (
                        <span className="ml-1 text-[0.62rem] text-muted">{specName}</span>
                      ) : quote ? (
                        <span className="ml-1 text-[0.62rem] text-muted">{FINISH_LEVEL_INFO[quote.finish_level].name}</span>
                      ) : null}
                    </td>
                    <td className="px-2.5 py-1.5 text-center align-top text-muted">—</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-right align-top font-semibold tabular-nums">
                      {quote ? formatYen(quote.total) : '—'}
                    </td>
                    <td className="px-2.5 py-1.5 text-right align-top text-muted">—</td>
                    <td className="px-2.5 py-1.5 text-right align-top text-muted">—</td>
                    <td className="px-2.5 py-1.5 text-right align-top text-muted">—</td>
                    <td className="px-2.5 py-1.5 align-top text-[0.68rem]">
                      {quote?.dealer_id ? dealerName ?? '割当済み' : <span className="text-muted">未割当</span>}
                    </td>
                    <td className="px-2.5 py-1.5 align-top text-[0.68rem] text-muted">未登録</td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-muted">条件に合う案件はありません</td></tr>
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
      ) : (
        shown.length > 0 && (
          <div className="rounded-lg border border-line bg-white px-4 py-3 text-xs text-muted">
            見積書が作成されている案件を選択すると、案件ワークスペースを表示します。
          </div>
        )
      )}
    </div>
  );
}
