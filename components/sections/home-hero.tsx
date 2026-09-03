import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { hero } from '@/data/site-content';

/** ファーストビュー：3枚クロスフェード＋左寄せの商品導線（2026-09-02 先方モック準拠） */
export function HomeHero() {
  return (
    <section className="relative isolate min-h-[55svh] lg:min-h-[70svh] overflow-hidden bg-forest-deep text-white">
      {/* 1枚目は常時表示の下地、2〜3枚目が hero-crossfade で入れ替わる */}
      <Image src={hero.slides[0].src} alt={hero.slides[0].alt} fill priority sizes="100vw" className="object-cover" />
      {hero.slides.slice(1).map((s, i) => (
        <Image
          key={s.src}
          src={s.src}
          alt=""
          aria-hidden="true"
          fill
          sizes="100vw"
          className="hero-slide object-cover"
          style={{ animationDelay: `${(i + 1) * 6}s` }}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-r from-forest-deep/70 via-forest-deep/25 to-transparent" aria-hidden="true" />

      <div className="relative flex min-h-[55svh] lg:min-h-[70svh] flex-col justify-center">
        <div className="container-x py-12 sm:py-16">
          <h1 className="reveal reveal-delay-1 max-w-xl font-serif text-[1.45rem] leading-snug tracking-[0.04em] text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.55)] sm:text-4xl">
            {hero.title}
            <span className="mt-1 block text-sm tracking-[0.12em] text-white/90 sm:text-lg">{hero.patent}</span>
          </h1>

          {/* Wing / BOX / Flat を縦積みで（先方モック。2026-09-03「幅広すぎ」で縮小） */}
          <div className="reveal reveal-delay-2 mt-5 flex w-28 flex-col gap-2 sm:w-36">
            {hero.products.map((p) => (
              <a
                key={p.label}
                href={p.href}
                className="rounded-sm border border-white/70 bg-forest-deep/35 px-3 py-1.5 text-center font-serif text-base tracking-[0.18em] text-white backdrop-blur-sm transition-colors hover:bg-gold hover:border-gold hover:text-forest-deep sm:text-lg"
              >
                {p.label}
              </a>
            ))}
          </div>

          <div className="reveal reveal-delay-3 mt-4 flex w-28 flex-col gap-1.5 sm:w-36">
            <Link href="#features" className="rounded-sm bg-gold px-4 py-1.5 text-center text-xs font-semibold tracking-wider text-forest-deep transition-colors hover:bg-gold-light sm:text-sm">
              {hero.cta}
            </Link>
            <Link href="#dealer" className="rounded-sm bg-gold px-4 py-1.5 text-center text-xs font-semibold tracking-wider text-forest-deep transition-colors hover:bg-gold-light sm:text-sm">
              {hero.ctaDealer}
            </Link>
          </div>
        </div>
      </div>

      <a href="#concept" className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 text-[0.6rem] tracking-[0.3em] text-white/70 hover:text-gold" aria-label="下へスクロール">
        SCROLL
        <ChevronDown className="size-4 animate-bounce" aria-hidden="true" />
      </a>
    </section>
  );
}
