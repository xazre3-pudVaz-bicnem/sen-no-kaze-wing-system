import Image from 'next/image';
import { genten } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 開発の原点：震災の実体験 → 社会のニーズ → 不陸調整方式採用の3つの「何故」（2026-09-02 文字・行間を圧縮） */
export function OriginSection() {
  return (
    <section id="genten" className="scroll-mt-20 bg-forest-deep py-10 sm:py-14">
      <div className="container-x">
        <RuleHeading labelEn={genten.labelEn} title={genten.title} compact />

        {/* ストーリー1：写真右（写真は4列グリッド2列分の控えめサイズ） */}
        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[1.2fr_1fr] lg:gap-10">
          <Reveal>
            <h3 className="font-serif text-lg leading-snug whitespace-pre-line text-gold sm:text-2xl">{genten.story1.title}</h3>
            <p className="mt-3 text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{genten.story1.body}</p>
          </Reveal>
          <Reveal variant="image" className="relative aspect-[16/10] w-full max-w-sm overflow-hidden lg:max-w-none">
            <Image src={genten.story1.image} alt={genten.story1.alt} fill sizes="(min-width: 1024px) 38vw, 60vw" className="object-cover" />
          </Reveal>
        </div>

        {/* 社会のニーズ：3つの選択肢 */}
        <Reveal className="mt-10">
          <h3 className="font-serif text-lg text-gold sm:text-2xl">{genten.needs.title}</h3>
        </Reveal>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {genten.needs.items.map((n) => (
            <Reveal key={n.title} className="border border-forest-line bg-forest/60 p-4 sm:p-5">
              <h4 className="font-serif text-sm leading-snug text-white sm:text-base">{n.title}</h4>
              <p className="mt-2 text-[0.75rem] leading-[1.7] text-white/85">{n.body}</p>
            </Reveal>
          ))}
        </div>

        {/* ストーリー2：3つの「何故」。写真は先方指示（2026-09-02 赤×）で撤去し、文章のみ3列で */}
        <div className="mt-10">
          <Reveal>
            <p className="inline-block border border-gold/60 px-2 py-0.5 text-[0.65rem] tracking-[0.2em] text-gold">{genten.story2.badge}</p>
            <h3 className="mt-2 font-serif text-lg leading-snug whitespace-pre-line text-gold sm:text-2xl">{genten.story2.title}</h3>
            <p className="mt-1.5 text-xs tracking-wider text-white/80 sm:text-sm">{genten.story2.lead}</p>
          </Reveal>
          <dl className="mt-4 grid gap-3.5 lg:grid-cols-3 lg:gap-6">
            {genten.story2.whys.map((w) => (
              <Reveal key={w.q}>
                <dt className="font-serif text-sm text-white sm:text-base">{w.q}</dt>
                <dd className="mt-1 border-l-2 border-gold/50 pl-3 text-[0.75rem] leading-[1.7] text-white/85 sm:text-[0.8rem]">{w.a}</dd>
              </Reveal>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
