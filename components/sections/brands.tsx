import Image from 'next/image';
import { brands } from '@/data/brands';
import { Reveal, Parallax } from '@/components/ui/reveal';
import { cn } from '@/lib/utils';

/**
 * 3ブランドを画面幅いっぱいの独立セクションとして並べる（海 → 夜 → 森）。
 * 文字は HTML テキスト。可読性のため文字周辺だけ局所的なスクリムを敷く。
 */
export function BrandsSection() {
  return (
    <section id="brands" className="scroll-mt-16 bg-forest-deep">
      <div className="container-x py-14 text-white sm:py-20">
        <Reveal>
          <p className="label-en text-gold">Three Scenes</p>
          <h2 className="mt-4 text-3xl text-white sm:text-5xl">置く場所で、表情が変わる。</h2>
          <p className="mt-4 max-w-2xl text-white/75">海辺の朝、森の夜、新緑の昼。同じ一棟が、土地の光と景色を取り込んで三つの世界観をつくります。</p>
        </Reveal>
      </div>
      {brands.map((b, i) => (
        <article key={b.code} className="relative isolate min-h-[78svh] overflow-hidden sm:min-h-[88svh]">
          <Parallax strength={0.06}>
            <Image
              src={b.image}
              alt={b.alt}
              fill
              sizes="100vw"
              className="object-cover [object-position:var(--pos-m)] sm:[object-position:var(--pos)]"
              style={{ '--pos': b.position, '--pos-m': b.positionMobile } as React.CSSProperties}
            />
          </Parallax>
          <div className={cn('absolute inset-x-0 bottom-0 h-[55%]', b.tone === 'dark' ? 'bg-gradient-to-t from-black/70 via-black/30 to-transparent' : 'bg-gradient-to-t from-black/65 via-black/25 to-transparent')} aria-hidden="true" />
          <div className={cn('container-x relative flex min-h-[78svh] flex-col justify-end pb-16 text-white sm:min-h-[88svh] sm:pb-24', i % 2 === 1 && 'items-end text-right')}>
            <Reveal>
              <p className="label-en text-white/80">
                {String(i + 1).padStart(2, '0')} — {b.roman}
              </p>
              <h3 className="mt-3 flex items-baseline gap-4 font-serif text-white">
                <span className="text-7xl leading-none sm:text-8xl">{b.kanji}</span>
                <span className="text-xl tracking-[0.3em] sm:text-2xl">{b.roman}</span>
              </h3>
              <p className="mt-5 text-xl leading-snug sm:text-3xl">{b.copy}</p>
              <p className={cn('mt-4 max-w-md text-sm leading-relaxed text-white/80 sm:text-base', i % 2 === 1 && 'ml-auto')}>{b.lead}</p>
            </Reveal>
          </div>
        </article>
      ))}
    </section>
  );
}
