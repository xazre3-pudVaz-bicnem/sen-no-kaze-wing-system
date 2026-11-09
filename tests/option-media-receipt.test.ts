import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isValidOptionMediaReceipt, optionMediaReceipt } from '@/lib/storage/option-media-receipt';

/**
 * 登録済み商品の追加画像・メーカー資料の「今回置いたファイル」の受け取り（PR #563 の独立レビューの指摘）。
 * 置いたサーバーが署名した受け取りのあるファイルだけを、紐付ける前に消せる（ブラウザが送った URL だけを信じない）
 */
const OPTION = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const URL_A = `https://runtime.supabase.co/storage/v1/object/public/product-images/option-${OPTION}/gallery/a.png`;
const URL_B = `https://runtime.supabase.co/storage/v1/object/public/product-images/option-${OPTION}/gallery/b.png`;

describe('置いたファイルの受け取り', () => {
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  });

  it('同じ商品・同じ URL の受け取りは通る', () => {
    const receipt = optionMediaReceipt(OPTION, URL_A);
    expect(isValidOptionMediaReceipt(OPTION, URL_A, receipt)).toBe(true);
  });

  it('別の商品・別の URL・書き換えた受け取り・形の違う受け取りは通らない', () => {
    const receipt = optionMediaReceipt(OPTION, URL_A);
    expect(isValidOptionMediaReceipt(OTHER, URL_A, receipt)).toBe(false);
    expect(isValidOptionMediaReceipt(OPTION, URL_B, receipt)).toBe(false);
    const [expires, mac] = receipt.split('.');
    expect(isValidOptionMediaReceipt(OPTION, URL_A, `${Number(expires) + 1}.${mac}`)).toBe(false);
    const tampered = `${mac.slice(0, -1)}${mac.endsWith('A') ? 'B' : 'A'}`;
    expect(isValidOptionMediaReceipt(OPTION, URL_A, `${expires}.${tampered}`)).toBe(false);
    expect(isValidOptionMediaReceipt(OPTION, URL_A, '')).toBe(false);
    expect(isValidOptionMediaReceipt(OPTION, URL_A, 'not-a-receipt')).toBe(false);
  });

  it('期限（24 時間）を過ぎた受け取りは通らない', () => {
    const issuedAt = Date.now() - 25 * 60 * 60 * 1000;
    const receipt = optionMediaReceipt(OPTION, URL_A, issuedAt);
    expect(isValidOptionMediaReceipt(OPTION, URL_A, receipt)).toBe(false);
    expect(isValidOptionMediaReceipt(OPTION, URL_A, receipt, issuedAt + 60_000)).toBe(true);
  });

  it('鍵が違うサーバーの受け取りは通らない（鍵はサーバーだけが持つ）', () => {
    const receipt = optionMediaReceipt(OPTION, URL_A);
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'another-key';
    expect(isValidOptionMediaReceipt(OPTION, URL_A, receipt)).toBe(false);
  });
});
