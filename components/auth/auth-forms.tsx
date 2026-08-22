'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  requestPasswordResetAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
  type AuthFormState,
} from '@/lib/actions/auth';
import { Alert, Button, Checkbox, Field, Input, Spinner } from '@/components/ui';

const initial: AuthFormState = { ok: false };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, initial);
  const v = state.values ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="メールアドレス" htmlFor="email" required errors={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={v.email} required />
      </Field>
      <Field label="パスワード" htmlFor="password" required errors={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        {pending ? 'ログイン中…' : 'ログイン'}
      </Button>
      <div className="flex flex-col gap-2 text-center text-sm">
        <Link href="/reset-password" className="text-ink-soft underline-offset-4 hover:underline">パスワードをお忘れの方</Link>
        <p className="text-muted">
          アカウントをお持ちでない方は{' '}
          <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-ink underline-offset-4 hover:underline">新規会員登録</Link>
        </p>
      </div>
    </form>
  );
}

export function RegisterForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signUpAction, initial);
  const v = state.values ?? {};
  if (state.ok && state.needsEmailConfirm) {
    return (
      <Alert tone="success" title="確認メールを送信しました">
        {v.email} 宛に確認メールを送りました。メール内のリンクを開くと登録が完了し、ログインできます。
      </Alert>
    );
  }
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="メールアドレス" htmlFor="email" required errors={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={v.email} required />
      </Field>
      <Field label="パスワード" htmlFor="password" required hint="8文字以上、英字と数字を含む" errors={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="氏名" htmlFor="full_name" required errors={state.fieldErrors?.full_name}>
        <Input id="full_name" name="full_name" autoComplete="name" defaultValue={v.full_name} required />
      </Field>
      <Field label="法人名" htmlFor="company_name" errors={state.fieldErrors?.company_name}>
        <Input id="company_name" name="company_name" autoComplete="organization" defaultValue={v.company_name} />
      </Field>
      <Field label="電話番号" htmlFor="phone" required errors={state.fieldErrors?.phone}>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" defaultValue={v.phone} required />
      </Field>
      <div className="grid gap-5 sm:grid-cols-[10rem_1fr]">
        <Field label="郵便番号" htmlFor="postal_code" errors={state.fieldErrors?.postal_code}>
          <Input id="postal_code" name="postal_code" autoComplete="postal-code" inputMode="numeric" defaultValue={v.postal_code} placeholder="123-4567" />
        </Field>
        <Field label="住所" htmlFor="address" required errors={state.fieldErrors?.address}>
          <Input id="address" name="address" autoComplete="street-address" defaultValue={v.address} required />
        </Field>
      </div>
      <div>
        <Checkbox
          name="agree"
          label={
            <>
              <Link href="/terms" target="_blank" className="underline">利用規約</Link>と
              <Link href="/privacy" target="_blank" className="underline">プライバシーポリシー</Link>に同意する
            </>
          }
        />
        {state.fieldErrors?.agree && <p className="mt-1 text-sm text-danger" role="alert">{state.fieldErrors.agree[0]}</p>}
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        {pending ? '登録中…' : '会員登録する'}
      </Button>
      <p className="text-center text-sm text-muted">
        すでにアカウントをお持ちの方は{' '}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-ink underline-offset-4 hover:underline">ログイン</Link>
      </p>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initial);
  if (state.ok && state.sent) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="再設定の案内を送信しました">
          登録されているメールアドレスであれば、パスワード再設定のリンクをお送りしています。メールが届かない場合は迷惑メールフォルダをご確認ください。
        </Alert>
        {state.devLink && (
          <Alert tone="warn" title="ローカル検証モード">
            メールは送信されません。こちらのリンクから再設定してください：{' '}
            <Link href={state.devLink} className="font-semibold underline" data-testid="dev-reset-link">
              パスワード再設定ページ
            </Link>
          </Alert>
        )}
      </div>
    );
  }
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="メールアドレス" htmlFor="email" required errors={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        再設定メールを送る
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-ink-soft underline-offset-4 hover:underline">ログインへ戻る</Link>
      </p>
    </form>
  );
}

export function UpdatePasswordForm({ token }: { token: string | null }) {
  const [state, action, pending] = useActionState(updatePasswordAction, initial);
  return (
    <form action={action} className="space-y-5" noValidate>
      {token && <input type="hidden" name="token" value={token} />}
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="新しいパスワード" htmlFor="password" required hint="8文字以上、英字と数字を含む" errors={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="新しいパスワード（確認）" htmlFor="password_confirm" required errors={state.fieldErrors?.password_confirm}>
        <Input id="password_confirm" name="password_confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        パスワードを更新する
      </Button>
    </form>
  );
}
