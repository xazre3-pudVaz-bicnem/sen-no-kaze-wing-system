import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 の proxy（旧 middleware）。
 * - Supabase セッションの更新（Cookie の再発行）
 * - /mypage・/admin の簡易ガード（最終防衛線は各ページの requireUser / requireAdmin）
 * ローカル検証モード（WING_LOCAL_MODE=1）では Supabase を呼ばず、Cookie の有無だけで振り分ける。
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = pathname.startsWith('/mypage') || pathname.startsWith('/admin');
  const isAuthPage = pathname === '/login' || pathname === '/register';

  if (process.env.WING_LOCAL_MODE === '1') {
    const hasSession = Boolean(request.cookies.get('wing_local_session')?.value);
    if (isProtected && !hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next();
  }
  if (!isProtected && !isAuthPage) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if (isAuthPage && user) {
    const next = request.nextUrl.searchParams.get('next');
    const url = request.nextUrl.clone();
    url.pathname = next && next.startsWith('/') && !next.startsWith('//') ? next.split('?')[0] : '/mypage';
    url.search = next && next.includes('?') ? `?${next.split('?')[1]}` : '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images/|downloads/|api/local-files/|.*\\.(?:svg|png|jpg|jpeg|webp|ico|pdf)$).*)'],
};
