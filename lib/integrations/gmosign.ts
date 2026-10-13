import 'server-only';

/**
 * GMOサイン（電子契約）連携。
 *
 * API の形は、GMOサインが公開している Power Automate コネクタの定義
 * （microsoft/PowerPlatformConnectors の certified-connectors/GMO Sign/apiDefinition.swagger.json）に合わせている。
 *   接続先 https://api.gmo-exapi.net/gmosign、Basic 認証（顧客ID：APIシークレットキー）
 *   - POST /customer/envelopes/templates/{templateId}/transaction … テンプレートから契約書を送信
 *   - GET  /customer/documents/{documentId} … 文書（署名済み PDF）を取得
 *   - POST /customer/connect … 署名完了の通知先（Webhook）を登録
 *
 * 契約書の本文（条文）は GMOサイン上の契約書テンプレート（本部が管理）で持ち、コードには持たない。
 * こちらからは差し込み項目（見積番号・契約金額など）とお客様（署名者）だけを渡す。
 *
 * 資格情報は環境変数で渡す（未設定なら連携は無効。画面は送信できない旨を表示する）。
 *   GMOSIGN_CUSTOMER_ID / GMOSIGN_SECRET_KEY … GMOサインから発行される顧客ID・APIシークレットキー
 *   GMOSIGN_TEMPLATE_ID … 契約書テンプレートの ID
 *   GMOSIGN_WEBHOOK_TOKEN … 通知先 URL に付ける推測できない文字列（通知の受付を限定する）
 *   GMOSIGN_API_BASE_URL（任意）… 検証環境などの接続先。既定は本番の API
 *   GMOSIGN_SENDER_NAME（任意）… 送信者名
 */

export const GMOSIGN_DEFAULT_BASE_URL = 'https://api.gmo-exapi.net/gmosign';

export interface GmoSignConfig {
  baseUrl: string;
  customerId: string;
  secretKey: string;
  templateId: string;
  webhookToken: string;
  senderName: string | null;
}

/** 連携の設定。必須の値が 1 つでも欠けていれば null（連携は無効） */
export function gmoSignConfig(env: Record<string, string | undefined> = process.env): GmoSignConfig | null {
  const customerId = env.GMOSIGN_CUSTOMER_ID?.trim();
  const secretKey = env.GMOSIGN_SECRET_KEY?.trim();
  const templateId = env.GMOSIGN_TEMPLATE_ID?.trim();
  const webhookToken = env.GMOSIGN_WEBHOOK_TOKEN?.trim();
  if (!customerId || !secretKey || !templateId || !webhookToken) return null;
  return {
    baseUrl: (env.GMOSIGN_API_BASE_URL?.trim() || GMOSIGN_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    customerId,
    secretKey,
    templateId,
    webhookToken,
    senderName: env.GMOSIGN_SENDER_NAME?.trim() || null,
  };
}

export class GmoSignError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'GmoSignError';
  }
}

type Fetch = typeof fetch;

function authHeader(config: GmoSignConfig): string {
  return `Basic ${Buffer.from(`${config.customerId}:${config.secretKey}`).toString('base64')}`;
}

async function call(config: GmoSignConfig, path: string, init: RequestInit, fetchImpl: Fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: authHeader(config), Accept: 'application/json', ...(init.headers ?? {}) },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new GmoSignError(`GMOサインへ接続できませんでした（${e instanceof Error ? e.message : String(e)}）`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message = typeof body === 'object' && body && 'message' in body ? String((body as { message: unknown }).message) : text.slice(0, 200);
    throw new GmoSignError(`GMOサインがエラーを返しました（HTTP ${res.status}）${message ? `：${message}` : ''}`, res.status);
  }
  return body;
}

export interface ContractEnvelopeInput {
  /** GMOサイン上の封筒名（一覧で識別できる名前） */
  envelopeName: string;
  signer: { name: string; email: string };
  /** 契約書テンプレートの差し込み項目（項目名はテンプレート側と一致させる） */
  insetItems: Array<{ name: string; value: string }>;
}

/** テンプレート送信のリクエスト本文（テストで内容を確認できるよう分けている） */
export function contractEnvelopeBody(config: GmoSignConfig, input: ContractEnvelopeInput) {
  return {
    envelope_name: input.envelopeName,
    ...(config.senderName ? { sender_name: config.senderName } : {}),
    is_compliation_mail: 1,
    // 署名完了を Webhook で受け取る
    is_web_hook: 1,
    signer_list: [
      // 自社の署名者（契約印）はテンプレートに登録したものを使う
      { signer_type: 1, use_template: 1 },
      // お客様（取引先の署名者）。署名依頼メールを GMOサインから送る
      {
        signer_type: 2,
        use_template: 2,
        order_no: '1',
        sign_type: 1,
        name: input.signer.name,
        email: input.signer.email,
        is_send_mail: 1,
        language: 'ja',
      },
    ],
    inset_item_list: input.insetItems.map((item) => ({ name: item.name, value: item.value })),
  };
}

/** 契約書テンプレートから封筒を作ってお客様へ送信する。戻り値は封筒の識別子と文書 ID */
export async function sendContractEnvelope(
  config: GmoSignConfig,
  input: ContractEnvelopeInput,
  fetchImpl: Fetch = fetch
): Promise<{ envelopeXid: string; documentId: string | null }> {
  const body = (await call(
    config,
    `/customer/envelopes/templates/${encodeURIComponent(config.templateId)}/transaction`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contractEnvelopeBody(config, input)) },
    fetchImpl
  )) as { envelope_xid?: unknown; document_list?: Array<{ control_number?: unknown }> } | null;
  const envelopeXid = typeof body?.envelope_xid === 'string' ? body.envelope_xid.trim() : '';
  if (!envelopeXid) throw new GmoSignError('GMOサインの応答に封筒の識別子がありません');
  const documentId = body?.document_list?.find((doc) => typeof doc.control_number === 'string')?.control_number;
  return { envelopeXid, documentId: typeof documentId === 'string' ? documentId : null };
}

/** 文書（署名済み PDF）を取得する。通知の内容は信用せず、こちらの資格情報で取得できたものだけを正とする */
export async function downloadSignedDocument(config: GmoSignConfig, documentId: string, fetchImpl: Fetch = fetch): Promise<Uint8Array> {
  const body = (await call(
    config,
    `/customer/documents/${encodeURIComponent(documentId)}?download_type=2&operation=1`,
    { method: 'GET' },
    fetchImpl
  )) as { downloadedDocument?: unknown } | string | null;
  const encoded = typeof body === 'object' && body && typeof body.downloadedDocument === 'string' ? body.downloadedDocument : null;
  if (!encoded) throw new GmoSignError('GMOサインの応答に文書がありません');
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
  if (bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
    throw new GmoSignError('GMOサインから取得した文書が PDF ではありません');
  }
  return bytes;
}

/** 署名完了の通知先（Webhook）を登録する（初期設定で 1 回だけ使う） */
export async function registerEnvelopeWebhook(
  config: GmoSignConfig,
  input: { name: string; url: string; events: string },
  fetchImpl: Fetch = fetch
): Promise<{ connectId: string | null }> {
  const body = (await call(
    config,
    '/customer/connect',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.name, urlToPublishTo: input.url, envelopeEvents: input.events }),
    },
    fetchImpl
  )) as { connect_id?: unknown } | null;
  return { connectId: typeof body?.connect_id === 'string' ? body.connect_id : null };
}

/** 通知（Webhook）の本文から、封筒の識別子と文書 ID を取り出す */
export function parseEnvelopeWebhook(payload: unknown): { envelopeXid: string; documentIds: string[] } | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { envelope_xid?: unknown; document_list?: unknown };
  const envelopeXid = typeof record.envelope_xid === 'string' ? record.envelope_xid.trim() : '';
  if (!envelopeXid) return null;
  const documentIds = Array.isArray(record.document_list)
    ? record.document_list
        .map((doc) => (doc && typeof doc === 'object' ? (doc as { documentId?: unknown }).documentId : null))
        .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
        .map((id) => id.trim())
    : [];
  return { envelopeXid, documentIds };
}

/** 通知先 URL に付けたトークンの照合（長さの違いも含めて一定時間で比べる） */
export function webhookTokenMatches(expected: string, actual: string | null): boolean {
  if (!actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * ローカル検証モード（WING_LOCAL_MODE=1、開発・E2E 専用）で、資格情報が無いときに使う代わりの送受信。
 * 実際の GMOサインへは接続しない。本番では使わない（ローカル検証モード自体を本番で有効にしない）。
 */
export const LOCAL_GMOSIGN_WEBHOOK_TOKEN = 'local-gmosign-webhook-token';

export function isLocalGmoSignStub(env: Record<string, string | undefined> = process.env): boolean {
  return env.WING_LOCAL_MODE === '1' && gmoSignConfig(env) === null;
}

export function localStubEnvelope(): { envelopeXid: string; documentId: string } {
  const id = crypto.randomUUID();
  return { envelopeXid: `local-envelope-${id}`, documentId: `local-document-${id}` };
}

export function localStubSignedPdf(): Uint8Array {
  const text = ['%PDF-1.4', '% local stub signed contract', '1 0 obj << >> endobj', 'trailer << >>', '%%EOF', ''].join('\n');
  return new TextEncoder().encode(text);
}
