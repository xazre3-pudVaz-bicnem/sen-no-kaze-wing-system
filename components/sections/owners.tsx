import Image from 'next/image';
import Link from 'next/link';
import { owners } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** プロジェクトの参加：ホテルオーナー／パートナー募集 */
export function OwnersSection() {
  return (
    <section id="owners" className="scroll-mt-20 bg-ivory py-20 sm:py-28">
      <div className="container-x">
        <RuleHeading labelEn={owners.labelEn} title={owners.title} tone="light" />

        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          {owners.blocks.map((b, i) => (
            <Reveal key={b.title} delay={i * 80}>
              <figure>
                <div className="relative aspect-[3/2] w-full overflow-hidden">
                  <Image src={b.image} alt={b.alt} fill sizes="(min-width: 1024px) 46vw, 100vw" className="object-cover" />
                </div>
                <figcaption className="mt-5">
                  <p className="font-serif text-xl sm:text-2xl">{b.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{b.body}</p>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-12">
          <Link href="#contact" className="btn-primary">
            参加について問い合わせる
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
