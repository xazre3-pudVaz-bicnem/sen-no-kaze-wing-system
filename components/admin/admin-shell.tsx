import type { ReactNode } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { signOutAction } from '@/lib/actions/auth';
import { ROLE_LABELS, type RoleCode } from '@/lib/domain/types';
import { AdminNav } from '@/components/admin/admin-nav';
import { DismissibleDetails } from '@/components/admin/dismissible-details';
import { DemoBanner } from '@/components/layout/demo-banner';

const ADMIN_HEADER_ROLE_LABELS: Partial<Record<RoleCode, string>> = {
  admin: '本部',
  master_dealer: '総代理店',
  dealer: '代理店',
};

type AdminShellProps = {
  children: ReactNode;
  email: string;
  role: RoleCode;
  fullName: string;
  companyName: string | null;
  migrationOnly?: boolean;
};

/** 管理画面共通のヘッダーと権限別ナビゲーション。 */
export function AdminShell({
  children,
  email,
  role,
  fullName,
  companyName,
  migrationOnly = false,
}: AdminShellProps) {
  const homeHref = migrationOnly ? '/admin/base-migration' : '/admin';
  const roleLabel = ADMIN_HEADER_ROLE_LABELS[role] ?? ROLE_LABELS[role];
  const displayName = fullName.trim() || '氏名未登録';
  const displayCompany = companyName?.trim() || null;

  return (
    <div className="min-h-dvh bg-sand/40">
      <DemoBanner />
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 sm:px-8">
          <Link href={homeHref} className="flex shrink-0 items-baseline gap-2">
            <span className="font-serif text-xl tracking-[0.04em]">千の風プロジェクト</span>
            <span className="text-xs text-muted">管理画面</span>
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted sm:gap-3">
            <div className="hidden min-w-0 max-w-64 text-right md:block">
              {displayCompany && (
                <p className="hidden truncate text-[0.68rem] leading-4 text-muted lg:block">{displayCompany}</p>
              )}
              <p className="truncate text-sm font-medium leading-5 text-ink">{displayName}</p>
            </div>
            <span className="shrink-0 rounded bg-sand px-2 py-1 text-[0.68rem] font-medium text-ink-soft">
              {roleLabel}
            </span>
            {!migrationOnly && (
              <Link
                href="/admin/notifications"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-soft hover:bg-sand hover:text-ink"
                aria-label="お知らせ"
                title="お知らせ"
              >
                <Bell className="size-4" aria-hidden="true" />
              </Link>
            )}
            <DismissibleDetails className="group relative shrink-0">
              <summary
                className="inline-flex cursor-pointer list-none items-center gap-1 rounded-lg border border-line px-2.5 py-2 font-medium text-ink-soft hover:bg-sand hover:text-ink [&::-webkit-details-marker]:hidden"
                aria-label="アカウントメニュー"
              >
                <span>アカウント</span>
                <span className="text-[0.6rem] transition-transform group-open:rotate-180" aria-hidden="true">▼</span>
              </summary>
              <div className="absolute right-0 z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-white text-left shadow-lg">
                <div className="border-b border-line px-4 py-3">
                  {displayCompany && <p className="truncate text-xs text-muted">{displayCompany}</p>}
                  <p className="mt-0.5 truncate text-sm font-semibold text-ink">{displayName}</p>
                  <p className="mt-1 break-all text-xs text-muted">{email}</p>
                  <p className="mt-2 text-xs font-medium text-ink-soft">現在の役割：{roleLabel}</p>
                </div>
                <div className="grid gap-1 p-2">
                  {!migrationOnly && (
                    <Link href="/admin/manual" className="rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-sand hover:text-ink">
                      操作マニュアル
                    </Link>
                  )}
                  <Link href="/" className="rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-sand hover:text-ink">
                    公開サイト
                  </Link>
                  <form action={signOutAction}>
                    <button type="submit" className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-soft hover:bg-sand hover:text-ink">
                      ログアウト
                    </button>
                  </form>
                </div>
              </div>
            </DismissibleDetails>
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
