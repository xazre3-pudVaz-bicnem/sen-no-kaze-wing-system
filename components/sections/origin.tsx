import Image from 'next/image';
import { Check } from 'lucide-react';
import { genten } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 開発の原点：震災の実体験 → 折りたたみ式へ → Wingの特長 → 社会のニーズ */
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

        {/* ストーリー2：写真左 */}
        <div className="mt-16 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <Reveal variant="image" className="lg:order-1">
            <div className="relative aspect-[4/3] w-full overflow-hidden">
              <Image src={genten.story2.image} alt={genten.story2.alt} fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
            </div>
          </Reveal>
          <Reveal className="lg:order-2">
            <h3 className="font-serif text-2xl leading-snug whitespace-pre-line text-gold sm:text-4xl">{genten.story2.title}</h3>
            <p className="mt-6 text-sm leading-[2] whitespace-pre-line text-white/85 sm:text-base">{genten.story2.body}</p>
          </Reveal>
        </div>

        {/* Wingの特長 */}
        <Reveal className="mt-16 border border-forest-line bg-forest/60 p-8 sm:p-12">
          <h3 className="font-serif text-2xl text-white sm:text-3xl">{genten.features.title}</h3>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {genten.features.items.map((t) => (
              <li key={t} className="flex items-start gap-3 text-sm leading-relaxed text-white/90 sm:text-base">
                <Check className="mt-1 size-4 shrink-0 text-gold" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </Reveal>

        {/* 社会のニーズ */}
        <Reveal className="mt-16 max-w-3xl">
          <h3 className="font-serif text-2xl text-gold sm:text-3xl">{genten.needs.title}</h3>
          <p className="mt-5 text-sm leading-[2] whitespace-pre-line text-white/85 sm:text-base">{genten.needs.body}</p>
          <p className="mt-8 font-serif text-lg leading-relaxed whitespace-pre-line text-white sm:text-2xl">{genten.needs.closing}</p>
        </Reveal>
      </div>
    </section>
  );
}
