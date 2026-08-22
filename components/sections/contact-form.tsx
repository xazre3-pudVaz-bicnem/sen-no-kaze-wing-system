'use client';

import { useActionState } from 'react';
import { submitContactAction, type ContactState } from '@/lib/actions/contact';
import { Alert, Button, Field, Input, Spinner, Textarea } from '@/components/ui';

const initial: ContactState = { ok: false };

export function ContactForm() {
  const [state, action, pending] = useActionState(submitContactAction, initial);
  if (state.ok) {
    return (
      <Alert tone="success" title="お問い合わせを受け付けました">
        担当者より折り返しご連絡いたします。お急ぎの場合はお電話ください。
      </Alert>
    );
  }
  const v = state.values ?? {};
  return (
    <form action={action} className="card space-y-5 p-6 sm:p-8" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="お名前" htmlFor="full_name" required errors={state.fieldErrors?.full_name}>
        <Input id="full_name" name="full_name" autoComplete="name" defaultValue={v.full_name} required />
      </Field>
      <Field label="メールアドレス" htmlFor="email" required errors={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={v.email} required />
      </Field>
      <Field label="電話番号" htmlFor="phone" errors={state.fieldErrors?.phone}>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" defaultValue={v.phone} />
      </Field>
      <Field label="お問い合わせ内容" htmlFor="message" required errors={state.fieldErrors?.message}>
        <Textarea id="message" name="message" defaultValue={v.message} required />
      </Field>
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
        {pending && <Spinner />}
        {pending ? '送信中…' : '送信する'}
      </Button>
      <p className="text-xs text-muted">送信いただいた内容は、お問い合わせへの回答のみに使用します。</p>
    </form>
  );
}
