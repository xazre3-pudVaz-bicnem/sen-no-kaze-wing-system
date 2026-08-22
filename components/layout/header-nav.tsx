'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Menu, X, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  items: { href: string; label: string }[];
  user: { name: string; isAdmin: boolean } | null;
}

export function HeaderNav({ items, user }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const accountHref = user ? (user.isAdmin ? '/admin' : '/mypage') : '/login';
  const accountLabel = user ? (user.isAdmin ? '管理画面' : 'マイページ') : 'ログイン';

  return (
    <>
      <nav aria-label="メインナビゲーション" className="hidden items-center gap-7 lg:flex">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className="text-sm font-medium text-ink-soft transition-colors hover:text-ink">
            {it.label}
          </Link>
        ))}
      </nav>
      <div className="hidden items-center gap-3 lg:flex">
        <Link href={accountHref} className="btn-ghost btn-sm gap-1.5">
          <UserRound className="size-4" aria-hidden="true" />
          {accountLabel}
        </Link>
        <Link href="/simulator/wing-01" className="btn-primary btn-sm">
          見積シミュレーション
        </Link>
      </div>

      <div className="flex items-center gap-2 lg:hidden">
        <Link href="/simulator/wing-01" className="btn-primary btn-sm hidden sm:inline-flex">
          見積シミュレーション
        </Link>
        <button
          type="button"
          className="inline-flex size-11 items-center justify-center rounded-full hover:bg-sand"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-6" aria-hidden="true" /> : <Menu className="size-6" aria-hidden="true" />}
        </button>
      </div>

      <div
        id="mobile-menu"
        className={cn(
          'fixed inset-x-0 top-16 bottom-0 z-30 bg-paper transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        aria-hidden={!open}
      >
        <nav aria-label="モバイルナビゲーション" className="container-x flex h-full flex-col gap-1 overflow-y-auto py-6">
          {items.map((it) => (
            <Link key={it.href} href={it.href} onClick={() => setOpen(false)} className="rounded-xl px-4 py-3.5 text-lg font-medium hover:bg-sand">
              {it.label}
            </Link>
          ))}
          <div className="mt-4 flex flex-col gap-3 border-t border-line pt-6">
            <Link href="/simulator/wing-01" onClick={() => setOpen(false)} className="btn-primary btn-lg">
              見積シミュレーションを始める
            </Link>
            <Link href={accountHref} onClick={() => setOpen(false)} className="btn-secondary">
              <UserRound className="size-4" aria-hidden="true" />
              {accountLabel}
            </Link>
            {!user && (
              <Link href="/register" onClick={() => setOpen(false)} className="btn-ghost">
                新規会員登録
              </Link>
            )}
          </div>
        </nav>
      </div>
    </>
  );
}
