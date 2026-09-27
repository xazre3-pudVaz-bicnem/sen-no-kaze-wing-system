'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type RoleCode } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

type Access = 'admin';
type NavSection = { href: string; label: string; match: string[]; need?: Access };

const sections: NavSection[] = [
  {
    href: '/admin/quotes',
    label: '案件管理',
    match: [
      '/admin',
      '/admin/quotes',
      '/admin/configurations',
      '/admin/notifications',
      '/admin/contacts',
      '/admin/customer-management',
    ],
  },
  {
    href: '/admin/ledger',
    label: '商品台帳',
    match: [
      '/admin/ledger',
      '/admin/free-products',
      '/admin/models',
      '/admin/categories',
      '/admin/options',
      '/admin/import',
      '/admin/preview-rules',
    ],
  },
  {
    href: '/admin/estimate-templates',
    label: '標準見積',
    match: ['/admin/base-masters', '/admin/estimate-templates', '/admin/base-breakdown'],
    need: 'admin',
  },
  {
    href: '/admin/settings',
    label: '管理設定',
    match: ['/admin/settings', '/admin/customers', '/admin/audit', '/admin/manual'],
  },
];

function isAllowed(section: NavSection, role: RoleCode) {
  return section.need === 'admin' ? role === 'admin' : true;
}

function sectionIsActive(section: NavSection, pathname: string) {
  return section.match.some((href) => (href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)));
}

/** ログイン中の既存ロールから、表示可能な業務領域を決定する。 */
export function getAdminNavSections(role: RoleCode) {
  return sections.filter((section) => isAllowed(section, role));
}

export function AdminNav({ role, migrationOnly = false }: { role: RoleCode; migrationOnly?: boolean }) {
  const pathname = usePathname();
  const visible = migrationOnly ? [] : getAdminNavSections(role);

  return (
    <nav aria-label="管理メニュー" className="border-t border-line">
      <div className="mx-auto flex max-w-[96rem] gap-1 overflow-x-auto px-3 py-2 sm:px-6 [scrollbar-width:none]">
        {migrationOnly && (
          <Link
            href="/admin/base-migration"
            aria-current="page"
            className="shrink-0 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white"
          >
            旧本体移行監査
          </Link>
        )}
        {visible.map((section) => {
          const active = sectionIsActive(section, pathname);
          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium',
                active ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sand'
              )}
            >
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
