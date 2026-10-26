/**
 * パスワード再設定（Supabase のメールのリンク）の決まり。
 *
 * メールのリンクは PKCE で、申し込んだブラウザの Cookie（code verifier）と突き合わせて本人を確かめる。
 * Cookie は申し込んだ画面のオリジンにしか残らないため、申し込む画面とリンクの戻り先（/auth/callback）は
 * 同じオリジンでなければならない。2026-10-26：独自ドメイン（www.sen-no-kaze.com）で申し込むと、戻り先が
 * NEXT_PUBLIC_SITE_URL（vercel.app）になり、Cookie が無いため必ず失敗していた。
 */

/** リンクを確かめられなかったときの文（申し込みの画面・新しいパスワードの画面で出す） */
export const PASSWORD_RESET_LINK_ERROR =
  '再設定のリンクを確認できませんでした。リンクの有効期限が切れたか、すでに使われた可能性があります。お手数ですが、もう一度再設定メールを送ってください。メールのリンクは、再設定を申し込んだのと同じブラウザで開いてください。';

/** ログイン画面で出す文（パスワード再設定以外のメールのリンク） */
export const AUTH_LINK_ERROR =
  'メールのリンクを確認できませんでした。リンクの有効期限が切れたか、すでに使われた可能性があります。もう一度お試しください。';

/**
 * 申し込みの画面を、リンクの戻り先と同じオリジン（NEXT_PUBLIC_SITE_URL）で開き直す URL。
 * 今のオリジンが同じ、または判断できないときは null（開き直さない）
 */
export function passwordResetCanonicalUrl(siteUrl: string | null | undefined, requestOrigin: string | null | undefined): string | null {
  if (!siteUrl || !requestOrigin) return null;
  try {
    const site = new URL(siteUrl);
    const current = new URL(requestOrigin);
    return site.origin === current.origin ? null : `${site.origin}/reset-password`;
  } catch {
    return null;
  }
}

/** メールのリンクを確かめられなかったときの行き先（パスワード再設定なら申し込みの画面へ戻して理由を出す） */
export function authLinkErrorPath(next: string): string {
  return next === '/reset-password' || next.startsWith('/reset-password/') ? '/reset-password?error=link' : '/login?error=link';
}

/** パスワードの更新に失敗したときの文（Supabase の英語のメッセージをそのまま出さない） */
export function passwordUpdateErrorMessage(error: { code?: string | null; name?: string | null }): string {
  switch (error.code) {
    case 'same_password':
      return '新しいパスワードが今のパスワードと同じです。別のパスワードを入力してください。';
    case 'weak_password':
      return 'このパスワードは使えません。より長く、英字と数字を組み合わせたパスワードにしてください。';
    case 'session_not_found':
    case 'session_expired':
      return PASSWORD_RESET_LINK_ERROR;
  }
  if (error.name === 'AuthSessionMissingError') return PASSWORD_RESET_LINK_ERROR;
  return 'パスワードを更新できませんでした。時間をおいてもう一度お試しください。';
}
