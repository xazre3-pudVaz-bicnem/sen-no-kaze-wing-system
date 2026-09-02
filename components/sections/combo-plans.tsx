import Image from 'next/image';
import { combos } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 組合せプラン：本体＋水回りキット・居室の平面図ギャラリー（2026-09-02 文字・余白を圧縮） */
export function ComboPlansSection() {
  return (
    <section id="plans" className="scroll-mt-20 bg-paper py-8 sm:py-12">
      <div className="container-x">
        <RuleHeading labelEn={combos.labelEn} title={combos.title} tone="light" compact />

        <Reveal className="mt-3 max-w-3xl">
          <p className="text-[0.8rem] leading-[1.7] text-ink-soft sm:text-sm">{combos.note}</p>
          <p className="mt-1 text-[0.7rem] leading-relaxed text-ink-soft/80">{combos.caution}</p>
        </Reveal>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {combos.items.map((item) => (
            <Reveal key={item.label} variant="image">
              <figure className="flex h-full flex-col border border-brown/15 bg-white">
                <div className="relative aspect-[4/3] w-full overflow-hidden">
                  <Image src={item.image} alt={item.alt} fill sizes="(min-width: 640px) 22vw, 45vw" className="object-contain p-1.5" />
                </div>
                <figcaption className="border-t border-brown/10 px-2 py-1 text-center text-[0.68rem] leading-snug text-ink sm:text-xs">{item.label}</figcaption>
              </figure>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-4">
          <p className="text-[0.7rem] leading-relaxed text-ink-soft sm:text-xs">{combos.legal}</p>
        </Reveal>
      </div>
    </section>
  );
}
