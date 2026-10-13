/**
 * GMOサインに署名完了の通知先（Webhook）を登録する。初期設定で 1 回だけ実行する。
 *
 *   node scripts/gmosign-register-webhook.ts --events <通知するイベント> [--url https://www.sen-no-kaze.com]
 *
 * - 資格情報は .env.local（または環境変数）の GMOSIGN_CUSTOMER_ID / GMOSIGN_SECRET_KEY / GMOSIGN_WEBHOOK_TOKEN を使う
 * - 通知先は <url>/api/webhooks/gmosign?token=<GMOSIGN_WEBHOOK_TOKEN>
 * - --events に渡す値は GMOサインの API 仕様書（envelopeEvents）で確認する（docs/electronic-contract-gmosign.md）
 *
 * lib/integrations/gmosign.ts はサーバー専用（server-only）のため、ここでは同じ API を最小限で呼ぶ。
 */
import { arg, loadEnv, requireEnv } from './env.ts';

loadEnv();

const events = arg('events');
if (!events) {
  console.error('--events を指定してください（GMOサインの API 仕様書の envelopeEvents の値）');
  process.exit(1);
}
const siteUrl = (arg('url') ?? 'https://www.sen-no-kaze.com').replace(/\/+$/, '');
const baseUrl = (process.env.GMOSIGN_API_BASE_URL?.trim() || 'https://api.gmo-exapi.net/gmosign').replace(/\/+$/, '');
const customerId = requireEnv('GMOSIGN_CUSTOMER_ID');
const secretKey = requireEnv('GMOSIGN_SECRET_KEY');
const token = requireEnv('GMOSIGN_WEBHOOK_TOKEN');

const res = await fetch(`${baseUrl}/customer/connect`, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${customerId}:${secretKey}`).toString('base64')}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify({
    name: 'Wing 電子契約（署名完了）',
    urlToPublishTo: `${siteUrl}/api/webhooks/gmosign?token=${encodeURIComponent(token)}`,
    envelopeEvents: events,
  }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`登録に失敗しました（HTTP ${res.status}）: ${text.slice(0, 500)}`);
  process.exit(1);
}
console.log('登録しました:', text.slice(0, 500));
