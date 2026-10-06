'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Quote } from '@/lib/domain/types';

type FormalizationState = {
  state: 'eligible' | 'historical' | 'ineligible' | 'unavailable';
  currentQuoteId?: string | null;
};

export function LegacyAcceptedFormalizationEntry({ quote }: { quote: Quote }) {
  const candidate =
    quote.status === 'accepted' &&
    (quote.quote_kind === 'preliminary' || (quote.quote_kind == null && quote.parent_quote_id === null));
  const [result, setResult] = useState<FormalizationState | null>(null);

  useEffect(() => {
    if (!candidate) return;
    const controller = new AbortController();
    fetch(`/api/admin/quotes/${encodeURIComponent(quote.id)}/formalization-state`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => (response.ok ? response.json() as Promise<FormalizationState> : null))
      .then((value) => {
        if (value) setResult(value);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [candidate, quote.id]);

  if (!candidate || !result || result.state === 'ineligible' || result.state === 'unavailable') return null;

  if (result.state === 'historical') {
    return (
      <div
        className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-[#f7f8f8] px-3 py-2"
        data-testid="legacy-accepted-historical-state"
      >
        <div>
          <p className="text-sm font-semibold text-ink">過去の概算承諾履歴</p>
          <p className="mt-0.5 text-xs text-muted">
            この概算見積は履歴です。ここから確定見積を再作成することはできません。
          </p>
        </div>
        {result.currentQuoteId && (
          <Link
            href={`/admin/quotes?case=${encodeURIComponent(result.currentQuoteId)}&tab=estimate#case-workspace`}
            className="btn-secondary btn-sm"
            data-testid="legacy-accepted-current-formal-link"
          >
            現在の確定見積を開く
          </Link>
        )}
      </div>
    );
  }

  return (
    <div
      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-[#d9b65f] bg-[#fff9e9] px-3 py-3"
      data-testid="legacy-accepted-formalization-entry"
    >
      <div>
        <p className="text-sm font-semibold text-[#6f5518]">概算見積は承諾済みです</p>
        <p className="mt-0.5 text-xs leading-5 text-ink-soft">
          現地確認後の施工金額を入力し、承諾済み概算を変更せずに新しい確定見積を発行できます。
        </p>
      </div>
      <Link
        href={`/admin/quotes/${encodeURIComponent(quote.id)}/formalize`}
        className="btn-primary btn-sm"
        data-testid="legacy-accepted-formalization-link"
      >
        施工金額を入力する
      </Link>
    </div>
  );
}
