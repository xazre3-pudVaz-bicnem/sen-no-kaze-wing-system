import 'server-only';
import { createHash } from 'node:crypto';
import { isLocalMode } from '@/lib/data/store';
import { getSiteUrl } from '@/lib/site';

/**
 * 通知メールの送信。
 *
 * 通知そのものは DB（notifications）に必ず残るので、メール設定がなくても運用は止まらない。
 * RESEND_API_KEY と MAIL_FROM が設定されているときだけ実際に送り、
 * 未設定なら email_status='skipped' として画面通知だけを残す。
 * MAIL_REPLY_TO があれば返信先に付ける（アドレスだけをカンマ区切りで。複数可）。
 *
 * 送信は「通知が作られた直後のアクション」から呼ぶ。失敗しても本処理は成功扱いにする
 * （見積の発行がメール障害で巻き戻ると困るため）。
 *
 * Resend のチームは、千の風様の既存の送信と共用する（2026-11-25 の方針。既存の送信に影響を出さない）。
 * - API の速さの上限はチーム全体で共有なので、1 通ずつ間をあけて送る
 * - 上限（429）に当たったら、その回はそこで止める。速さの上限なら送信待ちのまま次の回へ回し、
 *   送信数の上限（1 日・1 か月）なら失敗として残す（上限が戻った瞬間にまとめて送らない）
 * - 同じ通知を二重に送らない。Idempotency-Key に通知の ID と中身の要約を使うので、同時に 2 か所から送っても、
 *   届いたか分からないまま送り直しても、Resend が 1 通にまとめる（キーは 24 時間有効）。
 *   24 時間を過ぎて送り直すと二重になりうるので、作成から 23 時間を過ぎた通知は送らない（古い通知を送らない決まりも兼ねる）
 * - 誰でも送れるお問い合わせの通知は、1 時間に送る数に上限を置く（MAIL_MAX_PER_HOUR。既定 30）。
 *   いたずらの連続送信で共用の送信数を使い切らないため。超えた分はメールを送らず、画面のお知らせにだけ残す。
 *   数はこの 1 時間に作られて送信済みになったお問い合わせの数で数える目安（同時の送信では少し超えることがある）
 * - 状態は送信待ちの行だけを変える（同時に動いた別の処理が決めた状態を上書きしない）
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
/** 送信と送信の間の待ち時間（ミリ秒）。チームで共有の API の上限のうち、一部しか使わない */
export const SEND_INTERVAL_MS = 250;
/** 速さの上限に当たったとき、その場で待って送り直す最長の時間（ミリ秒）。これより長ければ次の回へ回す */
const MAX_RETRY_WAIT_MS = 2_000;
/** 1 通の送信を待つ最長の時間（ミリ秒）。アクションの応答を長く止めない */
const REQUEST_TIMEOUT_MS = 10_000;
/** これより前に作られた通知は送らない（Resend の Idempotency-Key は 24 時間で消えるため、その少し手前） */
export const STALE_AFTER_MS = 23 * 60 * 60 * 1000;
/** 1 時間の上限をかける通知の種類（誰でも送れるお問い合わせ） */
export const PUBLIC_NOTIFICATION_KIND = 'contact_received';
/** 1 時間に送るお問い合わせの通知の数の既定の上限 */
export const DEFAULT_MAX_PER_HOUR = 30;

export const MAIL_QUOTA_EXCEEDED = 'Resend の送信数の上限（1 日または 1 か月）に達したため、送れませんでした';
export const MAIL_STALE = '作成から 23 時間を過ぎた通知のため、メールは送りませんでした（古い通知を送らない・二重に送らないため）';
const EMAIL_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

/** 返信先（MAIL_REPLY_TO）。形の正しいアドレスだけを使い、1 つも無ければ付けない */
export function mailReplyTo(): string[] {
  return (process.env.MAIL_REPLY_TO ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => EMAIL_PATTERN.test(v));
}

/** 1 時間に送るお問い合わせの通知の数の上限（MAIL_MAX_PER_HOUR。正の整数でなければ既定の 30） */
export function mailMaxPerHour(): number {
  const value = Number(process.env.MAIL_MAX_PER_HOUR);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_PER_HOUR;
}

/** 上限を超えたため送らなかった通知に残す理由 */
export function hourlyLimitMessage(max: number): string {
  return `1 時間に送るお問い合わせのメールの上限（${max} 件）を超えたため、メールは送りませんでした（お知らせの画面で確認してください）`;
}

interface Pending {
  id: string;
  recipient_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
}

export interface MailPayload {
  from: string | undefined;
  to: string[];
  subject: string;
  text: string;
  reply_to?: string | string[];
}

/** 1 通の送信の結果 */
type SendOutcome =
  | { kind: 'sent' }
  /** 同じ通知を別の処理が送っている最中（その処理が送信済みにする） */
  | { kind: 'in_progress' }
  /** 一時的に送れない。送信待ちのまま次の回へ回し、この回はここで止める */
  | { kind: 'retry_later'; reason: string }
  /** 送れなかった（失敗として残す）。stop なら、この回はここで止める */
  | { kind: 'failed'; reason: string; stop: boolean };

export interface FlushOptions {
  /** 送信と送信の間の待ち時間（試験では 0） */
  intervalMs?: number;
  /** 待つ処理（試験で差し替える） */
  wait?: (ms: number) => Promise<void>;
  /** 今の時刻（試験で差し替える） */
  now?: () => number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 二重送信を防ぐキー。通知の ID に中身（宛先・差出人・返信先・本文）の要約を足す。
 * 中身が同じなら同じキー（同時の送信・送り直しは 1 通になる）。宛先などが変わった後の送り直しは別のキーになり、
 * 「同じキーで中身が違う」で送れなくなることがない
 */
export function idempotencyKey(id: string, payload: MailPayload): string {
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  return `wing-notification-${id}-${digest}`;
}

/** Resend のエラーの種類（応答の JSON の name）。読めなければ null */
function resendErrorName(body: string): string | null {
  try {
    const name = (JSON.parse(body) as { name?: unknown }).name;
    return typeof name === 'string' && /^[a-z_]{1,64}$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

/** retry-after（秒）をミリ秒にする。無い・読めないときは 1 秒 */
function retryAfterMs(value: string | null): number {
  const seconds = value === null || value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : 1_000;
}

async function sendOne(key: string, payload: MailPayload, wait: (ms: number) => Promise<void>): Promise<SendOutcome> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // 通信の失敗・時間切れ。届いたか分からないので、送信待ちのまま次の回へ回す（同じキーなので二重には届かない）
      return { kind: 'retry_later', reason: 'network' };
    }
    if (res.ok) return { kind: 'sent' };
    const text = await res.text().catch(() => '');
    const name = resendErrorName(text);
    if (res.status === 429) {
      if (name === 'daily_quota_exceeded' || name === 'monthly_quota_exceeded') {
        return { kind: 'failed', reason: MAIL_QUOTA_EXCEEDED, stop: true };
      }
      const waitMs = retryAfterMs(res.headers.get('retry-after'));
      if (attempt === 0 && waitMs <= MAX_RETRY_WAIT_MS) {
        await wait(waitMs);
        continue;
      }
      return { kind: 'retry_later', reason: 'rate_limit' };
    }
    if (res.status === 409 && name === 'concurrent_idempotent_requests') return { kind: 'in_progress' };
    if (res.status >= 500) return { kind: 'retry_later', reason: `status_${res.status}` };
    // キーの誤り・送れないドメインなどは、どの通知でも同じ結果になるので、その回はそこで止める（共用の上限を無駄に使わない）
    const stop = res.status === 401 || res.status === 403;
    return { kind: 'failed', reason: `${res.status} ${text.slice(0, 200)}`, stop };
  }
}

async function loadAdminClient() {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    return createAdminClient();
  } catch {
    return null;
  }
}

/**
 * 未送信の通知をまとめて処理する。
 * ローカル検証モードでは送信しない（E2E で外部通信を発生させないため）。
 */
export async function flushNotifications(
  limit = 20,
  options: FlushOptions = {}
): Promise<{ sent: number; skipped: number; failed: number; deferred: number }> {
  const result = { sent: 0, skipped: 0, failed: 0, deferred: 0 };
  if (isLocalMode()) return result;

  const admin = await loadAdminClient();
  if (!admin) return result; // service role キー未設定（デモモード等）

  const { data, error } = await admin
    .from('notifications')
    .select('id, recipient_id, kind, title, body, link, created_at')
    .eq('email_status', 'pending')
    .order('created_at')
    .limit(limit);
  if (error || !data?.length) return result;
  const rows = data as Pending[];

  /** 送信待ちの行だけ、状態を変える（同時に動いた別の処理が決めた状態を上書きしない） */
  const settle = (id: string, values: { email_status: 'sent' | 'skipped' | 'failed'; email_error: string | null }) =>
    admin.from('notifications').update(values).eq('id', id).eq('email_status', 'pending');

  // 宛先を解決する。recipient_id が null の通知は本部（管理者全員）宛
  const [{ data: admins }, { data: people }] = await Promise.all([
    admin.from('profiles').select('email').eq('role_code', 'admin'),
    admin
      .from('profiles')
      .select('id, email')
      .in('id', rows.map((n) => n.recipient_id).filter((v): v is string => Boolean(v))),
  ]);
  const adminEmails = ((admins ?? []) as { email: string }[]).map((p) => p.email).filter(Boolean);
  const emailById = new Map(((people ?? []) as { id: string; email: string }[]).map((p) => [p.id, p.email]));
  const base = getSiteUrl();
  const wait = options.wait ?? sleep;
  const now = (options.now ?? Date.now)();
  const intervalMs = options.intervalMs ?? SEND_INTERVAL_MS;
  const replyTo = mailReplyTo();
  if (process.env.MAIL_REPLY_TO?.trim() && replyTo.length === 0) {
    console.warn('[mail] MAIL_REPLY_TO の形が正しくないため、返信先を付けずに送ります（アドレスだけをカンマ区切りで書く）');
  }

  // お問い合わせの通知の、この 1 時間の残り（数えられなければ、お問い合わせの通知だけ送信待ちのまま次の回へ）
  const maxPerHour = mailMaxPerHour();
  let publicBudget = maxPerHour;
  let publicDeferred = false;
  if (mailConfigured() && rows.some((n) => n.kind === PUBLIC_NOTIFICATION_KIND)) {
    const { count, error: countError } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('kind', PUBLIC_NOTIFICATION_KIND)
      .eq('email_status', 'sent')
      .gte('created_at', new Date(now - 60 * 60 * 1000).toISOString());
    if (countError) {
      console.warn('[mail] この 1 時間のお問い合わせのメールの数を数えられなかったため、次の回へ回しました');
      publicDeferred = true;
    } else {
      publicBudget = Math.max(0, maxPerHour - (count ?? 0));
    }
  }
  let sentBefore = false;

  for (const n of rows) {
    const to = n.recipient_id ? [emailById.get(n.recipient_id)].filter((v): v is string => Boolean(v)) : adminEmails;
    if (!mailConfigured() || to.length === 0) {
      await settle(n.id, { email_status: 'skipped', email_error: mailConfigured() ? '宛先が解決できませんでした' : 'メール送信が未設定です' });
      result.skipped++;
      continue;
    }
    const createdAt = Date.parse(n.created_at);
    if (Number.isFinite(createdAt) && now - createdAt > STALE_AFTER_MS) {
      await settle(n.id, { email_status: 'skipped', email_error: MAIL_STALE });
      result.skipped++;
      continue;
    }
    if (n.kind === PUBLIC_NOTIFICATION_KIND) {
      if (publicDeferred) {
        result.deferred++;
        continue;
      }
      if (publicBudget <= 0) {
        await settle(n.id, { email_status: 'skipped', email_error: hourlyLimitMessage(maxPerHour) });
        result.skipped++;
        continue;
      }
      publicBudget--;
    }
    // 用件 → 操作リンク の順に置く。メールから 1 回で作業画面へ入れるようにする
    const lines = [n.body ?? '', n.link ? `▼ こちらから開けます
${base}${n.link}` : ''].filter(Boolean);
    const payload: MailPayload = {
      from: process.env.MAIL_FROM,
      to,
      subject: `[Wing] ${n.title}`,
      text: lines.join('\n\n'),
      ...(replyTo.length ? { reply_to: replyTo.length === 1 ? replyTo[0] : replyTo } : {}),
    };
    if (sentBefore && intervalMs > 0) await wait(intervalMs);
    sentBefore = true;
    const outcome = await sendOne(idempotencyKey(n.id, payload), payload, wait);
    if (outcome.kind === 'sent') {
      await settle(n.id, { email_status: 'sent', email_error: null });
      result.sent++;
    } else if (outcome.kind === 'in_progress') {
      result.deferred++;
    } else if (outcome.kind === 'retry_later') {
      // 送信待ちのまま残す（次に通知を作ったアクションで、もう一度送る）
      console.warn('[mail] 送信を次の回へ回しました', { reason: outcome.reason });
      result.deferred++;
      break;
    } else {
      await settle(n.id, { email_status: 'failed', email_error: outcome.reason.slice(0, 300) });
      result.failed++;
      if (outcome.stop) break;
    }
  }
  return result;
}

/** 本処理を止めないための呼び出し口。例外は握りつぶしてログだけ残す */
export async function flushNotificationsSafely(): Promise<void> {
  try {
    await flushNotifications();
  } catch (e) {
    console.error('[mail] 通知メールの送信に失敗しました', e);
  }
}
