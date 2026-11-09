import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 登録済み商品の追加画像・メーカー資料の「今回置いたファイル」の受け取り（PR #563。独立レビューの指摘）。
 * ファイルを置いたサーバーアクションが、商品と URL に署名した受け取りを返す。紐付ける前のファイルを消すときは、
 * この受け取りがあるファイルだけを消す（ブラウザが送ってきた URL だけを信じて、既存の未参照のファイルなどを消さない）。
 * 鍵はサーバーだけが持つ service_role の鍵から作る（新しい秘密を増やさない）。ローカル検証モードは固定の鍵
 */
const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;

function receiptKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || (process.env.WING_LOCAL_MODE === '1' ? 'wing-local-mode-option-media' : '');
  if (!secret) throw new Error('option media receipt key is not configured');
  return createHmac('sha256', 'wing-option-media-staging').update(secret).digest();
}

function mac(optionId: string, url: string, expiresAt: number): Buffer {
  return createHmac('sha256', receiptKey()).update(`${optionId}\n${url}\n${expiresAt}`).digest();
}

/** 置いたファイルの受け取り（「有効期限.署名」。24 時間） */
export function optionMediaReceipt(optionId: string, url: string, now = Date.now()): string {
  const expiresAt = now + RECEIPT_TTL_MS;
  return `${expiresAt}.${mac(optionId, url, expiresAt).toString('base64url')}`;
}

/** この商品のこの URL を、このサーバーが置いたと確かめる（期限切れ・別の商品・別の URL は通さない） */
export function isValidOptionMediaReceipt(optionId: string, url: string, receipt: string, now = Date.now()): boolean {
  const match = /^(\d{13,16})\.([A-Za-z0-9_-]{43})$/.exec(receipt);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + RECEIPT_TTL_MS) return false;
  const expected = mac(optionId, url, expiresAt);
  const given = Buffer.from(match[2], 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
