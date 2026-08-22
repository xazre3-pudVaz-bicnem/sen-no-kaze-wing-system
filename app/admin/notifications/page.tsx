import Link from 'next/link';
import { CheckCheck } from 'lucide-react';
import { requireStaff } from '@/lib/auth/session';
import { markAllNotificationsReadAction } from '@/lib/actions/admin';
import { getStore } from '@/lib/data/store';
import { mailConfigured } from '@/lib/mail/send';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, FlashMessages } from '@/components/admin/ui';
import { cn } from '@/lib/utils';

const EMAIL_LABELS: Record<string, string> = {
  pending: 'メール送信待ち',
  sent: 'メール送信済み',
  skipped: 'メール未送信',
  failed: 'メール送信失敗',
};

export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff();
  const sp = await searchParams;
  const store = await getStore();
  const notifications = await store.listNotifications(actor, { limit: 100 });
  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <AdminPage
      title="お知らせ"
      lead={`未読 ${unread} 件／直近 ${notifications.length} 件。見積依頼・代理店の割り当て・確定見積・お問い合わせがここに届きます。`}
      actions={
        unread > 0 ? (
          <form action={markAllNotificationsReadAction}>
            <button type="submit" className="btn-secondary btn-sm" data-testid="mark-all-read">
              <CheckCheck className="size-4" aria-hidden="true" />
              すべて既読にする
            </button>
          </form>
        ) : null
      }
    >
      <FlashMessages sp={sp} />

      {!mailConfigured() && (
        <Alert tone="info" title="メール通知は未設定です">
          <code>RESEND_API_KEY</code> と <code>MAIL_FROM</code> を設定すると、同じ内容がメールでも届きます。
          未設定でもこの画面には必ず残るので、運用は止まりません。
        </Alert>
      )}

      <ul className="space-y-2" data-testid="notification-list">
        {notifications.map((n) => (
          <li key={n.id}>
            <div
              className={cn('card flex flex-wrap items-start gap-x-4 gap-y-1 p-4', !n.read_at && 'border-brown/40 bg-ivory')}
              data-testid={`notification-${n.kind}`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {!n.read_at && <Badge tone="danger">未読</Badge>}
                  {n.title}
                </p>
                {n.body && <p className="mt-1 text-sm text-ink-soft">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">
                  {formatDate(n.created_at, true)}／{EMAIL_LABELS[n.email_status] ?? n.email_status}
                  {n.email_error && <span className="ml-1 text-warn">（{n.email_error}）</span>}
                </p>
              </div>
              {n.link && (
                <Link href={n.link} className="btn-secondary btn-sm shrink-0">
                  開く
                </Link>
              )}
            </div>
          </li>
        ))}
        {notifications.length === 0 && (
          <li className="card p-8 text-center text-sm text-muted">お知らせはまだありません</li>
        )}
      </ul>
    </AdminPage>
  );
}
