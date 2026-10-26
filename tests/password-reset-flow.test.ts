import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isLocalMode: vi.fn(() => false),
  hasSupabaseEnv: vi.fn(() => true),
  createClient: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getSessionUser: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/data/store', () => ({ isLocalMode: mocks.isLocalMode }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient, hasSupabaseEnv: mocks.hasSupabaseEnv }));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: mocks.getSessionUser }));

import {
  PASSWORD_RESET_LINK_ERROR,
  authLinkErrorPath,
  passwordResetCanonicalUrl,
  passwordUpdateErrorMessage,
  requestHost,
} from '@/lib/auth/password-reset';
import { requestPasswordResetAction, updatePasswordAction } from '@/lib/actions/auth';
import { GET as authCallback } from '@/app/auth/callback/route';
import ResetPasswordPage from '@/app/(site)/reset-password/page';

const VERCEL = 'https://sen-no-kaze-wing-system.vercel.app';
const CUSTOM = 'https://www.sen-no-kaze.com';

function requestHeaders(origin: string) {
  const url = new URL(origin);
  return new Headers({ host: url.host, 'x-forwarded-host': url.host, 'x-forwarded-proto': url.protocol.replace(':', '') });
}

/** React の要素の木から文字だけを集める（描画せずに、画面に出る文を確かめる） */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: unknown } }).props.children);
  return '';
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

let savedSiteUrl: string | undefined;

beforeEach(() => {
  savedSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = VERCEL;
  mocks.isLocalMode.mockReturnValue(false);
  mocks.hasSupabaseEnv.mockReturnValue(true);
  mocks.headers.mockResolvedValue(requestHeaders(VERCEL));
});

afterEach(() => {
  if (savedSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = savedSiteUrl;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('パスワード再設定：申し込みとメールのリンクの戻り先を同じオリジンにする（2026-10-26）', () => {
  it('戻り先（NEXT_PUBLIC_SITE_URL）と違うホストで開いたら、戻り先のホストで開き直す', () => {
    expect(passwordResetCanonicalUrl(VERCEL, 'www.sen-no-kaze.com')).toBe(`${VERCEL}/reset-password`);
    expect(passwordResetCanonicalUrl(`${CUSTOM}/`, 'sen-no-kaze-wing-system.vercel.app')).toBe(`${CUSTOM}/reset-password`);
  });

  it('同じホスト（http と https の違いは見ない）・設定なし・判断できないときは開き直さない（開き直しを繰り返さない）', () => {
    expect(passwordResetCanonicalUrl(CUSTOM, 'www.sen-no-kaze.com')).toBeNull();
    expect(passwordResetCanonicalUrl('http://www.sen-no-kaze.com', 'WWW.SEN-NO-KAZE.COM')).toBeNull();
    expect(passwordResetCanonicalUrl(`${CUSTOM}/path`, 'www.sen-no-kaze.com')).toBeNull();
    expect(passwordResetCanonicalUrl(null, 'www.sen-no-kaze.com')).toBeNull();
    expect(passwordResetCanonicalUrl(CUSTOM, null)).toBeNull();
    expect(passwordResetCanonicalUrl('not a url', 'www.sen-no-kaze.com')).toBeNull();
  });

  it('ホストは転送のヘッダーを優先し、複数の値なら先頭を使う', () => {
    expect(requestHost(new Headers({ host: 'a.example', 'x-forwarded-host': 'B.example, c.example' }))).toBe('b.example');
    expect(requestHost(new Headers({ host: 'a.example' }))).toBe('a.example');
    expect(requestHost(new Headers())).toBeNull();
  });

  it('独自ドメインで申し込みの画面を開くと、戻り先のオリジンへ移す（ローカル検証モードと同じオリジンでは移さない）', async () => {
    mocks.headers.mockResolvedValue(requestHeaders(CUSTOM));
    await expect(ResetPasswordPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(`REDIRECT:${VERCEL}/reset-password`);
    await expect(ResetPasswordPage({ searchParams: Promise.resolve({ error: 'link' }) })).rejects.toThrow(
      `REDIRECT:${VERCEL}/reset-password?error=link`
    );
    mocks.headers.mockResolvedValue(requestHeaders(VERCEL));
    await expect(ResetPasswordPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
    mocks.headers.mockResolvedValue(requestHeaders(CUSTOM));
    mocks.isLocalMode.mockReturnValue(true);
    await expect(ResetPasswordPage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
    expect(mocks.redirect).toHaveBeenCalledTimes(2);
  });

  it('メールの再設定の戻り先は NEXT_PUBLIC_SITE_URL の /auth/callback（申し込みの画面と同じオリジン）', async () => {
    const resetPasswordForEmail = vi.fn(async () => ({ data: {}, error: null }));
    mocks.createClient.mockResolvedValue({ auth: { resetPasswordForEmail } });
    await expect(requestPasswordResetAction({ ok: false }, form({ email: 'user@example.com' }))).resolves.toEqual({ ok: true, sent: true });
    expect(resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
      redirectTo: `${VERCEL}/auth/callback?next=${encodeURIComponent('/reset-password/update')}`,
    });
  });

  it('送れなかったときも同じ応答（アカウント列挙を防ぐ）。理由はサーバーの記録に残し、メールアドレスは残さない', async () => {
    const error = Object.assign(new Error('Email address not authorized'), { code: 'email_address_not_authorized', status: 400 });
    mocks.createClient.mockResolvedValue({ auth: { resetPasswordForEmail: vi.fn(async () => ({ data: null, error })) } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(requestPasswordResetAction({ ok: false }, form({ email: 'user@example.com' }))).resolves.toEqual({ ok: true, sent: true });
    expect(log).toHaveBeenCalledWith('[password-reset] resetPasswordForEmail failed', { code: 'email_address_not_authorized', status: 400 });
    expect(JSON.stringify(log.mock.calls)).not.toContain('user@example.com');
  });
});

describe('メールのリンクを確かめられなかったときは、理由を出す画面へ戻す', () => {
  it('再設定は申し込みの画面へ、ほかはログインへ', () => {
    expect(authLinkErrorPath('/reset-password/update')).toBe('/reset-password?error=link');
    expect(authLinkErrorPath('/reset-password')).toBe('/reset-password?error=link');
    expect(authLinkErrorPath('/mypage')).toBe('/login?error=link');
    // ログイン画面へ戻すときは、元の行き先を残す
    expect(authLinkErrorPath('/mypage/configurations/1/request-quote')).toBe('/login?error=link&next=%2Fmypage%2Fconfigurations%2F1%2Frequest-quote');
    expect(authLinkErrorPath('/reset-passwordx')).toBe('/login?error=link&next=%2Freset-passwordx');
  });

  it('申し込んだブラウザの Cookie が無いと交換に失敗し、申し込みの画面へ戻す（理由の記録にコードだけ残す）', async () => {
    type ExchangeResult = { data: object; error: { code: string; status: number } | null };
    const exchangeCodeForSession = vi.fn(async (): Promise<ExchangeResult> => ({ data: {}, error: { code: 'bad_code_verifier', status: 400 } }));
    mocks.createClient.mockResolvedValue({ auth: { exchangeCodeForSession } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await authCallback(new NextRequest(`${VERCEL}/auth/callback?code=abc&next=${encodeURIComponent('/reset-password/update')}`));
    expect(failed.headers.get('location')).toBe(`${VERCEL}/reset-password?error=link`);
    expect(log).toHaveBeenCalledWith('[auth/callback] exchangeCodeForSession failed', { code: 'bad_code_verifier', status: 400 });

    exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: null });
    const ok = await authCallback(new NextRequest(`${VERCEL}/auth/callback?code=abc&next=${encodeURIComponent('/reset-password/update')}`));
    expect(ok.headers.get('location')).toBe(`${VERCEL}/reset-password/update`);

    const noCode = await authCallback(new NextRequest(`${VERCEL}/auth/callback?next=%2Fmypage`));
    expect(noCode.headers.get('location')).toBe(`${VERCEL}/login?error=link`);

    // 期限切れ・使用済みのリンク（code の代わりにエラーのコード）も、理由のコードを記録して申し込みの画面へ戻す
    log.mockClear();
    const expired = await authCallback(
      new NextRequest(`${VERCEL}/auth/callback?error=access_denied&error_code=otp_expired&next=${encodeURIComponent('/reset-password/update')}`)
    );
    expect(expired.headers.get('location')).toBe(`${VERCEL}/reset-password?error=link`);
    expect(log).toHaveBeenCalledWith('[auth/callback] link error', { code: 'otp_expired' });
  });
});

describe('新しいパスワードの設定', () => {
  it('更新の失敗は日本語で出す（Supabase の英語のメッセージを出さない）', async () => {
    expect(passwordUpdateErrorMessage({ code: 'same_password' })).toBe('新しいパスワードが今のパスワードと同じです。別のパスワードを入力してください。');
    expect(passwordUpdateErrorMessage({ code: 'weak_password' })).toContain('このパスワードは使えません');
    // 弱いパスワードは、Supabase が返す理由ごとに文を変える（漏えい・文字の種類・長さ）
    expect(passwordUpdateErrorMessage({ code: 'weak_password', reasons: ['pwned'] })).toContain('漏えいが知られている');
    expect(passwordUpdateErrorMessage({ code: 'weak_password', reasons: ['characters'] })).toContain('決められた種類の文字');
    expect(passwordUpdateErrorMessage({ name: 'AuthWeakPasswordError', reasons: ['length'] })).toContain('短すぎます');
    expect(passwordUpdateErrorMessage({ name: 'AuthSessionMissingError' })).toBe(PASSWORD_RESET_LINK_ERROR);
    expect(passwordUpdateErrorMessage({ code: 'session_expired' })).toBe(PASSWORD_RESET_LINK_ERROR);
    expect(passwordUpdateErrorMessage({ code: 'unexpected_failure' })).toBe('パスワードを更新できませんでした。時間をおいてもう一度お試しください。');

    const updateUser = vi.fn(async () => ({ data: {}, error: { code: 'same_password', message: 'New password should be different from the old password.' } }));
    mocks.createClient.mockResolvedValue({ auth: { updateUser } });
    const result = await updatePasswordAction({ ok: false }, form({ password: 'Wing-Test2!', password_confirm: 'Wing-Test2!' }));
    expect(result).toEqual({ ok: false, error: '新しいパスワードが今のパスワードと同じです。別のパスワードを入力してください。' });
  });

  it('ログインしていない（リンクを確かめられていない）ときは、入力欄を出さずに申し込みへ案内する', async () => {
    const { default: UpdatePasswordPage } = await import('@/app/(site)/reset-password/update/page');
    mocks.getSessionUser.mockResolvedValue(null);
    expect(textOf(await UpdatePasswordPage({ searchParams: Promise.resolve({}) }))).toContain(PASSWORD_RESET_LINK_ERROR);
    mocks.getSessionUser.mockResolvedValue({ id: 'u1', email: 'user@example.com', role: 'customer', full_name: '', company_name: null });
    expect(textOf(await UpdatePasswordPage({ searchParams: Promise.resolve({}) }))).not.toContain(PASSWORD_RESET_LINK_ERROR);
  });
});
