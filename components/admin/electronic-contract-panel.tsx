import type { SessionUser } from '@/lib/data/store';
import { getStore } from '@/lib/data/store';
import { CONTRACT_STATUS_LABEL, activeContract } from '@/lib/domain/electronic-contract';
import { formatYen } from '@/lib/domain/pricing';
import type { ElectronicContract } from '@/lib/domain/types';
import { gmoSignConfig, isLocalGmoSignStub } from '@/lib/integrations/gmosign';
import { Alert } from '@/components/ui';
import { CancelElectronicContractForm, SendElectronicContractForm } from './electronic-contract-forms';

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }) : '—';

const statusTone: Record<ElectronicContract['status'], string> = {
  sending: 'border-amber-300 bg-amber-50 text-amber-900',
  sent: 'border-sky-300 bg-sky-50 text-sky-900',
  signed: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  canceled: 'border-slate-300 bg-slate-100 text-slate-600',
  failed: 'border-rose-300 bg-rose-50 text-rose-800',
};

/** 案件の「契約書類」タブ：GMOサインによる電子契約（本部だけが送信・取り消しできる） */
export async function ElectronicContractPanel({ quoteId, actor }: { quoteId: string; actor: SessionUser }) {
  const store = await getStore();
  const detail = await store.getQuote(quoteId, actor);
  if (!detail?.request) return null;
  const { quote, request } = detail;
  const contracts = await store.listElectronicContracts(request.id, actor);
  const current = activeContract(contracts);
  const configured = gmoSignConfig() !== null || isLocalGmoSignStub();
  const isHeadquarters = actor.role === 'admin';
  const canSend = isHeadquarters && !current && quote.status === 'accepted' && request.quote_id === quote.id && Boolean(quote.user_id);

  return (
    <section className="space-y-4 rounded-lg border border-line bg-white p-4 shadow-sm" data-testid="electronic-contract-panel">
      <div>
        <h3 className="font-semibold">電子契約（GMOサイン）</h3>
        <p className="mt-1 text-xs leading-5 text-muted">
          お客様が承諾した確定見積から、GMOサインの契約書テンプレートで契約書を送信します。契約金額は送信時点の見積額（スナップショット）です。
        </p>
      </div>

      {!configured && (
        <Alert tone="warn">GMOサインの接続設定が未完了のため、送信できません。設定手順は docs/electronic-contract-gmosign.md を参照してください。</Alert>
      )}

      {current ? (
        <div className="space-y-3 rounded-lg border border-line bg-[#fbfcfb] p-3" data-testid="electronic-contract-current">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusTone[current.status]}`}>
              {CONTRACT_STATUS_LABEL[current.status]}
            </span>
            {current.provider === 'paper' && (
              <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-soft" data-testid="contract-provider-paper">
                書面で締結
              </span>
            )}
            <span className="text-sm text-ink-soft">
              {current.signer_name}（{current.signer_email}）
            </span>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">契約金額（税込）</dt>
              <dd className="font-semibold">{formatYen(current.contract_total)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">送信日時</dt>
              <dd>{dateTime(current.sent_at)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">締結日時</dt>
              <dd>{dateTime(current.signed_at)}</dd>
            </div>
          </dl>
          {current.status === 'signed' && (
            <a href={`/api/contracts/${current.id}/signed`} target="_blank" rel="noreferrer" className="btn-secondary btn-sm inline-flex" data-testid="electronic-contract-signed-pdf">
              締結済みの契約書（PDF）を開く
            </a>
          )}
          {isHeadquarters && (current.status === 'sending' || current.status === 'sent') && (
            <CancelElectronicContractForm quoteId={quote.id} contractId={current.id} />
          )}
        </div>
      ) : canSend ? (
        <SendElectronicContractForm
          quoteId={quote.id}
          defaultName={request.contact?.full_name ?? quote.customer_name ?? ''}
          defaultEmail={request.contact?.email ?? ''}
          disabled={!configured}
        />
      ) : (
        <p className="text-sm text-muted">
          {quote.status === 'accepted'
            ? '契約書を送信できるのは本部だけです。'
            : 'お客様が確定見積を承諾した後に、契約書を送信できます。'}
        </p>
      )}

      {contracts.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[36rem] text-left text-xs">
            <thead className="bg-[#f7f8f8] text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">状態</th>
                <th className="px-3 py-2 font-semibold">署名者</th>
                <th className="px-3 py-2 font-semibold">契約金額</th>
                <th className="px-3 py-2 font-semibold">作成</th>
                <th className="px-3 py-2 font-semibold">備考</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.id} className="border-t border-line">
                  <td className="px-3 py-2">{CONTRACT_STATUS_LABEL[contract.status]}</td>
                  <td className="px-3 py-2">{contract.signer_name}</td>
                  <td className="px-3 py-2 tabular-nums">{formatYen(contract.contract_total)}</td>
                  <td className="px-3 py-2">{dateTime(contract.created_at)}</td>
                  <td className="px-3 py-2 text-muted">{contract.failure_reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
