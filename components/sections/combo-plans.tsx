import Image from 'next/image';
import { combos } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 組合せプラン：Ver4 PDF（色付きバッジのグループ＋帯見出し付きの組合せ4例） */
export function ComboPlansSection() {
  return (
    <section id="plans" className="scroll-mt-20 bg-ivory py-8 sm:py-12">
      <div className="container-x">
        <RuleHeading labelEn={combos.labelEn} title={combos.title} tone="light" compact />

        <Reveal className="mt-3 max-w-3xl">
          <p className="text-[0.8rem] leading-[1.7] whitespace-pre-line text-ink-soft sm:text-sm">{combos.note}</p>
          <p className="mt-1 text-[0.7rem] leading-relaxed text-red-600">{combos.caution}</p>
        </Reveal>

        {/* グループ：色付きバッジ＋図の列（基本本体だけ青緑のパネル入り） */}
        <div className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-5">
          {combos.groups.map((g) => (
            <Reveal key={g.label} variant="image" className="min-w-0">
              <p className="inline-block rounded-full border border-gold/60 px-4 py-1 font-serif text-[0.72rem] tracking-wider text-white sm:text-xs" style={{ backgroundColor: g.badge }}>
                {g.label}
              </p>
              <div className={`mt-1.5 flex flex-wrap gap-3 ${g.panel ? 'bg-[#0b4f66] p-2.5' : ''}`}>
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

        {/* 組合せ4例：帯見出し＋注記（Ver4） */}
        <Reveal className="mt-6">
          <p className="rounded-sm px-3 py-1.5 text-[0.75rem] font-semibold tracking-wide text-white sm:text-sm" style={{ backgroundColor: combos.comboBand.color }}>
            {combos.comboBand.label}　{combos.comboBand.note}
          </p>
        </Reveal>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {combos.comboBand.items.map((item) => (
            <Reveal key={item.image} variant="image">
              <figure className="border border-brown/15 bg-white">
                <div className="relative aspect-[4/5] w-full overflow-hidden">
                  <Image src={item.image} alt={item.alt} fill sizes="(min-width: 640px) 22vw, 45vw" className="object-contain p-1" />
                </div>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
