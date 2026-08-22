import 'server-only';
import { isLocalMode } from '@/lib/data/store';
import { getSiteUrl } from '@/lib/site';

/**
 * 通知メールの送信。
 *
 * 通知そのものは DB（notifications）に必ず残るので、メール設定がなくても運用は止まらない。
 * RESEND_API_KEY と MAIL_FROM が設定されているときだけ実際に送り、
 * 未設定なら email_status='skipped' として画面通知だけを残す。
 *
 * 送信は「通知が作られた直後のアクション」から呼ぶ。失敗しても本処理は成功扱いにする
 * （見積の発行がメール障害で巻き戻ると困るため）。
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

interface Pending {
  id: string;
  recipient_id: string | null;
  title: string;
  body: string | null;
  link: string | null;
}

async function sendOne(to: string[], subject: string, text: string): Promise<void> {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to, subject, text }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
}

/**
 * 未送信の通知をまとめて処理する。
 * ローカル検証モードでは送信しない（E2E で外部通信を発生させないため）。
 */
export async function flushNotifications(limit = 20): Promise<{ sent: number; skipped: number; failed: number }> {
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (isLocalMode()) return result;

  let admin;
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    admin = createAdminClient();
  } catch {
    return result; // service role キー未設定（デモモード等）
  }

  const { data, error } = await admin
    .from('notifications')
    .select('id, recipient_id, title, body, link')
    .eq('email_status', 'pending')
    .order('created_at')
    .limit(limit);
  if (error || !data?.length) return result;

  // 宛先を解決する。recipient_id が null の通知は本部（管理者全員）宛
  const [{ data: admins }, { data: people }] = await Promise.all([
    admin.from('profiles').select('email').eq('role_code', 'admin'),
    admin
      .from('profiles')
      .select('id, email')
      .in('id', (data as Pending[]).map((n) => n.recipient_id).filter((v): v is string => Boolean(v))),
  ]);
  const adminEmails = ((admins ?? []) as { email: string }[]).map((p) => p.email).filter(Boolean);
  const emailById = new Map(((people ?? []) as { id: string; email: string }[]).map((p) => [p.id, p.email]));
  const base = getSiteUrl();

  for (const n of data as Pending[]) {
    const to = n.recipient_id ? [emailById.get(n.recipient_id)].filter((v): v is string => Boolean(v)) : adminEmails;
    if (!mailConfigured() || to.length === 0) {
      await admin
        .from('notifications')
        .update({ email_status: 'skipped', email_error: mailConfigured() ? '宛先が解決できませんでした' : 'メール送信が未設定です' })
        .eq('id', n.id);
      result.skipped++;
      continue;
    }
    const lines = [n.body ?? '', n.link ? `${base}${n.link}` : ''].filter(Boolean);
    try {
      await sendOne(to, `[Wing] ${n.title}`, lines.join('\n\n'));
      await admin.from('notifications').update({ email_status: 'sent' }).eq('id', n.id);
      result.sent++;
    } catch (e) {
      await admin
        .from('notifications')
        .update({ email_status: 'failed', email_error: e instanceof Error ? e.message.slice(0, 300) : '送信に失敗しました' })
        .eq('id', n.id);
      result.failed++;
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
