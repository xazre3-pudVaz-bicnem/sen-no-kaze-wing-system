import { NextResponse, type NextRequest } from 'next/server';
import { getStore } from '@/lib/data/store';
import { flushNotificationsSafely } from '@/lib/mail/send';
import {
  LOCAL_GMOSIGN_WEBHOOK_TOKEN,
  downloadSignedDocument,
  gmoSignConfig,
  isLocalGmoSignStub,
  localStubSignedPdf,
  parseEnvelopeWebhook,
  webhookTokenMatches,
} from '@/lib/integrations/gmosign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GMOサインの署名完了通知（Webhook）。
 *
 * - 通知先 URL に付けた推測できないトークン（GMOSIGN_WEBHOOK_TOKEN）が一致する通知だけ受け付ける
 * - 通知の内容は信用しない。封筒の識別子で契約を探し、署名済み PDF をこちらの資格情報で GMOサインから取得できたときだけ
 *   非公開の保存先へ置いて「締結済み」を記録する
 * - 関係の無い封筒・重複した通知は 200 で受け流す（GMOサイン側の再送を止めるため）
 */
export async function POST(req: NextRequest) {
  const config = gmoSignConfig();
  const localStub = isLocalGmoSignStub();
  const expectedToken = config?.webhookToken ?? (localStub ? LOCAL_GMOSIGN_WEBHOOK_TOKEN : null);
  if (!expectedToken) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (!webhookTokenMatches(expectedToken, req.nextUrl.searchParams.get('token'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const envelope = parseEnvelopeWebhook(payload);
  if (!envelope) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const store = await getStore();
  try {
    const documentId = envelope.documentIds[0] ?? null;
    if (!documentId && !localStub) return NextResponse.json({ ok: true, ignored: 'no document' });
    const pdf = config ? await downloadSignedDocument(config, documentId as string) : localStubSignedPdf();
    const contractId = await store.completeElectronicContract(envelope.envelopeXid, documentId, pdf);
    if (!contractId) return NextResponse.json({ ok: true, ignored: 'unknown envelope' });
    await flushNotificationsSafely();
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 取得・保存に失敗したら 500 を返し、GMOサイン側の再送に任せる（状態は signed にしていない）
    console.error('[wing] gmosign webhook failed', e);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
