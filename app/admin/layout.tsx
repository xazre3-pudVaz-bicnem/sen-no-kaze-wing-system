import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { signOutAction } from '@/lib/actions/auth';
import { AdminNav } from '@/components/admin/admin-nav';
import { DemoBanner } from '@/components/layout/demo-banner';

export const metadata: Metadata = {
  title: { default: '管理画面', template: '%s｜Wing 管理画面' },
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return (
    <div className="min-h-dvh bg-sand/40 lg:grid lg:grid-cols-[15rem_1fr]">
      <div className="lg:col-span-2"><DemoBanner /></div>
      <aside className="border-b border-line bg-white lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 lg:block lg:py-6">
          <Link href="/admin" className="flex items-baseline gap-2">
            <span className="font-serif text-xl tracking-[0.08em]">Wing</span>
            <span className="text-xs text-muted">管理画面</span>
          </Link>
          <p className="hidden truncate text-xs text-muted lg:mt-2 lg:block">{user.email}</p>
        </div>
        <AdminNav />
        <div className="hidden px-5 py-4 lg:block">
          <Link href="/" className="block text-sm text-ink-soft hover:text-ink">← 公開サイトを見る</Link>
          <form action={signOutAction} className="mt-2">
            <button type="submit" className="text-sm text-ink-soft hover:text-ink">ログアウト</button>
          </form>
        </div>
      </aside>
      <main id="main" className="min-w-0 px-5 py-8 sm:px-8 lg:px-10">
        {children}
      </main>
    </div>
  );
}
