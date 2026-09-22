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
      className="overflow-x-auto rounded-xl border border-[#dbe4df] bg-white shadow-sm [scrollbar-width:thin]"
      data-testid="case-summary-strip"
    >
      <div className="flex min-w-max items-center gap-5 px-4 py-3 text-xs">
        <span className="font-semibold text-[#315745]">案件状況</span>
        <span className="text-muted">案件</span>
        <strong className="text-sm text-ink">{caseCount}</strong>
        <span className="text-muted">新規依頼</span>
        <strong className={newCount > 0 ? 'rounded-full bg-[#fff1d7] px-2 py-0.5 text-[#8a5a20]' : 'text-ink'}>{newCount}</strong>
        <span className="text-muted">見積あり</span>
        <strong className="text-ink">{quotedCount}</strong>
        <span className="text-muted">承諾</span>
        <strong className="text-ink">{acceptedCount}</strong>
        <span className="h-5 w-px bg-line" aria-hidden="true" />
        <span className="font-semibold text-[#315745]">見積</span>
        <span className="text-muted">{filtered ? '表示中の見積金額合計' : '現在の見積金額合計'}</span>
        <strong className="text-sm tabular-nums text-ink">{formatYen(quoteTotal)}</strong>
        <span className="h-5 w-px bg-line" aria-hidden="true" />
        <span className="text-muted">契約・製造・原価・利益・災害時供給は今後対応予定</span>
      </div>
    </section>
  );
}

function CasePageHeading({ role, caseCount }: { role: keyof typeof ROLE_LABELS; caseCount: number }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">案件管理</h1>
        <p className="mt-1 text-sm text-ink-soft">
          見積依頼を起点にした案件 {caseCount} 件。現在保存されている情報で案件の流れを確認します。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link
          href="/admin/quotes/new"
          className="inline-flex items-center rounded-lg bg-[#2f6b4f] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#285d45]"
          data-testid="new-quote-link"
        >
          ＋新規案件／見積作成
        </Link>
        <span className="rounded-lg bg-[#edf3f6] px-3 py-2 text-xs font-semibold text-[#365467]">{ROLE_LABELS[role]}</span>
      </div>
    </div>
  );
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

    return (
      <div className="mx-auto w-full max-w-[96rem] space-y-3">
        <CasePageHeading role={actor.role} caseCount={latest.length} />
        <CaseSummary
          caseCount={latest.length}
          newCount={newCount}
          quotedCount={latest.length}
          acceptedCount={acceptedCount}
          quoteTotal={quoteTotal}
          filtered={false}
        />

        <section className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <h2 className="font-semibold">担当案件</h2>
              <p className="text-xs text-muted">案件を開くと、案件ヘッダー・工程表示・見積書などをまとめて確認できます。</p>
            </div>
          </div>
          <div className="overflow-x-auto [scrollbar-width:thin]">
            <table className="w-full min-w-[70rem] text-[0.78rem]">
              <thead className="bg-[#f0f4f3] text-[#536771]">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">案件・顧客</th>
                  <th className="px-3 py-2 text-left font-semibold">状態</th>
                  <th className="px-3 py-2 text-left font-semibold">更新</th>
                  <th className="px-3 py-2 text-left font-semibold">設置予定地</th>
                  <th className="px-3 py-2 text-left font-semibold">商品モデル</th>
                  <th className="px-3 py-2 text-right font-semibold">見積額</th>
                  <th className="px-3 py-2 text-left font-semibold">担当</th>
                  <th className="px-3 py-2 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {latest.map((q) => {
                  const request = requestByQuoteId.get(q.id);
                  return (
                    <tr key={q.id} className="hover:bg-[#f8fbf9]" data-testid="dealer-quote-row">
                      <td className="px-3 py-2.5 align-top">
                        <Link href={`/admin/quotes/${q.id}`} className="font-semibold text-ink hover:underline">
                          {q.customer_name}
                        </Link>
                        {q.customer_company && <span className="mt-0.5 block text-[0.7rem] text-muted">{q.customer_company}</span>}
                        <span className="mt-0.5 block font-mono text-[0.68rem] text-muted">見積番号 {q.quote_no}／第{q.revision}版</span>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <Badge tone={quoteStatusTone(q.status)}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
                        {request && <span className="mt-1 block text-[0.68rem] text-muted">依頼：{QUOTE_REQUEST_STATUS_LABELS[request.status]}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-top text-xs">{formatDate(q.updated_at, true)}</td>
                      <td className="max-w-60 px-3 py-2.5 align-top text-xs">{request?.contact.site_address || '—'}</td>
                      <td className="px-3 py-2.5 align-top">
                        <strong>{q.base_model_name}</strong>
                        <span className="mt-0.5 block text-[0.68rem] text-muted">注文範囲：{FINISH_LEVEL_INFO[q.finish_level].name}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-top font-semibold tabular-nums">{formatYen(q.total)}</td>
                      <td className="px-3 py-2.5 align-top text-xs">担当中</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-top">
                        <Link href={`/admin/quotes/${q.id}`} className="btn-secondary btn-sm">案件を開く</Link>
                      </td>
                    </tr>
                  );
                })}
                {latest.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">割り当てられた案件はまだありません</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  const [requests, quotes, configurations, models, profiles] = await Promise.all([
    store.listQuoteRequests(),
    store.listAllQuotes(),
    actor.role === 'admin' ? store.listAllConfigurations() : Promise.resolve([]),
    actor.role === 'admin' ? store.listModels({ includeDraft: true }) : Promise.resolve([]),
    actor.role === 'admin' ? store.listProfiles() : Promise.resolve([]),
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

  const shownQuotes = shown
    .map((request) => (request.quote_id ? quoteById.get(request.quote_id) : undefined))
    .filter((quote): quote is NonNullable<typeof quote> => Boolean(quote));
  const shownQuoteTotal = shownQuotes.reduce((sum, quote) => sum + quote.total, 0);
  const newCount = shown.filter((request) => request.status === 'new').length;
  const acceptedCount = shownQuotes.filter((quote) => quote.status === 'accepted').length;
  const filtersActive = Boolean(textQuery || statusFilter || dealerFilter || filter.block || filter.pref || filter.city);

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-3">
      <CasePageHeading role={actor.role} caseCount={requests.length} />
      <CaseSummary
        caseCount={shown.length}
        newCount={newCount}
        quotedCount={shownQuotes.length}
        acceptedCount={acceptedCount}
        quoteTotal={shownQuoteTotal}
        filtered={filtersActive}
      />

      <section className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
        <div className="border-b border-line px-4 py-3">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-semibold">案件一覧</h2>
              <p className="text-xs text-muted">お客様・状態・設置場所・商品・担当を確認して案件を開きます。</p>
            </div>
            {filtersActive && <Link href="/admin/quotes" className="text-xs text-[#315745] underline underline-offset-4">条件を解除</Link>}
          </div>

          <form method="get" className="grid gap-2 lg:grid-cols-[minmax(15rem,1.4fr)_minmax(10rem,.75fr)_minmax(10rem,.75fr)_auto]">
            <input
              name="q"
              type="search"
              defaultValue={sp.q ?? ''}
              placeholder="案件名・顧客・住所・見積番号"
              className="min-w-0 rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-[#6d9480]"
            />
            <select name="status" defaultValue={statusFilter} className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
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
            <select name="dealer" defaultValue={dealerFilter} className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
              <option value="">担当：すべて</option>
              <option value="unassigned">未割当</option>
              {dealers.map((dealer) => (
                <option key={dealer.id} value={dealer.id}>{dealer.company_name ?? dealer.full_name}</option>
              ))}
            </select>
            <button type="submit" className="rounded-lg border border-[#a9bdb3] bg-white px-4 py-2 text-sm font-semibold text-[#315745] hover:bg-[#f4f8f6]">
              絞り込む
            </button>

            <details className="lg:col-span-4" open={Boolean(filter.pref || filter.city)}>
              <summary className="cursor-pointer select-none text-xs font-semibold text-ink-soft">詳細条件</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <select name="pref" defaultValue={filter.pref ?? ''} className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
                  <option value="">都道府県：すべて</option>
                  {PREFECTURES.map((prefecture) => <option key={prefecture} value={prefecture}>{prefecture}</option>)}
                </select>
                <select name="city" defaultValue={filter.city ?? ''} disabled={!filter.pref} className="rounded-lg border border-line bg-white px-3 py-2 text-sm disabled:bg-sand disabled:text-muted">
                  <option value="">市区町村：すべて</option>
                  {cityPool.map((city) => <option key={city} value={city}>{city}</option>)}
                </select>
                <span className="self-center text-xs text-muted">地域は設置予定地を優先し、未登録時は顧客住所で判定します。</span>
              </div>
            </details>
          </form>
        </div>

        <div className="overflow-x-auto [scrollbar-width:thin]" data-testid="case-list-scroll">
          <table className="w-full min-w-[76rem] text-[0.76rem]">
            <thead className="bg-[#eef3f2] text-[#536771]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">案件・顧客</th>
                <th className="px-3 py-2 text-left font-semibold">状態</th>
                <th className="px-3 py-2 text-left font-semibold">更新</th>
                <th className="px-3 py-2 text-left font-semibold">設置予定地</th>
                <th className="px-3 py-2 text-left font-semibold">商品モデル</th>
                <th className="px-3 py-2 text-right font-semibold">見積額</th>
                <th className="px-3 py-2 text-left font-semibold">担当代理店</th>
                <th className="px-3 py-2 text-right font-semibold"></th>
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

                return (
                  <tr key={request.id} className="hover:bg-[#f8fbf9]" data-testid="admin-quote-row">
                    <td className="px-3 py-2.5 align-top">
                      {quote ? (
                        <Link href={`/admin/quotes/${quote.id}`} className="font-semibold text-ink hover:underline">
                          {request.contact.full_name}
                        </Link>
                      ) : (
                        <strong>{request.contact.full_name}</strong>
                      )}
                      {request.contact.company_name && <span className="mt-0.5 block text-[0.69rem] text-muted">{request.contact.company_name}</span>}
                      <span className="mt-0.5 block font-mono text-[0.67rem] text-muted">
                        見積番号 {request.quote_no ?? '未発行'}
                        {quote && quote.revision > 1 && <>／第{quote.revision}版</>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {quote ? (
                        <>
                          <Badge tone={quoteStatusTone(quote.status)}>{QUOTE_STATUS_LABELS[quote.status]}</Badge>
                          <span className="mt-1 block text-[0.67rem] text-muted">依頼：{QUOTE_REQUEST_STATUS_LABELS[request.status]}</span>
                        </>
                      ) : (
                        <Badge tone={request.status === 'new' ? 'danger' : request.status === 'closed' ? 'success' : 'neutral'}>
                          {QUOTE_REQUEST_STATUS_LABELS[request.status]}
                        </Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-top text-xs">{formatDate(updatedAt, true)}</td>
                    <td className="max-w-64 px-3 py-2.5 align-top text-xs">{request.contact.site_address || '—'}</td>
                    <td className="px-3 py-2.5 align-top">
                      <strong>{modelName ?? '—'}</strong>
                      {specName ? (
                        <span className="mt-0.5 block text-[0.67rem] text-muted">{specName}</span>
                      ) : quote ? (
                        <span className="mt-0.5 block text-[0.67rem] text-muted">注文範囲：{FINISH_LEVEL_INFO[quote.finish_level].name}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right align-top font-semibold tabular-nums">
                      {quote ? formatYen(quote.total) : '—'}
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs">
                      {quote?.dealer_id ? dealerName ?? '割当済み' : <span className="text-muted">未割当</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right align-top">
                      {quote ? (
                        <Link href={`/admin/quotes/${quote.id}`} className="btn-secondary btn-sm">案件を開く</Link>
                      ) : (
                        <span className="text-[0.68rem] text-muted">見積未作成</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">条件に合う案件はありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
