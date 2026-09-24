'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { canEditCatalog, type RoleCode } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

type Access = 'catalog' | 'admin';
type NavItem = { href: string; label: string; exact?: boolean; need?: Access };
type NavSection = { href: string; label: string; match: string[]; items: NavItem[]; need?: Access };

const sections: NavSection[] = [
  {
    href: '/admin/quotes', label: '案件管理', match: ['/admin', '/admin/quotes', '/admin/configurations', '/admin/notifications', '/admin/contacts'],
    items: [
      { href: '/admin/quotes', label: '案件一覧' },
      { href: '/admin/configurations', label: '保存済み仕様', need: 'admin' },
      { href: '/admin/contacts', label: '問い合わせ受付', need: 'admin' },
      { href: '/admin/notifications', label: 'お知らせ' },
    ],
  },
  {
    href: '/admin/ledger', label: '商品台帳', match: ['/admin/ledger', '/admin/free-products', '/admin/models', '/admin/categories', '/admin/options', '/admin/import', '/admin/preview-rules'],
    items: [
      { href: '/admin/ledger', label: '商品台帳' },
      { href: '/admin/free-products', label: 'フリー商品' },
      { href: '/admin/models', label: 'ベースコンテナ', need: 'catalog' },
      { href: '/admin/categories', label: 'オプションカテゴリー', need: 'catalog' },
      { href: '/admin/options', label: '商品登録・編集', need: 'catalog' },
      { href: '/admin/import', label: '商品の一括登録', need: 'catalog' },
      { href: '/admin/preview-rules', label: 'プレビュー画像', need: 'catalog' },
    ],
  },
  {
    href: '/admin/estimate-templates', label: '標準見積', match: ['/admin/base-masters', '/admin/estimate-templates', '/admin/base-breakdown'], need: 'admin',
    items: [
      { href: '/admin/base-masters', label: '本体マスター' },
      { href: '/admin/estimate-templates', label: '標準見積' },
      { href: '/admin/base-breakdown', label: '旧 標準見積Excel' },
    ],
  },
  {
    href: '/admin/settings', label: '管理設定', match: ['/admin/settings', '/admin/customers', '/admin/audit', '/admin/manual'],
    items: [
      { href: '/admin/settings', label: '設定一覧', exact: true },
      { href: '/admin/manual', label: '操作マニュアル' },
      { href: '/admin/customers', label: 'ユーザー・担当者', need: 'admin' },
      { href: '/admin/audit', label: '変更履歴', need: 'admin' },
    ],
  },
];

function isAllowed(item: { need?: Access }, role: RoleCode) {
  return item.need === 'catalog' ? canEditCatalog(role) : item.need === 'admin' ? role === 'admin' : true;
}

function sectionIsActive(section: NavSection, pathname: string) {
  return section.match.some((href) => href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
}

/** ログイン中の既存ロールから、表示可能な業務領域と補助導線を決定する。 */
export function getAdminNavSections(role: RoleCode) {
  return sections
    .filter((section) => isAllowed(section, role))
    .map((section) => ({ ...section, items: section.items.filter((item) => isAllowed(item, role)) }));
}

export function AdminNav({ role, migrationOnly = false }: { role: RoleCode; migrationOnly?: boolean }) {
  const pathname = usePathname();
  const visible = migrationOnly ? [] : getAdminNavSections(role);
  const activeSection = visible.find((section) => sectionIsActive(section, pathname));
  return (
    <nav aria-label="管理メニュー" className="border-t border-line">
      <div className="mx-auto flex max-w-[96rem] gap-1 overflow-x-auto px-3 py-2 sm:px-6 [scrollbar-width:none]">
        {migrationOnly && <Link href="/admin/base-migration" aria-current="page" className="shrink-0 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white">旧本体移行監査</Link>}
        {visible.map((section) => {
          const active = sectionIsActive(section, pathname);
          return (
            <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={cn('shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium', active ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sand')}
          >
            {section.label}
          </Link>
        );
      })}
      </div>
      {activeSection && activeSection.label !== '案件管理' && (
        <div className="border-t border-line bg-sand/40">
          <div className="mx-auto flex max-w-[96rem] gap-x-4 gap-y-1 overflow-x-auto px-5 py-2 text-xs sm:px-8 [scrollbar-width:none]">
            {activeSection.items.map((item) => {
              const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={cn('shrink-0 whitespace-nowrap underline-offset-4 hover:underline', active ? 'font-semibold text-ink' : 'text-ink-soft')}>{item.label}</Link>;
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
