'use client';

import { useActionState } from 'react';
import { createStandardQuoteCaseAction, type StandardQuoteCaseFormState } from '@/lib/actions/standard-quotes';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Input, Select, Textarea } from '@/components/ui';

export type StandardQuoteChoice = {
  revisionId: string;
  label: string;
  version: number;
  total: number;
  hasPor: boolean;
};

const initialState: StandardQuoteCaseFormState = { ok: false };

/** 公開中の標準見積を選び、お客様情報を入れて案件と見積下書きを作る */
export function StandardQuoteCaseForm({ choices, selectedRevisionId }: { choices: StandardQuoteChoice[]; selectedRevisionId: string | null }) {
  const [state, action, pending] = useActionState(createStandardQuoteCaseAction, initialState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-white p-4" data-testid="standard-quote-case-form">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <label className="block space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">標準見積（公開中）</span>
        <Select name="standard_estimate_revision_id" defaultValue={selectedRevisionId ?? ''} required>
          <option value="" disabled>
            選んでください
          </option>
          {choices.map((choice) => (
            <option key={choice.revisionId} value={choice.revisionId}>
              {choice.label}（第{choice.version}版・税込 {formatYen(choice.total)}{choice.hasPor ? '・価格未確定の行あり' : ''}）
            </option>
          ))}
        </Select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">お客様名（必須）</span>
          <Input name="customer_name" required maxLength={60} autoComplete="off" />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">会社名</span>
          <Input name="customer_company" maxLength={100} autoComplete="off" />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">案件名</span>
          <Input name="case_name" maxLength={120} autoComplete="off" />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">設置予定地</span>
          <Input name="site_address" maxLength={200} autoComplete="off" />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">メモ（見積書の備考）</span>
        <Textarea name="memo" rows={3} maxLength={1000} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">標準見積の率・明細を写した下書きを作ります。正式な見積書は、下書きを確認して発行するまで作られません。</p>
        <button type="submit" className="btn-primary" disabled={pending || choices.length === 0} data-testid="standard-quote-case-submit">
          {pending ? '作成中…' : '見積下書きを作成'}
        </button>
      </div>
    </form>
  );
}
