import Link from 'next/link';
import type { RoleCode } from '@/lib/domain/types';

type CaseNavKey = 'cases' | 'saved' | 'inquiries' | 'notifications';

export function CaseManagementNav({
  role,
  active,
  savedCount,
  inquiryCount,
}: {
  role: RoleCode;
  active: CaseNavKey;
  savedCount?: number;
  inquiryCount?: number;
}) {
  const isAdmin = role === 'admin';
  const items = [
    { key: 'cases' as const, href: '/admin/quotes', label: '案件一覧' },
    ...(isAdmin ? [{ key: 'saved' as const, href: '/admin/configurations', label: '保存済み仕様', count: savedCount }] : []),
    ...(isAdmin ? [{ key: 'inquiries' as const, href: '/admin/contacts', label: '問い合わせ受付', count: inquiryCount }] : []),
  ];

  return (
    <nav aria-label="案件管理メニュー" className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-[#e8f0eb] p-1 [scrollbar-width:none]">
        {items.map((item) => {
          const current = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={current ? 'page' : undefined}
              className={
                current
                  ? 'shrink-0 rounded-md bg-[#2f6b4f] px-3 py-1.5 text-xs font-semibold text-white shadow-sm'
                  : 'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-[#365467] hover:bg-white/70'
              }
            >
              {item.label}
              {typeof item.count === 'number' && <span className="ml-1 opacity-75">{item.count}</span>}
            </Link>
          );
        })}
      </div>
      <Link
        href="/admin/notifications"
        aria-current={active === 'notifications' ? 'page' : undefined}
        className={active === 'notifications' ? 'text-xs font-semibold text-[#2f6b4f] underline underline-offset-4' : 'text-xs text-muted hover:text-ink'}
      >
        お知らせ
      </Link>
    </nav>
  );
}
