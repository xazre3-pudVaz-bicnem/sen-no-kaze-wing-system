import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AccessibleCustomerListItem } from '@/lib/data/store';
import {
  customerListSortLabel,
  filterAndSortCustomers,
  parseCustomerListFilters,
  type CustomerListSort,
} from '@/lib/customer-management-list';
import { formatDate } from '@/lib/utils';

const QUERY_KEYS = ['q', 'customer', 'case_q', 'case', 'site', 'dealer', 'from', 'to', 'sort'] as const;
type QueryKey = (typeof QUERY_KEYS)[number];
type SearchParams = Record<string, string | undefined>;

function queryHref(basePath: string, sp: SearchParams, changes: Partial<Record<QueryKey, string | null>>): string {
  const params = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const changed = Object.prototype.hasOwnProperty.call(changes, key);
    const value = changed ? changes[key] : sp[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function PreservedInputs({ sp, omit }: { sp: SearchParams; omit: QueryKey[] }) {
  return (
    <>
      {QUERY_KEYS.filter((key) => !omit.includes(key)).map((key) =>
        sp[key] ? <input key={key} type="hidden" name={key} value={sp[key]} /> : null
      )}
    </>
  );
}

function ColumnMenu({
  label,
  active,
  align = 'left',
  children,
}: {
  label: string;
  active: boolean;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  return (
    <details className="relative inline-block">
      <summary
        className={`ml-1 inline-flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded border text-[0.65rem] transition hover:bg-sand ${
          active ? 'border-forest bg-forest/10 text-forest' : 'border-line bg-white text-muted'
        }`}
        aria-label={`${label}の絞り込みと並び替え`}
      >
        ▼
      </summary>
      <div
        className={`absolute top-full z-30 mt-2 w-64 rounded-lg border border-line bg-white p-3 text-left text-xs font-normal text-ink shadow-xl ${
          align === 'right' ? 'right-0' : 'left-0'
        }`}
      >
        {children}
      </div>
    </details>
  );
}

function SortLinks({
  basePath,
  sp,
  options,
  current,
}: {
  basePath: string;
  sp: SearchParams;
  options: Array<[CustomerListSort, string]>;
  current: CustomerListSort;
}) {
  return (
    <div className="border-t border-line pt-2">
      <p className="mb-1 font-semibold text-muted">並び替え</p>
      <div className="space-y-1">
        {options.map(([value, label]) => (
          <Link
            key={value}
            href={queryHref(basePath, sp, { sort: value })}
            className={`block rounded px-2 py-1 hover:bg-sand ${current === value ? 'bg-sand font-semibold text-ink' : 'text-ink-soft'}`}
          >
            {current === value ? '✓ ' : ''}{label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function FilterChip({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink-soft hover:bg-sand">
      {children}<span aria-hidden>×</span>
    </Link>
  );
}

function liveCaseHref(recent: NonNullable<AccessibleCustomerListItem['recent_case']>): string {
  if (recent.open_quote_id) {
    return `/admin/quotes?case=${encodeURIComponent(recent.open_quote_id)}#case-workspace`;
  }
  return `/admin/quotes?request=${encodeURIComponent(recent.id)}#pending-quote-request`;
}

export function CustomerManagementList({
  customers,
  searchParams,
  showDealerColumn,
  basePath,
  dealerCompanyByCustomerId,
  demo = false,
  headingId,
}: {
  customers: AccessibleCustomerListItem[];
  searchParams: SearchParams;
  showDealerColumn: boolean;
  basePath: string;
  dealerCompanyByCustomerId?: Record<string, string | null | undefined>;
  demo?: boolean;
  headingId: string;
}) {
  const filters = parseCustomerListFilters(searchParams);
  const shown = filterAndSortCustomers(customers, filters);
  const dealerNames = Array.from(new Set(customers.map((customer) => customer.recent_case?.dealer_name).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'ja'));
  const sortLabel = customerListSortLabel(filters.sort);
  const customerSortActive = filters.sort === 'customer_asc' || filters.sort === 'customer_desc';
  const caseSortActive = ['cases_desc', 'cases_asc', 'case_asc', 'case_desc'].includes(filters.sort);
  const siteSortActive = filters.sort === 'site_asc' || filters.sort === 'site_desc';
  const dealerSortActive = filters.sort === 'dealer_asc' || filters.sort === 'dealer_desc';
  const updatedSortActive = filters.sort === 'updated_desc' || filters.sort === 'updated_asc';
  const hasColumnFilters = Boolean(filters.customer || filters.caseQuery || filters.caseMode || filters.site || filters.dealer || filters.from || filters.to || filters.sort);

  return (
    <>
      <form method="get" className="card p-4" aria-label={demo ? 'サンプル顧客を検索' : '顧客を検索'}>
        <PreservedInputs sp={searchParams} omit={['q']} />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">顧客名・法人名・電話番号・案件情報で検索</span>
            <input
              className="input w-full"
              name="q"
              defaultValue={filters.q}
              placeholder={demo ? '例：山田、サンプル住建、穴水町、W-DEMO' : '例：山田、株式会社○○、能登町、見積番号'}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn-secondary btn-sm">検索</button>
            <Link href={queryHref(basePath, searchParams, { q: null })} className="text-sm text-ink-soft underline-offset-4 hover:underline">検索を解除</Link>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
          <span>{demo ? 'サンプル顧客' : '参照可能な顧客'} {customers.length} 名</span>
          <span>表示 {shown.length} 名</span>
        </div>
        {(hasColumnFilters || filters.q) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {filters.q && <FilterChip href={queryHref(basePath, searchParams, { q: null })}>検索：{filters.q}</FilterChip>}
            {filters.customer && <FilterChip href={queryHref(basePath, searchParams, { customer: null })}>顧客：{filters.customer}</FilterChip>}
            {filters.caseQuery && <FilterChip href={queryHref(basePath, searchParams, { case_q: null })}>案件：{filters.caseQuery}</FilterChip>}
            {filters.caseMode && <FilterChip href={queryHref(basePath, searchParams, { case: null })}>{filters.caseMode === 'active' ? '進行中案件あり' : '進行中案件なし'}</FilterChip>}
            {filters.site && <FilterChip href={queryHref(basePath, searchParams, { site: null })}>設置予定地：{filters.site}</FilterChip>}
            {filters.dealer && <FilterChip href={queryHref(basePath, searchParams, { dealer: null })}>担当：{filters.dealer === '__unassigned__' ? '未割り当て' : filters.dealer}</FilterChip>}
            {(filters.from || filters.to) && <FilterChip href={queryHref(basePath, searchParams, { from: null, to: null })}>更新日：{filters.from || '指定なし'}〜{filters.to || '指定なし'}</FilterChip>}
            {sortLabel && <FilterChip href={queryHref(basePath, searchParams, { sort: null })}>並び替え：{sortLabel}</FilterChip>}
            {hasColumnFilters && (
              <Link
                href={queryHref(basePath, searchParams, { customer: null, case_q: null, case: null, site: null, dealer: null, from: null, to: null, sort: null })}
                className="ml-auto text-xs font-semibold text-ink-soft underline-offset-4 hover:underline"
              >
                絞り込み・並び替えを解除
              </Link>
            )}
          </div>
        )}
      </form>

      <section className="space-y-2" aria-labelledby={headingId}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id={headingId} className="text-lg font-semibold">顧客一覧</h2>
            <p className="mt-1 text-xs text-muted">列見出しの▼から、Excelのように絞り込み・並び替えができます。</p>
          </div>
          {demo && <span className="badge badge-navy">DEMO</span>}
        </div>

        <div className="card overflow-x-auto md:overflow-visible">
          <table className="w-full min-w-[40rem] table-fixed text-sm md:min-w-0">
            <colgroup>
              <col style={{ width: showDealerColumn ? '23%' : '27%' }} />
              <col style={{ width: showDealerColumn ? '18%' : '20%' }} />
              <col style={{ width: showDealerColumn ? '23%' : '33%' }} />
              {showDealerColumn && <col style={{ width: '17%' }} />}
              <col style={{ width: showDealerColumn ? '11%' : '12%' }} />
              <col style={{ width: '8%' }} />
            </colgroup>
            <thead className="bg-sand/60">
              <tr>
                <th className="px-2.5 py-2.5 text-left text-xs font-semibold text-muted">
                  <div className="flex items-center">顧客
                    <ColumnMenu label="顧客" active={Boolean(filters.customer || customerSortActive)}>
                      <form method="get" action={basePath} className="space-y-2">
                        <PreservedInputs sp={searchParams} omit={['customer']} />
                        <label className="block">
                          <span className="mb-1 block font-semibold text-muted">絞り込み</span>
                          <input name="customer" defaultValue={filters.customer} className="input w-full text-xs" placeholder="氏名・法人名・番号・電話" />
                        </label>
                        <button type="submit" className="btn-secondary btn-sm w-full">適用</button>
                      </form>
                      <div className="mt-2"><SortLinks basePath={basePath} sp={searchParams} current={filters.sort} options={[[ 'customer_asc', '顧客名 昇順' ], [ 'customer_desc', '顧客名 降順' ]]} /></div>
                    </ColumnMenu>
                  </div>
                </th>
                <th className="px-2.5 py-2.5 text-left text-xs font-semibold text-muted">
                  <div className="flex items-center">案件
                    <ColumnMenu label="案件" active={Boolean(filters.caseQuery || filters.caseMode || caseSortActive)}>
                      <form method="get" action={basePath} className="space-y-2">
                        <PreservedInputs sp={searchParams} omit={['case_q', 'case']} />
                        <label className="block"><span className="mb-1 block font-semibold text-muted">案件情報</span><input name="case_q" defaultValue={filters.caseQuery} className="input w-full text-xs" placeholder="見積番号・商品モデル" /></label>
                        <label className="block"><span className="mb-1 block font-semibold text-muted">進行中案件</span><select name="case" defaultValue={filters.caseMode} className="input w-full text-xs"><option value="">すべて</option><option value="active">あり</option><option value="none">なし</option></select></label>
                        <button type="submit" className="btn-secondary btn-sm w-full">適用</button>
                      </form>
                      <div className="mt-2"><SortLinks basePath={basePath} sp={searchParams} current={filters.sort} options={[[ 'cases_desc', '進行中件数 多い順' ], [ 'cases_asc', '進行中件数 少ない順' ], [ 'case_asc', '案件番号 昇順' ], [ 'case_desc', '案件番号 降順' ]]} /></div>
                    </ColumnMenu>
                  </div>
                </th>
                <th className="px-2.5 py-2.5 text-left text-xs font-semibold text-muted">
                  <div className="flex items-center">最近の設置予定地
                    <ColumnMenu label="最近の設置予定地" active={Boolean(filters.site || siteSortActive)}>
                      <form method="get" action={basePath} className="space-y-2">
                        <PreservedInputs sp={searchParams} omit={['site']} />
                        <label className="block"><span className="mb-1 block font-semibold text-muted">絞り込み</span><input name="site" defaultValue={filters.site} className="input w-full text-xs" placeholder="都道府県・市町村など" /></label>
                        <button type="submit" className="btn-secondary btn-sm w-full">適用</button>
                      </form>
                      <div className="mt-2"><SortLinks basePath={basePath} sp={searchParams} current={filters.sort} options={[[ 'site_asc', '設置予定地 昇順' ], [ 'site_desc', '設置予定地 降順' ]]} /></div>
                    </ColumnMenu>
                  </div>
                </th>
                {showDealerColumn && (
                  <th className="px-2.5 py-2.5 text-left text-xs font-semibold text-muted">
                    <div className="flex items-center">代理店 / 担当者
                      <ColumnMenu label="担当者" active={Boolean(filters.dealer || dealerSortActive)} align="right">
                        <form method="get" action={basePath} className="space-y-2">
                          <PreservedInputs sp={searchParams} omit={['dealer']} />
                          <label className="block"><span className="mb-1 block font-semibold text-muted">担当者で絞り込み</span><select name="dealer" defaultValue={filters.dealer} className="input w-full text-xs"><option value="">すべて</option>{dealerNames.map((name) => <option key={name} value={name}>{name}</option>)}<option value="__unassigned__">未割り当て</option></select></label>
                          <button type="submit" className="btn-secondary btn-sm w-full">適用</button>
                        </form>
                        <div className="mt-2"><SortLinks basePath={basePath} sp={searchParams} current={filters.sort} options={[[ 'dealer_asc', '担当者 昇順' ], [ 'dealer_desc', '担当者 降順' ]]} /></div>
                      </ColumnMenu>
                    </div>
                  </th>
                )}
                <th className="px-2.5 py-2.5 text-left text-xs font-semibold text-muted">
                  <div className="flex items-center">更新日
                    <ColumnMenu label="更新日" active={Boolean(filters.from || filters.to || updatedSortActive)} align="right">
                      <form method="get" action={basePath} className="space-y-2">
                        <PreservedInputs sp={searchParams} omit={['from', 'to']} />
                        <label className="block"><span className="mb-1 block font-semibold text-muted">開始日</span><input type="date" name="from" defaultValue={filters.from} className="input w-full text-xs" /></label>
                        <label className="block"><span className="mb-1 block font-semibold text-muted">終了日</span><input type="date" name="to" defaultValue={filters.to} className="input w-full text-xs" /></label>
                        <button type="submit" className="btn-secondary btn-sm w-full">適用</button>
                      </form>
                      <div className="mt-2"><SortLinks basePath={basePath} sp={searchParams} current={filters.sort} options={[[ 'updated_desc', '新しい順' ], [ 'updated_asc', '古い順' ]]} /></div>
                    </ColumnMenu>
                  </div>
                </th>
                <th className="px-2.5 py-2.5 text-left text-xs font-semibold text-muted">詳細</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.length === 0 ? (
                <tr><td colSpan={showDealerColumn ? 6 : 5} className="px-2.5 py-10 text-center text-sm text-muted">条件に一致する{demo ? 'サンプル' : ''}顧客はいません。</td></tr>
              ) : shown.map((customer) => {
                const recent = customer.recent_case;
                const caseHref = recent && !demo ? liveCaseHref(recent) : null;
                const dealerCompany = dealerCompanyByCustomerId?.[customer.id] ?? null;
                return (
                  <tr key={customer.id} data-testid={demo ? 'customer-management-demo-row' : 'customer-management-row'}>
                    <td className="break-words px-2.5 py-2.5 align-top">
                      <p className="font-semibold">{customer.full_name || '氏名未登録'}</p>
                      <p className="mt-1 text-xs text-muted">{customer.company_name ?? '法人名なし'}</p>
                      <p className="mt-1 text-[0.68rem] text-muted">顧客番号 {customer.customer_no ?? '未登録'}</p>
                      <p className="mt-1 text-xs text-muted">電話：{customer.phone ?? '未登録'}</p>
                    </td>
                    <td className="break-words px-2.5 py-2.5 align-top text-xs">
                      {recent ? (
                        caseHref ? (
                          <Link href={caseHref} className="font-semibold text-ink underline underline-offset-4">
                            {recent.quote_no ?? '見積未発行'}
                          </Link>
                        ) : (
                          <span className="font-semibold text-ink" title={demo ? 'サンプル画面では案件詳細へ遷移しません' : undefined}>
                            {recent.quote_no ?? '見積未発行'}
                          </span>
                        )
                      ) : (
                        <span className="text-muted">案件なし</span>
                      )}
                      <p className="mt-1 text-muted">{recent?.model_name ?? '商品モデル未登録'}</p>
                      <p className="mt-1 font-medium text-ink">進行中 {customer.ongoing_case_count}件</p>
                    </td>
                    <td className="break-words px-2.5 py-2.5 align-top text-xs text-muted">{recent?.site_address ?? '設置予定地未登録'}</td>
                    {showDealerColumn && (
                      <td className="break-words px-2.5 py-2.5 align-top text-xs">
                        {recent?.dealer_name || dealerCompany ? (
                          <div>
                            {dealerCompany && <p className="font-semibold text-ink">{dealerCompany}</p>}
                            <p className={dealerCompany ? 'mt-1 text-muted' : ''}>{recent?.dealer_name ?? '担当者未割り当て'}</p>
                          </div>
                        ) : (
                          <span className="text-muted">未割り当て</span>
                        )}
                      </td>
                    )}
                    <td className="px-2.5 py-2.5 align-top text-xs text-muted">{recent ? formatDate(recent.activity_at) : '—'}</td>
                    <td className="px-2.5 py-2.5 align-top"><Link href={`${basePath}/${encodeURIComponent(customer.id)}`} className="btn-secondary btn-sm whitespace-nowrap">詳細</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
