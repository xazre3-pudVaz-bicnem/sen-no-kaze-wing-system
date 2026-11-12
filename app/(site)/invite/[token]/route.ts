import { NextResponse, type NextRequest } from 'next/server';
import { INVITATION_COOKIE, INVITATION_COOKIE_MAX_AGE, INVITATION_TOKEN } from '@/lib/domain/organizations';

export const dynamic = 'force-dynamic';

/**
 * 招待メールのリンク（/invite/鍵）。鍵を Cookie に移して /invite へ進める。
 * 鍵を URL に残さない（ログインの next・ブラウザーの履歴）。鍵が正しいかは /invite と「参加する」で DB が確かめる
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = request.nextUrl.clone();
  url.pathname = '/invite';
  url.search = '';
  const response = NextResponse.redirect(url, 303);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  if (INVITATION_TOKEN.test(token)) {
    response.cookies.set(INVITATION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/invite',
      maxAge: INVITATION_COOKIE_MAX_AGE,
    });
  } else {
    // 形の違うリンクでは、前に開いた招待を出さない
    response.cookies.delete({ name: INVITATION_COOKIE, path: '/invite' });
  }
  return response;
}
