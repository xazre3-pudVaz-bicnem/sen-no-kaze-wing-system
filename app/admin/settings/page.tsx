import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { AdminPage } from '@/components/admin/ui';

export default async function AdminSettingsPage() {
  const user = await requireStaff('/admin/settings');
  const isAdmin = user.role === 'admin';

  return (
    <AdminPage title="管理設定" lead="組織・ユーザー・権限など、管理画面の運用設定を確認します。販売基準は「販売基準」から管理します。">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/admin/manual" className="card p-5 transition-colors hover:bg-sand/40">
          <h2 className="text-lg">操作マニュアル</h2>
          <p className="mt-2 text-sm text-ink-soft">ログイン中の権限に応じた操作手順を確認します。</p>
        </Link>
        {isAdmin && <Link href="/admin/customers" className="card p-5 transition-colors hover:bg-sand/40"><h2 className="text-lg">ユーザー・権限</h2><p className="mt-2 text-sm text-ink-soft">ユーザー情報と権限を管理します。</p></Link>}
        {isAdmin && <Link href="/admin/contacts" className="card p-5 transition-colors hover:bg-sand/40"><h2 className="text-lg">お問い合わせ</h2><p className="mt-2 text-sm text-ink-soft">公開サイトからのお問い合わせを確認します。</p></Link>}
        {isAdmin && <Link href="/admin/audit" className="card p-5 transition-colors hover:bg-sand/40"><h2 className="text-lg">変更履歴</h2><p className="mt-2 text-sm text-ink-soft">価格・公開状態・権限の変更履歴を確認します。</p></Link>}
      </div>
    </AdminPage>
  );
}
