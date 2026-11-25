import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 通知メールの送信（lib/mail/send.ts）。2026-11-25：Resend のチームは千の風様の既存の送信と共用するため、
 * 返信先を付け、間をあけて送り、上限（429）で止め、同じ通知を二重に送らず、古い通知を送らず、
 * 誰でも送れるお問い合わせの通知は 1 時間の数に上限を置く。状態は送信待ちの行だけを変える。
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/data/store', () => ({ isLocalMode: () => false }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));

import {
  DEFAULT_MAX_PER_HOUR,
  MAIL_QUOTA_EXCEEDED,
  MAIL_STALE,
  SEND_INTERVAL_MS,
  flushNotifications,
  hourlyLimitMessage,
  idempotencyKey,
  mailMaxPerHour,
  mailReplyTo,
} from '@/lib/mail/send';

interface Pending {
  id: string;
  recipient_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
}

const NOW = Date.parse('2026-11-25T05:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60 * 1000).toISOString();

const n1: Pending = {
  id: 'n1',
  recipient_id: null,
  kind: 'quote_requested',
  title: '見積依頼が届きました',
  body: '山田様から見積依頼です。',
  link: '/admin/quotes/q1',
  created_at: minutesAgo(1),
};
const n2: Pending = { id: 'n2', recipient_id: 'u1', kind: 'quote_revised', title: '見積書を発行しました', body: null, link: '/mypage/quotes/q1', created_at: minutesAgo(1) };
const contact = (id: string): Pending => ({
  id,
  recipient_id: null,
  kind: 'contact_received',
  title: '新しいお問い合わせ：その他',
  body: '山田 太郎 様（taro@example.com）',
  link: '/admin/contacts',
  created_at: minutesAgo(1),
});

type Filters = Record<string, unknown>;

/** 直近の fakeAdmin で行われた「件数だけ数える」問い合わせの条件 */
let counts: Filters[] = [];

/**
 * notifications と profiles だけを持つ、送信の試験用の DB。
 * 状態の更新は「送信待ちの行だけ」の条件（email_status = pending）が付いているときだけ、そのまま記録する
 * （付いていなければ unguarded の印を付けて記録し、試験で落とす）
 */
function fakeAdmin(pending: Pending[], sentLastHour: number | null = 0) {
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  counts = [];
  const client = {
    from(table: string) {
      if (table === 'notifications') {
        return {
          select: (_columns: string, options?: { head?: boolean }) => {
            const filters: Filters = {};
            const builder = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return builder;
              },
              gte(column: string, value: unknown) {
                filters[`${column}>=`] = value;
                return builder;
              },
              order() {
                return builder;
              },
              limit: async () => ({ data: pending, error: null }),
              // 件数だけを数える問い合わせ（head）は、await で結果を返す
              then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                if (!options?.head) throw new Error('unexpected await on select');
                counts.push(filters);
                const r = sentLastHour === null ? { count: null, error: { message: 'boom' } } : { count: sentLastHour, error: null };
                return Promise.resolve(r).then(resolve, reject);
              },
            };
            return builder;
          },
          update: (values: Record<string, unknown>) => {
            const filters: Filters = {};
            const builder = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return builder;
              },
              then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                updates.push({ id: String(filters.id), values: filters.email_status === 'pending' ? values : { ...values, unguarded: true } });
                return Promise.resolve({ error: null }).then(resolve, reject);
              },
            };
            return builder;
          },
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: async () => ({ data: [{ email: 'hq@example.com' }], error: null }),
            in: async () => ({ data: [{ id: 'u1', email: 'customer@example.com' }], error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  mocks.createAdminClient.mockReturnValue(client);
  return updates;
}

function reply(status: number, body: object = {}, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** 毎回あたらしい応答を返す（応答の本文は 1 回しか読めないため） */
const always = (status: number, body: object = {}, headers: Record<string, string> = {}) => async () => reply(status, body, headers);

const fetchMock = vi.fn();
const wait = vi.fn(async (ms: number) => {
  void ms;
});
const now = () => NOW;
const opts = { wait, now };
const ENV_KEYS = ['RESEND_API_KEY', 'MAIL_FROM', 'MAIL_REPLY_TO', 'MAIL_MAX_PER_HOUR', 'NEXT_PUBLIC_SITE_URL'] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.RESEND_API_KEY = 'test-key';
  process.env.MAIL_FROM = '千の風 <no-reply@example.com>';
  process.env.MAIL_REPLY_TO = 'info@example.com';
  delete process.env.MAIL_MAX_PER_HOUR;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.sen-no-kaze.com';
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

const sentBody = (call: number) => JSON.parse(String((fetchMock.mock.calls[call][1] as RequestInit).body)) as Record<string, unknown>;
const sentHeaders = (call: number) => (fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>;
const sent = (id: string) => ({ id, values: { email_status: 'sent', email_error: null } });

describe('通知メールの送り方', () => {
  it('返信先と二重送信の防止のキーを付けて送り、送信済みにする。間は 2 通目の前だけあける', async () => {
    const updates = fakeAdmin([n1, n2]);
    fetchMock.mockImplementation(always(200, { id: 'email-1' }));
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 2, skipped: 0, failed: 0, deferred: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(sentBody(0)).toEqual({
      from: '千の風 <no-reply@example.com>',
      to: ['hq@example.com'],
      subject: '[Wing] 見積依頼が届きました',
      text: '山田様から見積依頼です。\n\n▼ こちらから開けます\nhttps://www.sen-no-kaze.com/admin/quotes/q1',
      reply_to: 'info@example.com',
    });
    expect(sentBody(1).to).toEqual(['customer@example.com']);
    expect(sentHeaders(0)['Idempotency-Key']).toMatch(/^wing-notification-n1-[0-9a-f]{16}$/);
    expect(sentHeaders(1)['Idempotency-Key']).toMatch(/^wing-notification-n2-[0-9a-f]{16}$/);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(SEND_INTERVAL_MS);
    expect(updates).toEqual([sent('n1'), sent('n2')]);
  });

  it('二重送信の防止のキー：中身が同じなら同じ、宛先などが変われば別（「同じキーで中身が違う」で送れなくならない）', () => {
    const payload = { from: 'a <a@example.com>', to: ['hq@example.com'], subject: 's', text: 't' };
    expect(idempotencyKey('n1', payload)).toBe(idempotencyKey('n1', { ...payload }));
    expect(idempotencyKey('n1', payload)).not.toBe(idempotencyKey('n1', { ...payload, to: ['hq@example.com', 'hq2@example.com'] }));
    expect(idempotencyKey('n1', payload)).not.toBe(idempotencyKey('n2', payload));
    expect(idempotencyKey('n1', payload).length).toBeLessThanOrEqual(256);
  });

  it('返信先はアドレスだけを読む。無い・形が違うときは付けない（形が違えば記録に残す）。複数なら配列で送る', async () => {
    expect(mailReplyTo()).toEqual(['info@example.com']);
    process.env.MAIL_REPLY_TO = ' a@example.com , b@example.com ';
    expect(mailReplyTo()).toEqual(['a@example.com', 'b@example.com']);
    fakeAdmin([n1]);
    fetchMock.mockImplementation(always(200));
    await flushNotifications(20, { ...opts, intervalMs: 0 });
    expect(sentBody(0).reply_to).toEqual(['a@example.com', 'b@example.com']);

    delete process.env.MAIL_REPLY_TO;
    await flushNotifications(20, { ...opts, intervalMs: 0 });
    expect(sentBody(1)).not.toHaveProperty('reply_to');

    process.env.MAIL_REPLY_TO = '千の風 <info@example.com>';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await flushNotifications(20, { ...opts, intervalMs: 0 });
    expect(sentBody(2)).not.toHaveProperty('reply_to');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MAIL_REPLY_TO'));
  });

  it('速さの上限（429）は、指示の秒数を待って同じキーで 1 回だけ送り直す', async () => {
    const updates = fakeAdmin([n1]);
    fetchMock
      .mockResolvedValueOnce(reply(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '1' }))
      .mockResolvedValueOnce(reply(200));
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 1, skipped: 0, failed: 0, deferred: 0 });
    expect(wait).toHaveBeenCalledWith(1000);
    expect(sentHeaders(1)['Idempotency-Key']).toBe(sentHeaders(0)['Idempotency-Key']);
    expect(updates).toEqual([sent('n1')]);
  });

  it('速さの上限が続く・待ち時間が長いときは、送信待ちのまま残し、その回はそこで止める', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let updates = fakeAdmin([n1, n2]);
    fetchMock.mockImplementation(always(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '1' }));
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 0, skipped: 0, failed: 0, deferred: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // n1 を 2 回。n2 は送らない
    expect(updates).toEqual([]);

    fetchMock.mockReset();
    wait.mockClear();
    updates = fakeAdmin([n1, n2]);
    fetchMock.mockImplementation(always(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '30' }));
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 0, skipped: 0, failed: 0, deferred: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('送信数の上限（429。1 日・1 か月）は失敗として残し、その回はそこで止める（上限が戻った瞬間にまとめて送らない）', async () => {
    for (const name of ['daily_quota_exceeded', 'monthly_quota_exceeded']) {
      fetchMock.mockReset();
      const updates = fakeAdmin([n1, n2]);
      fetchMock.mockImplementation(always(429, { name }));
      await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 0, skipped: 0, failed: 1, deferred: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(updates).toEqual([{ id: 'n1', values: { email_status: 'failed', email_error: MAIL_QUOTA_EXCEEDED } }]);
    }
  });

  it('同じ通知を別の処理が送っている最中（409）は触らずに次へ。同じキーで中身が違う（409）は失敗として残す（送信済みにはしない）', async () => {
    let updates = fakeAdmin([n1, n2]);
    fetchMock.mockResolvedValueOnce(reply(409, { name: 'concurrent_idempotent_requests' })).mockResolvedValueOnce(reply(200));
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 1, skipped: 0, failed: 0, deferred: 1 });
    expect(updates).toEqual([sent('n2')]);

    fetchMock.mockReset();
    updates = fakeAdmin([n1]);
    fetchMock.mockResolvedValueOnce(reply(409, { name: 'invalid_idempotent_request' }));
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 0, skipped: 0, failed: 1, deferred: 0 });
    expect(updates[0].values.email_status).toBe('failed');
  });

  it('通信の失敗・Resend の障害（5xx）は、送信待ちのまま次の回へ回す', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let updates = fakeAdmin([n1, n2]);
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 0, skipped: 0, failed: 0, deferred: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);

    fetchMock.mockReset();
    updates = fakeAdmin([n1, n2]);
    fetchMock.mockImplementation(always(503, { name: 'internal_server_error' }));
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 0, skipped: 0, failed: 0, deferred: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);
  });

  it('内容の誤り（422）は失敗として理由を残して次へ。キーの誤り・送れないドメイン（401・403）はその回を止める', async () => {
    let updates = fakeAdmin([n1, n2]);
    fetchMock
      .mockResolvedValueOnce(reply(422, { name: 'validation_error', message: 'Invalid to field.' }))
      .mockResolvedValueOnce(reply(200));
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 1, skipped: 0, failed: 1, deferred: 0 });
    expect(updates[0].id).toBe('n1');
    expect(updates[0].values.email_status).toBe('failed');
    expect(String(updates[0].values.email_error)).toContain('422');
    expect(String(updates[0].values.email_error)).toContain('validation_error');
    expect(updates[1]).toEqual(sent('n2'));

    for (const status of [401, 403]) {
      fetchMock.mockReset();
      updates = fakeAdmin([n1, n2]);
      fetchMock.mockImplementation(always(status, { name: status === 401 ? 'missing_api_key' : 'invalid_from_address' }));
      await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 0, skipped: 0, failed: 1, deferred: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(updates.map((u) => u.id)).toEqual(['n1']);
    }
  });

  it('作成から 23 時間を過ぎた通知は送らない（古い通知を送らない・24 時間でキーが消えた後に二重に送らない）', async () => {
    const old = { ...n1, id: 'old', created_at: minutesAgo(23 * 60 + 1) };
    const updates = fakeAdmin([old, n2]);
    fetchMock.mockImplementation(always(200));
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 1, skipped: 1, failed: 0, deferred: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(0).to).toEqual(['customer@example.com']);
    expect(updates).toEqual([{ id: 'old', values: { email_status: 'skipped', email_error: MAIL_STALE } }, sent('n2')]);
  });

  it('お問い合わせの通知だけ、1 時間に送る数に上限を置く（既定 30）。超えた分は送らずに理由を残す。ほかの通知は止めない', async () => {
    expect(mailMaxPerHour()).toBe(DEFAULT_MAX_PER_HOUR);
    for (const value of ['0', '-1', 'abc', '1.5']) {
      process.env.MAIL_MAX_PER_HOUR = value;
      expect(mailMaxPerHour()).toBe(DEFAULT_MAX_PER_HOUR);
    }
    process.env.MAIL_MAX_PER_HOUR = '5';
    expect(mailMaxPerHour()).toBe(5);

    // この 1 時間に 4 件送っている：お問い合わせはあと 1 件だけ。見積の通知は上限と関係なく送る
    let updates = fakeAdmin([contact('c1'), n1, contact('c2')], 4);
    fetchMock.mockImplementation(always(200));
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 2, skipped: 1, failed: 0, deferred: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(updates).toEqual([sent('c1'), sent('n1'), { id: 'c2', values: { email_status: 'skipped', email_error: hourlyLimitMessage(5) } }]);
    // 数えるのは、この 1 時間に作られて送信済みになったお問い合わせ
    expect(counts).toEqual([
      { kind: 'contact_received', email_status: 'sent', 'created_at>=': new Date(NOW - 60 * 60 * 1000).toISOString() },
    ]);

    // 上限に達している：お問い合わせは送らない
    fetchMock.mockClear();
    updates = fakeAdmin([contact('c3'), n2], 5);
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 1, skipped: 1, failed: 0, deferred: 0 });
    expect(updates).toEqual([{ id: 'c3', values: { email_status: 'skipped', email_error: hourlyLimitMessage(5) } }, sent('n2')]);

    // 数えられないときは、お問い合わせだけ送信待ちのまま次の回へ（送りも捨てもしない）。ほかは送る
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockClear();
    updates = fakeAdmin([contact('c4'), n1], null);
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 1, skipped: 0, failed: 0, deferred: 1 });
    expect(updates).toEqual([sent('n1')]);

    // お問い合わせが無ければ数えない
    updates = fakeAdmin([n1], 99);
    await flushNotifications(20, opts);
    expect(counts).toEqual([]);
  });

  it('キーか差出人が無ければ送らず、今までどおり skipped にする（送信の外部通信も、数の問い合わせもしない）', async () => {
    delete process.env.RESEND_API_KEY;
    const updates = fakeAdmin([n1, contact('c1')]);
    await expect(flushNotifications(20, opts)).resolves.toEqual({ sent: 0, skipped: 2, failed: 0, deferred: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(counts).toEqual([]);
    expect(updates).toEqual([
      { id: 'n1', values: { email_status: 'skipped', email_error: 'メール送信が未設定です' } },
      { id: 'c1', values: { email_status: 'skipped', email_error: 'メール送信が未設定です' } },
    ]);
  });
});
