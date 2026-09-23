import type { ReactNode } from 'react';
import Link from 'next/link';
import { signOutAction } from '@/lib/actions/auth';
import { ROLE_LABELS, type RoleCode } from '@/lib/domain/types';
import { AdminNav } from '@/components/admin/admin-nav';
import { DemoBanner } from '@/components/layout/demo-banner';

type AdminShellProps = {
  children: ReactNode;
  email: string;
  role: RoleCode;
  migrationOnly?: boolean;
};

/** 管理画面共通のヘッダーと権限別ナビゲーション。 */
export function AdminShell({ children, email, role, migrationOnly = false }: AdminShellProps) {
  const homeHref = migrationOnly ? '/admin/base-migration' : '/admin';

  return (
    <div className="min-h-dvh bg-sand/40">
      <DemoBanner />
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[96rem] items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Link href={homeHref} className="flex shrink-0 items-baseline gap-2">
            <span className="font-serif text-xl tracking-[0.04em]">千の風プロジェクト</span>
            <span className="text-xs text-muted">管理画面</span>
          </Link>
          <div className="flex min-w-0 items-center gap-3 text-xs text-muted">
            <p className="hidden truncate sm:block">{email}</p>
            <span className="shrink-0 rounded bg-sand px-1.5 py-0.5 text-[0.65rem] text-ink-soft">{ROLE_LABELS[role]}</span>
            <Link href="/" className="hidden shrink-0 hover:text-ink lg:block">公開サイト</Link>
            <form action={signOutAction} className="shrink-0">
              <button type="submit" className="hover:text-ink">ログアウト</button>
            </form>
          </div>
        </div>
        <AdminNav role={role} migrationOnly={migrationOnly} />
      </header>
      <main id="main" className="mx-auto min-w-0 max-w-[96rem] px-5 py-8 sm:px-8 lg:px-10">
        {children}
      </main>
    </div>
  );
}
