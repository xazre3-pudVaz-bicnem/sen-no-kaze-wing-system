import Image from 'next/image';
import { wooden } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';
import { cn } from '@/lib/utils';

/** 木造コンテナについて：01 能登の夢 / 02 宿泊イメージ / 03 レイアウト / 04 主力モデル */
export function WoodenContainerSection() {
  return (
    <section id="wooden" className="scroll-mt-20 bg-ivory py-20 sm:py-28">
      <div className="container-x">
        <RuleHeading labelEn={wooden.labelEn} title={wooden.title} lead={wooden.lead} tone="light" className="max-w-3xl" />
      </div>

      <div className="mt-14 space-y-14 sm:mt-20 sm:space-y-20">
        {wooden.blocks.map((b, i) => {
          const flip = i % 2 === 1;
          return (
            <article key={b.no} className="container-x grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
              <Reveal variant="image" className={cn(flip && 'lg:order-2')}>
                <div className={cn('relative w-full overflow-hidden bg-white', b.no === '03' ? 'aspect-[4/3]' : 'aspect-[3/2]')}>
                  <Image src={b.image} alt={b.alt} fill sizes="(min-width: 1024px) 48vw, 100vw" className={b.no === '03' ? 'object-contain p-3' : 'object-cover'} />
                </div>
              </Reveal>
              <Reveal className={cn(flip && 'lg:order-1')}>
                <p className="label-en text-gold">
                  {b.no}&nbsp;&nbsp;{b.labelEn}
                </p>
                <h3 className="mt-3 font-serif text-2xl leading-snug whitespace-pre-line sm:text-4xl">{b.title}</h3>
                <p className="mt-5 text-sm leading-[1.95] text-ink-soft sm:text-base">{b.body}</p>
                {b.caption && <p className="mt-4 border-l-2 border-gold/60 pl-4 text-xs text-muted sm:text-sm">{b.caption}</p>}
                {b.note && <p className="mt-4 text-xs text-muted">{b.note}</p>}
              </Reveal>
            </article>
          );
        })}
      </div>
    </section>
  );
}
