import { describe, expect, it } from 'vitest';
import { buildCustomerManagementView } from '@/lib/domain/customer-management';
import type { Configuration, Profile, Quote, QuoteRequest } from '@/lib/domain/types';

const profile = (id: string, role: Profile['role_code'], overrides: Partial<Profile> = {}): Profile =>
  ({
    id,
    customer_no: role === 'customer' ? `C-${id}` : null,
    email: `${id}@example.com`,
    full_name: id,
    company_name: null,
    phone: null,
    postal_code: null,
    address: null,
    role_code: role,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }) as Profile;

const request = (
  id: string,
  userId: string,
  configurationId: string,
  overrides: Partial<QuoteRequest> = {}
): QuoteRequest =>
  ({
    id,
    configuration_id: configurationId,
    user_id: userId,
    quote_id: null,
    status: 'reviewing',
    message: null,
    contact: {
      full_name: '山田 太郎',
      company_name: '山田商事',
      email: 'yamada@example.com',
      phone: '090-0000-0000',
      address: '石川県',
      site_address: null,
    },
    created_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-20T00:00:00Z',
    ...overrides,
  }) as QuoteRequest;

const quote = (
  id: string,
  requestId: string,
  userId: string,
  revision: number,
  overrides: Partial<Quote> = {}
): Quote =>
  ({
    id,
    quote_no: `Q-${id}`,
    quote_request_id: requestId,
    configuration_id: `cfg-${requestId}`,
    user_id: userId,
    status: 'issued',
    issued_at: `2026-09-${20 + revision}T00:00:00Z`,
    valid_until: '2026-10-31T00:00:00Z',
    customer_no: null,
    customer_name: '山田 太郎',
    customer_company: '山田商事',
    base_model_name: 'Wing',
    finish_level: 'full',
    base_price: 0,
    base_expense: 0,
    option_subtotal: 0,
    option_expense: 0,
    installation_subtotal: 0,
    adjustment: 0,
    subtotal: 0,
    tax_rate: 0.1,
    tax: 0,
    total: 5000000,
    dealer_id: null,
    dealer_note: null,
    revision,
    parent_quote_id: null,
    preview_image_url: null,
    notes: null,
    created_at: `2026-09-${20 + revision}T00:00:00Z`,
    updated_at: `2026-09-${20 + revision}T00:00:00Z`,
    ...overrides,
  }) as Quote;

const configuration = (id: string, userId: string, overrides: Partial<Configuration> = {}): Configuration =>
  ({
    id,
    user_id: userId,
    base_model_id: 'wing-01',
    name: '保存仕様',
    status: 'quoted',
    finish_level: 'full',
    spec_code: 'hotel',
    site_prefecture: '石川県',
    site_municipality: '穴水町',
    site_location_undecided: false,
    base_price: 0,
    base_expense: 0,
    option_subtotal: 0,
    option_expense: 0,
    installation_subtotal: 0,
    adjustment: 0,
    subtotal: 0,
    tax: 0,
    total: 0,
    preview_image_url: null,
    notes: null,
    partner_id: null,
    created_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-20T00:00:00Z',
    ...overrides,
  }) as Configuration;

describe('customer management read model', () => {
  it('groups only by an existing customer user_id and keeps quote revisions inside one case', () => {
    const customer = profile('customer-1', 'customer', { full_name: '山田 太郎' });
    const dealer = profile('dealer-1', 'dealer', { full_name: '能登代理店 担当者' });
    const req = request('request-1', customer.id, 'cfg-request-1');
    const q1 = quote('quote-1', req.id, customer.id, 1);
    const q2 = quote('quote-2', req.id, customer.id, 2, {
      dealer_id: dealer.id,
      parent_quote_id: q1.id,
    });

    const view = buildCustomerManagementView({
      profiles: [customer, dealer],
      requests: [req],
      quotes: [q1, q2],
      configurations: [configuration('cfg-request-1', customer.id)],
    });

    expect(view.customers).toHaveLength(1);
    expect(view.unlinkedCases).toHaveLength(0);
    expect(view.customers[0].cases).toHaveLength(1);
    expect(view.customers[0].quoteHistory.map((item) => item.id)).toEqual(['quote-2', 'quote-1']);
    expect(view.customers[0].recentCase?.latestQuote?.id).toBe('quote-2');
    expect(view.customers[0].recentCase?.dealer?.id).toBe(dealer.id);
    expect(view.customers[0].recentCase?.siteAddress).toBe('石川県穴水町');
    expect(view.customers[0].recentCase?.siteSource).toBe('configuration');
    expect(view.customers[0].ongoingCases).toHaveLength(1);
  });

  it('does not merge a staff-created case into a customer even when name and email match', () => {
    const customer = profile('customer-1', 'customer', {
      full_name: '山田 太郎',
      email: 'same@example.com',
    });
    const staff = profile('dealer-1', 'dealer', {
      full_name: '受付担当',
      email: 'dealer@example.com',
    });
    const staffRequest = request('manual-request', staff.id, 'cfg-manual', {
      contact: {
        full_name: '山田 太郎',
        company_name: null,
        email: 'same@example.com',
        phone: '',
        address: '',
        site_address: null,
      },
    });
    const staffQuote = quote('manual-quote', staffRequest.id, staff.id, 1, {
      customer_name: '山田 太郎',
    });

    const view = buildCustomerManagementView({
      profiles: [customer, staff],
      requests: [staffRequest],
      quotes: [staffQuote],
      configurations: [configuration('cfg-manual', staff.id)],
    });

    expect(view.customers[0].cases).toHaveLength(0);
    expect(view.unlinkedCases).toHaveLength(1);
    expect(view.unlinkedCases[0].identityIssue).toBe('non_customer_profile');
    expect(view.unlinkedCases[0].userId).toBe(staff.id);
  });

  it('keeps separate customer accounts separate even when their names and emails are identical', () => {
    const first = profile('customer-1', 'customer', {
      full_name: '同姓 同名',
      email: 'same@example.com',
    });
    const second = profile('customer-2', 'customer', {
      full_name: '同姓 同名',
      email: 'same@example.com',
    });
    const request1 = request('request-1', first.id, 'cfg-1');
    const request2 = request('request-2', second.id, 'cfg-2');

    const view = buildCustomerManagementView({
      profiles: [first, second],
      requests: [request1, request2],
      quotes: [
        quote('quote-1', request1.id, first.id, 1, { configuration_id: 'cfg-1' }),
        quote('quote-2', request2.id, second.id, 1, { configuration_id: 'cfg-2' }),
      ],
      configurations: [configuration('cfg-1', first.id), configuration('cfg-2', second.id)],
    });

    expect(view.customers).toHaveLength(2);
    expect(view.customers.find((item) => item.profile.id === first.id)?.cases.map((item) => item.id)).toEqual(['request-1']);
    expect(view.customers.find((item) => item.profile.id === second.id)?.cases.map((item) => item.id)).toEqual(['request-2']);
  });

  it('separates a case when request and quote user_id disagree', () => {
    const first = profile('customer-1', 'customer');
    const second = profile('customer-2', 'customer');
    const req = request('request-mismatch', first.id, 'cfg-mismatch');
    const mismatchedQuote = quote('quote-mismatch', req.id, second.id, 1, {
      configuration_id: 'cfg-mismatch',
    });

    const view = buildCustomerManagementView({
      profiles: [first, second],
      requests: [req],
      quotes: [mismatchedQuote],
      configurations: [configuration('cfg-mismatch', first.id)],
    });

    expect(view.customers.every((item) => item.cases.length === 0)).toBe(true);
    expect(view.unlinkedCases).toHaveLength(1);
    expect(view.unlinkedCases[0].identityIssue).toBe('inconsistent_user_id');
    expect(view.unlinkedCases[0].configuration).toBeNull();
  });
});
