import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { estimate } from '@/data/site-content';
import { Reveal } from '@/components/ui/reveal';

/** 見積シミュレーション導線：Wing / BOX / Flat の3ボタン（2026-09-02 文字・余白を圧縮） */
export function EstimateCtaSection() {
  return (
    <section id="estimate" className="scroll-mt-20 bg-forest py-10 text-white sm:py-14">
      <div className="container-x text-center">
        <Reveal>
          <p className="label-en text-gold">{estimate.labelEn}</p>
          <h2 className="mt-2 text-xl text-white sm:text-2xl">{estimate.title}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{estimate.lead}</p>
        </Reveal>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {estimate.buttons.map((b) => (
            <Reveal key={b.slug}>
              <Link href={`/simulator/${b.slug}`} className="group block border border-forest-line bg-forest-deep/60 transition-colors hover:border-gold">
                <div className="relative aspect-[16/9] w-full overflow-hidden">
                  {/* 透過版CGは全体が見えるよう contain、写真は cover */}
                  <Image
                    src={b.image}
                    alt={b.alt}
                    fill
                    sizes="(min-width: 640px) 30vw, 90vw"
                    className={`${b.contain ? 'object-contain p-2' : 'object-cover'} transition-transform duration-500 group-hover:scale-105`}
                  />
                </div>
                <p className="flex items-center justify-center gap-1.5 px-3 py-2.5 font-serif text-sm tracking-wider text-gold-light group-hover:text-gold sm:text-base">
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
