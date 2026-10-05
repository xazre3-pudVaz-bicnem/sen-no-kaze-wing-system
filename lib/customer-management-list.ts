import type { AccessibleCustomerListItem } from '@/lib/data/store';

export type CustomerListSort =
  | 'customer_asc'
  | 'customer_desc'
  | 'cases_desc'
  | 'cases_asc'
  | 'case_asc'
  | 'case_desc'
  | 'site_asc'
  | 'site_desc'
  | 'dealer_asc'
  | 'dealer_desc'
  | 'updated_desc'
  | 'updated_asc'
  | '';

export interface CustomerListFilters {
  q: string;
  customer: string;
  caseQuery: string;
  caseMode: 'active' | 'none' | '';
  site: string;
  dealer: string;
  from: string;
  to: string;
  sort: CustomerListSort;
}

const SORTS = new Set<CustomerListSort>([
  '',
  'customer_asc',
  'customer_desc',
  'cases_desc',
  'cases_asc',
  'case_asc',
  'case_desc',
  'site_asc',
  'site_desc',
  'dealer_asc',
  'dealer_desc',
  'updated_desc',
  'updated_asc',
]);

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

function cleanDate(value: string | undefined): string {
  const cleaned = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : '';
}

function normalized(value: string | null | undefined): string {
  return (value ?? '').toLocaleLowerCase('ja-JP');
}

function contains(value: string | null | undefined, query: string): boolean {
  return normalized(value).includes(normalized(query));
}

function compareNullableText(a: string | null | undefined, b: string | null | undefined, direction: 1 | -1): number {
  const left = clean(a ?? '');
  const right = clean(b ?? '');
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, 'ja') * direction;
}

export function parseCustomerListFilters(sp: Record<string, string | undefined>): CustomerListFilters {
  const rawSort = clean(sp.sort) as CustomerListSort;
  const caseMode = sp.case === 'active' || sp.case === 'none' ? sp.case : '';
  return {
    q: clean(sp.q),
    customer: clean(sp.customer),
    caseQuery: clean(sp.case_q),
    caseMode,
    site: clean(sp.site),
    dealer: clean(sp.dealer),
    from: cleanDate(sp.from),
    to: cleanDate(sp.to),
    sort: SORTS.has(rawSort) ? rawSort : '',
  };
}

export function filterAndSortCustomers(
  customers: AccessibleCustomerListItem[],
  filters: CustomerListFilters
): AccessibleCustomerListItem[] {
  const filtered = customers.filter((customer) => {
    const recent = customer.recent_case;

    if (
      filters.q &&
      ![
        customer.full_name,
        customer.company_name,
        customer.customer_no,
        customer.email,
        customer.phone,
        customer.address,
        recent?.site_address,
        recent?.quote_no,
        recent?.model_name,
        recent?.dealer_name,
      ].some((value) => contains(value, filters.q))
    ) {
      return false;
    }

    if (
      filters.customer &&
      ![customer.full_name, customer.company_name, customer.customer_no, customer.phone].some((value) =>
        contains(value, filters.customer)
      )
    ) {
      return false;
    }

    if (
      filters.caseQuery &&
      ![recent?.quote_no, recent?.model_name].some((value) => contains(value, filters.caseQuery))
    ) {
      return false;
    }

    if (filters.caseMode === 'active' && customer.ongoing_case_count <= 0) return false;
    if (filters.caseMode === 'none' && customer.ongoing_case_count > 0) return false;

    if (filters.site && !contains(recent?.site_address, filters.site)) return false;

    if (filters.dealer === '__unassigned__' && recent?.dealer_name) return false;
    if (filters.dealer && filters.dealer !== '__unassigned__' && recent?.dealer_name !== filters.dealer) return false;

    const activityDate = recent?.activity_at?.slice(0, 10) ?? '';
    if (filters.from && (!activityDate || activityDate < filters.from)) return false;
    if (filters.to && (!activityDate || activityDate > filters.to)) return false;

    return true;
  });

  if (!filters.sort) return filtered;

  return [...filtered].sort((a, b) => {
    const aRecent = a.recent_case;
    const bRecent = b.recent_case;
    switch (filters.sort) {
      case 'customer_asc':
        return compareNullableText(a.full_name || a.company_name, b.full_name || b.company_name, 1);
      case 'customer_desc':
        return compareNullableText(a.full_name || a.company_name, b.full_name || b.company_name, -1);
      case 'cases_desc':
        return b.ongoing_case_count - a.ongoing_case_count;
      case 'cases_asc':
        return a.ongoing_case_count - b.ongoing_case_count;
      case 'case_asc':
        return compareNullableText(aRecent?.quote_no, bRecent?.quote_no, 1);
      case 'case_desc':
        return compareNullableText(aRecent?.quote_no, bRecent?.quote_no, -1);
      case 'site_asc':
        return compareNullableText(aRecent?.site_address, bRecent?.site_address, 1);
      case 'site_desc':
        return compareNullableText(aRecent?.site_address, bRecent?.site_address, -1);
      case 'dealer_asc':
        return compareNullableText(aRecent?.dealer_name, bRecent?.dealer_name, 1);
      case 'dealer_desc':
        return compareNullableText(aRecent?.dealer_name, bRecent?.dealer_name, -1);
      case 'updated_desc':
        return compareNullableText(aRecent?.activity_at, bRecent?.activity_at, -1);
      case 'updated_asc':
        return compareNullableText(aRecent?.activity_at, bRecent?.activity_at, 1);
      default:
        return 0;
    }
  });
}

export function customerListSortLabel(sort: CustomerListSort): string | null {
  switch (sort) {
    case 'customer_asc': return '顧客名 昇順';
    case 'customer_desc': return '顧客名 降順';
    case 'cases_desc': return '進行中案件 多い順';
    case 'cases_asc': return '進行中案件 少ない順';
    case 'case_asc': return '案件番号 昇順';
    case 'case_desc': return '案件番号 降順';
    case 'site_asc': return '設置予定地 昇順';
    case 'site_desc': return '設置予定地 降順';
    case 'dealer_asc': return '担当 昇順';
    case 'dealer_desc': return '担当 降順';
    case 'updated_desc': return '最終更新 新しい順';
    case 'updated_asc': return '最終更新 古い順';
    default: return null;
  }
}
