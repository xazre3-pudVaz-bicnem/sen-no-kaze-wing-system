import Image from 'next/image';
import { Check } from 'lucide-react';
import { consultation } from '@/data/site-content';
import { brands } from '@/data/brands';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 導入のご相談：こんな土地 → 煌・灯・翠 → 想い → 4つのメリット */
export function ConsultationSection() {
  return (
    <section id="consultation" className="scroll-mt-20 bg-forest py-20 sm:py-28">
      <div className="container-x">
        <RuleHeading labelEn={consultation.labelEn} title={consultation.title} lead={consultation.lead} className="max-w-3xl" />

        {/* こんな土地 ＋ 煌灯翠 */}
        <Reveal className="mt-12 bg-white p-8 sm:p-12 lg:p-16">
          <p className="text-center font-serif text-2xl text-wood-dark sm:text-3xl">{consultation.landTitle}</p>
          <p className="mt-5 text-center text-sm text-ink-soft sm:text-base">{consultation.landBody}</p>
          <p className="mt-4 text-center font-serif text-base text-forest sm:text-xl">{consultation.landTypes.join('、')}</p>

          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {brands.map((b) => (
              <figure key={b.code}>
                <div className="relative aspect-[4/3] w-full overflow-hidden">
                  <Image src={b.image} alt={b.alt} fill sizes="(min-width: 768px) 30vw, 100vw" quality={90} className="object-cover object-center" />
                  <figcaption className="absolute top-3 left-3 bg-forest-deep/85 px-3 py-1 text-[0.7rem] text-white">
                    {b.scene}｜活用シーンのイメージ
                  </figcaption>
                </div>
                <p className="mt-4 font-serif text-2xl">
                  Wing {b.kanji}（{b.kana}）
                </p>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{b.copy}</p>
              </figure>
            ))}
          </div>
        </Reveal>

        {/* 想い */}
        <Reveal className="mt-16 text-center">
          <h3 className="font-serif text-2xl text-white sm:text-4xl">{consultation.wishTitle}</h3>
          <p className="mt-3 text-sm text-white/75 sm:text-base">{consultation.wishLead}</p>
          <ul className="mx-auto mt-8 flex max-w-4xl flex-wrap justify-center gap-x-8 gap-y-3">
            {consultation.wishes.map((w) => (
              <li key={w} className="flex items-center gap-2 text-sm text-white/90 sm:text-base">
                <Check className="size-4 shrink-0 text-gold" aria-hidden="true" />
                {w}
              </li>
            ))}
          </ul>
        </Reveal>

        {/* 4つのメリット */}
        <div className="mt-14 grid gap-6 sm:grid-cols-2">
          {consultation.merits.map((m, i) => (
            <Reveal key={m.title} delay={i * 60}>
              <div className="h-full border-t-2 border-gold bg-forest-deep p-7 sm:p-9">
                <p className="font-serif text-xl text-gold sm:text-2xl">{m.title}</p>
                <p className="mt-3 text-sm leading-[1.95] text-white/80">{m.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
