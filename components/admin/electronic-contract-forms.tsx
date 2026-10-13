'use client';

import { useActionState } from 'react';
import { cancelElectronicContractAction, sendElectronicContractAction, type ContractActionState } from '@/lib/actions/contracts';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

const initial: ContractActionState = { ok: false };

function ActionResult({ state }: { state: ContractActionState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function SendElectronicContractForm({
  quoteId,
  defaultName,
  defaultEmail,
  disabled,
}: {
  quoteId: string;
  defaultName: string;
  defaultEmail: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(sendElectronicContractAction, initial);
  return (
    <form action={action} className="space-y-3" data-testid="electronic-contract-send-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <ActionResult state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="署名者の氏名" htmlFor="signer_name" required>
          <Input id="signer_name" name="signer_name" defaultValue={defaultName} required maxLength={100} />
        </Field>
        <Field label="署名者のメールアドレス" htmlFor="signer_email" required hint="GMOサインから署名依頼メールが届きます">
          <Input id="signer_email" name="signer_email" type="email" defaultValue={defaultEmail} required maxLength={254} />
        </Field>
      </div>
      <Button type="submit" disabled={disabled || pending} data-testid="electronic-contract-send">
        {pending && <Spinner />}
        {pending ? '送信中…' : 'GMOサインで契約書を送信する'}
      </Button>
    </form>
  );
}

export function CancelElectronicContractForm({ quoteId, contractId }: { quoteId: string; contractId: string }) {
  const [state, action, pending] = useActionState(cancelElectronicContractAction, initial);
  return (
    <form action={action} className="space-y-2" data-testid="electronic-contract-cancel-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="contract_id" value={contractId} />
      <ActionResult state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="取り消しの理由（任意）" htmlFor={`cancel-reason-${contractId}`}>
          <Input id={`cancel-reason-${contractId}`} name="reason" maxLength={1000} />
        </Field>
        <Button type="submit" variant="ghost" size="sm" disabled={pending}>
          {pending && <Spinner />}
          この契約を取り消す
        </Button>
      </div>
    </form>
  );
}
