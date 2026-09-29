'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type RoleCode } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

type Access = 'admin';
type NavSection = { href: string; label: string; match: string[]; exclude?: string[]; need?: Access };
type NavUtilityLink = { href: string; label: string; need?: Access };

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
    ],
    exclude: ['/admin/quotes/new', '/admin/quotes/drafts'],
  },
  {
    href: '/admin/customer-management',
    label: '顧客管理',
    match: ['/admin/customer-management'],
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
    href: '/admin/quote-management',
    label: '見積書管理',
    match: [
      '/admin/quote-management',
      '/admin/base-masters',
      '/admin/estimate-templates',
      '/admin/base-breakdown',
      '/admin/quotes/new',
      '/admin/quotes/drafts',
    ],
    need: 'admin',
  },
  {
    href: '/admin/settings',
    label: '管理設定',
    match: ['/admin/settings', '/admin/customers', '/admin/audit', '/admin/manual'],
  },
];

const utilityLinks: NavUtilityLink[] = [];

function isAllowed(item: { need?: Access }, role: RoleCode) {
  return item.need === 'admin' ? role === 'admin' : true;
}

function sectionIsActive(section: NavSection, pathname: string, role: RoleCode) {
  if (
    role === 'admin' &&
    section.exclude?.some((href) => pathname === href || pathname.startsWith(`${href}/`))
  ) {
    return false;
  }
  return section.match.some((href) => (href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)));
}

/** ログイン中の既存ロールから、表示可能な業務領域を決定する。 */
export function getAdminNavSections(role: RoleCode) {
  return sections.filter((section) => isAllowed(section, role));
}

/** 通常ナビに出さない補助画面の入口。現在は上部表示なし。 */
export function getAdminUtilityLinks(role: RoleCode) {
  return utilityLinks.filter((item) => isAllowed(item, role));
}

export function AdminNav({ role, migrationOnly = false }: { role: RoleCode; migrationOnly?: boolean }) {
  const pathname = usePathname();
  const visible = migrationOnly ? [] : getAdminNavSections(role);
  const utilities = migrationOnly ? [] : getAdminUtilityLinks(role);

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
          const active = sectionIsActive(section, pathname, role);
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
        {utilities.length > 0 && (
          <div className="ml-auto flex shrink-0 items-center gap-1 border-l border-line pl-2" aria-label="案件管理の補助メニュー">
            {utilities.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium',
                    active ? 'bg-sand text-ink' : 'text-muted hover:bg-sand hover:text-ink'
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
