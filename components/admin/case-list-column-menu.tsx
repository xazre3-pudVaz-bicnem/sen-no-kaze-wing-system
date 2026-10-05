import Link from 'next/link';

type SearchParams = Record<string, string | undefined>;

type FilterOption = {
  value: string;
  label: string;
};

type Props = {
  label: string;
  searchParams: SearchParams;
  sortAsc: string;
  sortDesc: string;
  activeSort?: string;
  align?: 'left' | 'right';
  filterKey?: 'phase' | 'model' | 'dealer';
  activeFilter?: string;
  filterLabel?: string;
  filterOptions?: FilterOption[];
};

const LIST_PARAM_KEYS = ['q', 'status', 'dealer', 'pref', 'city', 'phase', 'model', 'sort'] as const;

function hrefWith(
  searchParams: SearchParams,
  changes: Record<string, string | null | undefined>
) {
  const query = new URLSearchParams();
  for (const key of LIST_PARAM_KEYS) {
    const value = searchParams[key];
    if (value) query.set(key, value);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value) query.set(key, value);
    else query.delete(key);
  }
  const qs = query.toString();
  return qs ? `/admin/quotes?${qs}` : '/admin/quotes';
}

function menuLinkClass(active: boolean) {
  return `block rounded px-2 py-1.5 text-[0.68rem] ${active ? 'bg-[#edf5f0] font-semibold text-[#315745]' : 'text-ink-soft hover:bg-[#f7faf8]'}`;
}

export function CaseListColumnMenu({
  label,
  searchParams,
  sortAsc,
  sortDesc,
  activeSort = '',
  align = 'left',
  filterKey,
  activeFilter = '',
  filterLabel,
  filterOptions = [],
}: Props) {
  const sortMark = activeSort === sortAsc ? '↑' : activeSort === sortDesc ? '↓' : '';
  const filtered = Boolean(filterKey && activeFilter);

  return (
    <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-between'}`}>
      <span className="min-w-0 truncate">
        {label}{sortMark ? <span className="ml-1 text-[#315745]">{sortMark}</span> : null}
      </span>
      <details className="group relative shrink-0">
        <summary
          className={`flex size-6 cursor-pointer list-none items-center justify-center rounded border text-[0.62rem] [&::-webkit-details-marker]:hidden ${filtered || sortMark ? 'border-[#86a894] bg-white text-[#315745]' : 'border-transparent text-[#6a7971] hover:border-[#c7d4cd] hover:bg-white'}`}
          aria-label={`${label}を並び替え・絞り込み`}
          title={`${label}を並び替え・絞り込み`}
        >
          ▼
        </summary>
        <div className={`absolute top-full z-40 mt-1 w-56 rounded-lg border border-line bg-white p-2 text-left shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <p className="px-2 pb-1 text-[0.62rem] font-semibold text-muted">並び替え</p>
          <Link href={hrefWith(searchParams, { sort: sortAsc })} className={menuLinkClass(activeSort === sortAsc)}>
            昇順
          </Link>
          <Link href={hrefWith(searchParams, { sort: sortDesc })} className={menuLinkClass(activeSort === sortDesc)}>
            降順
          </Link>
          {activeSort === sortAsc || activeSort === sortDesc ? (
            <Link href={hrefWith(searchParams, { sort: null })} className="mt-1 block border-t border-line px-2 pt-2 text-[0.65rem] text-muted hover:text-ink">
              この列の並び替えを解除
            </Link>
          ) : null}

          {filterKey ? (
            <div className="mt-2 border-t border-line pt-2">
              <p className="px-2 pb-1 text-[0.62rem] font-semibold text-muted">{filterLabel ?? '絞り込み'}</p>
              <Link href={hrefWith(searchParams, { [filterKey]: null })} className={menuLinkClass(!activeFilter)}>
                すべて
              </Link>
              <div className="max-h-56 overflow-y-auto">
                {filterOptions.map((option) => (
                  <Link
                    key={option.value}
                    href={hrefWith(searchParams, { [filterKey]: option.value })}
                    className={menuLinkClass(activeFilter === option.value)}
                  >
                    {option.label}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}
