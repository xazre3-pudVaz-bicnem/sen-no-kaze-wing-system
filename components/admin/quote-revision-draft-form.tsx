'use client';

import { useActionState } from 'react';
import { createQuoteRevisionDraftAction } from '@/lib/actions/admin';
import { Status, SubmitButton } from './forms';

const initial = { ok: false } as const;

export function QuoteRevisionDraftForm({
  quoteId,
  revision,
}: {
  quoteId: string;
  revision: number;
}) {
  const [state, action, pending] = useActionState(createQuoteRevisionDraftAction, initial);

  return (
    <form
      action={action}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d3e0d8] bg-[#f5faf7] p-3"
      data-testid="quote-revision-draft-start"
    >
      <input type="hidden" name="quote_id" value={quoteId} />
      <div>
        <p className="text-sm font-semibold">第{revision + 1}版のDraftを作成</p>
        <p className="mt-0.5 text-xs text-muted">
          現在の第{revision}版をコピーして編集します。Draft保存だけでは正式Revisionは増えません。
        </p>
        <Status state={state} />
      </div>
      <SubmitButton pending={pending} label="見積内容を更新" />
    </form>
  );
}
