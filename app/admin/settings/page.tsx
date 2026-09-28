import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { AdminPage } from '@/components/admin/ui';

function StatusBadge({ available }: { available: boolean }) {
  return (
    <span
      className={
        available
          ? 'shrink-0 rounded-full bg-forest/10 px-2 py-1 text-[0.65rem] font-semibold text-forest'
          : 'shrink-0 rounded-full bg-sand px-2 py-1 text-[0.65rem] font-semibold text-muted'
      }
    >
      {available ? '利用可能' : '準備中'}
    </span>
  );
}

function PendingCard({ title, body, compact = false }: { title: string; body: string; compact?: boolean }) {
  return (
    <div className={`card ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className={compact ? 'text-base' : 'text-lg'}>{title}</h2>
        <StatusBadge available={false} />
      </div>
      <p className={`${compact ? 'mt-1.5 text-xs leading-5' : 'mt-2 text-sm leading-6'} text-ink-soft`}>{body}</p>
    </div>
  );
}

function AvailableCard({
  href,
  title,
  body,
  compact = false,
}: {
  href: string;
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <Link href={href} className={`card ${compact ? 'p-4' : 'p-5'} transition-colors hover:bg-sand/40`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className={compact ? 'text-base' : 'text-lg'}>{title}</h2>
        <StatusBadge available />
      </div>
      <p className={`${compact ? 'mt-1.5 text-xs leading-5' : 'mt-2 text-sm leading-6'} text-ink-soft`}>{body}</p>
    </Link>
  );
}

export default async function AdminSettingsPage() {
  const user = await requireStaff('/admin/settings');
  const isAdmin = user.role === 'admin';

  return (
    <AdminPage title="管理設定" lead="組織・利用者・権限・変更履歴など、管理画面の運用設定を確認します。">
      {isAdmin ? (
        <div className="space-y-8">
          <section className="space-y-3" aria-labelledby="daily-management-heading">
            <div>
              <h2 id="daily-management-heading" className="text-sm font-semibold text-ink">日常の管理</h2>
              <p className="mt-0.5 text-xs text-muted">担当者や組織など、日常運用の中心となる項目です。</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <PendingCard
                title="組織・代理店"
                body="本部・総代理店・代理店の所属関係を管理する入口です。正式な組織階層と所属管理の接続後に有効化します。"
              />
              <AvailableCard
                href="/admin/customers"
                title="ユーザー・担当者"
                body="担当者と顧客アカウントを確認し、現在のユーザー権限を管理します。"
              />
            </div>
          </section>

          <section className="space-y-3 border-t border-line pt-6" aria-labelledby="governance-heading">
            <div>
              <h2 id="governance-heading" className="text-sm font-semibold text-ink">管理・監査</h2>
              <p className="mt-0.5 text-xs text-muted">権限ルールの確認や、重要な変更履歴を確認します。</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <PendingCard
                compact
                title="権限・役割"
                body="本部・総代理店・代理店ごとの閲覧・編集・承認／公開範囲を管理します。正式な権限基盤とRLS／ACL接続後に有効化します。"
              />
              <AvailableCard
                compact
                href="/admin/audit"
                title="変更履歴"
                body="価格・公開状態・ユーザー権限など、重要な変更履歴を確認します。"
              />
            </div>
          </section>

          <section className="border-t border-line pt-6" aria-labelledby="settings-help-heading">
            <h2 id="settings-help-heading" className="text-sm font-semibold text-muted">ヘルプ</h2>
            <Link
              href="/admin/manual"
              className="mt-3 flex max-w-xl items-center justify-between gap-4 rounded-xl border border-line bg-white px-4 py-3 transition-colors hover:bg-sand/40"
            >
              <span>
                <span className="block text-sm font-semibold text-ink">操作マニュアル</span>
                <span className="mt-0.5 block text-xs text-muted">ログイン中の権限に応じた操作手順を確認します。</span>
              </span>
              <span className="text-sm text-muted" aria-hidden="true">→</span>
            </Link>
          </section>
        </div>
      ) : (
        <div className="max-w-xl">
          <AvailableCard
            href="/admin/manual"
            title="操作マニュアル"
            body="ログイン中の権限に応じた操作手順を確認します。"
          />
        </div>
      )}
    </AdminPage>
  );
}
