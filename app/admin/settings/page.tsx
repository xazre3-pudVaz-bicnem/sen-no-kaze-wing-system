import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { AdminPage } from '@/components/admin/ui';

function PendingCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg">{title}</h2>
        <span className="shrink-0 rounded-full bg-sand px-2 py-1 text-[0.65rem] font-semibold text-muted">準備中</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{body}</p>
    </div>
  );
}

export default async function AdminSettingsPage() {
  const user = await requireStaff('/admin/settings');
  const isAdmin = user.role === 'admin';

  return (
    <AdminPage title="管理設定" lead="組織・利用者・権限・変更履歴など、管理画面の運用設定を確認します。">
      {isAdmin ? (
        <div className="space-y-8">
          <section>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <PendingCard
                title="組織・代理店"
                body="本部・総代理店・代理店の所属関係や担当エリアを管理する入口です。正式な組織階層・地域権限の接続後に有効化します。"
              />
              <Link href="/admin/customers" className="card p-5 transition-colors hover:bg-sand/40">
                <h2 className="text-lg">ユーザー・担当者</h2>
                <p className="mt-2 text-sm leading-6 text-ink-soft">利用者情報を確認し、現在のユーザー権限を管理します。</p>
              </Link>
              <PendingCard
                title="権限"
                body="本部・総代理店・代理店ごとの閲覧・編集・承認／公開範囲を管理する入口です。正式な権限テンプレートとRLS／ACL接続後に有効化します。"
              />
              <Link href="/admin/audit" className="card p-5 transition-colors hover:bg-sand/40">
                <h2 className="text-lg">変更履歴</h2>
                <p className="mt-2 text-sm leading-6 text-ink-soft">価格・公開状態・ユーザー権限などの変更履歴を確認します。</p>
              </Link>
              <PendingCard
                title="その他設定"
                body="通知やログイン後の初期表示など、日常運用で必要な設定をまとめる入口です。必要項目を確定してから有効化します。"
              />
            </div>
          </section>

          <section className="border-t border-line pt-6">
            <h2 className="text-sm font-semibold text-muted">ヘルプ</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Link href="/admin/manual" className="card p-5 transition-colors hover:bg-sand/40">
                <h3 className="text-lg">操作マニュアル</h3>
                <p className="mt-2 text-sm leading-6 text-ink-soft">ログイン中の権限に応じた操作手順を確認します。</p>
              </Link>
            </div>
          </section>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link href="/admin/manual" className="card p-5 transition-colors hover:bg-sand/40">
            <h2 className="text-lg">操作マニュアル</h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft">ログイン中の権限に応じた操作手順を確認します。</p>
          </Link>
        </div>
      )}
    </AdminPage>
  );
}
