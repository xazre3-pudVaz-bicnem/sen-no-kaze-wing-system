import Image from 'next/image';
import { genten } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 開発の原点：Ver4 PDF の2列構成（左＝解体しない仮設住宅を目指して＋被災地写真、右＝社会のニーズ） */
export function OriginSection() {
  return (
    <section id="genten" className="scroll-mt-20 bg-forest-deep py-10 sm:py-14">
      <div className="container-x">
        <RuleHeading labelEn={genten.labelEn} title={genten.title} compact />

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2 lg:gap-12">
          {/* 左：ストーリー（文章の右に写真。スマホは文章→写真） */}
          <div>
            <Reveal>
              <h3 className="font-serif text-lg leading-snug text-gold sm:text-2xl">{genten.story1.title}</h3>
            </Reveal>
            <div className="mt-3 grid items-start gap-4 sm:grid-cols-[1fr_1.1fr]">
              <Reveal>
                <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{genten.story1.body}</p>
              </Reveal>
              <Reveal variant="image" className="relative aspect-[3/2] w-full max-w-sm overflow-hidden">
                <Image src={genten.story1.image} alt={genten.story1.alt} fill sizes="(min-width: 1024px) 26vw, 60vw" className="object-cover" />
              </Reveal>
            </div>
          </div>

          {/* 右：社会のニーズ */}
          <Reveal>
            <h3 className="font-serif text-lg leading-snug text-gold sm:text-2xl">{genten.needs.title}</h3>
            <p className="mt-2 font-serif text-sm text-gold sm:text-base">{genten.needs.bullet}</p>
            <p className="mt-2 text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{genten.needs.body}</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
