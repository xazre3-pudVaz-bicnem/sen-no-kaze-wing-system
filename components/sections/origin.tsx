import Image from 'next/image';
import { genten } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';
import { PairBlocks } from '@/components/ui/pair-blocks';

/**
 * 開発の原点：Ver5 PDF の2ブロック（左＝開発の原点＋被災地写真／右＝社会のニーズ）。
 * 左ブロック内部の「文章｜写真」はどの画面幅でも変えない。
 */
export function OriginSection() {
  return (
    <section id="genten" className="scroll-mt-20 bg-forest-deep py-8 sm:py-12">
      <div className="container-x">
        <PairBlocks className="lg:items-start">
          <div>
            <RuleHeading labelEn={genten.labelEn} title={genten.title} compact />
            <Reveal>
              <h3 className="mt-3 font-serif text-lg leading-snug text-gold sm:text-xl">{genten.story1.title}</h3>
            </Reveal>
            {/* 文章｜写真（固定2列） */}
            <div className="mt-2 grid grid-cols-[1fr_1fr] items-start gap-3">
              <Reveal>
                <p className="text-[0.75rem] leading-[1.75] whitespace-pre-line text-white/85 sm:text-[0.82rem]">{genten.story1.body}</p>
              </Reveal>
              <Reveal variant="image" className="relative aspect-[4/3] w-full overflow-hidden">
                <Image src={genten.story1.image} alt={genten.story1.alt} fill sizes="(min-width: 1024px) 22vw, 45vw" className="object-cover" />
              </Reveal>
            </div>
          </div>

          <Reveal>
            <h3 className="font-serif text-lg leading-snug text-gold sm:text-xl">{genten.needs.title}</h3>
            <p className="mt-1.5 font-serif text-sm text-gold sm:text-base">{genten.needs.bullet}</p>
            <p className="mt-1.5 text-[0.75rem] leading-[1.75] whitespace-pre-line text-white/85 sm:text-[0.82rem]">{genten.needs.body}</p>
          </Reveal>
        </PairBlocks>
      </div>
    </section>
  );
}
