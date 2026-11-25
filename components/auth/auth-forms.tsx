'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  requestPasswordResetAction,
  resendConfirmationAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
  type AuthFormState,
} from '@/lib/actions/auth';
import { CONFIRMATION_RESENT } from '@/lib/auth/email-confirm';
import { Alert, Button, Checkbox, Field, Input, Spinner } from '@/components/ui';

const initial: AuthFormState = { ok: false };

/** 会員登録の確認メールを送り直すボタン（別のフォーム。ログインのフォームの中には置かない） */
function ResendConfirmationForm({ email, next }: { email: string; next: string }) {
  const [state, action, pending] = useActionState(resendConfirmationAction, initial);
  return (
    <form action={action} className="space-y-3" data-testid="resend-confirmation">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="next" value={next} />
      {state.ok && state.sent && <Alert tone="success">{CONFIRMATION_RESENT}</Alert>}
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        確認メールを送り直す
      </Button>
    </form>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, initial);
  const v = state.values ?? {};
  // 確認がまだのアカウント：理由と送り直しのボタンを、ログインのフォームの外（上）に出す（フォームを入れ子にしない）
  const unconfirmed = Boolean(state.needsEmailConfirm && v.email);
  return (
    <div className="space-y-5">
      {unconfirmed && (
        <div className="space-y-3" data-testid="login-email-unconfirmed">
          <Alert tone="warn">{state.error}</Alert>
          <ResendConfirmationForm email={v.email} next={next} />
        </div>
      )}
      <form action={action} className="space-y-5" noValidate>
        <input type="hidden" name="next" value={next} />
        {!unconfirmed && state.error && <Alert tone="danger">{state.error}</Alert>}
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
    </div>
  );
}

export function RegisterForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signUpAction, initial);
  const [showPassword, setShowPassword] = useState(false);
  const v = state.values ?? {};
  if (state.ok && state.needsEmailConfirm) {
    return (
      <div className="space-y-4" data-testid="register-confirm-sent">
        <Alert tone="success" title="確認メールを送信しました">
          {v.email} 宛に確認メールを送りました。メールのリンクを開くと、登録が完了します。
        </Alert>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
          <li>メールが届かないときは、迷惑メールのフォルダもご確認ください。</li>
          <li>リンクは、スマートフォンなど別の端末で開いても確認できます。その場合は、確認の後にログインしてください。</li>
        </ul>
        {v.email && <ResendConfirmationForm email={v.email} next={next} />}
        <p className="text-center text-sm text-muted">
          確認が済んだ方は{' '}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-ink underline-offset-4 hover:underline">ログイン</Link>
        </p>
      </div>
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
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            className="pr-24"
            required
            minLength={8}
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示する'}
            aria-pressed={showPassword}
            data-testid="register-password-visibility"
            className="absolute inset-y-0 right-2 flex items-center gap-1 rounded-md px-2 text-xs text-ink-soft transition hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
          >
            {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            {showPassword ? '隠す' : '表示'}
          </button>
        </div>
      </Field>
      <Field label="氏名" htmlFor="full_name" required errors={state.fieldErrors?.full_name}>
        <Input id="full_name" name="full_name" autoComplete="name" defaultValue={v.full_name} required />
      </Field>
      <Field label="法人名" htmlFor="company_name" errors={state.fieldErrors?.company_name}>
        <Input id="company_name" name="company_name" autoComplete="organization" defaultValue={v.company_name} />
      </Field>
      <p className="text-sm leading-relaxed text-ink-soft">
        電話番号・ご住所は、見積依頼をする際に入力していただきます。
      </p>
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
          登録されているメールアドレスであれば、パスワード再設定のリンクをお送りしています。メールのリンクは、この画面を開いているのと同じブラウザで開いてください。メールが届かない場合は迷惑メールフォルダをご確認ください。
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
