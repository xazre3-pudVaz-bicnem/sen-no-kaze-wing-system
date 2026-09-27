import type {
  Configuration,
  Profile,
  Quote,
  QuoteContact,
  QuoteRequest,
} from '@/lib/domain/types';

export type CustomerSiteSource = 'quote_contact' | 'configuration' | null;

export interface CustomerCaseView {
  id: string;
  userId: string | null;
  request: QuoteRequest | null;
  configuration: Configuration | null;
  quotes: Quote[];
  latestQuote: Quote | null;
  contact: QuoteContact | null;
  siteAddress: string | null;
  siteSource: CustomerSiteSource;
  dealer: Profile | null;
  ongoing: boolean;
  activityAt: string;
  identityIssue: 'none' | 'inconsistent_user_id' | 'non_customer_profile' | 'missing_profile';
}

export interface CustomerSummary {
  profile: Profile;
  cases: CustomerCaseView[];
  ongoingCases: CustomerCaseView[];
  pastCases: CustomerCaseView[];
  recentCase: CustomerCaseView | null;
  quoteHistory: Quote[];
  latestContact: QuoteContact | null;
}

export interface CustomerManagementView {
  customers: CustomerSummary[];
  unlinkedCases: CustomerCaseView[];
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function latestIso(values: (string | null | undefined)[]): string {
  const present = values.filter((value): value is string => Boolean(value));
  if (!present.length) return '';
  return present.reduce((latest, current) => (timestamp(current) > timestamp(latest) ? current : latest));
}

function latestQuoteOf(quotes: Quote[]): Quote | null {
  if (!quotes.length) return null;
  return [...quotes].sort(
    (a, b) =>
      b.revision - a.revision ||
      timestamp(b.issued_at) - timestamp(a.issued_at) ||
      timestamp(b.updated_at) - timestamp(a.updated_at)
  )[0] ?? null;
}

function configurationSiteAddress(configuration: Configuration | null): string | null {
  if (!configuration) return null;
  if (configuration.site_location_undecided) return '未定';
  const value = [configuration.site_prefecture, configuration.site_municipality].filter(Boolean).join('');
  return value || null;
}

function isOngoingCase(request: QuoteRequest | null, latestQuote: Quote | null): boolean {
  if (request) return request.status === 'new' || request.status === 'reviewing' || request.status === 'sent';
  if (!latestQuote) return false;
  return latestQuote.status === 'issued' || latestQuote.status === 'accepted';
}

function resolveCaseUserId(request: QuoteRequest | null, quotes: Quote[]): {
  userId: string | null;
  inconsistent: boolean;
} {
  const ids = new Set<string>();
  if (request?.user_id) ids.add(request.user_id);
  for (const quote of quotes) {
    if (quote.user_id) ids.add(quote.user_id);
  }
  if (ids.size !== 1) return { userId: null, inconsistent: ids.size > 1 };
  return { userId: [...ids][0] ?? null, inconsistent: false };
}

function buildCase(
  id: string,
  request: QuoteRequest | null,
  quotes: Quote[],
  profileById: Map<string, Profile>,
  configurationById: Map<string, Configuration>,
  customerIds: Set<string>
): CustomerCaseView {
  const sortedQuotes = [...quotes].sort(
    (a, b) =>
      b.revision - a.revision ||
      timestamp(b.issued_at) - timestamp(a.issued_at) ||
      timestamp(b.updated_at) - timestamp(a.updated_at)
  );
  const latestQuote = latestQuoteOf(sortedQuotes);
  const identity = resolveCaseUserId(request, sortedQuotes);
  const rawConfigurationId = request?.configuration_id ?? latestQuote?.configuration_id ?? null;
  const candidateConfiguration = rawConfigurationId ? configurationById.get(rawConfigurationId) ?? null : null;
  const configuration =
    candidateConfiguration && identity.userId && candidateConfiguration.user_id === identity.userId
      ? candidateConfiguration
      : null;

  const contactSite = request?.contact.site_address?.trim() || null;
  const fallbackSite = configurationSiteAddress(configuration);
  const siteAddress = contactSite ?? fallbackSite;
  const siteSource: CustomerSiteSource = contactSite ? 'quote_contact' : fallbackSite ? 'configuration' : null;

  const dealerProfile = latestQuote?.dealer_id ? profileById.get(latestQuote.dealer_id) ?? null : null;
  const dealer = dealerProfile?.role_code === 'customer' ? null : dealerProfile;

  let identityIssue: CustomerCaseView['identityIssue'] = 'none';
  if (identity.inconsistent) {
    identityIssue = 'inconsistent_user_id';
  } else if (!identity.userId || !profileById.has(identity.userId)) {
    identityIssue = 'missing_profile';
  } else if (!customerIds.has(identity.userId)) {
    identityIssue = 'non_customer_profile';
  }

  return {
    id,
    userId: identity.userId,
    request,
    configuration,
    quotes: sortedQuotes,
    latestQuote,
    contact: request?.contact ?? null,
    siteAddress,
    siteSource,
    dealer,
    ongoing: isOngoingCase(request, latestQuote),
    activityAt: latestIso([
      request?.updated_at,
      request?.created_at,
      latestQuote?.updated_at,
      latestQuote?.issued_at,
      latestQuote?.created_at,
      configuration?.updated_at,
    ]),
    identityIssue,
  };
}

/**
 * 既存の user_id が明確に一致するデータだけを、顧客アカウント単位で参照用に束ねる。
 * Profile / QuoteContact のどちらも顧客情報の正本とは扱わず、氏名・メール等で自動統合しない。
 */
export function buildCustomerManagementView(input: {
  profiles: Profile[];
  quotes: Quote[];
  requests: QuoteRequest[];
  configurations: Configuration[];
}): CustomerManagementView {
  const profileById = new Map(input.profiles.map((profile) => [profile.id, profile]));
  const configurationById = new Map(input.configurations.map((configuration) => [configuration.id, configuration]));
  const customerProfiles = input.profiles.filter((profile) => profile.role_code === 'customer');
  const customerIds = new Set(customerProfiles.map((profile) => profile.id));

  const quotesByRequest = new Map<string, Quote[]>();
  for (const quote of input.quotes) {
    const list = quotesByRequest.get(quote.quote_request_id) ?? [];
    list.push(quote);
    quotesByRequest.set(quote.quote_request_id, list);
  }

  const cases: CustomerCaseView[] = [];
  const seenRequestIds = new Set<string>();

  for (const request of input.requests) {
    seenRequestIds.add(request.id);
    cases.push(
      buildCase(
        request.id,
        request,
        quotesByRequest.get(request.id) ?? [],
        profileById,
        configurationById,
        customerIds
      )
    );
  }

  for (const [requestId, quotes] of quotesByRequest.entries()) {
    if (seenRequestIds.has(requestId)) continue;
    cases.push(buildCase(requestId, null, quotes, profileById, configurationById, customerIds));
  }

  cases.sort((a, b) => timestamp(b.activityAt) - timestamp(a.activityAt));

  const casesByCustomerId = new Map<string, CustomerCaseView[]>();
  const unlinkedCases: CustomerCaseView[] = [];

  for (const customerCase of cases) {
    if (
      customerCase.identityIssue === 'none' &&
      customerCase.userId &&
      customerIds.has(customerCase.userId)
    ) {
      const list = casesByCustomerId.get(customerCase.userId) ?? [];
      list.push(customerCase);
      casesByCustomerId.set(customerCase.userId, list);
    } else {
      unlinkedCases.push(customerCase);
    }
  }

  const customers = customerProfiles.map((profile): CustomerSummary => {
    const customerCases = casesByCustomerId.get(profile.id) ?? [];
    const quoteHistory = customerCases
      .flatMap((customerCase) => customerCase.quotes)
      .sort(
        (a, b) =>
          timestamp(b.issued_at) - timestamp(a.issued_at) ||
          b.revision - a.revision ||
          timestamp(b.updated_at) - timestamp(a.updated_at)
      );
    return {
      profile,
      cases: customerCases,
      ongoingCases: customerCases.filter((customerCase) => customerCase.ongoing),
      pastCases: customerCases.filter((customerCase) => !customerCase.ongoing),
      recentCase: customerCases[0] ?? null,
      quoteHistory,
      latestContact: customerCases.find((customerCase) => customerCase.contact)?.contact ?? null,
    };
  });

  customers.sort((a, b) => {
    const activity = timestamp(b.recentCase?.activityAt) - timestamp(a.recentCase?.activityAt);
    if (activity !== 0) return activity;
    return a.profile.full_name.localeCompare(b.profile.full_name, 'ja');
  });

  return { customers, unlinkedCases };
}

export function customerCaseHref(customerCase: CustomerCaseView): string {
  if (customerCase.latestQuote) {
    return `/admin/quotes?case=${encodeURIComponent(customerCase.latestQuote.id)}#case-workspace`;
  }
  if (customerCase.request) {
    return `/admin/quotes?request=${encodeURIComponent(customerCase.request.id)}#pending-quote-request`;
  }
  return '/admin/quotes';
}

export function customerCaseLabel(customerCase: CustomerCaseView): string {
  if (customerCase.latestQuote) return customerCase.latestQuote.quote_no;
  if (customerCase.request) return '見積未発行';
  return '案件情報';
}
