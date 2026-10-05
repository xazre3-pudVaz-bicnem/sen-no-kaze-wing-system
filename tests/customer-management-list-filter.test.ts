import { describe, expect, it } from 'vitest';
import { DEMO_CUSTOMERS } from '@/lib/demo/customer-management';
import { filterAndSortCustomers, parseCustomerListFilters } from '@/lib/customer-management-list';

describe('顧客一覧の絞り込みと並び替え', () => {
  it('filters by customer identity without using hidden customer address as a column filter', () => {
    const filters = parseCustomerListFilters({ customer: 'サンプル住建' });
    const result = filterAndSortCustomers(DEMO_CUSTOMERS, filters);
    expect(result.map((customer) => customer.customer_no)).toEqual(['DEMO-0001']);
  });

  it('filters by case presence, case text, site, dealer, and update date', () => {
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ case: 'active' })).map((customer) => customer.customer_no)).toEqual([
      'DEMO-0001',
      'DEMO-0003',
    ]);
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ case_q: 'BOX' })).map((customer) => customer.customer_no)).toEqual([
      'DEMO-0002',
    ]);
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ site: '穴水町' })).map((customer) => customer.customer_no)).toEqual([
      'DEMO-0001',
    ]);
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ dealer: '奥能登 次郎' })).map((customer) => customer.customer_no)).toEqual([
      'DEMO-0002',
    ]);
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ dealer: '__unassigned__' })).map((customer) => customer.customer_no)).toEqual([
      'DEMO-0003',
    ]);
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ from: '2026-09-29' })).map((customer) => customer.customer_no)).toEqual([
      'DEMO-0003',
    ]);
  });

  it('keeps global search broad while column filters stay column-specific', () => {
    const global = filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ q: 'demo.yamada@example.com' }));
    expect(global.map((customer) => customer.customer_no)).toEqual(['DEMO-0001']);

    const customerColumn = filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ customer: 'demo.yamada@example.com' }));
    expect(customerColumn).toEqual([]);
  });

  it('sorts by customer, ongoing case count, site, dealer, and update date', () => {
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ sort: 'customer_asc' })).map((customer) => customer.full_name)).toEqual([
      '佐藤 花子',
      '山田 太郎',
      '鈴木 一郎',
    ]);
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ sort: 'cases_asc' })).map((customer) => customer.customer_no)[0]).toBe('DEMO-0002');
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ sort: 'site_asc' })).map((customer) => customer.customer_no).at(-1)).toBe('DEMO-0002');
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ sort: 'dealer_asc' })).map((customer) => customer.customer_no).at(-1)).toBe('DEMO-0003');
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, parseCustomerListFilters({ sort: 'updated_desc' })).map((customer) => customer.customer_no)).toEqual([
      'DEMO-0003',
      'DEMO-0001',
      'DEMO-0002',
    ]);
  });

  it('ignores invalid sort and invalid dates safely', () => {
    const filters = parseCustomerListFilters({ sort: 'dangerous', from: '2026/09/01', to: 'not-a-date' });
    expect(filters.sort).toBe('');
    expect(filters.from).toBe('');
    expect(filters.to).toBe('');
    expect(filterAndSortCustomers(DEMO_CUSTOMERS, filters)).toEqual(DEMO_CUSTOMERS);
  });
});
