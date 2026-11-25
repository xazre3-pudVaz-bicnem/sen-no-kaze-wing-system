import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 通知メールの送信（lib/mail/send.ts）。2026-11-25：Resend のチームは千の風様の既存の送信と共用するため、
 * 返信先を付け、間をあけて送り、上限（429）で止め、同じ通知を二重に送らない。
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/data/store', () => ({ isLocalMode: () => false }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }));

import { DEFAULT_MAX_PER_HOUR, MAIL_QUOTA_EXCEEDED, SEND_INTERVAL_MS, flushNotifications, hourlyLimitMessage, mailMaxPerHour, mailReplyTo } from '@/lib/mail/send';

interface Pending {
  id: string;
  recipient_id: string | null;
  title: string;
  body: string | null;
  link: string | null;
}

const n1: Pending = { id: 'n1', recipient_id: null, title: '見積依頼が届きました', body: '山田様から見積依頼です。', link: '/admin/quotes/q1' };
const n2: Pending = { id: 'n2', recipient_id: 'u1', title: '見積書を発行しました', body: null, link: '/mypage/quotes/q1' };

/** notifications と profiles だけを持つ、送信の試験用の DB */
function fakeAdmin(pending: Pending[], sentLastHour: number | null = 0) {
  const updates: { id: string; values: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      if (table === 'notifications') {
        return {
          select: (_columns: string, options?: { head?: boolean }) =>
            options?.head
              ? {
                  // この 1 時間に送った数（null なら数えられなかった）
                  eq: () => ({
                    gte: async () => (sentLastHour === null ? { count: null, error: { message: 'boom' } } : { count: sentLastHour, error: null }),
                  }),
                }
              : { eq: () => ({ order: () => ({ limit: async () => ({ data: pending, error: null }) }) }) },
          update: (values: Record<string, unknown>) => ({
            eq: async (_column: string, id: string) => {
              updates.push({ id, values });
              return { error: null };
            },
          }),
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

describe('通知メールの送り方', () => {
  it('返信先と二重送信の防止のキーを付けて送り、送信済みにする。間は 2 通目の前だけあける', async () => {
    const updates = fakeAdmin([n1, n2]);
    fetchMock.mockImplementation(always(200, { id: 'email-1' }));
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 2, skipped: 0, failed: 0, deferred: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(sentHeaders(0)['Idempotency-Key']).toBe('wing-notification-n1');
    expect(sentHeaders(1)['Idempotency-Key']).toBe('wing-notification-n2');
    expect(sentBody(0)).toEqual({
      from: '千の風 <no-reply@example.com>',
      to: ['hq@example.com'],
      subject: '[Wing] 見積依頼が届きました',
      text: '山田様から見積依頼です。\n\n▼ こちらから開けます\nhttps://www.sen-no-kaze.com/admin/quotes/q1',
      reply_to: 'info@example.com',
    });
    expect(sentBody(1).to).toEqual(['customer@example.com']);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(SEND_INTERVAL_MS);
    expect(updates).toEqual([
      { id: 'n1', values: { email_status: 'sent', email_error: null } },
      { id: 'n2', values: { email_status: 'sent', email_error: null } },
    ]);
  });

  it('返信先はアドレスだけを読む。無い・形が違うときは付けない（形が違えば記録に残す）。複数なら配列で送る', async () => {
    expect(mailReplyTo()).toEqual(['info@example.com']);
    process.env.MAIL_REPLY_TO = ' a@example.com , b@example.com ';
    expect(mailReplyTo()).toEqual(['a@example.com', 'b@example.com']);
    fakeAdmin([n1]);
    fetchMock.mockImplementation(always(200));
    await flushNotifications(20, { wait, intervalMs: 0 });
    expect(sentBody(0).reply_to).toEqual(['a@example.com', 'b@example.com']);

    delete process.env.MAIL_REPLY_TO;
    await flushNotifications(20, { wait, intervalMs: 0 });
    expect(sentBody(1)).not.toHaveProperty('reply_to');

    process.env.MAIL_REPLY_TO = '千の風 <info@example.com>';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await flushNotifications(20, { wait, intervalMs: 0 });
    expect(sentBody(2)).not.toHaveProperty('reply_to');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MAIL_REPLY_TO'));
  });

  it('速さの上限（429）は、指示の秒数を待って同じキーで 1 回だけ送り直す', async () => {
    const updates = fakeAdmin([n1]);
    fetchMock
      .mockResolvedValueOnce(reply(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '1' }))
      .mockResolvedValueOnce(reply(200));
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 1, skipped: 0, failed: 0, deferred: 0 });
    expect(wait).toHaveBeenCalledWith(1000);
    expect(sentHeaders(1)['Idempotency-Key']).toBe('wing-notification-n1');
    expect(updates).toEqual([{ id: 'n1', values: { email_status: 'sent', email_error: null } }]);
  });

  it('速さの上限が続く・待ち時間が長いときは、送信待ちのまま残し、その回はそこで止める', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let updates = fakeAdmin([n1, n2]);
    fetchMock.mockImplementation(always(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '1' }));
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 0, skipped: 0, failed: 0, deferred: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // n1 を 2 回。n2 は送らない
    expect(updates).toEqual([]);

    fetchMock.mockReset();
    wait.mockClear();
    updates = fakeAdmin([n1, n2]);
    fetchMock.mockImplementation(always(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '30' }));
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 0, skipped: 0, failed: 0, deferred: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('送信数の上限（429。1 日・1 か月）は失敗として残し、その回はそこで止める（上限が戻った瞬間にまとめて送らない）', async () => {
    for (const name of ['daily_quota_exceeded', 'monthly_quota_exceeded']) {
      fetchMock.mockReset();
      const updates = fakeAdmin([n1, n2]);
      fetchMock.mockImplementation(always(429, { name }));
      await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 0, skipped: 0, failed: 1, deferred: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(updates).toEqual([{ id: 'n1', values: { email_status: 'failed', email_error: MAIL_QUOTA_EXCEEDED } }]);
    }
  });

  it('同じ通知を別の処理が送っている最中（409）は触らずに次へ。同じキーで内容が違う（409）は送信済み', async () => {
    let updates = fakeAdmin([n1, n2]);
    fetchMock.mockResolvedValueOnce(reply(409, { name: 'concurrent_idempotent_requests' })).mockResolvedValueOnce(reply(200));
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 1, skipped: 0, failed: 0, deferred: 1 });
    expect(updates).toEqual([{ id: 'n2', values: { email_status: 'sent', email_error: null } }]);

    fetchMock.mockReset();
    updates = fakeAdmin([n1]);
    fetchMock.mockResolvedValueOnce(reply(409, { name: 'invalid_idempotent_request' }));
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 1, skipped: 0, failed: 0, deferred: 0 });
    expect(updates).toEqual([{ id: 'n1', values: { email_status: 'sent', email_error: null } }]);
  });

  it('通信の失敗・Resend の障害（5xx）は、送信待ちのまま次の回へ回す', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let updates = fakeAdmin([n1, n2]);
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 0, skipped: 0, failed: 0, deferred: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);

    fetchMock.mockReset();
    updates = fakeAdmin([n1, n2]);
    fetchMock.mockImplementation(always(503, { name: 'internal_server_error' }));
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 0, skipped: 0, failed: 0, deferred: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);
  });

  it('キー・差出人の誤りなど（4xx）は失敗として理由を残し、次の通知へ進む', async () => {
    const updates = fakeAdmin([n1, n2]);
    fetchMock
      .mockResolvedValueOnce(reply(422, { name: 'validation_error', message: 'Invalid `from` field.' }))
      .mockResolvedValueOnce(reply(200));
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 1, skipped: 0, failed: 1, deferred: 0 });
    expect(updates[0].id).toBe('n1');
    expect(updates[0].values.email_status).toBe('failed');
    expect(String(updates[0].values.email_error)).toContain('422');
    expect(String(updates[0].values.email_error)).toContain('validation_error');
    expect(updates[1]).toEqual({ id: 'n2', values: { email_status: 'sent', email_error: null } });
  });

  it('1 時間に送る通知の数に上限を置く（既定 30）。超えた分はメールを送らず、理由を残す（共用の送信数を使い切らない）', async () => {
    expect(mailMaxPerHour()).toBe(DEFAULT_MAX_PER_HOUR);
    process.env.MAIL_MAX_PER_HOUR = '0';
    expect(mailMaxPerHour()).toBe(DEFAULT_MAX_PER_HOUR);
    process.env.MAIL_MAX_PER_HOUR = 'abc';
    expect(mailMaxPerHour()).toBe(DEFAULT_MAX_PER_HOUR);
    process.env.MAIL_MAX_PER_HOUR = '5';
    expect(mailMaxPerHour()).toBe(5);

    // この 1 時間に 4 件送っている：あと 1 件だけ送り、残りは送らない
    let updates = fakeAdmin([n1, n2], 4);
    fetchMock.mockImplementation(always(200));
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 1, skipped: 1, failed: 0, deferred: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([
      { id: 'n1', values: { email_status: 'sent', email_error: null } },
      { id: 'n2', values: { email_status: 'skipped', email_error: hourlyLimitMessage(5) } },
    ]);

    // 上限に達している：1 件も送らない
    fetchMock.mockClear();
    updates = fakeAdmin([n1], 5);
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 0, skipped: 1, failed: 0, deferred: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toEqual([{ id: 'n1', values: { email_status: 'skipped', email_error: hourlyLimitMessage(5) } }]);

    // 数えられないときは、送信待ちのまま次の回へ（送りも捨てもしない）
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    updates = fakeAdmin([n1], null);
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 0, skipped: 0, failed: 0, deferred: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('キーか差出人が無ければ送らず、今までどおり skipped にする（送信の外部通信もしない）', async () => {
    delete process.env.RESEND_API_KEY;
    const updates = fakeAdmin([n1]);
    await expect(flushNotifications(20, { wait })).resolves.toEqual({ sent: 0, skipped: 1, failed: 0, deferred: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates).toEqual([{ id: 'n1', values: { email_status: 'skipped', email_error: 'メール送信が未設定です' } }]);
  });
});
