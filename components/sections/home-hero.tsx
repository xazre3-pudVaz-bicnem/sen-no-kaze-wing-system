import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ChevronDown, UserRound } from 'lucide-react';
import { hero } from '@/data/site-content';
import { getSessionUser } from '@/lib/auth/session';
import { canEditDealerItems } from '@/lib/domain/types';

/** ファーストビュー：全面写真＋「− 折畳木造コンテナ − Wing」 */
export async function HomeHero() {
  // 会員のログイン導線はヘッダーだけだと見つけにくいので、ファーストビューにも置く
  const user = await getSessionUser();
  const account = user
    ? { href: canEditDealerItems(user.role) ? '/admin' : '/mypage', label: canEditDealerItems(user.role) ? '管理画面へ' : 'マイページへ' }
    : { href: '/login', label: '会員様ログイン' };

  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden bg-forest-deep text-white">
      {/* 先方指示（2026-08-29）で差し替え。パンフレット提供の海岸 CG */}
      <Image
        src="/images/products/wing-rockshore-triple.jpg"
        alt="雪山を望む海岸の岩場に並ぶ、折り畳み式木造コンテナ Wing"
        fill
        priority
        sizes="100vw"
        className="object-cover object-[60%_center]"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-forest-deep/55 via-transparent to-forest-deep/75" aria-hidden="true" />

      <div className="relative flex min-h-[100svh] flex-col justify-center">
        <div className="container-x pt-24 pb-24 text-center sm:pb-28">
          <p className="reveal reveal-delay-1 font-serif text-sm tracking-[0.3em] text-white/90 sm:text-lg">{hero.eyebrow}</p>
          <h1 className="reveal reveal-delay-1 mt-3 font-serif text-[4.5rem] leading-none tracking-[0.06em] text-gold-light drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)] sm:text-[7rem] lg:text-[8.5rem]">
            Wing
          </h1>
          <p className="reveal reveal-delay-2 mx-auto mt-6 max-w-xl text-sm leading-[2] whitespace-pre-line text-white/90 sm:text-base">{hero.lead}</p>
          <div className="reveal reveal-delay-3 mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="#concept" className="btn-outline-gold font-serif tracking-wider">
              {hero.cta}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href={account.href}
              className="inline-flex items-center gap-2 rounded-full border border-white/50 px-6 py-3 text-sm tracking-wider text-white transition-colors hover:border-gold hover:text-gold"
              data-testid="hero-login"
            >
              <UserRound className="size-4" aria-hidden="true" />
              {account.label}
            </Link>
          </div>
          {!user && (
            <p className="reveal reveal-delay-3 mt-3 text-xs text-white/70">
              見積の保存・見積書のご確認は会員登録（無料）が必要です
            </p>
          )}
        </div>
      </div>

      <a href="#concept" className="absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 text-[0.6rem] tracking-[0.3em] text-white/70 hover:text-gold" aria-label="下へスクロール">
        SCROLL
        <ChevronDown className="size-4 animate-bounce" aria-hidden="true" />
      </a>
    </section>
  );
}
