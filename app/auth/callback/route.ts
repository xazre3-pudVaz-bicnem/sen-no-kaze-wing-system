import { NextResponse, type NextRequest } from 'next/server';
import { createClient, hasSupabaseEnv } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/utils';

/** Supabase のメール確認・パスワード再設定リンクの着地点（code → セッション交換） */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'), '/mypage');
  if (code && hasSupabaseEnv()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL('/login?error=link', url.origin));
}
