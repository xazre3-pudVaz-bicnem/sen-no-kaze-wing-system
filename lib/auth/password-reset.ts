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

/** リクエストのホスト（転送のヘッダーに複数の値があれば先頭）。判断できなければ null */
export function requestHost(headers: { get(name: string): string | null }): string | null {
  const host = (headers.get('x-forwarded-host') ?? headers.get('host'))?.split(',')[0]?.trim().toLowerCase();
  return host || null;
}

/**
 * 申し込みの画面を、リンクの戻り先と同じホスト（NEXT_PUBLIC_SITE_URL）で開き直す URL。
 * Cookie はホストごとなので、ホストだけで比べる（http と https の違いで開き直しを繰り返さない）。
 * 今のホストが同じ、または判断できないときは null（開き直さない）
 */
export function passwordResetCanonicalUrl(siteUrl: string | null | undefined, host: string | null | undefined): string | null {
  if (!siteUrl || !host) return null;
  try {
    const site = new URL(siteUrl);
    return site.host.toLowerCase() === host.toLowerCase() ? null : `${site.origin}/reset-password`;
  } catch {
    return null;
  }
}

/**
 * メールのリンクを確かめられなかったときの行き先。パスワード再設定なら申し込みの画面へ戻して理由を出す。
 * ほかはログイン画面へ戻し、元の行き先を残す（ログインした後に続きへ戻れるように）
 */
export function authLinkErrorPath(next: string): string {
  if (next === '/reset-password' || next.startsWith('/reset-password/')) return '/reset-password?error=link';
  return next === '/mypage' ? '/login?error=link' : `/login?error=link&next=${encodeURIComponent(next)}`;
}

/** 弱いパスワードと判定されたときの文（Supabase が返す理由ごと。理由が分からなければ一般的な文） */
function weakPasswordMessage(reasons: readonly string[] | null | undefined): string {
  if (reasons?.includes('pwned')) return 'このパスワードは、漏えいが知られているパスワードに含まれているため使えません。別のパスワードにしてください。';
  if (reasons?.includes('characters')) return 'このパスワードは使えません。決められた種類の文字（英字・数字・記号など）を含めてください。';
  if (reasons?.includes('length')) return 'このパスワードは短すぎます。もっと長いパスワードにしてください。';
  return 'このパスワードは使えません。より長く、英字と数字を組み合わせたパスワードにしてください。';
}

/** パスワードの更新に失敗したときの文（Supabase の英語のメッセージをそのまま出さない） */
export function passwordUpdateErrorMessage(error: { code?: string | null; name?: string | null; reasons?: readonly string[] | null }): string {
  switch (error.code) {
    case 'same_password':
      return '新しいパスワードが今のパスワードと同じです。別のパスワードを入力してください。';
    case 'weak_password':
      return weakPasswordMessage(error.reasons);
    case 'session_not_found':
    case 'session_expired':
      return PASSWORD_RESET_LINK_ERROR;
  }
  if (error.name === 'AuthWeakPasswordError') return weakPasswordMessage(error.reasons);
  if (error.name === 'AuthSessionMissingError') return PASSWORD_RESET_LINK_ERROR;
  return 'パスワードを更新できませんでした。時間をおいてもう一度お試しください。';
}
