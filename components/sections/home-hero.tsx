import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { hero } from '@/data/site-content';

/** ファーストビュー：全面写真＋「− 折畳木造コンテナホテル − Wing」＋能登拠点のお知らせ */
export function HomeHero() {
  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden bg-forest-deep text-white">
      <Image
        src="/images/hero/wing-sunset-coast.jpg"
        alt="夕陽に染まる海岸の高台に建つ、折り畳み式木造コンテナ Wing"
        fill
        priority
        sizes="100vw"
        className="object-cover object-[68%_center] sm:object-[62%_center]"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-forest-deep/55 via-transparent to-forest-deep/75" aria-hidden="true" />

      <div className="relative flex min-h-[100svh] flex-col">
        {/* 能登拠点のお知らせ */}
        <div className="container-x pt-24 sm:pt-32 lg:pt-36">
          <div className="reveal max-w-xl border border-gold/60 bg-forest-deep/70 p-5 backdrop-blur-sm sm:p-6">
            <p className="font-serif text-lg text-gold sm:text-xl">{hero.notice.title}</p>
            <p className="mt-1 font-serif text-base text-white sm:text-lg">{hero.notice.strong}</p>
            <p className="mt-3 text-xs leading-relaxed text-white/80 sm:text-sm">{hero.notice.body}</p>
          </div>
        </div>

        {/* タイトル */}
        <div className="container-x mt-auto pb-24 text-center sm:pb-28">
          <p className="reveal reveal-delay-1 font-serif text-sm tracking-[0.3em] text-white/90 sm:text-lg">{hero.eyebrow}</p>
          <h1 className="reveal reveal-delay-1 mt-3 font-serif text-[4.5rem] leading-none tracking-[0.06em] text-gold-light drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)] sm:text-[7rem] lg:text-[8.5rem]">
            Wing
          </h1>
          <p className="reveal reveal-delay-2 mx-auto mt-6 max-w-xl text-sm leading-[2] whitespace-pre-line text-white/90 sm:text-base">{hero.lead}</p>
          <div className="reveal reveal-delay-3 mt-8">
            <Link href="#concept" className="btn-outline-gold font-serif tracking-wider">
              {hero.cta}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>

      <a href="#concept" className="absolute bottom-5 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 text-[0.6rem] tracking-[0.3em] text-white/70 hover:text-gold" aria-label="下へスクロール">
        SCROLL
        <ChevronDown className="size-4 animate-bounce" aria-hidden="true" />
      </a>
    </section>
  );
}
