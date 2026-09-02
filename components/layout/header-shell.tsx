'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, X, UserRound } from 'lucide-react';
import { signOutAction } from '@/lib/actions/auth';
import { PROJECT_NAME } from '@/lib/site';
import { cn } from '@/lib/utils';

interface Props {
  items: { href: string; label: string }[];
  user: { name: string; isAdmin: boolean } | null;
}

/**
 * 先方サイトと同じ濃緑のヘッダー（千の風ロゴ ＋ 明朝ナビ ＋ Contact Us ボタン）。
 * トップでは写真の上に重ね、スクロール後に不透明へ切り替える。
 *
 * モバイルメニューは header の外に出している：header に backdrop-blur を掛けると
 * fixed 子要素の包含ブロックが header になり、メニューが高さ 0 に潰れて操作できなくなるため。
 */
export function HeaderShell({ items, user }: Props) {
  const pathname = usePathname();
  const overlay = pathname === '/';
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [simulatorAccountTarget, setSimulatorAccountTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!overlay) return;
    const onScroll = () => setScrolled(window.scrollY > 40);
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

  useEffect(() => {
    // setState はエフェクト本体で同期的に呼ばず、描画後の rAF コールバック内で行う（react-hooks/set-state-in-effect）
    const findTarget = () => {
      if (!user || !pathname.startsWith('/simulator/')) {
        setSimulatorAccountTarget(null);
        return;
      }
      const mypageLink = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="/mypage"]')).find(
        (node) => !node.closest('header') && !node.closest('#mobile-menu')
      );
      setSimulatorAccountTarget(mypageLink?.parentElement?.parentElement ?? null);
    };

    const frame = window.requestAnimationFrame(findTarget);
    return () => window.cancelAnimationFrame(frame);
  }, [pathname, user]);

  const solid = !overlay || scrolled || open;
  // isAdmin は「管理画面に入れる権限（代理店以上）」の意味
  const accountHref = user ? (user.isAdmin ? '/admin' : '/mypage') : '/login';
  const accountLabel = user ? (user.isAdmin ? '管理画面' : 'マイページ') : '会員様ログイン';
  const close = () => setOpen(false);

  return (
    <>
      <header
        className={cn(
          'z-40 w-full border-b text-white transition-colors duration-500',
          overlay ? 'fixed top-0' : 'sticky top-0',
          solid ? 'border-gold/40 bg-forest-deep/95 backdrop-blur-md' : 'border-transparent bg-gradient-to-b from-forest-deep/85 to-transparent'
        )}
      >
        <div className="mx-auto flex h-16 w-full max-w-[110rem] items-center justify-between gap-4 px-5 sm:px-8 lg:h-[6.5rem]">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="千の風プロジェクト トップページ" onClick={close}>
            <Image src="/images/brand/sennokaze-logo-white.png" alt="" width={120} height={80} priority className="h-11 w-auto lg:h-14" />
            {/* 先方モック（2026-09-02）：ロゴ横に「プロジェクト」 */}
            <span aria-hidden="true" className="font-serif text-sm tracking-[0.2em] text-white/90 lg:text-base">プロジェクト</span>
            <span className="sr-only">{PROJECT_NAME}</span>
          </Link>

          <nav aria-label="メインナビゲーション" className="hidden min-w-0 items-center gap-3 xl:flex 2xl:gap-5">
            {items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className="font-serif text-[0.82rem] whitespace-nowrap text-white/90 transition-colors hover:text-gold 2xl:text-[0.95rem] 2xl:tracking-wide"
              >
                {it.label}
              </Link>
            ))}
          </nav>

          <div className="hidden shrink-0 items-center gap-2 lg:flex">
            <Link href="/simulator/wing-01" className="btn-gold btn-sm px-4 text-[0.82rem] font-semibold whitespace-nowrap 2xl:text-sm">
              見積シミュレーション
            </Link>
            <Link href="/#contact" className="btn-outline-gold btn-sm px-4 font-serif tracking-wider whitespace-nowrap">
              Contact&nbsp;Us
            </Link>
            {/* 会員様ログインはヘッダー右端の金ボタン（2026-09-02 先方モック） */}
            <Link href={accountHref} data-testid="hero-login" className="btn-gold btn-sm gap-1.5 px-3 text-[0.82rem] font-semibold whitespace-nowrap 2xl:text-sm" aria-label={accountLabel}>
              <UserRound className="size-4" aria-hidden="true" />
              {accountLabel}
            </Link>
          </div>

          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full text-white hover:bg-white/10 xl:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-6" aria-hidden="true" /> : <Menu className="size-6" aria-hidden="true" />}
          </button>
        </div>
      </header>

      {user && simulatorAccountTarget &&
        createPortal(
          <form action={signOutAction} className="inline text-ink-soft">
            <span aria-hidden="true">｜</span>
            <button type="submit" className="underline underline-offset-4 hover:text-ink">
              ログアウト
            </button>
          </form>,
          simulatorAccountTarget
        )}

      <div
        id="mobile-menu"
        className={cn(
          'fixed inset-x-0 top-16 bottom-0 z-50 overflow-y-auto bg-forest-deep transition-opacity duration-200 lg:top-[6.5rem] xl:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        aria-hidden={!open}
      >
        <nav aria-label="モバイルナビゲーション" className="container-x flex flex-col gap-1 py-6">
          {/* 主要な導線を先頭に置く */}
          <div className="mb-6 flex flex-col gap-3">
            <Link href="/simulator/wing-01" onClick={close} className="btn-gold btn-lg">
              見積シミュレーションを始める
            </Link>
            <Link href="/#contact" onClick={close} className="btn-outline-gold">
              Contact Us
            </Link>
            <Link href={accountHref} onClick={close} className="btn text-white/90 hover:bg-white/10">
              <UserRound className="size-4" aria-hidden="true" />
              {accountLabel}
            </Link>
          </div>
          {items.map((it) => (
            <Link key={it.href} href={it.href} onClick={close} className="border-b border-forest-line/60 px-1 py-4 font-serif text-lg text-white">
              {it.label}
            </Link>
          ))}
          <Link href="/products" onClick={close} className="border-b border-forest-line/60 px-1 py-4 font-serif text-lg text-white">
            商品ラインナップ
          </Link>
        </nav>
      </div>
    </>
  );
}
