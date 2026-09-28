import type { Quote, QuoteRequest } from './types';

type QuoteLifecycleFields = Pick<Quote, 'id' | 'status' | 'parent_quote_id' | 'quote_kind'>;

/**
 * New Quote revisions carry an explicit semantic kind.
 * Legacy rows without quote_kind keep the previous lineage fallback until a
 * separately reviewed backfill can remove it.
 */
export function isFormalQuote(quote: Pick<Quote, 'parent_quote_id' | 'quote_kind'>) {
  return quote.quote_kind === 'formal'
    || (quote.quote_kind == null && quote.parent_quote_id !== null);
}

/**
 * Formality is semantic, not inferred from having a parent. This allows a
 * non-Web Revision 1 to be formal while keeping legacy Web revisions working.
 */
export function isCurrentFormalQuote(quote: QuoteLifecycleFields, request: Pick<QuoteRequest, 'quote_id'> | null) {
  return isFormalQuote(quote) && request?.quote_id === quote.id;
}

/** Both responses require the currently issued snapshot, never a stale version. */
export function isCurrentIssuedQuote(quote: QuoteLifecycleFields, request: Pick<QuoteRequest, 'quote_id'> | null) {
  return quote.status === 'issued' && request?.quote_id === quote.id;
}

/** Only the current formal snapshot can be accepted as a contract candidate. */
export function isQuoteAcceptanceEligible(quote: QuoteLifecycleFields, request: Pick<QuoteRequest, 'quote_id'> | null) {
  return isCurrentIssuedQuote(quote, request) && isCurrentFormalQuote(quote, request);
}

/** A customer may decline either a preliminary or formal current snapshot. */
export function isQuoteDeclineEligible(quote: QuoteLifecycleFields, request: Pick<QuoteRequest, 'quote_id'> | null) {
  return isCurrentIssuedQuote(quote, request);
}

/** An accepted quote may advance to contract confirmation only when it is formal and current. */
export function isFormallyAcceptedQuote(quote: QuoteLifecycleFields, request: Pick<QuoteRequest, 'quote_id'> | null) {
  return quote.status === 'accepted' && isCurrentFormalQuote(quote, request);
}

/**
 * Accepted snapshots remain distinguishable when a caller cannot read the
 * current-request pointer. Contract progression still requires
 * `formal_current`.
 */
export function getAcceptedQuoteCaseState(quote: QuoteLifecycleFields, request: Pick<QuoteRequest, 'quote_id'> | null) {
  if (quote.status !== 'accepted') return 'not_accepted' as const;
  if (isFormallyAcceptedQuote(quote, request)) return 'formal_current' as const;
  return isFormalQuote(quote) ? 'formal_unconfirmed' as const : 'preliminary' as const;
}
