import { NextResponse, type NextRequest } from 'next/server';
import { authLinkErrorPath, loggableAuthErrorCode } from '@/lib/auth/password-reset';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/utils';

/** Supabase のメール確認・パスワード再設定リンクの着地点（code → セッション交換） */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'), '/mypage');
  // 期限切れ・使用済みのリンクは、Supabase が code の代わりにエラーのコードを付けて戻す（理由のコードだけを記録する）
  const linkError = loggableAuthErrorCode(url.searchParams.get('error_code') ?? url.searchParams.get('error'));
  if (linkError) console.error('[auth/callback] link error', { code: linkError });
  if (code && hasSupabaseEnv()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    // 申し込んだブラウザの Cookie が無い（別のブラウザ・別のドメインで開いた）・期限切れ など。理由は戻した画面で案内する
    console.error('[auth/callback] exchangeCodeForSession failed', { code: error.code ?? null, status: error.status ?? null });
  }
  return NextResponse.redirect(new URL(authLinkErrorPath(next), url.origin));
}
