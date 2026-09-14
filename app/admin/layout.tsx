import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { requireStaff, requireUser } from '@/lib/auth/session';
import { signOutAction } from '@/lib/actions/auth';
import { AdminNav } from '@/components/admin/admin-nav';
import { DemoBanner } from '@/components/layout/demo-banner';
import { ROLE_LABELS } from '@/lib/domain/types';

export const metadata: Metadata = {
  title: { default: '管理画面', template: '%s｜Wing 管理画面' },
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-wing-pathname') ?? '';
  const migrationRoute = pathname === '/admin/base-migration';
  const user = migrationRoute
    ? await requireUser('/admin/base-migration')
    : await requireStaff();
  const migrationOnly = migrationRoute && user.role === 'customer';
  return (
    <div className="min-h-dvh bg-sand/40 lg:grid lg:grid-cols-[15rem_1fr]">
      <div className="lg:col-span-2"><DemoBanner /></div>
      <aside className="border-b border-line bg-white lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 lg:block lg:py-6">
          <Link href={migrationOnly ? '/admin/base-migration' : '/admin'} className="flex items-baseline gap-2">
            <span className="font-serif text-xl tracking-[0.08em]">Wing</span>
            <span className="text-xs text-muted">管理画面</span>
          </Link>
          <p className="hidden truncate text-xs text-muted lg:mt-2 lg:block">
            {user.email}
            <span className="ml-1 rounded bg-sand px-1.5 py-0.5 text-[0.65rem]">{ROLE_LABELS[user.role]}</span>
          </p>
        </div>
        <AdminNav role={user.role} migrationOnly={migrationOnly} />
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
