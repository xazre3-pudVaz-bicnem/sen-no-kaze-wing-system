import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { isMissingNamedFunction } from '@/lib/data/schema-compat';
import { isCurrentAcceptedPreliminaryForFormalization, isFormalQuote } from '@/lib/domain/quote-lifecycle';
import { createClient } from '@/lib/supabase/server';

type FormalizationState = 'eligible' | 'historical' | 'ineligible' | 'unavailable';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await requireStaff();
  const { id } = await params;

  if (isLocalMode()) {
    const store = await getStore();
    const detail = await store.getQuote(id, actor);
    if (!detail) return NextResponse.json({ state: 'ineligible' satisfies FormalizationState });

    const { quote, request } = detail;
    if (isCurrentAcceptedPreliminaryForFormalization(quote, request)) {
      return NextResponse.json({ state: 'eligible' satisfies FormalizationState, currentQuoteId: quote.id });
    }

    const preliminaryAccepted =
      quote.status === 'accepted' &&
      (quote.quote_kind === 'preliminary' || (quote.quote_kind == null && quote.parent_quote_id === null));
    const currentQuoteId = request?.quote_id ?? null;
    if (preliminaryAccepted && currentQuoteId && currentQuoteId !== quote.id) {
      const current = await store.getQuote(currentQuoteId, actor);
      return NextResponse.json({
        state: 'historical' satisfies FormalizationState,
        currentQuoteId: current && isFormalQuote(current.quote) ? current.quote.id : null,
      });
    }

    return NextResponse.json({ state: 'ineligible' satisfies FormalizationState });
  }

  const db = await createClient();
  const { data, error } = await db.rpc('get_legacy_accepted_formalization_state', { p_quote_id: id });
  if (error) {
    if (isMissingNamedFunction(error, 'get_legacy_accepted_formalization_state')) {
      return NextResponse.json({ state: 'unavailable' satisfies FormalizationState });
    }
    // Authorization, schema drift, and unexpected DB failures all fail closed.
    return NextResponse.json({ state: 'unavailable' satisfies FormalizationState });
  }

  const row = Array.isArray(data) ? data[0] : null;
  const state = row?.state;
  if (state !== 'eligible' && state !== 'historical' && state !== 'ineligible') {
    return NextResponse.json({ state: 'unavailable' satisfies FormalizationState });
  }

  return NextResponse.json({
    state: state as FormalizationState,
    currentQuoteId: typeof row?.current_quote_id === 'string' ? row.current_quote_id : null,
  });
}
