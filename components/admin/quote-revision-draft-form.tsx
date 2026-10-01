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
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">第{revision + 1}版の見積下書き</p>
          <span className="rounded-full bg-white px-2 py-0.5 text-[0.62rem] font-semibold text-[#315745]">作成中</span>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          現在の第{revision}版をもとに、次の見積を編集します。発行するまでは現在の見積内容は変わりません。
        </p>
        <Status state={state} />
      </div>
      <SubmitButton pending={pending} label="見積を編集" />
    </form>
  );
}
