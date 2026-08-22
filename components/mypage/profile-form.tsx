'use client';

import { useActionState } from 'react';
import { updateProfileAction, type ProfileState } from '@/lib/actions/profile';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

interface Props {
  defaults: { full_name: string; company_name: string; phone: string; postal_code: string; address: string };
}

export function ProfileForm({ defaults }: Props) {
  const [state, action, pending] = useActionState(updateProfileAction, { ok: false } as ProfileState);
  const v = { ...defaults, ...(state.values ?? {}) };
  return (
    <form action={action} className="card space-y-5 p-6 sm:p-8" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="氏名" htmlFor="full_name" required errors={state.fieldErrors?.full_name}>
        <Input id="full_name" name="full_name" defaultValue={v.full_name} required />
      </Field>
      <Field label="法人名" htmlFor="company_name" errors={state.fieldErrors?.company_name}>
        <Input id="company_name" name="company_name" defaultValue={v.company_name} />
      </Field>
      <Field label="電話番号" htmlFor="phone" errors={state.fieldErrors?.phone}>
        <Input id="phone" name="phone" type="tel" defaultValue={v.phone} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-[10rem_1fr]">
        <Field label="郵便番号" htmlFor="postal_code" errors={state.fieldErrors?.postal_code}>
          <Input id="postal_code" name="postal_code" defaultValue={v.postal_code} />
        </Field>
        <Field label="住所" htmlFor="address" errors={state.fieldErrors?.address}>
          <Input id="address" name="address" defaultValue={v.address} />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        保存する
      </Button>
    </form>
  );
}
