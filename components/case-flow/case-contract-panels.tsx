import { getStore, type SessionUser } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { resolveQuoteChangeAction, voidPaperContractAction } from '@/lib/actions/case-flow';
import { activeContract } from '@/lib/domain/electronic-contract';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { PaperContractForm } from '@/components/case-flow/forms';

const DONE_TEXT: Record<string, string> = {
  change: '修正依頼を対応済みにしました。お客様へお知らせしました。',
  paper_void: '書面の契約の記録を無効にしました。',
};

function Flash({ flash }: { flash?: { done?: string; error?: string } }) {
  if (flash?.error) return <Alert tone="danger">{flash.error}</Alert>;
  if (flash?.done && DONE_TEXT[flash.done]) return <Alert tone="success">{DONE_TEXT[flash.done]}</Alert>;
  return null;
}

/** 案件画面の「見積」タブ：お客様からの見積の修正依頼（フェーズ9）。本部・担当代理店が対応済みにする */
export async function CaseChangeRequestsPanel({ quoteId, actor, flash }: { quoteId: string; actor: SessionUser; flash?: { done?: string; error?: string } }) {
  const store = await getStore();
  const detail = await store.getQuote(quoteId, actor);
  if (!detail) return null;
  const requestId = detail.quote.quote_request_id;
  const caseFlow = await getCaseFlowStore();
  const access = await caseFlow.getCaseAccess(actor, requestId);
  if (access !== 'admin' && access !== 'staff') return null;
  const requests = await caseFlow.listQuoteChangeRequests(actor, requestId);
  if (requests.length === 0 && !flash?.done && !flash?.error) return null;
  const open = requests.filter((r) => r.status === 'open');

  return (
    <section className="mt-2 space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="case-change-requests-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">お客様からの修正依頼</h3>
        {open.length > 0 ? <Badge tone="warn">対応待ち {open.length} 件</Badge> : <Badge tone="neutral">対応済み</Badge>}
      </div>
      <Flash flash={flash} />
      <ul className="space-y-2">
        {requests.map((r) => (
          <li key={r.id} className={`rounded-lg border p-3 text-sm ${r.status === 'open' ? 'border-[#e6d8a8] bg-[#fffaf0]' : 'border-line'}`}>
            <p className="text-xs text-muted">{formatDate(r.created_at, true)}</p>
            <p className="mt-1 whitespace-pre-wrap">{r.message}</p>
            {r.status === 'resolved' ? (
              <p className="mt-2 text-xs text-ink-soft">
                対応済み（{formatDate(r.resolved_at)}）{r.resolution ? `：${r.resolution}` : ''}
              </p>
            ) : (
              <form action={resolveQuoteChangeAction} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="quote_id" value={quoteId} />
                <input type="hidden" name="request_id" value={requestId} />
                <input type="hidden" name="change_request_id" value={r.id} />
                <input name="resolution" className="input h-9 min-w-64 flex-1 text-sm" placeholder="お客様へのご案内（例：第 2 版の見積を発行しました）" aria-label="対応内容" maxLength={1000} />
                <button type="submit" className="btn-secondary btn-sm">
                  対応済みにする
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[0.65rem] text-muted">見積を直すときは、これまでどおり新しい版を作って発行してから、対応済みにしてください。</p>
    </section>
  );
}

/** 案件画面の「契約・資料」タブ：書面で締結した契約の記録（フェーズ10）。本部だけ */
export async function PaperContractPanel({ quoteId, actor, flash }: { quoteId: string; actor: SessionUser; flash?: { done?: string; error?: string } }) {
  if (actor.role !== 'admin') return null;
  const store = await getStore();
  const detail = await store.getQuote(quoteId, actor);
  if (!detail?.request) return null;
  const { quote, request } = detail;
  const current = activeContract(await store.listElectronicContracts(request.id, actor));
  const canRecord = !current && quote.status === 'accepted' && request.quote_id === quote.id && Boolean(quote.user_id);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

  return (
    <section className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="paper-contract-panel">
      <div>
        <h3 className="font-semibold">書面で締結した契約</h3>
        <p className="mt-1 text-xs leading-5 text-muted">
          紙の契約書で締結したときは、署名済みの契約書（PDF）を記録します。条件は電子契約と同じ（お客様が承諾した、案件の現在の確定見積）で、契約金額はその見積の税込合計です。
        </p>
      </div>
      <Flash flash={flash} />
      {current?.provider === 'paper' && current.status === 'signed' ? (
        <div className="space-y-2 rounded-lg border border-line bg-[#fbfcfb] p-3 text-sm">
          <p>
            書面で締結済み（締結日 {formatDate(current.signed_at)}・{current.signer_name}）
          </p>
          <details>
            <summary className="cursor-pointer text-xs text-danger">誤って記録したときは、無効にする</summary>
            <form action={voidPaperContractAction} className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="quote_id" value={quoteId} />
              <input type="hidden" name="request_id" value={request.id} />
              <input type="hidden" name="contract_id" value={current.id} />
              <input name="reason" required className="input h-9 min-w-64 flex-1 text-sm" placeholder="無効にする理由" aria-label="無効にする理由" maxLength={1000} />
              <button type="submit" className="btn-secondary btn-sm">
                無効にする
              </button>
            </form>
          </details>
        </div>
      ) : canRecord ? (
        <PaperContractForm
          quoteId={quote.id}
          requestId={request.id}
          defaultName={request.contact?.full_name ?? quote.customer_name ?? ''}
          defaultEmail={request.contact?.email ?? ''}
          today={today}
        />
      ) : (
        <p className="text-sm text-muted">
          {current ? 'この案件には電子契約があります。' : 'お客様が確定見積を承諾した後に、書面の契約を記録できます。'}
        </p>
      )}
    </section>
  );
}
