import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  GMOSIGN_DEFAULT_BASE_URL,
  GmoSignError,
  contractEnvelopeBody,
  downloadSignedDocument,
  gmoSignConfig,
  parseEnvelopeWebhook,
  sendContractEnvelope,
  webhookTokenMatches,
} from '@/lib/integrations/gmosign';
import { CONTRACT_INSET_ITEM_NAMES, activeContract, contractInsetItems } from '@/lib/domain/electronic-contract';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').split('\r').join('');
const migration = read('supabase/migrations/20261013150000_electronic_contracts.sql');

const env = {
  GMOSIGN_CUSTOMER_ID: 'cus-1',
  GMOSIGN_SECRET_KEY: 'secret',
  GMOSIGN_TEMPLATE_ID: 'tpl-9',
  GMOSIGN_WEBHOOK_TOKEN: 'token-abc',
};

describe('GMOサイン連携：設定とリクエスト', () => {
  it('必須の 4 つがそろったときだけ有効にする（既定の接続先は公開されている API）', () => {
    expect(gmoSignConfig({})).toBeNull();
    expect(gmoSignConfig({ ...env, GMOSIGN_TEMPLATE_ID: ' ' })).toBeNull();
    const config = gmoSignConfig(env)!;
    expect(config.baseUrl).toBe(GMOSIGN_DEFAULT_BASE_URL);
    expect(gmoSignConfig({ ...env, GMOSIGN_API_BASE_URL: 'https://example.test/gmosign/' })!.baseUrl).toBe('https://example.test/gmosign');
  });

  it('テンプレートから送信：Basic 認証・封筒名・お客様（取引先署名者）・差し込み項目・署名完了の通知', async () => {
    const config = gmoSignConfig(env)!;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ envelope_xid: 'ENV-1', envelope_status: '1', document_list: [{ document_name: '契約書', control_number: 'DOC-1' }] }), { status: 200 })
    );
    const input = { envelopeName: '工事請負契約書 Q1', signer: { name: '顧客 太郎', email: 'taro@example.com' }, insetItems: [{ name: '見積番号', value: 'Q1' }] };
    const result = await sendContractEnvelope(config, input, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ envelopeXid: 'ENV-1', documentId: 'DOC-1' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GMOSIGN_DEFAULT_BASE_URL}/customer/envelopes/templates/tpl-9/transaction`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('cus-1:secret').toString('base64')}`);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual(contractEnvelopeBody(config, input));
    expect(body.is_web_hook).toBe(1);
    expect(body.signer_list).toContainEqual(expect.objectContaining({ signer_type: 2, name: '顧客 太郎', email: 'taro@example.com', is_send_mail: 1 }));
    expect(body.signer_list).toContainEqual({ signer_type: 1, use_template: 1 });
    expect(body.inset_item_list).toEqual([{ name: '見積番号', value: 'Q1' }]);
  });

  it('エラー応答・封筒の識別子が無い応答は GmoSignError にする（送信済みにしない）', async () => {
    const config = gmoSignConfig(env)!;
    const failing = vi.fn(async () => new Response(JSON.stringify({ message: 'invalid template' }), { status: 400 }));
    await expect(sendContractEnvelope(config, { envelopeName: 'x', signer: { name: 'a', email: 'a@b.c' }, insetItems: [] }, failing as unknown as typeof fetch)).rejects.toMatchObject({
      name: 'GmoSignError',
      status: 400,
    });
    const empty = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    await expect(sendContractEnvelope(config, { envelopeName: 'x', signer: { name: 'a', email: 'a@b.c' }, insetItems: [] }, empty as unknown as typeof fetch)).rejects.toBeInstanceOf(GmoSignError);
  });

  it('署名済み文書は PDF だけを受け取る', async () => {
    const config = gmoSignConfig(env)!;
    const pdf = Buffer.from('%PDF-1.7 signed');
    const ok = vi.fn(async () => new Response(JSON.stringify({ downloadedDocument: pdf.toString('base64') }), { status: 200 }));
    const bytes = await downloadSignedDocument(config, 'DOC-1', ok as unknown as typeof fetch);
    expect(Buffer.from(bytes).toString()).toBe('%PDF-1.7 signed');
    expect((ok.mock.calls[0] as unknown as [string])[0]).toBe(`${GMOSIGN_DEFAULT_BASE_URL}/customer/documents/DOC-1?download_type=2&operation=1`);
    const notPdf = vi.fn(async () => new Response(JSON.stringify({ downloadedDocument: Buffer.from('<html>').toString('base64') }), { status: 200 }));
    await expect(downloadSignedDocument(config, 'DOC-1', notPdf as unknown as typeof fetch)).rejects.toBeInstanceOf(GmoSignError);
  });

  it('通知の本文から封筒・文書を取り出し、トークンは完全一致だけ受け付ける', () => {
    expect(parseEnvelopeWebhook({ envelope_xid: ' ENV-1 ', document_list: [{ documentId: 'DOC-1' }, { documentId: '' }] })).toEqual({
      envelopeXid: 'ENV-1',
      documentIds: ['DOC-1'],
    });
    expect(parseEnvelopeWebhook({ document_list: [] })).toBeNull();
    expect(parseEnvelopeWebhook('x')).toBeNull();
    expect(webhookTokenMatches('token-abc', 'token-abc')).toBe(true);
    expect(webhookTokenMatches('token-abc', 'token-ab')).toBe(false);
    expect(webhookTokenMatches('token-abc', 'token-abd')).toBe(false);
    expect(webhookTokenMatches('token-abc', null)).toBe(false);
  });
});

describe('契約書テンプレートの差し込み項目', () => {
  it('承諾済み見積のスナップショットをそのまま渡す（再計算しない）', () => {
    const items = contractInsetItems({
      quote_no: 'Q202610-0001',
      customer_name: '顧客 太郎',
      customer_company: null,
      base_model_name: 'Wing',
      subtotal: 4500000,
      tax: 450000,
      total: 4950000,
      issued_at: '2026-10-12T16:00:00.000Z',
    });
    expect(items.map((item) => item.name)).toEqual([...CONTRACT_INSET_ITEM_NAMES]);
    expect(Object.fromEntries(items.map((item) => [item.name, item.value]))).toMatchObject({
      見積番号: 'Q202610-0001',
      会社名: '',
      '契約金額（税込）': '4,950,000円',
      税抜金額: '4,500,000円',
      消費税: '450,000円',
      見積発行日: '2026年10月13日',
    });
  });
});

describe('電子契約：migration', () => {
  const beginBody = migration.slice(migration.indexOf('create function public.begin_electronic_contract('), migration.indexOf('create function public.record_electronic_contract_sent('));

  it('権限（本部だけ）を状態の判定より前に確認し、承諾済みの現在の版だけ・二重送信なしで開始する', () => {
    expect(beginBody.indexOf("raise exception 'FORBIDDEN")).toBeGreaterThan(0);
    expect(beginBody.indexOf("raise exception 'FORBIDDEN")).toBeLessThan(beginBody.indexOf("raise exception 'LOCKED"));
    expect(beginBody).toContain("if q.status <> 'accepted' then");
    expect(beginBody).toContain('if req.quote_id is distinct from q.id then');
    expect(migration).toContain("where status in ('sending', 'sent', 'signed');");
    expect(beginBody).toContain('values (req.id, q.id, q.user_id, v_name, v_email, q.total, v_uid, v_uid)');
  });

  it('お客様は自分の契約だけ読め、書き込みは RPC だけ。署名完了の記録は service_role だけ', () => {
    expect(migration).toContain('using (user_id = auth.uid() or public.current_role_rank() >= 3);');
    expect(migration).toContain('revoke all on public.contracts from public, anon, authenticated;');
    expect(migration).toContain('grant select on public.contracts to authenticated;');
    expect(migration).toContain('grant execute on function public.record_electronic_contract_signed(text, text, text) to service_role;');
    expect(migration).not.toMatch(/grant execute on function public\.record_electronic_contract_signed\(text, text, text\) to authenticated/);
    expect(migration).toContain("values ('contract-documents', 'contract-documents', false,");
  });

  it('見積・案件・Snapshot は変更しない（契約の状態は contracts だけが持つ）', () => {
    expect(migration).not.toMatch(/update\s+public\.(quotes|quote_requests|quote_items|configurations|configuration_snapshots)\b/i);
  });
});

describe('電子契約：送信と通知の受付の順序', () => {
  const action = read('lib/actions/contracts.ts');
  const webhook = read('app/api/webhooks/gmosign/route.ts');

  it('DB で開始してから GMOサインへ送り、失敗したら failed を記録する', () => {
    expect(action.indexOf('store.beginElectronicContract(')).toBeLessThan(action.indexOf('sendContractEnvelope(config'));
    expect(action).toContain('store.recordElectronicContractSent(actor, contractId, sent.envelopeXid, sent.documentId)');
    expect(action).toContain('store.recordElectronicContractFailed(actor, contractId, reason)');
    expect(action).toContain("const actor = await requireAdmin('/admin/quotes');");
  });

  it('通知はトークンを確かめてから読み、署名済み PDF を取得できたときだけ締結済みにする', () => {
    expect(webhook.indexOf('webhookTokenMatches(')).toBeLessThan(webhook.indexOf('await req.json()'));
    expect(webhook.indexOf('downloadSignedDocument(config')).toBeLessThan(webhook.indexOf('store.completeElectronicContract('));
    expect(webhook).toContain("{ status: 500 }");
  });
});

describe.sequential('電子契約：ローカル検証モード（SQL と同じ判定）', () => {
  let dir = '';
  const customer = { id: 'contract-customer', email: 'c@example.com', role: 'customer' as const, full_name: '顧客' };
  const other = { id: 'contract-other', email: 'o@example.com', role: 'customer' as const, full_name: '他人' };
  const admin = { id: 'contract-admin', email: 'a@example.com', role: 'admin' as const, full_name: '本部' };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-contract-'));
    process.env.WING_LOCAL_DIR = dir;
    process.env.WING_LOCAL_MODE = '1';
  });
  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    delete process.env.WING_LOCAL_MODE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function acceptedQuote() {
    const { LocalStore } = await import('@/lib/data/local-store');
    const { loadDb, saveDb } = await import('@/lib/data/local-db');
    const { buildEstimateSpecSelection } = await import('@/lib/domain/estimate-template');
    const store = new LocalStore();
    const model = (await store.listModels()).find((row) => row.slug === 'wing-01')!;
    const bundle = (await store.getCatalogBundle(model.id))!;
    const configuration = await store.saveConfiguration(customer, {
      id: null,
      name: '契約テスト',
      base_model_id: model.id,
      option_ids: buildEstimateSpecSelection(bundle, model, 'hotel'),
      preview_image_url: null,
      notes: null,
      finish_level: 'full',
      spec_code: 'hotel',
      variant_choice_ids: [],
    });
    const quote = await store.createQuoteFromConfiguration(
      customer,
      configuration.id,
      { full_name: '顧客', company_name: null, email: 'c@example.com', phone: '0', address: 'x', site_address: null },
      null,
      configuration.lock_version ?? 1
    );
    const db = loadDb();
    db.quotes.find((row) => row.id === quote.id)!.status = 'accepted';
    saveDb(db);
    return { store, quote };
  }

  it('本部だけが承諾済みの見積から送信でき、二重送信・他人の閲覧・締結後の取り消しは拒否する', async () => {
    const { store, quote } = await acceptedQuote();
    await expect(store.beginElectronicContract(customer, quote.id, '顧客', 'c@example.com')).rejects.toThrow('本部だけ');
    const id = await store.beginElectronicContract(admin, quote.id, ' 顧客 ', 'C@Example.com');
    await expect(store.beginElectronicContract(admin, quote.id, '顧客', 'c@example.com')).rejects.toThrow('送信中または締結済み');

    await store.recordElectronicContractSent(admin, id, 'ENV-LOCAL', 'DOC-LOCAL');
    expect(await store.completeElectronicContract('ENV-UNKNOWN', null, new Uint8Array([1]))).toBeNull();
    const pdf = new TextEncoder().encode('%PDF-1.4 local');
    expect(await store.completeElectronicContract('ENV-LOCAL', 'DOC-LOCAL', pdf)).toBe(id);
    expect(await store.completeElectronicContract('ENV-LOCAL', 'DOC-LOCAL', pdf)).toBe(id);

    const request = (await store.getQuote(quote.id, customer))!.request!;
    const [contract] = await store.listElectronicContracts(request.id, customer);
    expect(contract).toMatchObject({ status: 'signed', signer_name: '顧客', signer_email: 'c@example.com', contract_total: quote.total });
    expect(activeContract([contract])?.id).toBe(id);
    expect(await store.listElectronicContracts(request.id, other)).toEqual([]);
    expect(Buffer.from((await store.getSignedContractPdf(id, customer))!.bytes).toString()).toBe('%PDF-1.4 local');
    expect(await store.getSignedContractPdf(id, other)).toBeNull();
    await expect(store.cancelElectronicContract(admin, id, null)).rejects.toThrow('取り消せません');
  });

  it('送信に失敗した契約は failed になり、やり直せる', async () => {
    const { store, quote } = await acceptedQuote();
    const first = await store.beginElectronicContract(admin, quote.id, '顧客', 'c@example.com');
    await store.recordElectronicContractFailed(admin, first, 'GMOサインがエラーを返しました');
    const second = await store.beginElectronicContract(admin, quote.id, '顧客', 'c@example.com');
    expect(second).not.toBe(first);
  });
});
