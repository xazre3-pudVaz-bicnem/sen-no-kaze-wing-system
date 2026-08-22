'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X, UserRound } from 'lucide-react';
import { PROJECT_NAME } from '@/lib/site';
import { cn } from '@/lib/utils';

interface Props {
  items: { href: string; label: string }[];
  user: { name: string; isAdmin: boolean } | null;
}

/**
 * トップページでは写真の上に透明で重なり、スクロール後に白背景へ切り替わるヘッダー。
 * それ以外のページは常に白背景。
 */
export function HeaderShell({ items, user }: Props) {
  const pathname = usePathname();
  const overlay = pathname === '/';
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!overlay) return;
    const onScroll = () => setScrolled(window.scrollY > 48);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overlay]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const transparent = overlay && !scrolled && !open;
  const accountHref = user ? (user.isAdmin ? '/admin' : '/mypage') : '/login';
  const accountLabel = user ? (user.isAdmin ? '管理画面' : 'マイページ') : 'ログイン';
  const close = () => setOpen(false);

  return (
    <header
      className={cn(
        'z-40 w-full transition-[background-color,border-color,backdrop-filter] duration-500',
        overlay ? 'fixed top-0' : 'sticky top-0',
        transparent ? 'border-b border-transparent bg-transparent text-white' : 'border-b border-line/70 bg-paper/92 text-ink backdrop-blur-md'
      )}
    >
      <div className="container-x flex h-16 items-center justify-between gap-4 sm:h-20">
        <Link href="/" className="flex items-baseline gap-2.5" aria-label="Wing トップページ" onClick={close}>
          <span className="font-serif text-2xl font-semibold tracking-[0.12em] sm:text-[1.7rem]">Wing</span>
          <span className={cn('hidden text-[0.68rem] tracking-[0.22em] sm:inline', transparent ? 'text-white/70' : 'text-muted')}>{PROJECT_NAME}</span>
        </Link>

        <nav aria-label="メインナビゲーション" className="hidden items-center gap-8 lg:flex">
          {items.map((it) => (
            <Link key={it.href} href={it.href} className={cn('text-sm font-medium tracking-wide transition-colors', transparent ? 'text-white/85 hover:text-white' : 'text-ink-soft hover:text-ink')}>
              {it.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link href={accountHref} className={cn('btn btn-sm gap-1.5', transparent ? 'text-white hover:bg-white/10' : 'text-ink hover:bg-sand')}>
            <UserRound className="size-4" aria-hidden="true" />
            {accountLabel}
          </Link>
          <Link href="/simulator/wing-01" className={cn('btn btn-sm', transparent ? 'border border-white/60 text-white hover:bg-white hover:text-ink' : 'bg-ink text-white hover:bg-brown')}>
            見積シミュレーション
          </Link>
        </div>

        <button
          type="button"
          className={cn('inline-flex size-11 items-center justify-center rounded-full lg:hidden', transparent ? 'hover:bg-white/10' : 'hover:bg-sand')}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-6" aria-hidden="true" /> : <Menu className="size-6" aria-hidden="true" />}
        </button>
      </div>

      <div id="mobile-menu" className={cn('fixed inset-x-0 top-16 bottom-0 z-30 bg-paper text-ink transition-opacity duration-200 lg:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')} aria-hidden={!open}>
        <nav aria-label="モバイルナビゲーション" className="container-x flex h-full flex-col gap-1 overflow-y-auto py-6">
          {items.map((it) => (
            <Link key={it.href} href={it.href} onClick={close} className="rounded-xl px-4 py-3.5 font-serif text-xl hover:bg-sand">
              {it.label}
            </Link>
          ))}
          <div className="mt-4 flex flex-col gap-3 border-t border-line pt-6">
            <Link href="/simulator/wing-01" onClick={close} className="btn-primary btn-lg">
              見積シミュレーションを始める
            </Link>
            <Link href={accountHref} onClick={close} className="btn-secondary">
              <UserRound className="size-4" aria-hidden="true" />
              {accountLabel}
            </Link>
            {!user && (
              <Link href="/register" onClick={close} className="btn-ghost">
                新規会員登録
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
