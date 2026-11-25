/**
 * 会員登録の確認メール（Supabase Auth の Confirm email）の決まり。
 * 2026-11-25：本部先行の運用開始の時から ON にする（千の風様のご判断）。ON にするのは本番の設定（docs/mail-setup.md）。
 *
 * 確認のリンクは PKCE。リンクを開くと、Supabase がメールアドレスを確認済みにしてから /auth/callback へ戻す。
 * 登録した時と別のブラウザ（スマートフォンのメールのアプリなど）で開くと、このブラウザに Cookie（code verifier）が
 * 無いためログインの状態は引き継げないが、確認そのものは済んでいる。そこでログインの画面へ戻し、ログインを案内する。
 */

/** 別のブラウザでリンクを開いたとき（確認は済んでいる）に、ログインの画面で出す文 */
export const EMAIL_CONFIRMED_SIGN_IN =
  'メールアドレスの確認が済みました。登録したメールアドレスとパスワードでログインしてください。';

/** 確認が済んでいないアカウントでログインしようとしたときの文 */
export const EMAIL_NOT_CONFIRMED =
  'メールアドレスの確認が済んでいません。登録の時に届いた確認メールのリンクを開いてください。メールが見当たらないときは、下のボタンで送り直せます。';

/** 送り直しを受け付けたときの文（そのアドレスが登録済みかどうかは伝えない） */
export const CONFIRMATION_RESENT =
  '確認メールを送り直しました。確認がまだのアドレスであれば、数分で届きます。届かないときは、迷惑メールのフォルダもご確認ください。';

/** 続けて送り直そうとしたときの文 */
export const CONFIRMATION_RESEND_RATE_LIMITED =
  '続けて送り直すことはできません。1 分以上おいてから、もう一度お試しください。';

/** 送る仕組みの障害で送り直せなかったときの文 */
export const CONFIRMATION_RESEND_FAILED =
  '確認メールを送れませんでした。時間をおいて、もう一度お試しください。続くときは、お問い合わせのフォームからお知らせください。';

/**
 * 会員登録の確認メールのリンクの戻り先。会員登録の確認だと分かる印（flow=signup）を付ける。
 * 印の無いリンク（パスワード再設定など）は、別のブラウザで開いても「確認が済んだ」とは案内しない
 */
export function signupRedirectTo(origin: string, next: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}&flow=signup`;
}

/** 戻り先が、会員登録の確認のリンクか */
export function isSignupCallback(params: URLSearchParams): boolean {
  return params.get('flow') === 'signup';
}

/** コードの交換に失敗した理由が「このブラウザに Cookie が無い」（別のブラウザ・端末でリンクを開いた）か */
export function isCodeVerifierMissing(error: { code?: string | null; name?: string | null }): boolean {
  return error.code === 'pkce_code_verifier_not_found' || error.name === 'AuthPKCECodeVerifierMissingError';
}

/** ログインの失敗の理由が「メールアドレスの確認が済んでいない」か */
export function isEmailNotConfirmed(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message ?? '');
}

/** 送り直しの失敗の理由が「短い間に続けて送った」か */
export function isEmailRateLimited(error: { code?: string | null; status?: number | null }): boolean {
  return error.code === 'over_email_send_rate_limit' || error.status === 429;
}

/** 確認は済んでいてログインが要るときの、ログインの画面の URL（元の行き先を残す） */
export function emailConfirmedLoginPath(next: string): string {
  return next === '/mypage' ? '/login?confirmed=1' : `/login?confirmed=1&next=${encodeURIComponent(next)}`;
}
