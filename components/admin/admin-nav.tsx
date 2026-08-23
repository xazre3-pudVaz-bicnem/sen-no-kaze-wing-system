'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { canEditCatalog, type RoleCode } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

/** catalog: 総代理店以上のみ / admin: 管理者のみ / なし: 代理店も見られる */
const items: { href: string; label: string; exact?: boolean; need?: 'catalog' | 'admin' }[] = [
  { href: '/admin', label: 'ダッシュボード', exact: true },
  { href: '/admin/notifications', label: 'お知らせ' },
  { href: '/admin/ledger', label: '商品台帳' },
  { href: '/admin/free-products', label: 'フリー商品' },
  { href: '/admin/models', label: 'ベースコンテナ', need: 'catalog' },
  { href: '/admin/categories', label: 'オプションカテゴリー', need: 'catalog' },
  { href: '/admin/options', label: 'オプション', need: 'catalog' },
  { href: '/admin/preview-rules', label: 'プレビュー画像', need: 'catalog' },
  { href: '/admin/customers', label: 'ユーザー・権限', need: 'admin' },
  { href: '/admin/configurations', label: '保存された仕様', need: 'admin' },
  { href: '/admin/quotes', label: '見積依頼・見積書' },
  { href: '/admin/contacts', label: 'お問い合わせ', need: 'admin' },
  { href: '/admin/audit', label: '変更履歴', need: 'admin' },
  { href: '/admin/manual', label: '操作マニュアル' },
];

export function AdminNav({ role }: { role: RoleCode }) {
  const pathname = usePathname();
  const visible = items.filter((it) => (it.need === 'catalog' ? canEditCatalog(role) : it.need === 'admin' ? role === 'admin' : true));
  return (
    <nav aria-label="管理メニュー" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-3 lg:pb-0 [scrollbar-width:none]">
      {visible.map((it) => {
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
