import Image from 'next/image';
import { genten } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 開発の原点：震災の実体験 → 社会のニーズ → 不陸調整方式採用の3つの「何故」（2026-09-01 トップ修正案） */
export function OriginSection() {
  return (
    <section id="genten" className="scroll-mt-20 bg-forest-deep py-20 sm:py-28">
      <div className="container-x">
        <RuleHeading labelEn={genten.labelEn} title={genten.title} />

        {/* ストーリー1：写真右 */}
        <div className="mt-16 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <h3 className="font-serif text-2xl leading-snug whitespace-pre-line text-gold sm:text-4xl">{genten.story1.title}</h3>
            <p className="mt-6 text-sm leading-[2] whitespace-pre-line text-white/85 sm:text-base">{genten.story1.body}</p>
          </Reveal>
          <Reveal variant="image">
            <div className="relative aspect-[4/3] w-full overflow-hidden">
              <Image src={genten.story1.image} alt={genten.story1.alt} fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
            </div>
          </Reveal>
        </div>

        {/* 社会のニーズ：3つの選択肢 */}
        <Reveal className="mt-20">
          <h3 className="font-serif text-2xl text-gold sm:text-3xl">{genten.needs.title}</h3>
        </Reveal>
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {genten.needs.items.map((n) => (
            <Reveal key={n.title} className="border border-forest-line bg-forest/60 p-7 sm:p-8">
              <h4 className="font-serif text-lg leading-snug text-white sm:text-xl">{n.title}</h4>
              <p className="mt-4 text-sm leading-[1.9] text-white/85">{n.body}</p>
            </Reveal>
          ))}
        </div>

        {/* ストーリー2：不陸調整方式採用の3つの「何故」（写真左） */}
        <div className="mt-20 grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
          <Reveal variant="image" className="lg:order-1 lg:sticky lg:top-24">
            <div className="relative aspect-[4/3] w-full overflow-hidden">
              <Image src={genten.story2.image} alt={genten.story2.alt} fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
            </div>
          </Reveal>
          <Reveal className="lg:order-2">
            <p className="inline-block border border-gold/60 px-3 py-1 text-xs tracking-[0.2em] text-gold">{genten.story2.badge}</p>
            <h3 className="mt-4 font-serif text-2xl leading-snug whitespace-pre-line text-gold sm:text-4xl">{genten.story2.title}</h3>
            <p className="mt-4 text-sm tracking-wider text-white/80 sm:text-base">{genten.story2.lead}</p>
            <dl className="mt-8 space-y-8">
              {genten.story2.whys.map((w) => (
                <div key={w.q}>
                  <dt className="font-serif text-lg text-white sm:text-xl">{w.q}</dt>
                  <dd className="mt-2 border-l-2 border-gold/50 pl-4 text-sm leading-[1.9] text-white/85">{w.a}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
