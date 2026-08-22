'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { isLocalMode } from '@/lib/data/store';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';
import { resetRequestSchema, signInSchema, signUpSchema, updatePasswordSchema, flattenErrors, type FieldErrors } from '@/lib/validation';
import { safeNextPath } from '@/lib/utils';

export interface AuthFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
  /** 登録後にメール確認が必要（Supabase の設定による） */
  needsEmailConfirm?: boolean;
  /** ローカルモードのみ: 再設定リンクを画面に表示する */
  devLink?: string | null;
  /** 再設定メール送信完了 */
  sent?: boolean;
  values?: Record<string, string>;
}

const valuesOf = (fd: FormData, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, String(fd.get(k) ?? '')]).filter(([k]) => k !== 'password'));

async function originUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || `${proto}://${host}`;
}

function notConfigured(): AuthFormState {
  return { ok: false, error: '認証サービスが設定されていません。管理者にお問い合わせください（NEXT_PUBLIC_SUPABASE_URL 未設定）。' };
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const keys = ['email', 'full_name', 'company_name', 'phone', 'postal_code', 'address'];
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error), values: valuesOf(formData, keys) };
  const { agree, ...input } = parsed.data;
  void agree;
  const next = safeNextPath(String(formData.get('next') ?? ''), '/mypage');

  if (isLocalMode()) {
    const { localSignUp } = await import('@/lib/auth/local-auth');
    const r = await localSignUp(input);
    if (!r.ok) return { ok: false, error: r.error, values: valuesOf(formData, keys) };
    redirect(next);
  }
  if (!hasSupabaseEnv()) return notConfigured();
  const supabase = await createClient();
  const origin = await originUrl();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      data: {
        full_name: input.full_name,
        company_name: input.company_name ?? '',
        phone: input.phone,
        postal_code: input.postal_code ?? '',
        address: input.address,
      },
    },
  });
  if (error) {
    const msg = /already registered|already exists/i.test(error.message)
      ? 'このメールアドレスは既に登録されています。'
      : `登録に失敗しました: ${error.message}`;
    return { ok: false, error: msg, values: valuesOf(formData, keys) };
  }
  if (!data.session) return { ok: true, needsEmailConfirm: true, values: { email: input.email } };
  redirect(next);
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error), values: valuesOf(formData, ['email']) };
  const next = safeNextPath(String(formData.get('next') ?? ''), '/mypage');

  if (isLocalMode()) {
    const { localSignIn } = await import('@/lib/auth/local-auth');
    const r = await localSignIn(parsed.data.email, parsed.data.password);
    if (!r.ok) return { ok: false, error: r.error, values: valuesOf(formData, ['email']) };
    redirect(next);
  }
  if (!hasSupabaseEnv()) return notConfigured();
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    const msg = /email not confirmed/i.test(error.message)
      ? 'メールアドレスの確認が完了していません。受信した確認メールのリンクを開いてください。'
      : 'メールアドレスまたはパスワードが正しくありません。';
    return { ok: false, error: msg, values: valuesOf(formData, ['email']) };
  }
  redirect(next);
}

export async function signOutAction(): Promise<void> {
  if (isLocalMode()) {
    const { localSignOut } = await import('@/lib/auth/local-auth');
    await localSignOut();
  } else if (hasSupabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect('/');
}

export async function requestPasswordResetAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = resetRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  if (isLocalMode()) {
    const { localRequestPasswordReset } = await import('@/lib/auth/local-auth');
    const r = await localRequestPasswordReset(parsed.data.email);
    return { ok: true, sent: true, devLink: r.devLink };
  }
  if (!hasSupabaseEnv()) return notConfigured();
  const supabase = await createClient();
  const origin = await originUrl();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/reset-password/update')}`,
  });
  // 存在しないメールでも同じ応答（アカウント列挙防止）
  return { ok: true, sent: true };
}

export async function updatePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = updatePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  if (isLocalMode()) {
    const { localUpdatePassword } = await import('@/lib/auth/local-auth');
    const r = await localUpdatePassword(parsed.data.token || null, parsed.data.password);
    if (!r.ok) return { ok: false, error: r.error };
    redirect('/mypage?password=updated');
  }
  if (!hasSupabaseEnv()) return notConfigured();
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: `更新に失敗しました: ${error.message}` };
  redirect('/mypage?password=updated');
}
