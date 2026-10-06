import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth/session';
import { isLocalMode } from '@/lib/data/store';
import { isMissingNamedFunction } from '@/lib/data/schema-compat';
import { createClient } from '@/lib/supabase/server';

type FormalizationState = 'eligible' | 'historical' | 'ineligible' | 'unavailable';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireStaff();
  const { id } = await params;

  // There is intentionally no LocalStore write equivalent for this privileged
  // transaction. Do not advertise an operation that cannot preserve DB locks.
  if (isLocalMode()) {
    return NextResponse.json({ state: 'unavailable' satisfies FormalizationState });
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
