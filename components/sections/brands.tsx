import Image from 'next/image';
import { brands } from '@/data/brands';
import { Reveal } from '@/components/ui/reveal';
import { cn } from '@/lib/utils';

const panelTone = {
  kirameki: 'bg-ivory text-ink',
  tomoshibi: 'bg-navy text-white',
  midori: 'bg-forest text-white',
} as const;

/**
 * 3ブランド。縦長画像（1122×1402）を引き伸ばさず原寸以下で丸ごと見せるため、
 * PC は「写真 44% ＋ 文字パネル 56%」の分割構成（写真の高さ ≒ 88vh）。SP は写真を全幅 4:5 で表示。
 * 海 → 夜 → 森 の順に、写真の左右を入れ替える。
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
      {brands.map((b, i) => {
        const flip = i % 2 === 1;
        const dark = b.code !== 'kirameki';
        return (
          <article key={b.code} className={cn('lg:grid lg:grid-cols-[44fr_56fr]', panelTone[b.code])}>
            <Reveal variant="image" className={cn('relative', flip && 'lg:order-2')}>
              <figure className="relative aspect-[4/5] w-full">
                <Image src={b.image} alt={b.alt} fill sizes="(min-width: 1024px) 44vw, 100vw" quality={90} className="object-cover object-center" />
              </figure>
            </Reveal>
            <div className={cn('flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16 lg:py-20', flip && 'lg:order-1')}>
              <Reveal>
                <p className={cn('label-en', dark ? 'text-gold' : 'text-forest')}>
                  {String(i + 1).padStart(2, '0')} — {b.roman}
                </p>
                <h3 className={cn('mt-4 flex items-baseline gap-5 font-serif', dark && 'text-white')}>
                  <span className="text-7xl leading-none sm:text-8xl lg:text-9xl">{b.kanji}</span>
                  <span className="text-lg tracking-[0.35em] sm:text-2xl">{b.roman}</span>
                </h3>
                <p className="mt-3 text-sm tracking-wider text-gold">{b.scene}｜活用シーンのイメージ</p>
                <p className={cn('mt-6 max-w-md text-lg leading-snug sm:text-2xl', dark ? 'text-white' : 'text-ink')}>{b.copy}</p>
              </Reveal>
            </div>
          </article>
        );
      })}
    </section>
  );
}
