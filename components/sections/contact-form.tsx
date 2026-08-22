'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { submitContactAction, type ContactState } from '@/lib/actions/contact';
import { contactTopics } from '@/data/site-content';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';

const initial: ContactState = { ok: false };

/** 先方サイトと同じ項目（お名前・メール・電話・種別・内容・添付・同意） */
export function ContactForm({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const [state, action, pending] = useActionState(submitContactAction, initial);
  if (state.ok) {
    return (
      <Alert tone="success" title="お問い合わせを受け付けました">
        内容を確認のうえ、担当者よりご連絡いたします。お急ぎの場合はお電話でもご相談いただけます。
      </Alert>
    );
  }
  const v = state.values ?? {};
  const dark = tone === 'dark';
  return (
    <form action={action} className={dark ? 'space-y-6' : 'card space-y-6 p-6 sm:p-10'} noValidate encType="multipart/form-data" data-testid="contact-form">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="お名前" htmlFor="full_name" required errors={state.fieldErrors?.full_name}>
          <Input id="full_name" name="full_name" autoComplete="name" defaultValue={v.full_name} required />
        </Field>
        <Field label="メールアドレス" htmlFor="email" required errors={state.fieldErrors?.email}>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={v.email} required />
        </Field>
        <Field label="電話番号" htmlFor="phone" errors={state.fieldErrors?.phone}>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" defaultValue={v.phone} />
        </Field>
        <Field label="お問い合わせの種類" htmlFor="topic" required errors={state.fieldErrors?.topic}>
          <Select id="topic" name="topic" defaultValue={v.topic ?? ''} required>
            <option value="">内容を選択ください</option>
            {contactTopics.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="お問い合わせ内容" htmlFor="message" required errors={state.fieldErrors?.message}>
        <Textarea id="message" name="message" defaultValue={v.message} required placeholder="設置予定地の状況、ご希望の用途、時期などをご記入ください" />
      </Field>
      <Field label="ファイル添付" htmlFor="attachment" hint="土地の写真・図面など（10MBまで／PDF・画像）" errors={state.fieldErrors?.attachment}>
        <Input id="attachment" name="attachment" type="file" accept="image/*,application/pdf" className="py-2.5" />
      </Field>
      <div>
        <label className="inline-flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" name="agree" className="mt-1 size-4 shrink-0 accent-brown" required />
          <span>
            <Link href="/privacy" target="_blank" className="underline underline-offset-4">
              プライバシーポリシー
            </Link>
            に同意する
          </span>
        </label>
        {state.fieldErrors?.agree && (
          <p className="mt-1 text-sm text-danger" role="alert">
            {state.fieldErrors.agree[0]}
          </p>
        )}
      </div>
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto" data-testid="contact-submit">
        {pending && <Spinner />}
        {pending ? '送信中…' : '送信する'}
      </Button>
      <p className={dark ? 'text-xs text-white/60' : 'text-xs text-muted'}>送信完了の画面が表示されるまで、この画面を閉じないでください。</p>
    </form>
  );
}
