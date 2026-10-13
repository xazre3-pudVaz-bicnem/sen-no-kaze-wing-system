import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 締結済みの契約書（GMOサインで署名済みの PDF）。
 * 見られるのは契約のお客様と本部だけ（store.getSignedContractPdf が RLS・所有者で判定する）。
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  const { id } = await ctx.params;
  const store = await getStore();
  const file = await store.getSignedContractPdf(id, user);
  if (!file) return NextResponse.json({ error: '契約書が見つかりません' }, { status: 404 });
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="wing-contract-${file.contract.id}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
