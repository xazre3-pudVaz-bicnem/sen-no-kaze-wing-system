'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const items = [
  { href: '/admin', label: 'ダッシュボード', exact: true },
  { href: '/admin/models', label: 'ベースコンテナ' },
  { href: '/admin/categories', label: 'オプションカテゴリー' },
  { href: '/admin/options', label: 'オプション' },
  { href: '/admin/preview-rules', label: 'プレビュー画像' },
  { href: '/admin/customers', label: '顧客一覧' },
  { href: '/admin/configurations', label: '保存された仕様' },
  { href: '/admin/quotes', label: '見積依頼・見積書' },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="管理メニュー" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3 lg:pb-0 [scrollbar-width:none]">
      {items.map((it) => {
        const active = it.exact ? pathname === it.href : pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className={cn('shrink-0 rounded-lg px-3 py-2 text-sm font-medium', active ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sand')}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
