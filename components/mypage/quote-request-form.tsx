'use client';

import { useActionState } from 'react';
import { requestQuoteAction, type QuoteRequestState } from '@/lib/actions/configurations';
import { Alert, Button, Field, Input, Spinner, Textarea } from '@/components/ui';

interface Props {
  configurationId: string;
  defaults: { full_name: string; company_name: string; email: string; phone: string; address: string };
}

const initial: QuoteRequestState = { ok: false };

export function QuoteRequestForm({ configurationId, defaults }: Props) {
  const [state, action, pending] = useActionState(requestQuoteAction, initial);
  const v: Record<string, string | undefined> = { ...defaults, ...(state.values ?? {}) };
  return (
    <form action={action} className="card space-y-5 p-6 sm:p-8" noValidate data-testid="quote-request-form">
      <input type="hidden" name="configuration_id" value={configurationId} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <h2 className="text-xl">お客様情報</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="お名前" htmlFor="full_name" required errors={state.fieldErrors?.full_name}>
          <Input id="full_name" name="full_name" defaultValue={v.full_name} autoComplete="name" required />
        </Field>
        <Field label="法人名" htmlFor="company_name" errors={state.fieldErrors?.company_name}>
          <Input id="company_name" name="company_name" defaultValue={v.company_name} autoComplete="organization" />
        </Field>
        <Field label="メールアドレス" htmlFor="email" required errors={state.fieldErrors?.email}>
          <Input id="email" name="email" type="email" defaultValue={v.email} autoComplete="email" required />
        </Field>
        <Field label="電話番号" htmlFor="phone" required errors={state.fieldErrors?.phone}>
          <Input id="phone" name="phone" type="tel" defaultValue={v.phone} autoComplete="tel" required />
        </Field>
      </div>
      <Field label="ご住所" htmlFor="address" required errors={state.fieldErrors?.address}>
        <Input id="address" name="address" defaultValue={v.address} autoComplete="street-address" required />
      </Field>
      <Field label="設置予定地" htmlFor="site_address" hint="分かる範囲で構いません（例：石川県七尾市○○ 海沿いの傾斜地）" errors={state.fieldErrors?.site_address}>
        <Input id="site_address" name="site_address" defaultValue={v.site_address} />
      </Field>
      <Field label="ご要望・ご質問" htmlFor="message" errors={state.fieldErrors?.message}>
        <Textarea id="message" name="message" defaultValue={v.message} placeholder="搬入路の状況、希望時期、確認申請の要否など" />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="submit-quote-request">
        {pending && <Spinner />}
        {pending ? '送信中…' : 'この仕様で見積を依頼する'}
      </Button>
    </form>
  );
}
