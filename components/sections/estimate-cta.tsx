import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { dealerRecruit, estimate } from '@/data/site-content';
import { Reveal } from '@/components/ui/reveal';

/** 見積シミュレーション＋代理店様募集（Ver4 PDF：生成り地に見積3タイルと緑の募集ボックスを横並び） */
export function EstimateCtaSection() {
  return (
    <section id="estimate" className="scroll-mt-20 bg-[#efe8cc] py-8 sm:py-12">
      <div className="container-x">
        <Reveal className="text-center">
          <p className="label-en text-gold">{estimate.labelEn}</p>
          <h2 className="mt-2 text-xl text-ink sm:text-2xl">{estimate.title}</h2>
          <p className="mx-auto mt-3 max-w-3xl text-[0.8rem] leading-[1.8] text-ink-soft sm:text-sm">{estimate.lead}</p>
        </Reveal>

        <div className="mt-6 grid grid-cols-3 items-start gap-2 sm:gap-4 lg:grid-cols-[1fr_1fr_1fr_1.1fr]">
          {estimate.buttons.map((b) => (
            <Reveal key={b.slug}>
              <Link href={`/simulator/${b.slug}`} className="group block">
                {/* Ver4：ラベルは画像の上の色付きバッジ */}
                <p
                  className="flex items-center justify-center gap-1 rounded-t-sm px-1 py-1.5 text-[0.72rem] font-semibold tracking-wide text-white transition-opacity group-hover:opacity-85 sm:text-sm"
                  style={{ backgroundColor: b.badge }}
                >
                  {b.label}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </p>
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-white/40">
                  <Image
                    src={b.image}
                    alt={b.alt}
                    fill
                    sizes="(min-width: 640px) 24vw, 30vw"
                    className={`${b.contain ? 'object-contain p-1.5' : 'object-cover'} transition-transform duration-500 group-hover:scale-105`}
                  />
                </div>
              </Link>
            </Reveal>
          ))}

          {/* 代理店様募集（Ver4：緑のボックス） */}
          <Reveal id="dealer" className="col-span-3 scroll-mt-24 lg:col-span-1">
            <div className="h-full bg-forest p-4 text-white sm:p-5">
              <h2 className="font-serif text-base tracking-wider text-gold sm:text-lg">【{dealerRecruit.title}】</h2>
              <p className="mt-2 text-[0.78rem] leading-[1.8] text-white/90 sm:text-sm">{dealerRecruit.body}</p>
              <Link href="/contact" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-gold-light underline-offset-4 hover:underline sm:text-sm">
                {dealerRecruit.cta}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
