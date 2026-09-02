import Image from 'next/image';
import { combos } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 組合せプラン：本体＋水回りキット・居室の平面図ギャラリー（2026-09-01 トップ修正案） */
export function ComboPlansSection() {
  return (
    <section id="plans" className="scroll-mt-20 bg-paper py-20 sm:py-28">
      <div className="container-x">
        <RuleHeading labelEn={combos.labelEn} title={combos.title} tone="light" />

        <Reveal className="mt-8 max-w-3xl">
          <p className="text-sm leading-[2] text-ink-soft sm:text-base">{combos.note}</p>
          <p className="mt-3 text-xs leading-relaxed text-ink-soft/80">{combos.caution}</p>
        </Reveal>

        <div className="mt-12 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {combos.items.map((item, i) => (
            <Reveal key={item.label} variant="image" delay={(i % 4) * 60}>
              <figure className="flex h-full flex-col border border-brown/20 bg-white">
                <div className="relative aspect-[4/3] w-full overflow-hidden">
                  <Image src={item.image} alt={item.alt} fill sizes="(min-width: 1024px) 22vw, 45vw" className="object-contain p-2" />
                </div>
                <figcaption className="border-t border-brown/10 px-3 py-2 text-center text-xs leading-snug text-ink sm:text-sm">{item.label}</figcaption>
              </figure>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-8">
          <p className="text-xs leading-relaxed text-ink-soft sm:text-sm">{combos.legal}</p>
        </Reveal>
      </div>
    </section>
  );
}
