import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { hero } from '@/data/site-content';

/** ファーストビュー：3枚クロスフェード（従来どおり）＋ Ver4 の見出し・サブラベル付きボタン */
export function HomeHero() {
  return (
    <section className="relative isolate min-h-[55svh] overflow-hidden bg-forest-deep text-white lg:min-h-[70svh]">
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

      <div className="relative flex min-h-[55svh] flex-col justify-center lg:min-h-[70svh]">
        <div className="container-x py-12 sm:py-16">
          <h1 className="reveal reveal-delay-1 max-w-xl font-serif text-[1.4rem] leading-snug tracking-[0.04em] text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.55)] sm:text-4xl">
            {hero.title}
            <span className="mt-1 block text-sm tracking-[0.12em] text-white/90 sm:text-lg">{hero.patent}</span>
          </h1>

          {/* Wing / BOX / Flat（Ver4：方式のサブラベル付き） */}
          <div className="reveal reveal-delay-2 mt-4 flex w-36 flex-col gap-1.5 sm:w-44">
            {hero.products.map((p) => (
              <a
                key={p.label}
                href={p.href}
                className="flex items-baseline justify-between gap-2 rounded-sm border border-white/70 bg-navy/60 px-3 py-1.5 backdrop-blur-sm transition-colors hover:border-gold hover:bg-gold hover:text-forest-deep"
              >
                <span className="font-serif text-sm tracking-[0.15em] text-gold-light sm:text-base">{p.label}</span>
                <span className="text-[0.58rem] tracking-wider text-gold-light sm:text-[0.7rem]">{p.sub}</span>
              </a>
            ))}
          </div>

          <div className="reveal reveal-delay-3 mt-3 flex w-32 flex-col gap-1.5 sm:w-40">
            <Link href="#features" className="rounded-full border border-gold bg-forest-deep/70 px-3 py-1 text-center text-[0.68rem] font-semibold tracking-wider text-white transition-colors hover:bg-gold hover:text-forest-deep sm:text-xs">
              {hero.cta}
            </Link>
            <Link href="#dealer" className="rounded-full border border-gold bg-forest-deep/70 px-3 py-1 text-center text-[0.68rem] font-semibold tracking-wider text-white transition-colors hover:bg-gold hover:text-forest-deep sm:text-xs">
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
