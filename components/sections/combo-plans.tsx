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

        {/* 修正案どおり：ラベル見出しの下に図を並べるグループ構成 */}
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-6">
          {combos.groups.map((g) => (
            <Reveal key={g.label} variant="image" className="min-w-0">
              <p className="font-serif text-[0.8rem] font-semibold text-ink sm:text-sm">{g.label}</p>
              <div className="mt-1.5 flex flex-wrap gap-3">
                {g.items.map((item) => (
                  <figure key={item.image} className="w-36 border border-brown/15 bg-white sm:w-44">
                    <div className="relative aspect-[4/3] w-full overflow-hidden">
                      <Image src={item.image} alt={item.alt} fill sizes="11rem" className="object-contain p-1" />
                    </div>
                  </figure>
                ))}
              </div>
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
