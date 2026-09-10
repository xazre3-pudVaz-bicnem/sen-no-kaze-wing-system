import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { hero } from '@/data/site-content';

const heroInteriorGrid = [
  { src: '/images/interior/living-tv.jpg', alt: 'テレビのある Wing の室内' },
  { src: '/images/interior/bedroom-seaview.webp', alt: '海を望む Wing の寝室' },
  { src: '/images/interior/bedroom-garden.jpg', alt: '庭を望む Wing の寝室' },
  { src: '/images/interior/washroom-seaview.jpg', alt: '丸鏡のある Wing の洗面室' },
] as const;

/** ファーストビュー：3枚クロスフェード（従来どおり）＋ Ver4 の見出し・サブラベル付きボタン */
export function HomeHero() {
  return (
    <section className="relative isolate min-h-[55svh] overflow-hidden bg-forest-deep text-white lg:min-h-[70svh]">
      {/* 1枚目は常時表示の下地、2〜3枚目が hero-crossfade で入れ替わる */}
      <Image src={hero.slides[0].src} alt={hero.slides[0].alt} fill priority sizes="100vw" className="object-cover" />
      {hero.slides.slice(1).map((s, i) =>
        i === 0 ? (
          <div
            key={s.src}
            className="hero-slide absolute inset-0 grid grid-cols-[44fr_56fr] grid-rows-2 gap-[10px] bg-forest-deep"
            style={{ animationDelay: `${(i + 1) * 5}s` }}
            aria-hidden="true"
          >
            {heroInteriorGrid.map((image, gridIndex) => (
              <div key={image.src} className="relative overflow-hidden">
                <Image
                  src={image.src}
                  alt=""
                  fill
                  sizes={gridIndex % 2 === 0 ? '44vw' : '56vw'}
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        ) : (
          <Image
            key={s.src}
            src={s.src}
            alt=""
            aria-hidden="true"
            fill
            sizes="100vw"
            className={`hero-slide object-cover ${i === 1 ? 'object-[center_60%]' : ''}`}
            quality={90}
            style={{ animationDelay: `${(i + 1) * 5}s` }}
          />
        ),
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-forest-deep/70 via-forest-deep/25 to-transparent" aria-hidden="true" />

      <div className="relative flex min-h-[55svh] flex-col justify-center lg:min-h-[70svh]">
        <div className="container-x py-12 sm:py-16">
          <h1 className="reveal reveal-delay-1 max-w-xl font-serif text-[1.4rem] leading-snug tracking-[0.04em] text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.55)] sm:text-4xl">
            {hero.title}
            <span className="mt-1 block text-sm tracking-[0.12em] text-white/90 sm:text-lg">{hero.patent}</span>
          </h1>

          {/* Wing / BOX / Flat（Ver4：方式のサブラベル付き） */}
          <div className="reveal reveal-delay-2 mt-4 flex w-24 flex-col gap-1.5 sm:w-[7.5rem]">
            {hero.products.map((p) => (
              <a
                key={p.label}
                href={p.href}
                className="flex items-baseline justify-between gap-1 rounded-sm border border-white/70 bg-navy/60 px-2 py-1.5 backdrop-blur-sm transition-colors hover:border-gold hover:bg-gold hover:text-forest-deep"
              >
                <span className="shrink-0 whitespace-nowrap font-serif text-[0.78rem] tracking-[0.12em] text-gold-light sm:text-[0.9rem] sm:tracking-[0.12em]">{p.label}</span>
                <span className="whitespace-nowrap text-[0.5rem] tracking-wider text-gold-light sm:text-[0.62rem]">{p.sub}</span>
              </a>
            ))}
          </div>

          <div className="reveal reveal-delay-3 mt-3 flex w-24 flex-col gap-1.5 sm:w-[7.5rem]">
            <Link href="#features" className="rounded-full border border-gold bg-forest-deep/70 px-2 py-1 text-center text-[0.58rem] font-semibold tracking-wider text-white transition-colors hover:bg-gold hover:text-forest-deep sm:px-3 sm:text-xs">
              {hero.cta}
            </Link>
            <Link href="#dealer" className="rounded-full border border-gold bg-forest-deep/70 px-2 py-1 text-center text-[0.58rem] font-semibold tracking-wider text-white transition-colors hover:bg-gold hover:text-forest-deep sm:px-3 sm:text-xs">
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
