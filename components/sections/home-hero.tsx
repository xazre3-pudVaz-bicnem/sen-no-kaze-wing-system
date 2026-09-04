import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { hero } from '@/data/site-content';

/** ファーストビュー：Ver4 PDF の静止構成（湖畔の背景＋右上に夕暮れパネル＋右下に内装パネル） */
export function HomeHero() {
  return (
    <section className="relative isolate min-h-[55svh] overflow-hidden bg-forest-deep text-white lg:min-h-[70svh]">
      <Image src={hero.bg.src} alt={hero.bg.alt} fill priority sizes="100vw" className="object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-forest-deep/70 via-forest-deep/25 to-transparent" aria-hidden="true" />

      {/* 右上：夕暮れの黒コンテナ／右下：内装の組写真（Ver4。狭い画面では背景のみ） */}
      <div className="absolute top-0 right-0 hidden w-[38%] md:block">
        <div className="relative aspect-[2/1] w-full">
          <Image src={hero.panelTop.src} alt={hero.panelTop.alt} fill sizes="38vw" className="object-cover" />
        </div>
      </div>
      <div className="absolute right-0 bottom-0 hidden w-[42%] md:block">
        <div className="relative aspect-[16/9] w-full">
          <Image src={hero.panelBottom.src} alt={hero.panelBottom.alt} fill sizes="42vw" className="object-cover" />
        </div>
      </div>

      <div className="relative flex min-h-[55svh] flex-col justify-center lg:min-h-[70svh]">
        <div className="container-x py-12 sm:py-16">
          <h1 className="reveal reveal-delay-1 max-w-xl font-serif text-[1.4rem] leading-snug tracking-[0.04em] text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.55)] sm:text-4xl">
            {hero.title}
            <span className="mt-1 block text-sm tracking-[0.12em] text-white/90 sm:text-lg">{hero.patent}</span>
          </h1>

          {/* Wing / BOX / Flat（Ver4：方式のサブラベル付き） */}
          <div className="reveal reveal-delay-2 mt-5 flex w-44 flex-col gap-2 sm:w-52">
            {hero.products.map((p) => (
              <a
                key={p.label}
                href={p.href}
                className="flex items-baseline justify-between gap-2 rounded-sm border border-white/70 bg-navy/60 px-3 py-1.5 backdrop-blur-sm transition-colors hover:border-gold hover:bg-gold hover:text-forest-deep"
              >
                <span className="font-serif text-base tracking-[0.18em] text-gold-light sm:text-lg">{p.label}</span>
                <span className="text-[0.65rem] tracking-wider text-gold-light sm:text-xs">{p.sub}</span>
              </a>
            ))}
          </div>

          <div className="reveal reveal-delay-3 mt-4 flex w-36 flex-col gap-1.5">
            <Link href="#features" className="rounded-full border border-gold bg-forest-deep/70 px-4 py-1.5 text-center text-xs font-semibold tracking-wider text-white transition-colors hover:bg-gold hover:text-forest-deep sm:text-sm">
              {hero.cta}
            </Link>
            <Link href="#dealer" className="rounded-full border border-gold bg-forest-deep/70 px-4 py-1.5 text-center text-xs font-semibold tracking-wider text-white transition-colors hover:bg-gold hover:text-forest-deep sm:text-sm">
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
