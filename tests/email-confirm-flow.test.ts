import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 会員登録の確認メール（2026-11-25：本部先行の運用開始の時から ON。千の風様のご判断）。
 * 送り直し・別の端末でリンクを開いたときの案内・確認がまだのアカウントでのログイン・日本語の文面。
 */

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
  CONFIRMATION_RESEND_FAILED,
  CONFIRMATION_RESEND_RATE_LIMITED,
  EMAIL_CONFIRMED_SIGN_IN,
  EMAIL_NOT_CONFIRMED,
  emailConfirmedLoginPath,
  isCodeVerifierMissing,
  signupRedirectTo,
} from '@/lib/auth/email-confirm';
import { AUTH_LINK_ERROR } from '@/lib/auth/password-reset';
import { resendConfirmationAction, signInAction, signUpAction } from '@/lib/actions/auth';
import { GET as authCallback } from '@/app/auth/callback/route';
import LoginPage from '@/app/(site)/login/page';
import RegisterPage from '@/app/(site)/register/page';
import { safeNextPath } from '@/lib/utils';

const SITE = 'https://www.sen-no-kaze.com';
const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/** React の要素の木から文字だけを集める（描画せずに、画面に出る文を確かめる） */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: unknown } }).props.children);
  return '';
}

let savedSiteUrl: string | undefined;

beforeEach(() => {
  savedSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  mocks.isLocalMode.mockReturnValue(false);
  mocks.hasSupabaseEnv.mockReturnValue(true);
  mocks.headers.mockResolvedValue(new Headers({ host: 'www.sen-no-kaze.com', 'x-forwarded-proto': 'https' }));
  mocks.getSessionUser.mockResolvedValue(null);
});

afterEach(() => {
  if (savedSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = savedSiteUrl;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('確認がまだのアカウントでのログイン', () => {
  it('確認がまだなら、理由と送り直しのボタン（needsEmailConfirm）を返す。パスワードの誤りは今までどおり', async () => {
    const signInWithPassword = vi.fn(async () => ({ data: {}, error: { message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 } }));
    mocks.createClient.mockResolvedValue({ auth: { signInWithPassword } });
    await expect(signInAction({ ok: false }, form({ email: 'user@example.com', password: 'x' }))).resolves.toEqual({
      ok: false,
      error: EMAIL_NOT_CONFIRMED,
      needsEmailConfirm: true,
      values: { email: 'user@example.com' },
    });

    signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } });
    const wrong = await signInAction({ ok: false }, form({ email: 'user@example.com', password: 'x' }));
    expect(wrong).toEqual({ ok: false, error: 'メールアドレスまたはパスワードが正しくありません。', values: { email: 'user@example.com' } });
  });
});

describe('確認メールの送り直し', () => {
  it('戻り先を www の /auth/callback にして、会員登録の確認メールを送り直す（元の行き先を残す）', async () => {
    const resend = vi.fn(async () => ({ data: {}, error: null }));
    mocks.createClient.mockResolvedValue({ auth: { resend } });
    await expect(resendConfirmationAction({ ok: false }, form({ email: 'user@example.com', next: '/mypage' }))).resolves.toEqual({ ok: true, sent: true });
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'user@example.com',
      options: { emailRedirectTo: `${SITE}/auth/callback?next=${encodeURIComponent('/mypage')}&flow=signup` },
    });
    await resendConfirmationAction({ ok: false }, form({ email: 'user@example.com', next: '/mypage/configurations/1/request-quote' }));
    expect(resend).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: { emailRedirectTo: `${SITE}/auth/callback?next=${encodeURIComponent('/mypage/configurations/1/request-quote')}&flow=signup` } })
    );
    // 別のサイトへの行き先は使わない
    await resendConfirmationAction({ ok: false }, form({ email: 'user@example.com', next: 'https://evil.example/' }));
    expect(resend).toHaveBeenLastCalledWith(expect.objectContaining({ options: { emailRedirectTo: `${SITE}/auth/callback?next=%2Fmypage&flow=signup` } }));
  });

  it('続けて送ったときだけ待つよう案内し、ほかの失敗は同じ応答にする（アカウントの列挙を防ぐ）。記録には理由のコードだけ', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resend = vi.fn(async () => ({ data: {}, error: { code: 'over_email_send_rate_limit', status: 429, message: 'rate limited' } }));
    mocks.createClient.mockResolvedValue({ auth: { resend } });
    await expect(resendConfirmationAction({ ok: false }, form({ email: 'user@example.com' }))).resolves.toEqual({
      ok: false,
      error: CONFIRMATION_RESEND_RATE_LIMITED,
    });
    // 送る仕組みの障害（5xx）は、送れたように見せない
    resend.mockResolvedValueOnce({ data: {}, error: { code: 'unexpected_failure', status: 500, message: 'x' } });
    await expect(resendConfirmationAction({ ok: false }, form({ email: 'user@example.com' }))).resolves.toEqual({
      ok: false,
      error: CONFIRMATION_RESEND_FAILED,
    });
    expect(log).toHaveBeenCalledWith('[signup-confirm] resend failed', { code: 'unexpected_failure', status: 500 });
    // ほかの失敗（4xx）は同じ応答
    resend.mockResolvedValueOnce({ data: {}, error: { code: 'validation_failed', status: 400, message: 'x' } });
    await expect(resendConfirmationAction({ ok: false }, form({ email: 'user@example.com' }))).resolves.toEqual({ ok: true, sent: true });
    expect(JSON.stringify(log.mock.calls)).not.toContain('user@example.com');
  });

  it('アドレスの形が違えば送らない。ローカル検証モードは確認メールを使わない（送らずに受け付ける）', async () => {
    const resend = vi.fn();
    mocks.createClient.mockResolvedValue({ auth: { resend } });
    const invalid = await resendConfirmationAction({ ok: false }, form({ email: 'not-an-email' }));
    expect(invalid.ok).toBe(false);
    expect(invalid.fieldErrors?.email).toBeTruthy();
    mocks.isLocalMode.mockReturnValue(true);
    await expect(resendConfirmationAction({ ok: false }, form({ email: 'user@example.com' }))).resolves.toEqual({ ok: true, sent: true });
    expect(resend).not.toHaveBeenCalled();
  });
});

describe('会員登録', () => {
  it('確認メールの戻り先は www の /auth/callback（会員登録の印つき）。確認が要るときは送った案内を返す', async () => {
    expect(signupRedirectTo(SITE, '/mypage')).toBe(`${SITE}/auth/callback?next=%2Fmypage&flow=signup`);
    const signUp = vi.fn(async () => ({ data: { session: null, user: { id: 'u1' } }, error: null }));
    mocks.createClient.mockResolvedValue({ auth: { signUp } });
    const result = await signUpAction(
      { ok: false },
      form({ email: 'user@example.com', password: 'Wing-Test1', full_name: '山田 太郎', company_name: '', agree: 'on', next: '/mypage' })
    );
    expect(result).toEqual({ ok: true, needsEmailConfirm: true, values: { email: 'user@example.com' } });
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: `${SITE}/auth/callback?next=%2Fmypage&flow=signup` }) })
    );
  });

  it('会員登録の画面は、URL の値が重なっても（配列）落ちない', async () => {
    await expect(RegisterPage({ searchParams: Promise.resolve({ next: ['/mypage', '/admin'] }) })).resolves.toBeTruthy();
    mocks.getSessionUser.mockResolvedValue({ id: 'u1', email: 'user@example.com', role: 'customer', full_name: '', company_name: null });
    await expect(RegisterPage({ searchParams: Promise.resolve({ next: ['/mypage/quotes', '/admin'] }) })).rejects.toThrow('REDIRECT:/mypage/quotes');
  });
});

describe('確認メールのリンクを、登録した時と別のブラウザで開いたとき', () => {
  type ExchangeError = { name?: string; code: string; status: number };
  const exchangeFailing = (error: ExchangeError) => {
    const exchangeCodeForSession = vi.fn(async () => ({ data: {}, error }));
    mocks.createClient.mockResolvedValue({ auth: { exchangeCodeForSession } });
  };
  const missing: ExchangeError = { name: 'AuthPKCECodeVerifierMissingError', code: 'pkce_code_verifier_not_found', status: 400 };

  it('Cookie が無い（確認は済んでいる）なら、ログインの画面で「確認が済んだ」と案内する。元の行き先を残す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exchangeFailing(missing);
    const res = await authCallback(new NextRequest(`${SITE}/auth/callback?code=abc&next=%2Fmypage&flow=signup`));
    expect(res.headers.get('location')).toBe(`${SITE}/login?confirmed=1`);
    // 印の無いリンクは「確認が済んだ」とは案内しない（理由の画面へ）
    const unmarked = await authCallback(new NextRequest(`${SITE}/auth/callback?code=abc&next=%2Fmypage`));
    expect(unmarked.headers.get('location')).toBe(`${SITE}/login?error=link`);
    const withNext = await authCallback(
      new NextRequest(`${SITE}/auth/callback?code=abc&next=${encodeURIComponent('/mypage/configurations/1/request-quote')}&flow=signup`)
    );
    expect(withNext.headers.get('location')).toBe(`${SITE}/login?confirmed=1&next=%2Fmypage%2Fconfigurations%2F1%2Frequest-quote`);
    expect(emailConfirmedLoginPath('/mypage')).toBe('/login?confirmed=1');
    expect(isCodeVerifierMissing({ code: 'pkce_code_verifier_not_found' })).toBe(true);
    expect(isCodeVerifierMissing({ name: 'AuthPKCECodeVerifierMissingError' })).toBe(true);
    expect(isCodeVerifierMissing({ code: 'bad_code_verifier' })).toBe(false);
  });

  it('パスワード再設定のリンク・ほかの失敗は、今までどおり理由を出す画面へ戻す', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exchangeFailing(missing);
    const reset = await authCallback(new NextRequest(`${SITE}/auth/callback?code=abc&next=${encodeURIComponent('/reset-password/update')}&flow=signup`));
    expect(reset.headers.get('location')).toBe(`${SITE}/reset-password?error=link`);
    exchangeFailing({ code: 'bad_code_verifier', status: 400 });
    const other = await authCallback(new NextRequest(`${SITE}/auth/callback?code=abc&next=%2Fmypage&flow=signup`));
    expect(other.headers.get('location')).toBe(`${SITE}/login?error=link`);
  });

  it('ログインの画面：confirmed=1 なら確認が済んだ案内、error=link なら送り直しまで含めた案内を出す', async () => {
    const confirmed = textOf(await LoginPage({ searchParams: Promise.resolve({ confirmed: '1' }) }));
    expect(confirmed).toContain(EMAIL_CONFIRMED_SIGN_IN);
    expect(confirmed).not.toContain(AUTH_LINK_ERROR);
    const linkError = textOf(await LoginPage({ searchParams: Promise.resolve({ error: 'link', confirmed: '1' }) }));
    expect(linkError).toContain(AUTH_LINK_ERROR);
    expect(linkError).not.toContain(EMAIL_CONFIRMED_SIGN_IN);
    expect(AUTH_LINK_ERROR).toContain('確認メールを送り直す');
    const plain = textOf(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(plain).not.toContain(EMAIL_CONFIRMED_SIGN_IN);
    // URL の値が重なっても（配列）、1 つの値として読む
    const repeated = textOf(await LoginPage({ searchParams: Promise.resolve({ confirmed: ['1', '1'] }) }));
    expect(repeated).toContain(EMAIL_CONFIRMED_SIGN_IN);
  });
});

describe('戻り先のパスの確かめ（open redirect の防止）', () => {
  it('同じサイトのパスだけを使う。別のサイトとして読まれうる形は既定の行き先にする', () => {
    expect(safeNextPath('/mypage/quotes/1?tab=a')).toBe('/mypage/quotes/1?tab=a');
    expect(safeNextPath('https://evil.example/')).toBe('/mypage');
    expect(safeNextPath('//evil.example')).toBe('/mypage');
    expect(safeNextPath(`/${String.fromCharCode(92)}evil.example`)).toBe('/mypage');
    expect(safeNextPath('/\t/evil.example')).toBe('/mypage');
    expect(safeNextPath('/\n/evil.example')).toBe('/mypage');
    expect(safeNextPath(null, '/admin')).toBe('/admin');
  });
});

describe('認証メールの日本語の文面', () => {
  it('会員登録の確認とパスワード再設定の文面を用意し、config.toml から読む（Confirm email の ON は運用開始の時）', () => {
    const config = read('supabase/config.toml');
    expect(config).toContain('[auth.email.template.confirmation]');
    expect(config).toContain('content_path = "./supabase/templates/confirmation.html"');
    expect(config).toContain('[auth.email.template.recovery]');
    expect(config).toContain('content_path = "./supabase/templates/recovery.html"');
    expect(config).toContain('subject = "【千の風プロジェクト】メールアドレスの確認"');
    expect(config).toContain('subject = "【千の風プロジェクト】パスワードの再設定"');
    expect(config).toContain('enable_confirmations = false');

    const confirmation = read('supabase/templates/confirmation.html');
    expect(confirmation).toContain('{{ .ConfirmationURL }}');
    expect(confirmation).toContain('メールアドレスを確認する');
    expect(confirmation).toContain('別の端末');
    expect(confirmation).toContain('{{ .SiteURL }}/contact');
    const recovery = read('supabase/templates/recovery.html');
    expect(recovery).toContain('{{ .ConfirmationURL }}');
    expect(recovery).toContain('新しいパスワードを設定する');
    expect(recovery).toContain('同じ端末・同じブラウザ');
    expect(recovery).toContain('{{ .SiteURL }}/contact');
    // キーなどの秘密の値は文面・設定に書かない
    for (const text of [config, confirmation, recovery]) expect(text).not.toMatch(/\bre_[A-Za-z0-9]{16,}/);
  });

  it('送り直しのボタンは、ログインのフォームの外に置く（フォームの入れ子にしない）', () => {
    const forms = read('components/auth/auth-forms.tsx');
    expect(forms).toContain('resendConfirmationAction');
    expect(forms).toContain('確認メールを送り直す');
    const loginForm = forms.slice(forms.indexOf('export function LoginForm'), forms.indexOf('export function RegisterForm'));
    const resend = loginForm.indexOf('<ResendConfirmationForm');
    const loginFormStart = loginForm.indexOf('<form action={action}');
    expect(resend).toBeGreaterThan(-1);
    expect(loginFormStart).toBeGreaterThan(resend);
    expect(loginForm.slice(0, loginFormStart)).not.toContain('<form');
  });
});
