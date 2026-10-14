import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 案件の写真・書類（非公開の保存先 case-files）。
 * 見てよいかは利用者のセッションで判定する（本部・担当代理店・技術検討の担当はすべて、お客様は「お客様に表示」の資料だけ）。
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: '資料が見つかりません' }, { status: 404 });
  const store = await getCaseFlowStore();
  const found = await store.getCaseFileContent(user, id);
  if (!found) return NextResponse.json({ error: '資料が見つかりません' }, { status: 404 });
  const ext = found.file.storage_path.split('.').pop() ?? 'bin';
  return new NextResponse(Buffer.from(found.bytes), {
    headers: {
      'Content-Type': found.file.content_type,
      // 元のファイル名は表示用。ダウンロード名は ID と拡張子だけにする（ヘッダーへ利用者の入力をそのまま入れない）
      'Content-Disposition': `inline; filename="wing-case-file-${found.file.id}.${ext}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
