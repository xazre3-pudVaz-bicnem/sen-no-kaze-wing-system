import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { renderQuotePdf } from '@/lib/pdf/quote-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 見積書PDF。
 * - 本人または管理者のみ（store.getQuote が所有者チェック／RLS で他人の見積は返らない）
 * - 初回はレンダリングしてストレージへ保存（quote_documents）。2回目以降は保存済みを返す。
 *   見積の金額はスナップショットなので、マスター価格が変わっても PDF は変わらない。
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  const { id } = await ctx.params;
  const store = await getStore();
  const detail = await store.getQuote(id, user);
  if (!detail) return NextResponse.json({ error: '見積が見つかりません' }, { status: 404 });

  const fileName = `wing-quote-${detail.quote.quote_no}.pdf`;
  let bytes: Uint8Array;
  const regenerate = req.nextUrl.searchParams.get('regenerate') === '1' && user.role === 'admin';
  const existing = regenerate ? null : await store.getQuoteDocumentFile(id);
  if (existing) {
    bytes = existing.bytes;
  } else {
    bytes = await renderQuotePdf(detail.quote, detail.items);
    try {
      await store.saveQuoteDocument(id, bytes, fileName);
    } catch (e) {
      console.warn('[wing] quote document save failed', e);
    }
  }
  const download = req.nextUrl.searchParams.get('download') === '1';
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
