import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { estimate } from '@/data/site-content';
import { Reveal } from '@/components/ui/reveal';

/** 見積シミュレーション導線：Wing / BOX / Flat の3ボタン（2026-09-01 トップ修正案） */
export function EstimateCtaSection() {
  return (
    <section id="estimate" className="scroll-mt-20 bg-forest py-16 text-white sm:py-24">
      <div className="container-x text-center">
        <Reveal>
          <p className="label-en text-gold">{estimate.labelEn}</p>
          <h2 className="mt-4 text-2xl text-white sm:text-4xl">{estimate.title}</h2>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-[2] whitespace-pre-line text-white/85 sm:text-base">{estimate.lead}</p>
        </Reveal>

        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {estimate.buttons.map((b, i) => (
            <Reveal key={b.slug} delay={i * 80}>
              <Link href={`/simulator/${b.slug}`} className="group block border border-forest-line bg-forest-deep/60 transition-colors hover:border-gold">
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-white/5">
                  <Image src={b.image} alt={b.alt} fill sizes="(min-width: 640px) 30vw, 90vw" className="object-cover transition-transform duration-500 group-hover:scale-105" />
                </div>
                <p className="flex items-center justify-center gap-2 px-4 py-4 font-serif text-base tracking-wider text-gold-light group-hover:text-gold sm:text-lg">
                  {b.label}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </p>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
